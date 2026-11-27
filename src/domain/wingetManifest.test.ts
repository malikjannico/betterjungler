// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { updateWingetManifests } from '../../scripts/update-winget-manifest.mjs';

describe('Winget 1.6 manifests & updater script', () => {
  it('keeps checked-in packaging/winget manifests synced with package.json version', () => {
    const manifestDir = path.resolve(process.cwd(), 'packaging', 'winget');
    const versionYaml = fs.readFileSync(
      path.join(manifestDir, 'BetterJungler.BetterJungler.yaml'),
      'utf8'
    );
    const installerYaml = fs.readFileSync(
      path.join(manifestDir, 'BetterJungler.BetterJungler.installer.yaml'),
      'utf8'
    );
    const localeYaml = fs.readFileSync(
      path.join(manifestDir, 'BetterJungler.BetterJungler.locale.en-US.yaml'),
      'utf8'
    );

    expect(versionYaml).toContain(`PackageVersion: ${pkg.version}`);
    expect(versionYaml).toContain('ManifestVersion: 1.6.0');
    expect(installerYaml).toContain(`PackageVersion: ${pkg.version}`);
    expect(installerYaml).toContain(`BetterJungler_${pkg.version}_x64-setup.exe`);
    expect(localeYaml).toContain(`PackageVersion: ${pkg.version}`);
    expect(localeYaml).toContain(`ReleaseNotesUrl: https://github.com/malikjannico/betterjungler/releases/tag/v${pkg.version}`);
  });

  it('updates version, sha256, and installer URL across all three manifests and rejects invalid input', () => {
    const sourceDir = path.resolve(process.cwd(), 'packaging', 'winget');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bj-winget-test-'));
    try {
      for (const name of [
        'BetterJungler.BetterJungler.yaml',
        'BetterJungler.BetterJungler.installer.yaml',
        'BetterJungler.BetterJungler.locale.en-US.yaml',
      ]) {
        fs.copyFileSync(path.join(sourceDir, name), path.join(tempDir, name));
      }

      const sampleSha = 'a'.repeat(64);
      const res = updateWingetManifests({
        version: 'v1.2.3',
        sha256: sampleSha,
        url: undefined,
        manifestDir: tempDir,
      });

      expect(res.version).toBe('1.2.3');
      expect(res.sha256).toBe('A'.repeat(64));

      const nextInstaller = fs.readFileSync(
        path.join(tempDir, 'BetterJungler.BetterJungler.installer.yaml'),
        'utf8'
      );
      expect(nextInstaller).toContain('PackageVersion: 1.2.3');
      expect(nextInstaller).toContain(
        'InstallerUrl: https://github.com/malikjannico/betterjungler/releases/download/v1.2.3/BetterJungler_1.2.3_x64-setup.exe'
      );
      expect(nextInstaller).toContain(`InstallerSha256: ${'A'.repeat(64)}`);

      expect(() =>
        updateWingetManifests({ version: 'bad', sha256: sampleSha, url: undefined, manifestDir: tempDir })
      ).toThrow(/Invalid semantic version/i);
      expect(() =>
        updateWingetManifests({ version: '1.2.3', sha256: 'short', url: undefined, manifestDir: tempDir })
      ).toThrow(/64-character/i);
      expect(() =>
        updateWingetManifests({
          version: '1.2.3',
          sha256: sampleSha,
          url: 'http://insecure.example.com/setup.exe',
          manifestDir: tempDir,
        })
      ).toThrow(/HTTPS/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
