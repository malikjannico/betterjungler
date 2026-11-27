use std::collections::HashSet;
use std::path::{Path, PathBuf};

use keyring::Entry;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "betterjungler";
const KEYRING_USER: &str = "riot_api_key";
const KEYRING_AI_USER: &str = "ai_api_key";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiCoachConfig {
    pub provider: String, // "off" | "gemini" | "openai" | "ollama"
    pub model: String,
    pub endpoint: String,
    pub has_api_key: bool,
}

impl Default for AiCoachConfig {
    fn default() -> Self {
        Self {
            provider: "off".to_string(),
            model: "gemini-3.8-flash".to_string(),
            endpoint: "http://127.0.0.1:11434".to_string(),
            has_api_key: false,
        }
    }
}

pub fn detect_lol_install_path() -> String {
    let candidates = [
        r"C:\Riot Games\League of Legends",
        r"D:\Riot Games\League of Legends",
        r"E:\Riot Games\League of Legends",
        r"F:\Riot Games\League of Legends",
        r"C:\Program Files\Riot Games\League of Legends",
        r"D:\Program Files\Riot Games\League of Legends",
    ];
    for path_str in candidates {
        let root = PathBuf::from(path_str);
        if root.join("LeagueClient.exe").exists() || root.join("Game").exists() {
            return path_str.to_string();
        }
    }
    r"C:\Riot Games\League of Legends".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RecordingSettings {
    pub enabled: bool,
    pub preset: String, // "720p30" | "1080p60" | "clips_only"
    pub max_storage_gb: u16,
    pub keep_last_n_games: u16,
    pub auto_record_ranked: bool,
    pub replay_api_enabled: bool,
}

impl Default for RecordingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preset: "720p30".to_string(),
            max_storage_gb: 5,
            keep_last_n_games: 10,
            auto_record_ranked: true,
            replay_api_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingRecord {
    pub id: String,
    pub match_id: Option<String>,
    pub file_path: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub duration_sec: f64,
    pub size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub preset: String,
    pub encoder_name: String,
    pub sync_offset_sec: f64,
    pub pinned: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingClipRecord {
    pub id: String,
    pub recording_id: String,
    pub match_id: Option<String>,
    pub label: String,
    pub kind: String,
    pub game_time_sec: f64,
    pub start_sec: f64,
    pub end_sec: f64,
    pub pinned: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalBaselineRow {
    pub key: String,
    pub value: f64,
    pub sample_n: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MistakeSignatureRow {
    pub detector_id: String,
    pub hit_matches: i64,
    pub total_hits: i64,
    pub last_timestamp_sec: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalLearningSummary {
    pub jungle_match_count: i64,
    pub baselines: Vec<PersonalBaselineRow>,
    pub mistake_signatures: Vec<MistakeSignatureRow>,
}

fn default_true() -> bool {
    true
}

fn default_jungle_role() -> String {
    "jungle".to_string()
}

fn default_bottom_role() -> String {
    "bottom".to_string()
}

pub fn normalize_coached_role(raw: &str, fallback: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "jungle" => "jungle".to_string(),
        "bottom" | "bot" | "adc" => "bottom".to_string(),
        _ => fallback.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct UserSettings {
    pub riot_id: String,
    pub region: String,
    pub lol_install_path: String,
    pub overlay_hotkey: String,
    pub hud_corner: String,
    pub hud_opacity: u8,
    pub hud_scale: u16,
    pub hud_monitor: String,
    pub minimap_side: String,
    pub hud_x: Option<i32>,
    pub hud_y: Option<i32>,
    #[serde(default = "default_true")]
    pub hud_locked: bool,
    #[serde(default = "default_jungle_role")]
    pub primary_role: String,
    #[serde(default = "default_bottom_role")]
    pub secondary_role: String,
    #[serde(default = "default_true")]
    pub auto_detect_role: bool,
    pub window_width: Option<f64>,
    pub window_height: Option<f64>,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub target_division: String,
    pub has_api_key: bool,
    pub update_mode: String,
    pub riot_api_proxy_url: String,
    pub ai_coach: AiCoachConfig,
    pub recording: RecordingSettings,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            riot_id: String::new(),
            region: "EUW1".to_string(),
            lol_install_path: detect_lol_install_path(),
            overlay_hotkey: "Alt+J".to_string(),
            hud_corner: "beside-minimap".to_string(),
            hud_opacity: 80,
            hud_scale: 100,
            hud_monitor: "primary".to_string(),
            minimap_side: "right".to_string(),
            hud_x: None,
            hud_y: None,
            hud_locked: true,
            primary_role: "jungle".to_string(),
            secondary_role: "bottom".to_string(),
            auto_detect_role: true,
            window_width: None,
            window_height: None,
            window_x: None,
            window_y: None,
            target_division: "PLATINUM IV".to_string(),
            has_api_key: false,
            update_mode: "manual".to_string(),
            riot_api_proxy_url: String::new(),
            ai_coach: AiCoachConfig::default(),
            recording: RecordingSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LpHistoryRecord {
    pub timestamp: String,
    pub tier: String,
    pub rank: String,
    pub league_points: i32,
    pub absolute_lp: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub win: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_games: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClimbGoalRecord {
    pub id: String,
    #[serde(default = "default_jungle_role")]
    pub role: String,
    pub target_division: String,
    pub metric: String,
    pub title: String,
    pub target_value: f64,
    pub current_value: f64,
    pub unit: String,
    pub lower_is_better: bool,
    pub status: String,
    pub source: String,
    pub created_at: String,
    #[serde(default)]
    pub is_focus_goal: bool,
}

pub fn init_database(db_path: &Path) -> AppResult<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Storage(e.to_string()))?;
    }
    let conn = Connection::open(db_path).map_err(|e| AppError::Storage(e.to_string()))?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn table_exists(conn: &Connection, table: &str) -> AppResult<bool> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![table],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(exists > 0)
}

fn table_has_column(conn: &Connection, table: &str, col_name: &str) -> AppResult<bool> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| AppError::Storage(e.to_string()))?;
    for row in rows {
        let name = row.map_err(|e| AppError::Storage(e.to_string()))?;
        if name == col_name {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| AppError::Storage(e.to_string()))?;

    if version < 1 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ddragon_cache (
                key TEXT PRIMARY KEY,
                patch_version TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS match_summaries (
                match_id TEXT PRIMARY KEY,
                puuid TEXT NOT NULL,
                champion_id INTEGER NOT NULL,
                win INTEGER NOT NULL,
                cs_per_min REAL NOT NULL,
                vision_per_min REAL NOT NULL,
                gd_at_15 INTEGER NOT NULL,
                played_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS match_details_cache (
                match_id TEXT PRIMARY KEY,
                puuid TEXT NOT NULL,
                played_at TEXT NOT NULL,
                summary_json TEXT NOT NULL,
                detail_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS climb_goals (
                id TEXT PRIMARY KEY,
                target_division TEXT NOT NULL,
                metric TEXT NOT NULL,
                target_value REAL NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS climb_goals_v2 (
                id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS meta_snapshots (
                id TEXT PRIMARY KEY,
                patch_version TEXT NOT NULL,
                region TEXT NOT NULL,
                payload TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lp_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                tier TEXT NOT NULL,
                rank TEXT NOT NULL,
                league_points INTEGER NOT NULL,
                absolute_lp INTEGER NOT NULL,
                win INTEGER,
                match_id TEXT
            );
            "#,
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

        if !table_has_column(conn, "lp_history", "match_id")? {
            conn.execute("ALTER TABLE lp_history ADD COLUMN match_id TEXT", [])
                .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        conn.pragma_update(None, "user_version", 1_i64)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    if version < 2 {
        if !table_has_column(conn, "lp_history", "total_games")? {
            conn.execute("ALTER TABLE lp_history ADD COLUMN total_games INTEGER", [])
                .map_err(|e| AppError::Storage(e.to_string()))?;
        }

        conn.execute_batch(
            r#"
            DELETE FROM lp_history
            WHERE match_id IS NOT NULL
              AND id NOT IN (
                SELECT MIN(id) FROM lp_history WHERE match_id IS NOT NULL GROUP BY match_id
              );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_history_match_id
              ON lp_history(match_id) WHERE match_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS matches_fact (
                match_id TEXT PRIMARY KEY,
                puuid TEXT NOT NULL,
                played_at TEXT NOT NULL,
                champion_id INTEGER NOT NULL,
                champion_name TEXT NOT NULL,
                win INTEGER NOT NULL,
                duration_sec INTEGER NOT NULL,
                map_side TEXT NOT NULL,
                kills INTEGER NOT NULL,
                deaths INTEGER NOT NULL,
                assists INTEGER NOT NULL,
                role TEXT NOT NULL DEFAULT 'JUNGLE'
            );

            CREATE TABLE IF NOT EXISTS match_metrics (
                match_id TEXT PRIMARY KEY,
                cs_per_min REAL NOT NULL,
                cs_at_4 INTEGER,
                cs_at_5 INTEGER,
                cs_at_10 INTEGER,
                gold_diff_at_10 INTEGER,
                gold_diff_at_15 INTEGER,
                xp_diff_at_15 INTEGER,
                vision_per_min REAL NOT NULL,
                control_wards INTEGER NOT NULL,
                objective_share_pct INTEGER,
                kill_participation_pct INTEGER NOT NULL,
                early_deaths INTEGER NOT NULL,
                pre_obj_deaths INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS match_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                match_id TEXT NOT NULL,
                timestamp_sec INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                killer_id INTEGER,
                victim_id INTEGER,
                x INTEGER,
                y INTEGER,
                monster_type TEXT,
                ward_type TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_match_events_match_ts
              ON match_events(match_id, timestamp_sec);

            CREATE TABLE IF NOT EXISTS mistake_hits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                match_id TEXT NOT NULL,
                detector_id TEXT NOT NULL,
                timestamp_sec INTEGER NOT NULL,
                severity TEXT NOT NULL,
                detail TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_mistake_hits_detector_match
              ON mistake_hits(detector_id, match_id);

            CREATE TABLE IF NOT EXISTS baselines (
                key TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                value REAL NOT NULL,
                sample_n INTEGER NOT NULL,
                updated_at TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

        conn.pragma_update(None, "user_version", 2_i64)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    if version < 3 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS recordings (
                id TEXT PRIMARY KEY,
                match_id TEXT,
                file_path TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                duration_sec REAL NOT NULL DEFAULT 0,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                width INTEGER NOT NULL DEFAULT 1280,
                height INTEGER NOT NULL DEFAULT 720,
                fps INTEGER NOT NULL DEFAULT 30,
                preset TEXT NOT NULL DEFAULT '720p30',
                encoder_name TEXT NOT NULL DEFAULT '',
                sync_offset_sec REAL NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'recording'
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_recordings_match_id
              ON recordings(match_id) WHERE match_id IS NOT NULL;

            CREATE INDEX IF NOT EXISTS idx_recordings_started_at
              ON recordings(started_at DESC);

            CREATE TABLE IF NOT EXISTS recording_sync_points (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recording_id TEXT NOT NULL,
                game_time_sec REAL NOT NULL,
                video_elapsed_sec REAL NOT NULL,
                recorded_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_recording_sync_points_rec
              ON recording_sync_points(recording_id);

            CREATE TABLE IF NOT EXISTS recording_clips (
                id TEXT PRIMARY KEY,
                recording_id TEXT NOT NULL,
                match_id TEXT,
                label TEXT NOT NULL,
                kind TEXT NOT NULL,
                game_time_sec REAL NOT NULL,
                start_sec REAL NOT NULL,
                end_sec REAL NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_recording_clips_rec
              ON recording_clips(recording_id);
            "#,
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

        conn.pragma_update(None, "user_version", 3_i64)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    if version < 4 {
        if !table_has_column(conn, "matches_fact", "role")? {
            conn.execute_batch(
                "ALTER TABLE matches_fact ADD COLUMN role TEXT NOT NULL DEFAULT 'JUNGLE';",
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        conn.execute(
            "DELETE FROM mistake_hits
             WHERE match_id IN (SELECT match_id FROM matches_fact WHERE role != 'JUNGLE')",
            [],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
        conn.pragma_update(None, "user_version", 4_i64)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    if version < 5 {
        ensure_v6_columns(conn)?;
        if version == 4 {
            backfill_match_facts(conn)?;
        }
        conn.pragma_update(None, "user_version", 5_i64)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    if version < 6 {
        ensure_v6_columns(conn)?;
        backfill_match_facts(conn)?;
        conn.pragma_update(None, "user_version", 6_i64)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    Ok(())
}

fn ensure_v6_columns(conn: &Connection) -> AppResult<()> {
    if !table_has_column(conn, "climb_goals", "role")? {
        conn.execute_batch(
            "ALTER TABLE climb_goals ADD COLUMN role TEXT NOT NULL DEFAULT 'jungle';",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    }
    for (col, ddl) in [
        (
            "damage_share",
            "ALTER TABLE match_metrics ADD COLUMN damage_share REAL NOT NULL DEFAULT 0;",
        ),
        (
            "turret_plates",
            "ALTER TABLE match_metrics ADD COLUMN turret_plates INTEGER NOT NULL DEFAULT 0;",
        ),
        (
            "deaths_pre_14",
            "ALTER TABLE match_metrics ADD COLUMN deaths_pre_14 INTEGER NOT NULL DEFAULT 0;",
        ),
        (
            "gd_at_15_lane",
            "ALTER TABLE match_metrics ADD COLUMN gd_at_15_lane INTEGER;",
        ),
    ] {
        if !table_has_column(conn, "match_metrics", col)? {
            conn.execute_batch(ddl)
                .map_err(|e| AppError::Storage(e.to_string()))?;
        }
    }
    Ok(())
}

pub fn normalize_recording_preset(raw: &str) -> String {
    match raw {
        "1080p60" => "1080p60".to_string(),
        "clips_only" => "clips_only".to_string(),
        _ => "720p30".to_string(),
    }
}

pub fn load_settings(conn: &Connection) -> AppResult<UserSettings> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = 'user_settings'")
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut rows = stmt
        .query([])
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut settings =
        if let Some(row) = rows.next().map_err(|e| AppError::Storage(e.to_string()))? {
            let json: String = row.get(0).map_err(|e| AppError::Storage(e.to_string()))?;
            serde_json::from_str::<UserSettings>(&json).unwrap_or_default()
        } else {
            UserSettings::default()
        };

    settings.hud_opacity = settings.hud_opacity.clamp(70, 100);
    settings.recording.preset = normalize_recording_preset(&settings.recording.preset);
    settings.recording.max_storage_gb = settings.recording.max_storage_gb.clamp(1, 50);
    settings.recording.keep_last_n_games = settings.recording.keep_last_n_games.clamp(1, 100);
    settings.primary_role = normalize_coached_role(&settings.primary_role, "jungle");
    settings.secondary_role = normalize_coached_role(&settings.secondary_role, "bottom");
    if settings.lol_install_path.trim().is_empty()
        || !PathBuf::from(&settings.lol_install_path).exists()
    {
        settings.lol_install_path = detect_lol_install_path();
    }
    settings.has_api_key = has_riot_api_key();
    settings.ai_coach.has_api_key = has_ai_api_key();
    Ok(settings)
}

pub fn save_settings(conn: &Connection, settings: &UserSettings) -> AppResult<()> {
    let json = serde_json::to_string(settings).map_err(|e| AppError::Storage(e.to_string()))?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('user_settings', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

fn find_frame_by_minute(frames: &[Value], minute: i64) -> Option<&Value> {
    frames.iter().find(|f| f["minute"].as_i64() == Some(minute))
}

fn with_savepoint<F>(conn: &Connection, name: &str, f: F) -> AppResult<()>
where
    F: FnOnce() -> AppResult<()>,
{
    conn.execute_batch(&format!("SAVEPOINT {name};"))
        .map_err(|e| AppError::Storage(e.to_string()))?;
    match f() {
        Ok(()) => {
            conn.execute_batch(&format!("RELEASE SAVEPOINT {name};"))
                .map_err(|e| AppError::Storage(e.to_string()))?;
            Ok(())
        }
        Err(err) => {
            let _ = conn.execute_batch(&format!("ROLLBACK TO {name}; RELEASE SAVEPOINT {name};"));
            Err(err)
        }
    }
}

fn upsert_match_facts(
    conn: &Connection,
    match_id: &str,
    puuid: &str,
    played_at: &str,
    detail: &Value,
) -> AppResult<()> {
    with_savepoint(conn, "sp_upsert_match_facts", || {
        upsert_match_facts_inner(conn, match_id, puuid, played_at, detail, true)
    })
}

fn upsert_match_facts_inner(
    conn: &Connection,
    match_id: &str,
    puuid: &str,
    played_at: &str,
    detail: &Value,
    recompute_baselines: bool,
) -> AppResult<()> {
    let champion_id = detail["championId"].as_i64().unwrap_or(0);
    let champion_name = detail["championName"].as_str().unwrap_or("Unknown");
    let win = if detail["win"].as_bool().unwrap_or(false) {
        1_i64
    } else {
        0_i64
    };
    let duration_sec = detail["durationSeconds"].as_i64().unwrap_or(0);
    let map_side = detail["mapSide"].as_str().unwrap_or("blue");
    let kills = detail["kills"].as_i64().unwrap_or(0);
    let deaths = detail["deaths"].as_i64().unwrap_or(0);
    let assists = detail["assists"].as_i64().unwrap_or(0);
    let role = detail["role"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .map(crate::riot_api::normalize_participant_role)
        .unwrap_or("JUNGLE");

    conn.execute(
        "INSERT INTO matches_fact (
            match_id, puuid, played_at, champion_id, champion_name,
            win, duration_sec, map_side, kills, deaths, assists, role
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(match_id) DO UPDATE SET
            puuid = excluded.puuid,
            played_at = excluded.played_at,
            champion_id = excluded.champion_id,
            champion_name = excluded.champion_name,
            win = excluded.win,
            duration_sec = excluded.duration_sec,
            map_side = excluded.map_side,
            kills = excluded.kills,
            deaths = excluded.deaths,
            assists = excluded.assists,
            role = excluded.role",
        params![
            match_id,
            puuid,
            played_at,
            champion_id,
            champion_name,
            win,
            duration_sec,
            map_side,
            kills,
            deaths,
            assists,
            role
        ],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;

    let duration_mins = (duration_sec as f64 / 60.0).max(1.0);
    let cs = detail["cs"].as_f64().unwrap_or(0.0);
    let cs_per_min = (cs / duration_mins * 10.0).round() / 10.0;
    let vision = detail["visionScore"].as_f64().unwrap_or(0.0);
    let vision_per_min = (vision / duration_mins * 100.0).round() / 100.0;
    let control_wards = detail["controlWardsBought"].as_i64().unwrap_or(0);

    let empty_values: &[Value] = &[];
    let frames = match detail["frames"].as_array() {
        Some(arr) => arr.as_slice(),
        None => empty_values,
    };
    let frame4 = find_frame_by_minute(frames, 4);
    let frame5 = find_frame_by_minute(frames, 5);
    let frame6 = find_frame_by_minute(frames, 6);
    let frame10 = find_frame_by_minute(frames, 10);
    let frame11 = find_frame_by_minute(frames, 11);
    let frame15 = find_frame_by_minute(frames, 15);

    let cs_at_4 = if duration_sec >= 240 {
        frame4.and_then(|f| f["cs"].as_i64())
    } else {
        None
    };
    let cs_at_5 = if duration_sec >= 300 {
        frame5.and_then(|f| f["cs"].as_i64()).or_else(|| {
            let a = frame4.and_then(|f| f["cs"].as_i64())?;
            let b = frame6.and_then(|f| f["cs"].as_i64())?;
            Some((a + b + 1) / 2)
        })
    } else {
        None
    };
    let cs_at_10 = if duration_sec >= 600 {
        frame10.or(frame11).and_then(|f| f["cs"].as_i64())
    } else {
        None
    };
    let gd_10 = frame10.map(|f| {
        f["totalGold"].as_i64().unwrap_or(0) - f["enemyJunglerGold"].as_i64().unwrap_or(0)
    });
    let gd_15 = if duration_sec >= 900 {
        frame15.map(|f| {
            f["totalGold"].as_i64().unwrap_or(0) - f["enemyJunglerGold"].as_i64().unwrap_or(0)
        })
    } else {
        None
    };
    let gd_15_lane = if duration_sec >= 900 {
        frame15.map(|f| {
            let opp_gold = f["laneOpponentGold"]
                .as_i64()
                .unwrap_or_else(|| f["enemyJunglerGold"].as_i64().unwrap_or(0));
            f["totalGold"].as_i64().unwrap_or(0) - opp_gold
        })
    } else {
        None
    };
    let xp_15 = if duration_sec >= 900 {
        frame15.map(|f| f["xp"].as_i64().unwrap_or(0) - f["enemyJunglerXp"].as_i64().unwrap_or(0))
    } else {
        None
    };
    let dmg_self = detail["damageDealtToChampions"].as_f64().unwrap_or(0.0);
    let dmg_team = detail["teamTotalDamage"].as_f64().unwrap_or(0.0);
    let damage_share = if dmg_team > 0.0 {
        ((dmg_self / dmg_team) * 1000.0).round() / 10.0
    } else {
        0.0
    };
    let turret_plates = detail["turretPlatesTaken"].as_i64().unwrap_or(0);

    let team_obj = detail["teamObjectives"].as_i64().unwrap_or(0);
    let enemy_obj = detail["enemyObjectives"].as_i64().unwrap_or(0);
    let total_obj = team_obj + enemy_obj;
    let obj_share = if total_obj > 0 {
        Some(((team_obj as f64 / total_obj as f64) * 100.0).round() as i64)
    } else {
        None
    };
    let team_kills = detail["teamKills"].as_i64().unwrap_or(0);
    let kp_pct = if team_kills > 0 {
        (((kills + assists) as f64 / team_kills as f64) * 100.0)
            .round()
            .min(100.0) as i64
    } else {
        0
    };

    let player_pid = detail["playerParticipantId"].as_i64().unwrap_or(0);
    let my_team_id = if map_side == "red" { 200_i64 } else { 100_i64 };
    let events = match detail["events"].as_array() {
        Some(arr) => arr.as_slice(),
        None => empty_values,
    };

    let mut enemy_monster_ts = Vec::new();
    let mut player_death_ts = Vec::new();
    for ev in events {
        let ev_type = ev["type"].as_str().unwrap_or("");
        let ts = ev["timestampSec"].as_i64().unwrap_or(0);
        if ev_type == "ELITE_MONSTER_KILL"
            && ev["killerTeamId"].as_i64().is_some_and(|t| t != my_team_id)
        {
            enemy_monster_ts.push(ts);
        } else if ev_type == "CHAMPION_KILL" && ev["victimId"].as_i64() == Some(player_pid) {
            player_death_ts.push(ts);
        }
    }
    player_death_ts.sort_unstable();
    let early_deaths = player_death_ts.iter().filter(|&&ts| ts < 600).count() as i64;
    let deaths_pre_14 = player_death_ts.iter().filter(|&&ts| ts < 840).count() as i64;
    let spawn_windows = [175_i64, 300, 480, 900, 1200];
    let pre_obj_ts: Vec<i64> = player_death_ts
        .iter()
        .copied()
        .filter(|&d_ts| {
            enemy_monster_ts
                .iter()
                .any(|&o_ts| d_ts <= o_ts && o_ts - d_ts <= 55)
                || spawn_windows
                    .iter()
                    .any(|&sp| d_ts <= sp && sp - d_ts <= 45)
        })
        .collect();
    let pre_obj_deaths = pre_obj_ts.len() as i64;

    conn.execute(
        "INSERT INTO match_metrics (
            match_id, cs_per_min, cs_at_4, cs_at_5, cs_at_10,
            gold_diff_at_10, gold_diff_at_15, xp_diff_at_15, vision_per_min,
            control_wards, objective_share_pct, kill_participation_pct,
            early_deaths, pre_obj_deaths, damage_share, turret_plates,
            deaths_pre_14, gd_at_15_lane
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
         ON CONFLICT(match_id) DO UPDATE SET
            cs_per_min = excluded.cs_per_min,
            cs_at_4 = excluded.cs_at_4,
            cs_at_5 = excluded.cs_at_5,
            cs_at_10 = excluded.cs_at_10,
            gold_diff_at_10 = excluded.gold_diff_at_10,
            gold_diff_at_15 = excluded.gold_diff_at_15,
            xp_diff_at_15 = excluded.xp_diff_at_15,
            vision_per_min = excluded.vision_per_min,
            control_wards = excluded.control_wards,
            objective_share_pct = excluded.objective_share_pct,
            kill_participation_pct = excluded.kill_participation_pct,
            early_deaths = excluded.early_deaths,
            pre_obj_deaths = excluded.pre_obj_deaths,
            damage_share = excluded.damage_share,
            turret_plates = excluded.turret_plates,
            deaths_pre_14 = excluded.deaths_pre_14,
            gd_at_15_lane = excluded.gd_at_15_lane",
        params![
            match_id,
            cs_per_min,
            cs_at_4,
            cs_at_5,
            cs_at_10,
            gd_10,
            gd_15,
            xp_15,
            vision_per_min,
            control_wards,
            obj_share,
            kp_pct,
            early_deaths,
            pre_obj_deaths,
            damage_share,
            turret_plates,
            deaths_pre_14,
            gd_15_lane
        ],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;

    let has_events: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM match_events WHERE match_id = ?1",
            params![match_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if has_events == 0 {
        for ev in events {
            let ev_type = ev["type"].as_str().unwrap_or("");
            if ev_type.is_empty() {
                continue;
            }
            let ts = ev["timestampSec"].as_i64().unwrap_or(0);
            let killer_id = ev["killerId"].as_i64();
            let victim_id = ev["victimId"].as_i64();
            let pos = ev.get("position");
            let x = pos.and_then(|p| p["x"].as_i64());
            let y = pos.and_then(|p| p["y"].as_i64());
            let monster_type = ev["monsterType"].as_str();
            let ward_type = ev["wardType"].as_str();
            conn.execute(
                "INSERT INTO match_events (
                    match_id, timestamp_sec, event_type, killer_id, victim_id,
                    x, y, monster_type, ward_type
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    match_id,
                    ts,
                    ev_type,
                    killer_id,
                    victim_id,
                    x,
                    y,
                    monster_type,
                    ward_type
                ],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
    }

    conn.execute(
        "DELETE FROM mistake_hits WHERE match_id = ?1",
        params![match_id],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;

    if role == "JUNGLE" && duration_sec >= 300 {
        for d_ts in &pre_obj_ts {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'pre_obj_death', ?2, 'high', 'Died before major objective spawn/take')",
                params![match_id, d_ts],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        if early_deaths >= 2 {
            let second_early_ts = player_death_ts
                .iter()
                .copied()
                .filter(|&ts| ts < 600)
                .nth(1)
                .unwrap_or(540);
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'early_death_before_10', ?2, 'medium', '2+ deaths before 10:00 surrendered early tempo')",
                params![match_id, second_early_ts],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        if duration_sec >= 900 && cs_per_min < 5.7 {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'midgame_farm_drop', 900, 'medium', 'Low camp cycling kept CS/min below 5.7')",
                params![match_id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        if duration_sec >= 720 && (control_wards <= 1 || vision_per_min < 0.70) {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'blind_river_vision', 720, 'medium', 'Low Control Ward and vision/min setup around neutral pits')",
                params![match_id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        if duration_sec >= 900 && gd_15.is_some_and(|gd| gd <= -400) {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'early_gold_deficit_15', 900, 'medium', 'Fell 400g+ behind enemy jungler by 15:00')",
                params![match_id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
    } else if role == "BOTTOM" && duration_sec >= 300 {
        for d_ts in &pre_obj_ts {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'adc_pre_obj_death', ?2, 'high', 'Caught before neutral objective setup')",
                params![match_id, d_ts],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        if duration_sec >= 600 && cs_at_10.is_some_and(|c| c < 64) {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'adc_cs_deficit_10', 600, 'medium', 'Missed laning waves kept CS@10 below 64')",
                params![match_id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        if deaths_pre_14 >= 2 {
            let second_ts = player_death_ts
                .iter()
                .copied()
                .filter(|&ts| ts < 840)
                .nth(1)
                .unwrap_or(600);
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'adc_lane_death_pre_14', ?2, 'medium', '2+ bot-lane deaths before 14:00 plate drop')",
                params![match_id, second_ts],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
        if duration_sec >= 900 && dmg_team > 0.0 && damage_share < 23.0 {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'adc_low_damage_share', 900, 'medium', 'Team champion damage share dropped below 23%')",
                params![match_id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
    }

    if recompute_baselines {
        recompute_jungle_baselines(conn)?;
    }

    Ok(())
}

fn compute_ewma(values_newest_first: &[f64]) -> Option<f64> {
    if values_newest_first.is_empty() {
        return None;
    }
    let mut num = 0.0_f64;
    let mut den = 0.0_f64;
    for (idx, val) in values_newest_first.iter().enumerate() {
        if !val.is_finite() {
            continue;
        }
        let weight = 0.5_f64.powf(idx as f64 / 8.0);
        num += val * weight;
        den += weight;
    }
    if den > 0.0 {
        Some(num / den)
    } else {
        None
    }
}

fn compute_jungle_baseline_rows(
    conn: &Connection,
    puuid: Option<&str>,
) -> AppResult<(i64, Vec<PersonalBaselineRow>)> {
    let mut stmt = conn
        .prepare(
            "SELECT m.cs_per_min, m.gold_diff_at_15, m.objective_share_pct,
                    m.pre_obj_deaths, m.early_deaths, m.vision_per_min, m.kill_participation_pct
             FROM match_metrics m
             INNER JOIN matches_fact f ON f.match_id = m.match_id
             WHERE f.role = 'JUNGLE'
               AND f.duration_sec >= 300
               AND (?1 IS NULL OR f.puuid = ?1)
             ORDER BY f.played_at DESC, f.match_id DESC",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![puuid], |row| {
            Ok((
                row.get::<_, f64>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut cs_vals = Vec::new();
    let mut gd15_vals = Vec::new();
    let mut obj_vals = Vec::new();
    let mut pre_vals = Vec::new();
    let mut early_vals = Vec::new();
    let mut vis_vals = Vec::new();
    let mut kp_vals = Vec::new();
    let mut n = 0_i64;

    for row in rows {
        let (cs, gd15, obj, pre, early, vis, kp) =
            row.map_err(|e| AppError::Storage(e.to_string()))?;
        n += 1;
        cs_vals.push(cs);
        if let Some(g) = gd15 {
            gd15_vals.push(g as f64);
        }
        if let Some(o) = obj {
            obj_vals.push(o as f64);
        }
        pre_vals.push(pre as f64);
        early_vals.push(early as f64);
        vis_vals.push(vis);
        kp_vals.push(kp as f64);
    }

    if n == 0 {
        return Ok((0, Vec::new()));
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    let mut out = Vec::new();
    for (b_key, vals) in [
        ("cs_per_min", &cs_vals),
        ("early_deaths", &early_vals),
        ("gold_diff_at_15", &gd15_vals),
        ("kill_participation_pct", &kp_vals),
        ("objective_share_pct", &obj_vals),
        ("pre_obj_deaths", &pre_vals),
        ("vision_per_min", &vis_vals),
    ] {
        if let Some(b_val) = compute_ewma(vals) {
            out.push(PersonalBaselineRow {
                key: b_key.to_string(),
                value: b_val,
                sample_n: vals.len() as i64,
                updated_at: now_iso.clone(),
            });
        }
    }

    Ok((n, out))
}

pub fn recompute_jungle_baselines(conn: &Connection) -> AppResult<()> {
    let (n, computed_rows) = compute_jungle_baseline_rows(conn, None)?;

    if n == 0 {
        conn.execute("DELETE FROM baselines", [])
            .map_err(|e| AppError::Storage(e.to_string()))?;
        return Ok(());
    }

    let mut present_keys = Vec::new();
    for row in &computed_rows {
        present_keys.push(row.key.as_str());
        conn.execute(
            "INSERT INTO baselines (key, scope, value, sample_n, updated_at)
             VALUES (?1, 'global', ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                sample_n = excluded.sample_n,
                updated_at = excluded.updated_at",
            params![row.key, row.value, row.sample_n, row.updated_at],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    for key in [
        "cs_per_min",
        "gold_diff_at_15",
        "objective_share_pct",
        "pre_obj_deaths",
        "early_deaths",
        "vision_per_min",
        "kill_participation_pct",
    ] {
        if !present_keys.contains(&key) {
            conn.execute("DELETE FROM baselines WHERE key = ?1", params![key])
                .map_err(|e| AppError::Storage(e.to_string()))?;
        }
    }

    Ok(())
}

pub fn load_personal_learning_summary_for_role(
    conn: &Connection,
    puuid: Option<&str>,
    role: &str,
) -> AppResult<PersonalLearningSummary> {
    let db_role = match role.trim().to_ascii_uppercase().as_str() {
        "BOTTOM" | "BOT" | "ADC" => "BOTTOM",
        _ => "JUNGLE",
    };
    if db_role == "JUNGLE" {
        return load_personal_learning_summary_for_account(conn, puuid);
    }
    if !(table_exists(conn, "matches_fact")?
        && table_exists(conn, "match_metrics")?
        && table_exists(conn, "mistake_hits")?)
    {
        return Ok(PersonalLearningSummary {
            jungle_match_count: 0,
            baselines: Vec::new(),
            mistake_signatures: Vec::new(),
        });
    }

    let scoped_puuid = puuid.map(str::trim).filter(|p| !p.is_empty());
    let mut stmt = conn
        .prepare(
            "SELECT m.cs_at_10, m.cs_per_min, COALESCE(m.gd_at_15_lane, m.gold_diff_at_15),
                    m.damage_share, m.deaths_pre_14, m.turret_plates, m.kill_participation_pct
             FROM match_metrics m
             INNER JOIN matches_fact f ON f.match_id = m.match_id
             WHERE f.role = 'BOTTOM'
               AND f.duration_sec >= 300
               AND (?1 IS NULL OR f.puuid = ?1)
             ORDER BY f.played_at DESC, f.match_id DESC",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![scoped_puuid], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut cs10_vals = Vec::new();
    let mut cs_vals = Vec::new();
    let mut gd15_vals = Vec::new();
    let mut dmg_vals = Vec::new();
    let mut d14_vals = Vec::new();
    let mut plate_vals = Vec::new();
    let mut kp_vals = Vec::new();
    let mut n = 0_i64;
    for row in rows {
        let (cs10, cs, gd15, dmg, d14, plates, kp) =
            row.map_err(|e| AppError::Storage(e.to_string()))?;
        n += 1;
        if let Some(c) = cs10 {
            cs10_vals.push(c as f64);
        }
        cs_vals.push(cs);
        if let Some(g) = gd15 {
            gd15_vals.push(g as f64);
        }
        dmg_vals.push(dmg);
        d14_vals.push(d14 as f64);
        plate_vals.push(plates as f64);
        kp_vals.push(kp as f64);
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    let mut baselines = Vec::new();
    for (b_key, vals) in [
        ("cs_at_10", &cs10_vals),
        ("cs_per_min", &cs_vals),
        ("gold_diff_at_15", &gd15_vals),
        ("damage_share_pct", &dmg_vals),
        ("deaths_pre_14", &d14_vals),
        ("turret_plates", &plate_vals),
        ("kill_participation_pct", &kp_vals),
    ] {
        if let Some(b_val) = compute_ewma(vals) {
            baselines.push(PersonalBaselineRow {
                key: b_key.to_string(),
                value: b_val,
                sample_n: vals.len() as i64,
                updated_at: now_iso.clone(),
            });
        }
    }

    let mut m_stmt = conn
        .prepare(
            "SELECT h.detector_id,
                    COUNT(DISTINCT h.match_id),
                    COUNT(*),
                    COALESCE((
                        SELECT h2.timestamp_sec
                        FROM mistake_hits h2
                        INNER JOIN matches_fact f2 ON f2.match_id = h2.match_id
                        WHERE h2.detector_id = h.detector_id
                          AND f2.role = 'BOTTOM'
                          AND f2.duration_sec >= 300
                          AND (?1 IS NULL OR f2.puuid = ?1)
                        ORDER BY f2.played_at DESC, h2.timestamp_sec DESC
                        LIMIT 1
                    ), 0)
             FROM mistake_hits h
             INNER JOIN matches_fact f ON f.match_id = h.match_id
             WHERE f.role = 'BOTTOM'
               AND f.duration_sec >= 300
               AND (?1 IS NULL OR f.puuid = ?1)
             GROUP BY h.detector_id
             ORDER BY COUNT(DISTINCT h.match_id) DESC, h.detector_id ASC",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let m_rows = m_stmt
        .query_map(params![scoped_puuid], |row| {
            Ok(MistakeSignatureRow {
                detector_id: row.get(0)?,
                hit_matches: row.get(1)?,
                total_hits: row.get(2)?,
                last_timestamp_sec: row.get(3)?,
            })
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut mistake_signatures = Vec::new();
    for row in m_rows {
        mistake_signatures.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }

    Ok(PersonalLearningSummary {
        jungle_match_count: n,
        baselines,
        mistake_signatures,
    })
}

pub fn load_personal_learning_summary_for_account(
    conn: &Connection,
    puuid: Option<&str>,
) -> AppResult<PersonalLearningSummary> {
    if !(table_exists(conn, "matches_fact")?
        && table_exists(conn, "baselines")?
        && table_exists(conn, "mistake_hits")?)
    {
        return Ok(PersonalLearningSummary {
            jungle_match_count: 0,
            baselines: Vec::new(),
            mistake_signatures: Vec::new(),
        });
    }

    let scoped_puuid = puuid.map(str::trim).filter(|p| !p.is_empty());
    let (jungle_match_count, baselines) = if let Some(p) = scoped_puuid {
        compute_jungle_baseline_rows(conn, Some(p))?
    } else {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM matches_fact WHERE role = 'JUNGLE' AND duration_sec >= 300",
                [],
                |r| r.get(0),
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut b_stmt = conn
            .prepare("SELECT key, value, sample_n, updated_at FROM baselines ORDER BY key ASC")
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let b_rows = b_stmt
            .query_map([], |row| {
                Ok(PersonalBaselineRow {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    sample_n: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let mut out = Vec::new();
        for row in b_rows {
            out.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
        }
        (count, out)
    };

    let mut m_stmt = conn
        .prepare(
            "SELECT h.detector_id,
                    COUNT(DISTINCT h.match_id),
                    COUNT(*),
                    COALESCE((
                        SELECT h2.timestamp_sec
                        FROM mistake_hits h2
                        INNER JOIN matches_fact f2 ON f2.match_id = h2.match_id
                        WHERE h2.detector_id = h.detector_id
                          AND f2.role = 'JUNGLE'
                          AND f2.duration_sec >= 300
                          AND (?1 IS NULL OR f2.puuid = ?1)
                        ORDER BY f2.played_at DESC, h2.timestamp_sec DESC
                        LIMIT 1
                    ), 0)
             FROM mistake_hits h
             INNER JOIN matches_fact f ON f.match_id = h.match_id
             WHERE f.role = 'JUNGLE'
               AND f.duration_sec >= 300
               AND (?1 IS NULL OR f.puuid = ?1)
             GROUP BY h.detector_id
             ORDER BY COUNT(DISTINCT h.match_id) DESC, h.detector_id ASC",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let m_rows = m_stmt
        .query_map(params![scoped_puuid], |row| {
            Ok(MistakeSignatureRow {
                detector_id: row.get(0)?,
                hit_matches: row.get(1)?,
                total_hits: row.get(2)?,
                last_timestamp_sec: row.get(3)?,
            })
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut mistake_signatures = Vec::new();
    for row in m_rows {
        mistake_signatures.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }

    Ok(PersonalLearningSummary {
        jungle_match_count,
        baselines,
        mistake_signatures,
    })
}

pub fn backfill_match_facts(conn: &Connection) -> AppResult<()> {
    with_savepoint(conn, "sp_backfill_match_facts", || {
        let mut stmt = conn
            .prepare("SELECT match_id, puuid, played_at, detail_json FROM match_details_cache")
            .map_err(|e| AppError::Storage(e.to_string()))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| AppError::Storage(e.to_string()))?;

        let mut cached = Vec::new();
        for r in rows {
            cached.push(r.map_err(|e| AppError::Storage(e.to_string()))?);
        }

        for (match_id, puuid, played_at, detail_json) in cached {
            if let Ok(detail) = serde_json::from_str::<Value>(&detail_json) {
                upsert_match_facts_inner(conn, &match_id, &puuid, &played_at, &detail, false)?;
            }
        }
        recompute_jungle_baselines(conn)?;
        Ok(())
    })
}

pub fn cache_match_record(
    conn: &Connection,
    match_id: &str,
    puuid: &str,
    played_at: &str,
    summary: &Value,
    detail: &Value,
) -> AppResult<()> {
    let summary_json =
        serde_json::to_string(summary).map_err(|e| AppError::Storage(e.to_string()))?;
    let detail_json =
        serde_json::to_string(detail).map_err(|e| AppError::Storage(e.to_string()))?;
    conn.execute(
        "INSERT INTO match_details_cache (match_id, puuid, played_at, summary_json, detail_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(match_id) DO UPDATE SET puuid = excluded.puuid, summary_json = excluded.summary_json, detail_json = excluded.detail_json",
        params![match_id, puuid, played_at, summary_json, detail_json],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    upsert_match_facts(conn, match_id, puuid, played_at, detail)?;
    Ok(())
}

pub fn list_cached_matches(
    conn: &Connection,
    puuid_filter: Option<&str>,
    limit: usize,
) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let filter_puuid = puuid_filter.map(str::trim).filter(|s| !s.is_empty());
    let (sql, bound_puuid): (&str, Option<&str>) = if let Some(p) = filter_puuid {
        (
            "SELECT summary_json, detail_json FROM match_details_cache WHERE puuid = ?1 ORDER BY played_at DESC LIMIT ?2",
            Some(p),
        )
    } else {
        (
            "SELECT summary_json, detail_json FROM match_details_cache ORDER BY played_at DESC LIMIT ?1",
            None,
        )
    };

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut rows_out: Vec<(String, String)> = Vec::new();
    if let Some(p) = bound_puuid {
        let rows = stmt
            .query_map(params![p, limit as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| AppError::Storage(e.to_string()))?;
        for r in rows {
            rows_out.push(r.map_err(|e| AppError::Storage(e.to_string()))?);
        }
    } else {
        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| AppError::Storage(e.to_string()))?;
        for r in rows {
            rows_out.push(r.map_err(|e| AppError::Storage(e.to_string()))?);
        }
    }

    let mut summaries = Vec::new();
    let mut details = Vec::new();
    for (s, d) in rows_out {
        if let (Ok(sv), Ok(dv)) = (
            serde_json::from_str::<Value>(&s),
            serde_json::from_str::<Value>(&d),
        ) {
            summaries.push(sv);
            details.push(dv);
        }
    }
    Ok((summaries, details))
}

pub fn get_cached_match_detail(
    conn: &Connection,
    match_id: &str,
    puuid: &str,
) -> AppResult<Option<Value>> {
    let mut stmt = conn
        .prepare("SELECT detail_json FROM match_details_cache WHERE match_id = ?1 AND puuid = ?2")
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query(params![match_id, puuid])
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if let Some(row) = rows.next().map_err(|e| AppError::Storage(e.to_string()))? {
        let json: String = row.get(0).map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(serde_json::from_str::<Value>(&json).ok())
    } else {
        Ok(None)
    }
}

pub fn list_climb_goals(conn: &Connection) -> AppResult<Vec<ClimbGoalRecord>> {
    let mut stmt = conn
        .prepare("SELECT payload FROM climb_goals_v2 ORDER BY updated_at DESC")
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut out = Vec::new();
    for row in rows {
        let raw = row.map_err(|e| AppError::Storage(e.to_string()))?;
        if let Ok(goal) = serde_json::from_str::<ClimbGoalRecord>(&raw) {
            out.push(goal);
        }
    }
    Ok(out)
}

pub fn upsert_climb_goal(conn: &Connection, goal: &ClimbGoalRecord) -> AppResult<()> {
    let payload = serde_json::to_string(goal).map_err(|e| AppError::Storage(e.to_string()))?;
    let updated_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO climb_goals_v2 (id, payload, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![goal.id, payload, updated_at],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn delete_climb_goal(conn: &Connection, goal_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM climb_goals_v2 WHERE id = ?1", params![goal_id])
        .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

/// Atomically toggles a single Match Focus goal inside one SQLite transaction.
pub fn set_focus_goal(conn: &mut Connection, goal_id: &str) -> AppResult<Vec<ClimbGoalRecord>> {
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut goals = list_climb_goals(&tx)?;
    if !goals.iter().any(|g| g.id == goal_id) {
        return Err(AppError::Storage(format!(
            "Climb goal not found: {goal_id}"
        )));
    }
    let target_was_focused = goals
        .iter()
        .find(|g| g.id == goal_id)
        .is_some_and(|g| g.is_focus_goal);
    let updated_at = chrono::Utc::now().to_rfc3339();

    for goal in &mut goals {
        let next_focus = if target_was_focused {
            false
        } else {
            goal.id == goal_id
        };
        if goal.is_focus_goal != next_focus {
            goal.is_focus_goal = next_focus;
            let payload =
                serde_json::to_string(goal).map_err(|e| AppError::Storage(e.to_string()))?;
            tx.execute(
                "UPDATE climb_goals_v2 SET payload = ?1, updated_at = ?2 WHERE id = ?3",
                params![payload, updated_at, goal.id],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
    }
    tx.commit().map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(goals)
}

pub fn save_meta_snapshot(
    conn: &Connection,
    patch: &str,
    region: &str,
    snapshot: &Value,
) -> AppResult<()> {
    let payload = serde_json::to_string(snapshot).map_err(|e| AppError::Storage(e.to_string()))?;
    let updated_at = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO meta_snapshots (id, patch_version, region, payload, updated_at)
         VALUES ('latest_high_elo', ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET patch_version = excluded.patch_version, region = excluded.region, payload = excluded.payload, updated_at = excluded.updated_at",
        params![patch, region, payload, updated_at],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn load_meta_snapshot(conn: &Connection) -> AppResult<Option<Value>> {
    let mut stmt = conn
        .prepare("SELECT payload FROM meta_snapshots WHERE id = 'latest_high_elo'")
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if let Some(row) = rows.next().map_err(|e| AppError::Storage(e.to_string()))? {
        let json: String = row.get(0).map_err(|e| AppError::Storage(e.to_string()))?;
        Ok(serde_json::from_str::<Value>(&json).ok())
    } else {
        Ok(None)
    }
}

pub fn tier_rank_to_absolute_lp(tier: &str, rank: &str, lp: i32) -> i32 {
    let normalized = tier.trim().to_uppercase();
    let is_apex = matches!(normalized.as_str(), "MASTER" | "GRANDMASTER" | "CHALLENGER");
    let tier_base = match normalized.as_str() {
        "IRON" => 0,
        "BRONZE" => 400,
        "SILVER" => 800,
        "GOLD" => 1200,
        "PLATINUM" => 1600,
        "EMERALD" => 2000,
        "DIAMOND" => 2400,
        "MASTER" | "GRANDMASTER" | "CHALLENGER" => 2800,
        _ => 1200,
    };
    let div_offset = if is_apex {
        0
    } else {
        match rank.trim().to_uppercase().as_str() {
            "IV" => 0,
            "III" => 100,
            "II" => 200,
            "I" => 300,
            _ => 0,
        }
    };
    tier_base + div_offset + lp
}

pub fn has_lp_snapshot_for_match(conn: &Connection, match_id: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM lp_history WHERE match_id = ?1)",
        params![match_id],
        |row| row.get::<_, i64>(0),
    )
    .map(|v| v != 0)
    .unwrap_or(false)
}

pub fn get_latest_lp_snapshot(conn: &Connection) -> AppResult<Option<LpHistoryRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, tier, rank, league_points, absolute_lp, win, match_id, total_games
             FROM lp_history ORDER BY id DESC LIMIT 1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query_map([], |row| {
            Ok(LpHistoryRecord {
                timestamp: row.get(0)?,
                tier: row.get(1)?,
                rank: row.get(2)?,
                league_points: row.get(3)?,
                absolute_lp: row.get(4)?,
                win: row.get::<_, Option<i64>>(5)?.map(|v| v != 0),
                match_id: row.get(6)?,
                total_games: row.get(7)?,
            })
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if let Some(first) = rows.next() {
        Ok(Some(first.map_err(|e| AppError::Storage(e.to_string()))?))
    } else {
        Ok(None)
    }
}

pub fn append_lp_snapshot(conn: &Connection, rec: &LpHistoryRecord) -> AppResult<()> {
    let win_int = rec.win.map(|w| if w { 1_i64 } else { 0_i64 });
    conn.execute(
        "INSERT OR IGNORE INTO lp_history (
            timestamp, tier, rank, league_points, absolute_lp, win, match_id, total_games
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            rec.timestamp,
            rec.tier,
            rec.rank,
            rec.league_points,
            rec.absolute_lp,
            win_int,
            rec.match_id,
            rec.total_games
        ],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn list_lp_history(conn: &Connection, limit: usize) -> AppResult<Vec<LpHistoryRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, tier, rank, league_points, absolute_lp, win, match_id, total_games
             FROM lp_history ORDER BY id DESC LIMIT ?1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![limit as i64], |row| {
            Ok(LpHistoryRecord {
                timestamp: row.get(0)?,
                tier: row.get(1)?,
                rank: row.get(2)?,
                league_points: row.get(3)?,
                absolute_lp: row.get(4)?,
                win: row.get::<_, Option<i64>>(5)?.map(|v| v != 0),
                match_id: row.get(6)?,
                total_games: row.get(7)?,
            })
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }
    out.reverse();
    Ok(out)
}

pub fn sanitize_riot_api_key(raw: &str) -> AppResult<String> {
    let cleaned: String = raw
        .chars()
        .filter(|&c| {
            !c.is_whitespace()
                && !c.is_control()
                && !matches!(c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}')
        })
        .collect();
    if cleaned.is_empty() {
        return Err(AppError::Credential("API key cannot be empty".to_string()));
    }
    if !cleaned.bytes().all(|b| (0x21..=0x7E).contains(&b)) {
        return Err(AppError::Credential(
            "Riot API key must contain printable ASCII characters only".to_string(),
        ));
    }
    if !cleaned.starts_with("RGAPI-") || cleaned.len() < 16 {
        return Err(AppError::Credential(
            "Invalid Riot API key format (expected RGAPI-...)".to_string(),
        ));
    }
    Ok(cleaned)
}

pub fn save_riot_api_key(api_key: &str) -> AppResult<()> {
    let cleaned = sanitize_riot_api_key(api_key)?;
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    entry
        .set_password(&cleaned)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    Ok(())
}

pub fn load_riot_api_key() -> AppResult<String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    let raw = entry
        .get_password()
        .map_err(|e| AppError::Credential(format!("No Riot API key configured: {e}")))?;
    sanitize_riot_api_key(&raw)
}

pub fn has_riot_api_key() -> bool {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|e| e.get_password())
        .map(|k| sanitize_riot_api_key(&k).is_ok())
        .unwrap_or(false)
}

pub fn save_ai_api_key(api_key: &str) -> AppResult<()> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Credential(
            "AI API key cannot be empty".to_string(),
        ));
    }
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_AI_USER)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    entry
        .set_password(trimmed)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    Ok(())
}

pub fn load_ai_api_key() -> AppResult<String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_AI_USER)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| AppError::Credential(format!("No AI API key configured: {e}")))
}

pub fn has_ai_api_key() -> bool {
    Entry::new(KEYRING_SERVICE, KEYRING_AI_USER)
        .and_then(|e| e.get_password())
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false)
}

pub fn compute_median_sync_offset(points: &[(f64, f64)]) -> f64 {
    let mut offsets: Vec<f64> = points
        .iter()
        .filter_map(|(game_sec, video_sec)| {
            if game_sec.is_finite()
                && video_sec.is_finite()
                && *game_sec >= 0.0
                && *video_sec >= 0.0
            {
                Some(video_sec - game_sec)
            } else {
                None
            }
        })
        .collect();
    if offsets.is_empty() {
        return 0.0;
    }
    offsets.sort_by(|a, b| a.total_cmp(b));
    let mid = offsets.len() / 2;
    if offsets.len() % 2 == 1 {
        offsets[mid]
    } else {
        (offsets[mid - 1] + offsets[mid]) * 0.5
    }
}

pub fn plan_quota_evictions(
    records: &[RecordingRecord],
    protected_ids: &HashSet<String>,
    max_bytes: u64,
    keep_last_n: usize,
) -> Vec<String> {
    let mut evictable: Vec<&RecordingRecord> = records
        .iter()
        .filter(|r| !r.pinned && !protected_ids.contains(&r.id) && r.status != "recording")
        .collect();
    // Sort oldest first so we evict oldest unpinned recordings first
    evictable.sort_by(|a, b| a.started_at.cmp(&b.started_at).then(a.id.cmp(&b.id)));

    let mut total_bytes: u64 = records
        .iter()
        .filter(|r| r.status != "recording")
        .map(|r| r.size_bytes)
        .sum();
    let mut remaining_unpinned = evictable.len();
    let mut evict_ids = Vec::new();
    let mut evicted_set = HashSet::new();

    for rec in evictable {
        let over_count = remaining_unpinned > keep_last_n;
        let over_bytes = total_bytes > max_bytes;
        if !over_count && !over_bytes {
            break;
        }
        evicted_set.insert(rec.id.clone());
        evict_ids.push(rec.id.clone());
        total_bytes = total_bytes.saturating_sub(rec.size_bytes);
        remaining_unpinned = remaining_unpinned.saturating_sub(1);
    }

    // Hard disk-quota cap: if non-explicitly-pinned clip-protected recordings still exceed max_bytes,
    // evict oldest non-`pinned` recordings rather than bypassing max_bytes indefinitely.
    if total_bytes > max_bytes {
        let mut fallback: Vec<&RecordingRecord> = records
            .iter()
            .filter(|r| !r.pinned && r.status != "recording" && !evicted_set.contains(&r.id))
            .collect();
        fallback.sort_by(|a, b| a.started_at.cmp(&b.started_at).then(a.id.cmp(&b.id)));
        for rec in fallback {
            if total_bytes <= max_bytes {
                break;
            }
            evict_ids.push(rec.id.clone());
            total_bytes = total_bytes.saturating_sub(rec.size_bytes);
        }
    }

    evict_ids
}

pub fn list_recording_ids_with_pinned_clips(conn: &Connection) -> AppResult<HashSet<String>> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT recording_id FROM recording_clips WHERE pinned = 1")
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }
    Ok(out)
}

pub fn list_all_recordings(conn: &Connection) -> AppResult<Vec<RecordingRecord>> {
    list_recordings(conn, 100_000)
}

pub fn reconcile_interrupted_recordings(conn: &Connection) -> AppResult<usize> {
    let mut stmt = conn
        .prepare("SELECT id, file_path FROM recordings WHERE status = 'recording'")
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut stuck = Vec::new();
    for row in rows {
        stuck.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }
    let now_str = chrono::Utc::now().to_rfc3339();
    for (id, file_path) in &stuck {
        let size_bytes = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
        conn.execute(
            "UPDATE recordings
             SET ended_at = COALESCE(ended_at, ?2),
                 size_bytes = ?3,
                 status = 'interrupted'
             WHERE id = ?1",
            params![id, &now_str, size_bytes as i64],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    }
    Ok(stuck.len())
}

fn map_recording_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RecordingRecord> {
    Ok(RecordingRecord {
        id: row.get(0)?,
        match_id: row.get(1)?,
        file_path: row.get(2)?,
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        duration_sec: row.get(5)?,
        size_bytes: row.get::<_, i64>(6)?.max(0) as u64,
        width: row.get::<_, i64>(7)?.max(0) as u32,
        height: row.get::<_, i64>(8)?.max(0) as u32,
        fps: row.get::<_, i64>(9)?.max(0) as u32,
        preset: row.get(10)?,
        encoder_name: row.get(11)?,
        sync_offset_sec: row.get(12)?,
        pinned: row.get::<_, i64>(13)? != 0,
        status: row.get(14)?,
    })
}

pub fn insert_recording_started(conn: &Connection, rec: &RecordingRecord) -> AppResult<()> {
    conn.execute(
        "INSERT INTO recordings (
            id, match_id, file_path, started_at, ended_at, duration_sec,
            size_bytes, width, height, fps, preset, encoder_name,
            sync_offset_sec, pinned, status
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            rec.id,
            rec.match_id,
            rec.file_path,
            rec.started_at,
            rec.ended_at,
            rec.duration_sec,
            rec.size_bytes as i64,
            i64::from(rec.width),
            i64::from(rec.height),
            i64::from(rec.fps),
            rec.preset,
            rec.encoder_name,
            rec.sync_offset_sec,
            if rec.pinned { 1_i64 } else { 0_i64 },
            rec.status
        ],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn insert_recording_sync_point(
    conn: &Connection,
    recording_id: &str,
    game_time_sec: f64,
    video_elapsed_sec: f64,
    recorded_at: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO recording_sync_points (
            recording_id, game_time_sec, video_elapsed_sec, recorded_at
         ) VALUES (?1, ?2, ?3, ?4)",
        params![recording_id, game_time_sec, video_elapsed_sec, recorded_at],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn finalize_recording(
    conn: &Connection,
    recording_id: &str,
    ended_at: &str,
    duration_sec: f64,
    size_bytes: u64,
    status: &str,
) -> AppResult<Option<RecordingRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT game_time_sec, video_elapsed_sec
             FROM recording_sync_points WHERE recording_id = ?1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map(params![recording_id], |row| {
            Ok((row.get::<_, f64>(0)?, row.get::<_, f64>(1)?))
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut pts = Vec::new();
    for row in rows {
        pts.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }
    let sync_offset = compute_median_sync_offset(&pts);

    conn.execute(
        "UPDATE recordings
         SET ended_at = ?2,
             duration_sec = ?3,
             size_bytes = ?4,
             sync_offset_sec = ?5,
             status = ?6
         WHERE id = ?1",
        params![
            recording_id,
            ended_at,
            duration_sec,
            size_bytes as i64,
            sync_offset,
            status
        ],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;

    get_recording_by_id(conn, recording_id)
}

pub fn list_recordings(conn: &Connection, limit: usize) -> AppResult<Vec<RecordingRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, match_id, file_path, started_at, ended_at, duration_sec,
                    size_bytes, width, height, fps, preset, encoder_name,
                    sync_offset_sec, pinned, status
             FROM recordings ORDER BY started_at DESC LIMIT ?1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map(params![limit as i64], map_recording_row)
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }
    Ok(out)
}

pub fn get_recording_by_id(
    conn: &Connection,
    recording_id: &str,
) -> AppResult<Option<RecordingRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, match_id, file_path, started_at, ended_at, duration_sec,
                    size_bytes, width, height, fps, preset, encoder_name,
                    sync_offset_sec, pinned, status
             FROM recordings WHERE id = ?1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query_map(params![recording_id], map_recording_row)
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if let Some(row) = rows.next() {
        Ok(Some(row.map_err(|e| AppError::Storage(e.to_string()))?))
    } else {
        Ok(None)
    }
}

pub fn get_recording_for_match(
    conn: &Connection,
    match_id: &str,
) -> AppResult<Option<RecordingRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, match_id, file_path, started_at, ended_at, duration_sec,
                    size_bytes, width, height, fps, preset, encoder_name,
                    sync_offset_sec, pinned, status
             FROM recordings WHERE match_id = ?1 LIMIT 1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query_map(params![match_id], map_recording_row)
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if let Some(row) = rows.next() {
        Ok(Some(row.map_err(|e| AppError::Storage(e.to_string()))?))
    } else {
        Ok(None)
    }
}

pub fn set_recording_pinned(
    conn: &Connection,
    recording_id: &str,
    pinned: bool,
) -> AppResult<Option<RecordingRecord>> {
    let changed = conn
        .execute(
            "UPDATE recordings SET pinned = ?2 WHERE id = ?1",
            params![recording_id, if pinned { 1_i64 } else { 0_i64 }],
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    if changed == 0 {
        return Err(AppError::Storage(format!(
            "Recording not found: {recording_id}"
        )));
    }
    get_recording_by_id(conn, recording_id)
}

pub fn delete_recording_rows(conn: &Connection, recording_id: &str) -> AppResult<Option<String>> {
    let existing = get_recording_by_id(conn, recording_id)?;
    let Some(rec) = existing else {
        return Ok(None);
    };
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::Storage(e.to_string()))?;
    tx.execute(
        "DELETE FROM recording_sync_points WHERE recording_id = ?1",
        params![recording_id],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    tx.execute(
        "DELETE FROM recording_clips WHERE recording_id = ?1",
        params![recording_id],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    tx.execute(
        "DELETE FROM recordings WHERE id = ?1",
        params![recording_id],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    tx.commit().map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(Some(rec.file_path))
}

pub fn upsert_recording_clip(conn: &Connection, clip: &RecordingClipRecord) -> AppResult<()> {
    conn.execute(
        "INSERT INTO recording_clips (
            id, recording_id, match_id, label, kind, game_time_sec,
            start_sec, end_sec, pinned, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            recording_id = excluded.recording_id,
            match_id = excluded.match_id,
            label = excluded.label,
            kind = excluded.kind,
            game_time_sec = excluded.game_time_sec,
            start_sec = excluded.start_sec,
            end_sec = excluded.end_sec,
            pinned = excluded.pinned,
            created_at = excluded.created_at",
        params![
            clip.id,
            clip.recording_id,
            clip.match_id,
            clip.label,
            clip.kind,
            clip.game_time_sec,
            clip.start_sec,
            clip.end_sec,
            if clip.pinned { 1_i64 } else { 0_i64 },
            clip.created_at
        ],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn list_recording_clips(
    conn: &Connection,
    recording_id: &str,
) -> AppResult<Vec<RecordingClipRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, recording_id, match_id, label, kind, game_time_sec,
                    start_sec, end_sec, pinned, created_at
             FROM recording_clips
             WHERE recording_id = ?1
             ORDER BY game_time_sec ASC, created_at ASC",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let rows = stmt
        .query_map(params![recording_id], |row| {
            Ok(RecordingClipRecord {
                id: row.get(0)?,
                recording_id: row.get(1)?,
                match_id: row.get(2)?,
                label: row.get(3)?,
                kind: row.get(4)?,
                game_time_sec: row.get(5)?,
                start_sec: row.get(6)?,
                end_sec: row.get(7)?,
                pinned: row.get::<_, i64>(8)? != 0,
                created_at: row.get(9)?,
            })
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Storage(e.to_string()))?);
    }
    Ok(out)
}

pub fn delete_recording_clip(conn: &Connection, clip_id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM recording_clips WHERE id = ?1",
        params![clip_id],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn bind_unlinked_recording_to_match(
    conn: &Connection,
    match_id: &str,
    played_at: &str,
) -> AppResult<Option<RecordingRecord>> {
    if let Some(existing) = get_recording_for_match(conn, match_id)? {
        return Ok(Some(existing));
    }
    let Ok(match_start_dt) = chrono::DateTime::parse_from_rfc3339(played_at) else {
        return Ok(None);
    };
    let match_start_utc = match_start_dt.with_timezone(&chrono::Utc);

    let candidates = list_recordings(conn, 25)?;
    let mut best_id: Option<String> = None;
    let mut best_delta = i64::MAX;

    for rec in candidates {
        if rec.match_id.is_some() || rec.status != "ready" {
            continue;
        }
        let Ok(rec_start_dt) = chrono::DateTime::parse_from_rfc3339(&rec.started_at) else {
            continue;
        };
        let rec_start_utc = rec_start_dt.with_timezone(&chrono::Utc);
        if let Some(ref ended_raw) = rec.ended_at {
            if let Ok(rec_end_dt) = chrono::DateTime::parse_from_rfc3339(ended_raw) {
                if rec_end_dt.with_timezone(&chrono::Utc)
                    < match_start_utc - chrono::Duration::seconds(60)
                {
                    continue;
                }
            }
        }
        let delta_sec = (rec_start_utc - match_start_utc).num_seconds().abs();
        if delta_sec <= 900 && delta_sec < best_delta {
            best_delta = delta_sec;
            best_id = Some(rec.id);
        }
    }

    let Some(rec_id) = best_id else {
        return Ok(None);
    };
    conn.execute(
        "UPDATE recordings SET match_id = ?2 WHERE id = ?1 AND match_id IS NULL",
        params![rec_id, match_id],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    conn.execute(
        "UPDATE recording_clips SET match_id = ?2 WHERE recording_id = ?1 AND match_id IS NULL",
        params![rec_id, match_id],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;

    get_recording_by_id(conn, &rec_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent_and_persist_settings() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        run_migrations(&conn).expect("first migration");
        run_migrations(&conn).expect("second migration");

        let custom = UserSettings {
            riot_id: "Jungler#EUW".to_string(),
            region: "EUW1".to_string(),
            target_division: "DIAMOND IV".to_string(),
            ..Default::default()
        };
        save_settings(&conn, &custom).expect("save settings");

        let loaded = load_settings(&conn).expect("load settings");
        assert_eq!(loaded.riot_id, "Jungler#EUW");
        assert_eq!(loaded.target_division, "DIAMOND IV");
        assert_eq!(loaded.update_mode, "manual");
        assert_eq!(loaded.riot_api_proxy_url, "");
    }

    #[test]
    fn persists_climb_goals_and_meta_snapshots() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        run_migrations(&conn).expect("migrations");

        let goal = ClimbGoalRecord {
            id: "goal-1".to_string(),
            role: "jungle".to_string(),
            target_division: "PLATINUM IV".to_string(),
            metric: "csPerMin".to_string(),
            title: "Hit 6.6 CS/min".to_string(),
            target_value: 6.6,
            current_value: 5.9,
            unit: "CS/m".to_string(),
            lower_is_better: false,
            status: "active".to_string(),
            source: "auto".to_string(),
            created_at: "2026-11-26T20:00:00Z".to_string(),
            is_focus_goal: false,
        };

        upsert_climb_goal(&conn, &goal).expect("upsert goal");
        let goals = list_climb_goals(&conn).expect("list goals");
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].title, "Hit 6.6 CS/min");

        // Pre-v0.4.0 JSON rows without isFocusGoal must deserialize safely with default false
        conn.execute(
            "INSERT INTO climb_goals_v2 (id, payload, updated_at) VALUES (?1, ?2, ?3)",
            params![
                "legacy-goal",
                r#"{"id":"legacy-goal","targetDivision":"GOLD IV","metric":"csPerMin","title":"Legacy Goal","targetValue":6.0,"currentValue":5.5,"unit":"CS/m","lowerIsBetter":false,"status":"active","source":"custom","createdAt":"2026-11-26T10:00:00Z"}"#,
                "2026-11-26T10:00:00Z"
            ],
        )
        .expect("insert legacy goal");
        let with_legacy = list_climb_goals(&conn).expect("list with legacy");
        let legacy = with_legacy
            .iter()
            .find(|g| g.id == "legacy-goal")
            .expect("legacy goal present");
        assert!(!legacy.is_focus_goal);

        delete_climb_goal(&conn, "goal-1").expect("delete goal");
        delete_climb_goal(&conn, "legacy-goal").expect("delete legacy goal");
        assert!(list_climb_goals(&conn).expect("list empty").is_empty());

        let snap = serde_json::json!({ "patch": "16.1", "sampleMatches": 12 });
        save_meta_snapshot(&conn, "16.1", "EUW1", &snap).expect("save snapshot");
        let loaded_snap = load_meta_snapshot(&conn).expect("load snapshot").unwrap();
        assert_eq!(loaded_snap["sampleMatches"], 12);

        let lp = LpHistoryRecord {
            timestamp: "2026-11-26T20:00:00Z".to_string(),
            tier: "GOLD".to_string(),
            rank: "II".to_string(),
            league_points: 64,
            absolute_lp: tier_rank_to_absolute_lp("GOLD", "II", 64),
            win: Some(true),
            match_id: Some("EUW1_TEST".to_string()),
            total_games: Some(18),
        };
        assert_eq!(lp.absolute_lp, 1464);
        append_lp_snapshot(&conn, &lp).expect("append lp");
        let hist = list_lp_history(&conn, 10).expect("list lp");
        assert_eq!(hist.len(), 1);
        assert_eq!(tier_rank_to_absolute_lp("MASTER", "I", 180), 2980);
        assert_eq!(tier_rank_to_absolute_lp("DIAMOND", "I", 99), 2799);
    }

    #[test]
    fn user_version_migrates_fact_tables_backfills_and_sets_focus_atomically() {
        let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
        run_migrations(&conn).expect("migrate v2");

        let user_ver: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read user_version");
        assert_eq!(user_ver, 6);

        let sample_detail = serde_json::json!({
            "matchId": "EUW1_9001",
            "championId": 234,
            "championName": "Viego",
            "win": true,
            "durationSeconds": 1800,
            "mapSide": "blue",
            "playerParticipantId": 2,
            "kills": 7,
            "deaths": 2,
            "assists": 6,
            "cs": 204,
            "visionScore": 30,
            "controlWardsBought": 4,
            "teamKills": 22,
            "teamObjectives": 5,
            "enemyObjectives": 2,
            "frames": [
                { "minute": 4, "cs": 28, "totalGold": 1500, "xp": 1400, "enemyJunglerGold": 1300, "enemyJunglerXp": 1250 },
                { "minute": 10, "cs": 71, "totalGold": 4000, "xp": 4300, "enemyJunglerGold": 3500, "enemyJunglerXp": 3900 },
                { "minute": 15, "cs": 106, "totalGold": 6300, "xp": 7100, "enemyJunglerGold": 5400, "enemyJunglerXp": 6400 }
            ],
            "events": [
                { "type": "WARD_PLACED", "timestampSec": 80, "creatorId": 2, "wardType": "YELLOW_TRINKET", "position": { "x": 7000, "y": 7000 } },
                { "type": "CHAMPION_KILL", "timestampSec": 270, "killerId": 6, "victimId": 2 }
            ]
        });
        let summary_stub = serde_json::json!({ "matchId": "EUW1_9001" });
        cache_match_record(
            &conn,
            "EUW1_9001",
            "puuid-1",
            "2026-11-27T01:00:00Z",
            &summary_stub,
            &sample_detail,
        )
        .expect("cache match");
        let short_remake = serde_json::json!({
            "matchId": "EUW1_REMAKE",
            "championId": 32,
            "championName": "Amumu",
            "win": false,
            "durationSeconds": 195,
            "mapSide": "blue",
            "playerParticipantId": 2,
            "kills": 0,
            "deaths": 0,
            "assists": 0,
            "cs": 14,
            "visionScore": 2,
            "controlWardsBought": 0,
            "teamKills": 0,
            "teamObjectives": 0,
            "enemyObjectives": 0,
            "frames": [],
            "events": []
        });
        cache_match_record(
            &conn,
            "EUW1_REMAKE",
            "puuid-1",
            "2026-11-27T00:45:00Z",
            &serde_json::json!({ "matchId": "EUW1_REMAKE" }),
            &short_remake,
        )
        .expect("cache remake");
        // Insert a corrupt row to verify per-row list_cached_matches skips mismatched rows
        conn.execute(
            "INSERT INTO match_details_cache (match_id, puuid, played_at, summary_json, detail_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                "EUW1_CORRUPT",
                "puuid-1",
                "2026-11-27T00:30:00Z",
                "{valid:false",
                r#"{"matchId":"EUW1_CORRUPT"}"#
            ],
        )
        .expect("insert corrupt cache row");
        let (summaries, details) = list_cached_matches(&conn, Some("puuid-1"), 10).expect("list");
        assert_eq!(summaries.len(), 2);
        assert_eq!(details.len(), 2);

        let fact_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM matches_fact", [], |r| r.get(0))
            .expect("fact count");
        let cs4: Option<i64> = conn
            .query_row(
                "SELECT cs_at_4 FROM match_metrics WHERE match_id = 'EUW1_9001'",
                [],
                |r| r.get(0),
            )
            .expect("cs4");
        let remake_gd15: Option<i64> = conn
            .query_row(
                "SELECT gold_diff_at_15 FROM match_metrics WHERE match_id = 'EUW1_REMAKE'",
                [],
                |r| r.get(0),
            )
            .expect("remake gd15");
        let remake_obj: Option<i64> = conn
            .query_row(
                "SELECT objective_share_pct FROM match_metrics WHERE match_id = 'EUW1_REMAKE'",
                [],
                |r| r.get(0),
            )
            .expect("remake obj");
        let mistake_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mistake_hits WHERE match_id = 'EUW1_9001'",
                [],
                |r| r.get(0),
            )
            .expect("mistake_hits count");
        let baseline_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM baselines", [], |r| r.get(0))
            .expect("baselines count");
        assert_eq!(fact_count, 2);
        assert_eq!(cs4, Some(28));
        assert_eq!(remake_gd15, None);
        assert_eq!(remake_obj, None);
        assert_eq!(mistake_count, 1);
        assert_eq!(baseline_count, 7);

        let learning =
            load_personal_learning_summary_for_account(&conn, None).expect("load learning summary");
        assert_eq!(learning.jungle_match_count, 1);
        assert_eq!(learning.baselines.len(), 7);
        assert!(learning
            .mistake_signatures
            .iter()
            .any(|m| m.detector_id == "pre_obj_death" && m.hit_matches == 1));

        // Off-role (e.g., BOTTOM ADC) games persist role='BOTTOM' and stay excluded from jungle mistakes/baselines
        let adc_game = serde_json::json!({
            "matchId": "EUW1_ADC",
            "role": "BOTTOM",
            "championId": 222,
            "championName": "Jinx",
            "win": true,
            "durationSeconds": 1800,
            "mapSide": "blue",
            "playerParticipantId": 4,
            "kills": 9,
            "deaths": 3,
            "assists": 7,
            "cs": 260,
            "visionScore": 18,
            "controlWardsBought": 1,
            "teamKills": 24,
            "teamObjectives": 3,
            "enemyObjectives": 2,
            "frames": [],
            "events": [
                { "type": "CHAMPION_KILL", "timestampSec": 270, "killerId": 6, "victimId": 4 }
            ]
        });
        cache_match_record(
            &conn,
            "EUW1_ADC",
            "puuid-1",
            "2026-11-27T01:30:00Z",
            &serde_json::json!({ "matchId": "EUW1_ADC", "role": "BOTTOM" }),
            &adc_game,
        )
        .expect("cache off-role match");
        let stored_role: String = conn
            .query_row(
                "SELECT role FROM matches_fact WHERE match_id = 'EUW1_ADC'",
                [],
                |r| r.get(0),
            )
            .expect("stored role");
        let jg_mistakes_on_adc: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mistake_hits WHERE match_id = 'EUW1_ADC' AND detector_id NOT LIKE 'adc_%'",
                [],
                |r| r.get(0),
            )
            .expect("zero jungle mistakes on adc");
        let adc_mistakes: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM mistake_hits WHERE match_id = 'EUW1_ADC' AND detector_id = 'adc_pre_obj_death'",
                [],
                |r| r.get(0),
            )
            .expect("adc mistakes");
        let baseline_n: i64 = conn
            .query_row(
                "SELECT sample_n FROM baselines WHERE key = 'cs_per_min'",
                [],
                |r| r.get(0),
            )
            .expect("baseline sample_n");
        assert_eq!(stored_role, "BOTTOM");
        assert_eq!(jg_mistakes_on_adc, 0);
        assert_eq!(adc_mistakes, 1);
        assert_eq!(baseline_n, 1);
        let jg_snap = load_personal_learning_summary_for_role(&conn, Some("puuid-1"), "JUNGLE")
            .expect("jungle isolated");
        let adc_snap = load_personal_learning_summary_for_role(&conn, Some("puuid-1"), "BOTTOM")
            .expect("adc isolated");
        assert_eq!(jg_snap.jungle_match_count, 1);
        assert_eq!(adc_snap.jungle_match_count, 1);
        assert!(jg_snap
            .mistake_signatures
            .iter()
            .all(|s| !s.detector_id.starts_with("adc_")));
        assert!(adc_snap
            .mistake_signatures
            .iter()
            .any(|s| s.detector_id == "adc_pre_obj_death"));

        // Clearing all jungle matches and keeping only off-role clears stale baselines (n == 0)
        let conn_offrole_only = Connection::open_in_memory().expect("in-memory sqlite offrole");
        run_migrations(&conn_offrole_only).expect("migrations offrole");
        upsert_match_facts(&conn_offrole_only, "EUW1_STALE", "p", "2026-11-27T01:00:00Z", &serde_json::json!({
            "matchId": "EUW1_STALE", "role": "JUNGLE", "championId": 32, "championName": "Amumu",
            "win": true, "durationSeconds": 1800, "mapSide": "blue", "playerParticipantId": 2,
            "kills": 2, "deaths": 1, "assists": 5, "cs": 180, "visionScore": 20, "controlWardsBought": 2,
            "teamKills": 10, "teamObjectives": 3, "enemyObjectives": 1, "frames": [], "events": []
        })).expect("seed stale jungle");
        assert!(
            conn_offrole_only
                .query_row("SELECT COUNT(*) FROM baselines", [], |r| r.get::<_, i64>(0))
                .expect("count seeded")
                >= 5
        );
        assert!(
            conn_offrole_only
                .query_row(
                    "SELECT COUNT(*) FROM baselines WHERE key = 'gold_diff_at_15'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .expect("gd15 omitted without m15 frame")
                == 0
        );
        conn_offrole_only
            .execute("DELETE FROM matches_fact", [])
            .expect("delete fact");
        upsert_match_facts(
            &conn_offrole_only,
            "EUW1_ONLY_ADC",
            "p",
            "2026-11-27T02:00:00Z",
            &adc_game,
        )
        .expect("insert adc only");
        assert_eq!(
            conn_offrole_only
                .query_row("SELECT COUNT(*) FROM baselines", [], |r| r.get::<_, i64>(0))
                .expect("cleared stale baselines"),
            0
        );

        // Unmigrated database returns empty summary cleanly; all 5 detectors + remake/off-role filtering work
        let uninit_conn = Connection::open_in_memory().expect("uninit sqlite");
        let empty_summary = load_personal_learning_summary_for_account(&uninit_conn, None)
            .expect("uninit returns empty ok");
        assert_eq!(empty_summary.jungle_match_count, 0);
        assert!(empty_summary.baselines.is_empty());
        assert!(empty_summary.mistake_signatures.is_empty());

        let m13_conn = Connection::open_in_memory().expect("m13 test sqlite");
        run_migrations(&m13_conn).expect("migrate m13");
        // 1) Jungle game triggering all 5 detectors with unsorted death events (520s before 210s)
        let bad_jg_detail = serde_json::json!({
            "matchId": "EUW1_ALL5",
            "role": "JUNGLE",
            "championId": 104,
            "championName": "Graves",
            "win": false,
            "durationSeconds": 1500,
            "mapSide": "blue",
            "playerParticipantId": 2,
            "kills": 1,
            "deaths": 5,
            "assists": 2,
            "cs": 110,
            "visionScore": 10,
            "controlWardsBought": 1,
            "teamKills": 10,
            "teamObjectives": 1,
            "enemyObjectives": 4,
            "frames": [
                { "minute": 15, "cs": 70, "totalGold": 4200, "enemyJunglerGold": 4850, "xp": 5100, "enemyJunglerXp": 5700 }
            ],
            "events": [
                { "type": "ELITE_MONSTER_KILL", "timestampSec": 560, "killerTeamId": 200 },
                { "type": "CHAMPION_KILL", "timestampSec": 520, "victimId": 2 },
                { "type": "CHAMPION_KILL", "timestampSec": 210, "victimId": 2 }
            ]
        });
        // 2) Remake jungle game (<300s) that must NOT count in baselines or detectors
        let remake_jg_detail = serde_json::json!({
            "matchId": "EUW1_REMAKE",
            "role": "JUNGLE",
            "championId": 64,
            "championName": "LeeSin",
            "win": false,
            "durationSeconds": 195,
            "mapSide": "blue",
            "playerParticipantId": 2,
            "kills": 0,
            "deaths": 2,
            "assists": 0,
            "cs": 12,
            "visionScore": 1,
            "controlWardsBought": 0,
            "teamKills": 0,
            "teamObjectives": 0,
            "enemyObjectives": 0,
            "frames": [],
            "events": [
                { "type": "CHAMPION_KILL", "timestampSec": 120, "victimId": 2 },
                { "type": "CHAMPION_KILL", "timestampSec": 170, "victimId": 2 }
            ]
        });
        upsert_match_facts(
            &m13_conn,
            "EUW1_ALL5",
            "p",
            "2026-11-27T04:00:00Z",
            &bad_jg_detail,
        )
        .expect("insert all5");
        upsert_match_facts(
            &m13_conn,
            "EUW1_REMAKE",
            "p",
            "2026-11-27T05:00:00Z",
            &remake_jg_detail,
        )
        .expect("insert remake");
        upsert_match_facts(
            &m13_conn,
            "EUW1_ADC_IGN",
            "p",
            "2026-11-27T06:00:00Z",
            &adc_game,
        )
        .expect("insert adc ignore");

        let m13_summary =
            load_personal_learning_summary_for_account(&m13_conn, None).expect("load m13 summary");
        assert_eq!(m13_summary.jungle_match_count, 1);
        assert_eq!(m13_summary.mistake_signatures.len(), 5);
        let early_sig = m13_summary
            .mistake_signatures
            .iter()
            .find(|s| s.detector_id == "early_death_before_10")
            .expect("early_death_before_10 detected");
        assert_eq!(early_sig.last_timestamp_sec, 520);
        let gd_row = m13_summary
            .baselines
            .iter()
            .find(|b| b.key == "gold_diff_at_15")
            .expect("gd15 row");
        assert_eq!(gd_row.sample_n, 1);
        assert!((gd_row.value - (-650.0)).abs() < 0.01);

        // Account scoping isolates alt accounts so other accounts' leaks never bleed over
        upsert_match_facts(
            &m13_conn,
            "EUW1_ALT_CLEAN",
            "alt-puuid",
            "2026-11-27T07:00:00Z",
            &serde_json::json!({
                "matchId": "EUW1_ALT_CLEAN",
                "role": "JUNGLE",
                "championId": 32,
                "championName": "Amumu",
                "win": true,
                "durationSeconds": 1800,
                "mapSide": "blue",
                "playerParticipantId": 2,
                "kills": 6,
                "deaths": 0,
                "assists": 10,
                "cs": 216,
                "visionScore": 30,
                "controlWardsBought": 4,
                "teamKills": 18,
                "teamObjectives": 4,
                "enemyObjectives": 1,
                "frames": [],
                "events": []
            }),
        )
        .expect("insert clean alt game");
        let alt_summary = load_personal_learning_summary_for_account(&m13_conn, Some("alt-puuid"))
            .expect("load alt summary");
        assert_eq!(alt_summary.jungle_match_count, 1);
        assert!(alt_summary.mistake_signatures.is_empty());
        let alt_cs = alt_summary
            .baselines
            .iter()
            .find(|b| b.key == "cs_per_min")
            .expect("alt cs");
        assert!((alt_cs.value - 7.2).abs() < 0.05);

        // Atomic focus toggle across multiple goals + error on unknown ID
        let g1 = ClimbGoalRecord {
            id: "g1".to_string(),
            role: "jungle".to_string(),
            target_division: "PLATINUM IV".to_string(),
            metric: "csPerMin".to_string(),
            title: "G1".to_string(),
            target_value: 6.6,
            current_value: 6.0,
            unit: "CS/m".to_string(),
            lower_is_better: false,
            status: "active".to_string(),
            source: "auto".to_string(),
            created_at: "2026-11-27T00:00:00Z".to_string(),
            is_focus_goal: true,
        };
        let g2 = ClimbGoalRecord {
            id: "g2".to_string(),
            title: "G2".to_string(),
            is_focus_goal: false,
            ..g1.clone()
        };
        upsert_climb_goal(&conn, &g1).expect("g1");
        upsert_climb_goal(&conn, &g2).expect("g2");

        assert!(set_focus_goal(&mut conn, "nonexistent-id").is_err());
        let goals_after_err = list_climb_goals(&conn).expect("goals intact");
        let g1_intact = goals_after_err.iter().find(|g| g.id == "g1").unwrap();
        assert!(g1_intact.is_focus_goal);

        let switched = set_focus_goal(&mut conn, "g2").expect("focus g2");
        let g1_switched = switched.iter().find(|g| g.id == "g1").unwrap();
        let g2_switched = switched.iter().find(|g| g.id == "g2").unwrap();
        assert!(!g1_switched.is_focus_goal);
        assert!(g2_switched.is_focus_goal);

        let cleared = set_focus_goal(&mut conn, "g2").expect("unfocus g2");
        assert!(cleared.iter().all(|g| !g.is_focus_goal));
    }

    #[test]
    fn v3_to_v4_migration_adds_role_clears_offrole_mistakes_and_recomputes_baselines() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite v3");
        conn.execute_batch(
            r#"
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE ddragon_cache (key TEXT PRIMARY KEY, patch_version TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE match_summaries (match_id TEXT PRIMARY KEY, puuid TEXT NOT NULL, champion_id INTEGER NOT NULL, win INTEGER NOT NULL, cs_per_min REAL NOT NULL, vision_per_min REAL NOT NULL, gd_at_15 INTEGER NOT NULL, played_at TEXT NOT NULL);
            CREATE TABLE match_details_cache (match_id TEXT PRIMARY KEY, puuid TEXT NOT NULL, played_at TEXT NOT NULL, summary_json TEXT NOT NULL, detail_json TEXT NOT NULL);
            CREATE TABLE climb_goals (id TEXT PRIMARY KEY, target_division TEXT NOT NULL, metric TEXT NOT NULL, title TEXT NOT NULL, target_value REAL NOT NULL, current_value REAL NOT NULL, unit TEXT NOT NULL, lower_is_better INTEGER NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE high_elo_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, patch TEXT NOT NULL, region TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE lp_history (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, tier TEXT NOT NULL, rank TEXT NOT NULL, league_points INTEGER NOT NULL, absolute_lp INTEGER NOT NULL, win INTEGER, match_id TEXT);
            CREATE TABLE climb_goals_v2 (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE matches_fact (match_id TEXT PRIMARY KEY, puuid TEXT NOT NULL, played_at TEXT NOT NULL, champion_id INTEGER NOT NULL, champion_name TEXT NOT NULL, win INTEGER NOT NULL, duration_sec INTEGER NOT NULL, map_side TEXT NOT NULL, kills INTEGER NOT NULL, deaths INTEGER NOT NULL, assists INTEGER NOT NULL);
            CREATE TABLE match_metrics (match_id TEXT PRIMARY KEY, cs_per_min REAL NOT NULL, cs_at_4 INTEGER, cs_at_5 INTEGER, cs_at_10 INTEGER, gold_diff_at_10 INTEGER, gold_diff_at_15 INTEGER, xp_diff_at_15 INTEGER, vision_per_min REAL NOT NULL, control_wards INTEGER NOT NULL, objective_share_pct INTEGER, kill_participation_pct INTEGER NOT NULL, early_deaths INTEGER NOT NULL, pre_obj_deaths INTEGER NOT NULL);
            CREATE TABLE match_events (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, timestamp_sec INTEGER NOT NULL, event_type TEXT NOT NULL, killer_id INTEGER, victim_id INTEGER, x INTEGER, y INTEGER, monster_type TEXT, ward_type TEXT);
            CREATE TABLE mistake_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, detector_id TEXT NOT NULL, timestamp_sec INTEGER NOT NULL, severity TEXT NOT NULL, detail TEXT NOT NULL);
            CREATE TABLE baselines (key TEXT PRIMARY KEY, scope TEXT NOT NULL, value REAL NOT NULL, sample_n INTEGER NOT NULL, updated_at TEXT NOT NULL);
            PRAGMA user_version = 3;
            "#,
        )
        .expect("create v3 schema");

        let adc_detail = serde_json::json!({
            "matchId": "EUW1_V3_ADC",
            "role": "BOTTOM",
            "championId": 222,
            "championName": "Jinx",
            "win": true,
            "durationSeconds": 1800,
            "mapSide": "blue",
            "playerParticipantId": 4,
            "kills": 8,
            "deaths": 2,
            "assists": 6,
            "cs": 250,
            "visionScore": 15,
            "controlWardsBought": 1,
            "teamKills": 20,
            "teamObjectives": 3,
            "enemyObjectives": 2,
            "frames": [],
            "events": [
                { "type": "CHAMPION_KILL", "timestampSec": 270, "killerId": 6, "victimId": 4 }
            ]
        });
        conn.execute(
            "INSERT INTO match_details_cache (match_id, puuid, played_at, summary_json, detail_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                "EUW1_V3_ADC",
                "puuid-v3",
                "2026-11-27T01:00:00Z",
                r#"{"matchId":"EUW1_V3_ADC"}"#,
                adc_detail.to_string()
            ],
        )
        .expect("seed v3 cached match");
        conn.execute(
            "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
             VALUES ('EUW1_V3_ADC', 'pre_obj_death', 270, 'high', 'stale v3 mistake')",
            [],
        )
        .expect("seed stale mistake");
        conn.execute(
            "INSERT INTO baselines (key, scope, value, sample_n, updated_at)
             VALUES ('cs_per_min', 'global', 8.3, 1, '2026-11-27T01:00:00Z')",
            [],
        )
        .expect("seed stale baseline");

        run_migrations(&conn).expect("upgrade v3 to v6");
        let new_ver: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read new user_version");
        assert_eq!(new_ver, 6);
        assert!(table_has_column(&conn, "matches_fact", "role").expect("check role col"));
        assert!(table_has_column(&conn, "match_metrics", "damage_share").expect("check dmg col"));
        let v4_role: String = conn
            .query_row(
                "SELECT role FROM matches_fact WHERE match_id = 'EUW1_V3_ADC'",
                [],
                |r| r.get(0),
            )
            .expect("migrated role");
        let v4_mistakes: i64 = conn
            .query_row("SELECT COUNT(*) FROM mistake_hits", [], |r| r.get(0))
            .expect("recomputed adc mistakes on v6");
        let v4_baselines: i64 = conn
            .query_row("SELECT COUNT(*) FROM baselines", [], |r| r.get(0))
            .expect("cleared jungle baselines");
        assert_eq!(v4_role, "BOTTOM");
        assert_eq!(v4_mistakes, 1); // adc_pre_obj_death detected for BOTTOM without contaminating Jungle
        assert_eq!(v4_baselines, 0);
        let jg_only = load_personal_learning_summary_for_role(&conn, None, "JUNGLE")
            .expect("jungle summary isolated");
        assert_eq!(jg_only.jungle_match_count, 0);
        let adc_only = load_personal_learning_summary_for_role(&conn, None, "BOTTOM")
            .expect("adc summary isolated");
        assert_eq!(adc_only.jungle_match_count, 1);
    }

    #[test]
    fn sanitizes_riot_api_keys_and_rejects_malformed_inputs() {
        let cleaned = sanitize_riot_api_key("\u{FEFF} RGAPI-ebfdd279-7797-492a-8aa5\u{200B}\n")
            .expect("valid key");
        assert_eq!(cleaned, "RGAPI-ebfdd279-7797-492a-8aa5");
        assert!(sanitize_riot_api_key("").is_err());
        assert!(sanitize_riot_api_key("not-a-riot-key").is_err());
        assert!(sanitize_riot_api_key("RGAPI-short").is_err());
    }

    #[test]
    fn recording_metadata_sync_offset_and_quota_evictions() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        run_migrations(&conn).expect("migrate v3");

        let default_settings = load_settings(&conn).expect("default settings");
        assert!(!default_settings.recording.enabled);
        assert_eq!(default_settings.recording.preset, "720p30");
        assert_eq!(default_settings.recording.max_storage_gb, 5);

        let rec1 = RecordingRecord {
            id: "rec-1".to_string(),
            match_id: None,
            file_path: "C:\\tmp\\rec-1.mp4".to_string(),
            started_at: "2026-11-27T10:00:30Z".to_string(),
            ended_at: None,
            duration_sec: 0.0,
            size_bytes: 0,
            width: 1280,
            height: 720,
            fps: 30,
            preset: "720p30".to_string(),
            encoder_name: "NVIDIA H.264".to_string(),
            sync_offset_sec: 0.0,
            pinned: false,
            status: "recording".to_string(),
        };
        insert_recording_started(&conn, &rec1).expect("insert rec1");
        insert_recording_sync_point(&conn, "rec-1", 10.0, 22.0, "2026-11-27T10:00:22Z")
            .expect("pt1");
        insert_recording_sync_point(&conn, "rec-1", 120.0, 124.2, "2026-11-27T10:02:04Z")
            .expect("pt2");
        insert_recording_sync_point(&conn, "rec-1", 300.0, 304.0, "2026-11-27T10:05:04Z")
            .expect("pt3");

        let finalized = finalize_recording(
            &conn,
            "rec-1",
            "2026-11-27T10:35:30Z",
            2100.0,
            600_000_000,
            "ready",
        )
        .expect("finalize rec1")
        .expect("rec1 exists");
        assert!((finalized.sync_offset_sec - 4.2).abs() < 0.01);

        // Long 35m match whose gameCreation is 10:00:00Z must bind to rec1 via started_at
        let bound = bind_unlinked_recording_to_match(&conn, "EUW1_55555", "2026-11-27T10:00:00Z")
            .expect("bind rec1")
            .expect("bound row");
        assert_eq!(bound.match_id.as_deref(), Some("EUW1_55555"));

        let clip = RecordingClipRecord {
            id: "clip-1".to_string(),
            recording_id: "rec-1".to_string(),
            match_id: Some("EUW1_55555".to_string()),
            label: "Death before Dragon".to_string(),
            kind: "pre_obj_death".to_string(),
            game_time_sec: 310.0,
            start_sec: 298.0,
            end_sec: 316.0,
            pinned: true,
            created_at: "2026-11-27T10:36:00Z".to_string(),
        };
        upsert_recording_clip(&conn, &clip).expect("upsert clip");
        let clips = list_recording_clips(&conn, "rec-1").expect("list clips");
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].label, "Death before Dragon");

        let mut protected = HashSet::new();
        protected.insert("rec-protected".to_string());

        let pinned_rec = RecordingRecord {
            id: "rec-pinned".to_string(),
            pinned: true,
            size_bytes: 900_000_000,
            started_at: "2026-11-27T08:00:00Z".to_string(),
            ..finalized.clone()
        };
        let protected_by_clip = RecordingRecord {
            id: "rec-protected".to_string(),
            pinned: false,
            size_bytes: 300_000_000,
            started_at: "2026-11-27T08:30:00Z".to_string(),
            ..finalized.clone()
        };
        let old_rec = RecordingRecord {
            id: "rec-old".to_string(),
            pinned: false,
            size_bytes: 400_000_000,
            started_at: "2026-11-27T09:00:00Z".to_string(),
            ..finalized.clone()
        };
        let new_rec = RecordingRecord {
            id: "rec-new".to_string(),
            pinned: false,
            size_bytes: 400_000_000,
            started_at: "2026-11-27T11:00:00Z".to_string(),
            ..finalized
        };
        let evictions = plan_quota_evictions(
            &[
                new_rec.clone(),
                pinned_rec.clone(),
                protected_by_clip.clone(),
                old_rec.clone(),
            ],
            &protected,
            1_650_000_000,
            5,
        );
        assert_eq!(evictions, vec!["rec-old".to_string()]);

        // Hard byte quota still evicts unpinned recordings first, then non-pinned clip-protected ones
        let hard_cap_evictions = plan_quota_evictions(
            &[new_rec, pinned_rec, protected_by_clip, old_rec],
            &protected,
            1_100_000_000,
            5,
        );
        assert_eq!(
            hard_cap_evictions,
            vec![
                "rec-old".to_string(),
                "rec-new".to_string(),
                "rec-protected".to_string()
            ]
        );

        // Crash recovery reconciles stuck 'recording' rows on startup
        let stuck = RecordingRecord {
            id: "rec-crashed".to_string(),
            match_id: None,
            file_path: "C:\\tmp\\nonexistent-crashed.mp4".to_string(),
            started_at: "2026-11-27T12:00:00Z".to_string(),
            ended_at: None,
            duration_sec: 0.0,
            size_bytes: 0,
            width: 1280,
            height: 720,
            fps: 30,
            preset: "720p30".to_string(),
            encoder_name: "NVIDIA".to_string(),
            sync_offset_sec: 0.0,
            pinned: false,
            status: "recording".to_string(),
        };
        insert_recording_started(&conn, &stuck).expect("insert stuck");
        let fixed = reconcile_interrupted_recordings(&conn).expect("reconcile stuck");
        assert_eq!(fixed, 1);
        let loaded_stuck = get_recording_by_id(&conn, "rec-crashed")
            .expect("get stuck")
            .expect("stuck row");
        assert_eq!(loaded_stuck.status, "interrupted");
    }

    #[test]
    #[ignore = "Requires Windows Credential Manager session"]
    fn windows_keyring_roundtrip_persists_secret() {
        save_riot_api_key("RGAPI-test-roundtrip").expect("store secret");
        assert_eq!(
            load_riot_api_key().expect("load secret"),
            "RGAPI-test-roundtrip"
        );
    }
}
