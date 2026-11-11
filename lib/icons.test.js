'use strict';
// Self-check: node lib/icons.test.js — per-task / per-subtask icons: which names and entries survive cleaning, which ids pruning keeps.
const assert = require('assert');
const I = require('./icons.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

ok('cleanName passes a known name and rejects everything else', () => {
  assert.strictEqual(I.cleanName('deploy'), 'deploy');
  assert.strictEqual(I.cleanName('nope'), null);
  assert.strictEqual(I.cleanName('DEPLOY'), null);
  assert.strictEqual(I.cleanName(undefined), null);
});
ok('every name in NAMES passes cleanName', () => {
  for (const n of I.NAMES) assert.strictEqual(I.cleanName(n), n);
});
ok('cleanIcons keeps good entries, drops bad keys and bad names', () => {
  assert.deepStrictEqual(I.cleanIcons({ k3x9q2: 'fix', 'BAD id': 'fix', aaa111: 'hack-me', bbb222: null, ccc333: 'docs' }),
    { k3x9q2: 'fix', ccc333: 'docs' });
});
ok('cleanIcons on nothing gives an empty object', () => {
  assert.deepStrictEqual(I.cleanIcons(undefined), {});
  assert.deepStrictEqual(I.cleanIcons('nope'), {});
});
ok('pruneIcons drops ids that are gone and keeps the ones still in the notes', () => {
  assert.deepStrictEqual(I.pruneIcons({ k3x9q2: 'fix', zzz999: 'call' }, new Set(['k3x9q2', 'sub777'])), { k3x9q2: 'fix' });
});
ok('pruneIcons keeps EVERYTHING when a note could not be read (known = null)', () => {
  const icons = { k3x9q2: 'fix', zzz999: 'call' };
  assert.strictEqual(I.pruneIcons(icons, null), icons);
});
ok('pruneIcons on nothing gives an empty object', () => {
  assert.deepStrictEqual(I.pruneIcons(undefined, new Set(['k3x9q2'])), {});
});
ok('a hand-picked icon survives a round trip through cleanIcons (the backup path)', () => {
  const round = I.cleanIcons({ k3x9q2: 'workout', m4n8p6: 'give', x1y: 'give' });
  assert.deepStrictEqual(round, { k3x9q2: 'workout', m4n8p6: 'give' }); // x1y = too short an id
});

ok('NAMES is the data file: 146 icons (76 + 70 on 2026-11-11, M5)', () => {
  assert.strictEqual(I.NAMES.length, 146);
});
ok('every one of the 37 old names still exists', () => {
  const OLD = 'deploy publish fix tool code review test docs design meeting call email idea present data security report goal shop pay health workout study read write clean cook travel home car gift love plant event music play give'.split(' ');
  assert.strictEqual(OLD.length, 37);
  for (const n of OLD) assert.ok(I.NAMES.includes(n), n);
});
ok('every one of the 76 names saved before 2026-11-11 still exists (saved icons point at them)', () => {
  const V130 = 'deploy publish fix refactor code review test docs tool security server data api workflow config key sync terminal merge contract invoice pay payroll employee team housing project form sheet import export template translate timesheet location vacation report email reply call meeting chat present videocall study read research brainstorm idea ai interview resume skill goal post write motion design photo portfolio share shop health workout clean cook travel home car gift love plant event music play give'.split(' ');
  assert.strictEqual(V130.length, 76);
  for (const n of V130) assert.ok(I.NAMES.includes(n), n);
});
ok('names are unique', () => {
  assert.strictEqual(new Set(I.NAMES).size, I.NAMES.length);
});
ok('every icon in the data has a non-empty svg / en / ar', () => {
  for (const g of require('./task-icons.js')) for (const i of g.icons) assert.ok(i.n && i.svg && i.en && i.ar, g.id + '/' + i.n);
});

console.log(`icons: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
