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

module.exports = { isNewer, pickUpdate, API, RELEASES };
