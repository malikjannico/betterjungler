mod ai_coach;
mod error;
mod high_elo_sampler;
mod lcu;
mod live_client;
mod overlay;
mod rate_limiter;
mod riot_api;
mod storage;
mod updater;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tracing_subscriber::EnvFilter;

use crate::error::{AppError, AppResult};
use crate::lcu::{RunePageSpec, SanitizedChampSelectSession};
use crate::live_client::LiveClientPollResult;
use crate::overlay::OverlayController;
use crate::rate_limiter::RiotRateLimiter;
use crate::riot_api::{ApiKeyHealthStatus, SummonerProfileSummary};
use crate::storage::{tier_rank_to_absolute_lp, ClimbGoalRecord, LpHistoryRecord, UserSettings};
use crate::updater::{AppMetaInfo, UpdateCheckResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeState {
    pub phase: String,
    pub gameflow_phase: String,
    pub can_install_update: bool,
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
            gameflow_phase: "None".to_string(),
            can_install_update: true,
            lcu_connected: false,
            live_client_connected: false,
            champ_select: None,
            live_game: None,
            summoner_profile: None,
            patch_version: "16.23.1".to_string(),
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
    ai_client: reqwest::Client,
    riot_limiter: Arc<RiotRateLimiter>,
    install_path: Arc<RwLock<String>>,
    live_miss_streak: Arc<AtomicU8>,
    log_dir: PathBuf,
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
    if let Ok(mut path_guard) = state.install_path.write() {
        *path_guard = settings.lol_install_path.clone();
    }
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

fn record_lp_if_changed(conn: &Connection, profile: &SummonerProfileSummary) {
    if profile.tier == "UNRANKED" {
        return;
    }
    let abs_lp = tier_rank_to_absolute_lp(&profile.tier, &profile.rank, profile.league_points);
    let latest = storage::get_latest_lp_snapshot(conn).ok().flatten();
    let should_insert = match &latest {
        Some(prev) => prev.absolute_lp != abs_lp,
        None => true,
    };
    if should_insert {
        let won = latest
            .as_ref()
            .map(|prev| abs_lp >= prev.absolute_lp)
            .unwrap_or_else(|| profile.wins >= profile.losses);
        let _ = storage::append_lp_snapshot(
            conn,
            &LpHistoryRecord {
                timestamp: chrono::Utc::now().to_rfc3339(),
                tier: profile.tier.clone(),
                rank: profile.rank.clone(),
                league_points: profile.league_points,
                absolute_lp: abs_lp,
                win: won,
            },
        );
    }
}

#[tauri::command]
async fn fetch_summoner_profile(
    state: State<'_, Arc<SharedState>>,
    riot_id: String,
    region: String,
) -> AppResult<SummonerProfileSummary> {
    let api_key = storage::load_riot_api_key()?;
    let profile = riot_api::fetch_summoner_profile(
        &state.riot_web_client,
        &state.riot_limiter,
        &api_key,
        &riot_id,
        &region,
    )
    .await?;

    if let Ok(conn) = state.db.lock() {
        record_lp_if_changed(&conn, &profile);
    }
    if let Ok(mut rt) = state.runtime.lock() {
        rt.summoner_profile = Some(profile.clone());
    }
    Ok(profile)
}

#[tauri::command]
async fn get_lcu_profile(
    state: State<'_, Arc<SharedState>>,
    region: String,
) -> AppResult<SummonerProfileSummary> {
    let install_path = state
        .install_path
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();
    let creds = lcu::discover_lockfile(&install_path).ok_or_else(|| {
        AppError::Lcu("League Client not detected. Open League of Legends first.".to_string())
    })?;
    let profile = lcu::fetch_lcu_profile(&state.loopback_client, &creds, &region).await?;
    if let Ok(conn) = state.db.lock() {
        record_lp_if_changed(&conn, &profile);
    }
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
    let install_path = state
        .install_path
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();

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

#[tauri::command]
async fn sync_recent_matches(
    state: State<'_, Arc<SharedState>>,
    puuid: String,
    region: String,
    count: usize,
) -> AppResult<Vec<Value>> {
    let api_key = storage::load_riot_api_key()?;
    let ids = riot_api::fetch_recent_ranked_match_ids(
        &state.riot_web_client,
        &state.riot_limiter,
        &api_key,
        &puuid,
        &region,
        count,
    )
    .await?;

    let mut details = Vec::new();
    for match_id in ids {
        let cached = {
            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::Storage(e.to_string()))?;
            storage::get_cached_match_detail(&conn, &match_id, &puuid)?
        };

        if let Some(detail) = cached {
            details.push(detail);
            continue;
        }

        let detail = match riot_api::fetch_match_detail_and_timeline(
            &state.riot_web_client,
            &state.riot_limiter,
            &api_key,
            &match_id,
            &puuid,
            &region,
        )
        .await
        {
            Ok(d) => d,
            Err(AppError::RateLimited { retry_after_secs }) => {
                if details.is_empty() {
                    return Err(AppError::RateLimited { retry_after_secs });
                }
                tracing::warn!(
                    match_id = %match_id,
                    retry_after_secs,
                    "Rate limited during match sync; returning partial batch"
                );
                break;
            }
            Err(err) => {
                tracing::warn!(match_id = %match_id, error = %err, "Skipping failed match fetch");
                continue;
            }
        };

        let played_at = detail["playedAt"]
            .as_str()
            .map(ToString::to_string)
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        let summary_stub = serde_json::json!({
            "matchId": match_id,
            "playedAt": played_at,
            "championId": detail["championId"],
            "championName": detail["championName"],
            "win": detail["win"]
        });

        {
            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::Storage(e.to_string()))?;
            storage::cache_match_record(
                &conn,
                &match_id,
                &puuid,
                &played_at,
                &summary_stub,
                &detail,
            )?;
        }

        details.push(detail);
    }

    Ok(details)
}

#[tauri::command]
fn get_cached_matches(
    state: State<'_, Arc<SharedState>>,
    puuid: Option<String>,
) -> AppResult<Vec<Value>> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let (_summaries, details) = storage::list_cached_matches(&conn, puuid.as_deref(), 15)?;
    Ok(details)
}

