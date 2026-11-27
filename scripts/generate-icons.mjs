import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/**
 * Generates solid-background bold filled Jungle Crest icons for Tauri desktop
 * bundling (`src-tauri/icons/*`) and web favicon (`public/favicon.png`).
 */

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function insideRoundedBox(x, y, pad, radius) {
  const min = pad;
  const max = 1 - pad;
  if (x < min || x > max || y < min || y > max) return false;
  const ix = Math.max(min + radius, Math.min(max - radius, x));
  const iy = Math.max(min + radius, Math.min(max - radius, y));
  const dx = x - ix;
  const dy = y - iy;
  return dx * dx + dy * dy <= radius * radius;
}

// Filled geometric Jungle Crest in normalized [0..1] space:
// 1. Solid #0B1220 rounded-square base (with subtle top-left #1E293B border bevel)
// 2. Bold filled emerald shield/diamond (#10B981) + crisp white inner compass spire (#F8FAFC)
const OUTER_SHIELD = [
  [0.5, 0.16],
  [0.82, 0.44],
  [0.64, 0.84],
  [0.5, 0.72],
  [0.36, 0.84],
  [0.18, 0.44],
];

const INNER_SPIRE = [
  [0.5, 0.25],
  [0.67, 0.45],
  [0.5, 0.65],
  [0.33, 0.45],
];

const CENTER_CORE = [
  [0.5, 0.36],
  [0.57, 0.45],
  [0.5, 0.54],
  [0.43, 0.45],
];

function samplePixel(nx, ny) {
  if (!insideRoundedBox(nx, ny, 0.04, 0.19)) {
    return [0, 0, 0, 0];
  }

  // Solid deep-navy plate with subtle crisp perimeter rim
  let r = 11;
  let g = 18;
  let b = 32;
  if (!insideRoundedBox(nx, ny, 0.065, 0.175)) {
    r = 26;
    g = 40;
    b = 64;
  }

  if (pointInPoly(nx, ny, OUTER_SHIELD)) {
    // Rich Jungle Emerald filled icon
    r = 16;
    g = 185;
    b = 129;
  }
  if (pointInPoly(nx, ny, INNER_SPIRE)) {
    // Crisp high-contrast alabaster blade
    r = 248;
    g = 250;
    b = 252;
  }
  if (pointInPoly(nx, ny, CENTER_CORE)) {
    // Bold deep-emerald core accent
    r = 5;
    g = 150;
    b = 105;
  }

  return [r, g, b, 255];
}

function renderIconRgba(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const sub = 4; // 4x4 supersampling for clean edges down to 16x16
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let sy = 0; sy < sub; sy += 1) {
        for (let sx = 0; sx < sub; sx += 1) {
          const nx = (x + (sx + 0.5) / sub) / size;
          const ny = (y + (sy + 0.5) / sub) / size;
          const [r, g, b, a] = samplePixel(nx, ny);
          sr += r * (a / 255);
          sg += g * (a / 255);
          sb += b * (a / 255);
          sa += a;
        }
      }
      const samples = sub * sub;
      const alpha = Math.round(sa / samples);
      const idx = (y * size + x) * 4;
      if (alpha === 0) {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
      } else {
        const aNorm = alpha / 255;
        rgba[idx] = Math.min(255, Math.round(sr / samples / aNorm));
        rgba[idx + 1] = Math.min(255, Math.round(sg / samples / aNorm));
        rgba[idx + 2] = Math.min(255, Math.round(sb / samples / aNorm));
        rgba[idx + 3] = alpha;
      }
    }
  }
  return rgba;
}

function buildIcoFromPngs(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(entries.length * 16);
  let offset = 6 + dir.length;
  const payloads = [];

  for (let i = 0; i < entries.length; i += 1) {
    const { size, png } = entries[i];
    const base = i * 16;
    dir[base] = size >= 256 ? 0 : size;
    dir[base + 1] = size >= 256 ? 0 : size;
    dir[base + 2] = 0;
    dir[base + 3] = 0;
    dir.writeUInt16LE(1, base + 4);
    dir.writeUInt16LE(32, base + 6);
    dir.writeUInt32LE(png.length, base + 8);
    dir.writeUInt32LE(offset, base + 12);
    offset += png.length;
    payloads.push(png);
  }

  return Buffer.concat([header, dir, ...payloads]);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'src-tauri', 'icons');
const publicDir = path.join(root, 'public');
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });

const png16 = encodePngRgba(16, 16, renderIconRgba(16));
const png32 = encodePngRgba(32, 32, renderIconRgba(32));
const png48 = encodePngRgba(48, 48, renderIconRgba(48));
const png64 = encodePngRgba(64, 64, renderIconRgba(64));
const png128 = encodePngRgba(128, 128, renderIconRgba(128));
const png256 = encodePngRgba(256, 256, renderIconRgba(256));

fs.writeFileSync(path.join(iconsDir, '32x32.png'), png32);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), png128);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), png256);
fs.writeFileSync(
  path.join(iconsDir, 'icon.ico'),
  buildIcoFromPngs([
    { size: 16, png: png16 },
    { size: 32, png: png32 },
    { size: 48, png: png48 },
    { size: 256, png: png256 },
  ])
);
fs.writeFileSync(path.join(publicDir, 'favicon.png'), png64);
console.log('Generated solid-background bold Jungle Crest icons (PNG + ICO + favicon.png).');
