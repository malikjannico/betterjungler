use std::collections::HashMap;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::rate_limiter::RiotRateLimiter;
use crate::riot_api::{
    parse_platform, riot_get_json, urlencoding_segment, validate_match_id, RiotAuth,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighEloChampStat {
    pub champion_id: i64,
    pub games: usize,
    pub wins: usize,
    pub win_rate: f64,
    pub top_item_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighEloMetaSnapshot {
    pub patch: String,
    pub region: String,
    pub sample_matches: usize,
    pub updated_at: String,
    pub champions: Vec<HighEloChampStat>,
}

#[derive(Deserialize)]
struct ChallengerEntry {
    puuid: Option<String>,
}

#[derive(Deserialize)]
struct ChallengerLeagueDto {
    entries: Vec<ChallengerEntry>,
}

#[derive(Default)]
struct ChampAgg {
    games: usize,
    wins: usize,
    item_counts: HashMap<i64, usize>,
}

fn patch_major_minor(patch: &str) -> Option<String> {
    let mut parts = patch.trim().split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    Some(format!("{major}.{minor}"))
}

pub fn aggregate_jungle_samples(
    match_payloads: &[Value],
    patch: &str,
    region: &str,
) -> HighEloMetaSnapshot {
    let target_prefix = patch_major_minor(patch);
    let filtered_matches: Vec<&Value> = match_payloads
        .iter()
        .filter(
            |m| match (&target_prefix, m["info"]["gameVersion"].as_str()) {
                (Some(target), Some(ver)) => {
                    patch_major_minor(ver).as_deref() == Some(target.as_str())
                }
                _ => true,
            },
        )
        .collect();

    let mut agg: HashMap<i64, ChampAgg> = HashMap::new();

    for match_json in &filtered_matches {
        if let Some(participants) = match_json["info"]["participants"].as_array() {
            for p in participants {
                if p["teamPosition"].as_str() != Some("JUNGLE") {
                    continue;
                }
                let champ_id = p["championId"].as_i64().unwrap_or(0);
                if champ_id <= 0 {
                    continue;
                }
                let win = p["win"].as_bool().unwrap_or(false);
                let entry = agg.entry(champ_id).or_default();
                entry.games += 1;
                if win {
                    entry.wins += 1;
                }
                for slot in 0..=5 {
                    let item_id = p[format!("item{slot}")].as_i64().unwrap_or(0);
                    if item_id > 1000 {
                        *entry.item_counts.entry(item_id).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    let mut champions: Vec<HighEloChampStat> = agg
        .into_iter()
        .map(|(champion_id, data)| {
            let mut items: Vec<(i64, usize)> = data.item_counts.into_iter().collect();
            items.sort_by_key(|&(_, count)| std::cmp::Reverse(count));
            let top_item_ids = items.into_iter().take(4).map(|(id, _)| id).collect();
            let win_rate = ((data.wins as f64 / data.games as f64) * 1000.0).round() / 10.0;
            HighEloChampStat {
                champion_id,
                games: data.games,
                wins: data.wins,
                win_rate,
                top_item_ids,
            }
        })
        .collect();

    champions.sort_by(|a, b| {
        b.games
            .cmp(&a.games)
            .then_with(|| b.win_rate.total_cmp(&a.win_rate))
    });

    HighEloMetaSnapshot {
        patch: patch.to_string(),
        region: region.to_uppercase(),
        sample_matches: filtered_matches.len(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        champions,
    }
}

/// Rate-limit-safe Challenger ladder sampler using official Riot League-V4 (puuid) + Match-V5.
/// Paces requests through RiotRateLimiter and stops cleanly if RateLimited is hit.
pub async fn sample_high_elo_jungle_meta(
    client: &Client,
    limiter: &RiotRateLimiter,
    auth: &RiotAuth,
    region: &str,
    patch: &str,
    max_matches: usize,
) -> AppResult<HighEloMetaSnapshot> {
    let platform = parse_platform(region)?;
    let host = platform.as_host();
    let regional = platform.match_regional_route();
    let target_matches = max_matches.clamp(3, 12);

    let league_url = format!(
        "https://{host}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5"
    );
    let league: ChallengerLeagueDto =
        riot_get_json(client, limiter, "league-v4-challenger", &league_url, auth).await?;

    let puuids: Vec<String> = league
        .entries
        .into_iter()
        .filter_map(|e| e.puuid)
        .filter(|p| !p.trim().is_empty())
        .take(5)
        .collect();

    let mut match_ids: Vec<String> = Vec::new();
    for puuid in puuids {
        if match_ids.len() >= target_matches {
            break;
        }
        let encoded = urlencoding_segment(&puuid);
        let ids_url = format!(
            "https://{regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/{encoded}/ids?queue=420&start=0&count=3"
        );
        match riot_get_json::<Vec<String>>(client, limiter, "match-v5-ids", &ids_url, auth).await {
            Ok(ids) => {
                for id in ids {
                    if !match_ids.contains(&id) {
                        match_ids.push(id);
                    }
                }
            }
            Err(AppError::RateLimited { .. }) => break,
            Err(_) => continue,
        }
        tokio::time::sleep(Duration::from_millis(80)).await;
    }

    let mut payloads: Vec<Value> = Vec::new();
    for match_id in match_ids.into_iter().take(target_matches) {
        let Ok(safe_id) = validate_match_id(&match_id) else {
            continue;
        };
        let url = format!("https://{regional}.api.riotgames.com/lol/match/v5/matches/{safe_id}");
        match riot_get_json::<Value>(client, limiter, "match-v5-detail", &url, auth).await {
            Ok(val) => payloads.push(val),
            Err(AppError::RateLimited { .. }) => break,
            Err(_) => continue,
        }
    }

    Ok(aggregate_jungle_samples(
        &payloads,
        patch,
        platform.as_code(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn aggregates_jungle_samples_into_meta_snapshot_and_filters_patch() {
        let m1 = json!({
            "info": {
                "gameVersion": "16.23.450.1",
                "participants": [
                    { "teamPosition": "JUNGLE", "championId": 234, "win": true, "item0": 6672, "item1": 6610 },
                    { "teamPosition": "JUNGLE", "championId": 59, "win": false, "item0": 6692, "item1": 6610 },
                    { "teamPosition": "TOP", "championId": 266, "win": true, "item0": 6692 }
                ]
            }
        });
        let m2_old_patch = json!({
            "info": {
                "gameVersion": "16.22.100.1",
                "participants": [
                    { "teamPosition": "JUNGLE", "championId": 32, "win": false, "item0": 6653 }
                ]
            }
        });

        let snap = aggregate_jungle_samples(&[m1, m2_old_patch], "16.23.1", "EUW1");
        assert_eq!(snap.sample_matches, 1);
        assert!(snap.champions.iter().all(|c| c.champion_id != 32));
        let viego = snap
            .champions
            .iter()
            .find(|c| c.champion_id == 234)
            .unwrap();
        assert_eq!(viego.games, 1);
        assert_eq!(viego.wins, 1);
        assert_eq!(viego.win_rate, 100.0);
        assert!(viego.top_item_ids.contains(&6672));
    }
}
