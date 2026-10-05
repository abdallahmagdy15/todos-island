'use strict';
// Composer: turns what the user typed (+ chip choices) into the exact task the app will write.
// Pure — reuses the parser's own parseMeta/fmtTask so the "will write" preview can never drift from the note format.
const { parseMeta, fmtTask, fmtTime, MONTHS } = require('./parse.js');

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
// a chip/fallback due may carry its time (#7): { d, m, time } — time = minutes after midnight or null
const timeOf = due => (due && Number.isInteger(due.time) && due.time >= 0 && due.time < 1440 ? due.time : null);
const todayDue = () => { const n = new Date(); return { d: n.getDate(), m: MONTHS[n.getMonth()] }; };

// input: { text, priority?, due?, active?, fallback? }
//   text     — full textarea: first line = title (may start with notation tokens: /now !! 24 Sep --), rest = description
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
    time: meta && meta.time != null ? meta.time : null,
    active: !!(meta && meta.active)
  };
  if (typed.time != null && !typed.due) typed.due = todayDue(); // owner: a time with no date means today — written as today's date
  const fb = input.fallback || {};
  const pick = (key, norm) => {
    if (input[key] !== undefined) return norm(input[key]);
    if (key === 'active' ? typed.active : typed[key]) return key === 'due' ? { ...typed.due, time: typed.time } : typed[key];
    return norm(fb[key]);
  };
  const priority = pick('priority', normPrio);
  const dueIn = pick('due', d => (normDue(d) ? { ...normDue(d), time: timeOf(d) } : null));
  const due = dueIn ? { d: dueIn.d, m: dueIn.m } : null;
  const time = dueIn ? dueIn.time : null;
  const active = pick('active', v => !!v);
  const title = meta && !/^(?:[*!]{1,3}|\/now)$/i.test(meta.title) ? meta.title : ''; // bare tokens ("!!", "/now") are not a title yet
  const dueText = due ? `${due.d} ${due.m}${time != null ? ' ' + fmtTime(time) : ''}` : null;
  const base = { title, desc, priority, due, time, active, dueText, typed };
  if (!title) return { ...base, ok: false, reason: 'empty', line: null };
  return { ...base, ok: true, line: fmtTask({ indent: '', checked: false, title, priority, due, time, active }) };
}

module.exports = { composeTask };
