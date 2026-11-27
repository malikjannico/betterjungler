use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use reqwest::{Certificate, Client};
use serde::{Deserialize, Deserializer, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::riot_api::{parse_platform, SummonerProfileSummary};

const RIOT_ROOT_PEM: &[u8] = include_bytes!("../certs/riotgames.pem");

fn null_to_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(|opt| opt.unwrap_or_default())
}

#[derive(Debug, Clone)]
pub struct LockfileCredentials {
    #[allow(dead_code)]
    pub process_name: String,
    #[allow(dead_code)]
    pub pid: u32,
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunePageSpec {
    pub name: String,
    pub primary_style_id: u32,
    pub sub_style_id: u32,
    pub selected_perk_ids: Vec<u32>,
    #[serde(default)]
    pub summary_labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChampSelectPlayerSlot {
    pub cell_id: i64,
    pub team: String,
    pub display_name: String,
    pub champion_id: i64,
    pub assigned_position: String,
    pub spell1_id: i64,
    pub spell2_id: i64,
    pub is_local_player: bool,
    pub is_party_member: bool,
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedChampSelectSession {
    pub queue_id: i64,
    pub is_ranked_solo_duo: bool,
    pub local_player_cell_id: i64,
    pub my_team: Vec<ChampSelectPlayerSlot>,
    pub their_team: Vec<ChampSelectPlayerSlot>,
    pub ally_bans: Vec<i64>,
    pub enemy_bans: Vec<i64>,
    pub map_side: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLcuSlot {
    cell_id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    champion_id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    champion_pick_intent: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    assigned_position: String,
    #[serde(default, deserialize_with = "null_to_default")]
    spell1_id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    spell2_id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    summoner_id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    display_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    game_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    tag_line: String,
    #[serde(default, deserialize_with = "null_to_default")]
    team: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLcuAction {
    #[serde(default, deserialize_with = "null_to_default")]
    actor_cell_id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    champion_id: i64,
    #[serde(default, rename = "type", deserialize_with = "null_to_default")]
    action_type: String,
    #[serde(default, deserialize_with = "null_to_default")]
    completed: bool,
    #[serde(default, deserialize_with = "null_to_default")]
    is_ally_action: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLcuBans {
    #[serde(default, deserialize_with = "null_to_default")]
    my_team_bans: Vec<i64>,
    #[serde(default, deserialize_with = "null_to_default")]
    their_team_bans: Vec<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLcuSession {
    #[serde(default, deserialize_with = "null_to_default")]
    local_player_cell_id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    my_team: Vec<RawLcuSlot>,
    #[serde(default, deserialize_with = "null_to_default")]
    their_team: Vec<RawLcuSlot>,
    #[serde(default, deserialize_with = "null_to_default")]
    bans: RawLcuBans,
    #[serde(default, deserialize_with = "null_to_default")]
    actions: Vec<Vec<RawLcuAction>>,
}

/// Ensures local TLS client ONLY ever contacts loopback HTTPS (`https://127.0.0.1`).
pub fn assert_loopback_url(raw_url: &str) -> AppResult<Url> {
    let parsed = Url::parse(raw_url).map_err(|e| AppError::SecurityPolicy(e.to_string()))?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("127.0.0.1") {
        return Err(AppError::SecurityPolicy(format!(
            "Loopback TLS client refused non-loopback or non-HTTPS URL: {}",
            parsed.as_str()
        )));
    }
    Ok(parsed)
}

/// Builds a loopback HTTPS client pinned strictly to Riot's X.509 v1 root certificate via native-tls.
pub fn build_loopback_client() -> AppResult<Client> {
    let cert = Certificate::from_pem(RIOT_ROOT_PEM)
        .map_err(|e| AppError::Lcu(format!("Failed to parse pinned Riot PEM certificate: {e}")))?;
    Client::builder()
        .use_native_tls()
        .tls_built_in_root_certs(false)
        .add_root_certificate(cert)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| AppError::Lcu(e.to_string()))
}

pub fn parse_lockfile(contents: &str) -> AppResult<LockfileCredentials> {
    let parts: Vec<&str> = contents.trim().split(':').collect();
    if parts.len() != 5 {
        return Err(AppError::Lcu(
            "Invalid LCU lockfile format (expected 5 colon-separated fields)".to_string(),
        ));
    }
    let pid = parts[1]
        .parse::<u32>()
        .map_err(|e| AppError::Lcu(format!("Invalid lockfile PID: {e}")))?;
    let port = parts[2]
        .parse::<u16>()
        .map_err(|e| AppError::Lcu(format!("Invalid lockfile port: {e}")))?;

    Ok(LockfileCredentials {
        process_name: parts[0].to_string(),
        pid,
        port,
        password: parts[3].to_string(),
        protocol: parts[4].to_string(),
    })
}

pub fn discover_lockfile(configured_install_dir: &str) -> Option<LockfileCredentials> {
    let mut candidates = Vec::new();
    if !configured_install_dir.trim().is_empty() {
        candidates.push(Path::new(configured_install_dir).join("lockfile"));
    }
    candidates.push(PathBuf::from(r"C:\Riot Games\League of Legends\lockfile"));
    candidates.push(PathBuf::from(r"D:\Riot Games\League of Legends\lockfile"));

    for path in candidates {
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(creds) = parse_lockfile(&content) {
                return Some(creds);
            }
        }
    }
    None
}

fn auth_header(creds: &LockfileCredentials) -> String {
    let token = STANDARD.encode(format!("riot:{}", creds.password));
    format!("Basic {token}")
}

/// Enforces Riot's Ranked Solo/Duo Champ Select anonymity mandate at the backend boundary.
pub fn sanitize_champ_select(
    mut session: SanitizedChampSelectSession,
) -> SanitizedChampSelectSession {
    if session.is_ranked_solo_duo {
        for (idx, slot) in session.my_team.iter_mut().enumerate() {
            if !slot.is_local_player && !slot.is_party_member {
                slot.display_name = format!("Ally {}", idx + 1);
            }
        }
        for (idx, slot) in session.their_team.iter_mut().enumerate() {
            slot.display_name = format!("Enemy {}", idx + 1);
        }
    }
    session
}

fn map_role(pos: &str) -> &'static str {
    match pos.to_lowercase().as_str() {
        "top" => "top",
        "jungle" => "jungle",
        "middle" | "mid" => "middle",
        "bottom" | "bot" => "bottom",
        "utility" | "support" => "utility",
        _ => "unknown",
    }
}

fn slot_label(s: &RawLcuSlot, fallback: String) -> String {
    if !s.game_name.trim().is_empty() {
        if s.tag_line.trim().is_empty() {
            s.game_name.trim().to_string()
        } else {
            format!("{}#{}", s.game_name.trim(), s.tag_line.trim())
        }
    } else if !s.display_name.trim().is_empty() {
        s.display_name.trim().to_string()
    } else {
        fallback
    }
}

fn parse_raw_champ_select_session(
    raw: RawLcuSession,
    queue_id: i64,
    party_summoner_ids: &HashSet<i64>,
) -> SanitizedChampSelectSession {
    let map_side = raw
        .my_team
        .first()
        .map(|s| if s.team == 2 { "red" } else { "blue" })
        .unwrap_or("blue")
        .to_string();

    let mut completed_picks: HashSet<i64> = HashSet::new();
    let mut action_ally_bans: Vec<i64> = Vec::new();
    let mut action_enemy_bans: Vec<i64> = Vec::new();

    for round in &raw.actions {
        for act in round {
            if act.completed && act.action_type == "pick" && act.champion_id > 0 {
                completed_picks.insert(act.actor_cell_id);
            } else if act.completed && act.action_type == "ban" && act.champion_id > 0 {
                if act.is_ally_action {
                    if !action_ally_bans.contains(&act.champion_id) {
                        action_ally_bans.push(act.champion_id);
                    }
                } else if !action_enemy_bans.contains(&act.champion_id) {
                    action_enemy_bans.push(act.champion_id);
                }
            }
        }
    }

    let ally_bans = if raw.bans.my_team_bans.is_empty() {
        action_ally_bans
    } else {
        raw.bans
            .my_team_bans
            .into_iter()
            .filter(|&id| id > 0)
            .collect()
    };
    let enemy_bans = if raw.bans.their_team_bans.is_empty() {
        action_enemy_bans
    } else {
        raw.bans
            .their_team_bans
            .into_iter()
            .filter(|&id| id > 0)
            .collect()
    };

    let my_team = raw
        .my_team
        .into_iter()
        .enumerate()
        .map(|(idx, s)| {
            let is_local = s.cell_id == raw.local_player_cell_id;
            let is_party = s.summoner_id > 0 && party_summoner_ids.contains(&s.summoner_id);
            let champ_id = if s.champion_id > 0 {
                s.champion_id
            } else {
                s.champion_pick_intent
            };
            let is_completed = s.champion_id > 0 && completed_picks.contains(&s.cell_id);
            let default_label = if is_local {
                "You".to_string()
            } else {
                format!("Ally {}", idx + 1)
            };

            ChampSelectPlayerSlot {
                cell_id: s.cell_id,
                team: "ally".to_string(),
                display_name: slot_label(&s, default_label),
                champion_id: champ_id,
                assigned_position: map_role(&s.assigned_position).to_string(),
                spell1_id: s.spell1_id,
                spell2_id: s.spell2_id,
                is_local_player: is_local,
                is_party_member: is_party,
                completed: is_completed,
            }
        })
        .collect();

    let their_team = raw
        .their_team
        .into_iter()
        .enumerate()
        .map(|(idx, s)| {
            let is_completed = s.champion_id > 0
                && (completed_picks.contains(&s.cell_id) || completed_picks.is_empty());
            ChampSelectPlayerSlot {
                cell_id: s.cell_id,
                team: "enemy".to_string(),
                display_name: slot_label(&s, format!("Enemy {}", idx + 1)),
                champion_id: s.champion_id,
                assigned_position: map_role(&s.assigned_position).to_string(),
                spell1_id: s.spell1_id,
                spell2_id: s.spell2_id,
                is_local_player: false,
                is_party_member: false,
                completed: is_completed,
            }
        })
        .collect();

    sanitize_champ_select(SanitizedChampSelectSession {
        queue_id,
        is_ranked_solo_duo: queue_id == 420,
        local_player_cell_id: raw.local_player_cell_id,
        my_team,
        their_team,
        ally_bans,
        enemy_bans,
        map_side,
    })
}

async fn fetch_queue_id_and_party(
    client: &Client,
    creds: &LockfileCredentials,
    auth: &str,
) -> (i64, HashSet<i64>) {
    let mut queue_id = 420;
    if let Ok(url) = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-gameflow/v1/session",
        creds.protocol, creds.port
    )) {
        if let Ok(resp) = client.get(url).header("Authorization", auth).send().await {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(q) = val.pointer("/gameData/queue/id").and_then(|v| v.as_i64()) {
                        queue_id = q;
                    }
                }
            }
        }
    }

