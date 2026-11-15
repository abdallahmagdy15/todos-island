'use strict';
// Blank-line block self-check: node lib/blocks.test.js
const assert = require('assert');
const B = require('./blocks.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

console.log('blocks — blank-line separated parts');
ok('split: the spec examples', () => {
  assert.deepStrictEqual(B.split('a\nb\n\n\nc'), [['a', 'b'], ['c']]);
  assert.deepStrictEqual(B.split('a\nb'), [['a', 'b']]);
  assert.deepStrictEqual(B.split(''), []);
});
ok('split: \\r\\n input, whitespace-only separators, leading / trailing blanks ignored', () => {
  assert.deepStrictEqual(B.split('\r\na\r\n\r\n \t \r\nb\r\n\r\n'), [['a'], ['b']]);
});
ok('split: lines inside a block are trimmed; a whitespace-only line separates', () => {
  assert.deepStrictEqual(B.split('  a  \nb\t'), [['a', 'b']]);
  assert.deepStrictEqual(B.split('  a  \n   \nb'), [['a'], ['b']]);
});
ok('count: fast path and the real count', () => {
  assert.strictEqual(B.count(''), 0);
  assert.strictEqual(B.count('one line'), 1);
  assert.strictEqual(B.count('a\nb'), 1);
  assert.strictEqual(B.count('a\n\nb'), 2);
  assert.strictEqual(B.count('a\r\n\r\nb\n\n c \n\n\n d'), 4);
});
ok('items: 3 blocks → titles + notes, Arabic text keeps its words', () => {
  const it = B.items('Call Sam\nnotes line\n\nتحضير التقرير\n\n!! Email lead');
  assert.deepStrictEqual(it, [
    { title: 'Call Sam', notes: ['notes line'] },
    { title: 'تحضير التقرير', notes: [] },
    { title: '!! Email lead', notes: [] }
  ]);
});
ok('items: the title collapses inner whitespace', () => {
  assert.deepStrictEqual(B.items('fix   the   bug'), [{ title: 'fix the bug', notes: [] }]);
});
ok('taskAndSubs: one block → the task, no subs', () => {
  assert.deepStrictEqual(B.taskAndSubs('Fix login\ndesc line'), { taskText: 'Fix login\ndesc line', subs: [] });
});
ok('taskAndSubs: three blocks → the task text plus two subs', () => {
  const r = B.taskAndSubs('!! 24 Sep -- Ship release\nchecklist item\n\nWrite notes\na note\n\nTell the team');
  assert.strictEqual(r.taskText, '!! 24 Sep -- Ship release\nchecklist item');
  assert.deepStrictEqual(r.subs, [{ title: 'Write notes', notes: ['a note'] }, { title: 'Tell the team', notes: [] }]);
});

console.log(`\nblocks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
