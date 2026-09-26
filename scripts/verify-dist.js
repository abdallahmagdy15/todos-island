'use strict';
// verify-dist gate: the built asar must actually contain the files the app loads at runtime.
// Born from v1.4.0 shipping without locales/ + onboard.js (electron-builder's explicit files
// list rots as the app grows). Run after `npm run dist`: `npm run verify-dist`.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..');
const ASAR = path.join(APP, 'dist', 'win-unpacked', 'resources', 'app.asar');

const MUST_EXIST = [
  'main.js', 'tokens.css', 'sfx.js', 'motion.js', 'ui-shared.js',
  'locales/en.js', 'locales/ar.js', 'lib/i18n.js', 'lib/parse.js', 'lib/schedule.js',
  'onboard.html', 'onboard.js', 'onboard-preload.js',
  'island.html', 'island.js', 'island-preload.js', 'island.css',
  'window.html', 'window.js', 'window-preload.js', 'window.css',
  'editor.html', 'editor.js', 'editor.css',
  'share.html', 'share.js', 'share.css'
];

if (!fs.existsSync(ASAR)) {
  console.error('verify-dist: no build found — run npm run dist first (' + ASAR + ')');
  process.exit(1);
}
const bin = path.join(APP, 'node_modules', '.bin', process.platform === 'win32' ? 'asar.cmd' : 'asar');
const listing = execFileSync(bin, ['list', ASAR], { encoding: 'utf8', shell: true });
const files = new Set(listing.split(/\r?\n/).map(l => l.replace(/^\\+/, '').replace(/\\/g, '/').trim()).filter(Boolean));
const missing = MUST_EXIST.filter(f => !files.has(f));
if (missing.length) {
  console.error('verify-dist: MISSING FROM ASAR -> ' + missing.join(', '));
  process.exit(1);
}
console.log('verify-dist: ' + MUST_EXIST.length + ' critical files present in the asar ✓');
