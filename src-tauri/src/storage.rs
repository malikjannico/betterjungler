use std::path::Path;

use keyring::Entry;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "betterjungler";
const KEYRING_USER: &str = "riot_api_key";

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
        }
    }
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

        -- Milestone 2 ready tables
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

        CREATE TABLE IF NOT EXISTS climb_goals (
            id TEXT PRIMARY KEY,
            target_division TEXT NOT NULL,
            metric TEXT NOT NULL,
            target_value REAL NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
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

    let mut settings = if let Some(row) = rows.next().map_err(|e| AppError::Storage(e.to_string()))? {
        let json: String = row.get(0).map_err(|e| AppError::Storage(e.to_string()))?;
        serde_json::from_str::<UserSettings>(&json).unwrap_or_default()
    } else {
        UserSettings::default()
    };

    settings.has_api_key = has_riot_api_key();
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
}
