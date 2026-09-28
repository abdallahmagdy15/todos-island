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
    // glass panels over the onboarding stage's color field (amb-1..3): text on glass uses the island greys (window.css .glass-on)
    ...['amb-1', 'amb-2', 'amb-3'].flatMap(f => ['sheet', 'chrome-min'].flatMap(s => ['ink', 'island-muted', 'island-faint', 'accent'].map(fg => [fg, `${s} over ${f} over paper`, 4.5]))),
    ['accent', 'accent-soft over pill-bg', 4.5], ['ink', 'accent-soft over pill-bg', 4.5], ['faint', 'chip over pill-bg', 4.5], ['muted', 'chip over card over paper', 4.5],
    // island labels (stronger greys) on the solid pill and on its tinted surfaces
    ['island-muted', 'pill-bg', 4.5], ['island-faint', 'pill-bg', 4.5], ['island-muted', 'accent-soft over pill-bg', 4.5],
    ['island-faint', 'chip over pill-bg', 4.5], ['island-muted', 'chip over pill-bg', 4.5],
    ['glass-p3', 'ctl over sheet over amb-1 over paper', 4.5] // the Reset button (btn-soft.danger) on the settings sheet (danger-deep = glass-p3 on glass)
  ]
};

function blocks(css) {
  const strip = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const decls = body => Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const light = strip.match(/(^|\n):root\s*\{([^}]*)\}/);
  const darkMedia = strip.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root[^{]*\{([^}]*)\}/);
  const L = decls(light ? light[2] : '');
  const D = { ...L, ...decls(darkMedia ? darkMedia[1] : '') };
  const out = { light: L, dark: D };
  // theme colors: :root[data-accent="x"] blocks (light at top level, dark inside the media query) layered on the base
  const media = [...strip.matchAll(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  const top = strip.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
  for (const m of top.matchAll(/:root\[data-accent="(\w+)"\]\s*\{([^}]*)\}/g)) out['light/' + m[1]] = { ...L, ...decls(m[2]) };
  for (const m of media.matchAll(/:root\[data-accent="(\w+)"\]\s*\{([^}]*)\}/g)) out['dark/' + m[1]] = { ...D, ...decls(m[2]) };
  return out;
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

// island themes (generated): text over the island's default frost (50 %) over each mesh color point, and the tasks
// window's panels and chrome over each scene color point as the screen really shows it: the scene painted at --scene-a
// with filter saturate(--scene-sat) over paper, then saturated again by the panel's backdrop-filter (--glass-sat), then
// the panel's frost on top. Text on window glass uses the island greys. Only failures are printed.
const BG_THEMES = ['mist', 'dusk', 'lagoon', 'bloom', 'dune'];
const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
// CSS saturate(s) (Filter Effects spec matrix, applied to sRGB values as Chromium does for CSS filter functions)
function saturate(c, s) {
  const [r, g, b] = [c.r, c.g, c.b];
  return { r: (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    g: (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    b: (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b, a: 1 };
}
function themeVars(vars) {
  const v = { ...vars, 'frost-min': `rgba(${resolve(vars, 'g-base')}, 0.5)` };
  const paper = parseColor(resolve(vars, 'paper')), sceneA = +resolve(vars, 'scene-a');
  const sceneSat = +resolve(vars, 'scene-sat'), glassSat = +resolve(vars, 'glass-sat'), islSat = +resolve(vars, 'isl-sat');
  for (const t of BG_THEMES) for (let i = 0; i <= 4; i++) {
    const raw = parseColor(resolve(vars, `bg-${t}-${i}`)), point = saturate(raw, sceneSat);
    const bare = over({ ...point, a: sceneA }, paper);
    v[`bare-${t}-${i}`] = hex(bare); // the scene as the window shows it — text sits right on it (no containers, v1.13)
    v[`scene-${t}-${i}`] = hex(saturate(bare, glassSat)); // what the composer / side panel frosts
    v[`isl-${t}-${i}`] = hex(saturate(raw, islSat)); // the island's softened picture
  }
  return v;
}
const THEME_CHECKS = [];
for (const t of BG_THEMES) {
  for (let i = 0; i <= 4; i++) for (const fg of ['ink', 'island-muted', 'island-faint', 'accent', 'p1', 'p2', 'p3']) THEME_CHECKS.push([fg, `frost-min over isl-${t}-${i}`, 4.5, true]);
  for (let i = 0; i <= 4; i++) for (const fg of ['ink', 'island-muted', 'island-faint', 'accent', 'p1', 'glass-p2', 'glass-p3', 'glass-ok']) {
    for (const sfc of ['sheet', 'chrome-min']) THEME_CHECKS.push([fg, `${sfc} over scene-${t}-${i}`, 4.5, true]);
    THEME_CHECKS.push([fg, `bare-${t}-${i}`, 4.5, true]); // no containers: list text, headings and the status line sit on the scene itself
  }
}

let fails = 0, total = 0;
for (const [file, pairs] of Object.entries(CHECKS)) {
  const css = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const schemes = blocks(css);
  for (const [scheme, base] of Object.entries(schemes)) {
    const vars = themeVars(base);
    for (const [fg, bg, min, quiet] of [...pairs, ...THEME_CHECKS]) {
      total++;
      let r;
      try {
        const bgc = color(vars, bg);
        const fgc = over(color(vars, fg), bgc);
        r = ratio(fgc, bgc);
      } catch (e) { fails++; console.error(`  ✗ ${file} ${scheme}: ${fg} on ${bg} — ${e.message}`); continue; }
      const okp = r >= min;
      if (!okp) fails++;
      if (okp && quiet) continue;
      console[okp ? 'log' : 'error'](`  ${okp ? '✓' : '✗'} ${scheme.padEnd(14)} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
    }
  }
}
console.log(`\ncontrast: ${total - fails} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
