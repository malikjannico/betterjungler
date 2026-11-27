# Changelog

All notable changes to **BetterJungler** are documented in this file.

## [2.2.0] - 2026-11-28

### Added
- **Modular 6-Widget Draggable In-Game HUD (`HudOverlayCanvas`)**: Split the single Compact HUD plate into 6 independent, toggleable, and freely movable transparent widgets — **Objective Timers**, **Next Item & Gold**, **CS/min vs Target**, **Skill Order (What to Skill Next)**, **Level-2 Plan / Macro Phase / Power Spikes**, and **Tactical Macro Cues** — each toggleable in **Settings → Overlay & HUD** and repositionable by unlocking and left-click-dragging directly on your monitor while maintaining 100% click-through behavior when locked (`hud_widgets` persisted in SQLite).
- **Riot-Safe In-App Champion Picker & Pre-Queue Planner**: Pick or search any Jungle or ADC champion directly inside **Champ Select** (both in live draft and out of lobby) to preview matchups, synergies, and one-click apply runes/spells to the League Client — without any automated LCU picks, hovers, or queue actions.
- **LP Climb Progression Division Lines & Target Distance**: Plot horizontal rank division boundaries (`Iron IV`–`Master`) and highlight your target division directly inside the LP Climb Progression chart alongside remaining LP distance and estimated net wins.
- **Crash-Resistant `AppErrorBoundary`**: Added top-level React Error Boundaries and dark `#111318` fallback roots for both main and HUD windows so transient errors recover cleanly instead of flashing white screens.

### Changed
- **Unified Draft Card & De-Cluttered Coaching Views**: Combined Ally and Enemy draft rosters into a single 2-column card with clean damage-split percentages, moved **Climb & Goals** first in navigation above **Champ Select**, collapsed secondary breakdowns/forms across views, and removed the Simulator mode and `"Match Focus"` header chip.
- **Post-Game Timeline Paths & ADC Benchmark Summary**: Smoothed Post-Game Replay paths with Bezier curves that break on fountain recalls/teleports (fixing cross-map straight lines), added role-aware replay titles (`Bot Lane Path & Timeline Replay` / `Enemy ADC Ghost`), extended the Win/Loss stripe full height on match cards, and redesigned the ADC Performance Benchmarks summary.
- **Calibrated Bot Lane & Season 2026 Vision Map**: Fixed Macro Phase selector layout on narrow widths, removed the duplicate squeezed Bot Vision panel, calibrated `map11.png` Bot Lane & Jungle brush ward coordinates/timings, and synced numbered Stealth/Control markers with the clickable ward list.

### Fixed
- **Season 2026 Boots Recognition (`Bot Quest` 7th Slot & Tier-3 Upgrades)**: Stopped inspecting only `slot < 6` (`itemDetection.ts`), recognizing bought boots across all non-trinket slots (`slot !== 6`), defensive boots (`Plated Steelcaps`, `Mercury's Treads`), and Season 2026 Feats of Strength Tier-3 upgrades (`3170`–`3176`).
- **UI & Shell Polish**: Removed navigation rail spring overshoot (`240ms cubic-bezier(0.2, 0, 0, 1)`), aligned collapsed Client/Match indicator dots horizontally, made sticky subpage top bars flush with isolated map pins (`isolate z-0`), fixed Settings divider spacing around callout cards, removed stale `"No Atakhan"` badges, and displayed the full Riot Games legal disclaimer at all times.

## [2.1.0] - 2026-11-27

