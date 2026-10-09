'use strict';
// Self-check: node lib/attach.test.js — what counts as a valid attachment, and what a click runs.
const assert = require('assert');
const A = require('./attach.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}

console.log('attach — clean + plan');
ok('a terminal session resumes the exact session in its folder', () => {
  const a = A.clean({ type: 'session', tool: 'claude', mode: 'terminal', id: '7b0d5a9e-1075-45c7-94ea-750f183e8677', dir: 'D:\\work\\report', name: ' report  script ' });
  assert.strictEqual(a.name, 'report script');
  assert.strictEqual(A.plan(a).cmd, '/d /c start "" /D "D:\\work\\report" cmd.exe /K claude --resume 7b0d5a9e-1075-45c7-94ea-750f183e8677');
  assert.match(A.plan({ ...a, tool: 'codex' }).cmd, /cmd\.exe \/K codex resume 7b0d/);
  assert.match(A.plan({ ...a, tool: 'opencode', id: 'ses_ee73ee195ffej6sx' }).cmd, /cmd\.exe \/K opencode \. -s ses_ee73ee195ffej6sx$/);
});
ok('a desktop session opens the app and copies the name', () => {
  const a = A.clean({ type: 'session', tool: 'codex', mode: 'desktop', id: '019c9283-1a56', dir: 'D:\\x', name: 'chart colors' });
  assert.deepStrictEqual(A.plan(a), { app: 'codex', copy: 'chart colors' });
});
ok('nothing that could run a different command gets in', () => {
  const s = { type: 'session', tool: 'claude', mode: 'terminal', dir: 'D:\\x' };
  assert.strictEqual(A.clean({ ...s, id: 'abc & del *' }), null);
  assert.strictEqual(A.clean({ ...s, id: '1234', dir: 'D:\\x" & calc "' }), null);
  assert.strictEqual(A.clean({ ...s, id: '1234', dir: 'D:\\%PATH%' }), null);
  assert.strictEqual(A.clean({ ...s, id: '1234', tool: 'bash' }), null);
  assert.strictEqual(A.clean({ type: 'link', url: 'javascript:alert(1)' }), null);
  assert.strictEqual(A.clean({ type: 'link', url: 'file:///C:/x' }), null);
  assert.strictEqual(A.clean({ type: 'file', path: 'relative\\x.txt' }), null);
  assert.strictEqual(A.clean({ type: 'macro', path: 'D:\\x' }), null);
});
ok('paths and links: names; VS Code / cmd types are gone', () => {
  assert.strictEqual(A.clean({ type: 'file', path: 'D:\\work\\numbers-Q3.xlsx' }).name, 'numbers-Q3.xlsx');
  assert.deepStrictEqual(A.plan(A.clean({ type: 'folder', path: 'D:\\work\\' })), { open: 'D:\\work\\' });
  assert.strictEqual(A.clean({ type: 'vscode', path: 'D:\\work' }), null);
  assert.strictEqual(A.clean({ type: 'shell', path: 'D:\\work' }), null);
  const l = A.clean({ type: 'link', url: 'https://github.com/a/b/issues/214' });
  assert.deepStrictEqual([l.name, A.plan(l).external], ['github.com/a/b/issues/214', 'https://github.com/a/b/issues/214']);
});

console.log(`attach: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
