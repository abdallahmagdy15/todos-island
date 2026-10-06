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

  const SUB_LINE = /^(\t| {2,})\s*- \[[ xX]\]/; // an indented checkbox line = a subtask in the note's block
  // Markdown toggles (owner 2026-09-30): Priority / Dates off → those tokens leave the line's LEADING meta; the rest of the
  // line is untouched, and with everything on nothing is touched (the note as written, byte for byte)
  const MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
  const TOKEN = new RegExp(`\\/now|\\*|!{1,3}|\\d{1,2} ${MON}`, 'gi');
  const META = new RegExp(`^(\\s*- \\[[ xX]\\] )((?:(?:\\/now|\\*|!{1,3}|\\d{1,2} ${MON})(?:\\s+|$))+)(?:(--|—|-)(?:\\s+|$))?`, 'i');
  function stripMeta(line, o) {
    if (o.withPrio !== false && o.withDates !== false) return line;
    const m = META.exec(line);
    if (!m) return line;
    const all = m[2].match(TOKEN) || [];
    const keep = all.filter(t => !(/^!+$/.test(t) && o.withPrio === false) && !(/^\d/.test(t) && o.withDates === false));
    if (keep.length === all.length) return line; // nothing to drop: the line stays as written
    const rest = line.slice(m[0].length);
    return keep.length ? `${m[1]}${keep.join(' ')} ${m[3] ? m[3] + ' ' : ''}${rest}` : m[1] + rest; // never adds a separator
  }
  // Subtasks (owner 2026-09-30): a mode — 'all' | 'open' (done ones left out) | 'off'; legacy true / false = all / off.
  // Whatever is shown lists OPEN subtasks first, then done ones; each group newest first (owner 2026-10-06: by the sub's
  // hidden stamp, created or updated; unstamped ones after them in the note's order).
  const subMode = v => (v === false || v === 'off' ? 'off' : v === 'open' ? 'open' : 'all');
  const DONE_SUB = /^(\t| {2,})\s*- \[[xX]\]/;
  const stampTs = v => (v ? new Date(v).getTime() || 0 : 0); // 'YYYY-MM-DDTHH:MM' = local time
  const subTs = x => (x ? Math.max(stampTs(x.u), stampTs(x.c)) : 0);
  // newest first, ties (e.g. no stamps) keep their order
  const byNewest = (arr, ts) => arr.map((x, i) => [x, i, ts(x)]).sort((a, b) => (b[2] - a[2]) || (a[1] - b[1])).map(x => x[0]);
  // a task's activity (owner 2026-10-06): its newest stamp, created or updated, its own or any subtask's
  const activity = t => Math.max(t.updatedTs || 0, stampTs(t.updated), stampTs(t.created), ...(t.subs || []).map(subTs));
  // a task's block: filter its subtask lines by mode, then open before done, each newest first (subs[k] = the k-th sub line)
  function subLines(lines, mode, subs = []) {
    let k = -1;
    const rows = lines.map(l => (SUB_LINE.test(l) ? { l, sub: true, ts: subTs(subs[++k]) } : { l, sub: false }));
    const kept = rows.filter(r => !(r.sub && (mode === 'off' || (mode === 'open' && DONE_SUB.test(r.l)))));
    const slots = [], ss = [];
    kept.forEach((r, i) => { if (r.sub) { slots.push(i); ss.push(r); } });
    const sorted = [...byNewest(ss.filter(r => !DONE_SUB.test(r.l)), r => r.ts), ...byNewest(ss.filter(r => DONE_SUB.test(r.l)), r => r.ts)];
    slots.forEach((at, j) => { kept[at] = sorted[j]; });
    return kept.map(r => r.l);
  }
  // ---- the day filter (owner 2026-10-05, task #12; also the copy list's Today, #5) ----
  // day = { from, to } (ms, inclusive whole local days) or null = every day. Owner 2026-10-06: OPEN is the present — an
  // open task and its open subtasks always come along, however old; the day only picks the DONE work: done subtasks ticked
  // in the range (their u stamp), done tasks done in the range (updatedTs). A trimmed task keeps only those subtasks (in
  // subs AND in its Markdown lines: the k-th subtask line = subs[k]).
  const inDay = (ts, day) => ts >= day.from && ts <= day.to;
  function trimTask(t, { day = null } = {}) {
    if (!day) return t;
    if (t.isDone) return inDay(t.updatedTs || 0, day) ? t : null;
    const all = t.subs || [];
    const kept = all.map(x => !x.done || inDay(stampTs(x.u), day));
    if (kept.every(Boolean)) return t;
    let k = -1;
    const lines = t.lines && t.lines.length ? t.lines.filter((l, i) => i === 0 || !SUB_LINE.test(l) || kept[++k]) : t.lines;
    return { ...t, subs: all.filter((x, i) => kept[i]), lines };
  }
  // a whole local day (or a span of days) → { from, to } in ms
  function dayRange(a, b = a) {
    const s = new Date(Math.min(+a, +b)), e = new Date(Math.max(+a, +b));
    return { from: new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime(), to: new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1).getTime() - 1 };
  }

  function md(groups, date, o = {}) {
    const mode = subMode(o.withSubs);
    const block = t => (t.lines && t.lines.length ? subLines(t.lines, mode, t.subs).map(l => stripMeta(l, o)) : [`- [${t.isDone ? 'x' : ' '}] ${t.title}`]).join('\n');
    return groups.map(g => {
      const tasks = [...g.done, ...g.now, ...g.open];
      if (!tasks.length) return null;
      // a blank line after each main task (owner 2026-09-30): readable as plain text and in any Markdown viewer
      return [`## ${g.name} · ${date}`, ...tasks.map(block)].join('\n\n');
    }).filter(Boolean).join('\n\n') + '\n';
  }

  // ONE task in plain text (the WhatsApp-friendly shape): "# Task", _notes_, "* sub" bullets, done struck
  function plainTask(t, done, o = {}) {
    const extra = (p, due) => [o.withPrio && p ? p : null, o.withDates && due ? due : null].filter(Boolean).map(x => ' · ' + x).join('');
    const strike = s => (s ? `~${s.replace(/~/g, '')}~` : s); // a struck line can't hold its own strike marks
    const out = [`# ${done ? strike(waMarks(t.title)) : waMarks(t.title)}${extra(t.priority, t.dueText)}`];
    for (const n of t.notes || []) if (clean(n)) out.push(`_${waMarks(n).replace(/_/g, '')}_`);
    const mode = subMode(o.withSubs), subs = t.subs || [];
    const shown = mode === 'off' ? [] : [...byNewest(subs.filter(s => !s.done), subTs), ...(mode === 'all' ? byNewest(subs.filter(s => s.done), subTs) : [])];
    for (const s of shown) out.push(`* ${done || s.done ? strike(waMarks(s.t)) : waMarks(s.t)}${extra(s.p, null)}`);
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

  // fmt: 'md' | 'text' (plain text = the WhatsApp-friendly shape; legacy 'wa' = text); date: the notation date ("29 Sep");
  // labels: { done, now, next } for the plain-text section headings. Include toggles (owner 2026-09-30) work in BOTH formats;
  // left unset they default per format: Markdown keeps priority + dates (the note as written), plain text leaves them out;
  // subtasks default to 'all' in both
  // day: the #12 filter ({ from, to } or null)
  function buildShare({ groups, fmt = 'text', withPrio, withDates, withSubs = true, date = '', labels, day = null } = {}) {
    const trim = arr => (arr || []).map(t => trimTask(t, { day })).filter(Boolean);
    const gs = (groups || []).map(g => ({ name: g.name, done: trim(g.done), now: trim(g.now), open: trim(g.open) }));
    return fmt === 'md'
      ? md(gs, date, { withSubs, withPrio: withPrio !== false, withDates: withDates !== false })
      : wa(gs, date, { withPrio: !!withPrio, withDates: !!withDates, withSubs, labels });
  }

  // the island's quick Copy (owner 2026-09-29): ONE task as Markdown (its block exactly as the note has it) or plain text
  // o = the Share panel's Include options for that format (owner 2026-09-30: the island copy matches them); unset = the
  // same per-format defaults as buildShare
  // o.day (the copy list's Today, #5) trims the task first; nothing changed that day → ''
  function taskText(t0, fmt = 'text', o = {}) {
    const t = trimTask(t0, { day: o.day || null });
    if (!t) return '';
    if (fmt === 'md') {
      const mo = { withSubs: o.withSubs, withPrio: o.withPrio !== false, withDates: o.withDates !== false };
      return (t.lines && t.lines.length ? subLines(t.lines, subMode(mo.withSubs), t.subs).map(l => stripMeta(l, mo)) : [`- [${t.isDone ? 'x' : ' '}] ${t.title}`]).join('\n') + '\n';
    }
    return plainTask(t, !!t.isDone, { withSubs: o.withSubs, withPrio: !!o.withPrio, withDates: !!o.withDates });
  }

  const ShareText = { buildShare, taskText, trimTask, dayRange, activity };
  if (typeof window !== 'undefined') window.ShareText = ShareText;
  if (typeof module !== 'undefined') module.exports = ShareText;
})();
