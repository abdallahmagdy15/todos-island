'use strict';
// Image line self-check: node lib/images.test.js
const assert = require('assert');
const I = require('./images.js');
let pass = 0, fail = 0;
const ok = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n    ' + e.message); } };

const DIR = 'C:\\Users\\Me X\\AppData\\Roaming\\todos-island\\images';

console.log('images — the link line');
ok('imageLine: drive kept, spaces → %20, forward slashes', () => {
  assert.strictEqual(I.imageLine('img-k3x9q2', DIR), '[🖼 img-k3x9q2](file:///C:/Users/Me%20X/AppData/Roaming/todos-island/images/img-k3x9q2.png)');
});
ok('isImageLine: true for the built line, with one leading tab and two', () => {
  const l = I.imageLine('img-abc123', DIR);
  assert.strictEqual(I.isImageLine(l), true);
  assert.strictEqual(I.isImageLine('\t' + l), true);
  assert.strictEqual(I.isImageLine('\t\t' + l), true);
});
ok('isImageLine: false for a normal line, text before the link, no URL', () => {
  assert.strictEqual(I.isImageLine('BankFile_OtherEarning check'), false);
  assert.strictEqual(I.isImageLine('see ' + I.imageLine('img-abc123', DIR)), false);
  assert.strictEqual(I.isImageLine('[🖼 img-k3x9q2]'), false);
});
ok('imageName: the name, or null', () => {
  assert.strictEqual(I.imageName(I.imageLine('img-zzz999', DIR)), 'img-zzz999');
  assert.strictEqual(I.imageName('\tnot a link'), null);
});
ok('split: text lines stay in order untouched, image names in order', () => {
  const a = I.imageLine('img-aaa111', DIR), b = I.imageLine('img-bbb222', DIR);
  assert.deepStrictEqual(I.split(['BankFile_OtherEarning', a, 'second', b]),
    { text: ['BankFile_OtherEarning', 'second'], images: ['img-aaa111', 'img-bbb222'] });
});
ok('newName: matches NAME_RE and avoids a taken name', () => {
  const n1 = I.newName(() => false);
  assert.ok(I.NAME_RE.test(n1), n1);
  const n2 = I.newName(n => n === n1);
  assert.notStrictEqual(n2, n1);
  assert.ok(I.NAME_RE.test(n2), n2);
});

console.log(`\nimages: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
