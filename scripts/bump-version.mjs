import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextVersion = process.argv[2]?.trim().replace(/^v/, '');

if (!nextVersion || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error('Usage: node scripts/bump-version.mjs <semver>');
  process.exit(1);
}

const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = nextVersion;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const lockPath = path.join(rootDir, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = nextVersion;
  if (lock.packages?.['']) {
    lock.packages[''].version = nextVersion;
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

const cargoPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
const cargo = fs.readFileSync(cargoPath, 'utf8');
const updatedCargo = cargo.replace(
  /^version\s*=\s*"[^"]+"/m,
  `version = "${nextVersion}"`
);
if (updatedCargo === cargo && !cargo.includes(`version = "${nextVersion}"`)) {
  console.error('Could not update version in src-tauri/Cargo.toml');
  process.exit(1);
}
fs.writeFileSync(cargoPath, updatedCargo, 'utf8');

console.log(`Updated package.json and src-tauri/Cargo.toml to ${nextVersion}`);
