import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const pkgVersion = String(pkg.version ?? '').trim();

const cargoRaw = fs.readFileSync(path.join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf8');
const cargoMatch = cargoRaw.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
const cargoVersion = cargoMatch?.[1]?.trim() ?? '';

const tauriConf = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8')
);
const confVersion = tauriConf.version ? String(tauriConf.version).trim() : null;

const changelogRaw = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
const expectedHeading = `## [${pkgVersion}]`;

const errors = [];
if (!pkgVersion) {
  errors.push('package.json is missing version.');
}
if (pkgVersion !== cargoVersion) {
  errors.push(
    `Version mismatch: package.json=${pkgVersion} vs src-tauri/Cargo.toml=${cargoVersion}`
  );
}
if (confVersion !== null && confVersion !== pkgVersion && confVersion !== '../package.json') {
  errors.push(
    `Version mismatch: src-tauri/tauri.conf.json=${confVersion} vs package.json=${pkgVersion}`
  );
}
if (!changelogRaw.includes(expectedHeading)) {
  errors.push(`CHANGELOG.md does not contain heading "${expectedHeading}".`);
}

const refName = (process.env.GITHUB_REF_NAME ?? '').trim();
if (/^v\d+\.\d+\.\d+/.test(refName) && refName !== `v${pkgVersion}`) {
  errors.push(`Git tag mismatch: GITHUB_REF_NAME=${refName} vs v${pkgVersion}`);
}

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`ERROR: ${err}`);
  }
  process.exit(1);
}

console.log(`Version check passed: v${pkgVersion} (package.json, Cargo.toml, CHANGELOG.md synced)`);
