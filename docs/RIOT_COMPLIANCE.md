# Riot Developer Policy Compliance Matrix

BetterJungler is designed from the ground up to comply with [Riot Games Developer Policies](https://developer.riotgames.com/docs/lol).

| Policy Requirement | How BetterJungler Enforces It | Verification / Code Location |
|---|---|---|
| **No Memory Reading / Process Injection (Vanguard Safe)** | Zero memory reading, DLL injection, or packet sniffing. Uses only Riot Web API, Data Dragon, LCU HTTPS REST API, and Live Client Data API (`127.0.0.1:2999`). | `src-tauri/src/lcu.rs`, `src-tauri/src/live_client.rs`, `src-tauri/src/riot_api.rs` |
| **Ranked Solo/Duo Champ Select Anonymity** | Non-local/non-party player identities in Champ Select are masked to `Ally 1..5` and `Enemy 1..5` in both Rust and TypeScript. | `lcu.rs::sanitize_champ_select`, `src/domain/champSelectEngine.ts::sanitizeChampSelectSession` |
| **No Automated Gameplay / Queue / Draft Actions** | BetterJungler NEVER auto-accepts queues, auto-bans, or auto-picks champions. Rune & spell import runs ONLY on explicit user button click. | `lcu.rs::apply_runes_and_spells`, `ChampSelectView.tsx` |
| **No Enemy Ultimate Cooldown Trackers** | Does not track, estimate, or display enemy ultimate or off-screen summoner spell cooldowns. | `src/domain/liveCoachEngine.ts` |
| **No Hidden Information / Fog-of-War Bypass** | Live coaching relies solely on official visible state (game clock, visible items, KDA, public kill/objective events). Path/ward planning happens pre-game via strategic principles. | `src/domain/winConditionEngine.ts`, `src/domain/liveCoachEngine.ts` |
| **Distinct Overlay UI & Ad-Free** | Uses an original Obsidian/Slate tactical HUD aesthetic distinct from Riot's Hextech UI, with zero ads. | `src/styles/globals.css`, `src/components/CompactHudBar.tsx` |
| **Mandatory Riot Legal Disclaimer** | Displayed persistently in the app footer, Settings view, and `README.md`. | `src/App.tsx`, `src/components/SettingsView.tsx`, `README.md` |
| **API Key Protection & Rate Limiting** | Riot API key stored in Windows Credential Manager (`keyring`), never committed or logged; Riot API client respects `Retry-After` and rate-limit headers. | `src-tauri/src/storage.rs`, `src-tauri/src/riot_api.rs` |
