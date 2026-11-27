use std::sync::Mutex;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{AppError, AppResult};

pub struct PendingUpdate {
    pub version: String,
    pub update: Update,
    pub bytes: Vec<u8>,
}

pub fn normalize_update_mode(mode: &str) -> String {
    if mode.trim().eq_ignore_ascii_case("install_on_quit") {
        "install_on_quit".to_string()
    } else {
        "manual".to_string()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMetaInfo {
    pub version: String,
    pub commit_sha: String,
    pub log_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub body: Option<String>,
    pub date: Option<String>,
}

/// Hard fail-closed in-game safety gate: refuses updates unless Live Client is offline,
/// app phase is safe, gameflow phase is explicitly None/Lobby/EndOfGame, and debounce passed.
pub fn is_safe_to_install_update(
    phase: &str,
    gameflow_phase: &str,
    live_connected: bool,
    consecutive_misses: u8,
) -> bool {
    if live_connected {
        return false;
    }
    if matches!(phase, "champ_select" | "loading" | "in_game") {
        return false;
    }
    let allowed_gameflow = matches!(gameflow_phase, "None" | "Lobby" | "EndOfGame");
    if !allowed_gameflow {
        return false;
    }
    phase == "idle" || consecutive_misses >= 3
}

pub fn build_app_meta(log_dir: &str) -> AppMetaInfo {
    let raw_sha = option_env!("BETTERJUNGLER_COMMIT_SHA").unwrap_or("dev");
    let short_sha = if raw_sha.len() > 7 {
        &raw_sha[..7]
    } else {
        raw_sha
    };
    AppMetaInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        commit_sha: short_sha.to_string(),
        log_dir: log_dir.to_string(),
    }
}

pub async fn check_for_update(app: &AppHandle) -> AppResult<UpdateCheckResult> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let updater = app
        .updater()
        .map_err(|e| AppError::Updater(format!("Updater initialization failed: {e}")))?;

    match updater
        .check()
        .await
        .map_err(|e| AppError::Updater(format!("Update check failed: {e}")))?
    {
        Some(update) => Ok(UpdateCheckResult {
            available: true,
            current_version,
            latest_version: Some(update.version.clone()),
            body: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        }),
        None => Ok(UpdateCheckResult {
            available: false,
            current_version,
            latest_version: None,
            body: None,
            date: None,
        }),
    }
}

pub async fn download_and_install_update<F>(app: &AppHandle, verify_safe: F) -> AppResult<String>
where
    F: Fn() -> AppResult<()>,
{
    verify_safe()?;

    let updater = app
        .updater()
        .map_err(|e| AppError::Updater(format!("Updater initialization failed: {e}")))?;
    let update = updater
        .check()
        .await
        .map_err(|e| AppError::Updater(format!("Update check failed: {e}")))?
        .ok_or_else(|| AppError::Updater("BetterJungler is already up to date.".to_string()))?;

    let target_version = update.version.clone();
    let bytes = update
        .download(|_chunk_len, _content_len| {}, || {})
        .await
        .map_err(|e| AppError::Updater(format!("Update download failed: {e}")))?;

    // Re-check safety gate after download finishes so entering queue/champ select blocks install
    verify_safe()?;

    update
        .install(&bytes)
        .map_err(|e| AppError::Updater(format!("Update installation failed: {e}")))?;

    Ok(format!(
        "Installed BetterJungler v{target_version}; relaunching installer."
    ))
}

pub async fn stage_update_for_quit(
    app: &AppHandle,
    pending: &Mutex<Option<PendingUpdate>>,
) -> AppResult<String> {
    let updater = app
        .updater()
        .map_err(|e| AppError::Updater(format!("Updater initialization failed: {e}")))?;
    let update = updater
        .check()
        .await
        .map_err(|e| AppError::Updater(format!("Update check failed: {e}")))?
        .ok_or_else(|| AppError::Updater("BetterJungler is already up to date.".to_string()))?;

    let target_version = update.version.clone();
    if let Ok(guard) = pending.lock() {
        if guard.as_ref().map(|p| p.version.as_str()) == Some(target_version.as_str()) {
            return Ok(target_version);
        }
    }

    let bytes = update
        .download(|_chunk_len, _content_len| {}, || {})
        .await
        .map_err(|e| AppError::Updater(format!("Update download failed: {e}")))?;

    let mut guard = pending
        .lock()
        .map_err(|e| AppError::Updater(format!("Pending update lock failed: {e}")))?;
    *guard = Some(PendingUpdate {
        version: target_version.clone(),
        update,
        bytes,
    });
    Ok(target_version)
}

pub fn apply_staged_update_if_safe(
    pending: &Mutex<Option<PendingUpdate>>,
    is_safe: bool,
) -> AppResult<bool> {
    if !is_safe {
        return Ok(false);
    }
    let staged = pending
        .lock()
        .map_err(|e| AppError::Updater(format!("Pending update lock failed: {e}")))?
        .take();
    let Some(item) = staged else {
        return Ok(false);
    };
    tracing::info!(version = %item.version, "Installing staged BetterJungler update on quit");
    item.update
        .install(&item.bytes)
        .map_err(|e| AppError::Updater(format!("Update installation failed: {e}")))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_update_only_when_idle_lobby_or_safe_post_game() {
        assert!(is_safe_to_install_update("idle", "None", false, 0));
        assert!(is_safe_to_install_update("idle", "Lobby", false, 0));
        assert!(is_safe_to_install_update("post_game", "EndOfGame", false, 3));
    }

    #[test]
    fn blocks_update_on_unknown_empty_or_active_gameflow_states() {
        assert!(!is_safe_to_install_update("champ_select", "ChampSelect", false, 3));
        assert!(!is_safe_to_install_update("loading", "GameStart", false, 3));
        assert!(!is_safe_to_install_update("in_game", "InProgress", true, 0));
        assert!(!is_safe_to_install_update("idle", "Reconnect", false, 5));
        assert!(!is_safe_to_install_update("idle", "Matchmaking", false, 5));
        assert!(!is_safe_to_install_update("idle", "Unknown", false, 5));
        assert!(!is_safe_to_install_update("idle", "", false, 5));
        assert!(!is_safe_to_install_update("post_game", "EndOfGame", false, 1));
    }

    #[test]
    fn normalizes_update_mode_with_manual_fallback() {
        assert_eq!(normalize_update_mode("install_on_quit"), "install_on_quit");
        assert_eq!(normalize_update_mode(" INSTALL_ON_QUIT "), "install_on_quit");
        assert_eq!(normalize_update_mode("manual"), "manual");
        assert_eq!(normalize_update_mode("auto"), "manual");
        assert_eq!(normalize_update_mode(""), "manual");
    }

    #[test]
    fn apply_staged_update_respects_safety_gate_and_empty_state() {
        let pending: Mutex<Option<PendingUpdate>> = Mutex::new(None);
        assert!(!apply_staged_update_if_safe(&pending, false).expect("unsafe returns false"));
        assert!(!apply_staged_update_if_safe(&pending, true).expect("empty returns false"));
    }
}
