use std::collections::HashMap;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppResult;
use crate::riot_api::{platform_to_regional_route, riot_get_json};

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
    #[serde(rename = "summonerId")]
    summoner_id: Option<String>,
    puuid: Option<String>,
}

#[derive(Deserialize)]
struct ChallengerLeagueDto {
    entries: Vec<ChallengerEntry>,
}

#[derive(Deserialize)]
struct SummonerPuuidDto {
    puuid: String,
}

#[derive(Default)]
struct ChampAgg {
    games: usize,
    wins: usize,
    item_counts: HashMap<i64, usize>,
}

pub fn aggregate_jungle_samples(
    match_payloads: &[Value],
    patch: &str,
    region: &str,
) -> HighEloMetaSnapshot {
    let mut agg: HashMap<i64, ChampAgg> = HashMap::new();

    for match_json in match_payloads {
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
            items.sort_by(|a, b| b.1.cmp(&a.1));
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

    champions.sort_by(|a, b| b.games.cmp(&a.games).then_with(|| b.win_rate.total_cmp(&a.win_rate)));

    HighEloMetaSnapshot {
        patch: patch.to_string(),
        region: region.to_uppercase(),
        sample_matches: match_payloads.len(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        champions,
    }
}

/// Rate-limit-safe Challenger ladder sampler using official Riot League-V4 + Match-V5.
/// Paces requests conservatively and stops gracefully if a 429 rate limit occurs.
pub async fn sample_high_elo_jungle_meta(
    client: &Client,
    api_key: &str,
    region: &str,
    patch: &str,
    max_matches: usize,
) -> AppResult<HighEloMetaSnapshot> {
    let platform = region.to_lowercase();
    let regional = platform_to_regional_route(region);
    let target_matches = max_matches.clamp(3, 12);

    let league_url = format!(
        "https://{platform}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5"
    );
    let league: ChallengerLeagueDto = riot_get_json(client, &league_url, api_key).await?;

    let mut puuids: Vec<String> = Vec::new();
    for entry in league.entries.into_iter().take(4) {
        if let Some(p) = entry.puuid {
            puuids.push(p);
        } else if let Some(summ_id) = entry.summoner_id {
            let url = format!(
                "https://{platform}.api.riotgames.com/lol/summoner/v4/summoners/{summ_id}"
            );
            if let Ok(sum) = riot_get_json::<SummonerPuuidDto>(client, &url, api_key).await {
                puuids.push(sum.puuid);
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
    }

    let mut match_ids: Vec<String> = Vec::new();
    for puuid in puuids {
        if match_ids.len() >= target_matches {
            break;
        }
        let ids_url = format!(
            "https://{regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&start=0&count=3"
        );
        if let Ok(ids) = riot_get_json::<Vec<String>>(client, &ids_url, api_key).await {
            for id in ids {
                if !match_ids.contains(&id) {
                    match_ids.push(id);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }

    let mut payloads: Vec<Value> = Vec::new();
    for match_id in match_ids.into_iter().take(target_matches) {
        let url = format!("https://{regional}.api.riotgames.com/lol/match/v5/matches/{match_id}");
        match riot_get_json::<Value>(client, &url, api_key).await {
            Ok(val) => payloads.push(val),
            Err(e) if e.to_string().contains("429") => break,
            Err(_) => continue,
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }

    Ok(aggregate_jungle_samples(&payloads, patch, region))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn aggregates_jungle_samples_into_meta_snapshot() {
        let m1 = json!({
            "info": {
                "participants": [
                    { "teamPosition": "JUNGLE", "championId": 234, "win": true, "item0": 6672, "item1": 6610 },
                    { "teamPosition": "JUNGLE", "championId": 59, "win": false, "item0": 6692, "item1": 6610 },
                    { "teamPosition": "TOP", "championId": 266, "win": true, "item0": 6692 }
                ]
            }
        });
        let m2 = json!({
            "info": {
                "participants": [
                    { "teamPosition": "JUNGLE", "championId": 234, "win": true, "item0": 6672, "item1": 3053 },
                    { "teamPosition": "JUNGLE", "championId": 32, "win": false, "item0": 6653 }
                ]
            }
        });

        let snap = aggregate_jungle_samples(&[m1, m2], "16.1", "EUW1");
        assert_eq!(snap.sample_matches, 2);
        let viego = snap.champions.iter().find(|c| c.champion_id == 234).unwrap();
        assert_eq!(viego.games, 2);
        assert_eq!(viego.wins, 2);
        assert_eq!(viego.win_rate, 100.0);
        assert!(viego.top_item_ids.contains(&6672));
    }
}
