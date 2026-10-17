'use strict';
// Per-task / per-subtask icons (owner 2026-10-15): a POINTER in app state, never a line in the note —
// state.icons = { "<hidden id>": "<icon name>" } = the icon the user picked for that task or subtask.
// Pure rules here; main.js applies them. Same shape as state.links / state.attachments.

const NAMES = require('./task-icons.js').flatMap(g => g.icons.map(i => i.n));

// n if it names an icon, else null (null = "remove the icon")
function cleanName(n) { return NAMES.includes(n) ? n : null; }

// keep only entries whose key looks like a hidden id (same rule as links in lib/backup.js) and whose name is known
function cleanIcons(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj && typeof obj === 'object' ? obj : {})) if (/^[a-z0-9]{4,16}$/.test(k) && cleanName(v)) out[k] = v;
  return out;
}

// known = a Set of every hidden id still in the readable notes (open AND done, tasks AND subtasks), or null when a note
// could not be read → the icons come back unchanged (we can't tell what is gone, so nothing is dropped).
function pruneIcons(icons, known) {
  if (!known) return icons;
  const out = {};
  for (const [k, v] of Object.entries(icons || {})) if (known.has(k)) out[k] = v;
  return out;
}

module.exports = { NAMES, cleanName, cleanIcons, pruneIcons };
