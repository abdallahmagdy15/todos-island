'use strict';
// Share text self-check: node lib/share.test.js
const assert = require('assert');
const { buildShare, taskText } = require('./share.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

const fix = {
  title: 'Fix the sync bug', priority: '!!', dueText: '30 Sep', notes: ['Sometimes fails on retry'],
  subs: [{ t: 'Reproduce', done: true, p: null }, { t: 'Add a test', done: false, p: '!' }],
  lines: ['- [ ] * !! 30 Sep — Fix the sync bug', '\tSometimes fails on retry', '\t- [x] Reproduce', '\t- [ ] ! — Add a test']
};
const report = { title: 'Send the report', priority: '!', dueText: null, notes: [], subs: [], lines: ['- [x] ! — Send the report'], isDone: true };
const plan = { title: 'Plan the sprint', priority: null, dueText: '2 Oct', notes: [], subs: [], lines: ['- [ ] 2 Oct — Plan the sprint'] };
const gym = { title: 'Gym', priority: null, dueText: null, notes: [], subs: [], lines: ['- [ ] Gym'] };
const groups = [
  { name: 'Work', done: [report], now: [fix], open: [plan] },
  { name: 'Personal', done: [], now: [], open: [gym] }
];

console.log('share — WhatsApp');
ok('grouped by state: each task one "# " line, notes italic, subtasks "* " bullets, no indent, no priority/dates by default', () => {
  assert.strictEqual(buildShare({ groups: [{ ...groups[0], open: [plan, gym] }, groups[1]], fmt: 'wa', date: '29 Sep' }), [
    '*Work · 29 Sep*', '',
    '*Done*', '# ~Send the report~', '',
    '*In progress*', '# Fix the sync bug', '_Sometimes fails on retry_', '* ~Reproduce~', '* Add a test', '',
    '*Next*', '# Plan the sprint', '', '# Gym', '',
    '*Personal · 29 Sep*', '',
    '*Next*', '# Gym'
  ].join('\n'));
  assert.ok(!/^ +\S/m.test(buildShare({ groups, fmt: 'wa', date: '29 Sep' })), 'no indented lines (WhatsApp drops them)');
});
ok('priority and dates only when asked for', () => {
  const t = buildShare({ groups: [groups[0]], fmt: 'wa', date: '29 Sep', withPrio: true, withDates: true });
  assert.ok(t.includes('# ~Send the report~ · !'), t);
  assert.ok(t.includes('# Fix the sync bug · !! · 30 Sep'), t);
  assert.ok(t.includes('\n* Add a test · !'), t);
  assert.ok(t.includes('# Plan the sprint · 2 Oct'), t);
  const d = buildShare({ groups: [groups[0]], fmt: 'wa', date: '29 Sep', withDates: true });
  assert.ok(!d.includes('!!'), d);
});
ok('no Markdown syntax and no emoji in WhatsApp', () => {
  const t = buildShare({ groups, fmt: 'wa', date: '29 Sep', withPrio: true, withDates: true });
  assert.ok(!/\[[ x]\]|^##/m.test(t), t);
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), t);
});
ok('translated headings', () => {
  const t = buildShare({ groups: [groups[0]], fmt: 'wa', date: '29 Sep', labels: { done: 'تم', now: 'قيد العمل', next: 'التالي' } });
  assert.ok(t.includes('*تم*') && t.includes('*قيد العمل*') && t.includes('*التالي*'), t);
});
ok('empty groups and sections are left out', () => {
  assert.strictEqual(buildShare({ groups: [{ name: 'Work' }, groups[1]], fmt: 'wa', date: '1 Oct' }), '*Personal · 1 Oct*\n\n*Next*\n# Gym');
});

ok('the note\'s formatting becomes WhatsApp formatting', () => {
  const t = { title: 'Ship **the API** now', notes: ['check *this* and <u>that</u>'], subs: [{ t: '~~old~~ plan', done: false }, { t: 'call **Sam**', done: true }], lines: [] };
  const out = buildShare({ groups: [{ name: 'Work', now: [t] }], fmt: 'wa', date: '1 Oct' });
  assert.ok(out.includes('# Ship *the API* now'), out);
  assert.ok(out.includes('\n_check this and that_'), out);
  assert.ok(out.includes('\n* ~old~ plan'), out);
  assert.ok(out.includes('\n* ~call *Sam*~'), out);
  const d = buildShare({ groups: [{ name: 'Work', done: [{ title: 'a ~~b~~ c', lines: [] }] }], fmt: 'wa', date: '1 Oct' });
  assert.ok(d.includes('# ~a b c~'), d);
});

