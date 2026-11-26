use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone)]
pub struct LockfileCredentials {
    pub process_name: String,
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
    #[serde(default)]
    champion_id: i64,
    #[serde(default)]
    assigned_position: String,
    #[serde(default)]
    spell1_id: i64,
    #[serde(default)]
    spell2_id: i64,
    #[serde(default)]
    team: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawLcuSession {
    #[serde(default)]
    local_player_cell_id: i64,
    #[serde(default)]
    my_team: Vec<RawLcuSlot>,
    #[serde(default)]
    their_team: Vec<RawLcuSlot>,
}

/// Ensures local self-signed TLS client ONLY ever contacts 127.0.0.1 loopback.
pub fn assert_loopback_url(raw_url: &str) -> AppResult<Url> {
    let parsed = Url::parse(raw_url).map_err(|e| AppError::SecurityPolicy(e.to_string()))?;
    if parsed.host_str() != Some("127.0.0.1") {
        return Err(AppError::SecurityPolicy(format!(
            "Loopback TLS client refused non-loopback host: {:?}",
            parsed.host_str()
        )));
    }
    Ok(parsed)
}

pub fn build_loopback_client() -> AppResult<Client> {
    Client::builder()
        .danger_accept_invalid_certs(true)
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

pub async fn fetch_champ_select_session(
    client: &Client,
    creds: &LockfileCredentials,
) -> AppResult<Option<SanitizedChampSelectSession>> {
    let url_str = format!(
        "{}://127.0.0.1:{}/lol-champ-select/v1/session",
        creds.protocol, creds.port
    );
    let url = assert_loopback_url(&url_str)?;

    let res = client
        .get(url)
        .header("Authorization", auth_header(creds))
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
    let map_side = raw
        .my_team
        .first()
        .map(|s| if s.team == 2 { "red" } else { "blue" })
        .unwrap_or("blue")
        .to_string();

    let map_role = |pos: &str| match pos.to_lowercase().as_str() {
        "top" => "top",
        "jungle" => "jungle",
        "middle" | "mid" => "middle",
        "bottom" | "bot" => "bottom",
        "utility" | "support" => "utility",
        _ => "unknown",
    };

    let my_team = raw
        .my_team
        .into_iter()
        .enumerate()
        .map(|(idx, s)| {
            let is_local = s.cell_id == raw.local_player_cell_id;
            ChampSelectPlayerSlot {
                cell_id: s.cell_id,
                team: "ally".to_string(),
                display_name: if is_local {
                    "You".to_string()
                } else {
                    format!("Ally {}", idx + 1)
                },
                champion_id: s.champion_id,
                assigned_position: map_role(&s.assigned_position).to_string(),
                spell1_id: s.spell1_id,
                spell2_id: s.spell2_id,
                is_local_player: is_local,
                is_party_member: false,
                completed: s.champion_id > 0,
            }
        })
        .collect();

    let their_team = raw
        .their_team
        .into_iter()
        .enumerate()
        .map(|(idx, s)| ChampSelectPlayerSlot {
            cell_id: s.cell_id,
            team: "enemy".to_string(),
            display_name: format!("Enemy {}", idx + 1),
            champion_id: s.champion_id,
            assigned_position: map_role(&s.assigned_position).to_string(),
            spell1_id: s.spell1_id,
            spell2_id: s.spell2_id,
            is_local_player: false,
            is_party_member: false,
            completed: s.champion_id > 0,
        })
        .collect();

    Ok(Some(sanitize_champ_select(SanitizedChampSelectSession {
        queue_id: 420,
        is_ranked_solo_duo: true,
        local_player_cell_id: raw.local_player_cell_id,
        my_team,
        their_team,
        ally_bans: vec![],
        enemy_bans: vec![],
        map_side,
    })))
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

    // 1. Delete existing BetterJungler managed rune page if present
    let pages_url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-perks/v1/pages",
        creds.protocol, creds.port
    ))?;
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

    // 2. Create new rune page
    let payload = serde_json::json!({
        "name": runes.name,
        "primaryStyleId": runes.primary_style_id,
        "subStyleId": runes.sub_style_id,
        "selectedPerkIds": runes.selected_perk_ids,
        "current": true
    });

    let create_res = client
        .post(pages_url)
        .header("Authorization", &auth)
        .json(&payload)
        .send()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))?;

    if !create_res.status().is_success() {
        return Err(AppError::Lcu(format!(
            "Failed to create rune page (HTTP {}). Ensure you have an open rune page slot.",
            create_res.status()
        )));
    }

    // 3. Apply Summoner Spells in Champ Select
    let spells_url = assert_loopback_url(&format!(
        "{}://127.0.0.1:{}/lol-champ-select/v1/session/my-selection",
        creds.protocol, creds.port
    ))?;
    let spell_payload = serde_json::json!({
        "spell1Id": spell1_id,
        "spell2Id": spell2_id
    });
    let _ = client
        .patch(spells_url)
        .header("Authorization", &auth)
        .json(&spell_payload)
        .send()
        .await;

    Ok(format!(
        "Applied \"{}\" and Summoner Spells to League Client.",
        runes.name
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn rejects_non_loopback_url_for_local_tls_client() {
        assert!(assert_loopback_url("https://127.0.0.1:2999/liveclientdata/allgamedata").is_ok());
        assert!(assert_loopback_url("https://euw1.api.riotgames.com/lol/status").is_err());
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
