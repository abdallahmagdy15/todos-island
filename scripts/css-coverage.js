'use strict';
// css-coverage gate: every class in a window's static markup must resolve in the stylesheets that
// window actually loads. Kills the "markup referencing styles the page never loads" bug class
// (the unstyled Language segmented control, 2026-09-26). JS-added state classes live in ALLOW.
const fs = require('fs');
const path = require('path');
const APP = __dirname + '/..';

const WINDOWS = ['window.html', 'island.html', 'editor.html', 'share.html', 'onboard.html'];
// classes added at runtime by JS (states, animation hooks) — no static rule expected
const ALLOW = new Set([
  'active', 'sel', 'checked', 'hovered', 'pinned', 'expanded', 'striking', 'flash', 'invalid',
  'rec', 'done', 'bad', 'warn', 'mono', 'on', 'rim', 'mica', 'dirty-note', 'attn', 'dragging',
  'drop-above', 'md-h', 'mt', 'np-reset' // np-reset: onboarding's "Use default" hook class (data-reset carries the behavior; no styles by design)
]);

let findings = 0;
for (const html of WINDOWS) {
  const hp = path.join(APP, html);
  if (!fs.existsSync(hp)) continue;
  const src = fs.readFileSync(hp, 'utf8');
  const sheets = [...src.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(m => m[1]);
  let css = '';
  for (const s of sheets) {
    const p = path.join(APP, s);
    if (fs.existsSync(p)) css += fs.readFileSync(p, 'utf8');
  }
  const classes = new Set();
  for (const m of src.matchAll(/class="([^"]+)"/g)) m[1].trim().split(/\s+/).forEach(c => c && classes.add(c));
  const missing = [...classes].filter(c =>
    !ALLOW.has(c) && !new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(css));
  if (missing.length) {
    findings += missing.length;
    console.log(`  ✗ ${html}: no rule in [${sheets.join(', ')}] for -> ${missing.join(', ')}`);
  } else {
    console.log(`  ✓ ${html}: ${classes.size} classes covered`);
  }
}
console.log(`\ncss-coverage: ${findings ? findings + ' UNRESOLVED' : 'all windows covered'}`);
process.exit(findings ? 1 : 0);