    let mut party_ids = HashSet::new();
    if let Ok(url) = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-lobby/v2/lobby",
        creds.protocol, creds.port
    )) {
        if let Ok(resp) = client.get(url).header("Authorization", auth).send().await {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(members) = val.get("members").and_then(|m| m.as_array()) {
                        for m in members {
                            if let Some(id) = m.get("summonerId").and_then(|v| v.as_i64()) {
                                if id > 0 {
                                    party_ids.insert(id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (queue_id, party_ids)
}

pub async fn fetch_gameflow_queue_id(client: &Client, creds: &LockfileCredentials) -> Option<i64> {
    let auth = auth_header(creds);
    let url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-gameflow/v1/session",
        creds.protocol, creds.port
    ))
    .ok()?;
    let resp = client
        .get(url)
        .header("Authorization", &auth)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let val: serde_json::Value = resp.json().await.ok()?;
    val.pointer("/gameData/queue/id").and_then(|v| v.as_i64())
}

pub async fn fetch_champ_select_session(
    client: &Client,
    creds: &LockfileCredentials,
) -> AppResult<Option<SanitizedChampSelectSession>> {
    let auth = auth_header(creds);
    let url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-champ-select/v1/session",
        creds.protocol, creds.port
    ))?;

    let res = client
        .get(url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))?;

    if res.status().as_u16() == 404 {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(AppError::Lcu(format!(
            "LCU champ-select HTTP {}",
            res.status()
        )));
    }

    let raw: RawLcuSession = res.json().await.map_err(|e| AppError::Lcu(e.to_string()))?;
    let (queue_id, party_ids) = fetch_queue_id_and_party(client, creds, &auth).await;
    Ok(Some(parse_raw_champ_select_session(
        raw, queue_id, &party_ids,
    )))
}

/// Polls `/lol-gameflow/v1/gameflow-phase` over pinned loopback TLS.
pub async fn fetch_gameflow_phase(
    client: &Client,
    creds: &LockfileCredentials,
) -> AppResult<String> {
    let auth = auth_header(creds);
    let url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-gameflow/v1/gameflow-phase",
        creds.protocol, creds.port
    ))?;

    let res = client
        .get(url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))?;

    if !res.status().is_success() {
        return Err(AppError::Lcu(format!(
            "LCU gameflow-phase HTTP {}",
            res.status()
        )));
    }

    res.json::<String>()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))
}

