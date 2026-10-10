'use strict';
// Settings export / import (owner 2026-10-10): ONE .json file = every setting (note paths, shortcut and look included)
// + the task attachments (pointers keyed by the tasks' hidden ids). Pure rules here; main.js does the dialogs + saving.
// Import reads only keys the app knows, with the same type as their default; the values then go through main's normal
// settings save (paths that don't exist on this PC are refused there, the rest still lands).
const ATT = require('./attach.js');
const TAG = 'todos-island-settings';

function makeBackup(state, appVersion, now = new Date()) {
  return { app: TAG, format: 1, appVersion, exportedAt: now.toISOString(), settings: { ...state.settings }, attachments: state.attachments || {} };
}

// parsed JSON → { settings, attachments } or { error: 'not-ours' | 'empty' }
function readBackup(obj, defaults) {
  if (!obj || typeof obj !== 'object' || obj.app !== TAG) return { error: 'not-ours' };
  const settings = {};
  for (const [k, v] of Object.entries(obj.settings || {})) {
    if (Object.prototype.hasOwnProperty.call(defaults, k) && typeof v === typeof defaults[k]) settings[k] = v;
  }
  const attachments = {};
  for (const [k, list] of Object.entries(obj.attachments && typeof obj.attachments === 'object' ? obj.attachments : {})) {
    const clean = (Array.isArray(list) ? list : []).map(ATT.clean).filter(Boolean).slice(0, 30);
    if (clean.length) attachments[k] = clean;
  }
  if (!Object.keys(settings).length && !Object.keys(attachments).length) return { error: 'empty' };
  return { settings, attachments };
}

const fileName = (now = new Date()) => `todos-island-settings-${now.toISOString().slice(0, 10)}.json`;

module.exports = { TAG, makeBackup, readBackup, fileName };
