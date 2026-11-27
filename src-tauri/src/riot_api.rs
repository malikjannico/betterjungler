use std::time::Duration;

use reqwest::header::HeaderMap;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::rate_limiter::RiotRateLimiter;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Euw1,
    Eun1,
    Na1,
    Kr,
    Jp1,
    Br1,
    La1,
    La2,
    Oc1,
    Tr1,
    Ru,
    Ph2,
    Sg2,
    Th2,
    Tw2,
    Vn2,
    Me1,
}

impl Platform {
    pub fn as_host(self) -> &'static str {
        match self {
            Platform::Euw1 => "euw1",
            Platform::Eun1 => "eun1",
            Platform::Na1 => "na1",
            Platform::Kr => "kr",
            Platform::Jp1 => "jp1",
            Platform::Br1 => "br1",
            Platform::La1 => "la1",
            Platform::La2 => "la2",
            Platform::Oc1 => "oc1",
            Platform::Tr1 => "tr1",
            Platform::Ru => "ru",
            Platform::Ph2 => "ph2",
            Platform::Sg2 => "sg2",
            Platform::Th2 => "th2",
            Platform::Tw2 => "tw2",
            Platform::Vn2 => "vn2",
            Platform::Me1 => "me1",
        }
    }

    pub fn as_code(self) -> &'static str {
        match self {
            Platform::Euw1 => "EUW1",
            Platform::Eun1 => "EUN1",
            Platform::Na1 => "NA1",
            Platform::Kr => "KR",
            Platform::Jp1 => "JP1",
            Platform::Br1 => "BR1",
            Platform::La1 => "LA1",
            Platform::La2 => "LA2",
            Platform::Oc1 => "OC1",
            Platform::Tr1 => "TR1",
            Platform::Ru => "RU",
            Platform::Ph2 => "PH2",
            Platform::Sg2 => "SG2",
            Platform::Th2 => "TH2",
            Platform::Tw2 => "TW2",
            Platform::Vn2 => "VN2",
            Platform::Me1 => "ME1",
        }
    }

    /// Account-V1 ONLY exposes three regional clusters: americas, asia, europe.
    /// OC1 routes through americas; SEA shards (PH2/SG2/TH2/TW2/VN2) route through asia.
    pub fn account_regional_route(self) -> &'static str {
        match self {
            Platform::Na1 | Platform::Br1 | Platform::La1 | Platform::La2 | Platform::Oc1 => {
                "americas"
            }
            Platform::Kr
            | Platform::Jp1
            | Platform::Ph2
            | Platform::Sg2
            | Platform::Th2
            | Platform::Tw2
            | Platform::Vn2 => "asia",
            Platform::Euw1 | Platform::Eun1 | Platform::Tr1 | Platform::Ru | Platform::Me1 => {
                "europe"
            }
        }
    }

    /// Match-V5 supports americas, asia, europe, and sea.
    pub fn match_regional_route(self) -> &'static str {
        match self {
            Platform::Na1 | Platform::Br1 | Platform::La1 | Platform::La2 => "americas",
            Platform::Kr | Platform::Jp1 => "asia",
            Platform::Oc1
            | Platform::Ph2
            | Platform::Sg2
            | Platform::Th2
            | Platform::Tw2
            | Platform::Vn2 => "sea",
            Platform::Euw1 | Platform::Eun1 | Platform::Tr1 | Platform::Ru | Platform::Me1 => {
                "europe"
            }
        }
    }
}

pub fn parse_platform(region: &str) -> AppResult<Platform> {
    match region.trim().to_uppercase().as_str() {
        "EUW1" => Ok(Platform::Euw1),
        "EUN1" => Ok(Platform::Eun1),
        "NA1" => Ok(Platform::Na1),
        "KR" => Ok(Platform::Kr),
        "JP1" => Ok(Platform::Jp1),
        "BR1" => Ok(Platform::Br1),
        "LA1" => Ok(Platform::La1),
        "LA2" => Ok(Platform::La2),
        "OC1" => Ok(Platform::Oc1),
        "TR1" => Ok(Platform::Tr1),
        "RU" => Ok(Platform::Ru),
        "PH2" => Ok(Platform::Ph2),
        "SG2" => Ok(Platform::Sg2),
        "TH2" => Ok(Platform::Th2),
        "TW2" => Ok(Platform::Tw2),
        "VN2" => Ok(Platform::Vn2),
        "ME1" => Ok(Platform::Me1),
        other => Err(AppError::SecurityPolicy(format!(
            "Unsupported Riot platform region: {other}"
        ))),
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum RiotAuth {
    ApiKey(String),
    ProxyUrl(String),
}

impl std::fmt::Debug for RiotAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RiotAuth::ApiKey(_) => f.debug_tuple("ApiKey").field(&"[REDACTED]").finish(),
            RiotAuth::ProxyUrl(url) => f.debug_tuple("ProxyUrl").field(url).finish(),
        }
    }
}