console.log('share — Markdown');
ok('each task exactly as the note has it, Work then Personal, done → Now → open', () => {
  assert.strictEqual(buildShare({ groups, fmt: 'md', date: '29 Sep' }), [
    '## Work · 29 Sep',
    '- [x] ! — Send the report',
    '- [ ] * !! 30 Sep — Fix the sync bug', '\tSometimes fails on retry', '\t- [x] Reproduce', '\t- [ ] ! — Add a test',
    '- [ ] 2 Oct — Plan the sprint',
    '',
    '## Personal · 29 Sep',
    '- [ ] Gym', ''
  ].join('\n'));
});
ok('Markdown ignores the WhatsApp options', () => {
  assert.strictEqual(buildShare({ groups, fmt: 'md', date: '29 Sep', withPrio: true }), buildShare({ groups, fmt: 'md', date: '29 Sep' }));
});

console.log('share — one task (island quick copy)');
ok('taskText: Markdown = the block as written, plain = the "# " shape', () => {
  assert.strictEqual(taskText(fix, 'md'), fix.lines.join('\n') + '\n');
  assert.strictEqual(taskText(fix, 'text'), '# Fix the sync bug\n_Sometimes fails on retry_\n* ~Reproduce~\n* Add a test');
  assert.strictEqual(taskText(report, 'text'), '# ~Send the report~');
  assert.strictEqual(buildShare({ groups, fmt: 'wa', date: '1 Oct' }), buildShare({ groups, fmt: 'text', date: '1 Oct' })); // legacy name
});

console.log('share — day filter (#12) and subtask trim (#5)');
const { trimTask, dayRange } = require('./share.js');
const day5 = dayRange(new Date(2026, 9, 5)), day4 = dayRange(new Date(2026, 9, 4));
const sync = {
  title: 'Fix the sync bug', priority: '!!', dueText: null, notes: [], updatedTs: new Date(2026, 9, 5, 14, 2).getTime(),
  subs: [{ t: 'Reproduce', done: true, c: '2026-10-01T09:00', u: '2026-10-05T11:40' }, { t: 'Add a test', done: false, c: '2026-10-05T09:12', u: '2026-10-05T09:12' },
    { t: 'Root-cause note', done: false, c: '2026-10-03T10:00', u: '2026-10-03T10:00' }, { t: 'Old', done: false, c: null, u: null }],
  lines: ['- [ ] !! -- Fix the sync bug', '\tSometimes fails', '\t- [x] Reproduce', '\t- [ ] Add a test', '\t- [ ] Root-cause note', '\t- [ ] Old']
};
const idle = { title: 'Idle task', notes: [], subs: [{ t: 'x', done: false, c: '2026-09-01T09:00', u: '2026-09-01T09:00' }], updatedTs: new Date(2026, 8, 1).getTime(), lines: ['- [ ] Idle task', '\t- [ ] x'] };
ok('day filter keeps only subtasks added or changed that day; a task with nothing that day is left out', () => {
  const t = trimTask(sync, { day: day5 });
  assert.deepStrictEqual(t.subs.map(s => s.t), ['Reproduce', 'Add a test']);
  assert.deepStrictEqual(t.lines, ['- [ ] !! -- Fix the sync bug', '\tSometimes fails', '\t- [x] Reproduce', '\t- [ ] Add a test']);
  assert.strictEqual(trimTask(idle, { day: day5 }), null);
  assert.strictEqual(trimTask(sync, {}), sync); // no filter = untouched
});
ok('a task changed that day stays even with no subtask that day; ranges span days', () => {
  const noSubs = { title: 'Send report', notes: [], subs: [], updatedTs: new Date(2026, 9, 5, 16).getTime(), lines: ['- [x] Send report'] };
  assert.deepStrictEqual(trimTask(noSubs, { day: day5 }).subs, []);
  const r = trimTask(sync, { day: dayRange(new Date(2026, 9, 3), new Date(2026, 9, 5)) });
  assert.deepStrictEqual(r.subs.map(s => s.t), ['Reproduce', 'Add a test', 'Root-cause note']);
  assert.strictEqual(trimTask({ ...sync, updatedTs: 0 }, { day: day4 }), null);
});
ok('buildShare with a day: plain text and Markdown both trimmed', () => {
  const out = buildShare({ groups: [{ name: 'Work', now: [sync], open: [idle] }], fmt: 'text', date: '5 Oct', day: day5 });
  assert.strictEqual(out, '*Work · 5 Oct*\n\n*In progress*\n# Fix the sync bug\n* ~Reproduce~\n* Add a test');
  const md = buildShare({ groups: [{ name: 'Work', now: [sync], open: [idle] }], fmt: 'md', date: '5 Oct', day: day5 });
  assert.ok(!md.includes('Idle task') && !md.includes('Root-cause') && md.includes('\t- [ ] Add a test'), md);
});
ok('taskText: open subtasks only, and a day', () => {
  assert.strictEqual(taskText(sync, 'text', { subs: 'open' }), '# Fix the sync bug\n* Add a test\n* Root-cause note\n* Old');
  assert.strictEqual(taskText(sync, 'text', { subs: 'open', day: day5 }), '# Fix the sync bug\n* Add a test');
  assert.strictEqual(taskText(idle, 'text', { day: day5 }), '');
});

console.log(`\nshare: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
