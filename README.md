# BetterJungler

**A clean, Riot-compliant Windows companion app & in-game HUD overlay built to help you climb division by division as a Jungler.**

> **Legal Disclaimer:** BetterJungler isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

---

## Features

### Milestone 1 (Lean MVP — Included)
- **Champion Select Coach**:
  - Reads active Champ Select state via the local League Client (LCU) API with strict **Ranked Solo/Duo anonymity masking** (`Ally 1..5` / `Enemy 1..5`).
  - Analyzes 5v5 team composition gaps (AD/AP damage split, Engage, Hard CC, Frontline, Early/Late Scaling).
  - Ranks Top 5 Jungle picks factoring in meta tier, team needs, enemy jungle matchup, ally synergy, and your personal mastery/winrate.
  - **1-Click Manual Rune & Summoner Spell Import** into the League Client (never auto-picks, auto-bans, or automates queues).
- **Loading Screen & Pre-Game Win Conditions + Tactical Map**:
  - Identifies your **Primary Win Condition**, **Enemy Win Condition to Deny**, and **Strong-Side / Weak-Side** lane assignments.
  - Interactive **SVG Summoner's Rift Tactical Map** displaying numbered first-clear camp routes (Full Clear vs. 3-Camp Gank/Invade for Blue & Red sides) and key **Ward Spots** (Early defensive, Objective setup, Deep tracking).
- **In-Game HUD Overlay (`Alt+J` Toggle)**:
  - **Compact Click-Through HUD Mode**: Glanceable always-on-top dark strip showing current phase, next objective countdown + vision prep cue, next adaptive item + trinket/potion reminder, and single-line macro cue.
  - **Expanded Interactive Mode**: Full adaptive itemization engine reacting to live enemy items/KDA/healing/AP/AD/armor threats, full-build boot/situational replacement advice, objective cadence, and compliant macro action cards.
- **Built-in Demo Simulation Mode**:
  - Test every phase (`Idle`, `Champ Select`, `Loading`, `Early Game`, `Mid Game`, `Full Build`) immediately without needing a live League of Legends match.

### Milestone 3 (Implemented)
- **Dynamic Data Dragon Hydration & 32-Jungler Roster**: Live `champion.json` & `item.json` hydration cached locally alongside 32 meta junglers across every archetype.
- **Trend Visuals**: Minute-by-minute **Gold & XP Diff vs Enemy Jungler** chart in Post-Game Review, plus **Multi-Game Death Heatmap** & **LP Climb Progression Chart** in Climb & Goals.
- **Overlay Ergonomics**: Live **HUD Opacity** (`50%–100%`), **Compact HUD Corner** positioning (`Top-Right`, `Top-Left`, `Bottom-Right`, `Bottom-Left`), and configurable **Global Hotkey** presets (`Alt+J`, `Alt+B`, `Ctrl+Shift+J`, `F8`).
- **Windows Installer Release Workflow**: Tagging `v*.*.*` automatically builds and drafts a Windows NSIS `.exe` installer via [.github/workflows/release.yml](.github/workflows/release.yml).

### Milestone 2 (Implemented)
- **Dynamic Data Dragon Hydration & 32-Jungler Roster**: Live `champion.json` & `item.json` hydration cached locally alongside 32 meta junglers across every archetype.
- **Trend Visuals**: Minute-by-minute **Gold & XP Diff vs Enemy Jungler** chart in Post-Game Review, plus **Multi-Game Death Heatmap** & **LP Climb Progression Chart** in Climb & Goals.
- **Overlay Ergonomics**: Live **HUD Opacity** (`50%–100%`), **Compact HUD Corner** positioning (`Top-Right`, `Top-Left`, `Bottom-Right`, `Bottom-Left`), and configurable **Global Hotkey** presets (`Alt+J`, `Alt+B`, `Ctrl+Shift+J`, `F8`).
- **Windows Installer Release Workflow**: Tagging `v*.*.*` automatically builds and drafts a Windows NSIS `.exe` installer via [.github/workflows/release.yml](.github/workflows/release.yml).
- **Post-Game Match-V5 Timeline Review**: Coordinate-level pathing, kill/death/pre-objective death, ward, and objective replay map on Summoner's Rift with What You Did Good / Mistakes / Where to Improve breakdowns.
- **Division-Benchmarked Climb Ladder & Goals**: Compares rolling jungle KPIs (`CS/min`, `GD@15`, `Objective Share`, `Pre-Objective Deaths`, `Vision/min`, `KP%`) against your next target division, suggests top 1–3 bottleneck goals, and persists custom goals in SQLite.
- **Rate-Limit-Safe High-Elo Match-V5 Sampler**: Caches Challenger/GM jungle sample stats into SQLite and blends live high-elo winrates into Champ Select recommendations.
- **Optional BYOK AI Coach**: Supports user-supplied Gemini, OpenAI, or local Ollama (`127.0.0.1`) for natural-language pre-game briefs and post-game debriefs (deterministic core works 100% offline).

---

## Tech Stack
- **Desktop Shell & Backend**: Tauri v2 (Rust), `rusqlite` (bundled SQLite), `keyring` (Windows Credential Manager), `reqwest` (`rustls-tls`), `tauri-plugin-global-shortcut`.
- **Frontend**: React 19, TypeScript (strict), Vite, Tailwind CSS v4, Lucide Icons, Vitest + Testing Library.

---

## Getting Started (Windows Development)

### Prerequisites
1. **Node.js 20+** and `npm` (verified on Node v24).
2. For native Windows `.exe` / Tauri compilation:
   - **Rust toolchain**:
     ```powershell
     winget install Rustlang.Rustup
     ```
   - **Visual Studio 2022 Build Tools** (Desktop development with C++ / MSVC + Windows SDK):
     ```powershell
     winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
     ```
   - **WebView2 Runtime** (pre-installed on Windows 10/11).

### Run & Verify Frontend (Works with Node.js only)
```powershell
npm install
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev
```

### Run Full Tauri Desktop Overlay
```powershell
npm run tauri dev
```

### Global Hotkey
- **`Alt+J`**: Toggle between **Compact Click-Through HUD** and **Expanded Interactive Panel** (also accessible from the Windows system tray icon).

---

## Riot API Key Setup
1. Obtain a personal/development API key from [Riot Developer Portal](https://developer.riotgames.com/).
2. Open **Settings** inside BetterJungler, enter your Riot ID (`Name#Tag`), select your region (`EUW1`, `NA1`, `KR`, etc.), and save your API key.
3. Your key is stored securely in **Windows Credential Manager** (`keyring`) — never in plaintext files or source control.

---

## SDLC & Compliance Documentation
- [Product Requirements (PRD)](docs/PRD.md)
- [System Architecture](docs/ARCHITECTURE.md)
- [Riot Developer Policy Compliance](docs/RIOT_COMPLIANCE.md)
- [ADR 0001: Tauri v2 Desktop Overlay](docs/adr/0001-tauri-v2-desktop-overlay.md)
- [ADR 0002: Deterministic Coaching Engine & Hybrid Meta](docs/adr/0002-deterministic-engine-and-hybrid-meta.md)