### Added
- **ADC (`BOTTOM`) Secondary Role Parity**:
  - **Champ Select**: 22-ADC Patch `16.23.1` knowledge pack (`adcKnowledgePack.ts`), `Jungle | ADC` switcher (`Auto-detected` via LCU/spells or manual), Support Synergy evaluation, `Likely` 2v2 bot-lane matchup insights, and 1-click LCU rune/spell apply (`Heal`/`Barrier`/`Cleanse` + `Flash`).
  - **Win Plan & Map**: 2v2 matchup verdict, Support Synergy playbook, Season 2026 `0:30` Level-2 wave plan (`Push for Lv2 All-In` vs `Concede & Trim`), `2:15–2:55` enemy jungler gank threat window, `14:00` plate deadline, `5:00` first Dragon priority, Bot-to-Mid swap trigger, and Bot lane ward targets on Summoner's Rift.
  - **Live Coach & Role-Aware Compact HUD**: Adaptive ADC builds (reactive Grievous Wounds/armor pen/QSS/Lifeline pivots without Jungle/bruiser items like Chempunk), B.F. Sword `1300g` recall spikes, CS/min pacing, plate/Mid-swap cues, and Farsight Alteration reminders.
  - **Climb & Goals + SQLite v6 Isolation (`PRAGMA user_version = 6`)**: Provisional ADC benchmarks (`IRON`–`MASTER`) embedded in signed patch packs (`roleBenchmarks.bottom`), 5 ADC mistake detectors (`adc_cs_deficit_10`, `adc_lane_death_pre_14`, `adc_low_damage_share`, `adc_pre_obj_death`, `adc_isolated_death`), EWM baselines strictly isolated per role (`JUNGLE` vs `BOTTOM`), and `Roles & Preferences` Settings section.
  - **Post-Game Review (ADC & Debrief)**: Evaluates `CS@10`, `CS/min`, Lane Gold Diff @15 (vs `laneOpponentGold` with enemy jungler fallback badge), Damage Share %, Pre-14 Deaths, Turret Plates, KP%, and grounded ADC AI Coach debriefs.

### Changed
- **Material Design 3 Expressive Desktop UI Redesign**: Unified left navigation rail (`M3NavRail`), `48px` top app bar (`M3TopAppBar`) with aligned `32px` Summoner Profile Pill (`SummonerProfilePill` + profile icon), Expressive cards/chips/segmented controls, and preserved isolated dark glass Compact HUD (`hud.html`).
- **Stacked Master-Detail Post-Game & Settings Navigation**: Replaced match tabs in Post-Game Review with stacked clickable Match Summary Cards (`All | Jungle | ADC` filters) opening dedicated detail subpages (`← All Matches` + `Esc` + Newer/Older), and replaced Settings tabs with stacked grouped Category Cards opening dedicated subpages (`← Back to Settings` + `Esc` + deep-linking).

### Fixed
- **Season 2026 Patch `16.23.1` Timers & Atakhan Removal**: Removed Atakhan (`#[serde(default)]` kept for legacy packs), aligned buff spawn (`0:55`), Scuttle (`2:55`), Voidgrubs (`8:00–14:45`), Rift Herald (`15:00–19:45`), Baron (`20:00`), Smite (`600`/`1000`/`1400` at `20`/`35` stacks), and post-game/learning spawn windows (`[175, 300, 480, 900, 1200]`).
- **Off-Role Live Suppression (`TOP` / `MIDDLE` / `UTILITY`)**: Suppresses role-specific items, Smite, and lane/jungle cues during Top/Mid/Support games (`OFF-ROLE · GLOBALS`), keeping global objective timers and ungraded post-game scoreboard/VOD views.
- **Draggable Compact HUD & League HUD Guidance**: Added HUD Unlock/Lock drag positioning (`set_hud_locked`, persisted coordinates, `Reset HUD Position`, tray toggle) and a Recommended In-Game League HUD Settings guide.
- **Windows Taskbar Application Icon**: Regenerated multi-size `icon.ico` and applied it via `build.rs` and `main_win.set_icon(...)`.

## [2.0.0] - 2026-11-27

