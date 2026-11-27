# ADR 0003: Ed25519 Signed Patch Packs, Role-Isolated Learning & Grounded AI Coach

## Status
Accepted (Implemented in `v1.4.0`–`v2.1.0`)

## Context
League of Legends patch numbers, camp/objective spawn timers, and role benchmarks shift across seasons (e.g., Season 2026 removing Atakhan and moving Scuttle to `2:55`, Voidgrubs to `8:00`, Herald to `15:00`, Baron to `20:00`). Additionally, adding optional LLM narrative debriefs introduces hallucination, rate-limit (`HTTP 429`), and billing-tier risks if left unguarded.

## Decision
1. **Signed Hot-Swappable Patch Packs (`src-tauri/src/patch_pack.rs`)**: Distribute objective timings, Smite thresholds, Jungle meta overrides, and `role_benchmarks.bottom` in canonical length-prefixed JSON envelopes (`knowledge/<patch>.json`) verified strictly against a pinned Ed25519 public key with anti-rollback checks and verified embedded fallbacks.
2. **Deterministic Role-Isolated SQLite Learning (`src-tauri/src/storage.rs`)**: Persist normalized participant roles (`JUNGLE` vs `BOTTOM` vs off-roles) in SQLite v6, computing EWM baselines, Wilson 95% surfacing gates, and mistake hits strictly per role so Jungle and ADC metrics never pollute each other.
3. **Grounded BYOK AI Coach (`src-tauri/src/ai_coach.rs`, `src/domain/aiFactValidator.ts`)**: Cross-check all generated narratives against unit-scoped telemetry numbers and role tokens, pair curated presets with `429`/`402` diagnostics and response caching (`aiResponseCache.ts`), and retain full offline deterministic fallbacks (`aiCoachFallback.ts`).

## Consequences
- **Pros**: Zero-rebuild patch timer updates, trustworthy statistical leak detection per role, and verifiable AI debriefs that never fabricate stats or cross-role terms.
- **Cons / Mitigations**: Patch pack updates require signing with an external Ed25519 key outside the repo (`scripts/sign-patch-pack.mjs`), and AI coach providers reject ungrounded responses cleanly with deterministic fallback options.