#[tauri::command]
fn get_climb_goals(state: State<'_, Arc<SharedState>>) -> AppResult<Vec<ClimbGoalRecord>> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::list_climb_goals(&conn)
}

#[tauri::command]
fn upsert_climb_goal(
    state: State<'_, Arc<SharedState>>,
    goal: ClimbGoalRecord,
) -> AppResult<()> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::upsert_climb_goal(&conn, &goal)
}

#[tauri::command]
fn delete_climb_goal(state: State<'_, Arc<SharedState>>, goal_id: String) -> AppResult<()> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::delete_climb_goal(&conn, &goal_id)
}

#[tauri::command]
async fn refresh_high_elo_meta(
    state: State<'_, Arc<SharedState>>,
    region: String,
    max_matches: usize,
    patch: Option<String>,
) -> AppResult<Value> {
    let api_key = storage::load_riot_api_key()?;
    let active_patch = patch
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| {
            state
                .runtime
                .lock()
                .map(|r| r.patch_version.clone())
                .unwrap_or_else(|_| "16.23.1".to_string())
        });
    let snap = high_elo_sampler::sample_high_elo_jungle_meta(
        &state.riot_web_client,
        &state.riot_limiter,
        &api_key,
        &region,
        &active_patch,
        max_matches,
    )
    .await?;
    let val = serde_json::to_value(&snap).map_err(|e| AppError::Storage(e.to_string()))?;
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        storage::save_meta_snapshot(&conn, &active_patch, &region, &val)?;
    }
    Ok(val)
}

#[tauri::command]
fn get_cached_meta_snapshot(state: State<'_, Arc<SharedState>>) -> AppResult<Option<Value>> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::load_meta_snapshot(&conn)
}

#[tauri::command]
fn save_ai_api_key(api_key: String) -> AppResult<bool> {
    storage::save_ai_api_key(&api_key)?;
    Ok(true)
}

#[tauri::command]
async fn generate_ai_debrief(
    state: State<'_, Arc<SharedState>>,
    context: String,
) -> AppResult<String> {
    let config = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        storage::load_settings(&conn)?.ai_coach
    };
    let api_key = storage::load_ai_api_key().ok();
    ai_coach::generate_ai_debrief(&state.ai_client, &config, api_key, &context).await
}

#[tauri::command]
fn update_overlay_preferences(
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
    hud_corner: String,
    overlay_hotkey: String,
) -> AppResult<()> {
    state.overlay.set_corner(&hud_corner);
    state.overlay.rebind_hotkey(&app, &overlay_hotkey)
}