### Added
- **Signed Ed25519 Patch Packs & Zero-Rebuild Hot-Swap (`knowledge/<patch>.json`, `meta-<patch>.json`)**: Verifies embedded and hot-swapped objective timings, Smite thresholds, and champion meta overrides via strict `Ed25519` (`verify_strict` in `patch_pack.rs`) with automatic fallback to verified embedded defaults when an external pack is tampered or malformed.
- **Capped Personalized Live Objective Guardrails**: Appends at most 2 real-time macro guardrails strictly from public Live Client scoreboard telemetry + Confirmed personal EWM weaknesses, protected by compile-time `never` type guards banning enemy cooldowns or fog-of-war fields.
- **Numeric-Fact-Validated AI Narrator (`ai_coach.rs` & `aiFactValidator.ts`)**: Cross-checks generated post-game debriefs and Win-Con briefs against unit-scoped telemetry JSON metrics and timestamps (`gold`, `%`, `m`/`min`, `s`, `MM:SS`/`HH:MM:SS`), rejecting invented figures on the backend and marking checked summaries in the UI.
- **AI Coach `HTTP 429`/`402` Diagnostics, Curated Model Presets & Response Cache**: Parses Google Gemini, OpenAI, and Ollama error bodies (`limit: 0` free-tier exclusion vs `402` prepayment balance gate vs transient RPM limits) with bounded transient retries, curated model presets with Free/Paid tier badges (`gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-4-hydrogen`, `gemini-4-neon`, `gpt-6-luna`), an in-app `"Test Connection"` probe, and persistent `(matchId/planKey, provider, model)` response caching to avoid burning duplicate API quota.

## [1.4.0] - 2026-11-27

### Added
- **Deterministic Jungle Mistake Detectors & SQLite v5 Persistence (`PRAGMA user_version = 5`)**: Evaluates 5 deterministic jungle-only mistake detectors (`pre_obj_death`, `early_death_before_10`, `midgame_farm_drop`, `blind_river_vision`, `early_gold_deficit_15`) in both Rust SQLite fact tables (`mistake_hits`, `baselines`, `get_personal_learning_snapshot`) and TypeScript (`personalLearningEngine.ts`).
- **Exponentially Weighted Personal Baselines & KPI Quartile Bands**: Computes half-life-8 EWMA KPI baselines shrunk smoothly toward target division priors (`CS/min`, `GD @15`, `Obj Share`, `Pre-Obj Deaths`, `Vision/min`, `KP%`) along with P25–P75 range bands inside Climb & Goals and Post-Game comparisons.
- **Statistical Surfacing Gate & Auto-Proposed Match Focus**: Enforces Binomial Wilson 95% lower-bound + minimum-hit gating (`Confirmed Leak` vs `Emerging Pattern` vs `Monitoring`, verified at `<5%` false positives and `>=80%` planted-leak recall across 1,000 Monte Carlo seeds) and proposes one-click Match Focus goals.
- **Multi-Session Stamina & Requeue Tilt Analytics**: Clusters matches into discrete sessions separated by 2h inactivity gaps to measure Games 1–2 vs Game 3+ stamina and immediate post-loss requeue win rates.

## [1.3.0] - 2026-11-27

### Added
- **Settings Subpages & Clean Architecture**: Split Settings into focused subpages (`Account & API`, `Overlay & HUD`, `Recording & Replays`, `AI Coach`, `Updates & About`) while preserving unsaved draft edits across tab switches and direct deep-linking from Update & Recording CTAs.
- **Post-Game Review Per-Game Subpages**: Organized each selected match into dedicated `Overview`, `Map & Timeline`, `Video & Replay`, and `AI Debrief` sub-tabs, keeping synchronized seconds cursors across tabs and jumping directly to `Map & Timeline` from any `Jump @ mm:ss` marker.
- **Collapsible Navigation Rail & Solid-Background Jungle Crest Icon**: Added a collapsible left navigation rail (`204px` expanded / `68px` collapsed, toggled via button or `Ctrl+B` and persisted locally) alongside a bold solid-background Jungle Crest app icon, Windows ICO, web favicon, and `<BrandMark />`.

### Changed
- **Champion Display Name Normalization**: Added `formatChampionName()` backed by hydrated Data Dragon catalogs and internal Riot ID overrides so internal keys like `MonkeyKing`, `Khazix`, `FiddleSticks`, and `Belveth` render consistently as `Wukong`, `Kha'Zix`, `Fiddlesticks`, and `Bel'Veth` across Champ Select, Win Plan, Climb, and Post-Game Review.
- **Jungle-Only Role Evaluation (`PRAGMA user_version = 4`)**: Persists normalized participant roles (`JUNGLE`, `TOP`, `MIDDLE`, `BOTTOM`, `UTILITY`) in Match-V5 normalization and SQLite `matches_fact.role`. Off-role matches show clear off-role badges and basic scoreboard stats without lane-CS/jungle grading and are excluded from Climb benchmarks, rolling goals, and SQLite jungle baselines/mistake hits.
- **Broadcast-Inspired Compact HUD Refactor**: Redesigned the transparent floating HUD into sharp rectangular broadcast plates (`#0A0C12`, `3px` corners) with dual objective countdown tiles (`SCT`/`DRG`/`GRB`/`BRN`/`HLD`), geometric objective crest badges, bottom urgency bars, and left-accented tactical callout strips.

