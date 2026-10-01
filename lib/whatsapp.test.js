'use strict';
// Self-check: node lib/whatsapp.test.js — which way Share → WhatsApp opens, and the browser-app launch args.
const assert = require('assert');
const { openNow, routeOrder, waUrl, pwaArgs, WEB } = require('./whatsapp.js');

let pass = 0, fail = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.error('  ✗ ' + name + '\n    ' + e.message); }
}
console.log('whatsapp — route order + links');
ok('nothing remembered: app, browser app, then web', () => assert.deepStrictEqual(routeOrder(undefined), ['app', 'pwa', 'web']));
ok('the remembered route goes first', () => assert.deepStrictEqual(routeOrder('pwa'), ['pwa', 'app', 'web']));
ok('web is never "remembered" first', () => assert.deepStrictEqual(routeOrder('web'), ['app', 'pwa', 'web']));
ok('what is open: a running desktop app wins, then a WhatsApp window', () => {
  assert.strictEqual(openNow(['WhatsApp'], true), 'app');
  for (const t of ['WhatsApp', '(3) WhatsApp', 'WhatsApp - Google Chrome', ' whatsapp ']) assert.strictEqual(openNow(['Todo Island', t], false), 'web', t);
  assert.strictEqual(openNow(['Todo Island', 'Notes about WhatsApp', 'WhatsAppish'], false), null);
  assert.strictEqual(openNow(undefined, false), null);
});
ok('what is open beats what is remembered', () => {
  assert.deepStrictEqual(routeOrder('pwa', 'app'), ['app', 'pwa', 'web']);
  assert.deepStrictEqual(routeOrder('app', 'web'), ['pwa', 'web', 'app']);
  assert.deepStrictEqual(routeOrder('pwa', null), ['pwa', 'app', 'web']);
});
ok('links: app = whatsapp://, others = web.whatsapp.com (never wa.me), text encoded', () => {
  assert.strictEqual(waUrl('app', 'a & b'), 'whatsapp://send?text=a%20%26%20b');
  assert.strictEqual(waUrl('pwa', '# Done\n'), WEB + '%23%20Done%0A');
  assert.ok(!waUrl('web', 'x').includes('wa.me'));
});
const ID = 'hnpfjngllnobngcgfapefoaidbinmjnm';
ok('a Chrome app shortcut → launch args on the send URL', () => assert.deepStrictEqual(
  pwaArgs({ target: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome_proxy.exe', args: ` --profile-directory=Default --app-id=${ID}` }, 'U'),
  ['--profile-directory=Default', '--app-id=' + ID, '--app-launch-url-for-shortcuts-menu-item=U']));
ok('Edge app shortcut, quoted profile', () => assert.deepStrictEqual(
  pwaArgs({ target: 'C:\\x\\msedge_proxy.exe', args: `--profile-directory="Profile 1" --app-id=${ID}` }, 'U'),
  ['--profile-directory=Profile 1', '--app-id=' + ID, '--app-launch-url-for-shortcuts-menu-item=U']));
ok('anything else is not a browser app', () => {
  assert.strictEqual(pwaArgs({ target: 'C:\\x\\chrome.exe', args: `--app-id=${ID}` }, 'U'), null);
  assert.strictEqual(pwaArgs({ target: 'C:\\x\\chrome_proxy.exe', args: '--profile-directory=Default' }, 'U'), null);
  assert.strictEqual(pwaArgs(null, 'U'), null);
});
console.log(`\nwhatsapp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
