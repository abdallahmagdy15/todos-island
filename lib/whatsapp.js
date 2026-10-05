'use strict';
// Share → WhatsApp (owner 2026-10-01): open WhatsApp DIRECTLY, never the wa.me "Continue to chat" landing page.
// Routes, best first: 'app' = the WhatsApp desktop app (whatsapp://) · 'pwa' = WhatsApp Web installed as a Chrome/Edge
// app (its Start Menu shortcut, launched on the send URL) · 'web' = the default browser at web.whatsapp.com.
// The route that last worked is remembered and tried first; 'web' is never remembered (a later install gets found).
// What is OPEN beats what is remembered (owner 2026-10-01): a running desktop app wins; an open WhatsApp Web window
// (the browser app or a tab) comes next — Chrome only FOCUSES an open app window and drops the message, so that case
// says "paste" (the text is on the clipboard).

const WEB = 'https://web.whatsapp.com/send?text=';

// what is open right now: 'app' (desktop app running) · 'web' (a window titled WhatsApp — "WhatsApp", "(3) WhatsApp",
// "WhatsApp - Google Chrome") · null
const WA_TITLE = /^(\(\d+\)\s*)?WhatsApp\b/i;
function openNow(titles, desktopRunning) {
  if (desktopRunning) return 'app';
  return (titles || []).some(t => WA_TITLE.test(String(t).trim())) ? 'web' : null;
}

// try order: what is open first, else the remembered route, then the rest best-first; 'web' last unless it is open
function routeOrder(saved, open) {
  if (open === 'app') return ['app', 'pwa', 'web'];
  if (open === 'web') return ['pwa', 'web', 'app'];
  const order = ['app', 'pwa'];
  if (order.includes(saved)) order.unshift(...order.splice(order.indexOf(saved), 1));
  return [...order, 'web'];
}

function waUrl(route, text) {
  const q = encodeURIComponent(String(text || ''));
  return route === 'app' ? 'whatsapp://send?text=' + q : WEB + q;
}

// a browser-app shortcut ({ target, args } from shell.readShortcutLink) → the launch args that open the app on `url`,
// or null when it isn't a Chromium app shortcut (chrome_proxy.exe / msedge_proxy.exe with --app-id)
function pwaArgs(link, url) {
  if (!link || !/(^|[\\/])(chrome|msedge)_proxy\.exe$/i.test(String(link.target || ''))) return null;
  const args = String(link.args || '');
  const id = args.match(/--app-id=([a-p]{32})\b/);
  if (!id) return null;
  const prof = args.match(/--profile-directory=("[^"]*"|\S+)/);
  return [...(prof ? ['--profile-directory=' + prof[1].replace(/"/g, '')] : []), '--app-id=' + id[1], '--app-launch-url-for-shortcuts-menu-item=' + url];
}

module.exports = { openNow, routeOrder, waUrl, pwaArgs, WEB };
