# M11 Architecture Spike: Opt-In GPU Gameplay Recording (WGC) & Riot Replay Deep-Links (`.rofl`)

**Status:** Go for M12 (`v1.2.0`) implementation (Primary: WGC + Media Foundation GPU Hardware H.264; Zero-Overhead Fallback: Riot Replay API deep-links).  
**Last Updated:** 2026-11-27 (`BetterJungler v1.1.0`)

---

## 1. Decision Summary

| Dimension | Primary Path (M12): Windows Graphics Capture + Media Foundation | Zero-Cost Fallback Path: Riot `.rofl` + Replay API |
|---|---|---|
| **Capture Scope** | Strictly the `League of Legends` game `HWND` (`LeagueClient.exe` excluded). Alt-tabbed windows and BetterJungler's own HUD are never recorded. | Official League game replay launched directly inside Riot's Replay Client. |
| **Runtime Overhead** | Hardware-only GPU encoding (`NVENC` / `AMD AMF` / `Intel QuickSync` NV12 -> `720p30 @ 3.5 Mbps`). Blocked honestly if only CPU software encoding exists. | `0%` live gameplay capture overhead during the match. |
| **Post-Game Experience** | Instant inline video playback inside `PostGameReviewView` synchronized (`<= 1.5s`) to the seconds-granular timeline cursor. | One-click timestamp jump inside the official League Replay Client (`POST https://127.0.0.1:2999/replay/playback`). |
| **Limitations** | Requires `Borderless` or `Windowed` League display mode for optimal WGC + overlay visibility; clips consume disk quota (default `5 GB`). | `.rofl` files expire every major LoL patch; requires `EnableReplayApi=1` in `game.cfg` (explicit user opt-in); opens external Replay window rather than embedded `<video>`. |
| **Vanguard / ToS Safety** | 100% OS-level Graphics Capture API (`Windows.Graphics.Capture`); zero DLL injection, zero `DXGI` hooking, zero memory reading. | 100% official Riot Games Replay API (`127.0.0.1:2999`). |

---

## 2. Primary Path Details — Windows Graphics Capture & Media Foundation (M12)

### Pipeline
```text
League of Legends HWND (Borderless / Windowed)
  ──► Windows::Graphics::Capture (IDirect3D11CaptureFramePool, 30fps pace gate)
  ──► D3D11 VideoProcessor (GPU scale 720p/1080p + BGRA → NV12)
  ──► Windows Media Foundation SinkWriter (Hardware H.264 MFT: NVENC / AMF / QuickSync)
  ──► Fragmented MP4 (moof/mdat atoms every 2s GOP) → <appData>/recordings/<matchId>.mp4
```

### Pre-Flight Hardware & Display Guards
1. **Hardware Encoder Probe (Mandatory):** Enumerate `MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE, ...)`. If zero hardware H.264 encoders are available on the system, refuse CPU encoding with a clear Settings notice and offer the Riot Replay API fallback instead.
2. **Exclusive Fullscreen & HDR Detection:** Check active swapchain / monitor fullscreen state; if Exclusive Fullscreen or WCG/HDR tone-mapping hazard is detected, surface a single non-blocking tip in Settings / Pre-Game prompting Borderless mode (`game.cfg` `WindowMode=2`).
3. **Crash Safety & Post-Game Pruning:** Fragmented MP4 (`MF_MPEG4SINK_MINIMUM_PROPERTIES` / `2s` keyframe interval) guarantees partial recordings remain playable even on force-quit (`taskkill /F`). Because `preObjectiveDeaths` triggers up to `55s` *after* a mistake occurs, M12 records the full session (`~0.9 GB / 35 min`) and asynchronously prunes `-12s .. +6s` highlight & mistake sub-clips (`~120 MB / match`) after post-game Match-V5 sync completes, enforcing the user-configured storage cap (`5 GB` default; user-pinned clips exempt).
4. **Monotonic Timestamp Synchronization:** Every `1.8s` `LiveClient` poll writes `(matchClockSec, monotonicVideoElapsedMs)` into SQLite (`recording_sync_points`). Taking the median `videoOffset - gameTime` eliminates jitter from loading screen transitions and aligns timeline click jumps within `<= 1.5s`.
5. **FPS Overhead Budget:** Verify `< 3%` average FPS delta on discrete GPUs (`NVENC` / `AMF`) and `< 8%` on integrated GPUs (`QuickSync`) via `PresentMon` across 50 Vanguard-active games before release.

---

## 3. Fallback Spike — Riot `.rofl` Discovery & Local Replay API Deep-Link

For players on integrated GPUs without hardware H.264 headroom, minimal disk budgets, or Exclusive Fullscreen preferences, M12 can jump directly to any mistake or kill timestamp inside the League Replay viewer:

### 3.1 Replay Discovery
- Default directory on Windows: `%USERPROFILE%\Documents\League of Legends\Replays\<REGION>-<NUMERIC_GAME_ID>.rofl` (e.g., `EUW1-71001.rofl`).
- Downloaded replays via LCU (`/lol-replays/v1/rofls/<gameId>/download`) populate this directory directly after End-of-Game.

### 3.2 `game.cfg` Opt-In (`EnableReplayApi=1`)
- The local Riot Replay HTTP server (`https://127.0.0.1:2999/replay/*`) is **disabled by default** by Riot until `[General] EnableReplayApi=1` is present in `<LoL Install>\Config\game.cfg`.
- BetterJungler will **never** silently edit `game.cfg`; instead, Settings offers an explicit **Enable Riot Replay API** toggle that previews the exact `EnableReplayApi=1` line change (using a safe atomic write with `.bak` backup) or instructs how to add it manually.

### 3.3 Deep-Link Playback Control (`127.0.0.1:2999`)
- Reuse the existing Riot root certificate (`src-tauri/certs/riotgames.pem`) already bundled in `loopback_client`.
- **Liveness check:** `GET https://127.0.0.1:2999/replay/playback` -> returns `200 OK` `{ "length": f64, "paused": bool, "seeking": bool, "speed": f64, "time": f64 }` while a `.rofl` replay is open.
- **Seek to timeline cursor / mistake marker (e.g. `max(0, timestampSec - 10)`):**
  ```json
  POST https://127.0.0.1:2999/replay/playback
  { "time": 245.0, "paused": false, "speed": 1.0 }
  ```
- **Limitation Matrix:**
  1. Replay launch opens an external game window rather than playing inside `PostGameReviewView`.
  2. `.rofl` files become unplayable when League updates to a new major patch.
  3. Therefore, WGC remains the **recommended primary recorder** for persistent clip libraries across patches, while Replay API deep-links serve as the **zero-overhead companion fallback**.
