'use strict';
const assert = require('assert');
const B = require('./backup.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

const DEFAULTS = { workIntervalMin: 60, shortcut: 'Control+`', soundOn: true, workPath: 'C:\\x\\work.md' };
const link = { type: 'link', url: 'https://example.com/a', name: 'a' };

ok('round trip: export → JSON → import gives the same settings and attachments', () => {
  const state = { settings: { ...DEFAULTS, workIntervalMin: 45 }, attachments: { k3x9q2: [link] } };
  const back = B.readBackup(JSON.parse(JSON.stringify(B.makeBackup(state, '1.25.0'))), DEFAULTS);
  assert.deepStrictEqual(back.settings, state.settings);
  assert.deepStrictEqual(back.attachments, state.attachments);
});
ok('import keeps only known keys with the default type; bad attachments are dropped', () => {
  const back = B.readBackup({ app: B.TAG, settings: { workIntervalMin: '5', soundOn: false, evil: 1, shortcut: 'Alt+Q' },
    attachments: { a1: [link, { type: 'file', path: 'relative\\x' }], a2: [{ type: 'exe', path: 'C:\\x' }], a3: 'nope' } }, DEFAULTS);
  assert.deepStrictEqual(back.settings, { soundOn: false, shortcut: 'Alt+Q' });
  assert.deepStrictEqual(Object.keys(back.attachments), ['a1']);
  assert.strictEqual(back.attachments.a1.length, 1);
});
ok('a file that is not ours, or holds nothing usable, is refused', () => {
  assert.strictEqual(B.readBackup({ settings: { soundOn: false } }, DEFAULTS).error, 'not-ours');
  assert.strictEqual(B.readBackup(null, DEFAULTS).error, 'not-ours');
  assert.strictEqual(B.readBackup({ app: B.TAG, settings: { nope: 1 } }, DEFAULTS).error, 'empty');
});
ok('file name carries the date', () => assert.strictEqual(B.fileName(new Date('2026-10-10T12:00:00Z')), 'todos-island-settings-2026-10-10.json'));

console.log(`backup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
