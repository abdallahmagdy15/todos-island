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

console.log(`\nshare: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
