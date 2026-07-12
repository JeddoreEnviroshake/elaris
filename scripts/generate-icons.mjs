/**
 * Generate original PWA icons procedurally — no downloaded or third-party art.
 * Draws a stylized sprout emblem (the game's grow-from-nothing theme) on a
 * full-bleed green field, then encodes PNGs with a tiny dependency-free encoder
 * (Node's zlib only). Full-bleed background keeps the maskable variants safe.
 *
 * Run: `node scripts/generate-icons.mjs` (wired into `prebuild`).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [0x14, 0x2a, 0x1e]; // deep forest
const BG2 = [0x1f, 0x6f, 0x43]; // theme green (disc)
const STEM = [0x6b, 0x4a, 0x2b];
const LEAF = [0x4c, 0xc0, 0x7f];
const LEAF_HI = [0x8f, 0xe6, 0xac];

// ---- tiny drawing surface -------------------------------------------------

function createCanvas(size) {
  return { size, data: new Uint8Array(size * size * 4) };
}

function setPx(cv, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= cv.size || y >= cv.size) return;
  const i = (y * cv.size + x) * 4;
  // simple source-over alpha blend
  const ia = a / 255;
  cv.data[i] = Math.round(cv.data[i] * (1 - ia) + r * ia);
  cv.data[i + 1] = Math.round(cv.data[i + 1] * (1 - ia) + g * ia);
  cv.data[i + 2] = Math.round(cv.data[i + 2] * (1 - ia) + b * ia);
  cv.data[i + 3] = 255;
}

function fillRectF(cv, x, y, w, h, color) {
  for (let yy = Math.floor(y); yy < y + h; yy++) {
    for (let xx = Math.floor(x); xx < x + w; xx++) setPx(cv, xx, yy, color);
  }
}

function fillDisc(cv, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let yy = Math.floor(cy - radius); yy <= cy + radius; yy++) {
    for (let xx = Math.floor(cx - radius); xx <= cx + radius; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r2) setPx(cv, xx, yy, color);
    }
  }
}

/** A leaf: an ellipse rotated toward `dir` (-1 left, +1 right). */
function fillLeaf(cv, cx, cy, rx, ry, dir, color) {
  for (let yy = Math.floor(cy - ry); yy <= cy + ry; yy++) {
    for (let xx = Math.floor(cx - rx); xx <= cx + rx; xx++) {
      const dx = (xx - cx) / rx;
      const dy = (yy - cy) / ry;
      // shear to slant the leaf outward/up
      const sx = dx - dir * dy * 0.5;
      if (sx * sx + dy * dy <= 1) setPx(cv, xx, yy, color);
    }
  }
}

function drawIcon(size, { maskable }) {
  const cv = createCanvas(size);
  fillRectF(cv, 0, 0, size, size, BG);

  // Content sits inside the maskable safe zone (~center 80%).
  const inset = maskable ? 0.14 : 0.06;
  const discR = size * (0.5 - inset);
  const cx = size / 2;
  const cy = size / 2;
  fillDisc(cv, cx, cy, discR, BG2);

  const u = size / 100; // unit
  // stem
  fillRectF(cv, cx - 2.5 * u, cy - 4 * u, 5 * u, 30 * u, STEM);
  // leaves
  fillLeaf(cv, cx - 14 * u, cy - 6 * u, 16 * u, 9 * u, -1, LEAF);
  fillLeaf(cv, cx + 14 * u, cy - 6 * u, 16 * u, 9 * u, 1, LEAF);
  fillLeaf(cv, cx, cy - 22 * u, 11 * u, 16 * u, 0, LEAF_HI);
  return cv;
}

// ---- PNG encoding ---------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(cv) {
  const { size, data } = cv;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // rows with filter byte 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- emit -----------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-192.png', size: 192, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];
for (const t of targets) {
  const png = encodePng(drawIcon(t.size, { maskable: t.maskable }));
  writeFileSync(join(OUT_DIR, t.file), png);
  console.log(`wrote icons/${t.file} (${png.length} bytes)`);
}
