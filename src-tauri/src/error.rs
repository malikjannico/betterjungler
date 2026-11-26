use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Credential error: {0}")]
    Credential(String),

    #[error("League Client (LCU) error: {0}")]
    Lcu(String),

    #[error("Riot API error: {0}")]
    RiotApi(String),

    #[error("Security policy violation: {0}")]
    SecurityPolicy(String),

    #[error("Overlay error: {0}")]
    Overlay(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
