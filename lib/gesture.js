'use strict';
// Touchpad "hold + double tap" (owner 2026-10-10, round 2; replaced the three-finger double tap, whose single tap also
// opened Windows Search): one finger RESTS on the pad, a second finger taps twice next to it → the island shows.
// Pure rules here; lib/touchpad.js feeds them how many fingers touch the pad right now.
// Why it doesn't clash with Windows: a two-finger tap (right-click) or a two-finger scroll puts both fingers down
// together; here the holding finger must land HOLD_MS before the first tap, and it never lifts until both taps are done.
const HOLD_MS = 150;  // the holding finger is down this long before the first tap
const TAP_MS = 250;   // the tapping finger's touch: down → up
const GAP_MS = 400;   // end of the first tap → start of the second

// state + (fingers touching now, time ms) → { state, fire }
function tapStep(s, fingers, t) {
  s = s || { down: 0, holdAt: null, tapAt: null, taps: 0, lastEnd: null };
  const was = s.down;
  if (fingers === was) return { state: s, fire: false };
  s = { ...s, down: fingers };
  if (was === 0 && fingers === 1) return { state: { ...s, holdAt: t, taps: 0 }, fire: false }; // the holding finger lands
  if (was === 1 && fingers === 2 && s.holdAt != null && t - s.holdAt >= HOLD_MS) { // a tapping finger lands
    const inTime = s.taps === 0 || t - s.lastEnd <= GAP_MS;
    return { state: { ...s, tapAt: t, taps: inTime ? s.taps : 0 }, fire: false };
  }
  if (was === 2 && fingers === 1 && s.tapAt != null) { // the tapping finger lifts, the holding one stays
    const taps = t - s.tapAt <= TAP_MS ? s.taps + 1 : 0;
    return { state: { ...s, tapAt: null, taps: taps === 2 ? 0 : taps, lastEnd: t }, fire: taps === 2 };
  }
  // anything else (all lifted, both landed together = a right-click tap or a scroll, a third finger) → start over;
  // a hold survives only while exactly one finger stays down
  return { state: { ...s, holdAt: fingers === 1 ? s.holdAt : null, tapAt: null, taps: 0 }, fire: false };
}

module.exports = { HOLD_MS, TAP_MS, GAP_MS, tapStep };
