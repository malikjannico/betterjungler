use std::time::Duration;

use reqwest::header::HeaderMap;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummonerProfileSummary {
    pub riot_id: String,
    pub puuid: String,
    pub region: String,
    pub summoner_level: u64,
    pub tier: String,
    pub rank: String,
    pub league_points: i32,
    pub wins: i32,
    pub losses: i32,
    pub top_mastery_champion_ids: Vec<i64>,
}

/// Builds a strict standard-TLS HTTP client for official Riot cloud APIs & Data Dragon.
pub fn build_riot_web_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::RiotApi(e.to_string()))
}

pub fn platform_to_regional_route(platform: &str) -> &'static str {
    match platform.to_uppercase().as_str() {
        "NA1" | "BR1" | "LA1" | "LA2" => "americas",
        "KR" | "JP1" => "asia",
        "OC1" | "PH2" | "SG2" | "TH2" | "TW2" | "VN2" => "sea",
        _ => "europe",
    }
}

pub fn parse_retry_after_seconds(headers: &HeaderMap) -> Option<u64> {
    headers
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

pub async fn fetch_latest_ddragon_patch(client: &Client) -> AppResult<String> {
    let versions: Vec<String> = client
        .get("https://ddragon.leagueoflegends.com/api/versions.json")
        .send()
        .await
        .map_err(|e| AppError::RiotApi(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::RiotApi(e.to_string()))?;

    versions
        .into_iter()
        .next()
        .ok_or_else(|| AppError::RiotApi("Empty Data Dragon versions list".to_string()))
}

pub async fn riot_get_json<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: &str,
    api_key: &str,
) -> AppResult<T> {
    let res = client
        .get(url)
        .header("X-Riot-Token", api_key)
        .send()
        .await
        .map_err(|e| AppError::RiotApi(e.to_string()))?;

    if res.status().as_u16() == 429 {
        let retry = parse_retry_after_seconds(res.headers()).unwrap_or(10);
        return Err(AppError::RiotApi(format!(
            "Riot API rate limit hit (429). Retry after {retry}s."
        )));
    }
    if res.status().as_u16() == 401 || res.status().as_u16() == 403 {
        return Err(AppError::RiotApi(
            "Riot API key rejected (401/403). Personal keys expire every 24h — refresh in Settings."
                .to_string(),
        ));
    }
    if !res.status().is_success() {
        return Err(AppError::RiotApi(format!(
            "Riot API request failed (HTTP {})",
            res.status()
        )));
    }

    res.json::<T>()
        .await
        .map_err(|e| AppError::RiotApi(e.to_string()))
}

#[derive(Deserialize)]
struct AccountDto {
    puuid: String,
    #[serde(rename = "gameName")]
    game_name: String,
    #[serde(rename = "tagLine")]
    tag_line: String,
}

#[derive(Deserialize)]
struct SummonerDto {
    id: String,
    #[serde(rename = "summonerLevel")]
    summoner_level: u64,
}

#[derive(Deserialize)]
struct LeagueEntryDto {
    #[serde(rename = "queueType")]
    queue_type: String,
    tier: String,
    rank: String,
    #[serde(rename = "leaguePoints")]
    league_points: i32,
    wins: i32,
    losses: i32,
}

#[derive(Deserialize)]
struct MasteryDto {
    #[serde(rename = "championId")]
    champion_id: i64,
}

pub async fn fetch_summoner_profile(
    client: &Client,
    api_key: &str,
    riot_id: &str,
    region: &str,
) -> AppResult<SummonerProfileSummary> {
    let (game_name, tag_line) = riot_id.split_once('#').ok_or_else(|| {
        AppError::RiotApi("Riot ID must be formatted as GameName#TagLine".to_string())
    })?;

    let regional = platform_to_regional_route(region);
    let platform = region.to_lowercase();

    let account_url = format!(
        "https://{regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}",
        urlencoding_segment(game_name),
        urlencoding_segment(tag_line)
    );
    let account: AccountDto = riot_get_json(client, &account_url, api_key).await?;

    let summoner_url = format!(
        "https://{platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{}",
        account.puuid
    );
    let summoner: SummonerDto = riot_get_json(client, &summoner_url, api_key).await?;

    let league_url = format!(
        "https://{platform}.api.riotgames.com/lol/league/v4/entries/by-summoner/{}",
        summoner.id
    );
    let entries: Vec<LeagueEntryDto> = riot_get_json(client, &league_url, api_key)
        .await
        .unwrap_or_default();

    let solo = entries
        .into_iter()
        .find(|e| e.queue_type == "RANKED_SOLO_5x5");

    let mastery_url = format!(
        "https://{platform}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{}/top?count=8",
        account.puuid
    );
    let masteries: Vec<MasteryDto> = riot_get_json(client, &mastery_url, api_key)
        .await
        .unwrap_or_default();

    Ok(SummonerProfileSummary {
        riot_id: format!("{}#{}", account.game_name, account.tag_line),
        puuid: account.puuid,
        region: region.to_uppercase(),
        summoner_level: summoner.summoner_level,
        tier: solo
            .as_ref()
            .map(|s| s.tier.clone())
            .unwrap_or_else(|| "UNRANKED".to_string()),
        rank: solo.as_ref().map(|s| s.rank.clone()).unwrap_or_default(),
        league_points: solo.as_ref().map(|s| s.league_points).unwrap_or(0),
        wins: solo.as_ref().map(|s| s.wins).unwrap_or(0),
        losses: solo.as_ref().map(|s| s.losses).unwrap_or(0),
        top_mastery_champion_ids: masteries.into_iter().map(|m| m.champion_id).collect(),
    })
}

fn urlencoding_segment(input: &str) -> String {
    input
        .trim()
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

pub async fn fetch_recent_ranked_match_ids(
    client: &Client,
    api_key: &str,
    puuid: &str,
    region: &str,
    count: usize,
) -> AppResult<Vec<String>> {
    let regional = platform_to_regional_route(region);
    let url = format!(
        "https://{regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count={}",
        count.clamp(1, 20)
    );
    riot_get_json(client, &url, api_key).await
}

pub async fn fetch_match_detail_and_timeline(
    client: &Client,
    api_key: &str,
    match_id: &str,
    puuid: &str,
    region: &str,
) -> AppResult<Value> {
    let regional = platform_to_regional_route(region);
    let match_url = format!("https://{regional}.api.riotgames.com/lol/match/v5/matches/{match_id}");
    let timeline_url =
        format!("https://{regional}.api.riotgames.com/lol/match/v5/matches/{match_id}/timeline");

    let match_json: Value = riot_get_json(client, &match_url, api_key).await?;
    let timeline_json: Value = riot_get_json(client, &timeline_url, api_key).await?;

    Ok(normalize_match_v5_detail(match_id, puuid, &match_json, &timeline_json))
}

pub fn normalize_match_v5_detail(
    match_id: &str,
    puuid: &str,
    match_json: &Value,
    timeline_json: &Value,
) -> Value {
    let info = &match_json["info"];
    let empty_vec = vec![];
    let participants = info["participants"].as_array().unwrap_or(&empty_vec);

    let player = participants
        .iter()
        .find(|p| p["puuid"].as_str() == Some(puuid))
        .or_else(|| participants.first());

    let player_pid = player
        .and_then(|p| p["participantId"].as_i64())
        .unwrap_or(1);
    let my_team_id = player.and_then(|p| p["teamId"].as_i64()).unwrap_or(100);

    let enemy_jg = participants.iter().find(|p| {
        p["teamId"].as_i64() != Some(my_team_id)
            && p["teamPosition"].as_str() == Some("JUNGLE")
    });
    let enemy_jg_pid = enemy_jg
        .and_then(|p| p["participantId"].as_i64())
        .unwrap_or(0);

    let team_kills: i64 = participants
        .iter()
        .filter(|p| p["teamId"].as_i64() == Some(my_team_id))
        .map(|p| p["kills"].as_i64().unwrap_or(0))
        .sum();

    let count_team_objectives = |team_id: i64| -> i64 {
        let teams = info["teams"].as_array().unwrap_or(&empty_vec);
        let team = teams.iter().find(|t| t["teamId"].as_i64() == Some(team_id));
        if let Some(t) = team {
            let objs = &t["objectives"];
            objs["dragon"]["kills"].as_i64().unwrap_or(0)
                + objs["baron"]["kills"].as_i64().unwrap_or(0)
                + objs["riftHerald"]["kills"].as_i64().unwrap_or(0)
                + objs["horde"]["kills"].as_i64().unwrap_or(0)
        } else {
            0
        }
    };

    let mut frames_out = Vec::new();
    let mut events_out = Vec::new();

    if let Some(frames) = timeline_json["info"]["frames"].as_array() {
        for (idx, frame) in frames.iter().enumerate() {
            let pf = &frame["participantFrames"];
            let p_key = player_pid.to_string();
            let e_key = enemy_jg_pid.to_string();
            let p_frame = &pf[&p_key];
            let e_frame = &pf[&e_key];

            if p_frame.is_object() {
                let cs = p_frame["minionsKilled"].as_i64().unwrap_or(0)
                    + p_frame["jungleMinionsKilled"].as_i64().unwrap_or(0);
                let e_cs = e_frame["minionsKilled"].as_i64().unwrap_or(0)
                    + e_frame["jungleMinionsKilled"].as_i64().unwrap_or(0);

                frames_out.push(json!({
                    "minute": idx,
                    "position": {
                        "x": p_frame["position"]["x"].as_i64().unwrap_or(7435),
                        "y": p_frame["position"]["y"].as_i64().unwrap_or(7435)
                    },
                    "totalGold": p_frame["totalGold"].as_i64().unwrap_or(0),
                    "xp": p_frame["xp"].as_i64().unwrap_or(0),
                    "cs": cs,
                    "enemyJunglerGold": e_frame["totalGold"].as_i64().unwrap_or(0),
                    "enemyJunglerXp": e_frame["xp"].as_i64().unwrap_or(0),
                    "enemyJunglerCs": e_cs
                }));
            }

            if let Some(ev_arr) = frame["events"].as_array() {
                for ev in ev_arr {
                    let ev_type = ev["type"].as_str().unwrap_or("");
                    if matches!(
                        ev_type,
                        "CHAMPION_KILL"
                            | "WARD_PLACED"
                            | "WARD_KILL"
                            | "ELITE_MONSTER_KILL"
                            | "ITEM_PURCHASED"
                    ) {
                        let ts_sec = ev["timestamp"].as_i64().unwrap_or(0) / 1000;
                        events_out.push(json!({
                            "type": ev_type,
                            "timestampSec": ts_sec,
                            "position": ev.get("position").cloned(),
                            "killerId": ev.get("killerId").and_then(|v| v.as_i64()),
                            "victimId": ev.get("victimId").and_then(|v| v.as_i64()),
                            "assistingParticipantIds": ev.get("assistingParticipantIds").cloned(),
                            "creatorId": ev.get("creatorId").and_then(|v| v.as_i64()),
                            "wardType": ev.get("wardType").and_then(|v| v.as_str()),
                            "monsterType": ev.get("monsterType").and_then(|v| v.as_str()),
                            "killerTeamId": ev.get("killerTeamId").and_then(|v| v.as_i64()),
                            "itemId": ev.get("itemId").and_then(|v| v.as_i64())
                        }));
                    }
                }
            }
        }
    }

    let ts_ms = info["gameCreation"].as_i64().unwrap_or(0);
    let played_at = chrono::DateTime::from_timestamp_millis(ts_ms)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

    let items: Vec<i64> = (0..=6)
        .filter_map(|slot| player.and_then(|p| p[format!("item{slot}")].as_i64()))
        .filter(|&id| id > 0)
        .collect();

    let cs_total = player
        .map(|p| {
            p["totalMinionsKilled"].as_i64().unwrap_or(0)
                + p["neutralMinionsKilled"].as_i64().unwrap_or(0)
        })
        .unwrap_or(0);

    json!({
        "matchId": match_id,
        "playedAt": played_at,
        "durationSeconds": info["gameDuration"].as_i64().unwrap_or(1800),
        "patch": info["gameVersion"].as_str().unwrap_or("16.1"),
        "queueId": info["queueId"].as_i64().unwrap_or(420),
        "win": player.and_then(|p| p["win"].as_bool()).unwrap_or(false),
        "mapSide": if my_team_id == 200 { "red" } else { "blue" },
        "playerParticipantId": player_pid,
        "championId": player.and_then(|p| p["championId"].as_i64()).unwrap_or(0),
        "championName": player.and_then(|p| p["championName"].as_str()).unwrap_or("Jungler"),
        "enemyJunglerChampionId": enemy_jg.and_then(|p| p["championId"].as_i64()).unwrap_or(0),
        "enemyJunglerName": enemy_jg.and_then(|p| p["championName"].as_str()).unwrap_or("Enemy Jungler"),
        "kills": player.and_then(|p| p["kills"].as_i64()).unwrap_or(0),
        "deaths": player.and_then(|p| p["deaths"].as_i64()).unwrap_or(0),
        "assists": player.and_then(|p| p["assists"].as_i64()).unwrap_or(0),
        "cs": cs_total,
        "visionScore": player.and_then(|p| p["visionScore"].as_i64()).unwrap_or(0),
        "controlWardsBought": player.and_then(|p| p["visionWardsBoughtInGame"].as_i64()).unwrap_or(0),
        "teamKills": team_kills,
        "teamObjectives": count_team_objectives(my_team_id),
        "enemyObjectives": count_team_objectives(if my_team_id == 100 { 200 } else { 100 }),
        "items": items,
        "frames": frames_out,
        "events": events_out
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn maps_platform_to_regional_routes() {
        assert_eq!(platform_to_regional_route("EUW1"), "europe");
        assert_eq!(platform_to_regional_route("NA1"), "americas");
        assert_eq!(platform_to_regional_route("KR"), "asia");
        assert_eq!(platform_to_regional_route("OC1"), "sea");
    }

    #[test]
    fn parses_retry_after_header() {
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", HeaderValue::from_static("15"));
        assert_eq!(parse_retry_after_seconds(&headers), Some(15));
    }
}
