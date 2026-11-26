# Product Requirements Document (PRD) — BetterJungler

## 1. Vision & Goal
Help a solo-queue League of Legends jungler climb **division by division** by translating complex draft, macro, pathing, vision, and itemization decisions into clear, glanceable, Riot-policy-compliant guidance across every phase of a match.

## 2. Target User & Deployment Model
- **Primary User**: Personal Windows desktop player playing League of Legends in Borderless Windowed mode.
- **Deployment**: Local-first Tauri v2 Windows desktop executable using the user's personal Riot Developer API key and local LoL client endpoints (`LCU` + `Live Client Data API`).

## 3. Lean Delivery Milestones

### Milestone 1 — Lean MVP (Current Scope)
| ID | User Story | Acceptance Criteria |
|---|---|---|
| M1-01 | As a player in Champ Select, I want the app to suggest optimal junglers for my draft and current patch. | Detects picks/bans via LCU (or Demo Mode), enforces Ranked Solo/Duo anonymity, scores team gaps & matchups, and shows Top 5 junglers with runes/spells. |
| M1-02 | As a player in Champ Select, I want to apply recommended runes and summoner spells quickly without manual errors. | Clicking "Apply Runes & Spells" updates a rune page and selected spells via LCU. Never auto-picks/bans/accepts queue. |
| M1-03 | As a player in Loading Screen, I want to see the game's win conditions and my starting clear & ward plan. | Displays Primary Win Condition, Enemy Win Condition to deny, Strong/Weak sides, 3-phase playbook, and an SVG Summoner's Rift map with numbered route nodes & ward spots. |
| M1-04 | As a player in-game, I want an unobstructed HUD overlay that updates builds, objectives, and macro cues live. | Compact click-through dark HUD strip with `Alt+J` toggle to Expanded mode. Updates items, trinkets, potions, full-build swaps, and objective windows from `127.0.0.1:2999`. |
| M1-05 | As a developer/tester, I want a Demo Simulation Mode to inspect every phase offline. | Instant switching across `Idle`, `Champ Select`, `Loading`, `Early Game`, `Mid Game`, and `Full Build` fixtures. |

### Milestone 2 — Post-Game Review & Climb Ladder (Next Iteration)
| ID | User Story | Acceptance Criteria |
|---|---|---|
| M2-01 | Post-Game Match-V5 Timeline Review | Fetches latest Match-V5 + Timeline, plots pathing/wards/deaths on Summoner's Rift, highlights good plays vs mistakes. |
| M2-02 | Division-Benchmarked Climb Ladder & Goals | Compares rolling jungle KPIs (CS/min, objective share, pre-objective deaths, vision score, GD@15) to next target division and assigns 1–3 focus goals. |
| M2-03 | Rate-Limit-Safe High-Elo Sampler | Background sampling of Challenger/GM/Master Match-V5 jungle games into SQLite to keep builds/meta fresh organically. |
| M2-04 | Optional BYOK AI Coach | Allows user-supplied Gemini/OpenAI/Ollama key to enrich win-condition and post-game narratives while keeping deterministic core 100% functional offline. |

## 4. Non-Functional Requirements
- **Performance**: Minimal CPU/RAM overhead during active gameplay; 1–2s polling intervals for local endpoints.
- **Security**: API key stored exclusively in Windows Credential Manager; loopback TLS relaxation strictly confined to `127.0.0.1`.
- **Compliance**: Full adherence to Riot Games Developer Policy (see [RIOT_COMPLIANCE.md](RIOT_COMPLIANCE.md)).
