'use strict';
// Self-check: node lib/schedule.test.js — asserts the dual-cadence scheduler:
// work/off intervals + toggles, night guard, weekend = personal time, Fri-eve → Mon skip.
const assert = require('assert');
const { nextFireAt } = require('./schedule.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

const BASE = { dayStart: '09:00', dayEnd: '17:00', workIntervalMin: 30, offIntervalMin: 60,
  workRemindersOn: true, offRemindersOn: true, weekendAware: true };
// Wed 24 Sep 2026 — a plain weekday
const wed = (h, m) => new Date(2026, 8, 23, h, m, 0, 0);
// Sat 26 Sep / Sun 27 Sep 2026
const sat = (h, m) => new Date(2026, 8, 26, h, m, 0, 0);
const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi, 0, 0).getTime();
const last = wed(14, 0).getTime(); // last shown Wed 14:00

console.log('schedule — work mode');
ok('mid-workday: lastShown + work interval', () => {
  assert.strictEqual(nextFireAt(BASE, last, wed(14, 10)), wed(14, 30).getTime());
});
ok('stale lastShown in work mode fires at now', () => {
  assert.strictEqual(nextFireAt(BASE, wed(6, 0).getTime(), wed(14, 10)), wed(14, 10).getTime());
});
ok('work reminders off → next fire at dayEnd', () => {
  assert.strictEqual(nextFireAt({ ...BASE, workRemindersOn: false }, last, wed(14, 10)), wed(17, 0).getTime());
});

console.log('schedule — off mode (evenings)');
ok('evening: lastShown + off interval', () => {
  assert.strictEqual(nextFireAt(BASE, wed(19, 0).getTime(), wed(19, 10)), wed(20, 0).getTime());
});
ok('stale lastShown in the evening fires at now', () => {
  assert.strictEqual(nextFireAt(BASE, wed(6, 0).getTime(), wed(19, 10)), wed(19, 10).getTime());
});
ok('evening, off reminders off → next workday start (Thu 09:00)', () => {
  assert.strictEqual(nextFireAt({ ...BASE, offRemindersOn: false }, last, wed(19, 0)), at(2026, 8, 24, 9, 0));
});
ok('Fri evening, off reminders off, weekendAware → Mon 09:00', () => {
  assert.strictEqual(nextFireAt({ ...BASE, offRemindersOn: false }, last, new Date(2026, 8, 25, 19, 0)), at(2026, 8, 28, 9, 0));
});

console.log('schedule — night guard');
ok('02:00 stays quiet till today start', () => {
  assert.strictEqual(nextFireAt(BASE, wed(22, 0).getTime(), wed(2, 0)), wed(9, 0).getTime());
});
ok('23:59 weekday: evening fire past midnight clamps to tomorrow start', () => {
  assert.strictEqual(nextFireAt(BASE, wed(23, 0).getTime(), wed(23, 59)), at(2026, 8, 24, 9, 0));
});

console.log('schedule — weekend = personal time');
ok('Sat 11:00 with weekendAware runs the OFF cadence', () => {
  assert.strictEqual(nextFireAt(BASE, sat(9, 30).getTime(), sat(10, 0)), sat(10, 30).getTime());
});
ok('Sat evening with weekendAware, off reminders off → Mon 09:00', () => {
  assert.strictEqual(nextFireAt({ ...BASE, offRemindersOn: false }, sat(12, 0).getTime(), sat(19, 0)), at(2026, 8, 28, 9, 0));
});
ok('weekendAware OFF: Sat 11:00 counts as workday (work cadence)', () => {
  assert.strictEqual(nextFireAt({ ...BASE, weekendAware: false }, sat(10, 30).getTime(), sat(11, 0)), sat(11, 0).getTime());
});
ok('Sat before dayStart with weekendAware → quiet till Sat 09:00 (night rule)', () => {
  assert.strictEqual(nextFireAt(BASE, sat(20, 0).getTime(), sat(3, 0)), sat(9, 0).getTime());
});

console.log('schedule — both off = fully manual');
ok('both toggles off never auto-fires (next nominal event only)', () => {
  assert.strictEqual(nextFireAt({ ...BASE, workRemindersOn: false, offRemindersOn: false }, last, wed(14, 10)), wed(17, 0).getTime());
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
