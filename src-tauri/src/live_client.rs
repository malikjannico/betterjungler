use reqwest::Client;
use serde_json::Value;

use crate::lcu::assert_loopback_url;

const LIVE_CLIENT_URL: &str = "https://127.0.0.1:2999/liveclientdata/allgamedata";

#[derive(Debug, Clone)]
pub enum LiveClientPollResult {
    NotInGame,
    Loading,
    Active(Value),
}

/// Polls Riot's official local Live Client Data API over loopback HTTPS.
/// Handles connection-refused and loading-screen states gracefully as a state machine.
pub async fn poll_live_client(client: &Client) -> LiveClientPollResult {
    let Ok(url) = assert_loopback_url(LIVE_CLIENT_URL) else {
        return LiveClientPollResult::NotInGame;
    };

    match client.get(url).send().await {
        Ok(res) if res.status().is_success() => match res.json::<Value>().await {
            Ok(payload) => {
                let game_time = payload
                    .pointer("/gameData/gameTime")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                if game_time <= 0.5 && payload.get("activePlayer").is_none() {
                    LiveClientPollResult::Loading
                } else {
                    LiveClientPollResult::Active(payload)
                }
            }
            Err(_) => LiveClientPollResult::Loading,
        },
        Ok(res) if res.status().as_u16() == 404 => LiveClientPollResult::Loading,
        _ => LiveClientPollResult::NotInGame,
    }
}
