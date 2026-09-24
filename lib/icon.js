'use strict';
// Generates the tray icon PNG in pure Node (zlib + hand-rolled CRC32) — no image deps.
// Look: dark horizontal pill with one accent dot — a tiny Dynamic Island.
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

function inPill(x, y, s) {
  // horizontal capsule: two end circles + connecting rect
  const r = s * 0.1875, cy = s / 2;
  const x1 = s * 0.25, x2 = s * 0.75;
  if (x >= x1 && x <= x2) return Math.abs(y - cy) <= r;
  const cx = x < x1 ? x1 : x2;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function makePngBuffer(size = 32) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const dotC = { x: size * 0.6875, y: size / 2, r: size * 0.09375 };
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let px = [0, 0, 0, 0];
      if (inPill(x + 0.5, y + 0.5, size)) px = [14, 14, 18, 255];
      if ((x + 0.5 - dotC.x) ** 2 + (y + 0.5 - dotC.y) ** 2 <= dotC.r ** 2) px = [110, 168, 255, 255];
      px.forEach((v, i) => { raw[row + 1 + x * 4 + i] = v; });
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
