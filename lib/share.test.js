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
    '*In progress*', '# Fix the sync bug', '_Sometimes fails on retry_', '* Add a test', '* ~Reproduce~', '',
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
ok('each task as the note has it (open subtasks first), a blank line after each task, Work then Personal, done → Now → open', () => {
  assert.strictEqual(buildShare({ groups, fmt: 'md', date: '29 Sep' }), [
    '## Work · 29 Sep', '',
    '- [x] ! — Send the report', '',
    '- [ ] * !! 30 Sep — Fix the sync bug', '\tSometimes fails on retry', '\t- [ ] ! — Add a test', '\t- [x] Reproduce', '',
    '- [ ] 2 Oct — Plan the sprint',
    '',
    '## Personal · 29 Sep', '',
    '- [ ] Gym', ''
  ].join('\n'));
});
ok('Markdown keeps priority + dates unless turned off; off strips only those leading tokens', () => {
  assert.strictEqual(buildShare({ groups, fmt: 'md', date: '29 Sep', withPrio: true, withDates: true }), buildShare({ groups, fmt: 'md', date: '29 Sep' }));
  const g = [{ name: 'Work', done: [report], now: [fix], open: [plan, gym] }];
  const noPrio = buildShare({ groups: g, fmt: 'md', date: '1 Oct', withPrio: false });
  assert.ok(noPrio.includes('- [x] Send the report') && noPrio.includes('- [ ] * 30 Sep — Fix the sync bug') && noPrio.includes('\t- [ ] Add a test'), noPrio);
  const noDates = buildShare({ groups: g, fmt: 'md', date: '1 Oct', withDates: false });
  assert.ok(noDates.includes('- [ ] * !! — Fix the sync bug') && noDates.includes('- [ ] Plan the sprint') && noDates.includes('\t- [ ] ! — Add a test'), noDates);
  const bare = buildShare({ groups: g, fmt: 'md', date: '1 Oct', withPrio: false, withDates: false });
  assert.ok(bare.includes('- [ ] * — Fix the sync bug') && bare.includes('- [ ] Gym') && bare.includes('\tSometimes fails on retry'), bare);
  const noSep = { title: 'N', lines: ['- [ ] !! 3 Oct Bare line', '\t- [ ] !! old sub'] };
  const ns = buildShare({ groups: [{ name: 'W', open: [noSep] }], fmt: 'md', date: '1 Oct', withDates: false });
  assert.ok(ns.includes('- [ ] !! Bare line') && ns.includes('\t- [ ] !! old sub\n'), ns); // no separator invented, untouched sub
  const v3 = { title: 'T', lines: ['- [ ] /now !!! 3 Oct -- Ship **it**'] };
  assert.ok(buildShare({ groups: [{ name: 'W', now: [v3] }], fmt: 'md', date: '1 Oct', withPrio: false, withDates: false }).includes('- [ ] /now -- Ship **it**'));
});

console.log('share — subtasks toggle');
ok('withSubs off drops subtasks in both formats; notes and tasks stay; default is on', () => {
  const g = [{ name: 'Work', now: [fix] }];
  const text = buildShare({ groups: g, fmt: 'text', date: '1 Oct', withSubs: false });
  assert.ok(!/^\* /m.test(text) && text.includes('# Fix the sync bug') && text.includes('_Sometimes fails on retry_'), text);
  const mdOff = buildShare({ groups: g, fmt: 'md', date: '1 Oct', withSubs: false });
  assert.ok(!/^[\t ]+- \[[ x]\]/m.test(mdOff) && mdOff.includes(fix.lines[0]), mdOff);
  assert.strictEqual(buildShare({ groups: g, fmt: 'md', date: '1 Oct' }), buildShare({ groups: g, fmt: 'md', date: '1 Oct', withSubs: true }));
  assert.ok(/^\* /m.test(buildShare({ groups: g, fmt: 'text', date: '1 Oct' })));
});