#[tauri::command]
fn get_lp_history(state: State<'_, Arc<SharedState>>) -> AppResult<Vec<LpHistoryRecord>> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::list_lp_history(&conn, 20)
}

#[tauri::command]
async fn check_riot_api_key_health(
    state: State<'_, Arc<SharedState>>,
    region: String,
) -> AppResult<ApiKeyHealthStatus> {
    if !storage::has_riot_api_key() {
        return Ok(ApiKeyHealthStatus {
            status: "missing".to_string(),
            message: "No Riot API key saved. Paste your key in Settings to sync live Riot data."
                .to_string(),
            checked_at: chrono::Utc::now().to_rfc3339(),
        });
    }
    let api_key = storage::load_riot_api_key()?;
    let status = riot_api::probe_riot_api_key(
        &state.riot_web_client,
        &state.riot_limiter,
        &api_key,
        &region,
    )
    .await;
    Ok(status)
}

#[tauri::command]
fn get_app_meta(state: State<'_, Arc<SharedState>>) -> AppMetaInfo {
    updater::build_app_meta(&state.log_dir.to_string_lossy())
}

#[tauri::command]
fn open_logs_folder(state: State<'_, Arc<SharedState>>) -> AppResult<()> {
    std::fs::create_dir_all(&state.log_dir).map_err(|e| AppError::Storage(e.to_string()))?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&state.log_dir)
            .spawn()
            .map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        tracing::info!(
            log_dir = %state.log_dir.display(),
            "Open logs folder requested on non-Windows host"
        );
    }
    Ok(())
}

#[tauri::command]
async fn check_update(app: AppHandle) -> AppResult<UpdateCheckResult> {
    updater::check_for_update(&app).await
}

#[tauri::command]
async fn install_update(app: AppHandle, state: State<'_, Arc<SharedState>>) -> AppResult<String> {
    let shared = state.inner().clone();
    updater::download_and_install_update(&app, move || {
        let rt = shared
            .runtime
            .lock()
            .map_err(|e| AppError::Updater(e.to_string()))?;
        let misses = shared.live_miss_streak.load(Ordering::SeqCst);
        if !updater::is_safe_to_install_update(
            &rt.phase,
            &rt.gameflow_phase,
            rt.live_client_connected,
            misses,
        ) {
            return Err(AppError::Updater(
                "Cannot install update while League Champ Select or an active match is running."
                    .to_string(),
            ));
        }
        Ok(())
    })
    .await
}

fn is_terminal_post_game_flow(gameflow: &str) -> bool {
    matches!(
        gameflow,
        "WaitingForStats" | "PreEndOfGame" | "EndOfGame" | "Lobby" | "None"
    )
}