## [1.2.0] - 2026-11-27

### Added
- **Opt-In GPU Gameplay Recording (Windows Graphics Capture + Media Foundation H.264)**: Disabled by default (`enabled: false`), checks hardware H.264 MFT availability (`NVENC` / `AMD AMF` / `Intel QuickSync`) before encoding via OS Media Foundation H.264, captures strictly the `League of Legends (TM) Client` HWND (ignoring replays and spectator sessions), excludes Alt-Tab windows and overlays, locks lazily to native even frame dimensions, persists monotonic clock sync offsets (`PRAGMA user_version = 3`), and enforces disk quota pruning with pinned exemptions plus startup crash recovery.
- **Synchronized Post-Game Video Player & `-12s/+6s` Clip Bookmarks**: Plays match MP4 recordings over a scoped Tauri asset protocol (`$APPDATA/recordings/**`), bi-directionally synchronized with the seconds-granular timeline cursor, RiftMap, Gold/XP diff chart, clickable Mistake/Highlight `"Jump @ mm:ss"` buttons, and persistent `-12s/+6s` clip bookmarks.
- **Riot Replay `.rofl` Discovery & Local Replay API Deep-Links**: Discovers `<REGION>-<GAMEID>.rofl` files automatically, adds an explicit opt-in Settings toggle to enable `EnableReplayApi=1` in `Config\game.cfg` with a preserved `.cfg.bak` backup, and adds one-click `"Open / Seek LoL Replay @ mm:ss"` fallback controls against `127.0.0.1:2999/replay/playback`.

## [1.1.1] - 2026-11-27

### Fixed
- **Personal Riot API Key Sanitization & Honest `401`/`403` Diagnostics**: Strips invisible whitespace/BOM/zero-width characters on key save and load, distinguishes `401` vs `403` without misleadingly labeling non-expiring Personal API keys as 24-hour keys, surfaces Riot's sanitized status message, falls back to `Account-V1` verification when a `Riot ID` is configured, and shows verification results cleanly in Settings.
- **Match-V5 PUUID Resolution (`HTTP 400 Bad Request` Fix)**: Automatically resolves the API-key-encrypted PUUID from `Account-V1` whenever `Sync Recent Games` receives an unencrypted 36-character LCU UUID or an `HTTP 400` encrypted-PUUID mismatch, and prints Riot's detailed HTTP error status message on non-2xx responses.

## [1.1.0] - 2026-11-27

### Added
- **Truthful Session Gating & Climb Home Page**: Centralized view readiness in `deriveSessionContext()`, promoted **Climb & Goals** to the default Home tab, and replaced idle/unconfigured synthetic fallbacks across Champ Select, Win Plan & Map, Live Coach, Post-Game Review, and Climb & Goals with calm `<EmptyState>` views and an explicit Simulator preview opt-in.
- **Modular Transparent Compact HUD (`424×184`)**: Redesigned Compact HUD into independent frosted micro-cards (Status Pill, Pre-1:30 Route Card, 2-Column Objective Countdown + Next Buy cards, and conditional Tactical Cue card) over a transparent click-through canvas with a `70%` opacity legibility floor (`80%` default).
- **Single-Row Clear Sequence & Dynamic Pathing**: Refined `jungleRoutingEngine` (`pickFirstClear`) to select strictly one optimal Clear 1 (`full_clear` or `three_camp_gank`), adapt Clear 2 accordingly, and render a single-line 4-column segmented bar (`Clear 1`–`Clear 4`) with an animated active thumb.
- **SQLite `PRAGMA user_version` Fact Tables & Transactional Focus Goal**: Added schema version migrations (`v2`), idempotent backfill into `matches_fact`, `match_metrics`, `match_events`, `mistake_hits`, and `baselines`, atomic `set_focus_goal` command, `wins + losses` LP settlement deduplication, League install auto-detection, and seconds-granular Post-Game timeline scrubbing.
- **WGC Recording & Riot Replay API Spike**: Documented Windows Graphics Capture + Media Foundation hardware H.264 architecture and `.rofl` / Replay API (`127.0.0.1:2999/replay/*`) deep-linking in `docs/RECORDER_AND_REPLAY_SPIKE.md`.

