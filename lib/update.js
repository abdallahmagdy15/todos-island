'use strict';
// Update check — pure: GitHub's latest-release JSON + the running version → { version, url } or null.
// main.js does the one GET (startup, then daily); the island + tasks window show a green "Update" pill. No popups.
const REPO = 'abdallahmagdy15/todos-island';
const RELEASES = `https://github.com/${REPO}/releases`;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

const parse = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v == null ? '' : v).trim()); return m ? m.slice(1).map(Number) : null; };
// strictly newer, plain x.y.z only — pre-release / odd tags never count
function isNewer(latest, current) {
  const a = parse(latest), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function pickUpdate(release, current) {
  if (!release || release.draft || release.prerelease || !isNewer(release.tag_name, current)) return null;
  // only ever open this repo's own release pages — never a URL taken blindly from the response
  const url = typeof release.html_url === 'string' && release.html_url.startsWith(RELEASES + '/') ? release.html_url : RELEASES + '/latest';
  return { version: String(release.tag_name).trim().replace(/^v/, ''), url };
}

// the installer to download (owner 2026-10-01: auto-update). Only THIS repo's own release asset, named exactly
// TodosIsland-Setup-<version>.exe, with a size and GitHub's sha256 digest to verify against — anything else → null
// (the app then falls back to opening the release page, as before).
function pickAsset(release, version) {
  if (!release || !Array.isArray(release.assets) || !version) return null;
  const name = `TodosIsland-Setup-${version}.exe`;
  const a = release.assets.find(x => x && x.name === name);
  if (!a || a.state && a.state !== 'uploaded') return null;
  const url = String(a.browser_download_url || '');
  if (!url.startsWith(`${RELEASES}/download/`) || !url.endsWith('/' + name)) return null;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(a.digest || ''));
  if (!m || !(a.size > 0)) return null;
  return { name, url, size: a.size, sha256: m[1].toLowerCase() };
}

// what to do at startup with an installer downloaded earlier (owner 2026-10-01): install it ONCE per version by itself
// ('install'); after that the pill / Settings offer it ('offer'); once that version (or newer) runs, it's spent ('drop').
function pendingAction(pending, current, autoInstalledFor, fileExists) {
  if (!pending || !pending.version || !fileExists) return 'none';
  if (!isNewer(pending.version, current)) return 'drop';
  return autoInstalledFor === pending.version ? 'offer' : 'install';
}

module.exports = { isNewer, pickUpdate, pickAsset, pendingAction, API, RELEASES };
