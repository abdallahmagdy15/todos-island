'use strict';
// Self-check: node lib/gesture.test.js — when does a touchpad touch sequence count as "hold one finger + tap twice"?
const assert = require('assert');
const { tapStep } = require('./gesture.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

// [fingers, ms] steps → how many times it fired
const run = steps => { let s = null, n = 0; for (const [f, t] of steps) { const r = tapStep(s, f, t); s = r.state; if (r.fire) n++; } return n; };
const tap = (t0, len = 100) => [[2, t0], [1, t0 + len]]; // the second finger taps while one finger holds

ok('hold + two quick taps fires once', () => assert.strictEqual(run([[1, 1000], ...tap(1300), ...tap(1550), [0, 2000]]), 1));
ok('hold + one tap never fires', () => assert.strictEqual(run([[1, 1000], ...tap(1300), [0, 2000]]), 0));
ok('two-finger taps (a right-click: both land together) never fire', () => assert.strictEqual(run([[2, 1000], [0, 1100], [2, 1300], [0, 1400]]), 0));
ok('fingers landing almost together (under 150 ms) is not a hold', () => assert.strictEqual(run([[1, 1000], ...tap(1050), ...tap(1250), [0, 1600]]), 0));
ok('a gap over 400 ms between the taps does not fire', () => assert.strictEqual(run([[1, 1000], ...tap(1300), ...tap(1900), [0, 2200]]), 0));
ok('a slow second touch (a scroll or rest) is not a tap', () => assert.strictEqual(run([[1, 1000], ...tap(1300, 600), ...tap(2000), [0, 2500]]), 0));
ok('lifting the holding finger between the taps resets', () => assert.strictEqual(run([[1, 1000], ...tap(1300), [0, 1450], [1, 1500], ...tap(1560), [0, 1800]]), 0));
ok('a third finger resets', () => assert.strictEqual(run([[1, 1000], ...tap(1300), [2, 1500], [3, 1520], [2, 1540], [1, 1560], [0, 1800]]), 0));
ok('four taps on one hold fire twice', () => assert.strictEqual(run([[1, 1000], ...tap(1300), ...tap(1550), ...tap(1800), ...tap(2050), [0, 2400]]), 2));
ok('time 0 is a valid timestamp', () => assert.strictEqual(run([[1, 0], ...tap(300), ...tap(550), [0, 900]]), 1));

console.log(`gesture: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
