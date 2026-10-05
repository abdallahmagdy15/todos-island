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
    '- [ ] /now ! 2 Oct -- T');
});
ok('NoteFile.toggleActive round-trips', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-act.md');
  require('fs').writeFileSync(tmp, ['- [ ] Plain task', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  nf.toggleActive(nf.id(nf.topTasks()[0]));
  assert.ok(nf.text().includes('- [ ] /now -- Plain task'), nf.text());
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
ok('NoteFile.renameSubtask changes only that subtask title', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-subren.md');
  require('fs').writeFileSync(tmp, ['- [ ] Parent', '\t- [x] Step A', '\t- [ ] Step B', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const id = nf.id(nf.topTasks()[0]);
  assert.strictEqual(nf.renameSubtask(id, 'Step A', '  Step   A2 '), true);
  const lines = nf.text().split('\n').map(l => l.replace(/ <!--.*-->$/, '')); // #11: changed subtasks carry a stamp
  assert.strictEqual(lines[1], '\t- [x] Step A2', nf.text()); // tick + indent kept, spaces tidied
  assert.strictEqual(lines[2], '\t- [ ] Step B'); // the sibling is untouched
  assert.strictEqual(nf.renameSubtask(id, 'Step B', '   '), false); // empty = no-op
  assert.strictEqual(nf.renameSubtask(id, 'Step B', 'Step B'), false); // unchanged = no-op
});
ok('subtask priority: typed bangs on add/rename, setSubtaskPriority, hand-typed lines read', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-subprio.md');
  require('fs').writeFileSync(tmp, ['- [ ] Parent', '\t- [ ] !!! Hand typed', '\t- [ ] Plain', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const id = nf.id(nf.topTasks()[0]);
  const subs = () => nf.subtasksOf(nf.topTasks()[0]).map(s => [s.title, s.priority]);
  assert.deepStrictEqual(subs(), [['Hand typed', '!!!'], ['Plain', null]]); // hand-typed bangs read as priority
  nf.addSubtask(id, '!! Call Sam');
  assert.deepStrictEqual(subs()[2], ['Call Sam', '!!']);
  assert.strictEqual(nf.setSubtaskPriority(id, 'Plain', '!'), true);
  assert.strictEqual(nf.setSubtaskPriority(id, 'Plain', '!'), false); // unchanged = no-op
  assert.strictEqual(nf.renameSubtask(id, 'Call Sam', 'Call Sam today'), true); // no bangs typed: priority stays
  assert.deepStrictEqual(subs(), [['Hand typed', '!!!'], ['Plain', '!'], ['Call Sam today', '!!']]);
  assert.strictEqual(nf.setSubtaskPriority(id, 'Hand typed', null), true);
  const lines = nf.text().split('\n').map(l => l.replace(/ <!--.*-->$/, ''));
  assert.strictEqual(lines[1], '\t- [ ] Hand typed');
  assert.strictEqual(lines[2], '\t- [ ] ! -- Plain');
  assert.strictEqual(lines[3], '\t- [ ] !! -- Call Sam today');
  nf.save(); const again = new P.NoteFile(tmp, { fileTag: 't' }); // the written lines read back the same
  assert.deepStrictEqual(again.subtasksOf(again.topTasks()[0]).map(s => [s.title, s.priority]), [['Hand typed', null], ['Plain', '!'], ['Call Sam today', '!!']]);
});
ok('#11 subtask stamps: add = c+u, tick/rename/priority = u, untouched lines byte-identical, titles clean', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-substamp.md');
  const src = ['- [ ] Parent', '\t- [ ] Old one', '\t- [ ] Old two', ''].join('\n');
  require('fs').writeFileSync(tmp, src);
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const id = nf.id(nf.topTasks()[0]);
  const line = k => nf.text().split('\n')[k];
  nf.addSubtask(id, '! New one');
  assert.match(line(3), /^\t- \[ \] ! -- New one <!-- c:\d{4}-\d\d-\d\dT\d\d:\d\d u:\d{4}-\d\d-\d\dT\d\d:\d\d -->$/);
  assert.strictEqual(line(1), '\t- [ ] Old one'); // untouched: no stamp invented
  nf.toggleSubtask(id, 'Old one');
  assert.match(line(1), /^\t- \[x\] Old one <!-- u:\S+ -->$/); // no invented c, u = when ticked
  assert.strictEqual(line(2), '\t- [ ] Old two');
  nf.renameSubtask(id, 'Old two', 'Old two renamed');
  assert.match(line(2), /Old two renamed <!-- u:\S+ -->$/);
  nf.save(); const again = new P.NoteFile(tmp, { fileTag: 't' });
  const subs = again.subtasksOf(again.topTasks()[0]);
  assert.deepStrictEqual(subs.map(s => s.title), ['Old one', 'Old two renamed', 'New one']); // stamps never leak into titles
  assert.ok(subs[2].created && subs[2].updated && subs[0].updated && !subs[0].created);
  assert.ok(!again.blockLines(again.topTasks()[0]).some(l => l.includes('<!--'))); // Markdown share strips them
  const rt = new P.NoteFile(tmp, { fileTag: 't' }); assert.strictEqual(rt.text(), again.text()); // round-trip
});
ok('#7 due time: "28 Sep 2pm" / "2:30pm" / 24 h read, 12 h written, a bare time needs a separator', () => {
  const r = l => { const t = P.parseTaskLine(l); return [t.title, t.due && t.due.d + ' ' + t.due.m, t.time]; };
  assert.deepStrictEqual(r('- [ ] !! 28 Sep 2pm -- Call'), ['Call', '28 Sep', 840]);
  assert.deepStrictEqual(r('- [ ] 28 Sep 2:30pm -- Call'), ['Call', '28 Sep', 870]);
  assert.deepStrictEqual(r('- [ ] 28 Sep 14:30 -- Call'), ['Call', '28 Sep', 870]);
  assert.deepStrictEqual(r('- [ ] 28 Sep 12am -- Late'), ['Late', '28 Sep', 0]);
  assert.deepStrictEqual(r('- [ ] 28 Sep -- 2pm meeting'), ['2pm meeting', '28 Sep', null]); // after the separator = title
  assert.deepStrictEqual(r('- [ ] 9am standup'), ['9am standup', null, null]); // no separator: stays a title
  assert.deepStrictEqual(r('- [ ] 9am -- standup'), ['standup', null, 540]); // a bare time = today
  const t = P.parseTaskLine('- [ ] 28 Sep 14:30 -- Call');
  assert.strictEqual(t.raw, '- [ ] 28 Sep 14:30 -- Call'); // unchanged lines stay byte-identical (raw)
  assert.strictEqual(P.fmtTask(t), '- [ ] 28 Sep 2:30pm -- Call'); // the app writes the 12 h form
  assert.strictEqual(P.fmtTime(720), '12pm');
  const ts = new Date(P.resolveDue({ d: 28, m: 'Sep' }, 870));
  assert.deepStrictEqual([ts.getHours(), ts.getMinutes()], [14, 30]);
  const n = new Date(P.resolveDue(null, 540)); assert.strictEqual(n.toDateString(), new Date().toDateString());
  assert.deepStrictEqual(P.parseDueText('28 Sep 2pm'), { due: { d: 28, m: 'Sep' }, time: 840 });
});
ok('blockLines: the block as written, stamp stripped', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-block.md');
  require('fs').writeFileSync(tmp, ['- [ ] * !! 30 Sep — Fix the sync bug <!-- c:2026-09-20T09:00 u:2026-09-21T10:30 -->', '\tSometimes fails', '\t- [x] Reproduce', '    - [ ] ! Add a test', '- [ ] Next one', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  assert.deepStrictEqual(nf.blockLines(nf.topTasks()[0]), ['- [ ] * !! 30 Sep — Fix the sync bug', '\tSometimes fails', '\t- [x] Reproduce', '    - [ ] ! Add a test']);
  assert.deepStrictEqual(nf.blockLines(nf.topTasks()[1]), ['- [ ] Next one']);
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
  assert.ok(/## Done\n- \[x\] Task <!-- u:\S+ -->\n\tdesc line\n\t- \[ \] Sub/.test(out), out);
});
ok('subtask line (indented)', () => {
  const t = P.parseTaskLine('\t- [ ] Dev & update the API');
  assert.strictEqual(t.subtask, true);
});
ok('checked box parses', () => {
  assert.strictEqual(P.parseTaskLine('- [x] 24 Sep — Done thing').checked, true);
});

ok('v3: /now !! 30 Sep -- Title (the app writes this)', () => {
  const t = P.parseTaskLine('- [ ] /now !! 30 Sep -- Fix the sync bug');
  assert.deepStrictEqual([t.active, t.priority, t.due, t.title], [true, '!!', { d: 30, m: 'Sep' }, 'Fix the sync bug']);
  assert.strictEqual(P.fmtTask({ ...t, dirty: true }), '- [ ] /now !! 30 Sep -- Fix the sync bug');
});
ok('v3: /now in any order, any case, alone', () => {
  const a = P.parseTaskLine('- [ ] !! /NOW -- Call Sam');
  assert.deepStrictEqual([a.active, a.priority, a.title], [true, '!!', 'Call Sam']);
  const b = P.parseTaskLine('- [ ] /now Plain now task');
  assert.deepStrictEqual([b.active, b.title], [true, 'Plain now task']);
  assert.strictEqual(P.parseTaskLine('- [ ] /nowhere is a title').active, false); // only the whole token counts
});
ok('separators read: --, -, — (legacy) all give the same task', () => {
  for (const sep of ['--', '-', '—']) {
    const t = P.parseTaskLine(`- [ ] ! 2 Oct ${sep} Pay rent`);
    assert.deepStrictEqual([t.priority, t.due, t.title], ['!', { d: 2, m: 'Oct' }, 'Pay rent'], sep);
  }
  const legacy = P.parseTaskLine('- [ ] * !! 24 Sep — Old style');
  assert.deepStrictEqual([legacy.active, legacy.priority, legacy.title], [true, '!!', 'Old style']);
});
ok('subtask with -- separator reads its priority', () => {
  const t = P.parseTaskLine('\t- [ ] !!! -- urgent sub');
  assert.deepStrictEqual([t.subtask, t.priority, t.title], [true, '!!!', 'urgent sub']);
});
console.log('parse — serializer (v2 out)');
ok('fmtTask emits v3 (-- separator)', () => {
  assert.strictEqual(P.fmtTask({ indent: '', checked: false, priority: '!!', due: { d: 24, m: 'Sep' }, title: 'T' }),
    '- [ ] !! 24 Sep -- T');
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
  assert.ok(/## Done\n- \[x\] !! 24 Sep -- Parent <!-- u:\S+ -->\n\t- \[ \] Sub one\n\n?\(none yet\)/.test(out), out);
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
  assert.ok(out.includes('- [ ] !!! 2 Oct -- New task'), out);
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
  assert.ok(out.includes('- [ ] !! 20 Sep -- Finished'), out);
  assert.ok(out.indexOf('- [ ] !! 20 Sep -- Finished') < out.indexOf('## Done'), out);
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
ok('removeByTitle + insertBlockAt = exact position rollback', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-rb2.md');
  fs.writeFileSync(tmp, ['- [ ] A', '- [ ] B', '\tb note', '- [ ] C', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const before = nf.text();
  const bIdx = nf.doc.findIndex(e => e.type === 'task' && e.task.title === 'B');
  const lines = nf.doc.slice(bIdx, bIdx + 2).map(e => (e.type === 'task' ? e.task.raw : e.text));
  nf.removeByTitle('B');
  nf.insertBlockAt(bIdx, lines);
  assert.strictEqual(nf.text(), before); // byte-identical rollback
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

console.log('parse — hidden created/updated stamps');
const STAMPED = '- [ ] !! 28 Sep — Send the report <!-- c:2026-09-20T09:00 u:2026-09-21T10:30 -->';
ok('stamp parses off the line; title stays clean', () => {
  const t = P.parseTaskLine(STAMPED);
  assert.deepStrictEqual({ s: t.title, p: t.priority, c: t.created, u: t.updated }, { s: 'Send the report', p: '!!', c: '2026-09-20T09:00', u: '2026-09-21T10:30' });
});
ok('stamp is optional: hand-typed lines have none', () => {
  const t = P.parseTaskLine('- [ ] !! 28 Sep — Send the report');
  assert.deepStrictEqual([t.created, t.updated, t.title], [null, null, 'Send the report']);
});
ok('a normal HTML comment is NOT a stamp (stays in the title)', () => {
  assert.strictEqual(P.parseTaskLine('- [ ] Call <!-- maybe --> back').title, 'Call <!-- maybe --> back');
});
ok('fmtTask re-emits the stamp exactly', () => {
  const t = P.parseTaskLine(STAMPED); t.dirty = true;
  assert.strictEqual(P.fmtTask(t), STAMPED.replace(' — ', ' -- ')); // a rewritten line takes the v3 separator
});
{
  const tmp = path.join(os.tmpdir(), `stamp-test-${process.pid}.md`);
  const withFile = (text, fn) => { fs.writeFileSync(tmp, text); try { return fn(new P.NoteFile(tmp, { doneHeading: '## Done' })); } finally { fs.unlinkSync(tmp); } };
  const now = P.stampNow();
  ok('addTask writes created + updated = now', () => withFile('# W\n\n## Done\n', f => {
    const t = f.addTask({ title: 'New one' }); f.save();
    assert.ok(fs.readFileSync(tmp, 'utf8').includes(`- [ ] New one <!-- c:${t.created} u:${t.updated} -->`));
    assert.strictEqual(t.created.slice(0, 13), now.slice(0, 13));
  }));
  ok('complete / Now / priority / subtask tick each set u; created is kept', () => withFile(STAMPED + '\n\t- [ ] Sub\n\n## Done\n', f => {
    const id = f.id(f.tasks[0]);
    f.toggleActive(id); assert.strictEqual(f.tasks[0].updated.slice(0, 13), now.slice(0, 13));
    f.tasks[0].updated = '2000-01-01T00:00'; f.toggleSubtask(f.id(f.tasks[0]), 'Sub'); assert.notStrictEqual(f.tasks[0].updated, '2000-01-01T00:00');
    f.tasks[0].updated = '2000-01-01T00:00'; f.update(f.id(f.tasks[0]), { priority: '!!!' }); assert.notStrictEqual(f.tasks[0].updated, '2000-01-01T00:00');
    f.tasks[0].updated = '2000-01-01T00:00'; f.complete(f.id(f.tasks[0])); assert.notStrictEqual(f.tasks[0].updated, '2000-01-01T00:00');
    assert.strictEqual(f.tasks[0].created, '2026-09-20T09:00');
  }));
  ok('a save that changes nothing leaves u alone (no false edit)', () => withFile(STAMPED + '\n', f => {
    const t = f.tasks[0]; f.update(f.id(t), { title: t.title, priority: t.priority }); f.setNotes(f.id(t), []);
    assert.strictEqual(t.updated, '2026-09-21T10:30');
  }));
  ok('reorder is position, not content: no stamp', () => withFile('- [ ] A <!-- u:2026-09-21T10:30 -->\n- [ ] B\n', f => {
    f.moveTask(f.id(f.tasks[1]), 'up');
    assert.deepStrictEqual(f.tasks.map(t => [t.title, t.updated]), [['B', null], ['A', '2026-09-21T10:30']]);
  }));
}

console.log('icon — valid PNG bytes');
ok('PNG signature + IHDR size', () => {
  const png = makePngBuffer(32);
  assert.deepStrictEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.strictEqual(png.readUInt32BE(16), 32);
  assert.strictEqual(png.readUInt32BE(20), 32);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
