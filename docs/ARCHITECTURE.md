# System Architecture — BetterJungler

## 1. High-Level Architecture

```mermaid
flowchart LR
    subgraph LoL["Local League of Legends Processes"]
        LCU["League Client (LCU HTTPS 127.0.0.1:lockfile)"]
        LIVE["Live Client Data API (HTTPS 127.0.0.1:2999)"]
    end

    subgraph RiotCloud["Official Riot Cloud APIs"]
        DDragon["Data Dragon CDN"]
        RiotWeb["Riot Web API (Account-V1, Summoner-V4, Mastery-V4, League-V4)"]
    end

    subgraph Tauri["Tauri v2 Rust Backend"]
        State["Game State Machine (Idle -> ChampSelect -> Loading -> InGame -> PostGame)"]
        LCUMod["lcu.rs (Loopback-only + Anonymizer)"]
        LiveMod["live_client.rs (Loopback-only Poller)"]
        RiotMod["riot_api.rs (Rate-Limit Aware Client)"]
        Store["storage.rs (SQLite + Windows Credential Manager)"]
        Overlay["overlay.rs (Alt+J Hotkey + Click-Through + Tray)"]
    end

    subgraph UI["React 19 + TypeScript Frontend"]
        Engines["Deterministic Coaching Engines (ChampSelect / WinCon / LiveCoach)"]
        Views["Dark HUD Overlay (Compact Strip + Expanded Views + SVG Rift Map)"]
    end

    LCU --> LCUMod
    LIVE --> LiveMod
    DDragon --> RiotMod
    RiotWeb --> RiotMod
    LCUMod --> State
    LiveMod --> State
    RiotMod --> Store
    State -->|Tauri Events| UI
    UI -->|Tauri Commands| Tauri
    Overlay --> Views
```

## 2. Game State Machine
1. **Idle**: Neither Champ Select nor Active Game is open. Displays summoner profile, simulation mode, or settings.
2. **ChampSelect**: LCU `lockfile` detected and `/lol-champ-select/v1/session` returns 200. Enforces Ranked Solo/Duo anonymity masking and emits draft updates.
3. **Loading**: Live Client Data API `127.0.0.1:2999` responds with loading/pre-0:00 state or Champ Select locked in transitioning to match.
4. **InGame**: Live Client Data API returns active player and game clock. Emits live snapshot every 1.5s to drive adaptive builds, objective windows, and compliant macro cues.
5. **PostGame**: Active game ended; transitions back to `PostGame` / `Idle` (ready for Milestone 2 Match-V5 timeline fetch).

## 3. Local SQLite Schema (`betterjungler.db`)
- `settings`: Key-value JSON configuration (region, Riot ID, install path, HUD opacity/hotkey, optional BYOK AI coach config).
- `ddragon_cache`: Cached patch version and metadata timestamps.
- `match_details_cache` & `match_summaries`: Cached Match-V5 + Timeline payloads and rolling jungle KPI summaries.
- `climb_goals_v2`: Active and completed division improvement goals (auto-suggested bottlenecks & custom goals).
- `meta_snapshots`: Cached Challenger/GM Match-V5 jungle meta sample snapshots.

## 4. Security Boundaries
- **API Keys**: Stored via `keyring` crate in Windows Credential Manager (`service = "betterjungler"`, `user = "riot_api_key"`). Never logged or returned in plaintext IPC responses.
- **Loopback TLS Guard**: Only the dedicated local client (`lcu.rs`, `live_client.rs`) allows Riot's self-signed localhost certificate, and every request helper asserts `url.host_str() == Some("127.0.0.1")`. External HTTPS requests to `api.riotgames.com` and `ddragon.leagueoflegends.com` always enforce full standard TLS verification.
