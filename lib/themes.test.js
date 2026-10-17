'use strict';
// theme presets self-check (lib/themes.js)
const assert = require('assert');
const T = require('./themes.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

const base = { islandTheme: 'mist', accent: 'blue', material: 'liquid', glassLevel: 3, ...T.DEFAULTS };
ok('the app defaults (Mist, blue, liquid, 38 %) read as the Mist theme', () => assert.strictEqual(T.themeOf(base).id, 'mist'));
ok('every theme matches itself after picking it', () => { for (const t of T.THEMES) assert.strictEqual(T.themeOf({ ...base, ...T.patchFor(t.id) }).id, t.id); });
ok('one changed knob = Custom (null)', () => {
  const s = { ...base, ...T.patchFor('kraft-notebook') };
  assert.strictEqual(T.themeOf({ ...s, paperPattern: 'lines' }), null);
  assert.strictEqual(T.themeOf({ ...base, glassLevel: 2 }), null);
});
ok('a glass theme ignores the paper knobs', () => assert.strictEqual(T.themeOf({ ...base, paperHand: 'gochi', paperPattern: 'plain' }).id, 'mist'));
ok('Kraft Notebook = the owner picks', () => assert.deepStrictEqual(T.patchFor('kraft-notebook'), { islandTheme: 'kraft', accent: 'graphite', material: 'frosted', kraftShadeLight: 'light', paperPattern: 'fibers', paperHand: 'architects', paperHandAr: 'marhey' }));
ok('Dot Journal = the owner picks', () => assert.deepStrictEqual(T.patchFor('dot-journal'), { islandTheme: 'dot', accent: 'blue', material: 'frosted', dotShadeLight: 'warm', dotShadeDark: 'slate', paperPattern: 'dots', paperHand: 'shantell', paperHandAr: 'marhey' }));
ok('paper themes are never glossy: normalize forces Frosted', () => {
  assert.strictEqual(T.normalize({ ...base, islandTheme: 'kraft', material: 'liquid' }).material, 'frosted');
  assert.strictEqual(T.normalize({ ...base, material: 'liquid' }).material, 'liquid');
});
ok('bad paper knobs fall back to defaults', () => { const n = T.normalize({ ...base, paperHand: 'comic-sans', dotShadeDark: 7 }); assert.strictEqual(n.paperHand, 'architects'); assert.strictEqual(n.dotShadeDark, 'slate'); });
ok('attrs: null for glass, the alt shades for paper', () => {
  assert.strictEqual(T.attrs(base), null);
  assert.deepStrictEqual(T.attrs({ ...base, ...T.patchFor('kraft-notebook') }), { hand: 'architects', handAr: 'marhey', pattern: 'fibers', shadeL: '', shadeD: '' });
  assert.deepStrictEqual(T.attrs({ ...base, ...T.patchFor('dot-journal'), dotShadeLight: 'today', dotShadeDark: 'today' }), { hand: 'shantell', handAr: 'marhey', pattern: 'dots', shadeL: 'alt', shadeD: 'alt' });
  assert.strictEqual(T.attrs({ ...base, islandTheme: 'kraft', kraftShadeLight: 'lighter' }).shadeL, 'alt');
});
ok('7 themes, unique ids, en + ar names', () => { assert.strictEqual(T.THEMES.length, 7); assert.strictEqual(new Set(T.THEMES.map(t => t.id)).size, 7); for (const t of T.THEMES) assert.ok(t.en && t.ar); });
console.log(`themes: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
