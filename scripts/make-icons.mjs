// Generates public/icon.svg and the PNG app icons in public/icons without any image libraries.
// Run with: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { ARCH, ARCH_PATH, WAVE, WAVE_PATH, waveY } from '../src/lib/logo.js';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 4; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? r / a : 0;
      raw[o + 1] = a ? g / a : 0;
      raw[o + 2] = a ? b / a : 0;
      raw[o + 3] = (a / (SS * SS)) * 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FROM = [139, 92, 246]; // violet
const TO = [236, 72, 153]; // pink
const mix = (t) => FROM.map((c, i) => c + (TO[i] - c) * t);

function inRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// distances in the 64-unit logo grid
function archDistance(x, y) {
  const { cx, cy, r, bottom } = ARCH;
  if (y <= cy) return Math.abs(Math.hypot(x - cx, y - cy) - r);
  if (y <= bottom) return Math.min(Math.abs(x - (cx - r)), Math.abs(x - (cx + r)));
  return Math.min(Math.hypot(x - (cx - r), y - bottom), Math.hypot(x - (cx + r), y - bottom));
}

// the wave as a fine polyline; exact distance to its segments keeps the stroke even
const WAVE_POINTS = Array.from({ length: 121 }, (_, i) => {
  const x = WAVE.x0 + ((WAVE.x1 - WAVE.x0) * i) / 120;
  return [x, waveY(x)];
});

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function waveDistance(x, y) {
  if (x < WAVE.x0 - WAVE.width || x > WAVE.x1 + WAVE.width || Math.abs(y - WAVE.cy) > WAVE.amp + WAVE.width) return Infinity;
  let d = Infinity;
  for (let i = 1; i < WAVE_POINTS.length; i++) d = Math.min(d, segmentDistance(x, y, WAVE_POINTS[i - 1], WAVE_POINTS[i]));
  return d;
}

const icon = (maskable) => (u, v) => {
  if (!maskable && !inRoundedRect(u, v, 0.22)) return [0, 0, 0, 0];
  // maskable icons get cropped to a circle, so shrink the mark into the safe zone
  const s = maskable ? 0.78 : 1;
  const x = ((u - 0.5) / s + 0.5) * 64;
  const y = ((v - 0.5) / s + 0.5) * 64;
  if (archDistance(x, y) <= ARCH.width / 2 || waveDistance(x, y) <= WAVE.width / 2) return [255, 255, 255, 1];
  return [...mix((u + v) / 2), 1];
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(${FROM})"/>
      <stop offset="1" stop-color="rgb(${TO})"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
    <path d="${ARCH_PATH}" stroke-width="${ARCH.width}"/>
    <path d="${WAVE_PATH}" stroke-width="${WAVE.width}"/>
  </g>
</svg>
`;

const pub = new URL('../public/', import.meta.url);
const out = new URL('icons/', pub);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon.svg', pub), svg);
writeFileSync(new URL('icon-192.png', out), png(192, icon(false)));
writeFileSync(new URL('icon-512.png', out), png(512, icon(false)));
writeFileSync(new URL('icon-maskable-512.png', out), png(512, icon(true)));
console.log('Icons written to public/icon.svg and public/icons');
