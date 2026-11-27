import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const positionalVersion =
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : pkg.version;
const targetVersion = positionalVersion.replace(/^v/, '').trim();

const changelogRaw = fs.readFileSync(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
const lines = changelogRaw.split(/\r?\n/);

const headingPrefix = `## [${targetVersion}]`;
const startIdx = lines.findIndex((line) => line.startsWith(headingPrefix));
if (startIdx === -1) {
  console.error(`No changelog section found for ${headingPrefix}`);
  process.exit(1);
}

const sectionLines = [];
for (let i = startIdx; i < lines.length; i++) {
  if (i > startIdx && /^## \[/.test(lines[i])) break;
  sectionLines.push(lines[i]);
}

const body = sectionLines.join('\n').trim();
const outIdx = process.argv.indexOf('--out');
if (outIdx !== -1 && process.argv[outIdx + 1]) {
  fs.writeFileSync(path.resolve(process.argv[outIdx + 1]), `${body}\n`, 'utf8');
} else {
  process.stdout.write(`${body}\n`);
}
