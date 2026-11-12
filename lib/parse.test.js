'use strict';
// Self-check: node lib/parse.test.js — asserts parsing, byte-identical round-trip on the REAL notes,
// migration formatting, and file ops on a scratch copy. Exits non-zero on any failure.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('./parse.js');
const IMG = require('./images.js');
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
ok('move a subtask: tick, bangs, c stamp and nested lines travel; other lines stay byte-identical', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-submove.md');
  require('fs').writeFileSync(tmp, ['- [ ] Alpha', '\t- [x] !! Step A <!-- c:2026-10-01T09:00 u:2026-10-02T09:00 -->', '\t\tnote under A',
    '\t\t- [ ] nested A1', '\t- [ ] Step B', '', '', '- [ ] Beta', '  description', '    - [ ] Beta one', '', '', '- [ ] Gamma', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  const [alpha, beta] = nf.topTasks().map(t => nf.id(t));
  const taken = nf.takeSubtask(alpha, 'Step A');
  assert.strictEqual(taken.length, 3); // the subtask + its note + its nested item
  assert.strictEqual(nf.putSubtask(beta, taken), true);
  const lines = nf.text().split('\n');
  assert.match(lines[0], /^- \[ \] Alpha <!-- id:[a-z0-9]+ u:\S+ -->$/); // the source parent changed: u
  assert.strictEqual(lines[1], '\t- [ ] Step B'); // the sibling is byte-identical
  const at = lines.indexOf('    - [ ] Beta one');
  assert.ok(at > 0, nf.text());
  assert.match(lines[at + 1], /^\t- \[x\] !! -- Step A <!-- id:[a-z0-9]+ c:2026-10-01T09:00 u:\S+ -->$/); // tick + bangs + c kept, u new
  assert.strictEqual(lines[at + 2], '\t\tnote under A');
  assert.strictEqual(lines[at + 3], '\t\t- [ ] nested A1');
  assert.strictEqual(nf.takeSubtask(alpha, 'Nope'), null);
  const gammaFirst = nf.topTasks()[2]; // a target with no subtasks
  assert.strictEqual(nf.putSubtask(nf.id(gammaFirst), nf.takeSubtask(alpha, 'Step B')), true);
  assert.deepStrictEqual(nf.subtasksOf(nf.topTasks()[2]).map(s => s.title), ['Step B']);
  assert.deepStrictEqual(nf.subtasksOf(nf.topTasks()[0]), []);
});
ok('sortSubtasks: open subtasks first in the note, nested lines travel, descriptions stay, lines byte-identical', () => {
  const tmp = require('path').join(require('os').tmpdir(), 'ti-test-subsort.md');
  require('fs').writeFileSync(tmp, ['- [ ] Alpha', '\tnote line', '\t- [x] Done one <!-- u:2026-10-01T09:00 -->', '\t\tunder done one',
    '\t- [ ] !! Open one', '\t- [x] Done two', '\t- [ ] Open two', '', '- [ ] Beta', '\t- [ ] Already open', '\t- [x] Then done', ''].join('\n'));
  const nf = new P.NoteFile(tmp, { fileTag: 't' });
  assert.strictEqual(nf.sortSubtasks(), true);
  assert.deepStrictEqual(nf.text().split('\n'), ['- [ ] Alpha', '\tnote line', '\t- [ ] !! Open one', '\t- [ ] Open two',
    '\t- [x] Done one <!-- u:2026-10-01T09:00 -->', '\t\tunder done one', '\t- [x] Done two', '', '- [ ] Beta', '\t- [ ] Already open', '\t- [x] Then done', '']);
  assert.strictEqual(nf.sortSubtasks(), false); // already sorted: nothing to write
});
ok('move a subtask across two notes', () => {
  const os = require('os'), path = require('path'), fs = require('fs');
  const a = path.join(os.tmpdir(), 'ti-test-move-a.md'), b = path.join(os.tmpdir(), 'ti-test-move-b.md');
  fs.writeFileSync(a, ['- [ ] Work task', '\t- [ ] Call Sam', ''].join('\n'));
  fs.writeFileSync(b, ['- [ ] Home task', ''].join('\n'));
  const A = new P.NoteFile(a, { fileTag: 'work' }), B = new P.NoteFile(b, { fileTag: 'personal' });
  assert.strictEqual(B.putSubtask(B.id(B.topTasks()[0]), A.takeSubtask(A.id(A.topTasks()[0]), 'Call Sam')), true);
  A.save(); B.save();
  assert.ok(!fs.readFileSync(a, 'utf8').includes('Call Sam'));
  assert.match(fs.readFileSync(b, 'utf8'), /^- \[ \] Home task <!-- id:[a-z0-9]+ u:\S+ -->\n\t- \[ \] Call Sam <!-- id:[a-z0-9]+ u:\S+ -->\n$/);
});
ok('move a whole task across two notes: block + ids + stamps travel byte-identical, Done untouched, other lines stay', () => {
  const os = require('os'), path = require('path'), fs = require('fs');
  const a = path.join(os.tmpdir(), 'ti-test-movetask-a.md'), b = path.join(os.tmpdir(), 'ti-test-movetask-b.md');
  const block = ['- [ ] !! 28 Sep -- Ship it <!-- id:aaa111 c:2026-10-01T09:00 u:2026-10-02T09:00 -->', '\tsome notes', '\t- [x] Step <!-- id:bbb222 u:2026-10-02T09:00 -->'];
  fs.writeFileSync(a, ['# Work', '- [ ] Stays <!-- id:ccc333 -->', '', '', ...block, '', '', '## Done', '- [x] Old <!-- id:ddd444 -->', ''].join('\n'));
  fs.writeFileSync(b, ['- [ ] Home task <!-- id:eee555 -->', ''].join('\n'));
  const A = new P.NoteFile(a, { fileTag: 'work', doneHeading: '## Done' }), B = new P.NoteFile(b, { fileTag: 'personal' });
  const t = A.topTasks().find(x => x.title === 'Ship it');
  assert.strictEqual(B.putTask(A.takeTask(A.id(t))), true);
  A.save(); B.save();
  const at = fs.readFileSync(a, 'utf8'), bt = fs.readFileSync(b, 'utf8');
  assert.ok(!at.includes('Ship it') && !at.includes('some notes') && !at.includes('Step'));
  assert.ok(at.includes('- [ ] Stays <!-- id:ccc333 -->') && at.includes('## Done\n- [x] Old <!-- id:ddd444 -->'));
  assert.ok(bt.startsWith('- [ ] Home task <!-- id:eee555 -->\n'));
  assert.ok(bt.includes(block.join('\n')), bt); // every line as it was: no stamp, no re-format
  assert.deepStrictEqual(B.topTasks().map(x => x.uid), ['eee555', 'aaa111']);
  assert.strictEqual(A.takeTask('nope'), null);
  fs.unlinkSync(a); fs.unlinkSync(b);
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
  assert.match(line(3), /^\t- \[ \] ! -- New one <!-- id:[a-z0-9]+ c:\d{4}-\d\d-\d\dT\d\d:\d\d u:\d{4}-\d\d-\d\dT\d\d:\d\d -->$/);
  assert.strictEqual(line(1), '\t- [ ] Old one'); // untouched: no stamp invented
  nf.toggleSubtask(id, 'Old one');
  assert.match(line(1), /^\t- \[x\] Old one <!-- id:[a-z0-9]+ u:\S+ -->$/); // no invented c, u = when ticked
  assert.strictEqual(line(2), '\t- [ ] Old two');
  nf.renameSubtask(id, 'Old two', 'Old two renamed');
  assert.match(line(2), /Old two renamed <!-- id:[a-z0-9]+ u:\S+ -->$/);
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
  assert.ok(/## Done\n- \[x\] Task <!-- id:[a-z0-9]+ u:\S+ -->\n\tdesc line\n\t- \[ \] Sub/.test(out), out);
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
  assert.ok(/## Done\n- \[x\] !! 24 Sep -- Parent <!-- id:[a-z0-9]+ u:\S+ -->\n\t- \[ \] Sub one\n+\(none yet\)/.test(out), out);
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
    assert.ok(fs.readFileSync(tmp, 'utf8').includes(`- [ ] New one <!-- id:${t.uid} c:${t.created} u:${t.updated} -->`));
    assert.strictEqual(t.created.slice(0, 13), now.slice(0, 13));
  }));
  ok('add / complete / restore never pile up blank lines before ## Done (owner 2026-10-01)', () => withFile('# W\n\n- [ ] A\n- [ ] B\n\n## Done\n- [x] Old\n', f => {
    const id = title => f.id(f.tasks.find(t => t.title === title));
    for (const n of ['N1', 'N2', 'N3']) { f.addTask({ title: n }); f.complete(id(n)); }
    const plain = () => { f.spaceTasks(); return f.text().replace(/ <!--.*?-->/g, ''); }; // as saved
    assert.strictEqual(plain(), '# W\n\n- [ ] A\n\n\n- [ ] B\n\n\n## Done\n- [x] N3\n\n\n- [x] N2\n\n\n- [x] N1\n\n\n- [x] Old\n');
    f.uncomplete(id('N2')); f.addTask({ title: 'N4' });
    assert.strictEqual(plain(), '# W\n\n- [ ] A\n\n\n- [ ] B\n\n\n- [ ] N2\n\n\n- [ ] N4\n\n\n## Done\n- [x] N3\n\n\n- [x] N1\n\n\n- [x] Old\n');
  }));
  ok('save spaces every task block with 2 blank lines — Open and Done; headings stay; end of file keeps one newline', () => withFile('# W\n\n- [ ] A\n\tnote\n\t- [ ] a1\n- [ ] B\n\n\n\n\n## Done\n- [x] Old\n- [x] Old2\n', f => {
    f.save();
    assert.strictEqual(fs.readFileSync(tmp, 'utf8'), '# W\n\n- [ ] A\n\tnote\n\t- [ ] a1\n\n\n- [ ] B\n\n\n## Done\n- [x] Old\n\n\n- [x] Old2\n');
    f.reload(); f.save(); // a spaced note saves byte-identical
    assert.strictEqual(fs.readFileSync(tmp, 'utf8'), '# W\n\n- [ ] A\n\tnote\n\t- [ ] a1\n\n\n- [ ] B\n\n\n## Done\n- [x] Old\n\n\n- [x] Old2\n');
  }));
  ok('the gap travels with the task: add, complete, restore, move, delete', () => withFile('- [ ] A\n\n\n- [ ] B\n\n\n## Done\n', f => {
    const id = title => f.id(f.tasks.find(t => t.title === title));
    const saved = () => { f.save(); return fs.readFileSync(tmp, 'utf8').replace(/ <!--.*?-->/g, ''); };
    f.addTask({ title: 'C' }); assert.strictEqual(saved(), '- [ ] A\n\n\n- [ ] B\n\n\n- [ ] C\n\n\n## Done\n');
    f.complete(id('B')); assert.strictEqual(saved(), '- [ ] A\n\n\n- [ ] C\n\n\n## Done\n- [x] B\n');
    f.uncomplete(id('B')); assert.strictEqual(saved(), '- [ ] A\n\n\n- [ ] C\n\n\n- [ ] B\n\n\n## Done\n');
    f.moveTask(id('B'), 'up'); assert.strictEqual(saved(), '- [ ] A\n\n\n- [ ] B\n\n\n- [ ] C\n\n\n## Done\n');
    f.deleteTask(id('A')); assert.strictEqual(saved(), '- [ ] B\n\n\n- [ ] C\n\n\n## Done\n');
  }));
  ok('a note without a final newline stays without one', () => withFile('- [ ] A\n- [ ] B', f => {
    f.save(); assert.strictEqual(fs.readFileSync(tmp, 'utf8'), '- [ ] A\n\n\n- [ ] B');
  }));
  ok('undo re-insert never lands inside another task (an old index after re-spacing)', () => withFile('- [ ] A\n\t- [ ] a1\n\t- [ ] a2\n- [ ] B\n', f => {
    f.insertBlockAt(1, ['- [ ] X']);
    assert.deepStrictEqual(f.tasks.map(t => t.title), ['A', 'X', 'B']);
    assert.deepStrictEqual(f.subtasksOf(f.tasks[0]).map(s => s.title), ['a1', 'a2']);
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

console.log('parse — hidden ids (owner 2026-10-10)');
ok('ensureIds: every task + subtask gets one, lines otherwise byte-identical, duplicates re-id, a second run changes nothing', () => {
  const tmp = path.join(os.tmpdir(), `ids-test-${process.pid}.md`);
  const src = ['# W', '- [ ] Legacy style — !!', '\t- [ ] Sub <!-- c:2026-09-20T09:00 u:2026-09-21T10:30 -->', '\tdesc',
    '- [x] Copied <!-- id:aaaa11 -->', '- [ ] Copied twin <!-- id:aaaa11 -->', '- [ ] Keep <!-- id:bbbb22 u:2026-09-21T10:30 -->', ''];
  fs.writeFileSync(tmp, src.join('\n'));
  try {
    const f = new P.NoteFile(tmp);
    assert.strictEqual(f.ensureIds(), 3); // Legacy, Sub, the twin
    f.save();
    const out = fs.readFileSync(tmp, 'utf8').split('\n').filter(l => l.trim());
    assert.match(out[1], /^- \[ \] Legacy style — !! <!-- id:[a-z0-9]{6} -->$/); // legacy tokens NOT re-formatted
    assert.match(out[2], /^\t- \[ \] Sub <!-- id:[a-z0-9]{6} c:2026-09-20T09:00 u:2026-09-21T10:30 -->$/); // c/u kept, no new u
    assert.strictEqual(out[3], '\tdesc');
    assert.strictEqual(out[4], '- [x] Copied <!-- id:aaaa11 -->'); // the first keeps its id
    assert.match(out[5], /^- \[ \] Copied twin <!-- id:(?!aaaa11)[a-z0-9]{6} -->$/);
    assert.strictEqual(out[6], '- [ ] Keep <!-- id:bbbb22 u:2026-09-21T10:30 -->');
    const g = new P.NoteFile(tmp);
    assert.deepStrictEqual(g.tasks.map(t => [t.title, t.priority]), [['Legacy style', '!!'], ['Copied', null], ['Copied twin', null], ['Keep', null]]); // ids never leak into titles
    assert.strictEqual(g.ensureIds(), 0);
    assert.strictEqual(g.findByUid('bbbb22').title, 'Keep');
    assert.ok(!g.blockLines(g.tasks[0]).join('\n').includes('id:')); // Share strips it with the stamp
    const shared = new Set(); new P.NoteFile(tmp).ensureIds(shared); // across notes: a second note holding the same ids re-ids them
    assert.strictEqual(new P.NoteFile(tmp).ensureIds(shared), 5); // all 5 lines (4 tasks + 1 subtask)
  } finally { fs.unlinkSync(tmp); }
});
ok('ids survive an edit: a touched line keeps its id; an old line without one gets one on its first touch', () => {
  const tmp = path.join(os.tmpdir(), `ids-touch-${process.pid}.md`);
  fs.writeFileSync(tmp, '- [ ] A <!-- id:cccc33 -->\n- [ ] B\n');
  try {
    const f = new P.NoteFile(tmp);
    f.update(f.id(f.tasks[0]), { title: 'A renamed' }); f.toggleActive(f.id(f.tasks[1])); f.save();
    const g = new P.NoteFile(tmp);
    assert.strictEqual(g.tasks[0].uid, 'cccc33');
    assert.match(g.tasks[1].uid || '', /^[a-z0-9]{6}$/);
  } finally { fs.unlinkSync(tmp); }
});

console.log('parse — subtask phases (owner 2026-10-29)');
ok('#phase: stripped from a subtask title, phase true; case-insensitive; reads with bangs + stamp', () => {
  const t = P.parseTaskLine('\t- [ ] Build the plugin #phase <!-- id:bbb222 c:2026-10-01T09:00 u:2026-10-02T09:00 -->');
  assert.deepStrictEqual([t.title, t.phase, t.subtask, t.uid], ['Build the plugin', true, true, 'bbb222']);
  const up = P.parseTaskLine('\t- [x] Done phase #PHASE');
  assert.deepStrictEqual([up.title, up.phase, up.checked], ['Done phase', true, true]);
  const bang = P.parseTaskLine('\t- [ ] !! -- Ship it #phase');
  assert.deepStrictEqual([bang.title, bang.phase, bang.priority], ['Ship it', true, '!!']);
});
ok('#phase on a top task or mid-title is just text; a bare #phase with no space before it stays', () => {
  const top = P.parseTaskLine('- [ ] Plan #phase');
  assert.deepStrictEqual([top.title, top.phase, top.subtask], ['Plan #phase', false, false]);
  const mid = P.parseTaskLine('\t- [ ] read #phase today');
  assert.deepStrictEqual([mid.title, mid.phase], ['read #phase today', false]);
  assert.strictEqual(P.parseTaskLine('\t- [ ] #phase').phase, false);
});
ok('fmtTask writes " #phase" at the end of the title, before the stamp', () => {
  const t = P.parseTaskLine('\t- [ ] !! -- Build #phase <!-- id:bbb222 -->'); t.dirty = true;
  assert.strictEqual(P.fmtTask(t), '\t- [ ] !! -- Build #phase <!-- id:bbb222 -->');
});
{
  const PHASE_NOTE = ['- [ ] /now !! 4 Nov -- Deploy CRM plugin', '\t- [ ] ask Ahmed about the key', '\t- [ ] Build the plugin #phase',
    '\t\t- [ ] unit tests', '\t\t- [x] fix typo in readme', '\t- [ ] Release to staging #phase', ''].join('\n');
  const tmp = path.join(os.tmpdir(), `phase-test-${process.pid}.md`);
  const withFile = (text, fn) => { fs.writeFileSync(tmp, text); try { return fn(new P.NoteFile(tmp, { fileTag: 't' })); } finally { fs.unlinkSync(tmp); } };
  const bare = l => l.replace(/ <!--.*-->$/, ''); // stamps on changed lines vary
  ok('a note with phases + steps round-trips byte-identical (parse → docToText and NoteFile.text)', () => {
    assert.strictEqual(P.docToText(P.parseDoc(PHASE_NOTE), '\n'), PHASE_NOTE);
    withFile(PHASE_NOTE, f => assert.strictEqual(f.text(), PHASE_NOTE));
  });
  ok('subInfo: first-levels null, steps under their phase', () => withFile(PHASE_NOTE, f => {
    assert.deepStrictEqual(f.subInfo(f.topTasks()[0]).map(x => [x.sub.title, x.under && x.under.title]), [
      ['ask Ahmed about the key', null], ['Build the plugin', null], ['unit tests', 'Build the plugin'],
      ['fix typo in readme', 'Build the plugin'], ['Release to staging', null]
    ]);
  }));
  ok('setPhase on: the tag is written; a step / a miss / a no-op change nothing', () => withFile(PHASE_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.setPhase(id, 'ask Ahmed about the key', true), true);
    assert.match(f.text().split('\n')[1], /^\t- \[ \] ask Ahmed about the key #phase <!-- id:\S+ u:\S+ -->$/);
    assert.strictEqual(f.text().split('\n')[2], '\t- [ ] Build the plugin #phase'); // untouched: raw, byte-identical
    assert.strictEqual(f.setPhase(id, 'ask Ahmed about the key', true), false); // already one
    assert.strictEqual(f.setPhase(id, 'unit tests', true), false); // a step
    assert.strictEqual(f.setPhase(id, 'nope', true), false); // not found
  }));
  ok('setPhase off: the tag goes and the steps outdent one level in place', () => withFile(PHASE_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.setPhase(id, 'Build the plugin', false), true);
    assert.strictEqual(f.setPhase(id, 'Release to staging', false), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] /now !! 4 Nov -- Deploy CRM plugin', '\t- [ ] ask Ahmed about the key', '\t- [ ] Build the plugin',
      '\t- [ ] unit tests', '\t- [x] fix typo in readme', '\t- [ ] Release to staging', ''
    ]);
  }));
  ok('addSubtask: a quick one lands after the last unit, underTitle lands inside that phase\'s unit', () => withFile(PHASE_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    f.addSubtask(id, 'quick note');
    f.addSubtask(id, 'write docs', 'Release to staging');
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] /now !! 4 Nov -- Deploy CRM plugin', '\t- [ ] ask Ahmed about the key', '\t- [ ] Build the plugin #phase',
      '\t\t- [ ] unit tests', '\t\t- [x] fix typo in readme', '\t- [ ] Release to staging #phase',
      '\t\t- [ ] write docs', '\t- [ ] quick note', ''
    ]);
  }));
  ok('nestSubtask / unnestSubtask: Tab joins the nearest phase above, Shift+Tab steps back out after its unit', () => withFile(PHASE_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    f.addSubtask(id, 'quick note');
    assert.strictEqual(f.nestSubtask(id, 'ask Ahmed about the key'), false); // no phase above it
    assert.strictEqual(f.nestSubtask(id, 'Release to staging'), false); // a phase itself
    assert.strictEqual(f.nestSubtask(id, 'quick note'), true);
    let lines = f.text().split('\n');
    assert.match(lines[6], /^\t\t- \[ \] quick note <!-- [^>]*-->$/); // a step of "Release to staging" now
    assert.strictEqual(lines[5], '\t- [ ] Release to staging #phase');
    assert.strictEqual(f.unnestSubtask(id, 'quick note'), true);
    assert.match(f.text().split('\n')[6], /^\t- \[ \] quick note <!-- [^>]*-->$/); // back at first level
    assert.strictEqual(f.unnestSubtask(id, 'Build the plugin'), false); // a first-level, not a step
    assert.strictEqual(f.unnestSubtask(id, 'unit tests'), true); // right AFTER its phase's unit
    lines = f.text().split('\n').map(bare);
    assert.deepStrictEqual(lines.slice(2, 6), ['\t- [ ] Build the plugin #phase', '\t\t- [x] fix typo in readme', '\t- [ ] unit tests', '\t- [ ] Release to staging #phase']);
  }));
  ok('moveUnderPhase: a subtask (or another phase\'s step) joins that phase; same phase / a phase itself refuse', () => withFile(PHASE_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.moveUnderPhase(id, 'Build the plugin', 'Release to staging'), false); // a phase never goes under one
    assert.strictEqual(f.moveUnderPhase(id, 'unit tests', 'Build the plugin'), false); // already in that phase
    assert.strictEqual(f.moveUnderPhase(id, 'ask Ahmed about the key', 'Release to staging'), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare).slice(1), [
      '\t- [ ] Build the plugin #phase', '\t\t- [ ] unit tests', '\t\t- [x] fix typo in readme',
      '\t- [ ] Release to staging #phase', '\t\t- [ ] ask Ahmed about the key', ''
    ]);
  }));
  ok('deleteSubtask of a phase keeps its steps, outdented to first level in place', () => withFile(PHASE_NOTE, f => {
    f.deleteSubtask(f.id(f.topTasks()[0]), 'Build the plugin');
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] /now !! 4 Nov -- Deploy CRM plugin', '\t- [ ] ask Ahmed about the key',
      '\t- [ ] unit tests', '\t- [x] fix typo in readme', '\t- [ ] Release to staging #phase', ''
    ]);
  }));
  ok('putSubtask under a phase: entries land one level under it at the unit\'s end; a phase never goes under a phase', () => {
    const two = ['- [ ] Task A', '\t- [ ] quick A', '', '- [ ] Task B', '\t- [ ] Phase X #phase', '\t\t- [ ] x step', '\t- [ ] after phase', ''].join('\n');
    return withFile(two, f => {
      const [a, b] = f.topTasks();
      const taken = f.takeSubtask(f.id(a), 'quick A');
      assert.strictEqual(f.putSubtask(f.id(b), taken, 'Phase X'), true);
      assert.deepStrictEqual(f.text().split('\n').map(bare).slice(2), [
        '- [ ] Task B', '\t- [ ] Phase X #phase', '\t\t- [ ] x step', '\t\t- [ ] quick A', '\t- [ ] after phase', ''
      ]);
      const phase = f.takeSubtask(f.id(b), 'Phase X'); // its unit: the phase + both steps
      assert.strictEqual(phase.length, 3);
      const mid = f.text();
      assert.strictEqual(f.putSubtask(f.id(a), phase, 'Phase X'), false); // refused — the note and the entries stay as they are
      assert.strictEqual(f.text(), mid);
      assert.strictEqual(f.putSubtask(f.id(b), phase), true); // the caller puts it back plain
      const back = f.text().split('\n').map(bare);
      assert.ok(back.includes('\t- [ ] Phase X #phase') && back.includes('\t\t- [ ] quick A')); // back, steps and all
    });
  });
  const R_NOTE = ['- [ ] T', '\t- [ ] A', '\t\tA own note', '\t- [ ] Build #phase', '\t\t- [ ] unit tests',
    '\t\t- [ ] fix typo', '\t- [ ] C', ''].join('\n');
  ok('reorderSubtask: a first-level subtask lands right before another (C before A)', () => withFile(R_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.reorderSubtask(id, 'C', 'A', null), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] T', '\t- [ ] C', '\t- [ ] A', '\t\tA own note', '\t- [ ] Build #phase',
      '\t\t- [ ] unit tests', '\t\t- [ ] fix typo', ''
    ]);
  }));
  ok('reorderSubtask: a step reordered inside its phase', () => withFile(R_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.reorderSubtask(id, 'fix typo', 'unit tests', 'Build'), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] T', '\t- [ ] A', '\t\tA own note', '\t- [ ] Build #phase', '\t\t- [ ] fix typo',
      '\t\t- [ ] unit tests', '\t- [ ] C', ''
    ]);
  }));
  ok('reorderSubtask: a step dropped among first-level subtasks becomes first-level there', () => withFile(R_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.reorderSubtask(id, 'unit tests', 'C', null), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] T', '\t- [ ] A', '\t\tA own note', '\t- [ ] Build #phase', '\t\t- [ ] fix typo',
      '\t- [ ] unit tests', '\t- [ ] C', ''
    ]);
  }));
  ok('reorderSubtask: a first-level subtask dropped between two steps becomes a step there', () => withFile(R_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.reorderSubtask(id, 'A', 'fix typo', 'Build'), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] T', '\t- [ ] Build #phase', '\t\t- [ ] unit tests', '\t\t- [ ] A', '\t\t\tA own note',
      '\t\t- [ ] fix typo', '\t- [ ] C', ''
    ]);
  }));
  ok('reorderSubtask: first-level to the END of a phase (before null)', () => withFile(R_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.reorderSubtask(id, 'C', null, 'Build'), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] T', '\t- [ ] A', '\t\tA own note', '\t- [ ] Build #phase', '\t\t- [ ] unit tests',
      '\t\t- [ ] fix typo', '\t\t- [ ] C', ''
    ]);
  }));
  ok('reorderSubtask: a phase moves before another first-level subtask WITH its steps', () => withFile(R_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.reorderSubtask(id, 'Build', 'A', null), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] T', '\t- [ ] Build #phase', '\t\t- [ ] unit tests', '\t\t- [ ] fix typo', '\t- [ ] A',
      '\t\tA own note', '\t- [ ] C', ''
    ]);
  }));
  ok('reorderSubtask: a subtask\'s own description line travels with it', () => withFile(R_NOTE, f => {
    const id = f.id(f.topTasks()[0]);
    assert.strictEqual(f.reorderSubtask(id, 'A', 'C', null), true);
    assert.deepStrictEqual(f.text().split('\n').map(bare), [
      '- [ ] T', '\t- [ ] Build #phase', '\t\t- [ ] unit tests', '\t\t- [ ] fix typo', '\t- [ ] A',
      '\t\tA own note', '\t- [ ] C', ''
    ]);
  }));
  ok('reorderSubtask: refusals change nothing (byte-identical note)', () => {
    const note = ['- [ ] T', '\t- [ ] P1 #phase', '\t\t- [ ] s1', '\t- [ ] P2 #phase', '\t\t- [ ] s2', ''].join('\n');
    return withFile(note, f => {
      const id = f.id(f.topTasks()[0]);
      assert.strictEqual(f.reorderSubtask(id, 'P1', 's2', 'P2'), false); // a phase never goes under a phase
      assert.strictEqual(f.reorderSubtask(id, 's1', 's1', 'P1'), false); // before === itself
      assert.strictEqual(f.reorderSubtask(id, 's1', null, 'P1'), false); // no-op: already the last step of P1
      assert.strictEqual(f.reorderSubtask(id, 'P1', 'P2', null), false); // no-op: P1's unit already ends at P2
      assert.strictEqual(f.reorderSubtask(id, 'nope', 'P2', null), false); // unknown subtask
      assert.strictEqual(f.reorderSubtask(id, 's1', null, 'nope'), false); // unknown phase
      assert.strictEqual(f.reorderSubtask(id, 's1', 's2', null), false); // before not in the destination group
      assert.strictEqual(f.text(), note); // nothing moved, nothing stamped
    });
  });
}

