'use strict';
// Self-check: node lib/setup.test.js — onboarding answers → exactly which notes get created or adopted.
const assert = require('assert');
const path = require('path');
const { planSetup } = require('./setup.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}
const D = path.join('X:', 'Docs', 'todos-island');
const env = (existing = []) => ({ defaultDir: D, exists: p => existing.includes(p) });

console.log('setup — onboarding answers → settings + notes');
ok('skip → personal only, one note in the default folder', () => {
  const r = planSetup({ skip: true, mode: 'both', work: { kind: 'folder', path: 'Y:' } }, env());
  assert.strictEqual(r.settings.mode, 'personal');
  assert.deepStrictEqual(r.create, [{ kind: 'personal', path: path.join(D, 'personal.md') }]);
  assert.strictEqual(r.settings.workPath, undefined);
  assert.strictEqual(r.settings.autoStart, undefined); // skip keeps the default (DEFAULT_SETTINGS)
  assert.strictEqual(r.settings.workIntervalMin, undefined);
});
ok('both, nothing picked → two notes in the default folder', () => {
  const r = planSetup({ mode: 'both' }, env());
  assert.deepStrictEqual(r.create.map(c => c.kind), ['work', 'personal']);
  assert.strictEqual(r.settings.workPath, path.join(D, 'work-tasks.md'));
});
ok('folder pick → note named inside it', () => {
  const r = planSetup({ mode: 'work', work: { kind: 'folder', path: path.join('Y:', 'Notes') } }, env());
  assert.strictEqual(r.settings.workPath, path.join('Y:', 'Notes', 'work-tasks.md'));
  assert.strictEqual(r.settings.personalPath, undefined);
});
ok('existing file is adopted, never created', () => {
  const f = path.join('Y:', 'vault', 'todo.md');
  const r = planSetup({ mode: 'personal', personal: { kind: 'file', path: f } }, env([f]));
  assert.deepStrictEqual(r.adopt, [{ kind: 'personal', path: f }]);
  assert.strictEqual(r.create.length, 0);
});
ok('folder already holding the note → adopted', () => {
  const p = path.join('Y:', 'Notes', 'personal.md');
  const r = planSetup({ mode: 'personal', personal: { kind: 'folder', path: path.join('Y:', 'Notes') } }, env([p]));
  assert.strictEqual(r.adopt[0].path, p);
});
ok('reminders: work-only silences off hours', () => {
  const r = planSetup({ mode: 'work', reminders: { on: true, every: 60, dayStart: '08:30', dayEnd: '16:00' } }, env());
  assert.strictEqual(r.settings.workIntervalMin, 60);
  assert.strictEqual(r.settings.offRemindersOn, false);
  assert.strictEqual(r.settings.dayStart, '08:30');
});
ok('reminders: personal-only uses one cadence all day', () => {
  const r = planSetup({ mode: 'personal', reminders: { on: true, every: 15 } }, env());
  assert.strictEqual(r.settings.offIntervalMin, 15);
  assert.strictEqual(r.settings.offRemindersOn, true);
});
ok('reminders off → both cadences off; bad input falls back', () => {
  const r = planSetup({ mode: 'bogus', reminders: { on: false, every: 7, dayStart: '9' }, autoStart: true }, env());
  assert.strictEqual(r.settings.mode, 'both');
  assert.strictEqual(r.settings.workRemindersOn, false);
  assert.strictEqual(r.settings.offRemindersOn, false);
  assert.strictEqual(r.settings.workIntervalMin, 60);
  assert.strictEqual(r.settings.dayStart, undefined);
  assert.strictEqual(r.settings.autoStart, true);
});

console.log(`\nsetup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
