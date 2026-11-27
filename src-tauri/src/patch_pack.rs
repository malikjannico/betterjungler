use std::fs;
use std::path::Path;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chrono::DateTime;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const BETTERJUNGLER_PACK_PUBLIC_KEY_B64: &str = "Baft49B+jTbKBNsdoqgDdbO7pPHC3YvUH/j6N5+yrYg=";
pub const MAX_PACK_BYTES: usize = 512 * 1024;
const ACTIVE_KNOWLEDGE_FILENAME: &str = "knowledge-active.json";
const EMBEDDED_KNOWLEDGE_PACK: &str = include_str!("../../knowledge/16.23.1.json");
const EMBEDDED_META_PACK: &str = include_str!("../../knowledge/meta-16.23.1.json");

fn default_voidgrubs_despawn_sec() -> i64 {
    885
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ObjectiveTimingsConfig {
    pub scuttle_initial_sec: i64,
    pub dragon_first_spawn_sec: i64,
    pub dragon_respawn_sec: i64,
    pub elder_respawn_sec: i64,
    pub voidgrubs_spawn_sec: i64,
    #[serde(default = "default_voidgrubs_despawn_sec")]
    pub voidgrubs_despawn_sec: i64,
    pub herald_spawn_sec: i64,
    pub herald_despawn_sec: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub atakhan_spawn_sec: Option<i64>,
    pub baron_spawn_sec: i64,
    pub baron_respawn_sec: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmiteThresholdsConfig {
    pub base_damage: i64,
    pub unleashed_damage: i64,
    pub primal_damage: i64,
    pub unleashed_stacks: i64,
    pub primal_stacks: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChampionTierOverride {
    pub champion_id: i64,
    pub champion_name: String,
    pub meta_tier: String,
    pub meta_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgePackPayload {
    pub objective_timings: ObjectiveTimingsConfig,
    pub smite_thresholds: SmiteThresholdsConfig,
    pub meta_tier_overrides: Vec<ChampionTierOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_benchmarks: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct MetaPackPayload {
    patch: String,
    region: String,
    sample_matches: i64,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedPackEnvelope {
    pub schema_version: u32,
    pub kind: String,
    pub patch: String,
    pub issued_at: String,
    pub payload_json: String,
    pub signature_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivePatchPackStatus {
    pub patch: String,
    pub issued_at: String,
    pub verified: bool,
    pub meta_verified: bool,
    pub source: String,
    pub fallback_reason: Option<String>,
    pub payload: KnowledgePackPayload,
}

fn push_len_prefixed(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    buf.extend_from_slice(bytes);
}

/// Unambiguous domain-separated, length-prefixed canonical signing bytes matching
/// `scripts/sign-patch-pack.mjs::buildCanonicalSigningBytes`.
pub fn canonical_signing_bytes(env: &SignedPackEnvelope) -> Vec<u8> {
    let mut buf = Vec::with_capacity(
        32 + env.kind.len() + env.patch.len() + env.issued_at.len() + env.payload_json.len(),
    );
    buf.extend_from_slice(b"betterjungler-pack-v1\0");
    buf.extend_from_slice(&env.schema_version.to_be_bytes());
    push_len_prefixed(&mut buf, &env.kind);
    push_len_prefixed(&mut buf, &env.patch);
    push_len_prefixed(&mut buf, &env.issued_at);
    push_len_prefixed(&mut buf, &env.payload_json);
    buf
}

pub fn decode_pinned_public_key(b64: &str) -> AppResult<[u8; 32]> {
    let raw = BASE64
        .decode(b64.trim())
        .map_err(|e| AppError::SecurityPolicy(format!("Invalid pinned Ed25519 key: {e}")))?;
    let arr: [u8; 32] = raw
        .try_into()
        .map_err(|_| AppError::SecurityPolicy("Pinned Ed25519 key must be 32 bytes".to_string()))?;
    Ok(arr)
}

fn validate_knowledge_payload(payload: &KnowledgePackPayload) -> AppResult<()> {
    let t = &payload.objective_timings;
    if [
        t.scuttle_initial_sec,
        t.dragon_first_spawn_sec,
        t.dragon_respawn_sec,
        t.elder_respawn_sec,
        t.voidgrubs_spawn_sec,
        t.voidgrubs_despawn_sec,
        t.herald_spawn_sec,
        t.herald_despawn_sec,
        t.baron_spawn_sec,
        t.baron_respawn_sec,
    ]
    .iter()
    .any(|&v| v <= 0 || v > 7200)
    {
        return Err(AppError::SecurityPolicy(
            "Knowledge pack objective timings out of valid bounds (1..7200s)".to_string(),
        ));
    }
    if t.voidgrubs_despawn_sec <= t.voidgrubs_spawn_sec {
        return Err(AppError::SecurityPolicy(
            "Knowledge pack voidgrubsDespawnSec must exceed voidgrubsSpawnSec".to_string(),
        ));
    }
    if t.herald_despawn_sec <= t.herald_spawn_sec {
        return Err(AppError::SecurityPolicy(
            "Knowledge pack heraldDespawnSec must exceed heraldSpawnSec".to_string(),
        ));
    }
    let s = &payload.smite_thresholds;
    if s.base_damage <= 0
        || s.unleashed_damage <= s.base_damage
        || s.primal_damage <= s.unleashed_damage
        || s.primal_damage > 5000
        || s.unleashed_stacks <= 0
        || s.primal_stacks <= s.unleashed_stacks
        || s.primal_stacks > 200
    {
        return Err(AppError::SecurityPolicy(
            "Knowledge pack smite thresholds out of valid monotonic bounds".to_string(),
        ));
    }
    if payload
        .meta_tier_overrides
        .iter()
        .any(|c| !c.meta_score.is_finite() || !(0.0..=100.0).contains(&c.meta_score))
    {
        return Err(AppError::SecurityPolicy(
            "Knowledge pack metaScore must be finite within 0..=100".to_string(),
        ));
    }
    Ok(())
}

pub fn verify_envelope_with_key(
    env: &SignedPackEnvelope,
    expected_kind: &str,
    public_key_bytes: &[u8; 32],
) -> AppResult<()> {
    if env.schema_version != 1 {
        return Err(AppError::SecurityPolicy(format!(
            "Unsupported patch pack schemaVersion: {}",
            env.schema_version
        )));
    }
    if env.kind != expected_kind {
        return Err(AppError::SecurityPolicy(format!(
            "Patch pack kind mismatch: expected '{}', got '{}'",
            expected_kind, env.kind
        )));
    }
    if env.patch.trim().is_empty() || env.patch.contains(':') {
        return Err(AppError::SecurityPolicy(
            "Patch pack patch version must be non-empty without colons".to_string(),
        ));
    }
    DateTime::parse_from_rfc3339(env.issued_at.trim()).map_err(|_| {
        AppError::SecurityPolicy("Patch pack issuedAt must be a valid RFC3339 timestamp".into())
    })?;

    let verifying_key = VerifyingKey::from_bytes(public_key_bytes)
        .map_err(|e| AppError::SecurityPolicy(format!("Invalid Ed25519 verifying key: {e}")))?;
    let sig_raw = BASE64
        .decode(env.signature_b64.trim())
        .map_err(|e| AppError::SecurityPolicy(format!("Malformed pack signature Base64: {e}")))?;
    let sig_arr: [u8; 64] = sig_raw.try_into().map_err(|_| {
        AppError::SecurityPolicy("Ed25519 pack signature must be 64 bytes".to_string())
    })?;
    let signature = Signature::from_bytes(&sig_arr);
    let msg = canonical_signing_bytes(env);
    verifying_key.verify_strict(&msg, &signature).map_err(|e| {
        AppError::SecurityPolicy(format!("Ed25519 signature verification failed: {e}"))
    })
}

pub fn verify_and_decode_knowledge_pack_with_key(
    raw_json: &str,
    public_key_bytes: &[u8; 32],
) -> AppResult<(SignedPackEnvelope, KnowledgePackPayload)> {
    if raw_json.len() > MAX_PACK_BYTES {
        return Err(AppError::SecurityPolicy(
            "Patch pack exceeds 512 KB maximum size limit".to_string(),
        ));
    }
    let env: SignedPackEnvelope = serde_json::from_str(raw_json)
        .map_err(|e| AppError::SecurityPolicy(format!("Malformed signed pack JSON: {e}")))?;
    verify_envelope_with_key(&env, "knowledge", public_key_bytes)?;
    let payload: KnowledgePackPayload = serde_json::from_str(&env.payload_json)
        .map_err(|e| AppError::SecurityPolicy(format!("Malformed knowledge pack payload: {e}")))?;
    validate_knowledge_payload(&payload)?;
    Ok((env, payload))
}

fn load_embedded_knowledge_pack() -> AppResult<(SignedPackEnvelope, KnowledgePackPayload)> {
    let pub_key = decode_pinned_public_key(BETTERJUNGLER_PACK_PUBLIC_KEY_B64)?;
    verify_and_decode_knowledge_pack_with_key(EMBEDDED_KNOWLEDGE_PACK, &pub_key)
}

fn verify_embedded_meta_pack_with_key(
    public_key_bytes: &[u8; 32],
) -> AppResult<SignedPackEnvelope> {
    let env: SignedPackEnvelope = serde_json::from_str(EMBEDDED_META_PACK)
        .map_err(|e| AppError::SecurityPolicy(format!("Malformed embedded meta pack JSON: {e}")))?;
    verify_envelope_with_key(&env, "meta", public_key_bytes)?;
    let meta_payload: MetaPackPayload = serde_json::from_str(&env.payload_json)
        .map_err(|e| AppError::SecurityPolicy(format!("Malformed meta pack payload: {e}")))?;
    if meta_payload.patch.trim().is_empty()
        || meta_payload.patch.trim() != env.patch.trim()
        || meta_payload.sample_matches <= 0
    {
        return Err(AppError::SecurityPolicy(
            "Meta pack payload requires non-empty matching patch and positive sampleMatches"
                .to_string(),
        ));
    }
    Ok(env)
}

#[cfg(test)]
pub fn verify_embedded_meta_pack() -> AppResult<SignedPackEnvelope> {
    let pub_key = decode_pinned_public_key(BETTERJUNGLER_PACK_PUBLIC_KEY_B64)?;
    verify_embedded_meta_pack_with_key(&pub_key)
}

fn ensure_not_older(candidate_issued_at: &str, baseline_issued_at: &str) -> AppResult<()> {
    let new_dt = DateTime::parse_from_rfc3339(candidate_issued_at.trim()).map_err(|_| {
        AppError::SecurityPolicy("Candidate patch pack issuedAt is not valid RFC3339".to_string())
    })?;
    let cur_dt = DateTime::parse_from_rfc3339(baseline_issued_at.trim()).map_err(|_| {
        AppError::SecurityPolicy("Active patch pack issuedAt is not valid RFC3339".to_string())
    })?;
    if new_dt < cur_dt {
        return Err(AppError::SecurityPolicy(format!(
            "Rejected patch pack rollback ({} is older than active {})",
            candidate_issued_at, baseline_issued_at
        )));
    }
    Ok(())
}

pub fn load_active_patch_pack_with_key(
    pack_dir: &Path,
    public_key_bytes: &[u8; 32],
) -> AppResult<ActivePatchPackStatus> {
    let (emb_env, emb_payload) = load_embedded_knowledge_pack()?;
    let meta_verified = verify_embedded_meta_pack_with_key(public_key_bytes).is_ok();

    let hot_path = pack_dir.join(ACTIVE_KNOWLEDGE_FILENAME);
    let mut fallback_reason: Option<String> = None;

    if hot_path.exists() {
        let size_ok = fs::metadata(&hot_path)
            .map(|m| m.len() <= MAX_PACK_BYTES as u64)
            .unwrap_or(false);
        if !size_ok {
            fallback_reason =
                Some("Hot-swapped patch pack exceeded 512 KB size limit or metadata error".into());
        } else {
            match fs::read_to_string(&hot_path) {
                Ok(raw) => {
                    match verify_and_decode_knowledge_pack_with_key(&raw, public_key_bytes) {
                        Ok((env, payload)) => {
                            if let Err(rollback_err) =
                                ensure_not_older(&env.issued_at, &emb_env.issued_at)
                            {
                                tracing::warn!(error = %rollback_err, "Rollback hot-swapped pack rejected; falling back to embedded verified pack");
                                fallback_reason = Some(rollback_err.to_string());
                            } else {
                                return Ok(ActivePatchPackStatus {
                                    patch: env.patch,
                                    issued_at: env.issued_at,
                                    verified: true,
                                    meta_verified,
                                    source: "hot_swapped".to_string(),
                                    fallback_reason: None,
                                    payload,
                                });
                            }
                        }
                        Err(err) => {
                            tracing::warn!(error = %err, "Invalid hot-swapped patch pack; falling back to embedded verified pack");
                            fallback_reason = Some(err.to_string());
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(error = %err, "Unreadable hot-swapped patch pack; falling back to embedded verified pack");
                    fallback_reason = Some(err.to_string());
                }
            }
        }
    }

    Ok(ActivePatchPackStatus {
        patch: emb_env.patch,
        issued_at: emb_env.issued_at,
        verified: true,
        meta_verified,
        source: if fallback_reason.is_some() {
            "embedded_fallback".to_string()
        } else {
            "embedded".to_string()
        },
        fallback_reason,
        payload: emb_payload,
    })
}

pub fn load_active_patch_pack(pack_dir: &Path) -> AppResult<ActivePatchPackStatus> {
    let pub_key = decode_pinned_public_key(BETTERJUNGLER_PACK_PUBLIC_KEY_B64)?;
    load_active_patch_pack_with_key(pack_dir, &pub_key)
}

pub fn install_signed_patch_pack_with_key(
    pack_dir: &Path,
    envelope_json: &str,
    public_key_bytes: &[u8; 32],
) -> AppResult<ActivePatchPackStatus> {
    let (env, payload) =
        verify_and_decode_knowledge_pack_with_key(envelope_json, public_key_bytes)?;
    let current = load_active_patch_pack_with_key(pack_dir, public_key_bytes)?;
    ensure_not_older(&env.issued_at, &current.issued_at)?;

    fs::create_dir_all(pack_dir).map_err(|e| AppError::Storage(e.to_string()))?;
    let target_path = pack_dir.join(ACTIVE_KNOWLEDGE_FILENAME);
    let unique_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = pack_dir.join(format!(
        "{ACTIVE_KNOWLEDGE_FILENAME}.{}.{unique_suffix}.tmp",
        std::process::id()
    ));
    fs::write(&tmp_path, envelope_json).map_err(|e| AppError::Storage(e.to_string()))?;
    fs::rename(&tmp_path, &target_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        AppError::Storage(e.to_string())
    })?;

    Ok(ActivePatchPackStatus {
        patch: env.patch,
        issued_at: env.issued_at,
        verified: true,
        meta_verified: current.meta_verified,
        source: "hot_swapped".to_string(),
        fallback_reason: None,
        payload,
    })
}

pub fn install_signed_patch_pack(
    pack_dir: &Path,
    envelope_json: &str,
) -> AppResult<ActivePatchPackStatus> {
    let pub_key = decode_pinned_public_key(BETTERJUNGLER_PACK_PUBLIC_KEY_B64)?;
    install_signed_patch_pack_with_key(pack_dir, envelope_json, &pub_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn sign_test_envelope(
        signing_key: &SigningKey,
        patch: &str,
        issued_at: &str,
        dragon_spawn: i64,
    ) -> String {
        let payload = serde_json::json!({
            "objectiveTimings": {
                "scuttleInitialSec": 175,
                "dragonFirstSpawnSec": dragon_spawn,
                "dragonRespawnSec": 300,
                "elderRespawnSec": 360,
                "voidgrubsSpawnSec": 480,
                "voidgrubsDespawnSec": 885,
                "heraldSpawnSec": 900,
                "heraldDespawnSec": 1185,
                "baronSpawnSec": 1200,
                "baronRespawnSec": 360
            },
            "smiteThresholds": {
                "baseDamage": 600,
                "unleashedDamage": 1000,
                "primalDamage": 1400,
                "unleashedStacks": 20,
                "primalStacks": 35
            },
            "metaTierOverrides": []
        });
        let mut env = SignedPackEnvelope {
            schema_version: 1,
            kind: "knowledge".to_string(),
            patch: patch.to_string(),
            issued_at: issued_at.to_string(),
            payload_json: payload.to_string(),
            signature_b64: String::new(),
        };
        let msg = canonical_signing_bytes(&env);
        let sig = signing_key.sign(&msg);
        env.signature_b64 = BASE64.encode(sig.to_bytes());
        serde_json::to_string(&env).expect("serialize test envelope")
    }

    #[test]
    fn embedded_knowledge_and_meta_packs_verify_with_pinned_key() {
        let (k_env, k_payload) = load_embedded_knowledge_pack().expect("embedded knowledge valid");
        assert_eq!(k_env.patch, "16.23.1");
        assert_eq!(k_payload.objective_timings.dragon_first_spawn_sec, 300);
        assert_eq!(k_payload.objective_timings.herald_spawn_sec, 900);
        assert_eq!(k_payload.objective_timings.baron_spawn_sec, 1200);
        assert_eq!(k_payload.smite_thresholds.primal_damage, 1400);

        let m_env = verify_embedded_meta_pack().expect("embedded meta valid");
        assert_eq!(m_env.patch, "16.23.1");
        assert_eq!(m_env.kind, "meta");
    }

    #[test]
    fn legacy_pack_payload_with_atakhan_still_deserializes() {
        let legacy_json = serde_json::json!({
            "objectiveTimings": {
                "scuttleInitialSec": 210,
                "dragonFirstSpawnSec": 300,
                "dragonRespawnSec": 300,
                "elderRespawnSec": 360,
                "voidgrubsSpawnSec": 360,
                "heraldSpawnSec": 840,
                "heraldDespawnSec": 1485,
                "atakhanSpawnSec": 1200,
                "baronSpawnSec": 1500,
                "baronRespawnSec": 360
            },
            "smiteThresholds": {
                "baseDamage": 600,
                "unleashedDamage": 900,
                "primalDamage": 1200,
                "unleashedStacks": 20,
                "primalStacks": 40
            },
            "metaTierOverrides": []
        });
        let parsed: KnowledgePackPayload =
            serde_json::from_value(legacy_json).expect("legacy payload should deserialize cleanly");
        assert_eq!(parsed.objective_timings.voidgrubs_despawn_sec, 885);
        validate_knowledge_payload(&parsed).expect("legacy payload should validate");
    }

    #[test]
    fn hot_swap_anti_rollback_and_tampered_pack_fallback() {
        let temp_root = std::env::temp_dir().join(format!(
            "bj-pack-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_root).expect("create temp pack dir");

        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let pub_bytes = signing_key.verifying_key().to_bytes();

        // 1. Fresh install falls back cleanly to embedded verified 16.23.1
        let initial =
            load_active_patch_pack_with_key(&temp_root, &pub_bytes).expect("initial load");
        assert_eq!(initial.source, "embedded");
        assert_eq!(
            initial.payload.objective_timings.dragon_first_spawn_sec,
            300
        );

        // 2. Valid newer hot-swapped pack updates dragonFirstSpawnSec from 300 -> 330
        let signed_hot = sign_test_envelope(&signing_key, "16.24.1", "2026-12-01T00:00:00Z", 330);
        let installed = install_signed_patch_pack_with_key(&temp_root, &signed_hot, &pub_bytes)
            .expect("install signed hot pack");
        assert_eq!(installed.source, "hot_swapped");
        assert_eq!(installed.patch, "16.24.1");
        assert_eq!(
            installed.payload.objective_timings.dragon_first_spawn_sec,
            330
        );

        // 3. Anti-rollback rejects older validly-signed pack (issuedAt < active)
        let older_signed = sign_test_envelope(&signing_key, "16.20.1", "2026-11-01T00:00:00Z", 300);
        assert!(install_signed_patch_pack_with_key(&temp_root, &older_signed, &pub_bytes).is_err());

        // 4. Attempting to install forged pack fails without clobbering disk
        let tampered_install = signed_hot.replace("330", "335");
        assert!(
            install_signed_patch_pack_with_key(&temp_root, &tampered_install, &pub_bytes).is_err()
        );
        let still_hot =
            load_active_patch_pack_with_key(&temp_root, &pub_bytes).expect("still intact");
        assert_eq!(still_hot.patch, "16.24.1");

        // 5. Direct on-disk tamper triggers clean fallback to verified embedded defaults
        fs::write(temp_root.join(ACTIVE_KNOWLEDGE_FILENAME), &tampered_install)
            .expect("write tampered disk pack");
        let recovered =
            load_active_patch_pack_with_key(&temp_root, &pub_bytes).expect("clean fallback");
        assert_eq!(recovered.source, "embedded_fallback");
        assert!(recovered.fallback_reason.is_some());
        assert_eq!(
            recovered.payload.objective_timings.dragon_first_spawn_sec,
            300
        );

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn length_prefixed_canonical_bytes_prevent_delimiter_field_shifting() {
        let signing_key = SigningKey::from_bytes(&[9_u8; 32]);
        let pub_bytes = signing_key.verifying_key().to_bytes();
        let valid_raw = sign_test_envelope(&signing_key, "16.23.1", "2026-11-27T00:00:00Z", 300);
        let mut shifted: SignedPackEnvelope =
            serde_json::from_str(&valid_raw).expect("parse envelope");
        shifted.patch = "16.23.1:2026-11-27T00".to_string();
        shifted.issued_at = "00:00Z".to_string();
        assert!(verify_envelope_with_key(&shifted, "knowledge", &pub_bytes).is_err());
    }
}
