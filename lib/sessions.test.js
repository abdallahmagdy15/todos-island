'use strict';
// Sessions self-check: node lib/sessions.test.js — the Claude CURRENT-name rules (owner 2026-10-29)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sessions = require('./sessions.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ti-sessions-'));
  const proj = path.join(home, '.claude', 'projects', 'p1');
  fs.mkdirSync(proj, { recursive: true });
  const write = (name, lines) => fs.writeFileSync(path.join(proj, name), lines.join('\n') + '\n');
  const filler = n => Array.from({ length: n }, (_, i) => JSON.stringify({ type: 'assistant', i, pad: 'f'.repeat(80) }));

  console.log('sessions — Claude names');
  write('abc123.jsonl', [
    JSON.stringify({ type: 'user', cwd: 'C:\\x', message: { content: 'first prompt' } }),
    ...filler(3000), // ~300 KB: pushes the titles far past the 64 KB head
    JSON.stringify({ type: 'custom-title', customTitle: 'Old name' }),
    ...filler(10),
    JSON.stringify({ type: 'custom-title', customTitle: 'New name' })
  ]);
  const one = await sessions.recentSessions('claude', home); // recentSessions is async (opencode shells out)
  ok('the name = the LAST custom-title, even when it sits far past the head', () => {
    assert.strictEqual(one.length, 1);
    assert.strictEqual(one[0].name, 'New name');
    assert.strictEqual(one[0].dir, 'C:\\x');
  });
  ok('claudeTitle finds one session by id; an unknown id is \'\'', () => {
    assert.strictEqual(sessions.claudeTitle(home, 'abc123'), 'New name');
    assert.strictEqual(sessions.claudeTitle(home, 'nope'), '');
  });
  write('long.jsonl', [JSON.stringify({ type: 'user', cwd: 'C:\\x', message: { content: 'p' } }), JSON.stringify({ type: 'custom-title', customTitle: 'L'.repeat(130) })]);
  const two = await sessions.recentSessions('claude', home);
  ok('a 130-char title comes back 120 chars', () => {
    assert.strictEqual(sessions.claudeTitle(home, 'long').length, 120);
    assert.strictEqual(two.find(s => s.id === 'long').name.length, 120);
  });
  ok('a file with no custom-title shows its first prompt', () => {
    write('plain.jsonl', [JSON.stringify({ type: 'user', cwd: 'C:\\y', message: { content: 'just a prompt' } })]);
    assert.strictEqual(sessions.claudeTitle(home, 'plain'), 'just a prompt');
  });

  fs.rmSync(home, { recursive: true, force: true });
  console.log(`\nsessions: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
