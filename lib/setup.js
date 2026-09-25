'use strict';
// First-run setup planner — pure: onboarding answers → settings patch + which notes to create / adopt.
// No fs writes here; main.js performs the plan (create with 'wx', never overwrite).
const path = require('path');

const NOTE_NAME = { work: 'work-tasks.md', personal: 'personal.md' };
const MODES = ['both', 'work', 'personal'];
const notesFor = mode => mode === 'both' ? ['work', 'personal'] : [mode];

// answers: { skip?, mode, work/personal: { kind: 'file'|'folder'|null, path }, reminders: { on, dayStart, dayEnd, every }, autoStart }
// env: { defaultDir, exists(p) }
function planSetup(answers, env) {
  const a = answers || {};
  const mode = a.skip ? 'personal' : (MODES.includes(a.mode) ? a.mode : 'both');
  const settings = { mode };
  const create = [], adopt = [];
  for (const kind of notesFor(mode)) {
    const pick = (!a.skip && a[kind]) || {};
    let p;
    if (pick.kind === 'file' && pick.path) p = pick.path;
    else if (pick.kind === 'folder' && pick.path) p = path.join(pick.path, NOTE_NAME[kind]);
    else p = path.join(env.defaultDir, NOTE_NAME[kind]);
    settings[kind + 'Path'] = p;
    (env.exists(p) ? adopt : create).push({ kind, path: p });
  }
  if (!a.skip) {
    const r = a.reminders || {};
    const on = r.on !== false;
    const every = [15, 30, 60, 90].includes(+r.every) ? +r.every : 60;
    if (/^\d{2}:\d{2}$/.test(r.dayStart || '')) settings.dayStart = r.dayStart;
    if (/^\d{2}:\d{2}$/.test(r.dayEnd || '')) settings.dayEnd = r.dayEnd;
    settings.workRemindersOn = on;
    settings.workIntervalMin = every;
    // work-only: outside work hours there is nothing to remind about; personal-only: one cadence all day
    settings.offRemindersOn = on && mode !== 'work';
    if (mode === 'personal') settings.offIntervalMin = every;
    settings.autoStart = !!a.autoStart;
  }
  return { settings, create, adopt };
}

module.exports = { planSetup, notesFor, NOTE_NAME, MODES };
