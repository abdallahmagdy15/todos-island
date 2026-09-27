'use strict';
// Generates the app + tray icon PNGs in pure Node (zlib + hand-rolled CRC32) — no image deps.
// Look (owner pick "B", 2026-09-27): the app's own notation, [★] — ink square brackets around the blue star,
// the same mark a Now task wears in the note ("- [ ] * …"). Shapes are signed-distance geometry on a
// 64-unit (tile) / 16-unit (tray) grid, rendered with 4×4 supersampling so every size stays smooth.
const zlib = require('zlib');

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (const b of buf) c = TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// ---- geometry ----
const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const polyDist = (px, py, pts) => { let d = Infinity; for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i - 1], pts[i])); return d; };
function inPolygon(px, py, pts) { // even-odd
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const star = (cx, cy, R, r) => Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r : R;
  return [cx + k * Math.cos(a), cy + k * Math.sin(a)];
});
const roundRectSdf = (px, py, x, y, w, h, rad) => {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - rad), qy = Math.abs(py - (y + h / 2)) - (h / 2 - rad);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
};
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// ---- the two designs (layers painted bottom → top; each returns color + alpha at a grid point, or null) ----
const INK = hex('#1c1b19'), PAPER = hex('#f7f6f2');
function tileLayers() { // app icon: paper tile, faint edge, ink brackets, blue star — 64-unit grid
  const L = [[19, 16], [13, 16], [13, 48], [19, 48]], R = [[45, 16], [51, 16], [51, 48], [45, 48]];
  const S = star(32, 31.2, 11.6, 4.8), BLUE = hex('#2d4fc4');
  return { box: 64, paint: (x, y) => {
    const out = [];
    const sd = roundRectSdf(x, y, 0, 0, 64, 64, 14);
    if (sd <= 0) out.push([PAPER, 1]);
    if (sd <= 0 && sd > -1.5) out.push([INK, 0.12]);
    if (polyDist(x, y, L) <= 2.5 || polyDist(x, y, R) <= 2.5) out.push([INK, 1]);
    if (inPolygon(x, y, S)) out.push([BLUE, 1]);
    return out;
  } };
}
function trayLayers(dark) { // tray glyph: no tile, brackets in the taskbar's ink, star in the accent — 16-unit grid
  const L = [[4.5, 2], [2, 2], [2, 14], [4.5, 14]], R = [[11.5, 2], [14, 2], [14, 14], [11.5, 14]];
  const S = star(8, 7.9, 4.4, 1.85), FG = hex(dark ? '#ecebe6' : '#1c1b19'), BLUE = hex(dark ? '#8ba6ff' : '#2d4fc4');
  return { box: 16, paint: (x, y) => {
    const out = [];
    if (polyDist(x, y, L) <= 1 || polyDist(x, y, R) <= 1) out.push([FG, 1]); // 2 units wide on whole pixels: crisp at 16 px
    if (inPolygon(x, y, S)) out.push([BLUE, 1]);
    return out;
  } };
}

// opts: { tray: true, dark } → the tray glyph for a light/dark taskbar; default → the app tile
function makePngBuffer(size = 32, opts = {}) {
  const { box, paint } = opts.tray ? trayLayers(!!opts.dark) : tileLayers();
  const SS = 4, k = box / size, raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0; // premultiplied accumulation over the samples
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        let cr = 0, cg = 0, cb = 0, ca = 0;
        for (const [[lr, lg, lb], la] of paint((x + (sx + 0.5) / SS) * k, (y + (sy + 0.5) / SS) * k)) {
          cr = lr * la + cr * (1 - la); cg = lg * la + cg * (1 - la); cb = lb * la + cb * (1 - la); ca = la + ca * (1 - la);
        }
        r += cr; g += cg; b += cb; a += ca;
      }
      const n = SS * SS, A = a / n, i = row + 1 + x * 4;
      raw[i] = A ? Math.round(r / n / A) : 0; raw[i + 1] = A ? Math.round(g / n / A) : 0; raw[i + 2] = A ? Math.round(b / n / A) : 0;
      raw[i + 3] = Math.round(A * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { makePngBuffer };
