mod error;
mod lcu;
mod live_client;
mod overlay;
mod riot_api;
mod storage;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::lcu::{RunePageSpec, SanitizedChampSelectSession};
use crate::live_client::LiveClientPollResult;
use crate::overlay::OverlayController;
use crate::riot_api::SummonerProfileSummary;
use crate::storage::UserSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeState {
    pub phase: String,
    pub lcu_connected: bool,
    pub live_client_connected: bool,
    pub champ_select: Option<SanitizedChampSelectSession>,
    pub live_game: Option<Value>,
    pub summoner_profile: Option<SummonerProfileSummary>,
    pub patch_version: String,
}

impl Default for AppRuntimeState {
    fn default() -> Self {
        Self {
            phase: "idle".to_string(),
            lcu_connected: false,
            live_client_connected: false,
            champ_select: None,
            live_game: None,
            summoner_profile: None,
            patch_version: "16.1.1".to_string(),
        }
    }
}

#[derive(Serialize)]
struct ApplyActionResult {
    success: bool,
    message: String,
}

struct SharedState {
    db: Mutex<Connection>,
    runtime: Mutex<AppRuntimeState>,
    overlay: OverlayController,
    loopback_client: reqwest::Client,
    riot_web_client: reqwest::Client,
}

#[tauri::command]
fn get_app_state(state: State<'_, Arc<SharedState>>) -> AppResult<AppRuntimeState> {
    state
        .runtime
        .lock()
        .map(|s| s.clone())
        .map_err(|e| AppError::Storage(e.to_string()))
}

#[tauri::command]
fn set_overlay_mode(
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
    mode: String,
) -> AppResult<()> {
    let compact = mode == "compact";
    state.overlay.set_mode(&app, compact)
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<SharedState>>) -> AppResult<UserSettings> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::load_settings(&conn)
}

#[tauri::command]
fn save_settings(state: State<'_, Arc<SharedState>>, settings: UserSettings) -> AppResult<()> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::save_settings(&conn, &settings)
}

#[tauri::command]
fn save_riot_api_key(api_key: String) -> AppResult<bool> {
    storage::save_riot_api_key(&api_key)?;
    Ok(true)
}

#[tauri::command]
async fn sync_ddragon(state: State<'_, Arc<SharedState>>) -> AppResult<String> {
    let patch = riot_api::fetch_latest_ddragon_patch(&state.riot_web_client).await?;
    if let Ok(mut rt) = state.runtime.lock() {
        rt.patch_version = patch.clone();
    }
    Ok(patch)
}

#[tauri::command]
async fn fetch_summoner_profile(
    state: State<'_, Arc<SharedState>>,
    riot_id: String,
    region: String,
) -> AppResult<SummonerProfileSummary> {
    let api_key = storage::load_riot_api_key()?;
    let profile =
        riot_api::fetch_summoner_profile(&state.riot_web_client, &api_key, &riot_id, &region)
            .await?;
    if let Ok(mut rt) = state.runtime.lock() {
        rt.summoner_profile = Some(profile.clone());
    }
    Ok(profile)
}

#[tauri::command]
async fn apply_runes_and_spells(
    state: State<'_, Arc<SharedState>>,
    runes: RunePageSpec,
    spell1_id: u32,
    spell2_id: u32,
) -> AppResult<ApplyActionResult> {
    let install_path = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        storage::load_settings(&conn)?.lol_install_path
    };

    let creds = lcu::discover_lockfile(&install_path).ok_or_else(|| {
        AppError::Lcu("League Client not detected. Open League of Legends first.".to_string())
    })?;

    let message =
        lcu::apply_runes_and_spells(&state.loopback_client, &creds, &runes, spell1_id, spell2_id)
            .await?;
    Ok(ApplyActionResult {
        success: true,
        message,
    })
}

fn spawn_local_poller(app: AppHandle, shared: Arc<SharedState>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(1800));
        loop {
            interval.tick().await;
            let install_path = shared
                .db
                .lock()
                .ok()
                .and_then(|c| storage::load_settings(&c).ok())
                .map(|s| s.lol_install_path)
                .unwrap_or_default();

            let live_result = live_client::poll_live_client(&shared.loopback_client).await;
            let lcu_creds = lcu::discover_lockfile(&install_path);
            let lcu_connected = lcu_creds.is_some();

            let champ_select = if let Some(ref creds) = lcu_creds {
                lcu::fetch_champ_select_session(&shared.loopback_client, creds)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };

            let updated_snapshot = {
                let mut rt = match shared.runtime.lock() {
                    Ok(guard) => guard,
                    Err(_) => continue,
                };
                rt.lcu_connected = lcu_connected;

                match live_result {
                    LiveClientPollResult::Active(payload) => {
                        rt.phase = "in_game".to_string();
                        rt.live_client_connected = true;
                        rt.live_game = Some(payload);
                    }
                    LiveClientPollResult::Loading => {
                        rt.phase = "loading".to_string();
                        rt.live_client_connected = true;
                        rt.live_game = None;
                    }
                    LiveClientPollResult::NotInGame => {
                        let was_in_game = rt.phase == "in_game";
                        rt.live_client_connected = false;
                        rt.live_game = None;
                        if let Some(cs) = champ_select {
                            rt.phase = "champ_select".to_string();
                            rt.champ_select = Some(cs);
                        } else if was_in_game {
                            rt.phase = "post_game".to_string();
                        } else {
                            rt.phase = "idle".to_string();
                        }
                    }
                }
                rt.clone()
            };

            let _ = app.emit("game-state-updated", updated_snapshot);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("betterjungler"));
            let db_path = app_dir.join("betterjungler.db");
            let conn = storage::init_database(&db_path)?;
            let loopback_client = lcu::build_loopback_client()?;
            let riot_web_client = riot_api::build_riot_web_client()?;
            let overlay_ctrl = OverlayController::default();

            overlay::setup_overlay_controls(app.handle(), overlay_ctrl.clone())?;

            let shared = Arc::new(SharedState {
                db: Mutex::new(conn),
                runtime: Mutex::new(AppRuntimeState::default()),
                overlay: overlay_ctrl,
                loopback_client,
                riot_web_client,
            });

            app.manage(shared.clone());
            spawn_local_poller(app.handle().clone(), shared);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            set_overlay_mode,
            get_settings,
            save_settings,
            save_riot_api_key,
            sync_ddragon,
            fetch_summoner_profile,
            apply_runes_and_spells
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterJungler");
}
