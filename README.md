# BetterJungler

**BetterJungler** is a fast, Riot-Developer-Policy-compliant Windows desktop League of Legends jungle companion and semi-transparent HUD overlay designed to help solo-queue junglers climb division by division.

## Core Features (Milestones 1–6)

- **Champ Select Advisor**: Data-driven meta champion recommendations, rune pages, and summoner spell pairings tuned to ally and enemy team compositions while strictly preserving Ranked Solo/Duo anonymity.
- **Win Condition & Enemy Jungle Playbook**: Pre-game and loading-screen synthesis highlighting Strong Side vs. Weak Side win conditions, 3-phase gameplans, **Enemy Jungle Opening Playbook** (expected clear, 1:15 ward target, invade risk), **Lane Gankability** breakdown, and multi-stage jungle routing (**1st Clear**, **2nd Clear / Respawn**, **Mid-Game Tempo**, **Late Objective Setup**) overlaid on the official **Summoner's Rift** map (`RiftMap`).
- **Live Jungle Coach & HUD Overlay**:
  - Polls the official League Live Client Data API (`127.0.0.1:2999`) with pinned Riot root CA TLS (`src-tauri/certs/riotgames.pem`).
  - Tracks **Smite Progression & Readiness** (`Base 600` -> `Unleashed 900` -> `Primal 1200`), dynamic Dragon/Voidgrub/Rift Herald/Baron/Elder objective spawn windows, context-aware macro cues, and adaptive item builds (including full-build 6th-slot replacements).
  - Compact frameless HUD overlay docked cleanly **beside the minimap** (`beside-minimap` default, plus all 4 screen corners), toggling compact click-through HUD vs. expanded view via global hotkey (`Alt+J` default, configurable in Settings), with adaptive Windows acrylic backdrop.
- **Post-Game Review & Timeline Scrubbing**:
  - Synchronized interactive **Gold/XP Differential Chart** (`GoldXpDiffChart`) and **Post-Game Rift Replay** (`PostGameTimelineMap`) with **Enemy Jungler Ghost** path visualization.
  - Clear breakdown of *What You Did Good*, *Mistakes*, *Where & How to Improve*, AI coaching debrief, and anonymized **Export Review JSON**.
- **Climb & Goals Progress Tracker**: Rolling 15-game KPI benchmarks against your target rank division, LP & KPI trend visualizations, auto-synced active improvement goals (`syncGoalsWithRollingProgress`), and high-elo meta snapshots.

## Technology Stack

- **Desktop Runtime & Security**: Tauri v2 (Rust), `reqwest` with Riot root CA TLS pinning, SQLite local cache, Windows Credential Manager (never stores Riot API keys in plaintext), and Riot API rate-limit bucket backoff (`rate_limiter.rs`).
- **Frontend UI**: React 19, TypeScript (strict), Tailwind CSS v4, `@fontsource-variable/inter`, `motion`, Vite, and Vitest + Testing Library.
- **3-Tier Liquid Glass Design System**: Restraint-first glass hierarchy combining outer desktop backdrop chrome, refractive specular pills/buttons, and flat crisp data containers for legibility over gameplay.

## Riot Developer Policy Compliance

BetterJungler adheres strictly to the Riot Games Developer Policy (`https://developer.riotgames.com/docs/lol`). Read [`docs/RIOT_COMPLIANCE.md`](docs/RIOT_COMPLIANCE.md) for the full compliance architecture (no enemy summoner cooldown tracking, no lobby deanonymization, local-only LCU/Live Client polling, and API rate-limit enforcement).

*BetterJungler isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.*

## Development & Verification

```powershell
# Install frontend dependencies
npm ci

# Typecheck, lint, test, and production bundle
npm run typecheck
npm run lint
npm run test
npm run build
```

For Rust backend tests (Windows / Rust toolchain required):

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

See [`docs/RELEASE.md`](docs/RELEASE.md) for Windows NSIS installer packaging, Authenticode signing, and Tauri v2 updater configuration.
