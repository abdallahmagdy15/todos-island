'use strict';
// Self-check: node lib/links.test.js — linked ("shadow") tasks: what shows where, and which links are dropped.
const assert = require('assert');
const L = require('./links.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

const W = { id: 'w#Ship', uid: 'aaa111', file: 'work', title: 'Ship' };
const W2 = { id: 'w#Other', uid: 'bbb222', file: 'work', title: 'Other' };
const P = { id: 'p#Gym', uid: 'ccc333', file: 'personal', title: 'Gym' };
const secs = () => [{ name: 'Work', items: [W, W2] }, { name: 'Personal', items: [P] }];

ok('a linked work task shows in Personal as a shadow that keeps its HOME file + id (writes go home)', () => {
  const out = L.withShadows(secs(), { aaa111: 'personal' });
  const sh = out[1].items.find(t => t.shadow);
  assert.deepStrictEqual([sh.id, sh.file, sh.home, sh.title], ['w#Ship', 'work', 'work', 'Ship']);
  assert.strictEqual(out[0].items.length, 2); // the work section is untouched
  assert.ok(!out[0].items.some(t => t.shadow));
});
ok('links both ways; no links = sections returned as they are', () => {
  const out = L.withShadows(secs(), { aaa111: 'personal', ccc333: 'work' });
  assert.deepStrictEqual(out.map(s => s.items.filter(t => t.shadow).map(t => t.title)), [['Gym'], ['Ship']]);
  const s = secs();
  assert.strictEqual(L.withShadows(s, {}), s);
});
ok('a link to the note the task already lives in shows nothing extra', () => {
  const out = L.withShadows(secs(), { aaa111: 'work' });
  assert.strictEqual(out[0].items.length, 2);
});
ok('pruneLinks keeps live links, drops done/gone ones and links to their own note', () => {
  const open = { work: new Set(['aaa111', 'bbb222']), personal: new Set(['ccc333']) };
  assert.deepStrictEqual(L.pruneLinks({ aaa111: 'personal', bbb222: 'work', zzz999: 'personal', ccc333: 'nope' }, open), { aaa111: 'personal' });
});
ok('pruneLinks keeps a link whose note could not be read (it may still be there)', () => {
  assert.deepStrictEqual(L.pruneLinks({ zzz999: 'personal' }, { work: null, personal: new Set() }), { zzz999: 'personal' });
});
ok('otherNote', () => assert.deepStrictEqual([L.otherNote('work'), L.otherNote('personal')], ['personal', 'work']));

console.log(`links: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
