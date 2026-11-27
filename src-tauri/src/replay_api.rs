use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::lcu::assert_loopback_url;

const REPLAY_PLAYBACK_URL: &str = "https://127.0.0.1:2999/replay/playback";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameCfgReplayStatus {
    pub cfg_exists: bool,
    pub cfg_path: String,
    pub replay_api_enabled: bool,
    pub window_mode: String,
    pub preview_diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoflReplayInfo {
    pub match_id: String,
    pub file_name: String,
    pub file_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayPlaybackState {
    pub connected: bool,
    pub time: f64,
    pub length: f64,
    pub paused: bool,
    pub speed: f64,
}

impl Default for ReplayPlaybackState {
    fn default() -> Self {
        Self {
            connected: false,
            time: 0.0,
            length: 0.0,
            paused: false,
            speed: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaySeekResult {
    pub status: String,
    pub message: String,
    pub target_sec: f64,
    pub playback: Option<ReplayPlaybackState>,
    pub rofl: Option<RoflReplayInfo>,
}

pub fn resolve_game_cfg_path(lol_install_path: &str) -> PathBuf {
    PathBuf::from(lol_install_path)
        .join("Config")
        .join("game.cfg")
}

pub fn parse_game_cfg_status(contents: &str) -> (bool, String) {
    let mut in_general = false;
    let mut replay_enabled = false;
    let mut window_mode = "unknown".to_string();

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            in_general = line.eq_ignore_ascii_case("[General]");
            continue;
        }
        if !in_general {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            let val = v.trim();
            if key.eq_ignore_ascii_case("EnableReplayApi") {
                replay_enabled = val == "1" || val.eq_ignore_ascii_case("true");
            } else if key.eq_ignore_ascii_case("WindowMode") {
                window_mode = match val {
                    "0" => "fullscreen".to_string(),
                    "1" => "windowed".to_string(),
                    "2" => "borderless".to_string(),
                    _ => "unknown".to_string(),
                };
            }
        }
    }

    (replay_enabled, window_mode)
}

pub fn rewrite_game_cfg_replay_api(contents: &str, enable: bool) -> String {
    let target_val = if enable { "1" } else { "0" };
    let target_line = format!("EnableReplayApi={target_val}");
    let newline = if contents.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };

    let mut lines: Vec<String> = contents.lines().map(ToString::to_string).collect();
    let mut general_idx: Option<usize> = None;
    let mut general_end: usize = lines.len();
    let mut existing_key_idx: Option<usize> = None;

    for (idx, raw) in lines.iter().enumerate() {
        let trimmed = raw.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            if trimmed.eq_ignore_ascii_case("[General]") {
                general_idx = Some(idx);
            } else if general_idx.is_some() {
                general_end = idx;
                break;
            }
            continue;
        }
        if general_idx.is_some() {
            if let Some((k, _)) = trimmed.split_once('=') {
                if k.trim().eq_ignore_ascii_case("EnableReplayApi") {
                    existing_key_idx = Some(idx);
                    break;
                }
            }
        }
    }

    match (general_idx, existing_key_idx) {
        (_, Some(idx)) => {
            lines[idx] = target_line;
        }
        (Some(_), None) => {
            lines.insert(general_end, target_line);
        }
        (None, None) => {
            let mut prefix = vec!["[General]".to_string(), target_line];
            prefix.append(&mut lines);
            lines = prefix;
        }
    }

    let mut out = lines.join(newline);
    if contents.ends_with('\n') || out.is_empty() {
        out.push_str(newline);
    }
    out
}

pub fn inspect_game_cfg(lol_install_path: &str) -> GameCfgReplayStatus {
    let cfg_path = resolve_game_cfg_path(lol_install_path);
    let cfg_str = cfg_path.to_string_lossy().to_string();
    match std::fs::read_to_string(&cfg_path) {
        Ok(contents) => {
            let (replay_api_enabled, window_mode) = parse_game_cfg_status(&contents);
            let next_val = if replay_api_enabled { 0 } else { 1 };
            GameCfgReplayStatus {
                cfg_exists: true,
                cfg_path: cfg_str,
                replay_api_enabled,
                window_mode,
                preview_diff: format!("[General]\nEnableReplayApi={next_val}"),
            }
        }
        Err(_) => GameCfgReplayStatus {
            cfg_exists: false,
            cfg_path: cfg_str,
            replay_api_enabled: false,
            window_mode: "unknown".to_string(),
            preview_diff: "[General]\nEnableReplayApi=1".to_string(),
        },
    }
}

pub fn set_game_cfg_replay_api(
    lol_install_path: &str,
    enable: bool,
) -> AppResult<GameCfgReplayStatus> {
    let install_root = PathBuf::from(lol_install_path);
    if !install_root.is_dir() {
        return Err(AppError::Storage(format!(
            "League install directory does not exist: {}",
            install_root.display()
        )));
    }
    let cfg_path = resolve_game_cfg_path(lol_install_path);
    let parent = cfg_path
        .parent()
        .ok_or_else(|| AppError::Storage("Invalid game.cfg path".to_string()))?;
    std::fs::create_dir_all(parent).map_err(|e| AppError::Storage(e.to_string()))?;

    let existing = if cfg_path.exists() {
        std::fs::read_to_string(&cfg_path).map_err(|e| {
            AppError::Storage(format!(
                "Unable to read existing game.cfg (close League first): {e}"
            ))
        })?
    } else {
        String::new()
    };

    if cfg_path.exists() {
        let bak_path = cfg_path.with_extension("cfg.bak");
        if !bak_path.exists() {
            std::fs::copy(&cfg_path, &bak_path).map_err(|e| AppError::Storage(e.to_string()))?;
        }
    }

    let updated = rewrite_game_cfg_replay_api(&existing, enable);
    let tmp_path = cfg_path.with_extension("cfg.tmp");
    std::fs::write(&tmp_path, updated.as_bytes()).map_err(|e| AppError::Storage(e.to_string()))?;
    std::fs::rename(&tmp_path, &cfg_path).map_err(|e| AppError::Storage(e.to_string()))?;

    Ok(inspect_game_cfg(lol_install_path))
}

pub fn default_replays_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME").map(PathBuf::from);

    let root = home?;
    let standard = root
        .join("Documents")
        .join("League of Legends")
        .join("Replays");
    if standard.is_dir() {
        return Some(standard);
    }
    let onedrive = root
        .join("OneDrive")
        .join("Documents")
        .join("League of Legends")
        .join("Replays");
    if onedrive.is_dir() {
        return Some(onedrive);
    }
    Some(standard)
}

