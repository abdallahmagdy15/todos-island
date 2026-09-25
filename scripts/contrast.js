'use strict';
// Contrast gate: node scripts/contrast.js — parses the token blocks (light :root + dark @media :root),
// resolves var() chains, composites translucent colors over their base and checks WCAG ratios.
// Exits non-zero if any pair fails. Pure Node, no deps.
const fs = require('fs');
const path = require('path');

// [fg, bg, min] — bg may be "a over b" for translucent surfaces. 4.5 = body text, 3 = large text / glyphs / UI edges.
const CHECKS = {
  'tokens.css': [
    ['ink', 'paper', 4.5], ['ink', 'card over paper', 4.5],
    ['muted', 'paper', 4.5], ['muted', 'card over paper', 4.5], ['muted', 'input over paper', 4.5],
    ['faint', 'paper', 4.5], ['faint', 'card over paper', 4.5], ['faint', 'input over paper', 4.5],
    ['accent', 'paper', 4.5], ['accent', 'card over paper', 4.5], ['accent', 'accent-soft over paper', 4.5],
    ['accent-ink', 'accent', 4.5],
    ['p1', 'paper', 4.5], ['p2', 'paper', 4.5], ['p3', 'paper', 4.5],
    ['p3', 'card over paper', 4.5], ['p2', 'card over paper', 4.5], ['ok', 'card over paper', 4.5],
    ['ink', 'accent-soft over paper', 4.5],
    ['ink', 'pill-bg', 4.5], ['muted', 'pill-bg', 4.5], ['faint', 'pill-bg', 4.5],
    ['accent', 'pill-bg', 4.5], ['p1', 'pill-bg', 4.5], ['p2', 'pill-bg', 4.5], ['p3', 'pill-bg', 4.5],
    ['ink', 'glass over paper', 4.5], ['muted', 'glass over paper', 4.5], ['accent', 'glass over paper', 4.5],
    ['ink', 'glass over card over paper', 4.5], ['muted', 'glass over card over paper', 4.5],
    ['ink', 'head-mica over paper', 4.5], ['muted', 'head-mica over paper', 4.5], ['faint', 'head-mica over paper', 4.5],
    ['accent', 'accent-soft over pill-bg', 4.5], ['ink', 'accent-soft over pill-bg', 4.5], ['faint', 'chip over pill-bg', 4.5], ['muted', 'chip over card over paper', 4.5]
  ]
};

function blocks(css) {
  const strip = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = body => Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const light = strip.match(/(^|\n):root\s*\{([^}]*)\}/);
  const darkMedia = strip.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root[^{]*\{([^}]*)\}/);
  const L = decls(light ? light[2] : '');
  return { light: L, dark: { ...L, ...decls(darkMedia ? darkMedia[1] : '') } };
}
function resolve(vars, name, depth = 0) {
  const v = vars[name];
  if (v === undefined) throw new Error(`--${name} not defined`);
  const m = v.match(/^var\(--([\w-]+)\)$/);
  if (m && depth < 10) return resolve(vars, m[1], depth + 1);
  return v;
}
function parseColor(s) {
  s = s.trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    const n = [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2) || 'ff', 16));
    return { r: n[0], g: n[1], b: n[2], a: n[3] / 255 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?\s*\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error('unparsed color ' + s);
}
const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
const lum = c => {
  const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function color(vars, expr) { // "a over b over c" composites right-to-left onto an opaque base
  const parts = expr.split(/\s+over\s+/).map(n => parseColor(resolve(vars, n)));
  let c = parts.pop();
  if (c.a < 1) c = over(c, { r: 255, g: 255, b: 255, a: 1 });
  while (parts.length) c = over(parts.pop(), c);
  return c;
}

let fails = 0, total = 0;
for (const [file, pairs] of Object.entries(CHECKS)) {
  const css = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const schemes = blocks(css);
  for (const [scheme, vars] of Object.entries(schemes)) {
    for (const [fg, bg, min] of pairs) {
      total++;
      let r;
      try {
        const bgc = color(vars, bg);
        const fgc = over(color(vars, fg), bgc);
        r = ratio(fgc, bgc);
      } catch (e) { fails++; console.error(`  ✗ ${file} ${scheme}: ${fg} on ${bg} — ${e.message}`); continue; }
      const okp = r >= min;
      if (!okp) fails++;
      console[okp ? 'log' : 'error'](`  ${okp ? '✓' : '✗'} ${scheme.padEnd(5)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
    }
  }
}
console.log(`\ncontrast: ${total - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