ok('subtasks "open" leaves done ones out in both formats; "all" lists open before done in note order', () => {
  const t = { title: 'Mixed', notes: [], lines: ['- [ ] Mixed', '\t- [x] a done', '\t- [ ] b open', '\t- [x] c done', '\t- [ ] d open'],
    subs: [{ t: 'a done', done: true }, { t: 'b open', done: false }, { t: 'c done', done: true }, { t: 'd open', done: false }] };
  const g = [{ name: 'W', open: [t] }];
  assert.ok(buildShare({ groups: g, fmt: 'md', date: '1 Oct' }).includes('- [ ] Mixed\n\t- [ ] b open\n\t- [ ] d open\n\t- [x] a done\n\t- [x] c done'));
  assert.ok(buildShare({ groups: g, fmt: 'text', date: '1 Oct' }).includes('# Mixed\n* b open\n* d open\n* ~a done~\n* ~c done~'));
  const mdOpen = buildShare({ groups: g, fmt: 'md', date: '1 Oct', withSubs: 'open' });
  assert.ok(mdOpen.includes('- [ ] Mixed\n\t- [ ] b open\n\t- [ ] d open\n') && !mdOpen.includes('done'), mdOpen);
  const txOpen = buildShare({ groups: g, fmt: 'text', date: '1 Oct', withSubs: 'open' });
  assert.ok(txOpen.endsWith('# Mixed\n* b open\n* d open') && !txOpen.includes('done'), txOpen);
  assert.strictEqual(buildShare({ groups: g, fmt: 'md', date: '1 Oct', withSubs: 'off' }), buildShare({ groups: g, fmt: 'md', date: '1 Oct', withSubs: false }));
});

console.log('share — one task (island quick copy)');
ok('taskText: Markdown = the block as written, plain = the "# " shape', () => {
  assert.strictEqual(taskText(fix, 'md'), [fix.lines[0], fix.lines[1], fix.lines[3], fix.lines[2]].join('\n') + '\n'); // open subtask first
  assert.strictEqual(taskText(fix, 'text'), '# Fix the sync bug\n_Sometimes fails on retry_\n* Add a test\n* ~Reproduce~');
  assert.strictEqual(taskText(report, 'text'), '# ~Send the report~');
  assert.strictEqual(buildShare({ groups, fmt: 'wa', date: '1 Oct' }), buildShare({ groups, fmt: 'text', date: '1 Oct' })); // legacy name
  // the island copy follows the Share options (owner 2026-09-30)
  assert.strictEqual(taskText(fix, 'text', { withSubs: 'open', withPrio: true, withDates: true }), '# Fix the sync bug · !! · 30 Sep\n_Sometimes fails on retry_\n* Add a test · !');
  assert.strictEqual(taskText(fix, 'md', { withSubs: 'off', withDates: false }), '- [ ] * !! — Fix the sync bug\n\tSometimes fails on retry\n');
});

