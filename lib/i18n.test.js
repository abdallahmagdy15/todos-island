'use strict';
// Self-check: node lib/i18n.test.js — key parity between locales, param consistency, resolution + dir.
const assert = require('assert');
const I18N = require('./i18n.js');
const en = require('../locales/en.js');
const ar = require('../locales/ar.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}
const paramsOf = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

console.log('i18n — parity');
ok('every en key exists in ar', () => {
  const missing = Object.keys(en).filter(k => ar[k] === undefined);
  assert.deepStrictEqual(missing, [], 'missing in ar: ' + missing.join(', '));
});
ok('no extra ar keys', () => {
  const extra = Object.keys(ar).filter(k => en[k] === undefined);
  assert.deepStrictEqual(extra, [], 'not in en: ' + extra.join(', '));
});
ok('same {params} in both languages', () => {
  const bad = Object.keys(en).filter(k => paramsOf(en[k]) !== paramsOf(ar[k]));
  assert.deepStrictEqual(bad, [], 'param mismatch: ' + bad.map(k => `${k} en[${paramsOf(en[k])}] ar[${paramsOf(ar[k])}]`).join(' · '));
});
ok('no empty strings', () => {
  const bad = Object.keys(en).filter(k => !String(en[k]).trim() || !String(ar[k]).trim());
  assert.deepStrictEqual(bad, []);
});

console.log('i18n — resolution');
ok("'system' + Arabic system locale → ar", () => assert.strictEqual(I18N.resolveLang('system', 'ar-EG'), 'ar'));
ok("'system' + English system locale → en", () => assert.strictEqual(I18N.resolveLang('system', 'en-US'), 'en'));
ok('manual override wins: ar anywhere', () => assert.strictEqual(I18N.resolveLang('ar', 'en-US'), 'ar'));
ok('manual override wins: en on Arabic system', () => assert.strictEqual(I18N.resolveLang('en', 'ar-EG'), 'en'));
ok('unsupported setting falls back to system', () => assert.strictEqual(I18N.resolveLang('fr', 'ar-EG'), 'ar'));

console.log('i18n — lookup');
ok('t interpolates params', () => assert.strictEqual(I18N.t('en', 'isl.expand.all', { n: 7 }), 'Show all 7 tasks'));
ok('t falls back to en when a locale misses a key', () => {
  const orig = ar['tray.quit']; delete ar['tray.quit'];
  try { assert.strictEqual(I18N.t('ar', 'tray.quit'), 'Quit'); } finally { ar['tray.quit'] = orig; }
});
ok('missing everywhere returns the key (never crashes)', () => assert.strictEqual(I18N.t('en', 'nope.missing'), 'nope.missing'));
ok('dir: ar → rtl, en → ltr', () => { assert.strictEqual(I18N.dirOf('ar'), 'rtl'); assert.strictEqual(I18N.dirOf('en'), 'ltr'); });
ok('arabic sample renders', () => assert.strictEqual(I18N.t('ar', 'u.undo'), 'تراجع'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