console.log('parse — drag a task into another task (owner 2026-10-29)');
ok('a plain line under a subtask is that subtask\'s, not the task\'s description — notesOf / setNotes leave it there', () => {
  const tmp = path.join(os.tmpdir(), `notes-test-${process.pid}.md`);
  fs.writeFileSync(tmp, ['- [ ] Review PR <!-- id:ccc333 -->', '\town desc', '\t- [ ] ! -- Fix login bug <!-- id:bbb222 -->', '\t\tseen on staging', '\t- [ ] Reproduce <!-- id:sub201 -->', ''].join('\n'));
  const f = new P.NoteFile(tmp, { fileTag: 't' }), t = f.topTasks()[0];
  assert.deepStrictEqual(f.notesOf(t), ['own desc']);
  f.setNotes(f.id(t), ['new desc']);
  assert.deepStrictEqual(f.text().split('\n').slice(1, 5).map(l => l.replace(/ <!--.*-->/, '')), ['\tnew desc', '\t- [ ] ! -- Fix login bug', '\t\tseen on staging', '\t- [ ] Reproduce']);
  fs.unlinkSync(tmp);
});
ok('taskToSubtask: the task becomes a first-level subtask, desc one deeper, its subtasks follow flattened', () => {
  const tmp = path.join(os.tmpdir(), `into-test-${process.pid}.md`);
  fs.writeFileSync(tmp, [
    '- [ ] /now !! 4 Nov -- Deploy CRM plugin <!-- id:aaa111 c:2026-10-01T09:00 u:2026-10-02T09:00 -->',
    '\tneeds the key from Ahmed',
    '\t- [ ] Build the plugin #phase <!-- id:bbb222 -->',
    '\t\t- [ ] unit tests <!-- id:ccc333 -->',
    '\t- [ ] Release to staging',
    '', '',
    '- [ ] Q4 roadmap <!-- id:ddd444 -->',
    '\t- [ ] hire support dev',
    '', '',
    '- [x] Old thing', ''
  ].join('\n'));
  const f = new P.NoteFile(tmp, { fileTag: 't' });
  const [a, b, done] = f.topTasks(), aid = f.id(a), bid = f.id(b);
  assert.strictEqual(f.taskToSubtask(aid, aid), false); // itself
  assert.strictEqual(f.taskToSubtask('t#Nope##', bid), false); // missing dragged task
  assert.strictEqual(f.taskToSubtask(aid, 't#Nope##'), false); // missing target
  assert.strictEqual(f.taskToSubtask(aid, f.id(done)), false); // a done target
  assert.strictEqual(f.taskToSubtask(f.id(done), bid), false); // a done dragged task
  const sub = f.taskToSubtask(aid, bid);
  assert.ok(sub);
  assert.deepStrictEqual([sub.title, sub.priority, sub.due, sub.time, sub.active, sub.phase, sub.subtask, sub.uid, sub.created, sub.checked],
    ['Deploy CRM plugin', '!!', null, null, false, false, true, 'aaa111', '2026-10-01T09:00', false]);
  assert.deepStrictEqual(f.topTasks().map(x => x.title), ['Q4 roadmap', 'Old thing']); // A is gone from the top tasks
  const lines = f.text().split('\n');
  assert.match(lines[0], /^- \[ \] Q4 roadmap <!-- id:ddd444 u:\S+ -->$/); // the target: touched (u)
  assert.strictEqual(lines[1], '\t- [ ] hire support dev'); // B's own subtask stays byte-identical, first
  assert.strictEqual(lines[2], '\t- [ ] !! -- Deploy CRM plugin <!-- id:aaa111 c:2026-10-01T09:00 u:' + sub.updated + ' -->'); // exactly what fmtTask writes
  assert.strictEqual(P.fmtTask(sub), lines[2]); // no date, no time, no /now; bangs, id and c kept
  assert.strictEqual(lines[3], '\t\tneeds the key from Ahmed'); // the description: one level under the new subtask
  assert.strictEqual(lines[4], '\t- [ ] Build the plugin #phase <!-- id:bbb222 -->'); // first level now, still a phase
  assert.strictEqual(lines[5], '\t\t- [ ] unit tests <!-- id:ccc333 -->'); // its step keeps its relative indent
  assert.strictEqual(lines[6], '\t- [ ] Release to staging'); // flattened to first level
  assert.strictEqual(lines[7], ''); assert.strictEqual(lines[8], ''); // the TASK_GAP follows the block
  assert.strictEqual(lines[9], '- [x] Old thing');
  f.save();
  assert.deepStrictEqual(fs.readFileSync(tmp, 'utf8').split('\n'), lines); // save re-spaces nothing extra
});

