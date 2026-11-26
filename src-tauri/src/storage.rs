use std::path::Path;

use keyring::Entry;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "betterjungler";
const KEYRING_USER: &str = "riot_api_key";
const KEYRING_AI_USER: &str = "ai_api_key";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCoachConfig {
    pub provider: String, // "off" | "gemini" | "openai" | "ollama"
    pub model: String,
    pub endpoint: String,
    #[serde(default)]
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

fn default_hud_corner() -> String {
    "top-right".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub riot_id: String,
    pub region: String,
    pub lol_install_path: String,
    pub overlay_hotkey: String,
    #[serde(default = "default_hud_corner")]
    pub hud_corner: String,
    pub hud_opacity: u8,
    pub target_division: String,
    pub has_api_key: bool,
    #[serde(default)]
    pub ai_coach: AiCoachConfig,
}

impl Default for UserSettings {
    fn default() -> Self {
        Self {
            riot_id: String::new(),
            region: "EUW1".to_string(),
            lol_install_path: r"C:\Riot Games\League of Legends".to_string(),
            overlay_hotkey: "Alt+J".to_string(),
            hud_corner: default_hud_corner(),
            hud_opacity: 92,
            target_division: "PLATINUM IV".to_string(),
            has_api_key: false,
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
    pub win: bool,
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
}

pub fn init_database(db_path: &Path) -> AppResult<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Storage(e.to_string()))?;
    }
    let conn = Connection::open(db_path).map_err(|e| AppError::Storage(e.to_string()))?;
    run_migrations(&conn)?;
    Ok(conn)
}

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
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
            win INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
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
        if let Ok(sv) = serde_json::from_str::<Value>(&s) {
            summaries.push(sv);
        }
        if let Ok(dv) = serde_json::from_str::<Value>(&d) {
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
    let is_apex = matches!(
        normalized.as_str(),
        "MASTER" | "GRANDMASTER" | "CHALLENGER"
    );
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

pub fn get_latest_lp_snapshot(conn: &Connection) -> AppResult<Option<LpHistoryRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, tier, rank, league_points, absolute_lp, win
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
                win: row.get::<_, i64>(5)? != 0,
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
    conn.execute(
        "INSERT INTO lp_history (timestamp, tier, rank, league_points, absolute_lp, win)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            rec.timestamp,
            rec.tier,
            rec.rank,
            rec.league_points,
            rec.absolute_lp,
            if rec.win { 1 } else { 0 }
        ],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn list_lp_history(conn: &Connection, limit: usize) -> AppResult<Vec<LpHistoryRecord>> {
    let mut stmt = conn
        .prepare(
            "SELECT timestamp, tier, rank, league_points, absolute_lp, win
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
                win: row.get::<_, i64>(5)? != 0,
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
    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| AppError::Credential(e.to_string()))?;
    entry
        .set_password(trimmed)
        .map_err(|e| AppError::Credential(e.to_string()))?;
    Ok(())
}

pub fn load_riot_api_key() -> AppResult<String> {
    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| AppError::Credential(e.to_string()))?;
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
        return Err(AppError::Credential("AI API key cannot be empty".to_string()));
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
        };

        upsert_climb_goal(&conn, &goal).expect("upsert goal");
        let goals = list_climb_goals(&conn).expect("list goals");
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].title, "Hit 6.6 CS/min");

        delete_climb_goal(&conn, "goal-1").expect("delete goal");
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
            win: true,
        };
        assert_eq!(lp.absolute_lp, 1464);
        append_lp_snapshot(&conn, &lp).expect("append lp");
        let hist = list_lp_history(&conn, 10).expect("list lp");
        assert_eq!(hist.len(), 1);
        assert_eq!(tier_rank_to_absolute_lp("MASTER", "I", 180), 2980);
        assert_eq!(tier_rank_to_absolute_lp("DIAMOND", "I", 99), 2799);
    }

    #[test]
    #[ignore = "Requires Windows Credential Manager session"]
    fn windows_keyring_roundtrip_persists_secret() {
        save_riot_api_key("RGAPI-test-roundtrip").expect("store secret");
        assert_eq!(load_riot_api_key().expect("load secret"), "RGAPI-test-roundtrip");
    }
}
