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

  // ONE task in plain text (the WhatsApp-friendly shape): "# Task", _notes_, "* sub" bullets, done struck
  function plainTask(t, done, o = {}) {
    const extra = (p, due) => [o.withPrio && p ? p : null, o.withDates && due ? due : null].filter(Boolean).map(x => ' · ' + x).join('');
    const strike = s => (s ? `~${s.replace(/~/g, '')}~` : s); // a struck line can't hold its own strike marks
    const out = [`# ${done ? strike(waMarks(t.title)) : waMarks(t.title)}${extra(t.priority, t.dueText)}`];
    for (const n of t.notes || []) if (clean(n)) out.push(`_${waMarks(n).replace(/_/g, '')}_`);
    for (const s of t.subs || []) out.push(`* ${done || s.done ? strike(waMarks(s.t)) : waMarks(s.t)}${extra(s.p, null)}`);
    return out.join('\n');
  }

  function wa(groups, date, o) {
    const L = o.labels || {};
    const task = (t, done) => plainTask(t, done, o);
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

  // ---- trimming one task (owner 2026-10-05): the day filter (#12) and the copy wheel's open / all subtasks (#5) ----
  // day = { from, to } (ms, inclusive range of whole local days) or null = every day. A subtask counts when its hidden
  // stamp (c = added, u = last change, #11) falls in the range; a task stays when it changed in the range itself
  // (updatedTs) or has a subtask that did, and then shows ONLY the in-range subtasks. subs: 'all' | 'open'.
  // The Markdown lines drop the same subtask lines (the k-th subtask line of the block = subs[k]).
  const SUB_LINE = /^\s+- \[[ xX]\]\s/;
  const stampTs = s => (s ? new Date(s).getTime() || 0 : 0); // 'YYYY-MM-DDTHH:MM' = local time
  const inDay = (ts, day) => ts >= day.from && ts <= day.to;
  function trimTask(t, { day = null, subs = 'all' } = {}) {
    const all = t.subs || [];
    const keepSub = s => (subs !== 'open' || !s.done) && (!day || inDay(stampTs(s.u), day) || inDay(stampTs(s.c), day));
    const kept = all.map(keepSub);
    if (day && !kept.some(Boolean) && !inDay(t.updatedTs || 0, day)) return null;
    if (kept.every(Boolean)) return t;
    let k = -1;
    const lines = t.lines && t.lines.length ? t.lines.filter((l, i) => i === 0 || !SUB_LINE.test(l) || kept[++k]) : t.lines;
    return { ...t, subs: all.filter((s, i) => kept[i]), lines };
  }
  // a whole local day (or a span of days) → { from, to } in ms; d = a Date or ms
  function dayRange(a, b = a) {
    const s = new Date(Math.min(+a, +b)), e = new Date(Math.max(+a, +b));
    return { from: new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime(), to: new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1).getTime() - 1 };
  }

  // fmt: 'md' | 'text' (plain text = the WhatsApp-friendly shape; legacy 'wa' = text); date: the notation date ("29 Sep");
  // labels: { done, now, next } for the plain-text section headings; day: the #12 filter ({ from, to } or null)
  function buildShare({ groups, fmt = 'text', withPrio = false, withDates = false, date = '', labels, day = null } = {}) {
    const trim = arr => (arr || []).map(t => trimTask(t, { day })).filter(Boolean);
    const gs = (groups || []).map(g => ({ name: g.name, done: trim(g.done), now: trim(g.now), open: trim(g.open) }));
    return fmt === 'md' ? md(gs, date) : wa(gs, date, { withPrio, withDates, labels });
  }

  // the island's quick Copy (owner 2026-09-29): ONE task as Markdown (its block exactly as the note has it) or plain text
  // o.subs: 'all' | 'open' and o.day (the copy wheel, #5) trim the task first; nothing left in the day → ''
  function taskText(t0, fmt = 'text', o = {}) {
    const t = trimTask(t0, { day: o.day || null, subs: o.subs || 'all' });
    if (!t) return '';
    if (fmt === 'md') return (t.lines && t.lines.length ? t.lines : [`- [${t.isDone ? 'x' : ' '}] ${t.title}`]).join('\n') + '\n';
    return plainTask(t, !!t.isDone, o);
  }

  const ShareText = { buildShare, taskText, trimTask, dayRange };
  if (typeof window !== 'undefined') window.ShareText = ShareText;
  if (typeof module !== 'undefined') module.exports = ShareText;
})();
