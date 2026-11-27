# BetterJungler Windows Release & Auto-Update Guide

This guide documents how **BetterJungler** is versioned, packaged as a Windows NSIS installer, signed for Tauri v2 automatic updates, and released via [`.github/workflows/release.yml`](../.github/workflows/release.yml).

## 1. Pre-Release & Version Synchronization Gates

BetterJungler keeps `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `packaging/winget/*.yaml`, and `CHANGELOG.md` synchronized:

- `src-tauri/tauri.conf.json` omits `"version"` so Tauri v2 inherits it directly from `src-tauri/Cargo.toml`.
- Bump versions across manifests cleanly using [`scripts/bump-version.mjs`](../scripts/bump-version.mjs) (plus `package-lock.json`, `packaging/winget/` manifests, and `CHANGELOG.md`):
  ```powershell
  node scripts/bump-version.mjs 2.2.0
  ```
- Verify full synchronization (`package.json` === `src-tauri/Cargo.toml` === `CHANGELOG.md` `## [X.Y.Z]` heading, Winget YAML tests, plus Git tag match on CI):
  ```powershell
  node scripts/check-version.mjs
  node scripts/extract-changelog.mjs
  npm run typecheck
  npm run lint
  npm test
  npm run build
  ```
- Verify Rust formatting, Clippy lints, and unit tests:
  ```powershell
  cargo fmt --manifest-path src-tauri/Cargo.toml --check
  cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
  cargo test --manifest-path src-tauri/Cargo.toml
  ```
- Note: `.github/workflows/ci.yml` and `.github/workflows/release.yml` automatically run `cargo test --locked` when `src-tauri/Cargo.lock` is committed, or `cargo test` otherwise. Remove untracked `src-tauri/Cargo.lock` locally before commits unless intentionally locking dependencies.

## 2. Automated Tag Release & Updater Pipeline (`.github/workflows/release.yml`)

Pushing an annotated tag matching `v*.*.*` (for example `v2.2.0`) triggers `.github/workflows/release.yml` on `windows-latest`:

1. Runs `node scripts/check-version.mjs` (refuses mismatched tags, manifests, or missing `CHANGELOG.md` entries).
2. Runs full frontend verification (`npm ci`, `typecheck`, `lint`, `test`, `build`) and Rust verification (`cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`).
3. Extracts that version's `## [X.Y.Z]` notes from `CHANGELOG.md` via [`scripts/extract-changelog.mjs`](../scripts/extract-changelog.mjs) into `RELEASE_BODY`.
4. Runs `tauri-apps/tauri-action@v0` with `includeUpdaterJson: true`, `updaterJsonPreferNsis: true`, `releaseDraft: false`, and `TAURI_SIGNING_PRIVATE_KEY` to build and publish:
   - Per-user Windows NSIS installer (`BetterJungler_<X.Y.Z>_x64-setup.exe`) + updater signature (`*.exe.sig`)
   - Signed `latest.json` updater manifest containing version, Ed25519 signature, installer download URL, and release notes.

### Required GitHub Repository Secrets

Set these in **Repository → Settings → Secrets and variables → Actions** before tagging:
- `TAURI_SIGNING_PRIVATE_KEY`: Private Ed25519 updater key matching `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password if the Tauri updater key is encrypted (optional otherwise).

## 3. Ed25519 Patch Pack Signing (`knowledge/`)

Patch packs (`knowledge/<patch>.json`, `knowledge/meta-<patch>.json`) include season objective timings, Smite thresholds, Jungle meta overrides, and `roleBenchmarks.bottom`. To regenerate and sign with the pinned pack key outside the repository:

```powershell
node scripts/sign-patch-pack.mjs --write --key-file="$env:USERPROFILE\.betterjungler\pack-signing.pem"
```

Never commit private `.pem` keys into the repository.

## 4. First-Time Windows Installation & Automatic Updates

### First-Time User Install
1. Download `BetterJungler_<X.Y.Z>_x64-setup.exe` from the [published GitHub Release](https://github.com/malikjannico/betterjungler/releases/latest) (verify its SHA-256 checksum on the release page).
2. For unsigned personal builds (when Authenticode secrets are not configured), click **More info → Run anyway** on any Windows SmartScreen prompt.
3. The NSIS installer installs per-user into `%LOCALAPPDATA%` with no UAC admin prompt.
4. Set League of Legends **Video → Window Mode** to **Borderless** or **Windowed** for HUD visibility and hardware capture.

### Subsequent Automatic Updates
- BetterJungler checks `https://github.com/malikjannico/betterjungler/releases/latest/download/latest.json` on launch (`+30s`) and every 6 hours while idle.
- Updates **never interrupt gameplay**: an update indicator appears in the sidebar (`M3NavRail`) when idle, and Rust's `updater.rs` safety gate blocks installs during `champ_select`, `loading`, or `in_game`.
- Choose **Manual** (`Install & Restart`) or **Download & Install on Quit** inside **Settings → Updates & About**. Every update verifies its Ed25519 signature against `plugins.updater.pubkey` before passive NSIS installation and relaunches cleanly with a dismissible **What's New** banner.

## 5. Optional Windows Authenticode Code Signing

To eliminate SmartScreen prompts on public builds:
- Configure `WINDOWS_CERTIFICATE` (base64 `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD` in GitHub Secrets. `.github/workflows/release.yml` automatically detects both secrets, passes temporary `signtool.exe` signing configuration to `tauri-apps/tauri-action@v0`, and removes temporary `.pfx`/config files in an `if: always()` step.

## 6. Winget Manifest Sync & Riot Proxy

- **Winget (`packaging/winget/`)**: `wingetManifest.test.ts` enforces version alignment with `package.json`. After publishing a GitHub release, stamp the installer SHA-256 with:
  ```powershell
  node scripts/update-winget-manifest.mjs --version 2.2.0 --sha256 <64-char-hex-sha256>
  ```
- **Cloudflare Worker Proxy (`proxy/`)**: Deploy [`proxy/`](../proxy/README.md) with `wrangler secret put RIOT_API_KEY && npx wrangler deploy` and paste its origin-only `https://...` URL into **Settings → Account & Riot API → Riot API Proxy URL (HTTPS)**.
