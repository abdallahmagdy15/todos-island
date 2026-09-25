'use strict';
// Composer: turns what the user typed (+ chip choices) into the exact task the app will write.
// Pure — reuses the parser's own parseMeta/fmtTask so the "will write" preview can never drift from the note format.
const { parseMeta, fmtTask, MONTHS } = require('./parse.js');

const PRIOS = ['!', '!!', '!!!'];
const normPrio = p => (PRIOS.includes(p) ? p : null);
function normDue(due) {
  if (!due || !due.m) return null;
  const mi = MONTHS.findIndex(m => m.toLowerCase() === String(due.m).slice(0, 3).toLowerCase());
  const d = Math.floor(+due.d);
  if (mi < 0 || !(d >= 1)) return null;
  const dim = new Date(new Date().getFullYear(), mi + 1, 0).getDate(); // 31 Feb → 28/29 Feb (same clamp as update-task)
  return { d: Math.min(d, dim), m: MONTHS[mi] };
}

// input: { text, priority?, due?, active?, fallback? }
//   text     — full textarea: first line = title (may start with notation tokens: * !! 24 Sep), rest = description
//   priority / due / active — explicit chip choice; undefined = not chosen (typed token, then fallback, wins)
//   fallback — { priority, due, active } used when neither a chip nor a typed token says anything (the editor's current task)
function composeTask(input = {}) {
  const lines = String(input.text || '').split(/\r?\n/).map(l => l.trim());
  const first = lines[0] || '';
  const desc = lines.slice(1).filter(Boolean);
  const meta = first ? parseMeta(first) : null;
  const typed = {
    priority: meta ? normPrio(meta.priority) : null,
    due: meta ? normDue(meta.due) : null,
    active: !!(meta && meta.active)
  };
  const fb = input.fallback || {};
  const pick = (key, norm) => {
    if (input[key] !== undefined) return norm(input[key]);
    if (key === 'active' ? typed.active : typed[key]) return typed[key];
    return norm(fb[key]);
  };
  const priority = pick('priority', normPrio);
  const due = pick('due', normDue);
  const active = pick('active', v => !!v);
  const title = meta && !/^[*!]{1,3}$/.test(meta.title) ? meta.title : ''; // bare tokens ("!!") are not a title yet
  const base = { title, desc, priority, due, active, dueText: due ? `${due.d} ${due.m}` : null, typed };
  if (!title) return { ...base, ok: false, reason: 'empty', line: null };
  return { ...base, ok: true, line: fmtTask({ indent: '', checked: false, title, priority, due, active }) };
}

module.exports = { composeTask };
