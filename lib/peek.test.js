'use strict';
const assert = require('assert');
const { inPeekZone, peekStep, PEEK_MS } = require('./peek.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };
const B = { x: 0, y: 0, width: 1920, height: 1080 };
console.log('peek — top-edge zone');
ok('the strip is the top few px, centred, 25 % of the width', () => {
  assert.ok(inPeekZone({ x: 960, y: 0 }, B));
  assert.ok(inPeekZone({ x: 960 - 240, y: 2 }, B) && inPeekZone({ x: 960 + 240, y: 0 }, B));
  assert.ok(!inPeekZone({ x: 960 - 241, y: 0 }, B) && !inPeekZone({ x: 960 + 241, y: 0 }, B));
  assert.ok(!inPeekZone({ x: 960, y: 3 }, B));
});
ok('a second screen to the left: the strip follows that display\'s bounds', () => {
  const L = { x: -1280, y: 0, width: 1280, height: 1024 };
  assert.ok(inPeekZone({ x: -640, y: 0 }, L) && !inPeekZone({ x: 960, y: 0 }, L));
});
ok('fires after a 1 s rest, never before', () => {
  let s = { since: null, armed: true }, r;
  r = peekStep(s, true, 1000); s = r.state; assert.ok(!r.fire);
  r = peekStep(s, true, 1000 + PEEK_MS - 1); s = r.state; assert.ok(!r.fire);
  r = peekStep(s, true, 1000 + PEEK_MS); assert.ok(r.fire);
});
ok('leaving the strip cancels the rest', () => {
  let s = peekStep({}, true, 0).state;
  s = peekStep(s, false, 800).state;
  const r = peekStep(s, true, 1600); assert.ok(!r.fire && r.state.since === 1600);
});
ok('a parked pointer fires once; it re-arms only after leaving', () => {
  let s = peekStep({}, true, 0).state, r = peekStep(s, true, PEEK_MS); s = r.state; assert.ok(r.fire);
  r = peekStep(s, true, 5000); s = r.state; assert.ok(!r.fire);
  r = peekStep(s, true, 9000); s = r.state; assert.ok(!r.fire);
  s = peekStep(s, false, 9100).state; s = peekStep(s, true, 9200).state;
  assert.ok(peekStep(s, true, 9200 + PEEK_MS).fire);
});
console.log(`\npeek: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