fn is_allowed_riot_host_prefix(prefix: &str) -> bool {
    matches!(
        prefix,
        "americas"
            | "europe"
            | "asia"
            | "sea"
            | "euw1"
            | "eun1"
            | "na1"
            | "kr"
            | "jp1"
            | "br1"
            | "la1"
            | "la2"
            | "oc1"
            | "tr1"
            | "ru"
            | "ph2"
            | "sg2"
            | "th2"
            | "tw2"
            | "vn2"
            | "me1"
    )
}

pub fn validate_proxy_url(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return Err(AppError::SecurityPolicy(
            "Riot API proxy URL cannot be empty or contain whitespace".to_string(),
        ));
    }
    let parsed = url::Url::parse(trimmed)
        .map_err(|_| AppError::SecurityPolicy("Invalid Riot API proxy URL".to_string()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::SecurityPolicy(
            "Riot API proxy URL must use HTTPS".to_string(),
        ));
    }
    if parsed.host_str().map(str::is_empty).unwrap_or(true)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(AppError::SecurityPolicy(
            "Riot API proxy URL must have a valid HTTPS host".to_string(),
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(AppError::SecurityPolicy(
            "Riot API proxy URL cannot include query strings or fragments".to_string(),
        ));
    }
    if !parsed.path().is_empty() && parsed.path() != "/" {
        return Err(AppError::SecurityPolicy(
            "Riot API proxy URL must be an origin-only HTTPS URL (no path)".to_string(),
        ));
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

pub fn rewrite_riot_url_for_proxy(url: &str, proxy_base: &str) -> AppResult<String> {
    let clean_base = validate_proxy_url(proxy_base)?;
    let parsed = url::Url::parse(url)
        .map_err(|_| AppError::SecurityPolicy("Invalid Riot API request URL".to_string()))?;
    if parsed.scheme() != "https" {
        return Err(AppError::SecurityPolicy(
            "Riot API request must use HTTPS".to_string(),
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::SecurityPolicy("Missing Riot API host".to_string()))?;
    let routing = host.strip_suffix(".api.riotgames.com").ok_or_else(|| {
        AppError::SecurityPolicy("URL host is not an official Riot API host".to_string())
    })?;
    if !is_allowed_riot_host_prefix(routing) {
        return Err(AppError::SecurityPolicy(format!(
            "Unsupported Riot routing host: {routing}"
        )));
    }
    let path = parsed.path();
    let suffix = match parsed.query() {
        Some(q) => format!("{path}?{q}"),
        None => path.to_string(),
    };
    Ok(format!("{clean_base}/{routing}{suffix}"))
}

fn resolve_request_target(url: &str, auth: &RiotAuth) -> AppResult<(String, &'static str, String)> {
    match auth {
        RiotAuth::ApiKey(key) => Ok((url.to_string(), "X-Riot-Token", key.trim().to_string())),
        RiotAuth::ProxyUrl(proxy_base) => {
            let rewritten = rewrite_riot_url_for_proxy(url, proxy_base)?;
            Ok((rewritten, "X-App-Client", "betterjungler".to_string()))
        }
    }
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiKeyHealthStatus {
    pub status: String,
    pub message: String,
    pub checked_at: String,
}

/// Pure classification of Status-V4 probe HTTP responses for testability.
pub fn classify_probe_status(
    status_code: u16,
    retry_after: Option<u64>,
    platform_code: &str,
    checked_at: String,
) -> ApiKeyHealthStatus {
    if (200..300).contains(&status_code) {
        ApiKeyHealthStatus {
            status: "valid".to_string(),
            message: format!("Riot API key verified on {platform_code}."),
            checked_at,
        }
    } else if status_code == 401 || status_code == 403 {
        ApiKeyHealthStatus {
            status: "expired".to_string(),
            message: "Riot API key rejected (401/403). Personal development keys expire every 24 hours — refresh in Settings.".to_string(),
            checked_at,
        }
    } else if status_code == 429 {
        let retry = retry_after.unwrap_or(5);
        ApiKeyHealthStatus {
            status: "rate_limited".to_string(),
            message: format!("Riot API rate limit active (429). Retry in {retry}s."),
            checked_at,
        }
    } else {
        ApiKeyHealthStatus {
            status: "offline".to_string(),
            message: format!("Riot Status-V4 returned HTTP {status_code}."),
            checked_at,
        }
    }
}

/// Probes the stored Riot API key or proxy against Status-V4 (`/lol/status/v4/platform-data`)
/// to distinguish valid auth from expired/invalid (401/403), rate-limited (429), or offline states.
pub async fn probe_riot_api_key(
    client: &Client,
    limiter: &RiotRateLimiter,
    auth: &RiotAuth,
    region: &str,
) -> ApiKeyHealthStatus {
    let checked_at = chrono::Utc::now().to_rfc3339();
    if let RiotAuth::ApiKey(key) = auth {
        if key.trim().is_empty() {
            return ApiKeyHealthStatus {
                status: "missing".to_string(),
                message:
                    "No Riot API key saved. Paste your key in Settings to sync live Riot data."
                        .to_string(),
                checked_at,
            };
        }
    }

    let platform = match parse_platform(region) {
        Ok(p) => p,
        Err(err) => {
            return ApiKeyHealthStatus {
                status: "offline".to_string(),
                message: err.to_string(),
                checked_at,
            };
        }
    };

    let raw_url = format!(
        "https://{}.api.riotgames.com/lol/status/v4/platform-data",
        platform.as_host()
    );
    let (target_url, header_name, header_val) = match resolve_request_target(&raw_url, auth) {
        Ok(parts) => parts,
        Err(err) => {
            return ApiKeyHealthStatus {
                status: "offline".to_string(),
                message: err.to_string(),
                checked_at,
            };
        }
    };

    limiter.acquire("status-v4").await;
    match client
        .get(&target_url)
        .header(header_name, &header_val)
        .send()
        .await
    {
        Ok(res) => {
            let status_code = res.status().as_u16();
            limiter.observe_headers("status-v4", res.headers()).await;
            let retry = parse_retry_after_seconds(res.headers());
            classify_probe_status(status_code, retry, platform.as_code(), checked_at)
        }
        Err(err) => ApiKeyHealthStatus {
            status: "offline".to_string(),
            message: format!("Unable to reach Riot API: {err}"),
            checked_at,
        },
    }
}

/// Builds a strict standard-TLS HTTP client with redirects disabled to prevent header leakage.
pub fn build_riot_web_client() -> AppResult<Client> {
    Client::builder()
        .use_rustls_tls()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::RiotApi(e.to_string()))
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
    limiter: &RiotRateLimiter,
    bucket: &str,
    url: &str,
    auth: &RiotAuth,
) -> AppResult<T> {
    const MAX_ATTEMPTS: usize = 3;
    let (target_url, header_name, header_val) = resolve_request_target(url, auth)?;

    for attempt in 0..MAX_ATTEMPTS {
        limiter.acquire(bucket).await;

        let res = client
            .get(&target_url)
            .header(header_name, &header_val)
            .send()
            .await
            .map_err(|e| AppError::RiotApi(e.to_string()))?;

        let status = res.status().as_u16();
        let headers = res.headers().clone();
        limiter.observe_headers(bucket, &headers).await;

        if status == 429 {
            let retry_secs = parse_retry_after_seconds(&headers)
                .unwrap_or(5)
                .clamp(1, 120);
            let is_app_limit = headers
                .get("x-rate-limit-type")
                .and_then(|v| v.to_str().ok())
                .map(|t| t.eq_ignore_ascii_case("application"))
                .unwrap_or(true);
            limiter
                .record_rate_limit(bucket, retry_secs, is_app_limit)
                .await;

            if retry_secs <= 15 && attempt + 1 < MAX_ATTEMPTS {
                continue;
            }
            return Err(AppError::RateLimited {
                retry_after_secs: retry_secs,
            });
        }

        if status == 401 || status == 403 {
            return Err(AppError::Unauthorized);
        }

        if !res.status().is_success() {
            return Err(AppError::RiotApi(format!(
                "Riot API request failed (HTTP {})",
                res.status()
            )));
        }

        return res
            .json::<T>()
            .await
            .map_err(|e| AppError::RiotApi(e.to_string()));
    }

    Err(AppError::RiotApi(
        "Riot API retry budget exhausted".to_string(),
    ))
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
    #[serde(rename = "summonerLevel")]
    summoner_level: u64,
}

#[derive(Default, Deserialize)]
#[serde(default)]
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
    limiter: &RiotRateLimiter,
    auth: &RiotAuth,
    riot_id: &str,
    region: &str,
) -> AppResult<SummonerProfileSummary> {
    let platform = parse_platform(region)?;
    let (game_name, tag_line) = riot_id.split_once('#').ok_or_else(|| {
        AppError::RiotApi("Riot ID must be formatted as GameName#TagLine".to_string())
    })?;
    if game_name.trim().is_empty() || tag_line.trim().is_empty() {
        return Err(AppError::RiotApi(
            "Both GameName and TagLine must be non-empty (GameName#TagLine)".to_string(),
        ));
    }

    let account_route = platform.account_regional_route();
    let host = platform.as_host();

    let account_url = format!(
        "https://{account_route}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}",
        urlencoding_segment(game_name),
        urlencoding_segment(tag_line)
    );
    let account: AccountDto =
        riot_get_json(client, limiter, "account-v1", &account_url, auth).await?;

    let encoded_puuid = urlencoding_segment(&account.puuid);

    let summoner_url = format!(
        "https://{host}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/{encoded_puuid}"
    );
    let summoner: SummonerDto =
        riot_get_json(client, limiter, "summoner-v4", &summoner_url, auth).await?;

    let league_url =
        format!("https://{host}.api.riotgames.com/lol/league/v4/entries/by-puuid/{encoded_puuid}");
    let entries: Vec<LeagueEntryDto> =
        match riot_get_json(client, limiter, "league-v4", &league_url, auth).await {
            Ok(val) => val,
            Err(err @ (AppError::RateLimited { .. } | AppError::Unauthorized)) => return Err(err),
            Err(_) => vec![],
        };

    let solo = entries
        .into_iter()
        .find(|e| e.queue_type == "RANKED_SOLO_5x5");

    let mastery_url = format!(
        "https://{host}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/{encoded_puuid}/top?count=8"
    );
    let masteries: Vec<MasteryDto> =
        match riot_get_json(client, limiter, "mastery-v4", &mastery_url, auth).await {
            Ok(val) => val,
            Err(err @ (AppError::RateLimited { .. } | AppError::Unauthorized)) => return Err(err),
            Err(_) => vec![],
        };

    Ok(SummonerProfileSummary {
        riot_id: format!("{}#{}", account.game_name, account.tag_line),
        puuid: account.puuid,
        region: platform.as_code().to_string(),
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

pub fn urlencoding_segment(input: &str) -> String {
    input
        .trim()
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

pub fn validate_match_id(match_id: &str) -> AppResult<&str> {
    let trimmed = match_id.trim();
    if trimmed.is_empty()
        || trimmed.len() > 48
        || !trimmed
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
    {
        return Err(AppError::SecurityPolicy(
            "Invalid Riot match identifier".to_string(),
        ));
    }
    Ok(trimmed)
}

pub async fn fetch_recent_ranked_match_ids(
    client: &Client,
    limiter: &RiotRateLimiter,
    auth: &RiotAuth,
    puuid: &str,
    region: &str,
    count: usize,
) -> AppResult<Vec<String>> {
    let platform = parse_platform(region)?;
    let regional = platform.match_regional_route();
    let encoded_puuid = urlencoding_segment(puuid);
    let url = format!(
        "https://{regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/{encoded_puuid}/ids?queue=420&start=0&count={}",
        count.clamp(1, 20)
    );
    riot_get_json(client, limiter, "match-v5-ids", &url, auth).await
}

pub async fn fetch_match_detail_and_timeline(
    client: &Client,
    limiter: &RiotRateLimiter,
    auth: &RiotAuth,
    match_id: &str,
    puuid: &str,
    region: &str,
) -> AppResult<Value> {
    let platform = parse_platform(region)?;
    let safe_match_id = validate_match_id(match_id)?;
    let regional = platform.match_regional_route();
    let match_url =
        format!("https://{regional}.api.riotgames.com/lol/match/v5/matches/{safe_match_id}");
    let timeline_url = format!(
        "https://{regional}.api.riotgames.com/lol/match/v5/matches/{safe_match_id}/timeline"
    );

    let match_json: Value =
        riot_get_json(client, limiter, "match-v5-detail", &match_url, auth).await?;
    let timeline_json: Value =
        riot_get_json(client, limiter, "match-v5-timeline", &timeline_url, auth).await?;

    normalize_match_v5_detail(safe_match_id, puuid, &match_json, &timeline_json)
}

pub fn normalize_match_v5_detail(
    match_id: &str,
    puuid: &str,
    match_json: &Value,
    timeline_json: &Value,
) -> AppResult<Value> {
    let info = &match_json["info"];
    let empty_vec = vec![];
    let participants = info["participants"].as_array().unwrap_or(&empty_vec);

    let player = participants
        .iter()
        .find(|p| p["puuid"].as_str() == Some(puuid))
        .ok_or_else(|| {
            AppError::RiotApi(format!(
                "Target PUUID was not found in Match-V5 detail for {match_id}"
            ))
        })?;

    let player_pid = player["participantId"].as_i64().unwrap_or(1);
    let my_team_id = player["teamId"].as_i64().unwrap_or(100);

    let enemy_jg = participants.iter().find(|p| {
        p["teamId"].as_i64() != Some(my_team_id) && p["teamPosition"].as_str() == Some("JUNGLE")
    });
    let enemy_jg_pid: Option<i64> = enemy_jg.and_then(|p| p["participantId"].as_i64());

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
            let voidgrub_cluster = i64::from(objs["horde"]["kills"].as_i64().unwrap_or(0) > 0);
            objs["dragon"]["kills"].as_i64().unwrap_or(0)
                + objs["baron"]["kills"].as_i64().unwrap_or(0)
                + objs["riftHerald"]["kills"].as_i64().unwrap_or(0)
                + objs["atakhan"]["kills"].as_i64().unwrap_or(0)
                + voidgrub_cluster
        } else {
            0
        }
    };

    let mut frames_out = Vec::new();
    let mut events_out = Vec::new();

    if let Some(frames) = timeline_json["info"]["frames"].as_array() {
        for (idx, frame) in frames.iter().enumerate() {
            let minute = frame["timestamp"]
                .as_i64()
                .map(|ms| (ms / 60_000).max(0))
                .unwrap_or(idx as i64);
            let pf = &frame["participantFrames"];
            let p_key = player_pid.to_string();
            let p_frame = &pf[&p_key];
            let e_frame = enemy_jg_pid.map(|eid| &pf[&eid.to_string()]);

            if p_frame.is_object() {
                let p_gold = p_frame["totalGold"].as_i64().unwrap_or(0);
                let p_xp = p_frame["xp"].as_i64().unwrap_or(0);
                let cs = p_frame["minionsKilled"].as_i64().unwrap_or(0)
                    + p_frame["jungleMinionsKilled"].as_i64().unwrap_or(0);

                let (e_gold, e_xp, e_cs, enemy_jg_pos) = match e_frame.filter(|ef| ef.is_object()) {
                    Some(ef) => {
                        let eg = ef["totalGold"].as_i64().unwrap_or(p_gold);
                        let ex = ef["xp"].as_i64().unwrap_or(p_xp);
                        let ec = ef["minionsKilled"].as_i64().unwrap_or(0)
                            + ef["jungleMinionsKilled"].as_i64().unwrap_or(0);
                        let pos = if ef["position"].is_object() {
                            json!({
                                "x": ef["position"]["x"].as_i64().unwrap_or(7435),
                                "y": ef["position"]["y"].as_i64().unwrap_or(7435)
                            })
                        } else {
                            Value::Null
                        };
                        (eg, ex, ec, pos)
                    }
                    None => (p_gold, p_xp, cs, Value::Null),
                };

                frames_out.push(json!({
                    "minute": minute,
                    "position": {
                        "x": p_frame["position"]["x"].as_i64().unwrap_or(7435),
                        "y": p_frame["position"]["y"].as_i64().unwrap_or(7435)
                    },
                    "enemyJunglerPosition": enemy_jg_pos,
                    "totalGold": p_gold,
                    "xp": p_xp,
                    "cs": cs,
                    "enemyJunglerGold": e_gold,
                    "enemyJunglerXp": e_xp,
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
        .filter_map(|slot| player[format!("item{slot}")].as_i64())
        .filter(|&id| id > 0)
        .collect();

    let cs_total = player["totalMinionsKilled"].as_i64().unwrap_or(0)
        + player["neutralMinionsKilled"].as_i64().unwrap_or(0);

    Ok(json!({
        "matchId": match_id,
        "playedAt": played_at,
        "durationSeconds": info["gameDuration"].as_i64().unwrap_or(1800),
        "patch": info["gameVersion"].as_str().unwrap_or("16.1"),
        "queueId": info["queueId"].as_i64().unwrap_or(420),
        "win": player["win"].as_bool().unwrap_or(false),
        "mapSide": if my_team_id == 200 { "red" } else { "blue" },
        "playerParticipantId": player_pid,
        "championId": player["championId"].as_i64().unwrap_or(0),
        "championName": player["championName"].as_str().unwrap_or("Jungler"),
        "enemyJunglerChampionId": enemy_jg.and_then(|p| p["championId"].as_i64()).unwrap_or(0),
        "enemyJunglerName": enemy_jg.and_then(|p| p["championName"].as_str()).unwrap_or("Unknown"),
        "kills": player["kills"].as_i64().unwrap_or(0),
        "deaths": player["deaths"].as_i64().unwrap_or(0),
        "assists": player["assists"].as_i64().unwrap_or(0),
        "cs": cs_total,
        "visionScore": player["visionScore"].as_i64().unwrap_or(0),
        "controlWardsBought": player["visionWardsBoughtInGame"].as_i64().unwrap_or(0),
        "teamKills": team_kills,
        "teamObjectives": count_team_objectives(my_team_id),
        "enemyObjectives": count_team_objectives(if my_team_id == 100 { 200 } else { 100 }),
        "items": items,
        "frames": frames_out,
        "events": events_out
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn validates_platform_allowlist_and_routes() {
        assert_eq!(
            parse_platform("EUW1").unwrap().account_regional_route(),
            "europe"
        );
        assert_eq!(
            parse_platform("OC1").unwrap().account_regional_route(),
            "americas"
        );
        assert_eq!(parse_platform("OC1").unwrap().match_regional_route(), "sea");
        assert_eq!(
            parse_platform("SG2").unwrap().account_regional_route(),
            "asia"
        );
        assert!(parse_platform("evil.com/#").is_err());
    }

    #[test]
    fn validates_match_id_rejects_traversal() {
        assert!(validate_match_id("EUW1_1234567890").is_ok());
        assert!(validate_match_id("../evil").is_err());
    }

    #[test]
    fn normalizes_match_detail_timestamps_voidgrubs_and_enemy_position() {
        let match_json = json!({
            "info": {
                "gameCreation": 1730000000000_i64,
                "gameDuration": 1800,
                "gameVersion": "16.23.1",
                "queueId": 420,
                "teams": [
                    { "teamId": 100, "objectives": { "dragon": { "kills": 2 }, "horde": { "kills": 3 }, "baron": { "kills": 1 } } },
                    { "teamId": 200, "objectives": { "dragon": { "kills": 1 }, "atakhan": { "kills": 1 } } }
                ],
                "participants": [
                    { "participantId": 2, "puuid": "p-ally", "teamId": 100, "teamPosition": "JUNGLE", "championId": 234, "championName": "Viego", "win": true, "kills": 7, "deaths": 2, "assists": 8 },
                    { "participantId": 7, "puuid": "p-enemy", "teamId": 200, "teamPosition": "JUNGLE", "championId": 64, "championName": "LeeSin", "win": false, "kills": 3, "deaths": 5, "assists": 4 }
                ]
            }
        });
        let timeline_json = json!({
            "info": {
                "frames": [
                    {
                        "timestamp": 600000,
                        "participantFrames": {
                            "2": { "position": { "x": 4000, "y": 5000 }, "totalGold": 3500, "xp": 4100, "minionsKilled": 4, "jungleMinionsKilled": 56 },
                            "7": { "position": { "x": 10000, "y": 9000 }, "totalGold": 3100, "xp": 3800, "minionsKilled": 2, "jungleMinionsKilled": 50 }
                        },
                        "events": []
                    }
                ]
            }
        });

        let out = normalize_match_v5_detail("EUW1_999", "p-ally", &match_json, &timeline_json)
            .expect("target participant should normalize");
        assert_eq!(out["frames"][0]["minute"], 10);
        assert_eq!(out["frames"][0]["enemyJunglerPosition"]["x"], 10000);
        assert_eq!(out["teamObjectives"], 4); // 2 dragons + 1 baron + 1 voidgrub cluster
        assert_eq!(out["enemyObjectives"], 2); // 1 dragon + 1 atakhan
    }

    #[test]
    fn errors_when_target_puuid_is_missing_and_avoids_zero_enemy_gold_when_no_enemy_jg() {
        let match_json = json!({
            "info": {
                "gameCreation": 1730000000000_i64,
                "participants": [
                    { "participantId": 2, "puuid": "p-ally", "teamId": 100, "teamPosition": "JUNGLE", "championId": 234, "championName": "Viego", "win": true }
                ]
            }
        });
        let timeline_json = json!({
            "info": {
                "frames": [
                    {
                        "timestamp": 600000,
                        "participantFrames": {
                            "2": { "position": { "x": 4000, "y": 5000 }, "totalGold": 3500, "xp": 4100 }
                        }
                    }
                ]
            }
        });

        assert!(
            normalize_match_v5_detail("EUW1_999", "p-missing", &match_json, &timeline_json)
                .is_err()
        );
        let out = normalize_match_v5_detail("EUW1_999", "p-ally", &match_json, &timeline_json)
            .expect("missing enemy jg should still normalize");
        assert!(out["frames"][0]["enemyJunglerPosition"].is_null());
        assert_eq!(out["frames"][0]["enemyJunglerGold"], 3500);
        assert_eq!(out["enemyJunglerName"], "Unknown");
    }

    #[test]
    fn parses_retry_after_header() {
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", HeaderValue::from_static("15"));
        assert_eq!(parse_retry_after_seconds(&headers), Some(15));
    }

    #[test]
    fn classifies_probe_status_codes() {
        let now = "2026-11-27T00:00:00Z".to_string();
        assert_eq!(
            classify_probe_status(200, None, "EUW1", now.clone()).status,
            "valid"
        );
        assert_eq!(
            classify_probe_status(401, None, "EUW1", now.clone()).status,
            "expired"
        );
        assert_eq!(
            classify_probe_status(403, None, "EUW1", now.clone()).status,
            "expired"
        );
        let rate = classify_probe_status(429, Some(12), "EUW1", now.clone());
        assert_eq!(rate.status, "rate_limited");
        assert!(rate.message.contains("12s"));
        assert_eq!(
            classify_probe_status(503, None, "EUW1", now).status,
            "offline"
        );
    }

    #[test]
    fn validates_https_proxy_urls_and_rewrites_riot_targets() {
        assert_eq!(
            validate_proxy_url("https://bj-proxy.example.workers.dev/").unwrap(),
            "https://bj-proxy.example.workers.dev"
        );
        assert!(validate_proxy_url("http://insecure.example.com").is_err());
        assert!(validate_proxy_url("https://bad host.example.com").is_err());
        assert!(validate_proxy_url("https://proxy.example.com?token=1").is_err());
        assert!(validate_proxy_url("https://proxy.example.com#frag").is_err());
        assert!(validate_proxy_url("https://proxy.example.com/subpath").is_err());
        assert!(validate_proxy_url("").is_err());
        assert!(!format!("{:?}", RiotAuth::ApiKey("RGAPI-secret".to_string())).contains("RGAPI"));

        let rewritten = rewrite_riot_url_for_proxy(
            "https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/abc/ids?queue=420",
            "https://bj-proxy.example.workers.dev/",
        )
        .expect("valid rewrite");
        assert_eq!(
            rewritten,
            concat!(
                "https://bj-proxy.example.workers.dev",
                "/europe/lol/match/v5/matches/by-puuid/abc/ids?queue=420"
            )
        );
        assert!(rewrite_riot_url_for_proxy(
            "https://evil.com/lol/status/v4/platform-data",
            "https://bj-proxy.example.workers.dev",
        )
        .is_err());

        let (_, hdr_name, hdr_val) = resolve_request_target(
            "https://euw1.api.riotgames.com/lol/status/v4/platform-data",
            &RiotAuth::ProxyUrl("https://bj-proxy.example.workers.dev".to_string()),
        )
        .expect("proxy target");
        assert_eq!(hdr_name, "X-App-Client");
        assert_eq!(hdr_val, "betterjungler");
    }
}
