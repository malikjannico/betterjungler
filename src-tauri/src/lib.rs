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
            gameflow_phase: "Unknown".to_string(),
            can_install_update: false,
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

pub struct SharedState {
    db: Mutex<Connection>,
    runtime: Mutex<AppRuntimeState>,
    overlay: OverlayController,
    loopback_client: reqwest::Client,
    riot_web_client: reqwest::Client,
    ai_client: reqwest::Client,
    riot_limiter: Arc<RiotRateLimiter>,
    install_path: Arc<RwLock<String>>,
    live_miss_streak: Arc<AtomicU8>,
    pending_update: Mutex<Option<updater::PendingUpdate>>,
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
fn save_settings(state: State<'_, Arc<SharedState>>, mut settings: UserSettings) -> AppResult<()> {
    settings.update_mode = updater::normalize_update_mode(&settings.update_mode);
    let trimmed_proxy = settings.riot_api_proxy_url.trim().to_string();
    settings.riot_api_proxy_url = if trimmed_proxy.is_empty() {
        String::new()
    } else {
        riot_api::validate_proxy_url(&trimmed_proxy)?
    };
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    // Window bounds & overlay state are owned by dedicated handlers; preserve stored values
    if let Ok(existing) = storage::load_settings(&conn) {
        settings.window_width = existing.window_width;
        settings.window_height = existing.window_height;
        settings.window_x = existing.window_x;
        settings.window_y = existing.window_y;
        settings.hud_corner = existing.hud_corner;
        settings.overlay_hotkey = existing.overlay_hotkey;
        settings.hud_opacity = existing.hud_opacity;
        settings.hud_scale = existing.hud_scale;
        settings.hud_monitor = existing.hud_monitor;
        settings.minimap_side = existing.minimap_side;
    }
    storage::save_settings(&conn, &settings)?;
    if let Ok(mut path_guard) = state.install_path.write() {
        *path_guard = settings.lol_install_path.clone();
    }
    Ok(())
}

fn resolve_riot_auth(state: &SharedState) -> AppResult<riot_api::RiotAuth> {
    let proxy_url = state
        .db
        .lock()
        .ok()
        .and_then(|conn| storage::load_settings(&conn).ok())
        .map(|s| s.riot_api_proxy_url)
        .unwrap_or_default();
    let trimmed_proxy = proxy_url.trim();
    if !trimmed_proxy.is_empty() {
        let clean = riot_api::validate_proxy_url(trimmed_proxy)?;
        return Ok(riot_api::RiotAuth::ProxyUrl(clean));
    }
    let api_key = storage::load_riot_api_key()?;
    Ok(riot_api::RiotAuth::ApiKey(api_key))
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

fn record_lp_if_changed(
    conn: &Connection,
    profile: &SummonerProfileSummary,
    recent_win: Option<bool>,
    match_id: Option<String>,
) {
    if profile.tier == "UNRANKED" {
        return;
    }
    if let Some(ref mid) = match_id {
        if storage::has_lp_snapshot_for_match(conn, mid) {
            return;
        }
    }
    let abs_lp = tier_rank_to_absolute_lp(&profile.tier, &profile.rank, profile.league_points);
    let total_games = profile.wins.saturating_add(profile.losses);
    let latest = storage::get_latest_lp_snapshot(conn).ok().flatten();
    let should_insert = match &latest {
        Some(prev) => {
            let games_advanced = prev.total_games.is_some_and(|prev_tg| total_games > prev_tg);
            prev.absolute_lp != abs_lp
                || (recent_win.is_some() && prev.league_points == 0)
                || games_advanced
        }
        None => true,
    };
    if should_insert {
        let won = match &latest {
            Some(prev) if abs_lp > prev.absolute_lp => Some(true),
            Some(prev) if abs_lp < prev.absolute_lp => Some(false),
            _ => recent_win.or(if latest.is_some() { Some(false) } else { None }),
        };
        let _ = storage::append_lp_snapshot(
            conn,
            &LpHistoryRecord {
                timestamp: chrono::Utc::now().to_rfc3339(),
                tier: profile.tier.clone(),
                rank: profile.rank.clone(),
                league_points: profile.league_points,
                absolute_lp: abs_lp,
                win: won,
                match_id,
                total_games: Some(total_games),
            },
        );
    }
}

#[tauri::command]
async fn fetch_summoner_profile(
    state: State<'_, Arc<SharedState>>,
    riot_id: String,
    region: String,
    recent_win: Option<bool>,
    match_id: Option<String>,
) -> AppResult<SummonerProfileSummary> {
    let auth = resolve_riot_auth(&state)?;
    let profile = riot_api::fetch_summoner_profile(
        &state.riot_web_client,
        &state.riot_limiter,
        &auth,
        &riot_id,
        &region,
    )
    .await?;

    if let Ok(conn) = state.db.lock() {
        record_lp_if_changed(&conn, &profile, recent_win, match_id);
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
        record_lp_if_changed(&conn, &profile, None, None);
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
    let auth = resolve_riot_auth(&state)?;
    let ids = riot_api::fetch_recent_ranked_match_ids(
        &state.riot_web_client,
        &state.riot_limiter,
        &auth,
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
            &auth,
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
fn upsert_climb_goal(state: State<'_, Arc<SharedState>>, goal: ClimbGoalRecord) -> AppResult<()> {
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
fn set_focus_goal(
    state: State<'_, Arc<SharedState>>,
    goal_id: String,
) -> AppResult<Vec<ClimbGoalRecord>> {
    let mut conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::set_focus_goal(&mut conn, &goal_id)
}

#[tauri::command]
async fn refresh_high_elo_meta(
    state: State<'_, Arc<SharedState>>,
    region: String,
    max_matches: usize,
    patch: Option<String>,
) -> AppResult<Value> {
    let auth = resolve_riot_auth(&state)?;
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
        &auth,
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

#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn update_overlay_preferences(
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
    hud_corner: String,
    overlay_hotkey: String,
    hud_opacity: Option<u8>,
    hud_scale: Option<u16>,
    hud_monitor: Option<String>,
    minimap_side: Option<String>,
) -> AppResult<()> {
    let existing_hotkey = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        storage::load_settings(&conn)
            .map(|s| s.overlay_hotkey)
            .unwrap_or_else(|_| "Alt+J".to_string())
    };
    let active_hotkey = state.overlay.active_hotkey();
    let hotkey_changed = active_hotkey.as_deref() != Some(overlay_hotkey.trim());
    if hotkey_changed {
        state.overlay.rebind_hotkey(&app, &overlay_hotkey)?;
    }

    let save_res = (|| -> AppResult<UserSettings> {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut settings = storage::load_settings(&conn).unwrap_or_default();
        settings.hud_corner = hud_corner;
        settings.overlay_hotkey = overlay_hotkey;
        if let Some(op) = hud_opacity {
            settings.hud_opacity = op.clamp(70, 100);
        }
        if let Some(sc) = hud_scale {
            settings.hud_scale = overlay::normalize_hud_scale(sc);
        }
        if let Some(mon) = hud_monitor {
            settings.hud_monitor = mon;
        }
        if let Some(side) = minimap_side {
            settings.minimap_side = side;
        }
        storage::save_settings(&conn, &settings)?;
        Ok(settings)
    })();

    let saved = match save_res {
        Ok(s) => s,
        Err(err) => {
            if hotkey_changed {
                let _ = state.overlay.rebind_hotkey(&app, &existing_hotkey);
            }
            return Err(err);
        }
    };

    state.overlay.apply_preferences(
        Some(&app),
        &saved.hud_corner,
        &saved.overlay_hotkey,
        saved.hud_opacity,
        saved.hud_scale,
        &saved.hud_monitor,
        &saved.minimap_side,
    );
    Ok(())
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
    let auth = match resolve_riot_auth(&state) {
        Ok(a) => a,
        Err(AppError::Credential(_)) => {
            let msg = concat!(
                "No Riot API key or HTTPS proxy URL saved. ",
                "Configure one in Settings to sync live Riot data."
            );
            return Ok(ApiKeyHealthStatus {
                status: "missing".to_string(),
                message: msg.to_string(),
                checked_at: chrono::Utc::now().to_rfc3339(),
            });
        }
        Err(err) => {
            return Ok(ApiKeyHealthStatus {
                status: "offline".to_string(),
                message: err.to_string(),
                checked_at: chrono::Utc::now().to_rfc3339(),
            });
        }
    };
    let status =
        riot_api::probe_riot_api_key(&state.riot_web_client, &state.riot_limiter, &auth, &region)
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

#[tauri::command]
async fn stage_update(app: AppHandle, state: State<'_, Arc<SharedState>>) -> AppResult<String> {
    updater::stage_update_for_quit(&app, &state.pending_update).await
}

pub fn persist_main_window_bounds(app: &AppHandle, shared: &SharedState) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let minimized = window.is_minimized().unwrap_or(false);
    let maximized = window.is_maximized().unwrap_or(false);
    if minimized || maximized {
        return;
    }
    let win_bounds = (window.inner_size(), window.outer_position());
    if let (Ok(size), Ok(pos)) = win_bounds {
        let scale = window.scale_factor().unwrap_or(1.0);
        let w = f64::from(size.width) / scale;
        let h = f64::from(size.height) / scale;
        if w >= 960.0 && h >= 680.0 && pos.x > -10_000 && pos.y > -10_000 {
            if let Ok(conn) = shared.db.lock() {
                if let Ok(mut s) = storage::load_settings(&conn) {
                    s.window_width = Some(w);
                    s.window_height = Some(h);
                    s.window_x = Some(pos.x);
                    s.window_y = Some(pos.y);
                    let _ = storage::save_settings(&conn, &s);
                }
            }
        }
    }
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
                            .try_update(Ordering::SeqCst, Ordering::SeqCst, |prev| {
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
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "hud" {
                    api.prevent_close();
                    let shared = window.state::<Arc<SharedState>>();
                    shared.overlay.mark_hud_hidden();
                    let _ = window.hide();
                    let _ = window.app_handle().emit("overlay-mode-changed", "expanded");
                    return;
                }
                if window.label() == "main" {
                    api.prevent_close();
                    let shared = window.state::<Arc<SharedState>>();
                    persist_main_window_bounds(window.app_handle(), &shared);
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
            overlay_ctrl.apply_preferences(
                None,
                &initial_settings.hud_corner,
                &initial_settings.overlay_hotkey,
                initial_settings.hud_opacity,
                initial_settings.hud_scale,
                &initial_settings.hud_monitor,
                &initial_settings.minimap_side,
            );

            let saved_dims = (
                initial_settings.window_width,
                initial_settings.window_height,
            );
            if let (Some(w), Some(h)) = saved_dims {
                if let Some(main_win) = app.get_webview_window("main") {
                    if w >= 960.0 && h >= 680.0 {
                        let _ = main_win.set_size(tauri::LogicalSize::new(w, h));
                    }
                    let saved_pos = (initial_settings.window_x, initial_settings.window_y);
                    if let (Some(px), Some(py)) = saved_pos {
                        let in_bounds = app
                            .available_monitors()
                            .map(|monitors| {
                                monitors.into_iter().any(|m| {
                                    let mp = m.position();
                                    let ms = m.size();
                                    (mp.x - 100..mp.x + ms.width as i32).contains(&px)
                                        && (mp.y - 40..mp.y + ms.height as i32).contains(&py)
                                })
                            })
                            .unwrap_or(false);
                        if in_bounds {
                            let _ = main_win.set_position(tauri::PhysicalPosition::new(px, py));
                        }
                    }
                }
            }

            let initial_hotkey = initial_settings.overlay_hotkey.clone();
            let shared = Arc::new(SharedState {
                db: Mutex::new(conn),
                runtime: Mutex::new(AppRuntimeState::default()),
                overlay: overlay_ctrl.clone(),
                loopback_client,
                riot_web_client,
                ai_client,
                riot_limiter: Arc::new(RiotRateLimiter::with_default_pacing()),
                install_path: Arc::new(RwLock::new(initial_settings.lol_install_path)),
                live_miss_streak: Arc::new(AtomicU8::new(0)),
                pending_update: Mutex::new(None),
                log_dir,
            });

            let quit_shared = shared.clone();
            let on_quit: Arc<dyn Fn(&AppHandle) + Send + Sync> = Arc::new(move |handle| {
                persist_main_window_bounds(handle, &quit_shared);
                let is_safe = quit_shared
                    .runtime
                    .lock()
                    .map(|rt| {
                        let misses = quit_shared.live_miss_streak.load(Ordering::SeqCst);
                        updater::is_safe_to_install_update(
                            &rt.phase,
                            &rt.gameflow_phase,
                            rt.live_client_connected,
                            misses,
                        )
                    })
                    .unwrap_or(false);
                if let Err(err) =
                    updater::apply_staged_update_if_safe(&quit_shared.pending_update, is_safe)
                {
                    tracing::warn!(error = %err, "Failed to install staged update on quit");
                }
                handle.exit(0);
            });

            if let Err(err) = overlay::setup_overlay_controls(
                app.handle(),
                overlay_ctrl,
                &initial_hotkey,
                on_quit,
            ) {
                tracing::warn!(
                    error = %err,
                    "Failed to register initial overlay hotkey; continuing with tray controls"
                );
            }

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
            set_focus_goal,
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
            install_update,
            stage_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterJungler");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_profile(tier: &str, rank: &str, lp: i32) -> SummonerProfileSummary {
        SummonerProfileSummary {
            riot_id: "Tester#EUW".to_string(),
            puuid: "puuid-test".to_string(),
            region: "EUW1".to_string(),
            summoner_level: 120,
            tier: tier.to_string(),
            rank: rank.to_string(),
            league_points: lp,
            wins: 10,
            losses: 8,
            top_mastery_champion_ids: vec![234],
        }
    }

    #[test]
    fn lp_recorder_deduplicates_by_match_id_and_captures_zero_lp_demotion_shield() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        storage::run_migrations(&conn).expect("migrations");

        // Initial snapshot at Gold IV 20 LP for game M1
        record_lp_if_changed(
            &conn,
            &sample_profile("GOLD", "IV", 20),
            Some(true),
            Some("M1".to_string()),
        );
        // Drop to 0 LP even if caller passes stale Some(true)
        record_lp_if_changed(
            &conn,
            &sample_profile("GOLD", "IV", 0),
            Some(true),
            Some("M2".to_string()),
        );
        // Demotion-shielded loss stays at 0 LP for M3
        record_lp_if_changed(
            &conn,
            &sample_profile("GOLD", "IV", 0),
            Some(false),
            Some("M3".to_string()),
        );
        // Duplicate call with M3 must be ignored
        record_lp_if_changed(
            &conn,
            &sample_profile("GOLD", "IV", 0),
            Some(false),
            Some("M3".to_string()),
        );
        // Non-zero same-LP snapshot before League-V4 settles must be skipped
        record_lp_if_changed(
            &conn,
            &sample_profile("GOLD", "IV", 42),
            Some(true),
            Some("M4".to_string()),
        );
        record_lp_if_changed(
            &conn,
            &sample_profile("GOLD", "IV", 42),
            Some(true),
            Some("M5".to_string()),
        );

        let hist = storage::list_lp_history(&conn, 10).expect("list lp");
        assert_eq!(hist.len(), 4);
        assert_eq!(hist[0].win, Some(true));
        assert_eq!(hist[1].win, Some(false));
        assert_eq!(hist[2].win, Some(false));
        assert_eq!(hist[2].match_id.as_deref(), Some("M3"));
        assert_eq!(hist[3].match_id.as_deref(), Some("M4"));

        // Fresh baseline snapshot with recent_win=None stays neutral (None)
        let conn2 = Connection::open_in_memory().expect("in-memory sqlite 2");
        storage::run_migrations(&conn2).expect("migrations 2");
        record_lp_if_changed(&conn2, &sample_profile("GOLD", "IV", 50), None, None);
        let base_hist = storage::list_lp_history(&conn2, 5).expect("base hist");
        assert_eq!(base_hist.len(), 1);
        assert_eq!(base_hist[0].win, None);
    }
}