/// Reads the local player's summoner & ranked profile from LCU without requiring a Riot API key.
pub async fn fetch_lcu_profile(
    client: &Client,
    creds: &LockfileCredentials,
    region: &str,
) -> AppResult<SummonerProfileSummary> {
    let platform = parse_platform(region)?;
    let auth = auth_header(creds);
    let summoner_url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-summoner/v1/current-summoner",
        creds.protocol, creds.port
    ))?;
    let s_res = client
        .get(summoner_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))?;
    if !s_res.status().is_success() {
        return Err(AppError::Lcu(format!(
            "LCU current-summoner HTTP {}",
            s_res.status()
        )));
    }
    let s_val: serde_json::Value = s_res
        .json()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))?;

    let game_name = s_val["gameName"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| s_val["displayName"].as_str())
        .unwrap_or("Summoner");
    let tag_line = s_val["tagLine"].as_str().unwrap_or("LCU");
    let riot_id = if game_name.contains('#') {
        game_name.to_string()
    } else {
        format!("{game_name}#{tag_line}")
    };
    let puuid = s_val["puuid"].as_str().unwrap_or_default().to_string();
    let summoner_level = s_val["summonerLevel"].as_u64().unwrap_or(1);

    let ranked_url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-ranked/v1/current-ranked-stats",
        creds.protocol, creds.port
    ))?;
    let mut tier = "UNRANKED".to_string();
    let mut rank = String::new();
    let mut league_points = 0;
    let mut wins = 0;
    let mut losses = 0;

    if let Ok(r_res) = client
        .get(ranked_url)
        .header("Authorization", &auth)
        .send()
        .await
    {
        if r_res.status().is_success() {
            if let Ok(r_val) = r_res.json::<serde_json::Value>().await {
                let solo = &r_val["queueMap"]["RANKED_SOLO_5x5"];
                if let Some(t) = solo["tier"]
                    .as_str()
                    .filter(|s| !s.is_empty() && *s != "NONE")
                {
                    tier = t.to_string();
                    rank = solo["division"].as_str().unwrap_or("").to_string();
                    league_points = solo["leaguePoints"].as_i64().unwrap_or(0) as i32;
                    wins = solo["wins"].as_i64().unwrap_or(0) as i32;
                    losses = solo["losses"].as_i64().unwrap_or(0) as i32;
                }
            }
        }
    }

    Ok(SummonerProfileSummary {
        riot_id,
        puuid,
        region: platform.as_code().to_string(),
        summoner_level,
        tier,
        rank,
        league_points,
        wins,
        losses,
        top_mastery_champion_ids: vec![],
    })
}

