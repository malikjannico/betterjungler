# Product Requirements Document (PRD) — BetterJungler (`v2.2.0`)

## 1. Vision & Goal
Help solo-queue League of Legends players climb **division by division** in **Jungle (Primary)** and **ADC / Bot Lane (Secondary)** by translating complex draft, lane/clear macro, vision, itemization, gameplay replay, and personal KPI bottlenecks into clear, Riot-Developer-Policy-compliant coaching across every match phase.

## 2. Target User & Deployment Model
- **Primary User**: Windows 10/11 desktop League of Legends player running in **Borderless** or **Windowed** display mode.
- **Deployment**: Local-first signed Tauri v2 desktop executable integrating with local LoL endpoints (`LCU` + `Live Client / Replay API`) and optional Riot Web API credentials (Windows Credential Manager) or zero-trust Cloudflare Worker proxy.

## 3. Role Scope & Isolation Rules
- **Jungle (`jungle`)**: Full draft advisor, 4-clear Summoner's Rift routing & enemy jungler opening playbook, live Smite progression & adaptive jungle builds, Jungle post-game review & EWM benchmarks, and 5 Jungle mistake detectors.
- **ADC / Bot Lane (`bottom`)**: 22-ADC catalog (`16.23.1`), Support Synergy & `Likely` 2v2 bot matchup analysis, `0:30` Level-2 wave plan, `2:15–2:55` jungler threat window, `14:00` plates & Bot → Mid swap plan, adaptive ADC builds (excluding jungle pets & non-ADC bruiser items like Chempunk), 7 provisional division benchmarks (`IRON`–`MASTER`), and 5 ADC mistake detectors isolated strictly from Jungle history.
- **Off-Role (`top`, `middle`, `utility`)**: Live HUD & Live Coach display **Global Objectives Only (`OFF-ROLE · GLOBALS`)** with role-specific builds/routes suppressed; Post-Game renders ungraded scoreboard stats + optional video replay only and excludes the game from both Jungle and ADC baselines.

## 4. Delivered Milestones Summary (`v1.0.0` – `v2.2.0`)

| Milestone Phase | Key Delivered Capabilities |
|---|---|
| **M1–M6 (`v1.0.0`)** | Initial Champ Select advisor, Win Plan & RiftMap, Compact Dark HUD (`Alt+J`), Post-Game Review, and Climb Tracker. |
| **M7–M11 (`v1.1.0`–`v1.1.1`)** | Truthful `<EmptyState>` session gating, modular compact HUD, 4-clear dynamic pathing, SQLite fact tables, API key sanitization & `Account-V1` PUUID resolution, plus WGC/Replay architecture spike. |
| **M12–M14 (`v1.2.0`–`v2.0.0`)** | Opt-in WGC + Media Foundation GPU H.264 recording, synchronized video/clip player, `.rofl` Replay API seek, per-game/settings subpages, `formatChampionName`, Jungle-only filtering, deterministic EWM baselines & 95% Wilson surfacing gates, Ed25519 signed patch packs, numeric fact validator, `429`/`402` diagnostics, curated presets & response caching. |
| **M15–M17 (`v2.1.0`)** | Season 2026 Patch `16.23.1` timer alignment (`0:55` buffs, `2:55` Scuttle, `8:00` Voidgrubs, `15:00` Herald, `20:00` Baron, Atakhan removed), off-role HUD suppression, draggable HUD + Windows taskbar `icon.ico`, full Material Design 3 Expressive core-app redesign with stacked master-detail Post-Game & Settings navigation and isolated glass HUD, plus full ADC secondary role parity. |
| **M18–M20 (`v2.2.0`)** | White-screen React `ErrorBoundary`, Season 2026 7th-slot & Tier-3 boots recognition, Riot-safe in-app champion picker & unified 2-column Draft card, calibrated Bot Lane & Season 2026 Jungle vision map, smooth recall-aware Post-Game replay paths, LP Climb division boundary lines, and a modular 6-widget freely draggable HUD canvas (`Objectives`, `Next Item`, `CS/min vs Target`, `Skill Order`, `Lv2/Phases/Spikes`, `Macro Cue`). |

## 5. Non-Functional Requirements
- **Overlay Isolation & Performance**: `hud.html` bundles strictly dark glass utility CSS (`Inter` font, zero M3/Roboto Flex bloat) with event-driven updates and click-through mouse transparency when locked.
- **Security & Privacy**: API keys stored exclusively in Windows Credential Manager; loopback TLS pinning limited to `127.0.0.1`; `$APPDATA/recordings/**` CSP boundary; zero memory reading or process injection.
- **Statistical & AI Honesty**: Minimum sample thresholds (`n >= 10` for goal completion, Wilson 95% gate for confirmed mistakes), zero fabricated metrics from empty states, and strict numeric/role validation on all optional BYOK AI coach summaries.
- **Compliance**: Full adherence to Riot Games Developer Policy (see [`RIOT_COMPLIANCE.md`](RIOT_COMPLIANCE.md)).

## 6. Known Limitations & Next Opportunities
- **Live ADC Isolated-Death Enrichment**: `adc_isolated_death` currently evaluates on ally-enriched timeline fixtures; live ranked Match-V5 normalization in `riot_api.rs` does not yet populate per-minute `allyPositions` frames.
- **Future Role Expansion**: Top, Middle, and Support remain intentionally off-role in `v2.2.0` (shown as coming later in **Settings → Roles & Preferences**).
