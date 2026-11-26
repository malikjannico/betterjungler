use std::time::Duration;

use reqwest::header::HeaderMap;
use reqwest::Client;
use serde::{Deserialize, Serialize};

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

async fn riot_get_json<T: for<'de> Deserialize<'de>>(
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
