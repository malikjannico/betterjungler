import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_MANIFEST_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'packaging',
  'winget'
);

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;

/**
 * Updates the Winget 1.6 manifest files for BetterJungler with the target version,
 * installer SHA256, and download URL.
 */
export function updateWingetManifests({
  version,
  sha256,
  url,
  manifestDir = DEFAULT_MANIFEST_DIR,
}) {
  const cleanVersion = String(version ?? '').trim().replace(/^v/, '');
  if (!SEMVER_RE.test(cleanVersion)) {
    throw new Error(`Invalid semantic version: "${version}"`);
  }

  const cleanSha = String(sha256 ?? '').trim().toUpperCase();
  if (!SHA256_RE.test(cleanSha)) {
    throw new Error('Installer SHA256 must be a 64-character hexadecimal string.');
  }

  const installerUrl =
    url?.trim() ||
    `https://github.com/malikjannico/betterjungler/releases/download/v${cleanVersion}/BetterJungler_${cleanVersion}_x64-setup.exe`;
  if (!installerUrl.startsWith('https://')) {
    throw new Error(`InstallerUrl must use HTTPS: "${installerUrl}"`);
  }

  const versionFile = path.join(manifestDir, 'BetterJungler.BetterJungler.yaml');
  const installerFile = path.join(manifestDir, 'BetterJungler.BetterJungler.installer.yaml');
  const localeFile = path.join(manifestDir, 'BetterJungler.BetterJungler.locale.en-US.yaml');

  for (const filePath of [versionFile, installerFile, localeFile]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing Winget manifest file: ${filePath}`);
    }
  }

  const replaceVersionLine = (content) =>
    content.replace(/^PackageVersion:\s*.+$/m, `PackageVersion: ${cleanVersion}`);

  const nextVersionRaw = replaceVersionLine(fs.readFileSync(versionFile, 'utf8'));
  const nextInstallerRaw = replaceVersionLine(fs.readFileSync(installerFile, 'utf8'))
    .replace(/^(\s*InstallerUrl:\s*).+$/m, `$1${installerUrl}`)
    .replace(/^(\s*InstallerSha256:\s*).+$/m, `$1${cleanSha}`);
  const nextLocaleRaw = replaceVersionLine(fs.readFileSync(localeFile, 'utf8')).replace(
    /^ReleaseNotesUrl:\s*.+$/m,
    `ReleaseNotesUrl: https://github.com/malikjannico/betterjungler/releases/tag/v${cleanVersion}`
  );

  fs.writeFileSync(versionFile, nextVersionRaw, 'utf8');
  fs.writeFileSync(installerFile, nextInstallerRaw, 'utf8');
  fs.writeFileSync(localeFile, nextLocaleRaw, 'utf8');

  return {
    version: cleanVersion,
    sha256: cleanSha,
    installerUrl,
    files: [versionFile, installerFile, localeFile],
  };
}

function parseCliArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') parsed.version = argv[++i];
    else if (arg === '--sha256') parsed.sha256 = argv[++i];
    else if (arg === '--url') parsed.url = argv[++i];
    else if (arg === '--dir') parsed.manifestDir = argv[++i];
  }
  return parsed;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (!opts.version || !opts.sha256) {
    console.error(
      'Usage: node scripts/update-winget-manifest.mjs --version <semver> --sha256 <64-hex> [--url <https-url>] [--dir <path>]'
    );
    process.exit(1);
  }
  const result = updateWingetManifests(opts);
  console.log(
    `Updated Winget manifests to v${result.version} (SHA256 ${result.sha256.slice(0, 12)}...)`
  );
}
