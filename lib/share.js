'use strict';
// Share text builder (owner 2026-09-29). Pure: picked tasks in → the message out. Dual-mode: window.ShareText
// (tasks window, panels.js) or require() from tests.
//
// groups = [{ name: 'Work', done: [task], now: [task], open: [task] }, …] — always Work before Personal, each its own block.
// A task carries: title, priority, dueText, notes [string], subs [{ t, done, p }], lines [string] (the note's block).
//
// Markdown: every task EXACTLY as the note has it (lines = its block, hidden stamp already stripped), done → Now → open.
// WhatsApp: no emoji; WhatsApp's own marks: *bold* section headings, ~strike~ for done, _italic_ notes. WhatsApp drops
// leading spaces, so nesting is shown by shape, not indent (owner 2026-09-29): each task is ONE line "# Task", its note
// lines follow in _italic_, its subtasks as "* sub" bullets; a blank line between tasks. Priority / dates only on request.
(() => {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  // the note's Markdown marks → WhatsApp's own: **bold** → *bold*, *italic* → _italic_, ~~strike~~ → ~strike~, <u>x</u> → x
  const waMarks = s => clean(s)
    .replace(/<u>(.+?)<\/u>/g, '$1')
    .replace(/(^|[\s(])\*(?![\s*])(.+?)(?<![\s*])\*(?=$|[\s).,!?:;])/g, '$1_$2_')
    .replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '*$1*')
    .replace(/~~(?!\s)(.+?)(?<!\s)~~/g, '~$1~');

  function md(groups, date) {
    return groups.map(g => {
      const tasks = [...g.done, ...g.now, ...g.open];
      if (!tasks.length) return null;
      return [`## ${g.name} · ${date}`, ...tasks.flatMap(t => t.lines && t.lines.length ? t.lines : [`- [${t.isDone ? 'x' : ' '}] ${t.title}`])].join('\n');
    }).filter(Boolean).join('\n\n') + '\n';
  }

  function wa(groups, date, o) {
    const L = o.labels || {};
    const extra = (p, due) => [o.withPrio && p ? p : null, o.withDates && due ? due : null].filter(Boolean).map(x => ' · ' + x).join('');
    const strike = s => (s ? `~${s.replace(/~/g, '')}~` : s); // a struck line can't hold its own strike marks
    const task = (t, done) => {
      const out = [`# ${done ? strike(waMarks(t.title)) : waMarks(t.title)}${extra(t.priority, t.dueText)}`];
      for (const n of t.notes || []) if (clean(n)) out.push(`_${waMarks(n).replace(/_/g, '')}_`);
      for (const s of t.subs || []) out.push(`* ${done || s.done ? strike(waMarks(s.t)) : waMarks(s.t)}${extra(s.p, null)}`);
      return out.join('\n');
    };
    const section = (label, arr, done) => (arr.length ? `*${label}*\n` + arr.map(t => task(t, done)).join('\n\n') : null);
    return groups.map(g => {
      const parts = [
        section(L.done || 'Done', g.done, true),
        section(L.now || 'In progress', g.now, false),
        section(L.next || 'Next', g.open, false)
      ].filter(Boolean);
      return parts.length ? [`*${g.name} · ${date}*`, ...parts].join('\n\n') : null;
    }).filter(Boolean).join('\n\n');
  }

  // fmt: 'wa' | 'md'; date: the notation date ("29 Sep"); labels: { done, now, next } for WhatsApp headings
  function buildShare({ groups, fmt = 'wa', withPrio = false, withDates = false, date = '', labels } = {}) {
    const gs = (groups || []).map(g => ({ name: g.name, done: g.done || [], now: g.now || [], open: g.open || [] }));
    return fmt === 'md' ? md(gs, date) : wa(gs, date, { withPrio, withDates, labels });
  }

  const ShareText = { buildShare };
  if (typeof window !== 'undefined') window.ShareText = ShareText;
  if (typeof module !== 'undefined') module.exports = ShareText;
})();
