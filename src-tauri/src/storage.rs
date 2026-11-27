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
            model: "gemini-2.5-flash".to_string(),
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
    pub window_width: Option<f64>,
    pub window_height: Option<f64>,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub target_division: String,
    pub has_api_key: bool,
    pub update_mode: String,
    pub riot_api_proxy_url: String,
    pub ai_coach: AiCoachConfig,
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
            window_width: None,
            window_height: None,
            window_x: None,
            window_y: None,
            target_division: "PLATINUM IV".to_string(),
            has_api_key: false,
            update_mode: "manual".to_string(),
            riot_api_proxy_url: String::new(),
            ai_coach: AiCoachConfig::default(),
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
                assists INTEGER NOT NULL
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

        backfill_match_facts(conn)?;

        conn.pragma_update(None, "user_version", 2_i64)
            .map_err(|e| AppError::Storage(e.to_string()))?;
    }

    Ok(())
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

fn upsert_match_facts(
    conn: &Connection,
    match_id: &str,
    puuid: &str,
    played_at: &str,
    detail: &Value,
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

    conn.execute(
        "INSERT INTO matches_fact (
            match_id, puuid, played_at, champion_id, champion_name,
            win, duration_sec, map_side, kills, deaths, assists
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
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
            assists = excluded.assists",
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
            assists
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
    let gd_15 = frame15.map(|f| {
        f["totalGold"].as_i64().unwrap_or(0) - f["enemyJunglerGold"].as_i64().unwrap_or(0)
    });
    let xp_15 =
        frame15.map(|f| f["xp"].as_i64().unwrap_or(0) - f["enemyJunglerXp"].as_i64().unwrap_or(0));

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
    let early_deaths = player_death_ts.iter().filter(|&&ts| ts < 600).count() as i64;
    let spawn_windows = [300_i64, 360, 840, 1500];
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
            early_deaths, pre_obj_deaths
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
            pre_obj_deaths = excluded.pre_obj_deaths",
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
            pre_obj_deaths
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

    let has_mistakes: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM mistake_hits WHERE match_id = ?1",
            params![match_id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if has_mistakes == 0 {
        for d_ts in &pre_obj_ts {
            conn.execute(
                "INSERT INTO mistake_hits (match_id, detector_id, timestamp_sec, severity, detail)
                 VALUES (?1, 'pre_obj_death', ?2, 'high', 'Died before major objective spawn/take')",
                params![match_id, d_ts],
            )
            .map_err(|e| AppError::Storage(e.to_string()))?;
        }
    }

    let now_iso = chrono::Utc::now().to_rfc3339();
    if let Ok((n, avg_cs, avg_vis, avg_pre)) = conn.query_row(
        "SELECT COUNT(*), AVG(cs_per_min), AVG(vision_per_min), AVG(pre_obj_deaths) FROM match_metrics",
        [],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, Option<f64>>(2)?,
                row.get::<_, Option<f64>>(3)?,
            ))
        },
    ) {
        if n > 0 {
            for (b_key, b_val) in [
                ("cs_per_min", avg_cs.unwrap_or(0.0)),
                ("vision_per_min", avg_vis.unwrap_or(0.0)),
                ("pre_obj_deaths", avg_pre.unwrap_or(0.0)),
            ] {
                conn.execute(
                    "INSERT INTO baselines (key, scope, value, sample_n, updated_at)
                     VALUES (?1, 'global', ?2, ?3, ?4)
                     ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        sample_n = excluded.sample_n,
                        updated_at = excluded.updated_at",
                    params![b_key, b_val, n, now_iso],
                )
                .map_err(|e| AppError::Storage(e.to_string()))?;
            }
        }
    }

    Ok(())
}

pub fn backfill_match_facts(conn: &Connection) -> AppResult<()> {
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
            upsert_match_facts(conn, &match_id, &puuid, &played_at, &detail)?;
        }
    }
    Ok(())
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

pub fn save_riot_api_key(api_key: &str) -> AppResult<()> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return Err(AppError::Credential("API key cannot be empty".to_string()));
    }
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    entry
        .set_password(trimmed)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    Ok(())
}

pub fn load_riot_api_key() -> AppResult<String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    entry
        .get_password()
        .map_err(|e| AppError::Credential(format!("No Riot API key configured: {e}")))
}

pub fn has_riot_api_key() -> bool {
    Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|e| e.get_password())
        .map(|k| !k.trim().is_empty())
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
        assert_eq!(user_ver, 2);

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
        assert_eq!(baseline_count, 3);

        // Atomic focus toggle across multiple goals + error on unknown ID
        let g1 = ClimbGoalRecord {
            id: "g1".to_string(),
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
    #[ignore = "Requires Windows Credential Manager session"]
    fn windows_keyring_roundtrip_persists_secret() {
        save_riot_api_key("RGAPI-test-roundtrip").expect("store secret");
        assert_eq!(
            load_riot_api_key().expect("load secret"),
            "RGAPI-test-roundtrip"
        );
    }
}
