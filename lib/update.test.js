'use strict';
// Self-check: node lib/update.test.js — version compare + which releases light the green "Update" pill.
const assert = require('assert');
const { isNewer, pickUpdate, pickAsset, pendingAction, RELEASES } = require('./update.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}
console.log('update — version compare');
ok('patch bump is newer', () => assert.strictEqual(isNewer('v1.5.1', '1.5.0'), true));
ok('minor beats a higher patch', () => assert.strictEqual(isNewer('1.6.0', '1.5.9'), true));
ok('numeric, not string compare (1.10 > 1.9)', () => assert.strictEqual(isNewer('v1.10.0', '1.9.0'), true));
ok('same version is not newer', () => assert.strictEqual(isNewer('v1.5.0', '1.5.0'), false));
ok('older release is not newer', () => assert.strictEqual(isNewer('v1.4.1', '1.5.0'), false));
ok('pre-release / odd tags never count', () => {
  assert.strictEqual(isNewer('v2.0.0-beta.1', '1.5.0'), false);
  assert.strictEqual(isNewer('latest', '1.5.0'), false);
  assert.strictEqual(isNewer(undefined, '1.5.0'), false);
});

console.log('update — release → pill');
const rel = (tag, extra = {}) => ({ tag_name: tag, html_url: `${RELEASES}/tag/${tag}`, draft: false, prerelease: false, ...extra });
ok('newer release → version + its page', () => assert.deepStrictEqual(pickUpdate(rel('v1.6.0'), '1.5.0'), { version: '1.6.0', url: `${RELEASES}/tag/v1.6.0` }));
ok('up to date → no pill', () => assert.strictEqual(pickUpdate(rel('v1.5.0'), '1.5.0'), null));
ok('draft or prerelease → no pill', () => {
  assert.strictEqual(pickUpdate(rel('v1.6.0', { draft: true }), '1.5.0'), null);
  assert.strictEqual(pickUpdate(rel('v1.6.0', { prerelease: true }), '1.5.0'), null);
});
ok('a foreign URL is never opened — falls back to the releases page', () =>
  assert.strictEqual(pickUpdate(rel('v1.6.0', { html_url: 'https://evil.example/x' }), '1.5.0').url, `${RELEASES}/latest`));
ok('garbage response → no pill', () => { assert.strictEqual(pickUpdate(null, '1.5.0'), null); assert.strictEqual(pickUpdate({ message: 'rate limited' }, '1.5.0'), null); });

console.log('update — the installer asset (auto-download)');
const DIG = 'sha256:' + 'ab'.repeat(32);
const asset = (extra = {}) => ({ name: 'TodosIsland-Setup-1.6.0.exe', size: 1000, state: 'uploaded', digest: DIG,
  browser_download_url: `${RELEASES}/download/v1.6.0/TodosIsland-Setup-1.6.0.exe`, ...extra });
ok('the right asset → url, size, sha256', () => assert.deepStrictEqual(pickAsset(rel('v1.6.0', { assets: [{ name: 'x.blockmap' }, asset()] }), '1.6.0'),
  { name: 'TodosIsland-Setup-1.6.0.exe', url: `${RELEASES}/download/v1.6.0/TodosIsland-Setup-1.6.0.exe`, size: 1000, sha256: 'ab'.repeat(32) }));
ok('a foreign download URL is never used', () => {
  assert.strictEqual(pickAsset(rel('v1.6.0', { assets: [asset({ browser_download_url: 'https://evil.example/TodosIsland-Setup-1.6.0.exe' })] }), '1.6.0'), null);
  assert.strictEqual(pickAsset(rel('v1.6.0', { assets: [asset({ browser_download_url: 'https://github.com/someone/else/releases/download/v1.6.0/TodosIsland-Setup-1.6.0.exe' })] }), '1.6.0'), null);
});
ok('no digest, bad digest, no size, wrong name, not uploaded → null (fall back to the page)', () => {
  for (const bad of [{ digest: undefined }, { digest: 'md5:abc' }, { size: 0 }, { name: 'Other.exe' }, { state: 'starter' }])
    assert.strictEqual(pickAsset(rel('v1.6.0', { assets: [asset(bad)] }), '1.6.0'), null, JSON.stringify(bad));
  assert.strictEqual(pickAsset(rel('v1.6.0'), '1.6.0'), null);
});
console.log('update — a downloaded installer at startup');
ok('installs once per version, then only offers; a spent one is dropped', () => {
  const p = { version: '1.6.0', file: 'x.exe' };
  assert.strictEqual(pendingAction(p, '1.5.0', null, true), 'install');
  assert.strictEqual(pendingAction(p, '1.5.0', '1.6.0', true), 'offer'); // you cancelled the wizard once — no more auto-starts
  assert.strictEqual(pendingAction(p, '1.6.0', '1.6.0', true), 'drop'); // that version (or newer) is running now
  assert.strictEqual(pendingAction(p, '1.5.0', null, false), 'none'); // file gone
  assert.strictEqual(pendingAction(null, '1.5.0', null, true), 'none');
});

console.log(`update: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
