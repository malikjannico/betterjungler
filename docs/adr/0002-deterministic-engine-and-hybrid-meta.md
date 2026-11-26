# ADR 0002: Deterministic Coaching Engine & Hybrid Meta Data

## Status
Accepted

## Context
The app must provide immediate, reliable Champ Select recommendations, Win Condition explanations, and Adaptive Builds on day 1 with a Personal Riot API key (which has rate limits and does not expose global third-party tier-list APIs), while avoiding opaque AI latency during live gameplay.

## Decision
1. Implement a **100% deterministic TypeScript coaching engine** (`champSelectEngine`, `winConditionEngine`, `liveCoachEngine`) backed by Riot **Data Dragon** live patch assets and a versioned **Jungle Knowledge Pack** (`src/data/jungleKnowledgePack.ts`).
2. Enrich recommendations with the user's own Riot **Mastery-V4 / League-V4** data in Milestone 1, and reserve high-elo Match-V5 sampling and optional **BYOK AI Coach** narratives for Milestone 2.

## Consequences
- **Pros**:
  - Sub-millisecond calculation time, zero cloud dependency or LLM cost, and predictable, unit-testable coaching outputs.
  - Works offline in Demo Simulation Mode immediately.
- **Cons / Mitigations**:
  - Baseline meta tiers and champion metadata require periodic updates alongside major patches until Milestone 2's high-elo Match-V5 sampler automates meta refresh.