/// Explicitly user-triggered 1-click Rune Page & Summoner Spell import via LCU.
/// Never auto-picks, auto-bans, or accepts queues.
pub async fn apply_runes_and_spells(
    client: &Client,
    creds: &LockfileCredentials,
    runes: &RunePageSpec,
    spell1_id: u32,
    spell2_id: u32,
) -> AppResult<String> {
    let auth = auth_header(creds);

    let pages_url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-perks/v1/pages",
        creds.protocol, creds.port
    ))?;

    let mut existing_bj_page_id: Option<i64> = None;
    if let Ok(resp) = client
        .get(pages_url.clone())
        .header("Authorization", &auth)
        .send()
        .await
    {
        if let Ok(pages) = resp.json::<Vec<serde_json::Value>>().await {
            for page in pages {
                let name = page.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let is_deletable = page
                    .get("isDeletable")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if is_deletable && name.starts_with("BetterJungler:") {
                    if let Some(id) = page.get("id").and_then(|v| v.as_i64()) {
                        if existing_bj_page_id.is_none() {
                            existing_bj_page_id = Some(id);
                        } else {
                            let del_url = assert_loopback_url(&format!(
                                "{}://127.0.0.1:{}/lol-perks/v1/pages/{}",
                                creds.protocol, creds.port, id
                            ))?;
                            let _ = client
                                .delete(del_url)
                                .header("Authorization", &auth)
                                .send()
                                .await;
                        }
                    }
                }
            }
        }
    }

    let payload = serde_json::json!({
        "name": runes.name,
        "primaryStyleId": runes.primary_style_id,
        "subStyleId": runes.sub_style_id,
        "selectedPerkIds": runes.selected_perk_ids,
        "current": true
    });

    // Update existing BetterJungler page in-place when available so full rune slots never block updates
    let rune_res = if let Some(page_id) = existing_bj_page_id {
        let put_url = assert_loopback_url(&format!(
            "{}://127.0.0.1:{}/lol-perks/v1/pages/{}",
            creds.protocol, creds.port, page_id
        ))?;
        client
            .put(put_url)
            .header("Authorization", &auth)
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Lcu(e.to_string()))?
    } else {
        client
            .post(pages_url)
            .header("Authorization", &auth)
            .json(&payload)
            .send()
            .await
            .map_err(|e| AppError::Lcu(e.to_string()))?
    };

    if !rune_res.status().is_success() {
        return Err(AppError::Lcu(format!(
            "Failed to save rune page (HTTP {}). Free one custom rune slot or delete an unused page in League Client.",
            rune_res.status()
        )));
    }

    let spells_url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-champ-select/v1/session/my-selection",
        creds.protocol, creds.port
    ))?;
    let spell_payload = serde_json::json!({
        "spell1Id": spell1_id,
        "spell2Id": spell2_id
    });
    let spell_res = client
        .patch(spells_url)
        .header("Authorization", &auth)
        .json(&spell_payload)
        .send()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))?;

    if spell_res.status().is_success() {
        Ok(format!(
            "Applied \"{}\" and Summoner Spells to League Client.",
            runes.name
        ))
    } else if spell_res.status().as_u16() == 404 {
        Ok(format!(
            "Saved rune page \"{}\" (Summoner Spells apply once inside Champ Select).",
            runes.name
        ))
    } else {
        Err(AppError::Lcu(format!(
            "Rune page \"{}\" saved, but Summoner Spells returned HTTP {}.",
            runes.name,
            spell_res.status()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_loopback_client_with_pinned_riot_cert() {
        assert!(build_loopback_client().is_ok());
    }

    #[test]
    fn parses_valid_lcu_lockfile() {
        let creds = parse_lockfile("LeagueClient:12345:54321:secretPass:https").unwrap();
        assert_eq!(creds.process_name, "LeagueClient");
        assert_eq!(creds.pid, 12345);
        assert_eq!(creds.port, 54321);
        assert_eq!(creds.password, "secretPass");
        assert_eq!(creds.protocol, "https");
    }

    #[test]
    fn rejects_non_loopback_or_http_url_for_local_tls_client() {
        assert!(assert_loopback_url("https://127.0.0.1:2999/liveclientdata/allgamedata").is_ok());
        assert!(assert_loopback_url("http://127.0.0.1:2999/liveclientdata/allgamedata").is_err());
        assert!(assert_loopback_url("https://euw1.api.riotgames.com/lol/status").is_err());
    }

    #[test]
    fn parses_bans_completed_actions_null_fields_and_party_in_raw_lcu_session() {
        let raw: RawLcuSession = serde_json::from_value(serde_json::json!({
            "localPlayerCellId": 0,
            "myTeam": [
                { "cellId": 0, "championId": 234, "assignedPosition": "jungle", "summonerId": 1001, "gameName": "Me", "tagLine": "EUW", "team": 1 },
                { "cellId": 1, "championId": 86, "assignedPosition": "top", "summonerId": 1002, "gameName": "DuoMate", "tagLine": "EUW", "team": 1 },
                { "cellId": 2, "championId": 0, "championPickIntent": 103, "assignedPosition": null, "displayName": null, "gameName": null, "tagLine": null, "summonerId": 1003, "team": 1 }
            ],
            "theirTeam": [
                { "cellId": 5, "championId": 64, "assignedPosition": "jungle", "summonerId": null, "gameName": null, "tagLine": null, "team": 2 }
            ],
            "bans": { "myTeamBans": [121], "theirTeamBans": [254] },
            "actions": [[
                { "actorCellId": 0, "championId": 234, "type": "pick", "completed": true, "isAllyAction": true },
                { "actorCellId": 1, "championId": 86, "type": "pick", "completed": false, "isAllyAction": true },
                { "actorCellId": 5, "championId": 64, "type": "pick", "completed": true, "isAllyAction": false }
            ]]
        }))
        .unwrap();

        let mut party = HashSet::new();
        party.insert(1002);

        let session = parse_raw_champ_select_session(raw, 420, &party);
        assert_eq!(session.ally_bans, vec![121]);
        assert_eq!(session.enemy_bans, vec![254]);
        assert!(session.my_team[0].completed);
        assert!(!session.my_team[1].completed);
        assert_eq!(session.my_team[1].display_name, "DuoMate#EUW");
        assert_eq!(session.my_team[2].champion_id, 103);
        assert_eq!(session.my_team[2].assigned_position, "unknown");
        assert_eq!(session.my_team[2].display_name, "Ally 3");
        assert_eq!(session.their_team[0].display_name, "Enemy 1");
    }

    #[test]
    fn enforces_solo_duo_anonymity_masking() {
        let session = SanitizedChampSelectSession {
            queue_id: 420,
            is_ranked_solo_duo: true,
            local_player_cell_id: 0,
            map_side: "blue".to_string(),
            ally_bans: vec![],
            enemy_bans: vec![],
            my_team: vec![
                ChampSelectPlayerSlot {
                    cell_id: 0,
                    team: "ally".to_string(),
                    display_name: "MyRealName".to_string(),
                    champion_id: 234,
                    assigned_position: "jungle".to_string(),
                    spell1_id: 11,
                    spell2_id: 4,
                    is_local_player: true,
                    is_party_member: false,
                    completed: true,
                },
                ChampSelectPlayerSlot {
                    cell_id: 1,
                    team: "ally".to_string(),
                    display_name: "RandomTeammate".to_string(),
                    champion_id: 58,
                    assigned_position: "top".to_string(),
                    spell1_id: 4,
                    spell2_id: 12,
                    is_local_player: false,
                    is_party_member: false,
                    completed: true,
                },
            ],
            their_team: vec![ChampSelectPlayerSlot {
                cell_id: 5,
                team: "enemy".to_string(),
                display_name: "EnemyRealName".to_string(),
                champion_id: 64,
                assigned_position: "jungle".to_string(),
                spell1_id: 11,
                spell2_id: 4,
                is_local_player: false,
                is_party_member: false,
                completed: true,
            }],
        };

        let sanitized = sanitize_champ_select(session);
        assert_eq!(sanitized.my_team[0].display_name, "MyRealName");
        assert_eq!(sanitized.my_team[1].display_name, "Ally 2");
        assert_eq!(sanitized.their_team[0].display_name, "Enemy 1");
    }
}
