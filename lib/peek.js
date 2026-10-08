'use strict';
// Top-edge peek (owner 2026-10-06, pick P1 "invisible"): resting the pointer at the very top of the primary screen, in a
// strip centred on it (25 % of the screen width, a few px tall), for PEEK_MS (1 s, owner 2026-10-08; was 1.5 s) shows the island. Pure: main.js polls the
// pointer and feeds it here; nothing in this file touches Electron.
const PEEK_MS = 1000, PEEK_W = 0.25, PEEK_H = 3;

// is the pointer in the strip? bounds = the display's full bounds (not the work area: the strip is the screen's own edge)
function inPeekZone(pt, bounds, { w = PEEK_W, h = PEEK_H } = {}) {
  if (!pt || !bounds) return false;
  const half = (bounds.width * w) / 2, cx = bounds.x + bounds.width / 2;
  return pt.y >= bounds.y && pt.y < bounds.y + h && Math.abs(pt.x - cx) <= half;
}

// one poll step. state = { since: ms the pointer entered | null, armed: bool }. armed goes false after a peek fires and
// comes back only once the pointer has LEFT the strip, so a pointer parked at the top doesn't re-pop the island
// after every dismiss. Returns { state, fire }.
function peekStep(state, inZone, now, ms = PEEK_MS) {
  const s = { since: state.since == null ? null : state.since, armed: state.armed !== false };
  if (!inZone) return { state: { since: null, armed: true }, fire: false };
  if (!s.armed) return { state: s, fire: false };
  if (s.since == null) return { state: { since: now, armed: true }, fire: false };
  if (now - s.since >= ms) return { state: { since: null, armed: false }, fire: true };
  return { state: s, fire: false };
}

const Peek = { PEEK_MS, PEEK_W, PEEK_H, inPeekZone, peekStep };
if (typeof module !== 'undefined') module.exports = Peek;
