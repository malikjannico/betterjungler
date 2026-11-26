# BetterJungler Windows Release & Signing Guide

This guide documents how to verify, package, sign, and publish the Windows NSIS installer for **BetterJungler** via `.github/workflows/release.yml`.

## 1. Pre-Release Verification Gates

Before cutting a release tag, all quality and compliance gates must pass cleanly on `main`:

1. **Frontend static checks, tests, and bundle**:
   ```powershell
   npm ci
   npm run typecheck
   npm run lint
   npm run test
   npm run build
   ```
2. **Rust backend & Cargo tests**:
   - In CI (`.github/workflows/release.yml`), `cargo test` executes on `windows-latest`:
     ```powershell
     cargo test --manifest-path src-tauri/Cargo.toml
     ```
   - Locally before tagging, also run `cargo clippy` (when the Rust toolchain is installed):
     ```powershell
     cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
     ```
3. **Dual Critical Review Gate**: Verify both internal Gemini Pro review and external Claude Opus review pass with zero unresolved P0/P1 findings.
4. **Riot Policy Compliance Check**: Confirm `docs/RIOT_COMPLIANCE.md` obligations remain satisfied (no automated enemy cooldown timers, strict Solo/Duo anonymity during Champ Select, pinned Riot LCU root CA certificate in `src-tauri/certs/riotgames.pem`, rate-limit backoff enabled).

## 2. Automated Tag Release Workflow (`.github/workflows/release.yml`)

Pushing a semantic version tag matching `v*.*.*` triggers the `Release Windows Installer` workflow on `windows-latest`:

- Sets up Node `22` and stable Rust (`rustfmt`, `clippy`).
- Runs `npm run typecheck`, `npm run lint`, `npm run test`, and `cargo test`.
- Invokes `tauri-apps/tauri-action@v0` using `GITHUB_TOKEN` to build the Windows NSIS installer and create a **draft** GitHub Release (`BetterJungler v__VERSION__`).
- You can also trigger a manual build via **Actions → Release Windows Installer → Run workflow** (`workflow_dispatch`).

### Version Bump Checklist

Ensure the version string matches across all three manifests before tagging:
- `package.json` (`"version"`)
- `src-tauri/Cargo.toml` (`version`)
- `src-tauri/tauri.conf.json` (`version`)

Then create and push the annotated tag:

```powershell
git tag -a v0.2.0 -m "Release BetterJungler v0.2.0"
git push origin v0.2.0
```

## 3. Optional Windows Authenticode Code Signing & Tauri Updater

To suppress Windows SmartScreen warnings and support signed auto-updates when distributing outside local testing, configure the following repository secrets in GitHub:

### Windows Code Signing (Authenticode)

- Import a code-signing certificate into the runner's Windows certificate store using repository secrets (e.g., `WINDOWS_CERTIFICATE` base64 PFX + `WINDOWS_CERTIFICATE_PASSWORD` in CI, or Azure Trusted Signing) and configure `bundle.windows.certificateThumbprint` / `timestampUrl` (or `bundle.windows.signCommand`) in `src-tauri/tauri.conf.json`.
- Never commit `.pfx` certificates, passwords, or private signing keys into the repository.

### Tauri v2 Updater Manifest Checklist (When Enabling Auto-Updates)

1. Generate an updater keypair with `npx tauri signer generate`.
2. Store the private key and password in GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
3. Add the generated **public key** to `plugins.updater.pubkey` and point `plugins.updater.endpoints` in `src-tauri/tauri.conf.json` to your HTTPS release endpoint (`latest.json`).
4. Set `bundle.createUpdaterArtifacts: true` in `src-tauri/tauri.conf.json` so `tauri-action` uploads `.nsis.zip` / `.sig` signatures alongside `latest.json`.

## 4. Publishing the Draft Release

1. Inspect the generated NSIS `.exe` installer on the draft release page in GitHub Releases.
2. Smoke-test installation and HUD overlay toggle (`Alt+J`), beside-minimap positioning, and Credential Manager API key storage on Windows 11.
3. Add release notes and publish the GitHub Release.
