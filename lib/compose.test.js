'use strict';
// Self-check: node lib/compose.test.js — the composer must produce exactly the line the parser writes.
const assert = require('assert');
const { composeTask } = require('./compose.js');
const { parseTaskLine } = require('./parse.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

console.log('compose — typed text + chips → exact note line');
ok('plain title', () => {
  const r = composeTask({ text: 'Fix login redirect' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.line, '- [ ] Fix login redirect');
});
ok('empty title is rejected', () => {
  assert.strictEqual(composeTask({ text: '   ' }).ok, false);
  assert.strictEqual(composeTask({ text: '!! ' }).ok, false); // tokens only, no title
});
ok('chip priority + due', () => {
  const r = composeTask({ text: 'Ship it', priority: '!!!', due: { d: 26, m: 'Sep' } });
  assert.strictEqual(r.line, '- [ ] !!! 26 Sep — Ship it');
  assert.strictEqual(r.dueText, '26 Sep');
});
ok('each priority chip', () => {
  for (const p of ['!', '!!', '!!!']) assert.strictEqual(composeTask({ text: 'T', priority: p }).line, `- [ ] ${p} — T`);
});
ok('typed notation is parsed (C1)', () => {
  const r = composeTask({ text: '!! 26 Sep Fix login' });
  assert.deepStrictEqual({ p: r.priority, d: r.due, t: r.title }, { p: '!!', d: { d: 26, m: 'Sep' }, t: 'Fix login' });
  assert.strictEqual(r.line, '- [ ] !! 26 Sep — Fix login');
});
ok('typed * marks Now', () => {
  const r = composeTask({ text: '* Write report' });
  assert.strictEqual(r.active, true);
  assert.strictEqual(r.line, '- [ ] * — Write report');
});
ok('explicit chip overrides typed token', () => {
  const r = composeTask({ text: '!! Fix login', priority: '!' });
  assert.strictEqual(r.priority, '!');
  assert.strictEqual(r.title, 'Fix login');
});
ok('explicit null clears typed due', () => {
  assert.strictEqual(composeTask({ text: '5 Jan Plan', due: null }).due, null);
});
ok('fallback used when nothing typed or chosen', () => {
  const r = composeTask({ text: 'Keep', fallback: { priority: '!!', due: { d: 3, m: 'Oct' }, active: true } });
  assert.strictEqual(r.line, '- [ ] * !! 3 Oct — Keep');
});
ok('description lines split off', () => {
  const r = composeTask({ text: 'Title\n line one \n\nline two' });
  assert.deepStrictEqual(r.desc, ['line one', 'line two']);
});
ok('31 Feb clamps to a real day', () => {
  const r = composeTask({ text: 'T', due: { d: 31, m: 'Feb' } });
  assert.ok(r.due.d === 28 || r.due.d === 29);
});
ok('round-trip: composed line parses back to the same task', () => {
  const r = composeTask({ text: '* !!! 7 Nov Big launch' });
  const t = parseTaskLine(r.line);
  assert.deepStrictEqual({ a: t.active, p: t.priority, d: t.due, s: t.title }, { a: true, p: '!!!', d: { d: 7, m: 'Nov' }, s: 'Big launch' });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
