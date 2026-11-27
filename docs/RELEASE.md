# BetterJungler Windows Release & Auto-Update Guide

This guide documents how **BetterJungler** is packaged, signed for Tauri v2 automatic updates, installed for the first time on Windows, and released via `.github/workflows/release.yml`.

## 1. Pre-Release & Version Synchronization Gates

BetterJungler uses `package.json`, `src-tauri/Cargo.toml`, and `CHANGELOG.md` together cleanly:
- `src-tauri/tauri.conf.json` omits `"version"` so Tauri v2 inherits it automatically from `src-tauri/Cargo.toml`.
- Bump versions atomically using:
  ```powershell
  node scripts/bump-version.mjs 0.2.0
  ```
- Verify full synchronization (`package.json` === `src-tauri/Cargo.toml` === `CHANGELOG.md` `## [X.Y.Z]` heading, plus git tag match on CI):
  ```powershell
  node scripts/check-version.mjs
  npm run typecheck
  npm run lint
  npm run test
  npm run build
  ```
- In CI (`.github/workflows/ci.yml` and `.github/workflows/release.yml`), Rust executes `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` inside `src-tauri` (with `--locked` automatically enforced when `src-tauri/Cargo.lock` is present).
- **Lockfile check before public tag**: On a machine with Rust installed, generate and commit `src-tauri/Cargo.lock` (`cargo generate-lockfile --manifest-path src-tauri/Cargo.toml`) prior to tagging `v0.2.0` so signed releases resolve identical dependency versions.

## 2. Automated Tag Release & Updater Pipeline (`.github/workflows/release.yml`)

Pushing a version tag matching `v*.*.*` (for example `v0.2.0`) triggers `.github/workflows/release.yml` on `windows-latest`:

1. Verifies `node scripts/check-version.mjs` (refuses mismatched tags, manifests, or missing `CHANGELOG.md` entries).
2. Runs frontend verification (`typecheck`, `lint`, `test`, `build`) and Rust verification (`cargo fmt`, `cargo clippy`, `cargo test`).
3. Extracts that release's `## [X.Y.Z]` notes from `CHANGELOG.md` into `RELEASE_BODY`.
4. Runs `tauri-apps/tauri-action@v0` with `uploadUpdaterJson: true` (`updaterJsonPreferNsis: true`) and `TAURI_SIGNING_PRIVATE_KEY` to build and upload:
   - Per-user Windows NSIS installer (`*-setup.exe`) + updater signature (`*-setup.exe.sig`)
   - Signed `latest.json` updater manifest containing the version, signature, download URL, and release notes.
5. Creates a **draft** GitHub Release as a staging gate. Publishing the draft makes `https://github.com/malikjannico/betterjungler/releases/latest/download/latest.json` live to installed apps.

### Required GitHub Repository Secrets

Set these in **Repository → Settings → Secrets and variables → Actions** before tagging a release:
- `TAURI_SIGNING_PRIVATE_KEY`: Contents of your Ed25519 private key generated via `npx tauri signer generate` (keep an encrypted offline backup!).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password if your key is encrypted (optional otherwise).

## 3. First-Time Windows Installation & Automatic Updates

### First-Time User Install
1. Download `BetterJungler_x.y.z_x64-setup.exe` from the published GitHub Release (verify its SHA256 if published alongside the release).
2. For unsigned personal builds before Authenticode code signing is added, Windows SmartScreen may show **"Windows protected your PC"** → click **"More info" → "Run anyway"**.
3. Per-user NSIS installs into AppData with **no UAC admin prompt**.
4. Set League of Legends in-game Video mode to **Borderless** or **Windowed** for overlay visibility.

### Subsequent Automatic Updates
- Once installed, BetterJungler checks `latest.json` silently 30 seconds after launch and every 6 hours while idle.
- Updates **never auto-install or interrupt gameplay**: an update pill appears in the expanded sidebar only when idle, and Rust's safety gate rejects installation if League is in Champ Select, Loading, or In-Game (`gameflowPhase` check + 3-miss Live Client debounce).
- Choose between **Manual** (`Install & Restart`) and **Download & Install on Quit** (`stage_update` downloads & verifies the installer in the background and applies it safely only when quitting from a safe non-match state).
- Clicking **Install & Restart** verifies the Ed25519 signature against `plugins.updater.pubkey`, runs passive NSIS installation, and relaunches directly into the new version (with a one-time dismissible **What's New** banner).

## 4. Optional Windows Authenticode Code Signing

When distributing publicly to eliminate first-install SmartScreen prompts:
- Store `WINDOWS_CERTIFICATE` (base64 `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD` in GitHub Secrets. `.github/workflows/release.yml` decodes the `.pfx` into `$env:RUNNER_TEMP`, writes a temporary `authenticode.json` configuring `bundle.windows.signCommand` via `signtool.exe` (SHA-256 + DigiCert timestamp), passes `--config` into `tauri-apps/tauri-action@v0`, and deletes the temporary `.pfx` and `.json` in an `if: always()` cleanup step.
- Never commit `.pfx`, `.key`, or private credentials into the repository.

## 5. Winget Package Distribution (`packaging/winget/`)

Winget 1.6 manifests live under `packaging/winget/` (`BetterJungler.BetterJungler.yaml`, `.installer.yaml`, `.locale.en-US.yaml`). After publishing a release asset on GitHub, run:
```powershell
node scripts/update-winget-manifest.mjs --version 1.0.0 --sha256 <64-char-hex-sha256>
```
Then submit the updated `packaging/winget/` manifests to `microsoft/winget-pkgs`.

## 6. Optional Zero-Trust Riot API Proxy (`proxy/`)

For public distributions using a Riot Production API Key, deploy the Cloudflare Worker in `proxy/` (`wrangler secret put RIOT_API_KEY && npx wrangler deploy`) and set the deployed `https://...` URL in **Settings → Riot API Proxy URL (HTTPS)**. See [proxy/README.md](../proxy/README.md) for security boundaries.
