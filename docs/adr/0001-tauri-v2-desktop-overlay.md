# ADR 0001: Tauri v2 Desktop Overlay Architecture

## Status
Accepted

## Context
BetterJungler requires a lightweight Windows desktop app that renders primarily as an always-on-top HUD overlay over borderless windowed League of Legends, polls local HTTPS endpoints (`LCU` and `127.0.0.1:2999`), and persists personal match data and credentials securely.

## Decision
Use **Tauri v2 (Rust + WebView2)** with a **React 19 + TypeScript + Tailwind CSS v4** frontend and **SQLite (`rusqlite`) + Windows Credential Manager (`keyring`)** in the backend.

## Consequences
- **Pros**:
  - Low memory and CPU overhead during live gameplay compared to bundling a separate Chromium runtime.
  - Native Windows `set_ignore_cursor_events` support for click-through HUD mode paired with `tauri-plugin-global-shortcut` (`Alt+J`) and a system tray fallback.
  - Strong security isolation between OS credentials/loopback TLS handling and the UI layer.
- **Cons / Mitigations**:
  - Compiling the native Windows binary requires Rust (`rustup`) and Visual Studio C++ Build Tools (MSVC). Mitigated by validating all frontend logic/UI independently with Vite/Vitest and compiling/testing Rust in GitHub Actions (`windows-latest`).