pub fn normalize_match_id_to_rofl_stem(match_id: &str) -> Option<String> {
    let trimmed = match_id.trim();
    let (region, numeric) = trimmed.split_once('_')?;
    let valid_region =
        (2..=6).contains(&region.len()) && region.chars().all(|c| c.is_ascii_alphanumeric());
    let valid_num =
        (4..=18).contains(&numeric.len()) && numeric.chars().all(|c| c.is_ascii_digit());
    if valid_region && valid_num {
        Some(format!("{}-{numeric}", region.to_ascii_uppercase()))
    } else {
        None
    }
}

pub fn discover_rofl_for_match(
    match_id: &str,
    replays_dir: Option<&Path>,
) -> Option<RoflReplayInfo> {
    let stem = normalize_match_id_to_rofl_stem(match_id)?;
    let dir_buf;
    let dir = match replays_dir {
        Some(d) => d,
        None => {
            dir_buf = default_replays_dir()?;
            &dir_buf
        }
    };
    if !dir.is_dir() {
        return None;
    }

    let expected_name = format!("{stem}.rofl");
    let direct = dir.join(&expected_name);
    if let Ok(meta) = std::fs::symlink_metadata(&direct) {
        if meta.file_type().is_file() {
            return Some(RoflReplayInfo {
                match_id: match_id.to_string(),
                file_name: expected_name,
                file_path: direct.to_string_lossy().to_string(),
                size_bytes: meta.len(),
            });
        }
    }

    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let is_regular = entry.file_type().map(|t| t.is_file()).unwrap_or(false);
        if !is_regular {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.eq_ignore_ascii_case(&expected_name) {
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            return Some(RoflReplayInfo {
                match_id: match_id.to_string(),
                file_name: name,
                file_path: path.to_string_lossy().to_string(),
                size_bytes,
            });
        }
    }

    None
}

pub async fn get_replay_api_status(client: &Client) -> ReplayPlaybackState {
    let Ok(url) = assert_loopback_url(REPLAY_PLAYBACK_URL) else {
        return ReplayPlaybackState::default();
    };
    let Ok(resp) = client
        .get(url)
        .timeout(Duration::from_millis(1200))
        .send()
        .await
    else {
        return ReplayPlaybackState::default();
    };
    if !resp.status().is_success() {
        return ReplayPlaybackState::default();
    }
    let Ok(json) = resp.json::<serde_json::Value>().await else {
        return ReplayPlaybackState::default();
    };
    ReplayPlaybackState {
        connected: true,
        time: json["time"].as_f64().unwrap_or(0.0),
        length: json["length"].as_f64().unwrap_or(0.0),
        paused: json["paused"].as_bool().unwrap_or(false),
        speed: json["speed"].as_f64().unwrap_or(1.0),
    }
}

pub async fn seek_replay_api(
    client: &Client,
    time_sec: f64,
    paused: bool,
) -> AppResult<ReplayPlaybackState> {
    let url = assert_loopback_url(REPLAY_PLAYBACK_URL)?;
    let clamped = if time_sec.is_finite() {
        time_sec.max(0.0)
    } else {
        0.0
    };
    let body = serde_json::json!({
        "time": clamped,
        "paused": paused
    });
    let resp = client
        .post(url)
        .json(&body)
        .timeout(Duration::from_millis(1500))
        .send()
        .await
        .map_err(|e| AppError::Lcu(format!("Riot Replay API not reachable: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Lcu(format!(
            "Riot Replay API returned status {}",
            resp.status()
        )));
    }
    let json = resp
        .json::<serde_json::Value>()
        .await
        .map_err(|e| AppError::Lcu(e.to_string()))?;
    Ok(ReplayPlaybackState {
        connected: true,
        time: json["time"].as_f64().unwrap_or(clamped),
        length: json["length"].as_f64().unwrap_or(0.0),
        paused: json["paused"].as_bool().unwrap_or(paused),
        speed: json["speed"].as_f64().unwrap_or(1.0),
    })
}

