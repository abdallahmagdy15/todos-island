'use strict';
// Self-check: node lib/icon-suggest.test.js — the icon picker's Suggested row (M6): title words → ranked icons.
const assert = require('assert');
const S = require('./icon-suggest.js');
const SET = require('./task-icons.js');
const ICONS = SET.flatMap(g => g.icons);
const NAMES = new Set(ICONS.map(i => i.n));
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

ok('every glossary word points at an icon that exists', () => {
  for (const [w, n] of Object.entries(S.GLOSSARY)) assert.ok(NAMES.has(n), w + ' → ' + n);
});
ok('glossary keys are already normalized (so they can match)', () => {
  for (const w of Object.keys(S.GLOSSARY)) assert.strictEqual(S.norm(w), w, w);
});
ok('words(): drops marks, ticket numbers, digits, short and stop words; keeps the meaningful ones', () => {
  assert.deepStrictEqual(S.words('**pending publish** #87893 - Generated contract link in the Quotation'),
    ['pending', 'publish', 'generated', 'contract', 'link', 'quotation']);
  assert.deepStrictEqual(S.words('Fix a bug <!-- id:abc123 -->'), ['fix', 'bug']);
});
ok('Arabic is normalized: the leading ال / وال and ة / أ forms', () => {
  assert.deepStrictEqual(S.words('مراجعة الكود والتقرير'), ['مراجعه', 'كود', 'تقرير']);
});
ok('a glossary word wins: "Swift Business bugs fixes" → fix first', () => {
  assert.strictEqual(S.suggest('Swift Business bugs fixes', ICONS)[0], 'fix');
});
ok('owner titles rank the obvious icon first', () => {
  const first = t => S.suggest(t, ICONS)[0];
  assert.strictEqual(first('Mena integration'), 'api');
  assert.strictEqual(first('Swift Recruitment Cycle'), 'hire');
  assert.strictEqual(first('SwiftDemo : Bank file upload fixes'), 'bank');
  assert.strictEqual(first('post on reddit and linkedin about this todo island'), 'post');
  assert.strictEqual(first('motion video for swiftsoft business sector'), 'motion');
  assert.strictEqual(first('Report to acronis to skip some exe'), 'report');
  assert.ok(S.suggest('Report to acronis to skip some exe', ICONS).includes('antivirus'));
  assert.strictEqual(first('اجتماع مع المدير'), 'meeting');
});
ok('at most n, distinct', () => {
  const s = S.suggest('publish deploy fix bug meeting call email report', ICONS);
  assert.strictEqual(s.length, 3);
  assert.strictEqual(new Set(s).size, 3);
});
ok('a tie goes to the icon used most', () => {
  const t = 'meeting call';
  assert.deepStrictEqual(S.suggest(t, ICONS, { n: 2, counts: { call: 9 } })[0], 'call');
  assert.deepStrictEqual(S.suggest(t, ICONS, { n: 2, counts: { meeting: 9 } })[0], 'meeting');
});
ok('no match → filled with the most-used icons that are NOT in Recent', () => {
  const counts = { deploy: 9, fix: 7, call: 5, gift: 3, coffee: 1 };
  assert.deepStrictEqual(S.suggest('zzzz qqqq', ICONS, { counts, recent: ['deploy', 'call'] }), ['fix', 'gift', 'coffee']);
  assert.deepStrictEqual(S.suggest('', ICONS, { counts: {} }), []); // nothing used yet → nothing to fill with
});
ok('a short match list is topped up by most-used (not in Recent)', () => {
  const s = S.suggest('Mena integration', ICONS, { counts: { gift: 4 }, recent: [] });
  assert.strictEqual(s[0], 'api');
  assert.ok(s.includes('gift'));
});
ok('remember(): front of Recent, distinct, max 7, count +1', () => {
  let st = { list: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], counts: { b: 2 } };
  st = S.remember(st, 'b');
  assert.deepStrictEqual(st.list, ['b', 'a', 'c', 'd', 'e', 'f', 'g']);
  assert.strictEqual(st.counts.b, 3);
  st = S.remember(st, 'z');
  assert.deepStrictEqual(st.list, ['z', 'b', 'a', 'c', 'd', 'e', 'f']);
  assert.strictEqual(S.remember(null, 'x').list[0], 'x');
});
ok('seed(): the icons already on tasks, most used first', () => {
  assert.deepStrictEqual(S.seed(['fix', 'call', 'fix', null, 'deploy', 'fix', 'call']), { list: ['fix', 'call', 'deploy'], counts: { fix: 3, call: 2, deploy: 1 } });
});
ok('fast: 1000 suggestions over the full set in well under a second', () => {
  const t0 = Date.now();
  for (let i = 0; i < 1000; i++) S.suggest('Swift Business bugs fixes for the quotation module and contract link', ICONS, { counts: { fix: 3 } });
  assert.ok(Date.now() - t0 < 1000, (Date.now() - t0) + ' ms');
});

console.log(`\nicon-suggest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