### Changed
- **UI Sophistication & Craft Overhaul**: Adopted a 4-step typography scale, concentric window/card/control radii (`12px`/`10px`/`7px`), flat hairline card plates, a `40px` header strip with persistent simulation banner, and a single priority notification slot.
- **Statistical & Timeline Honesty**: Applied Beta-Binomial shrinkage to Champ Select win-rate weighting (`scoreChampion()`), enforced `n >= 10` rolling sample depth before locking Climb Goal completions, eliminated extrapolated `CS @4` guesses, and hardened `.github/workflows/release.yml` signing secret scoping.

## [1.0.0] - 2026-11-27

### Added
- **Install-on-Quit Auto-Updater & Safe Quit Persistence**: Added `Manual` vs `Download & Install on Quit` update mode with `stage_update`, verified background staging, safe tray-quit installation (only when not in Champ Select, Loading, or In-Game), and shared main window geometry persistence on both window close and tray quit.
- **Optional Windows Authenticode Signing & Winget Distribution**: Extended `.github/workflows/release.yml` with optional CI PFX code signing (`WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`) and guaranteed temporary-file cleanup, plus Winget 1.6 manifests (`packaging/winget/`) and `scripts/update-winget-manifest.mjs`.
- **Zero-Trust Cloudflare Worker Riot API Proxy & HTTPS Proxy Mode**: Added a deployable `proxy/` Worker relay enforcing `X-App-Client: betterjungler`, `GET`-only routing, strict Riot host & path-prefix allowlists, traversal blocking, bounded per-IP rate limiting, and optional `Riot API Proxy URL (HTTPS)` client support in Settings.

## [0.4.0] - 2026-11-27

### Added
- **Automated Post-Game Sync & LP Tracking**: Automatically fetches your latest Match-V5 game and updates LP direction using actual win/loss data when transitioning into End of Game, with a **"Last Game Takeaway"** summary banner.
- **1-Per-Game Match Focus Goal**: Pin one active KPI as your **Match Focus**, surfacing it during Champ Select and Win Plan and grading `PASS` / `MISS` automatically in Post-Game Review.
- **1-Second Match Clock Interpolation**: Smoothly advances the Live Coach and HUD clock every second between 1.8s Live Client polls and pauses automatically on game stalls.
- **Personal Win-Rate Draft Weighting & Early Tempo KPIs**: Factors your rolling personal jungle win rate (`>= 3` games) into Champ Select scores, auto-follows your hovered/locked pick with off-role notices, adds `CS @5` and `CS @10` benchmarks, and shows a calm 3-loss Session Stop-Loss indicator.

## [0.3.0] - 2026-11-27

### Added
- **Dedicated Two-Window HUD & Windows 11 Mica**: Split the click-through tactical HUD into an independent lightweight `hud.html` window while upgrading the main desktop companion to Windows 11 Mica (`alwaysOnTop: false`), with separate Vite chunks under `500 kB`.
- **HUD Scale, Minimap Side & Monitor Selection**: Added `100% / 125% / 150%` HUD scale presets, Left/Right LoL minimap side docking, Primary/Active monitor placement, persisted window geometry, and immediate opacity/ergonomics saving.
- **First-Run Setup Checklist**: Added a dismissible idle onboarding checklist verifying Riot API key health, Borderless/Windowed video mode guidance, and HUD hotkey testing.

### Changed
- **HUD Legibility Overhaul**: Raised compact HUD minimum typography to `12px`, promoted the Next Objective countdown to the primary visual anchor, and expanded macro cues to clean 2-line wrapping.
- **Main Chrome & Atomic Hotkey Rebind**: Made the full main top strip draggable and made global shortcut rebinding atomic so the previous hotkey stays active if a new binding fails.

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
