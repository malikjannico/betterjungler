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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub riot_id: String,
    pub region: String,
    pub lol_install_path: String,
    pub overlay_hotkey: String,
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
            hud_opacity: 92,
            target_division: "PLATINUM IV".to_string(),
            has_api_key: false,
            ai_coach: AiCoachConfig::default(),
        }
    }
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
         ON CONFLICT(match_id) DO UPDATE SET summary_json = excluded.summary_json, detail_json = excluded.detail_json",
        params![match_id, puuid, played_at, summary_json, detail_json],
    )
    .map_err(|e| AppError::Storage(e.to_string()))?;
    Ok(())
}

pub fn list_cached_matches(conn: &Connection, limit: usize) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let mut stmt = conn
        .prepare(
            "SELECT summary_json, detail_json FROM match_details_cache ORDER BY played_at DESC LIMIT ?1",
        )
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let rows = stmt
        .query_map(params![limit as i64], |row| {
            let s: String = row.get(0)?;
            let d: String = row.get(1)?;
            Ok((s, d))
        })
        .map_err(|e| AppError::Storage(e.to_string()))?;

    let mut summaries = Vec::new();
    let mut details = Vec::new();
    for item in rows {
        let (s, d) = item.map_err(|e| AppError::Storage(e.to_string()))?;
        if let Ok(sv) = serde_json::from_str::<Value>(&s) {
            summaries.push(sv);
        }
        if let Ok(dv) = serde_json::from_str::<Value>(&d) {
            details.push(dv);
        }
    }
    Ok((summaries, details))
}

pub fn get_cached_match_detail(conn: &Connection, match_id: &str) -> AppResult<Option<Value>> {
    let mut stmt = conn
        .prepare("SELECT detail_json FROM match_details_cache WHERE match_id = ?1")
        .map_err(|e| AppError::Storage(e.to_string()))?;
    let mut rows = stmt
        .query(params![match_id])
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
    }
}