console.log('parse — subtask descriptions (N2, owner 2026-11-08)');
ok('subNotesOf: a sub sees its own lines only — never a step\'s, never the task\'s', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-subnotes.md');
  fs.writeFileSync(tmp, ['- [ ] Big task', '\t- [ ] Plan #phase', '\t\t- [ ] Step one', '\t\t\tstep note', '\t- [ ] Quick sub', '\t\tsub line one', '\t\tsub line two', ''].join('\n'));
  const f = new P.NoteFile(tmp);
  const t = f.topTasks()[0], subs = f.subtasksOf(t);
  assert.deepStrictEqual(f.subNotesOf(t, subs[0]), []); // Plan: the step's note belongs to the step
  assert.deepStrictEqual(f.subNotesOf(t, subs[1]), ['step note']);
  assert.deepStrictEqual(f.subNotesOf(t, subs[2]), ['sub line one', 'sub line two']);
  assert.deepStrictEqual(f.notesOf(t), []); // the task's own description: none of them
});
ok('addSubtask with notes writes them one indent deeper, right under the new line', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-subnotes-add.md');
  fs.writeFileSync(tmp, ['- [ ] Big task', '\t- [ ] Quick sub', ''].join('\n'));
  const f = new P.NoteFile(tmp);
  f.addSubtask(f.id(f.topTasks()[0]), 'New', undefined, ['line 2', '', 'line 3']);
  const lines = f.text().split('\n');
  assert.match(lines[2], /^\t- \[ \] New <!-- id:[a-z0-9]+ c:\S+ u:\S+ -->$/); // after Quick sub's unit (blank lines dropped)
  assert.strictEqual(lines[3], '\t\tline 2');
  assert.strictEqual(lines[4], '\t\tline 3');
  assert.strictEqual(lines[5], ''); // the trailing newline entry
});
ok('setSubNotes: replace, no-change false, clear; steps and their lines stay in place', () => {
  const tmp = path.join(os.tmpdir(), 'ti-test-subnotes-set.md');
  fs.writeFileSync(tmp, ['- [ ] T', '\t- [ ] Plan #phase', '\t\t- [ ] Step', '\t\t\tstep note', '\t- [ ] Q', '\t\told one', '\t\told two', ''].join('\n'));
  const f = new P.NoteFile(tmp);
  const id = f.id(f.topTasks()[0]);
  assert.strictEqual(f.setSubNotes(id, 'Q', ['a', '', 'b']), true);
  let lines = f.text().split('\n');
  assert.match(lines[4], /^\t- \[ \] Q <!-- id:[a-z0-9]+ u:\S+ -->$/); // both the sub and the parent got u
  assert.strictEqual(lines[5], '\t\ta'); assert.strictEqual(lines[6], '\t\tb');
  assert.strictEqual(lines[1], '\t- [ ] Plan #phase'); assert.strictEqual(lines[2], '\t\t- [ ] Step'); assert.strictEqual(lines[3], '\t\t\tstep note'); // untouched
  const before = f.text();
  assert.strictEqual(f.setSubNotes(id, 'Q', ['a', 'b']), false); // same lines: no change, no stamp churn
  assert.strictEqual(f.text(), before);
  assert.strictEqual(f.setSubNotes(id, 'Q', []), true); // clear
  lines = f.text().split('\n');
  assert.strictEqual(lines[5], ''); // the notes are gone; Q is the block's last line again
  assert.strictEqual(f.setSubNotes(id, 'Nope', ['x']), false);
});

