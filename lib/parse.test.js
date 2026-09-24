'use strict';
// Self-check: node lib/parse.test.js — asserts parsing, byte-identical round-trip on the REAL notes,
// migration formatting, and file ops on a scratch copy. Exits non-zero on any failure.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./parse.js');
const { makePngBuffer } = require('./icon.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

console.log('parse — task line formats');
ok('v2 full: !! 24 Sep — Title', () => {
  const t = P.parseTaskLine('- [ ] !! 24 Sep — Fix the login bug');
  assert.deepStrictEqual({ c: t.checked, p: t.priority, d: t.due, s: t.title },
    { c: false, p: '!!', d: { d: 24, m: 'Sep' }, s: 'Fix the login bug' });
});
ok('v2 date only', () => {
  const t = P.parseTaskLine('- [ ] 5 Jan — Plan sprint');
  assert.deepStrictEqual({ p: t.priority, d: t.due, s: t.title }, { p: null, d: { d: 5, m: 'Jan' }, s: 'Plan sprint' });
});
ok('v2 priority only', () => {
  const t = P.parseTaskLine('- [x] !!! — Ship it');
  assert.deepStrictEqual({ p: t.priority, d: t.due, s: t.title }, { p: '!!!', d: null, s: 'Ship it' });
});
ok('plain title with em-dash inside stays intact', () => {
  const t = P.parseTaskLine('- [ ] Continue mapping of worker status only');
  assert.deepStrictEqual({ p: t.priority, d: t.due, s: t.title }, { p: null, d: null, s: 'Continue mapping of worker status only' });
});
ok('legacy trailing: Title — !! — due:2026-09-24', () => {
  const t = P.parseTaskLine('- [ ] ACME CRM: add lookup — !! — due:2026-09-24');
  assert.deepStrictEqual({ p: t.priority, d: t.due, s: t.title },
    { p: '!!', d: { d: 24, m: 'Sep' }, s: 'ACME CRM: add lookup' });
});
ok('legacy trailing reversed: Title — due:2026-09-24 — med', () => {
  const t = P.parseTaskLine('- [ ] Old task — due:2026-09-24 — med');
  assert.deepStrictEqual({ p: t.priority, d: t.due }, { p: '!!', d: { d: 24, m: 'Sep' } });
});
ok('legacy personal ISO-first with --- separator', () => {
  const t = P.parseTaskLine('- [ ] 2026-08-23 --- start get prepare to study swiftsoft');
  assert.deepStrictEqual({ d: t.due, s: t.title }, { d: { d: 23, m: 'Aug' }, s: 'start get prepare to study swiftsoft' });
});
ok('hand-edit combo: leading !! + legacy trailing — !! — due:', () => {
  const t = P.parseTaskLine('- [ ] !! ACME CRM: add lookup — !! — due:2026-09-24');
  assert.deepStrictEqual({ p: t.priority, d: t.due, s: t.title },
    { p: '!!', d: { d: 24, m: 'Sep' }, s: 'ACME CRM: add lookup' });
});
ok('bare leading priority without dash', () => {
  const t = P.parseTaskLine('- [ ] !!! Continue mapping of worker status only');
  assert.deepStrictEqual({ p: t.priority, d: t.due }, { p: '!!!', d: null });
});
ok('v2.1: * active marker with priority and due', () => {
  const t = P.parseTaskLine('- [ ] * !! 24 Sep — Ship the API');
  assert.deepStrictEqual({ a: t.active, p: t.priority, d: t.due, s: t.title },
    { a: true, p: '!!', d: { d: 24, m: 'Sep' }, s: 'Ship the API' });
});
ok('v2.1: bare * only', () => {
  const t = P.parseTaskLine('- [ ] * Fix login bug');
  assert.strictEqual(t.active, true);
  assert.strictEqual(t.priority, null);
});
ok('v2.1: order-independent — due then *', () => {
  const t = P.parseTaskLine('- [ ] 24 Sep * — Renew passport');
  assert.deepStrictEqual({ a: t.active, d: t.due }, { a: true, d: { d: 24, m: 'Sep' } });
});
ok('fmtTask emits active marker first', () => {
  assert.strictEqual(P.fmtTask({ indent: '', checked: false, active: true, priority: '!', due: { d: 2, m: 'Oct' }, title: 'T' }),
    '- [ ] * ! 2 Oct — T');
});
ok('NoteFile.toggleActive round-trips', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-act.md');
  require('fs').writeFileSync(tmp, ['- [ ] Plain task', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  nf.toggleActive(nf.id(nf.topTasks()[0]));
  assert.ok(nf.text().includes('- [ ] * — Plain task'), nf.text());
  nf.toggleActive(nf.id(nf.topTasks()[0]));
  assert.ok(nf.text().includes('- [ ] Plain task'), nf.text());
});
ok('NoteFile.toggleSubtask flips one subtask', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-sub.md');
  require('fs').writeFileSync(tmp, [
    '- [ ] Parent', '\t- [ ] Step A', '\t- [x] Step B', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const id = nf.id(nf.topTasks()[0]);
  nf.toggleSubtask(id, 'Step A');
  assert.ok(nf.text().includes('\t- [x] Step A'), nf.text());
  nf.toggleSubtask(id, 'Step B');
  assert.ok(nf.text().includes('\t- [ ] Step B'), nf.text());
});
ok('description lines: notesOf + subtasksOf split a block', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-notes.md');
  require('fs').writeFileSync(tmp, [
    '- [ ] * !! 24 Sep — Fix the sync bug', '\tSometimes fails on retry', '\t- [ ] Add test', '\tCheck the logger', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const t = nf.topTasks()[0];
  assert.deepStrictEqual(nf.notesOf(t), ['Sometimes fails on retry', 'Check the logger']);
  assert.deepStrictEqual(nf.subtasksOf(t).map(s => s.title), ['Add test']);
});
ok('setNotes replaces description, keeps subtasks', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-setnotes.md');
  require('fs').writeFileSync(tmp, ['- [ ] Task', '\told note', '\t- [ ] Sub', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  nf.setNotes(nf.id(nf.topTasks()[0]), ['new note A', 'new note B']);
  const out = nf.text();
  assert.ok(out.includes('\tnew note A') && out.includes('\tnew note B') && !out.includes('old note'), out);
  assert.ok(out.includes('\t- [ ] Sub'), out);
});
ok('complete() carries description lines under Done', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-notes-done.md');
  require('fs').writeFileSync(tmp, [
    '# W', '', '## Open', '', '- [ ] Task', '\tdesc line', '\t- [ ] Sub', '', '## Done', '', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { doneHeading: '## Done', fileTag: 't' });
  nf.complete(nf.id(nf.topTasks().find(t => t.title === 'Task')));
  const out = nf.text();
  assert.ok(/## Done\n- \[x\] Task\n\tdesc line\n\t- \[ \] Sub/.test(out), out);
});
ok('subtask line (indented)', () => {
  const t = P.parseTaskLine('\t- [ ] Dev & update the API');
  assert.strictEqual(t.subtask, true);
});
ok('checked box parses', () => {
  assert.strictEqual(P.parseTaskLine('- [x] 24 Sep — Done thing').checked, true);
});

console.log('parse — serializer (v2 out)');
ok('fmtTask emits v2', () => {
  assert.strictEqual(P.fmtTask({ indent: '', checked: false, priority: '!!', due: { d: 24, m: 'Sep' }, title: 'T' }),
    '- [ ] !! 24 Sep — T');
});
ok('fmtTask omits absent meta', () => {
  assert.strictEqual(P.fmtTask({ indent: '', checked: true, priority: null, due: null, title: 'T' }), '- [x] T');
});

console.log('round-trip — real notes must be byte-identical (no dirty edits)');
// optional: point at your own notes via env (TODO_WORK_NOTE / TODO_PERSONAL_NOTE) to run this against real data
const WORK = process.env.TODO_WORK_NOTE;
const PERSONAL = process.env.TODO_PERSONAL_NOTE;
for (const f of [WORK, PERSONAL]) {
  if (!f) { console.log('  (skip — env not set)'); continue; }
  const name = path.basename(f);
  if (!fs.existsSync(f)) { console.log('  (skip ' + name + ' — not found)'); continue; }
  ok(name + ': parse → serialize === original', () => {
    const text = fs.readFileSync(f, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    assert.strictEqual(P.docToText(P.parseDoc(text), eol), text);
  });
}

console.log('NoteFile — ops on scratch copy');
ok('complete() moves work task under ## Done with subtasks', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-work.md');
  fs.writeFileSync(tmp, [
    '# Work', '', '## Open', '', '- [ ] !! 24 Sep — Parent', '\t- [ ] Sub one', '', '- [ ] Other', '', '## Done', '', '(none yet)', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { doneHeading: '## Done', fileTag: 'test' });
  nf.complete(nf.id(nf.topTasks().find(t => t.title === 'Parent')));
  const out = nf.text();
  assert.ok(/## Done\n- \[x\] !! 24 Sep — Parent\n\t- \[ \] Sub one\n\n?\(none yet\)/.test(out), out);
  assert.ok(out.indexOf('## Open') < out.indexOf('Other'));
});
ok('addTask + addSubtask + update round-trip', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-per.md');
  fs.writeFileSync(tmp, ['# P', '', '- [ ] 23 Aug — old one', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  nf.addTask({ title: 'New task', priority: '!', due: { d: 2, m: 'Oct' } });
  const id = nf.id(nf.topTasks().find(t => t.title === 'New task'));
  nf.addSubtask(id, 'first step');
  nf.update(id, { priority: '!!!' });
  const out = nf.text();
  assert.ok(out.includes('- [ ] !!! 2 Oct — New task'), out);
  assert.ok(out.includes('\t- [ ] first step'), out);
  assert.ok(out.includes('- [ ] 23 Aug — old one'), out); // untouched lines survive verbatim
});
ok('deleteTask removes the block; restoreBlock resurrects it byte-identical', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-del.md');
  fs.writeFileSync(tmp, [
    '# W', '', '- [ ] Alpha', '\talpha desc', '\t- [ ] sub', '', '- [ ] Beta', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const before = nf.text();
  const cap = nf.deleteTask(nf.id(nf.topTasks().find(t => t.title === 'Alpha')));
  const out = nf.text();
  assert.ok(!out.includes('Alpha') && !out.includes('alpha desc') && !out.includes('\t- [ ] sub'), out);
  assert.ok(out.includes('- [ ] Beta'), out);
  nf.restoreBlock(cap);
  assert.strictEqual(nf.text(), before);
});
ok('deleteSubtask removes exactly one subtask line', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-delsub.md');
  fs.writeFileSync(tmp, ['- [ ] Parent', '\t- [ ] Keep', '\t- [ ] Drop', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  nf.deleteSubtask(nf.id(nf.topTasks()[0]), 'Drop');
  const out = nf.text();
  assert.ok(out.includes('\t- [ ] Keep') && !out.includes('Drop'), out);
  assert.strictEqual(nf.subtasksOf(nf.topTasks()[0]).length, 1);
});
ok('uncomplete: - [x] → - [ ] and moves before ## Done', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-uncomplete.md');
  fs.writeFileSync(tmp, [
    '# Work', '', '## Open', '', '- [ ] Still open', '', '## Done', '', '- [x] !! 20 Sep — Finished', '\t- [ ] leftover sub', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { doneHeading: '## Done', fileTag: 't' });
  nf.uncomplete(nf.id(nf.topTasks().find(t => t.title === 'Finished')));
  const out = nf.text();
  assert.ok(out.includes('- [ ] !! 20 Sep — Finished'), out);
  assert.ok(out.indexOf('- [ ] !! 20 Sep — Finished') < out.indexOf('## Done'), out);
});
ok("moveTask 'up' swaps adjacent blocks including descriptions", () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-move.md');
  fs.writeFileSync(tmp, [
    '- [ ] Top task', '\ttop desc', '', '- [ ] Bottom task', '\tbottom desc', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  nf.moveTask(nf.id(nf.topTasks().find(t => t.title === 'Bottom task')), 'up');
  const out = nf.text();
  assert.ok(out.indexOf('Bottom task') < out.indexOf('Top task'), out);
  assert.ok(/- \[ \] Bottom task\n\tbottom desc[\s\S]*- \[ \] Top task\n\ttop desc/.test(out), out);
});
ok('reorderTask moves a block before another task', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-reorder.md');
  fs.writeFileSync(tmp, ['- [ ] First', '\tfirst note', '- [ ] Second', '- [ ] Third', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  nf.reorderTask(nf.id(nf.topTasks().find(t0 => t0.title === 'First')), nf.id(nf.topTasks().find(t0 => t0.title === 'Third')));
  const out = nf.text();
  assert.ok(/Second\n- \[ \] First\n\tfirst note\n- \[ \] Third/.test(out), out);
});
ok('reorderTask to end (null) lands before ## Done', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-reorder2.md');
  fs.writeFileSync(tmp, [
    '# W', '', '## Open', '', '- [ ] A', '- [ ] B', '', '## Done', '', '- [x] Z', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { doneHeading: '## Done', fileTag: 't' });
  nf.reorderTask(nf.id(nf.topTasks().find(t0 => t0.title === 'A')), null);
  const out = nf.text();
  assert.ok(/B\n- \[ \] A\n\n## Done/.test(out), out);
});
ok('clearDone removes only checked top-level tasks', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-cleardone.md');
  fs.writeFileSync(tmp, [
    '- [ ] Keep open', '', '- [x] Done one', '\t- [x] its sub', '', '- [x] Done two', '', '- [ ] Keep two', ''
  ].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const n = nf.clearDone();
  assert.strictEqual(n, 2);
  const out = nf.text();
  assert.ok(out.includes('- [ ] Keep open') && out.includes('- [ ] Keep two'), out);
  assert.ok(!out.includes('Done one') && !out.includes('its sub') && !out.includes('Done two'), out);
});

console.log('resolveDue — year inference');
ok('recently passed date stays this year (overdue)', () => {
  const d = new Date(); d.setDate(d.getDate() - 10);
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const ts = P.resolveDue({ d: d.getDate(), m });
  assert.ok(ts < Date.now(), 'expected past');
});
ok('far passed date rolls to next year', () => {
  const ts = P.resolveDue({ d: 1, m: 'Jan' });
  assert.ok(ts > Date.now(), 'expected future');
});

console.log('icon — valid PNG bytes');
ok('PNG signature + IHDR size', () => {
  const png = makePngBuffer(32);
  assert.deepStrictEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.strictEqual(png.readUInt32BE(16), 32);
  assert.strictEqual(png.readUInt32BE(20), 32);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
