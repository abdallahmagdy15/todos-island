'use strict';
// Generates build/icon.ico (multi-size PNG-in-ICO) from the same pill design as the tray icon.
const fs = require('fs');
const path = require('path');
const { makePngBuffer } = require('../lib/icon.js');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const pngs = SIZES.map(s => makePngBuffer(s));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);

let offset = 6 + SIZES.length * 16;
const entries = SIZES.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s;   // width (0 = 256)
  e[1] = s === 256 ? 0 : s;   // height
  e[2] = 0;                    // palette
  e[4] = 0; e[5] = 0;          // reserved
  e.writeUInt16LE(1, 4);       // color planes
  e.writeUInt16LE(32, 6);      // bits per pixel
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});

fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), makePngBuffer(256));
console.log('build/icon.ico + icon.png written');