fn strip_windows_verbatim_prefix(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    if let Some(local) = raw.strip_prefix(r"\\?\") {
        return local.to_string();
    }
    raw.to_string()
}

pub fn launch_rofl_replay(lol_install_path: &str, rofl: &RoflReplayInfo) -> AppResult<()> {
    let rofl_path = PathBuf::from(&rofl.file_path);
    let ext_ok = rofl_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("rofl"));
    let rofl_is_regular = std::fs::symlink_metadata(&rofl_path)
        .map(|m| m.file_type().is_file())
        .unwrap_or(false);
    if !ext_ok || !rofl_is_regular {
        return Err(AppError::Storage(
            "Replay .rofl file could not be verified on disk.".to_string(),
        ));
    }

    let install_root = PathBuf::from(lol_install_path);
    let game_dir = install_root.join("Game");
    let exe_path = game_dir.join("League of Legends.exe");
    if !exe_path.is_file() {
        return Err(AppError::Storage(format!(
            "League of Legends.exe not found at {}",
            exe_path.display()
        )));
    }
    let root_canon = std::fs::canonicalize(&install_root)
        .map_err(|e| AppError::Storage(format!("Invalid League install directory: {e}")))?;
    let exe_canon = std::fs::canonicalize(&exe_path)
        .map_err(|e| AppError::Storage(format!("Invalid League executable path: {e}")))?;
    if !exe_canon.starts_with(&root_canon) {
        return Err(AppError::SecurityPolicy(
            "League executable path escapes configured install directory.".to_string(),
        ));
    }

    let base_dir_arg = strip_windows_verbatim_prefix(&root_canon);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new(&exe_canon)
            .current_dir(&game_dir)
            .arg(format!("-GameBaseDir={base_dir_arg}"))
            .arg(&rofl_path)
            .spawn()
            .map_err(|e| AppError::Storage(format!("Failed to launch League replay: {e}")))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&exe_path, &game_dir, &rofl_path, &base_dir_arg);
        Err(AppError::Storage(
            "Launching .rofl replays is only supported on Windows.".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_rewrites_game_cfg_enable_replay_api() {
        let sample = "[General]\r\nWindowMode=2\r\nWaitForVerticalSync=0\r\n\r\n[HUD]\r\nMinimapScale=1.0000\r\n";
        let (enabled, mode) = parse_game_cfg_status(sample);
        assert!(!enabled);
        assert_eq!(mode, "borderless");

        let updated = rewrite_game_cfg_replay_api(sample, true);
        assert!(updated.contains("EnableReplayApi=1"));
        assert!(updated.contains("[HUD]\r\nMinimapScale=1.0000"));
        let (enabled_after, mode_after) = parse_game_cfg_status(&updated);
        assert!(enabled_after);
        assert_eq!(mode_after, "borderless");

        let disabled = rewrite_game_cfg_replay_api(&updated, false);
        let (enabled_off, _) = parse_game_cfg_status(&disabled);
        assert!(!enabled_off);
    }

    #[test]
    fn normalizes_match_id_and_discovers_rofl_safely() {
        assert_eq!(
            normalize_match_id_to_rofl_stem("EUW1_71001").as_deref(),
            Some("EUW1-71001")
        );
        assert_eq!(
            normalize_match_id_to_rofl_stem("na1_987654321").as_deref(),
            Some("NA1-987654321")
        );
        assert!(normalize_match_id_to_rofl_stem("../EUW1_71001").is_none());
        assert!(normalize_match_id_to_rofl_stem("EUW1_71001;calc").is_none());

        let tmp = std::env::temp_dir().join(format!(
            "bj_rofl_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&tmp).expect("create temp replays dir");
        let rofl_file = tmp.join("EUW1-71001.rofl");
        std::fs::write(&rofl_file, b"RIOT_ROFL_STUB").expect("write rofl");

        let found = discover_rofl_for_match("EUW1_71001", Some(&tmp)).expect("find rofl");
        assert_eq!(found.file_name, "EUW1-71001.rofl");
        assert_eq!(found.size_bytes, 14);
        assert!(discover_rofl_for_match("EUW1_99999", Some(&tmp)).is_none());

        assert_eq!(
            strip_windows_verbatim_prefix(Path::new(r"\\?\C:\Riot Games\League of Legends")),
            r"C:\Riot Games\League of Legends"
        );
        assert_eq!(
            strip_windows_verbatim_prefix(Path::new(r"\\?\UNC\server\share\League")),
            r"\\server\share\League"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
