# BetterJungler

[![Release v2.2.0](https://img.shields.io/github/v/release/malikjannico/betterjungler?label=release)](https://github.com/malikjannico/betterjungler/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D4)](https://github.com/malikjannico/betterjungler/releases/latest)
[![Stack](https://img.shields.io/badge/stack-Tauri%20v2%20%C2%B7%20React%2019%20%C2%B7%20Rust-10b981)](#architecture--tech-stack)
[![Riot Compliant](https://img.shields.io/badge/Riot%20Policy-Compliant-1b2838)](docs/RIOT_COMPLIANCE.md)

**BetterJungler** is a Riot-Developer-Policy-compliant Windows desktop coaching companion and live HUD overlay for League of Legends. Designed for **Jungle (Primary)** and **ADC / Bot Lane (Secondary)** solo-queue players, it turns official client telemetry, Match-V5 timelines, and Season 2026 patch data into deterministic draft advice, win plans, adaptive live overlays, and goal-driven post-game reviews.

---

## Table of Contents

- [Download & Quick Start (Windows)](#download--quick-start-windows)
- [Features by Match Phase & Role](#features-by-match-phase--role)
- [Season 2026 Patch Alignment](#season-2026-patch-alignment)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Project Structure](#project-structure)
- [Local Development & Verification](#local-development--verification)
- [Documentation Index](#documentation-index)
- [Riot Developer Policy Compliance](#riot-developer-policy-compliance)

---

## Download & Quick Start (Windows)

### Option A: Windows Installer or In-App Update (Recommended)

1. Download the latest per-user Windows NSIS installer (`BetterJungler_2.2.0_x64-setup.exe`) from [**GitHub Releases**](https://github.com/malikjannico/betterjungler/releases/latest).
2. If you already have `v2.0.0+` installed, open **Settings → Updates & About → Check for Updates** to verify the Ed25519 signature and update cleanly while idle.
3. For unsigned personal releases prior to Authenticode code signing, if Windows SmartScreen prompts, click **More info → Run anyway**.

### Option B: Optimal In-Game Display & Account Setup

- **League Video Mode**: Set League of Legends **Video → Window Mode** to **Borderless** (or Windowed) so the click-through modular HUD overlay (`Alt+J`) renders cleanly and Windows Graphics Capture can record without exclusive-fullscreen conflicts.
- **Recommended LoL HUD Settings**: Keep in-game **HUD Scale <= 50** and **Minimap Scale = 100** (see **Settings → Overlay & HUD** to toggle each of the 6 HUD widgets individually, unlock left-click-drag layout editing, or reset positions).
- **Account Data Modes**:
  - **Keyless LCU Mode**: Connects locally to the League Client (`lockfile`) and Live Client Data API (`127.0.0.1:2999`) with zero API keys required.
  - **Personal Riot API Key**: Add your Riot key in **Settings → Account & Riot API** (stored in Windows Credential Manager via `keyring`, never plaintext files) to unlock Match-V5 history, timelines, and division benchmarks.
  - **Zero-Trust Relay Proxy**: Point **Riot API Proxy URL (HTTPS)** at a self-hosted Cloudflare Worker ([`proxy/README.md`](proxy/README.md)) so end-user binaries never carry a shared Riot Production key.

---

## Features by Match Phase & Role

| Match Phase / Surface | Jungle (Primary) | ADC / Bot Lane (Secondary) | Top / Mid / Support (Off-Role) |
|---|---|---|---|
| **Champ Select** | Unified Draft Card + searchable in-app Jungle champion picker, Meta-weighted Top 5 jungle picks, team-gap analysis, Solo/Duo-anonymized enemy jungler inference, 1-click LCU runes & Smite/Flash | Unified Draft Card + searchable in-app 22-ADC picker (`16.23.1`), Support Synergy scoring, `Likely` enemy 2v2 matchup readout, 1-click LCU runes & Heal/Barrier/Cleanse + Flash | Quiet off-role banner with global coaching notice & manual Jungle/ADC preview switcher |
| **Win Plan & Map** | Strong-side vs weak-side thesis, Enemy Jungle Opening Playbook, lane gankability, 4 ordered clear routes (`RiftMap`) | 2v2 bot matchup verdict, Support Synergy playbook, `0:30` Level-2 wave plan, `2:15–2:55` enemy jungler threat window, `14:00` plates, `5:00` Dragon, Bot → Mid swap & calibrated Bot ward spots (`RiftMap`) | Gated until next Jungle/ADC draft |
| **Live Coach & Modular HUD (`Alt+J`)** | Opening clear guide, **Smite progression** (`600` / `1000` / `1400`), Dragon/Grubs/Herald/Baron timers, Skill Order, CS/min target, Game Plan & adaptive build (all 6 widgets independently draggable/toggleable) | Objective timers, reactive ADC build (recognizing Bot Quest 7th boot slot & Tier-3 boots), Farsight reminders, CS/min target, Skill Order, Lv2/Spikes widget & tactical cues | **Global Objectives Only (`OFF-ROLE · GLOBALS`)** — suppresses Smite, skill order, builds, and lane/jungle widgets |
| **Post-Game Review** | Stacked clickable Match Summary Cards → dedicated detail subpage (`← All Matches`), normalized champion names (`MonkeyKing` → `Wukong`), interactive replay map, Gold/XP chart, WGC video/clip sync or `.rofl` seek, grounded BYOK AI Debrief | Dedicated ADC KPIs (`CS@10`, `CS/min`, Lane Gold Diff @15 vs `laneOpponentGold`, Damage Share %, Pre-14 Deaths, Turret Plates, KP%), replay markers, and ADC-grounded AI Debrief | Ungraded scoreboard stats (`K/D/A`, `CS`, duration, vision) + optional video replay; excluded from Jungle/ADC benchmarks |
| **Climb & Goals (`SQLite v6`)** | Target division benchmarks, EWM personal baselines, 5 jungle mistake detectors, 95% Wilson surfacing gate, session stamina & requeue tilt analytics | Role-isolated ADC EWM baselines, provisional benchmarks (`IRON`–`MASTER`) from signed patch packs, 5 ADC mistake detectors (`adc_cs_deficit_10`, `adc_lane_death_pre_14`, `adc_low_damage_share`, `adc_pre_obj_death`, `adc_isolated_death`) | Excluded from Jungle and ADC rolling baselines |

> [!NOTE]
> Live ranked Match-V5 responses from Riot do not yet carry ally positional frames in `riot_api.rs`, so the `adc_isolated_death` detector activates on full fixture/ally-enriched timelines and stays silent when ally coordinates are absent in live syncs.

---

## Season 2026 Patch Alignment

All embedded timings and signed patch packs (`knowledge/16.23.1.json`, `knowledge/meta-16.23.1.json`) follow Season 2026 Summoner's Rift timers:

- **0:30** Minion wave spawn · **0:55** Initial jungle buff spawn
- **2:55** Initial Rift Scuttler spawn (`175s`)
- **5:00** First Elemental Dragon (`300s`)
- **8:00 – 14:45** Voidgrubs window (`480s – 885s`) · **14:00** Turret plates fall (`840s`)
- **15:00 – 19:45** Rift Herald window (`900s – 1185s`)
- **20:00** Baron Nashor (`1200s`) · Smite tiers at `600` / `1000` (`20` stacks) / `1400` (`35` stacks)

---

## Architecture & Tech Stack

BetterJungler uses a **two-window Tauri v2 desktop architecture**:

1. **Core Companion Window (`index.html` → `src/App.tsx`)**: Styled with **Material Design 3 Expressive** tokens ([`m3-expressive.css`](src/styles/m3-expressive.css)), `@fontsource-variable/roboto-flex`, `M3NavRail`, `M3TopAppBar` with a `32px` Summoner Profile Pill, stacked master-detail Post-Game & Settings workflows, and optional BYOK AI Coach (`Gemini`, `OpenAI`, `Ollama`) gated by deterministic numeric and role fact validators ([`ai_coach.rs`](src-tauri/src/ai_coach.rs), [`aiFactValidator.ts`](src/domain/aiFactValidator.ts)).
2. **Modular In-Game HUD Window (`hud.html` → `src/HudApp.tsx`)**: Strictly isolated CSS bundle (`Inter` + [`globals.css`](src/styles/globals.css) — zero M3/Roboto Flex leakage), frameless transparent full-monitor Windows overlay (`HudOverlayCanvas.tsx`) with 6 independently toggleable/draggable widgets, click-through locking (`set_ignore_cursor_events`), and zero-poll event push from Rust.
3. **Rust Backend (`src-tauri/src/`)**: Async Tauri v2 host orchestrating loopback LCU/Live Client polling with pinned Riot root CA TLS (`riotgames.pem`), bucket-aware rate limiting (`rate_limiter.rs`), Windows Credential Manager secret storage + SQLite v6 persistence (`storage.rs`), Ed25519 patch-pack verification (`patch_pack.rs`), opt-in Windows Graphics Capture Media Foundation GPU recording (`recorder.rs`), local Riot `.rofl` Replay API control (`replay_api.rs`), and signed NSIS self-updates (`updater.rs`).

---

## Project Structure

```text
betterjungler/
├── src/                        # React 19 + TypeScript frontend
│   ├── components/             # Core views, M3 primitives (m3/), modular settings (settings/), HUD plates
│   ├── data/                   # Jungle & ADC Patch 16.23.1 knowledge packs
│   ├── domain/                 # Pure deterministic coaching, role routing (roles/), ADC (adc/), and validation engines
│   ├── services/               # Data Dragon CDN catalog & typed Tauri IPC bridge
│   └── styles/                 # Isolated HUD glass CSS (globals.css) & core M3 Expressive stylesheet
├── src-tauri/                  # Tauri v2 Rust backend, capabilities, certificates & icons
├── knowledge/                  # Ed25519-signed patch & high-elo meta packs (16.23.1)
├── proxy/                      # Optional Cloudflare Worker zero-trust Riot API relay
├── packaging/winget/           # Winget 1.6 installer, version & locale manifests
├── scripts/                    # Version check, changelog extractor, icon generator, winget & pack signing tools
├── docs/                       # Architecture, PRD, Riot Compliance, Release & ADRs
└── CHANGELOG.md                # Full release history (v1.0.0 – v2.2.0)
```

---

## Local Development & Verification

**Prerequisites**: Windows 10/11 x64, Node.js `22+`, stable Rust toolchain (`rustfmt`, `clippy`), and Microsoft Visual Studio 2022 Build Tools (`MSVC` + Windows 10/11 SDK for full Tauri native builds).

```powershell
# Install dependencies
npm ci

# Frontend checks (typecheck, lint, 31 Vitest suites, production bundle)
npm run typecheck
npm run lint
npm test
npm run build

# Run desktop app in development (Vite + Tauri)
npm run tauri dev

# Rust backend checks
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Patch pack signing uses external Ed25519 keys outside the repository:

```powershell
node scripts/sign-patch-pack.mjs --write --key-file="$env:USERPROFILE\.betterjungler\pack-signing.pem"
```

---

## Documentation Index

| Document | Purpose |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Two-window design, data flow, role resolution, SQLite v6 schema, and security boundaries |
| [`docs/PRD.md`](docs/PRD.md) | Product requirements across Jungle, ADC, Off-Role, and Milestones 1–17 |
| [`docs/RIOT_COMPLIANCE.md`](docs/RIOT_COMPLIANCE.md) | Riot Developer Policy matrix (Vanguard safety, Solo/Duo anonymity, no hidden info) |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Versioning scripts, GitHub Actions NSIS pipeline, Tauri updater, Winget & proxy deployment |
| [`docs/RECORDER_AND_REPLAY_SPIKE.md`](docs/RECORDER_AND_REPLAY_SPIKE.md) | Windows Graphics Capture H.264 GPU pipeline & Riot `.rofl` Replay API implementation |
| [`docs/adr/`](docs/adr/0001-tauri-v2-desktop-overlay.md) | Architecture Decision Records (`0001`–`0004`) |
| [`proxy/README.md`](proxy/README.md) | Cloudflare Worker Riot API proxy setup & allowlist guarantees |
| [`CHANGELOG.md`](CHANGELOG.md) | Versioned release notes (`v1.0.0` through `v2.2.0`) |

---

## Riot Developer Policy Compliance

BetterJungler adheres strictly to the [Riot Games Developer Policy](https://developer.riotgames.com/docs/lol) and ships zero memory reading, process injection, queue/draft automation, enemy cooldown tracking, or fog-of-war bypasses. See [`docs/RIOT_COMPLIANCE.md`](docs/RIOT_COMPLIANCE.md) for code-level verification details.

*BetterJungler isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.*
