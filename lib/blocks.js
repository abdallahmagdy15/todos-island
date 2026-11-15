'use strict';
// Blank-line blocks (owner 2026-11-15, P1): text whose parts are separated by blank lines can become several items —
// N subtasks / steps in a subtask field, or a task + its subtasks in the composer (never several tasks). A block = one
// line or several; its first line is the item's title, the rest its description (same rule as UI.splitSub / composeTask).
// Pure + dual-mode like lib/images.js (window.Blocks / module.exports): no fs, no electron.
(() => {
  // blocks = arrays of trimmed lines; 1+ whitespace-only lines separate blocks; leading / trailing blank lines ignored
  function split(text) {
    const out = [];
    let cur = null;
    for (const raw of String(text || '').split(/\r\n?|\n/)) {
      const line = raw.trim();
      if (!line) { if (cur) { out.push(cur); cur = null; } continue; }
      (cur || (cur = [])).push(line);
    }
    if (cur) out.push(cur);
    return out;
  }
  function count(text) {
    const t = String(text || '');
    if (!/\n[ \t]*\r?\n/.test(t)) return t.trim() ? 1 : 0; // fast path: no blank line inside → 0 or 1
    return split(t).length;
  }
  // one { title, notes } per block; the title = the first line with inner whitespace collapsed (like UI.splitSub)
  function items(text) {
    return split(text).map(b => ({ title: b[0].replace(/\s+/g, ' '), notes: b.slice(1) }));
  }
  // the composer shape: the FIRST block feeds composeTask as is, the rest become its subtasks
  function taskAndSubs(text) {
    const b = split(text);
    return { taskText: (b[0] || []).join('\n'), subs: items(text).slice(1) };
  }
  const API = { split, count, items, taskAndSubs };
  if (typeof window !== 'undefined') window.Blocks = API;
  if (typeof module !== 'undefined') module.exports = API;
})();
