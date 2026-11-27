# Changelog

All notable changes to **BetterJungler** are documented in this file.

## [0.2.0] - 2026-11-27

### Added
- **Tauri v2 Auto-Updater with In-Game Safety Gate**: Silent background update checks on idle, per-version sidebar update pill, Settings About & Updates panel, cryptographic Ed25519 verification, and strict protection preventing installation during Champ Select or active matches.
- **Single-Source Changelog & What's New**: Bundled `CHANGELOG.md` viewer in Settings and post-upgrade dismissible "What's New" banner when idle.
- **Riot API Key Health Probe**: Automatic `/lol/status/v4/platform-data` verification distinguishing valid, expired (401/403), rate-limited (429), and offline states.
- **LCU Gameflow Phase & Live Debounce**: 3-miss Live Client tolerance plus direct `/lol-gameflow/v1/gameflow-phase` tracking so transient hiccups never interrupt in-game coaching.
- **Desktop Hygiene**: Single-instance lock (`tauri-plugin-single-instance`), file-backed logs in AppData (`Open Logs Folder`), minimize-to-tray on close, and CI version/changelog synchronization guards.

### Fixed
- Eliminated the silent `participants.first()` fallback when a target PUUID is missing in Match-V5 normalization, plus `0`-ID enemy jungler fallback inflating gold/XP diffs.
- Auto-reset Scenario Simulator back to `idle` whenever live League client phases become active.
- Fixed export error feedback styling, `NaN` event marker filtering, minute-0 chart/map synchronization, keyboard `Auto-met` goal accessibility, and contradictory demo LP fixture data.

## [0.1.0] - 2026-11-26

### Added
- Initial **BetterJungler** foundation: Champ Select Draft Coach, Win Condition & Enemy Jungle Playbook on official Summoner's Rift map (`map11.png`), Adaptive Live Coach & Beside-Minimap Compact HUD, Post-Game Timeline Replay with Enemy Jungler Ghost & JSON Export, and 15-game Climb & Goals tracker.