fn spawn_local_poller(app: AppHandle, shared: Arc<SharedState>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(1800));
        let mut post_game_latch_ticks: u8 = 0;

        loop {
            interval.tick().await;
            let install_path = shared
                .install_path
                .read()
                .map(|p| p.clone())
                .unwrap_or_default();

            let live_result = live_client::poll_live_client(&shared.loopback_client).await;
            let lcu_creds = lcu::discover_lockfile(&install_path);
            let lcu_connected = lcu_creds.is_some();

            let (champ_select, gameflow_phase) = if let Some(ref creds) = lcu_creds {
                let gf = lcu::fetch_gameflow_phase(&shared.loopback_client, creds)
                    .await
                    .unwrap_or_else(|_| "Unknown".to_string());
                let cs = lcu::fetch_champ_select_session(&shared.loopback_client, creds)
                    .await
                    .ok()
                    .flatten();
                (cs, gf)
            } else {
                (None, "None".to_string())
            };

            let updated_snapshot = {
                let mut rt = match shared.runtime.lock() {
                    Ok(guard) => guard,
                    Err(_) => continue,
                };
                rt.lcu_connected = lcu_connected;
                rt.gameflow_phase = gameflow_phase.clone();

                match live_result {
                    LiveClientPollResult::Active(payload) => {
                        post_game_latch_ticks = 0;
                        shared.live_miss_streak.store(0, Ordering::SeqCst);
                        rt.phase = "in_game".to_string();
                        rt.live_client_connected = true;
                        rt.live_game = Some(payload);
                    }
                    LiveClientPollResult::Loading => {
                        post_game_latch_ticks = 0;
                        shared.live_miss_streak.store(0, Ordering::SeqCst);
                        rt.phase = "loading".to_string();
                        rt.live_client_connected = true;
                        rt.live_game = None;
                    }
                    LiveClientPollResult::NotInGame => {
                        let misses = shared
                            .live_miss_streak
                            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |prev| {
                                Some(prev.saturating_add(1))
                            })
                            .unwrap_or(255)
                            .saturating_add(1);
                        let was_in_game = rt.phase == "in_game";
                        let should_keep_in_game = was_in_game
                            && misses < 3
                            && !is_terminal_post_game_flow(&gameflow_phase);

                        if should_keep_in_game {
                            rt.live_client_connected = false;
                            // Hold in_game state cleanly across transient single-poll timeouts
                        } else {
                            rt.live_client_connected = false;
                            rt.live_game = None;
                            if let Some(cs) = champ_select {
                                post_game_latch_ticks = 0;
                                rt.phase = "champ_select".to_string();
                                rt.champ_select = Some(cs);
                            } else {
                                // Clear stale champ select immediately on dodge / exit
                                rt.champ_select = None;
                                if was_in_game
                                    || matches!(
                                        gameflow_phase.as_str(),
                                        "EndOfGame" | "PreEndOfGame" | "WaitingForStats"
                                    )
                                {
                                    post_game_latch_ticks = 10;
                                    rt.phase = "post_game".to_string();
                                } else if post_game_latch_ticks > 0 {
                                    post_game_latch_ticks -= 1;
                                    rt.phase = "post_game".to_string();
                                } else {
                                    rt.phase = "idle".to_string();
                                }
                            }
                        }
                    }
                }
                let misses = shared.live_miss_streak.load(Ordering::SeqCst);
                rt.can_install_update = updater::is_safe_to_install_update(
                    &rt.phase,
                    &rt.gameflow_phase,
                    rt.live_client_connected,
                    misses,
                );
                rt.clone()
            };

            let _ = app.emit("game-state-updated", updated_snapshot);
        }
    });
}

fn init_file_logging(log_dir: &std::path::Path) {
    let _ = std::fs::create_dir_all(log_dir);
    let log_file = log_dir.join("betterjungler.log");
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("betterjungler_lib=info,betterjungler=info,warn"));
    if let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
    {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_ansi(false)
            .with_writer(Mutex::new(file))
            .try_init();
    } else {
        let _ = tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_ansi(false)
            .with_writer(std::io::stderr)
            .try_init();
    }
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "BetterJungler desktop started"
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("betterjungler"));
            let log_dir = app_dir.join("logs");
            init_file_logging(&log_dir);

            let db_path = app_dir.join("betterjungler.db");
            let conn = storage::init_database(&db_path)?;
            let loopback_client = lcu::build_loopback_client()?;
            let riot_web_client = riot_api::build_riot_web_client()?;
            let ai_client = ai_coach::build_ai_client()?;
            let overlay_ctrl = OverlayController::default();
            let initial_settings = storage::load_settings(&conn).unwrap_or_default();
            overlay_ctrl.set_corner(&initial_settings.hud_corner);

            if let Err(err) = overlay::setup_overlay_controls(
                app.handle(),
                overlay_ctrl.clone(),
                &initial_settings.overlay_hotkey,
            ) {
                tracing::warn!(error = %err, "Failed to register initial overlay hotkey; continuing with tray controls");
            }

            let shared = Arc::new(SharedState {
                db: Mutex::new(conn),
                runtime: Mutex::new(AppRuntimeState::default()),
                overlay: overlay_ctrl,
                loopback_client,
                riot_web_client,
                ai_client,
                riot_limiter: Arc::new(RiotRateLimiter::with_default_pacing()),
                install_path: Arc::new(RwLock::new(initial_settings.lol_install_path)),
                live_miss_streak: Arc::new(AtomicU8::new(0)),
                log_dir,
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
            get_lcu_profile,
            apply_runes_and_spells,
            sync_recent_matches,
            get_cached_matches,
            get_climb_goals,
            upsert_climb_goal,
            delete_climb_goal,
            refresh_high_elo_meta,
            get_cached_meta_snapshot,
            save_ai_api_key,
            generate_ai_debrief,
            update_overlay_preferences,
            get_lp_history,
            check_riot_api_key_health,
            get_app_meta,
            open_logs_folder,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterJungler");
}
