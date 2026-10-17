'use strict';
const assert = require('assert');
const B = require('./backup.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

const DEFAULTS = { workIntervalMin: 60, shortcut: 'Control+`', soundOn: true, workPath: 'C:\\x\\work.md' };
const link = { type: 'link', url: 'https://example.com/a', name: 'a' };

ok('round trip: export → JSON → import gives the same settings and attachments', () => {
  const state = { settings: { ...DEFAULTS, workIntervalMin: 45 }, attachments: { k3x9q2: [link] }, links: { k3x9q2: 'personal' }, icons: { k3x9q2: 'fix' } };
  const back = B.readBackup(JSON.parse(JSON.stringify(B.makeBackup(state, '1.25.0'))), DEFAULTS);
  assert.deepStrictEqual(back.settings, state.settings);
  assert.deepStrictEqual(back.attachments, state.attachments);
  assert.deepStrictEqual(back.links, state.links);
  assert.deepStrictEqual(back.icons, state.icons);
});
ok('import keeps only well-formed icons (a bad name is dropped)', () => {
  const back = B.readBackup({ app: B.TAG, icons: { k3x9q2: 'fix', 'BAD id': 'fix', aaa111: 'not-an-icon' } }, DEFAULTS);
  assert.deepStrictEqual(back.icons, { k3x9q2: 'fix' });
});
ok('import keeps only well-formed links', () => {
  const back = B.readBackup({ app: B.TAG, links: { k3x9q2: 'work', 'BAD id': 'work', aaa111: 'elsewhere' } }, DEFAULTS);
  assert.deepStrictEqual(back.links, { k3x9q2: 'work' });
});
ok('import keeps only known keys with the default type; bad attachments are dropped', () => {
  const back = B.readBackup({ app: B.TAG, settings: { workIntervalMin: '5', soundOn: false, evil: 1, shortcut: 'Alt+Q' },
    attachments: { a1: [link, { type: 'file', path: 'relative\\x' }], a2: [{ type: 'exe', path: 'C:\\x' }], a3: 'nope' } }, DEFAULTS);
  assert.deepStrictEqual(back.settings, { soundOn: false, shortcut: 'Alt+Q' });
  assert.deepStrictEqual(Object.keys(back.attachments), ['a1']);
  assert.strictEqual(back.attachments.a1.length, 1);
});
ok('text size 5 (3XL) survives import, an out-of-range size is dropped', () => {
  const defs = { ...DEFAULTS, labelSize: 0, taskSize: 1 };
  assert.strictEqual(B.readBackup({ app: B.TAG, settings: { taskSize: 5, labelSize: 4 } }, defs).settings.taskSize, 5);
  assert.strictEqual(B.readBackup({ app: B.TAG, settings: { soundOn: true, taskSize: 6 } }, defs).settings.taskSize, undefined);
});
ok('a paper knob (theme presets, owner 2026-10-18) survives import when the defaults list it', () => {
  const defs = { ...DEFAULTS, ...require('./themes.js').DEFAULTS };
  assert.strictEqual(B.readBackup({ app: B.TAG, settings: { paperHand: 'shantell' } }, defs).settings.paperHand, 'shantell');
});
ok('a file that is not ours, or holds nothing usable, is refused', () => {
  assert.strictEqual(B.readBackup({ settings: { soundOn: false } }, DEFAULTS).error, 'not-ours');
  assert.strictEqual(B.readBackup(null, DEFAULTS).error, 'not-ours');
  assert.strictEqual(B.readBackup({ app: B.TAG, settings: { nope: 1 } }, DEFAULTS).error, 'empty');
});
ok('file name carries the date', () => assert.strictEqual(B.fileName(new Date('2026-10-10T12:00:00Z')), 'todos-island-settings-2026-10-10.json'));

console.log(`backup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