console.log('share — day filter (#12, and the copy list\'s Today #5)');
const { trimTask, dayRange } = require('./share.js');
const day5 = dayRange(new Date(2026, 9, 5)), day4 = dayRange(new Date(2026, 9, 4));
const sync = {
  title: 'Fix the sync bug', priority: '!!', dueText: null, notes: [], updatedTs: new Date(2026, 9, 5, 14, 2).getTime(),
  subs: [{ t: 'Reproduce', done: true, c: '2026-10-01T09:00', u: '2026-10-05T11:40' }, { t: 'Add a test', done: false, c: '2026-10-05T09:12', u: '2026-10-05T09:12' },
    { t: 'Root-cause note', done: false, c: '2026-10-03T10:00', u: '2026-10-03T10:00' }, { t: 'Old', done: false, c: null, u: null }],
  lines: ['- [ ] !! -- Fix the sync bug', '\tSometimes fails', '\t- [x] Reproduce', '\t- [ ] Add a test', '\t- [ ] Root-cause note', '\t- [ ] Old']
};
const idle = { title: 'Idle task', notes: [], subs: [{ t: 'x', done: false, c: '2026-09-01T09:00', u: '2026-09-01T09:00' }], updatedTs: new Date(2026, 8, 1).getTime(), lines: ['- [ ] Idle task', '\t- [ ] x'] };
const doneOld = { title: 'Ship v1', isDone: true, notes: [], subs: [], updatedTs: new Date(2026, 9, 3, 12).getTime(), lines: ['- [x] Ship v1'] };
const doneToday = { ...doneOld, title: 'Ship v2', updatedTs: new Date(2026, 9, 5, 16).getTime(), lines: ['- [x] Ship v2'] };
ok('day filter: OPEN is the present — an open task and its open subtasks always stay, however old (owner 2026-10-06)', () => {
  assert.strictEqual(trimTask(idle, { day: day5 }), idle);
  const t = trimTask(sync, { day: day5 });
  assert.deepStrictEqual(t.subs.map(s => s.t), ['Reproduce', 'Add a test', 'Root-cause note', 'Old']); // Reproduce ticked on 5 Oct
  assert.strictEqual(trimTask(sync, {}), sync); // no filter = untouched
});
ok('day filter: done subtasks only when ticked in the range; done tasks only when done in the range', () => {
  const t = trimTask(sync, { day: day4 });
  assert.deepStrictEqual(t.subs.map(s => s.t), ['Add a test', 'Root-cause note', 'Old']); // Reproduce was ticked on the 5th
  assert.deepStrictEqual(t.lines, ['- [ ] !! -- Fix the sync bug', '\tSometimes fails', '\t- [ ] Add a test', '\t- [ ] Root-cause note', '\t- [ ] Old']);
  assert.strictEqual(trimTask(doneOld, { day: day5 }), null);
  assert.strictEqual(trimTask(doneToday, { day: day5 }), doneToday);
  assert.strictEqual(trimTask(doneOld, { day: dayRange(new Date(2026, 9, 3), new Date(2026, 9, 5)) }), doneOld);
});
ok('buildShare with a day: open work always, done work of that day only — plain text and Markdown', () => {
  const g = [{ name: 'Work', done: [doneOld, doneToday], now: [sync], open: [idle] }];
  const out = buildShare({ groups: g, fmt: 'text', date: '4 Oct', day: day4 });
  assert.ok(!out.includes('Ship') && !out.includes('Reproduce') && out.includes('# Idle task') && out.includes('* Add a test'), out);
  const md = buildShare({ groups: g, fmt: 'md', date: '5 Oct', day: day5 });
  assert.ok(md.includes('Ship v2') && !md.includes('Ship v1') && md.includes('Idle task') && md.includes('\t- [x] Reproduce'), md);
});
ok('subtasks: open first, then done, each newest first (unstamped after, in note order)', () => {
  assert.strictEqual(taskText(sync, 'text'), '# Fix the sync bug\n* Add a test\n* Root-cause note\n* Old\n* ~Reproduce~');
  const t = { title: 'T', notes: [], lines: ['- [ ] T', '\t- [ ] a', '\t- [ ] b', '\t- [x] c', '\t- [ ] d'],
    subs: [{ t: 'a', done: false, c: '2026-10-01T09:00' }, { t: 'b', done: false, c: '2026-10-04T09:00', u: '2026-10-05T09:00' }, { t: 'c', done: true, u: '2026-10-05T10:00' }, { t: 'd', done: false }] };
  assert.strictEqual(taskText(t, 'md'), '- [ ] T\n\t- [ ] b\n\t- [ ] a\n\t- [ ] d\n\t- [x] c\n');
  assert.strictEqual(taskText(t, 'text', { withSubs: 'open' }), '# T\n* b\n* a\n* d');
});
ok('activity = the newest created/updated time of the task or any subtask', () => {
  const { activity } = require('./share.js');
  assert.strictEqual(activity(idle), new Date(2026, 8, 1, 9).getTime());
  assert.strictEqual(activity(sync), new Date(2026, 9, 5, 14, 2).getTime());
  assert.strictEqual(activity({ updatedTs: 0, subs: [{ u: '2026-10-06T08:00' }] }), new Date(2026, 9, 6, 8).getTime());
  assert.strictEqual(activity({ subs: [] }), 0);
});
ok('taskText: open subtasks only (withSubs), and a day', () => {
  assert.strictEqual(taskText(sync, 'text', { withSubs: 'open' }), '# Fix the sync bug\n* Add a test\n* Root-cause note\n* Old');
  assert.strictEqual(taskText(sync, 'text', { withSubs: 'open', day: day5 }), '# Fix the sync bug\n* Add a test\n* Root-cause note\n* Old');
  assert.strictEqual(taskText(idle, 'text', { day: day5 }), '# Idle task\n* x');
  assert.strictEqual(taskText(doneOld, 'text', { day: day5 }), '');
});

console.log(`\nshare: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
