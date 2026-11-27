# Architecture & Implementation Notes: Opt-In GPU Gameplay Recording (WGC) & Riot Replay Deep-Links (`.rofl`)

**Status:** **Implemented in M12 (`v1.2.0`) — Active in `v2.2.0`** (Primary: WGC + Media Foundation GPU Hardware H.264; Zero-Overhead Fallback: Riot `.rofl` Replay API deep-links).  
**Last Updated:** 2026-11-28 (`BetterJungler v2.2.0`)

---

## 1. Decision Summary

| Dimension | Primary Path (M12): Windows Graphics Capture + Media Foundation | Zero-Cost Fallback Path: Riot `.rofl` + Replay API |
|---|---|---|
| **Capture Scope** | Strictly the `League of Legends` game `HWND` (`LeagueClient.exe` excluded). Alt-tabbed windows and BetterJungler's own HUD are never recorded. | Official League game replay launched directly inside Riot's Replay Client. |
| **Runtime Overhead** | Hardware-only GPU encoding (`NVENC` / `AMD AMF` / `Intel QuickSync` NV12 -> `720p30` / configurable presets). Blocked cleanly if only CPU software encoding exists. | `0%` live gameplay capture overhead during the match. |
| **Post-Game Experience** | Instant inline video playback inside `PostGameReviewView` synchronized (`<= 1.5s`) to the seconds-granular timeline cursor. | One-click timestamp jump inside the official League Replay Client (`POST https://127.0.0.1:2999/replay/playback`). |
| **Limitations** | Requires `Borderless` or `Windowed` League display mode for optimal WGC + overlay visibility; clips consume disk quota (configurable `1–50 GB` in Settings). | `.rofl` files expire every major LoL patch; requires `EnableReplayApi=1` in `game.cfg` (explicit user opt-in); opens external Replay window rather than embedded `<video>`. |
| **Vanguard / ToS Safety** | 100% OS-level Graphics Capture API (`Windows.Graphics.Capture`); zero DLL injection, zero `DXGI` hooking, zero memory reading. | 100% official Riot Games Replay API (`127.0.0.1:2999`). |

---

## 2. Shipped Implementation Map (`v1.2.0` → `v2.2.0`)

- **GPU Capture & Quota Pruning**: [`src-tauri/src/recorder.rs`](../src-tauri/src/recorder.rs) probes hardware H.264 MFT availability (`MFTEnumEx`), binds strictly to the `League of Legends (TM) Client` HWND (ignoring spectator/replay sessions), encodes fragmented MP4s, reconciles crash-recovered partials, and enforces disk cap eviction with pinned-clip exemptions.
- **Sync Points & Scoped Asset Streaming**: [`src-tauri/src/storage.rs`](../src-tauri/src/storage.rs) persists `(matchClockSec, monotonicVideoElapsedMs)` inside `recording_sync_points`, while [`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json) restricts Tauri `asset:` protocol access strictly to `$APPDATA/recordings/**`.
- **Riot `.rofl` & Replay API Fallback**: [`src-tauri/src/replay_api.rs`](../src-tauri/src/replay_api.rs) discovers local `.rofl` files safely, previews/applies `EnableReplayApi=1` to `Config\game.cfg` with a `.cfg.bak` backup strictly on user click, and sends `POST https://127.0.0.1:2999/replay/playback` seek commands using Riot's pinned local cert (`riotgames.pem`).
- **UI & Settings**: Controlled via **Settings → Recording & Replays** ([`src/components/settings/RecordingSettingsSection.tsx`](../src/components/settings/RecordingSettingsSection.tsx)) and synchronized inside Post-Game Review via [`src/components/RecordingPlayerCard.tsx`](../src/components/RecordingPlayerCard.tsx).

---

## 3. Pipeline Architecture Details

```text
League of Legends HWND (Borderless / Windowed)
  ──► Windows::Graphics::Capture (IDirect3D11CaptureFramePool, 30fps pace gate)
  ──► D3D11 VideoProcessor (GPU scale + BGRA -> NV12)
  ──► Windows Media Foundation SinkWriter (Hardware H.264 MFT: NVENC / AMF / QuickSync)
  ──► Fragmented MP4 (moof/mdat atoms every 2s GOP) -> <appData>/recordings/<matchId>.mp4
```

### Key Safeguards
1. **Hardware Encoder Probe**: Refuses CPU software fallback if no hardware MFT is found, prompting users to use the Riot Replay API fallback instead.
2. **Monotonic Timestamp Synchronization (`src/domain/recordingSync.ts`)**: Median `(videoOffset - gameTime)` eliminates loading-screen transition drift so `Jump @ mm:ss` markers on Post-Game mistakes seek accurately into both MP4 playback and `.rofl` replays.
3. **Explicit `game.cfg` Opt-In**: `EnableReplayApi=1` is never toggled silently; users inspect and confirm the diff inside Settings.
