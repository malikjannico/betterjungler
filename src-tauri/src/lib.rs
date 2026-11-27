mod ai_coach;
mod error;
mod high_elo_sampler;
mod lcu;
mod live_client;
mod overlay;
mod patch_pack;
mod rate_limiter;
mod recorder;
mod replay_api;
mod riot_api;
mod storage;
mod updater;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
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
use crate::recorder::{HardwareEncoderStatus, RecordingRuntimeStatus};
use crate::replay_api::{GameCfgReplayStatus, ReplaySeekResult, RoflReplayInfo};
use crate::riot_api::{ApiKeyHealthStatus, SummonerProfileSummary};
use crate::storage::{
    tier_rank_to_absolute_lp, ClimbGoalRecord, LpHistoryRecord, RecordingClipRecord,
    RecordingRecord, RecordingSettings, UserSettings,
};
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
    pub recording_status: String,
    pub recording_elapsed_sec: f64,
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
            recording_status: "idle".to_string(),
            recording_elapsed_sec: 0.0,
        }
    }
}

#[derive(Serialize)]
struct ApplyActionResult {
    success: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRecordingBundle {
    pub recording: Option<RecordingRecord>,
    pub clips: Vec<RecordingClipRecord>,
    pub rofl: Option<RoflReplayInfo>,
    pub replay_api_connected: bool,
    pub replay_api_enabled: bool,
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
    recordings_dir: PathBuf,
    recorder: Arc<recorder::RecorderManager>,
    recording_settings: Arc<RwLock<RecordingSettings>>,
    hardware_probe_cache: Mutex<Option<HardwareEncoderStatus>>,
    clip_seq: AtomicU64,
    live_miss_streak: Arc<AtomicU8>,
    pending_update: Mutex<Option<updater::PendingUpdate>>,
    log_dir: PathBuf,
    pack_dir: PathBuf,
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
    settings.primary_role = storage::normalize_coached_role(&settings.primary_role, "jungle");
    settings.secondary_role = storage::normalize_coached_role(&settings.secondary_role, "bottom");
    settings.recording.preset = storage::normalize_recording_preset(&settings.recording.preset);
    settings.recording.max_storage_gb = settings.recording.max_storage_gb.clamp(1, 50);
    settings.recording.keep_last_n_games = settings.recording.keep_last_n_games.clamp(1, 100);
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
        settings.hud_x = existing.hud_x;
        settings.hud_y = existing.hud_y;
        settings.hud_locked = existing.hud_locked;
    }
    storage::save_settings(&conn, &settings)?;
    if let Ok(mut path_guard) = state.install_path.write() {
        *path_guard = settings.lol_install_path.clone();
    }
    if let Ok(mut rec_guard) = state.recording_settings.write() {
        *rec_guard = settings.recording.clone();
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
            let games_advanced = prev
                .total_games
                .is_some_and(|prev_tg| total_games > prev_tg);
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

fn resolve_candidate_riot_id(state: &SharedState) -> Option<String> {
    if let Ok(rt) = state.runtime.lock() {
        if let Some(ref prof) = rt.summoner_profile {
            let trimmed = prof.riot_id.trim();
            if riot_api::is_valid_riot_id_format(trimmed) {
                return Some(trimmed.to_string());
            }
        }
    }
    if let Ok(conn) = state.db.lock() {
        if let Ok(settings) = storage::load_settings(&conn) {
            let trimmed = settings.riot_id.trim();
            if riot_api::is_valid_riot_id_format(trimmed) {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn update_runtime_profile_puuid(state: &SharedState, encrypted_puuid: &str) {
    if let Ok(mut rt) = state.runtime.lock() {
        if let Some(ref mut prof) = rt.summoner_profile {
            prof.puuid = encrypted_puuid.to_string();
        }
    }
}

#[tauri::command]
async fn sync_recent_matches(
    state: State<'_, Arc<SharedState>>,
    puuid: String,
    region: String,
    count: usize,
) -> AppResult<Vec<Value>> {
    let auth = resolve_riot_auth(&state)?;
    let candidate_riot_id = resolve_candidate_riot_id(&state);
    let mut effective_puuid = puuid.trim().to_string();
    let mut already_resolved = false;

    if riot_api::is_unencrypted_lcu_uuid(&effective_puuid) {
        if let Some(ref rid) = candidate_riot_id {
            effective_puuid = riot_api::resolve_encrypted_puuid_by_riot_id(
                &state.riot_web_client,
                &state.riot_limiter,
                &auth,
                rid,
                &region,
            )
            .await?;
            update_runtime_profile_puuid(&state, &effective_puuid);
            already_resolved = true;
        } else {
            return Err(AppError::RiotApi(
                "Save your Riot ID (Name#Tag) in Settings to resolve your Match-V5 PUUID."
                    .to_string(),
            ));
        }
    }

    let ids = match riot_api::fetch_recent_ranked_match_ids(
        &state.riot_web_client,
        &state.riot_limiter,
        &auth,
        &effective_puuid,
        &region,
        count,
    )
    .await
    {
        Ok(ids) => ids,
        Err(AppError::RiotHttp {
            status: 400,
            detail,
        }) if !already_resolved => {
            if let Some(ref rid) = candidate_riot_id {
                effective_puuid = riot_api::resolve_encrypted_puuid_by_riot_id(
                    &state.riot_web_client,
                    &state.riot_limiter,
                    &auth,
                    rid,
                    &region,
                )
                .await?;
                update_runtime_profile_puuid(&state, &effective_puuid);
                riot_api::fetch_recent_ranked_match_ids(
                    &state.riot_web_client,
                    &state.riot_limiter,
                    &auth,
                    &effective_puuid,
                    &region,
                    count,
                )
                .await?
            } else {
                return Err(AppError::RiotHttp {
                    status: 400,
                    detail,
                });
            }
        }
        Err(err) => return Err(err),
    };

    let mut details = Vec::new();
    for match_id in ids {
        let cached = {
            let conn = state
                .db
                .lock()
                .map_err(|e| AppError::Storage(e.to_string()))?;
            storage::get_cached_match_detail(&conn, &match_id, &effective_puuid)?
        };

        if let Some(detail) = cached {
            if detail
                .get("role")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.trim().is_empty())
            {
                if let Some(played_at) = detail["playedAt"].as_str() {
                    if let Ok(conn) = state.db.lock() {
                        let _ =
                            storage::bind_unlinked_recording_to_match(&conn, &match_id, played_at);
                    }
                }
                details.push(detail);
                continue;
            }
        }

        let detail = match riot_api::fetch_match_detail_and_timeline(
            &state.riot_web_client,
            &state.riot_limiter,
            &auth,
            &match_id,
            &effective_puuid,
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
                &effective_puuid,
                &played_at,
                &summary_stub,
                &detail,
            )?;
            let _ = storage::bind_unlinked_recording_to_match(&conn, &match_id, &played_at);
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
    let (_summaries, details) = storage::list_cached_matches(&conn, puuid.as_deref(), 30)?;
    if details.is_empty() {
        if let Some(ref p) = puuid {
            if riot_api::is_unencrypted_lcu_uuid(p) {
                let (_all_sum, all_details) = storage::list_cached_matches(&conn, None, 30)?;
                return Ok(all_details);
            }
        }
    }
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

#[tauri::command]
async fn test_ai_connection(
    state: State<'_, Arc<SharedState>>,
    provider: String,
    model: String,
    endpoint: String,
) -> AppResult<String> {
    let config = storage::AiCoachConfig {
        provider: provider.trim().to_ascii_lowercase(),
        model: model.trim().to_string(),
        endpoint: endpoint.trim().to_string(),
        has_api_key: false,
    };
    let api_key = storage::load_ai_api_key().ok();
    ai_coach::test_ai_connection(&state.ai_client, &config, api_key).await
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

fn persist_current_hud_position(app: &AppHandle, shared: &SharedState) -> AppResult<(i32, i32)> {
    let hud_window = app
        .get_webview_window("hud")
        .ok_or_else(|| AppError::Overlay("Dedicated HUD window not found".to_string()))?;
    let pos = hud_window
        .outer_position()
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    let size = hud_window
        .outer_size()
        .map_err(|e| AppError::Overlay(e.to_string()))?;
    let monitors: Vec<(i32, i32, u32, u32)> = app
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let mp = m.position();
            let ms = m.size();
            (mp.x, mp.y, ms.width, ms.height)
        })
        .collect();
    let (cx, cy) = overlay::clamp_custom_hud_pos(pos.x, pos.y, size.width, size.height, &monitors)
        .unwrap_or((pos.x, pos.y));
    {
        let conn = shared
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut settings = storage::load_settings(&conn).unwrap_or_default();
        settings.hud_x = Some(cx);
        settings.hud_y = Some(cy);
        storage::save_settings(&conn, &settings)?;
    }
    shared
        .overlay
        .set_custom_position(Some(app), Some(cx), Some(cy), false);
    Ok((cx, cy))
}

fn apply_hud_lock_state(app: &AppHandle, shared: &SharedState, locked: bool) -> AppResult<()> {
    if locked {
        let _ = persist_current_hud_position(app, shared);
    }
    {
        let conn = shared
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut settings = storage::load_settings(&conn).unwrap_or_default();
        settings.hud_locked = locked;
        storage::save_settings(&conn, &settings)?;
    }
    shared.overlay.set_hud_locked(app, locked)
}

#[tauri::command]
fn set_hud_locked(
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
    locked: bool,
) -> AppResult<()> {
    apply_hud_lock_state(&app, &state, locked)
}

#[tauri::command]
fn save_hud_position(app: AppHandle, state: State<'_, Arc<SharedState>>) -> AppResult<(i32, i32)> {
    persist_current_hud_position(&app, &state)
}

#[tauri::command]
fn reset_hud_position(app: AppHandle, state: State<'_, Arc<SharedState>>) -> AppResult<()> {
    {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut settings = storage::load_settings(&conn).unwrap_or_default();
        settings.hud_x = None;
        settings.hud_y = None;
        storage::save_settings(&conn, &settings)?;
    }
    state
        .overlay
        .set_custom_position(Some(&app), None, None, true);
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
        Err(AppError::Credential(msg)) => {
            let missing = msg.contains("No Riot API key configured");
            let status = if missing { "missing" } else { "expired" };
            let out_msg = if missing {
                concat!(
                    "No Riot API key or HTTPS proxy URL saved. ",
                    "Configure one in Settings to sync live Riot data."
                )
                .to_string()
            } else {
                msg
            };
            return Ok(ApiKeyHealthStatus {
                status: status.to_string(),
                message: out_msg,
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
    let fallback_riot_id = resolve_candidate_riot_id(&state);
    let status = riot_api::probe_riot_api_key(
        &state.riot_web_client,
        &state.riot_limiter,
        &auth,
        &region,
        fallback_riot_id.as_deref(),
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

#[tauri::command]
async fn stage_update(app: AppHandle, state: State<'_, Arc<SharedState>>) -> AppResult<String> {
    updater::stage_update_for_quit(&app, &state.pending_update).await
}

fn enforce_recording_quota(
    conn: &Connection,
    recordings_dir: &Path,
    settings: &RecordingSettings,
    active_recording_id: Option<&str>,
) {
    let Ok(records) = storage::list_all_recordings(conn) else {
        return;
    };
    let protected_ids = storage::list_recording_ids_with_pinned_clips(conn).unwrap_or_default();
    let max_bytes = u64::from(settings.max_storage_gb.clamp(1, 50)) * 1024 * 1024 * 1024;
    let mut keep_last_n = usize::from(settings.keep_last_n_games.clamp(1, 100));
    if settings.preset == "clips_only" {
        keep_last_n = keep_last_n.min(3);
    }
    let evict_ids = storage::plan_quota_evictions(&records, &protected_ids, max_bytes, keep_last_n);
    for id in evict_ids {
        if active_recording_id == Some(id.as_str()) {
            continue;
        }
        if let Ok(Some(rec)) = storage::get_recording_by_id(conn, &id) {
            let candidate = PathBuf::from(&rec.file_path);
            if candidate.exists() {
                if !recorder::is_safe_recording_path(recordings_dir, &candidate) {
                    continue;
                }
                if let Err(err) = std::fs::remove_file(&candidate) {
                    tracing::warn!(error = %err, recording_id = %id, "Skipping quota eviction because recording file could not be removed");
                    continue;
                }
            }
            let _ = storage::delete_recording_rows(conn, &id);
        }
    }
}

fn stop_and_finalize_active_recording(shared: &SharedState) {
    let Some(stopped) = shared.recorder.stop_recording() else {
        return;
    };
    let rec_settings = shared
        .recording_settings
        .read()
        .map(|s| s.clone())
        .unwrap_or_default();
    if let Ok(conn) = shared.db.lock() {
        let _ = storage::finalize_recording(
            &conn,
            &stopped.recording_id,
            &stopped.ended_at,
            stopped.duration_sec,
            stopped.size_bytes,
            &stopped.status,
        );
        enforce_recording_quota(&conn, &shared.recordings_dir, &rec_settings, None);
    }
}

async fn stop_and_finalize_active_recording_async(shared: &Arc<SharedState>) {
    let shared_clone = Arc::clone(shared);
    if let Err(err) =
        tokio::task::spawn_blocking(move || stop_and_finalize_active_recording(&shared_clone)).await
    {
        tracing::warn!(error = %err, "Blocking recording finalization task failed");
    }
}

#[tauri::command]
fn probe_hardware_encoder(state: State<'_, Arc<SharedState>>) -> HardwareEncoderStatus {
    let install_path = state
        .install_path
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();
    let status = recorder::probe_hardware_encoder(&install_path);
    if let Ok(mut cache) = state.hardware_probe_cache.lock() {
        *cache = Some(status.clone());
    }
    status
}

#[tauri::command]
fn get_recording_status(state: State<'_, Arc<SharedState>>) -> RecordingRuntimeStatus {
    let preset = state
        .recording_settings
        .read()
        .map(|r| r.preset.clone())
        .unwrap_or_else(|_| "720p30".to_string());
    let cached_hw = state
        .hardware_probe_cache
        .lock()
        .ok()
        .and_then(|c| c.as_ref().map(|s| s.hardware_available));
    let hw_ok = match cached_hw {
        Some(avail) => avail,
        None => {
            let install_path = state
                .install_path
                .read()
                .map(|p| p.clone())
                .unwrap_or_default();
            let probed = recorder::probe_hardware_encoder(&install_path);
            let avail = probed.hardware_available;
            if let Ok(mut cache) = state.hardware_probe_cache.lock() {
                *cache = Some(probed);
            }
            avail
        }
    };
    state.recorder.status(&preset, hw_ok)
}

#[tauri::command]
fn list_recordings(state: State<'_, Arc<SharedState>>) -> AppResult<Vec<RecordingRecord>> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::list_recordings(&conn, 50)
}

#[tauri::command]
async fn get_match_recording(
    state: State<'_, Arc<SharedState>>,
    match_id: String,
) -> AppResult<MatchRecordingBundle> {
    let (recording, clips) = {
        let conn = state
            .db
            .lock()
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut rec = storage::get_recording_for_match(&conn, &match_id)?;
        if rec.is_none() {
            if let Ok(played_at) = conn.query_row(
                "SELECT played_at FROM matches_fact WHERE match_id = ?1 LIMIT 1",
                rusqlite::params![&match_id],
                |row| row.get::<_, String>(0),
            ) {
                rec = storage::bind_unlinked_recording_to_match(&conn, &match_id, &played_at)?;
            }
        }
        let clips = match &rec {
            Some(r) => storage::list_recording_clips(&conn, &r.id)?,
            None => Vec::new(),
        };
        (rec, clips)
    };

    let install_path = state
        .install_path
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();
    let cfg = replay_api::inspect_game_cfg(&install_path);
    let rofl = replay_api::discover_rofl_for_match(&match_id, None);
    let playback = replay_api::get_replay_api_status(&state.loopback_client).await;

    Ok(MatchRecordingBundle {
        recording,
        clips,
        rofl,
        replay_api_connected: playback.connected,
        replay_api_enabled: cfg.replay_api_enabled,
    })
}

#[tauri::command]
fn toggle_recording_pin(
    state: State<'_, Arc<SharedState>>,
    recording_id: String,
    pinned: bool,
) -> AppResult<Option<RecordingRecord>> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::set_recording_pinned(&conn, &recording_id, pinned)
}

#[tauri::command]
fn delete_recording(state: State<'_, Arc<SharedState>>, recording_id: String) -> AppResult<()> {
    if state.recorder.active_recording_id().as_deref() == Some(recording_id.as_str()) {
        return Err(AppError::Storage(
            "Cannot delete a recording while it is actively capturing.".to_string(),
        ));
    }
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if let Some(existing) = storage::get_recording_by_id(&conn, &recording_id)? {
        let candidate = PathBuf::from(&existing.file_path);
        if candidate.exists() && recorder::is_safe_recording_path(&state.recordings_dir, &candidate)
        {
            std::fs::remove_file(&candidate).map_err(|e| {
                AppError::Storage(format!(
                    "Unable to remove recording video file (close player or retry): {e}"
                ))
            })?;
        }
        let _ = storage::delete_recording_rows(&conn, &recording_id)?;
    }
    Ok(())
}

#[tauri::command]
fn save_recording_clip(
    state: State<'_, Arc<SharedState>>,
    recording_id: String,
    match_id: Option<String>,
    label: String,
    kind: String,
    game_time_sec: f64,
) -> AppResult<RecordingClipRecord> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if storage::get_recording_by_id(&conn, &recording_id)?.is_none() {
        return Err(AppError::Storage(format!(
            "Recording not found for clip: {recording_id}"
        )));
    }
    let clean_time = if game_time_sec.is_finite() {
        game_time_sec.max(0.0)
    } else {
        0.0
    };
    let clean_label: String = label.trim().chars().take(120).collect();
    let final_label = if clean_label.is_empty() {
        "Saved Clip".to_string()
    } else {
        clean_label
    };
    let clean_kind = match kind.trim() {
        "bookmark" | "mistake" | "highlight" | "death" | "objective" => kind.trim().to_string(),
        _ => "bookmark".to_string(),
    };
    let start_sec = (clean_time - 12.0).max(0.0);
    let end_sec = clean_time + 6.0;
    let now = chrono::Utc::now();
    let seq = state.clip_seq.fetch_add(1, Ordering::Relaxed);
    let clip = RecordingClipRecord {
        id: format!("clip-{}-{seq}", now.timestamp_millis()),
        recording_id,
        match_id,
        label: final_label,
        kind: clean_kind,
        game_time_sec: clean_time,
        start_sec,
        end_sec,
        pinned: true,
        created_at: now.to_rfc3339(),
    };
    storage::upsert_recording_clip(&conn, &clip)?;
    Ok(clip)
}

#[tauri::command]
fn delete_recording_clip(state: State<'_, Arc<SharedState>>, clip_id: String) -> AppResult<()> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    storage::delete_recording_clip(&conn, &clip_id)
}

#[tauri::command]
fn open_recordings_folder(state: State<'_, Arc<SharedState>>) -> AppResult<()> {
    std::fs::create_dir_all(&state.recordings_dir).map_err(|e| AppError::Storage(e.to_string()))?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&state.recordings_dir)
            .spawn()
            .map_err(|e| AppError::Overlay(e.to_string()))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        tracing::info!(
            recordings_dir = %state.recordings_dir.display(),
            "Open recordings folder requested on non-Windows host"
        );
    }
    Ok(())
}

#[tauri::command]
fn get_personal_learning_snapshot(
    state: State<'_, Arc<SharedState>>,
    puuid: Option<String>,
    role: Option<String>,
) -> AppResult<storage::PersonalLearningSummary> {
    let conn = state
        .db
        .lock()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let effective_puuid = puuid
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty() && !riot_api::is_unencrypted_lcu_uuid(p));
    let effective_role = role.as_deref().unwrap_or("JUNGLE");
    storage::load_personal_learning_summary_for_role(&conn, effective_puuid, effective_role)
}

#[tauri::command]
fn get_active_patch_pack(
    state: State<'_, Arc<SharedState>>,
) -> AppResult<patch_pack::ActivePatchPackStatus> {
    patch_pack::load_active_patch_pack(&state.pack_dir)
}

#[tauri::command]
fn install_signed_patch_pack(
    app: AppHandle,
    state: State<'_, Arc<SharedState>>,
    envelope_json: String,
) -> AppResult<patch_pack::ActivePatchPackStatus> {
    let status = patch_pack::install_signed_patch_pack(&state.pack_dir, &envelope_json)?;
    let _ = app.emit("patch-pack-updated", &status);
    Ok(status)
}

#[tauri::command]
fn inspect_replay_config(state: State<'_, Arc<SharedState>>) -> GameCfgReplayStatus {
    let install_path = state
        .install_path
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();
    replay_api::inspect_game_cfg(&install_path)
}

#[tauri::command]
fn set_replay_api_enabled(
    state: State<'_, Arc<SharedState>>,
    enable: bool,
) -> AppResult<GameCfgReplayStatus> {
    let install_path = state
        .install_path
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();
    let cfg_status = replay_api::set_game_cfg_replay_api(&install_path, enable)?;
    if let Ok(conn) = state.db.lock() {
        if let Ok(mut settings) = storage::load_settings(&conn) {
            settings.recording.replay_api_enabled = cfg_status.replay_api_enabled;
            let _ = storage::save_settings(&conn, &settings);
            if let Ok(mut rec_guard) = state.recording_settings.write() {
                *rec_guard = settings.recording;
            }
        }
    }
    Ok(cfg_status)
}

#[tauri::command]
async fn seek_riot_replay(
    state: State<'_, Arc<SharedState>>,
    match_id: String,
    time_sec: f64,
    launch_if_closed: bool,
) -> AppResult<ReplaySeekResult> {
    let target_sec = if time_sec.is_finite() {
        time_sec.max(0.0)
    } else {
        0.0
    };
    let install_path = state
        .install_path
        .read()
        .map(|p| p.clone())
        .unwrap_or_default();
    let rofl = replay_api::discover_rofl_for_match(&match_id, None);
    let playback_now = replay_api::get_replay_api_status(&state.loopback_client).await;
    if playback_now.connected {
        let updated =
            replay_api::seek_replay_api(&state.loopback_client, target_sec, false).await?;
        return Ok(ReplaySeekResult {
            status: "seeked".to_string(),
            message: format!("Jumped LoL Replay to {:.0}s.", updated.time),
            target_sec,
            playback: Some(updated),
            rofl,
        });
    }

    if launch_if_closed {
        if let Some(ref found) = rofl {
            replay_api::launch_rofl_replay(&install_path, found)?;
            return Ok(ReplaySeekResult {
                status: "launched".to_string(),
                message: format!(
                    "Launched {} in League Replay Client. Click Seek once loaded to jump to {:.0}s.",
                    found.file_name, target_sec
                ),
                target_sec,
                playback: None,
                rofl,
            });
        }
    }

    Ok(ReplaySeekResult {
        status: "unavailable".to_string(),
        message: "No open Riot Replay API session or .rofl replay file found for this match."
            .to_string(),
        target_sec,
        playback: None,
        rofl,
    })
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

fn is_playable_live_match(
    payload: &serde_json::Value,
    lcu_connected: bool,
    gameflow_phase: &str,
) -> bool {
    let has_active_player = payload
        .pointer("/activePlayer/riotId")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.trim().is_empty())
        || payload
            .pointer("/activePlayer/summonerName")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.trim().is_empty());
    if !has_active_player {
        return false;
    }
    !lcu_connected || matches!(gameflow_phase, "InProgress" | "Reconnect")
}

fn spawn_local_poller(app: AppHandle, shared: Arc<SharedState>) {
    enum PollerRecAction {
        None,
        SyncOrStart(f64),
        Stop,
    }

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(1800));
        let mut post_game_latch_ticks: u8 = 0;
        let mut rec_attempted_for_match = false;
        let mut last_queue_is_ranked: Option<bool> = None;

        loop {
            interval.tick().await;
            let install_path = shared
                .install_path
                .read()
                .map(|p| p.clone())
                .unwrap_or_default();
            let rec_settings = shared
                .recording_settings
                .read()
                .map(|s| s.clone())
                .unwrap_or_default();

            let live_result = live_client::poll_live_client(&shared.loopback_client).await;
            let pre_lcu_elapsed = shared.recorder.current_elapsed_sec();
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

            let (mut updated_snapshot, rec_action) = {
                let mut rt = match shared.runtime.lock() {
                    Ok(guard) => guard,
                    Err(_) => continue,
                };
                rt.lcu_connected = lcu_connected;
                rt.gameflow_phase = gameflow_phase.clone();

                let mut action = PollerRecAction::None;
                match live_result {
                    LiveClientPollResult::Active(payload) => {
                        post_game_latch_ticks = 0;
                        shared.live_miss_streak.store(0, Ordering::SeqCst);
                        rt.phase = "in_game".to_string();
                        rt.live_client_connected = true;
                        let game_time = payload
                            .pointer("/gameData/gameTime")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let has_session = shared.recorder.has_active_session();
                        if !rec_settings.enabled && has_session {
                            action = PollerRecAction::Stop;
                        } else if rec_settings.enabled
                            && game_time >= 1.0
                            && is_playable_live_match(&payload, lcu_connected, &gameflow_phase)
                        {
                            action = PollerRecAction::SyncOrStart(game_time);
                        }
                        rt.live_game = Some(payload);
                    }
                    LiveClientPollResult::Loading => {
                        post_game_latch_ticks = 0;
                        rec_attempted_for_match = false;
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
                            action = PollerRecAction::Stop;
                            rec_attempted_for_match = false;
                            rt.live_client_connected = false;
                            rt.live_game = None;
                            if let Some(cs) = champ_select {
                                post_game_latch_ticks = 0;
                                last_queue_is_ranked = Some(cs.is_ranked_solo_duo);
                                rt.phase = "champ_select".to_string();
                                rt.champ_select = Some(cs);
                            } else {
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
                                    if matches!(
                                        gameflow_phase.as_str(),
                                        "None"
                                            | "Lobby"
                                            | "EndOfGame"
                                            | "PreEndOfGame"
                                            | "WaitingForStats"
                                    ) {
                                        last_queue_is_ranked = None;
                                    }
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
                (rt.clone(), action)
            };

            // Execute WGC recording start/sync/stop OUTSIDE shared.runtime lock
            match rec_action {
                PollerRecAction::SyncOrStart(game_time) => {
                    if let Some((rec_id, elapsed_sec)) =
                        pre_lcu_elapsed.or_else(|| shared.recorder.current_elapsed_sec())
                    {
                        if let Ok(conn) = shared.db.lock() {
                            let now_str = chrono::Utc::now().to_rfc3339();
                            let _ = storage::insert_recording_sync_point(
                                &conn,
                                &rec_id,
                                game_time,
                                elapsed_sec,
                                &now_str,
                            );
                        }
                    } else {
                        if shared.recorder.has_active_session() {
                            stop_and_finalize_active_recording_async(&shared).await;
                        }
                        if !rec_attempted_for_match {
                            if rec_settings.auto_record_ranked && last_queue_is_ranked.is_none() {
                                if let Some(ref creds) = lcu_creds {
                                    if let Some(queue_id) =
                                        lcu::fetch_gameflow_queue_id(&shared.loopback_client, creds)
                                            .await
                                    {
                                        last_queue_is_ranked = Some(queue_id == 420);
                                    }
                                }
                            }
                            rec_attempted_for_match = true;
                            let skip_for_non_ranked = rec_settings.auto_record_ranked
                                && last_queue_is_ranked != Some(true);
                            if !skip_for_non_ranked {
                                let shared_rec = Arc::clone(&shared);
                                let preset = rec_settings.preset.clone();
                                let install_path_clone = install_path.clone();
                                let start_res = tokio::task::spawn_blocking(move || {
                                    shared_rec.recorder.start_recording(
                                        &shared_rec.recordings_dir,
                                        &preset,
                                        &install_path_clone,
                                    )
                                })
                                .await;
                                match start_res {
                                    Ok(Ok(started)) => {
                                        if let Ok(conn) = shared.db.lock() {
                                            let row = RecordingRecord {
                                                id: started.recording_id.clone(),
                                                match_id: None,
                                                file_path: started.file_path,
                                                started_at: started.started_at,
                                                ended_at: None,
                                                duration_sec: 0.0,
                                                size_bytes: 0,
                                                width: started.width,
                                                height: started.height,
                                                fps: started.fps,
                                                preset: started.preset,
                                                encoder_name: started.encoder_name,
                                                sync_offset_sec: 0.0,
                                                pinned: false,
                                                status: "recording".to_string(),
                                            };
                                            let _ = storage::insert_recording_started(&conn, &row);
                                            let now_str = chrono::Utc::now().to_rfc3339();
                                            let _ = storage::insert_recording_sync_point(
                                                &conn,
                                                &started.recording_id,
                                                game_time,
                                                0.0,
                                                &now_str,
                                            );
                                        }
                                    }
                                    Ok(Err(err)) => {
                                        tracing::warn!(
                                            error = %err,
                                            "Opt-in WGC recorder could not start"
                                        );
                                    }
                                    Err(err) => {
                                        tracing::warn!(
                                            error = %err,
                                            "Blocking WGC recorder start panicked"
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                PollerRecAction::Stop => {
                    if shared.recorder.has_active_session() {
                        stop_and_finalize_active_recording_async(&shared).await;
                    }
                }
                PollerRecAction::None => {}
            }

            if let Some((_id, elapsed)) = shared.recorder.current_elapsed_sec() {
                updated_snapshot.recording_status = "recording".to_string();
                updated_snapshot.recording_elapsed_sec = elapsed;
            } else {
                updated_snapshot.recording_status = "idle".to_string();
                updated_snapshot.recording_elapsed_sec = 0.0;
            }
            if let Ok(mut rt) = shared.runtime.lock() {
                rt.recording_status = updated_snapshot.recording_status.clone();
                rt.recording_elapsed_sec = updated_snapshot.recording_elapsed_sec;
            }

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
            let recordings_dir = app_dir.join("recordings");
            let pack_dir = app_dir.join("packs");
            let _ = std::fs::create_dir_all(&recordings_dir);
            let _ = std::fs::create_dir_all(&pack_dir);
            init_file_logging(&log_dir);

            let db_path = app_dir.join("betterjungler.db");
            let conn = storage::init_database(&db_path)?;
            let _ = storage::reconcile_interrupted_recordings(&conn);
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
            overlay_ctrl.set_custom_position(
                None,
                initial_settings.hud_x,
                initial_settings.hud_y,
                false,
            );

            if let Some(main_win) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon().cloned() {
                    if let Err(err) = main_win.set_icon(icon) {
                        tracing::warn!(error = %err, "Failed to bind main window taskbar icon");
                    }
                }
                let saved_dims = (
                    initial_settings.window_width,
                    initial_settings.window_height,
                );
                if let (Some(w), Some(h)) = saved_dims {
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
                recordings_dir,
                recorder: Arc::new(recorder::RecorderManager::default()),
                recording_settings: Arc::new(RwLock::new(initial_settings.recording)),
                hardware_probe_cache: Mutex::new(None),
                clip_seq: AtomicU64::new(1),
                live_miss_streak: Arc::new(AtomicU8::new(0)),
                pending_update: Mutex::new(None),
                log_dir,
                pack_dir,
            });

            let quit_shared = shared.clone();
            let on_quit: Arc<dyn Fn(&AppHandle) + Send + Sync> = Arc::new(move |handle| {
                stop_and_finalize_active_recording(&quit_shared);
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

            let lock_shared = shared.clone();
            let on_toggle_lock: Arc<dyn Fn(&AppHandle) + Send + Sync> = Arc::new(move |handle| {
                let next_locked = !lock_shared.overlay.is_hud_locked();
                if let Err(err) = apply_hud_lock_state(handle, &lock_shared, next_locked) {
                    tracing::warn!(error = %err, "Failed to toggle HUD drag lock via tray");
                }
            });

            if let Err(err) = overlay::setup_overlay_controls(
                app.handle(),
                overlay_ctrl,
                &initial_hotkey,
                on_toggle_lock,
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
            test_ai_connection,
            update_overlay_preferences,
            set_hud_locked,
            save_hud_position,
            reset_hud_position,
            get_lp_history,
            check_riot_api_key_health,
            get_app_meta,
            open_logs_folder,
            check_update,
            install_update,
            stage_update,
            probe_hardware_encoder,
            get_recording_status,
            list_recordings,
            get_match_recording,
            toggle_recording_pin,
            delete_recording,
            save_recording_clip,
            delete_recording_clip,
            open_recordings_folder,
            get_personal_learning_snapshot,
            get_active_patch_pack,
            install_signed_patch_pack,
            inspect_replay_config,
            set_replay_api_enabled,
            seek_riot_replay
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
            profile_icon_id: Some(29),
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

    #[test]
    fn live_match_detection_ignores_replay_and_spectator_sessions() {
        let live_payload = serde_json::json!({
            "activePlayer": { "riotId": "JungleMain#EUW", "summonerName": "JungleMain" },
            "gameData": { "gameTime": 142.0 }
        });
        assert!(is_playable_live_match(&live_payload, true, "InProgress"));
        assert!(is_playable_live_match(&live_payload, false, "None"));
        assert!(!is_playable_live_match(&live_payload, true, "None"));
        assert!(!is_playable_live_match(&live_payload, true, "Lobby"));

        let replay_payload = serde_json::json!({
            "activePlayer": { "error": "Spectator mode doesn't currently support this feature" },
            "gameData": { "gameTime": 420.0 }
        });
        assert!(!is_playable_live_match(&replay_payload, false, "None"));
        assert!(!is_playable_live_match(&replay_payload, true, "InProgress"));
    }
}