console.log('parse — image link lines (E2a, owner 2026-11-12)');
{
  const DIR = 'C:\\Users\\Me X\\AppData\\Roaming\\todos-island\\images';
  ok('addImageLine: a subtask gets it one indent deeper under the sub, a task as its description line', () => {
    const tmp = path.join(os.tmpdir(), 'ti-test-img-add.md');
    fs.writeFileSync(tmp, ['- [ ] T', '\tdesc', '\t- [ ] Q', ''].join('\n'));
    const f = new P.NoteFile(tmp);
    const t = f.topTasks()[0], id = f.id(t);
    assert.strictEqual(f.addImageLine(id, 'Q', IMG.imageLine('img-aaa111', DIR)), true);
    let lines = f.text().split('\n');
    assert.match(lines[2], /^\t- \[ \] Q <!-- id:[a-z0-9]+ u:\S+ -->$/); // a real change: the sub + parent got touched
    assert.strictEqual(lines[3], '\t\t' + IMG.imageLine('img-aaa111', DIR)); // one indent deeper than Q
    f.addImageLine(id, null, IMG.imageLine('img-bbb222', DIR));
    lines = f.text().split('\n');
    assert.strictEqual(lines[1], '\tdesc'); // the task's notes: text first, the image line after it
    assert.strictEqual(lines[2], '\t' + IMG.imageLine('img-bbb222', DIR));
    assert.strictEqual(lines[4], '\t\t' + IMG.imageLine('img-aaa111', DIR)); // the sub's line stayed put
  });
  ok('setSubNotes / setNotes with new text keep the existing image line after the text', () => {
    const tmp = path.join(os.tmpdir(), 'ti-test-img-keep.md');
    fs.writeFileSync(tmp, ['- [ ] T', '\tnote', '\t' + IMG.imageLine('img-ccc333', DIR), '\t- [ ] Q', '\t\t' + IMG.imageLine('img-aaa111', DIR), ''].join('\n'));
    const f = new P.NoteFile(tmp);
    const t = f.topTasks()[0], id = f.id(t), sub = f.subtasksOf(t)[0];
    f.setSubNotes(id, 'Q', ['new text']);
    assert.deepStrictEqual(f.subNotesOf(t, sub), ['new text', IMG.imageLine('img-aaa111', DIR)]);
    f.setNotes(id, ['new note']);
    assert.deepStrictEqual(f.notesOf(t), ['new note', IMG.imageLine('img-ccc333', DIR)]);
  });
  ok('removeImageLine removes it and returns false when the name is not there', () => {
    const tmp = path.join(os.tmpdir(), 'ti-test-img-rm.md');
    fs.writeFileSync(tmp, ['- [ ] T', '\t- [ ] Q', '\t\t' + IMG.imageLine('img-aaa111', DIR), '\t\tkept note', ''].join('\n'));
    const f = new P.NoteFile(tmp);
    const t = f.topTasks()[0], id = f.id(t), sub = f.subtasksOf(t)[0];
    assert.strictEqual(f.removeImageLine(id, 'Q', 'img-zzz999'), false); // not there: nothing written
    assert.strictEqual(f.removeImageLine(id, 'Q', 'img-aaa111'), true);
    assert.deepStrictEqual(f.subNotesOf(t, sub), ['kept note']);
    assert.strictEqual(f.removeImageLine(id, 'Q', 'img-aaa111'), false); // already gone
  });
  ok('a note with an image line round-trips byte-identical', () => {
    const tmp = path.join(os.tmpdir(), 'ti-test-img-roundtrip.md');
    const text = ['- [ ] T', '\t- [ ] Q', '\t\t' + IMG.imageLine('img-aaa111', DIR), ''].join('\n');
    fs.writeFileSync(tmp, text);
    assert.strictEqual(new P.NoteFile(tmp).text(), text);
  });
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
