# ADR 0004: Two-Window Material Design 3 Expressive App & Parallel Role-Isolated Coaching Core

## Status
Accepted (Implemented in `v2.1.0`)

## Context
While the desktop companion window benefits from generous Material Design 3 Expressive cards, stacked master-detail lists, and `Roboto Flex` typography, the in-game Compact HUD overlay renders directly over Summoner's Rift and must stay compact, high-contrast, dark-tinted, and completely shielded from desktop shell style bloat. Furthermore, expanding coaching to **ADC (`BOTTOM`)** must not introduce regressions into the established **Jungle (`jungle`)** engines.

## Decision
1. **Two-Window CSS & Entrypoint Isolation**: Separate `index.html` (`src/main.tsx` + `src/styles/m3-expressive.css` + `@fontsource-variable/roboto-flex`) from `hud.html` (`src/hudMain.tsx` + `src/styles/globals.css` + `@fontsource-variable/inter`). Verify post-build CSS bundles in CI/local checks so M3 Expressive rules and fonts stay out of `hud.html`.
2. **Stacked Master-Detail Core Navigation**: Replace nested tab strips in `PostGameReviewView` and `SettingsView` with accessible stacked lists opening dedicated subpages (`← All Matches` / `← Back to Settings` + `Esc`).
3. **Parallel ADC Domain Modules (`src/domain/adc/`, `src/data/adcKnowledgePack.ts`)**: Keep Jungle draft, win plan, live coach, benchmarks, and post-game engines untouched and read-only. Implement parallel ADC engines (`adcDraftEngine`, `adcGamePlanEngine`, `adcLiveEngine`, `adcBenchmarks`, `adcDetectors`, `adcPostGameEngine`) coordinated purely by `sessionContext.ts` and `HudApp.tsx`, while suppressing all role-specific builds/routes on off-roles (`TOP`, `MIDDLE`, `UTILITY`).

## Consequences
- **Pros**: Zero visual regression in the in-game Compact HUD, accessible WCAG-compliant core desktop navigation, zero Jungle scoring regressions, and clean compile-time separation between Jungle, ADC, and Off-Role paths.
- **Cons / Mitigations**: Both `champSelectEngine` and `adcDraftEngine` maintain dedicated champion catalogs pinned to the active patch (`16.23.1`), mitigated by Data Dragon verification scripts and exhaustive Vitest coverage across both roles.
