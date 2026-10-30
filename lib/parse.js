'use strict';
// Parser for the two Obsidian todo notes. ONE format out (v2), tolerant in.
// v3 (owner 2026-09-29): "- [ ] /now !! 24 Sep -- Task title" — /now (Now), priority, day+month, then "--" and the title.
//   A bare leading "*" rendered as a bullet / indent in Markdown and the wide dash can't be typed, so the app WRITES
//   /now and "--"; it still READS v2 ("- [ ] * !! 24 Sep — Task title") and any "-", "--" or "—" separator.
// legacyA: "- [ ] Task title — !! — due:2026-09-24"  (trailing priority/due)
// legacyB: "- [ ] 2026-08-23 — Task title"           (leading ISO date — old personal style)
const fs = require('fs');
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_IDX = {};
MONTHS.forEach((m, i) => { MONTH_IDX[m.toLowerCase()] = i + 1; });

function monthFromToken(tok) {
  if (!tok) return null;
  const t = tok.toLowerCase().slice(0, 3);
  return MONTH_IDX[t] ? MONTHS[MONTH_IDX[t] - 1] : null;
}

// ponytail: year inference — current year, rolls to next year only if >45 days in the past
// (lets "23 Aug" stay an overdue this-year task in September; ceiling: a genuinely old task looks "future" after ~6 weeks)
// time = minutes after midnight (#7) or null → noon of the due day (the old rule: daysLate math assumes noon)
function resolveDue(due, time = null) {
  const now = new Date();
  const hh = time == null ? 12 : Math.floor(time / 60), mm = time == null ? 0 : time % 60;
  if (!due) return time == null ? null : new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm).getTime(); // a bare time = today
  const build = y => new Date(y, MONTH_IDX[due.m.toLowerCase()] - 1, due.d, hh, mm).getTime();
  let ts = build(now.getFullYear());
  if (ts < now.getTime() - 45 * 864e5) ts = build(now.getFullYear() + 1);
  return ts;
}

// Due time (owner 2026-10-05, task #7): an optional time-of-day right after the date — "28 Sep 2pm", "28 Sep 2:30pm",
// and 24 h "28 Sep 14:30" is read too. The app WRITES the 12 h form ("2pm", "2:30pm"). A time with no date = today.
const TIME_SRC = '(\\d{1,2})(?::(\\d{2}))?\\s?([ap])\\.?m\\.?|(\\d{1,2}):(\\d{2})';
const TIME_ONLY = new RegExp('^(?:' + TIME_SRC + ')$', 'i');
function parseTime(tok) {
  const m = String(tok || '').trim().match(TIME_ONLY);
  if (!m) return null;
  if (m[3]) { // 12 h
    const h = +m[1], mi = m[2] === undefined ? 0 : +m[2];
    if (h < 1 || h > 12 || mi > 59) return null;
    return (h % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + mi;
  }
  const h = +m[4], mi = +m[5];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
function fmtTime(min) {
  if (min == null) return null;
  const h = Math.floor(min / 60), mi = min % 60, h12 = h % 12 || 12;
  return `${h12}${mi ? ':' + String(mi).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
}
const LEAD_TIME = new RegExp('^(' + TIME_SRC + ')(?:\\s+|\\s*(?=[—-]{1,2}\\s))(.+)$', 'i');
// "D Mon[ time]" or a bare time typed in the editor / sent over IPC → { due, time } (either may be null)
function parseDueText(str) {
  const s = String(str || '').trim();
  const m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(.+))?$/);
  if (m && monthFromToken(m[2])) return { due: { d: +m[1], m: monthFromToken(m[2]) }, time: m[3] ? parseTime(m[3]) : null };
  const t = parseTime(s);
  return { due: null, time: t };
}

const TASK_RE = /^(\s*)- \[([ xX])\] (.*)$/;

// Hidden stamps (owner, 2026-09-27): an optional HTML comment at the END of a task line —
//   "- [ ] !! 28 Sep — Title <!-- c:2026-09-27T14:05 u:2026-09-27T15:10 -->"
// c = created, u = last updated (local time, minutes). Markdown renderers (Obsidian reading view, GitHub) hide it.
// Optional: hand-typed tasks without it are fully valid; the app writes it only on the user's own clicks.
// Any other trailing comment is NOT a stamp and stays part of the title.
// Hidden id (owner 2026-10-10): the same comment also carries "id:k3x9q2" = the line's own name for anything that points
// at it (attachments in state.json, future references). It survives renames, moves and hand edits of the title. New
// lines get one when added (or first touched); older lines once at app start (ensureIds), which also re-ids a hand-copied
// duplicate.
const STAMP_RE = /\s*<!--\s*((?:(?:[cu]:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|id:[a-z0-9]{4,16})\s*)+)-->\s*$/;
const newId = () => require('crypto').randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6);
const pad2 = n => String(n).padStart(2, '0');
function stampNow(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function splitStamp(rest) {
  const m = rest.match(STAMP_RE);
  if (!m) return { rest, created: null, updated: null, uid: null };
  const val = k => { const x = m[1].match(new RegExp('(?:^|\\s)' + k + ':(\\S+)')); return x ? x[1] : null; };
  return { rest: rest.slice(0, m.index), created: val('c'), updated: val('u'), uid: val('id') };
}
const stampMs = s => (s ? new Date(s).getTime() || 0 : 0); // 'YYYY-MM-DDTHH:MM' parses as LOCAL time

function parseMeta(rest) {
  let s = rest.trim();
  const out = { priority: null, due: null, time: null };
  // trailing legacy tokens, either order ("— due:YYYY-MM-DD", "— med", "— !!")
  for (let pass = 0; pass < 2; pass++) {
    let m = s.match(/\s*[—-]{1,2}\s*due:\s*(\d{4})-(\d{2})-(\d{2})\s*$/i);
    if (m) { out.due = { d: +m[3], m: MONTHS[+m[2] - 1] }; s = s.slice(0, m.index).trim(); continue; }
    m = s.match(/\s*[—-]{1,2}\s*(?:priority:\s*)?(!!!|!!|!|high|med|medium|low)\s*$/i);
    if (m) {
      const map = { high: '!!!', med: '!!', medium: '!!', low: '!' };
      out.priority = map[m[1].toLowerCase()] || m[1];
      s = s.slice(0, m.index).trim(); continue;
    }
    break;
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})\s*[—-]{1,3}\s*(.+)$/); // leading ISO (old personal)
  if (m) { out.due = { d: +m[3], m: MONTHS[+m[2] - 1] }; s = m[4].trim(); }
  else {
    // leading meta loop — order-independent tokens: '/now' or legacy '*' (active) / '!{1,3}' (priority) / 'D Mon' (due)
    for (;;) {
      m = s.match(/^\/now(?:\s+|\s*[—-]{1,2}\s*)(.+)$/i);
      if (m) { out.active = true; s = m[1].replace(/^[—-]{1,2}\s*/, '').trim(); continue; }
      m = s.match(/^([*!]{1,3})\s+(.+)$/);
      if (m && /[*!]+/.test(m[1])) {
        const bangs = [...m[1]].filter(c => c === '!').join('');
        if (m[1].includes('*')) out.active = true;
        if (bangs) out.priority = bangs; // leading token wins over a trailing legacy dup
        s = m[2].replace(/^[—-]{1,2}\s*/, '').trim();
        continue;
      }
      m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+|[—-]{1,2}\s+)(.+)$/);
      if (m) {
        const mo = monthFromToken(m[2]);
        if (mo) {
          out.due = { d: +m[1], m: mo }; s = m[3];
          const tm = s.match(LEAD_TIME); // "28 Sep 2pm …": the time sits right after the date (never after a separator)
          if (tm && parseTime(tm[1]) != null) { out.time = parseTime(tm[1]); s = tm[tm.length - 1]; }
          s = s.replace(/^[—-]{1,2}\s*/, '').trim(); continue;
        }
      }
      // a bare time (no date) = today; it must be followed by a separator or another token, so a title like
      // "9am standup" stays a title
      m = s.match(LEAD_TIME);
      if (m && out.time == null && parseTime(m[1]) != null && /^(?:[—-]{1,2}\s|\/now\b|[*!]{1,3}\s|\d{1,2}\s+[A-Za-z]{3})/i.test(m[m.length - 1])) {
        out.time = parseTime(m[1]); s = m[m.length - 1].replace(/^[—-]{1,2}\s*/, '').trim(); continue;
      }
      break;
    }
  }
  if (!s) return null;
  out.title = s;
  return out;
}

// a subtask's typed text: leading bangs are its priority, the rest is the title (no Now / due tokens for subtasks)
function subMeta(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(!{1,3})\s+(.+)$/);
  return m ? { title: m[2].trim(), priority: m[1] } : { title: s, priority: null };
}

const entryIndent = e => (e.type === 'task' ? e.task.indent : e.text.match(/^\s*/)[0]);
const indentWidth = s => s.replace(/\t/g, '    ').length;

function parseTaskLine(line) {
  const m = line.match(TASK_RE);
  if (!m) return null;
  const st = splitStamp(m[3]);
  const meta = parseMeta(st.rest);
  if (!meta) return null;
  const t = {
    indent: m[1], checked: m[2] !== ' ',
    title: meta.title, priority: meta.priority, due: meta.due, time: meta.time == null ? null : meta.time, active: !!meta.active,
    created: st.created, updated: st.updated, uid: st.uid,
    // subtask = tab or 2+ spaces; a single leading space (personal-note style) is still top-level
    subtask: m[1].includes('\t') || m[1].length >= 2, raw: line, dirty: false, phase: false
  };
  // phases (owner 2026-10-29): "#phase" at the END of a subtask's title marks a milestone. Stripped here, re-written by
  // fmtTask; `raw` keeps the line, so untouched notes round-trip byte-identical. On a top task the tag is just text.
  if (t.subtask) {
    const pm = t.title.match(/\s+#phase\s*$/i);
    if (pm) { t.phase = true; t.title = t.title.slice(0, pm.index); }
  }
  return t;
}

function fmtTask(t) {
  const meta = [t.active ? '/now' : null, t.priority, t.due ? `${t.due.d} ${t.due.m}` : null, t.time != null ? fmtTime(t.time) : null].filter(Boolean).join(' ');
  const stamp = [t.uid ? 'id:' + t.uid : null, t.created ? 'c:' + t.created : null, t.updated ? 'u:' + t.updated : null].filter(Boolean).join(' ');
  const title = t.subtask && t.phase ? `${t.title} #phase` : t.title;
  return `${t.indent}- [${t.checked ? 'x' : ' '}] ${meta ? meta + ' -- ' : ''}${title}${stamp ? ` <!-- ${stamp} -->` : ''}`;
}

const TASK_GAP = 2; // blank lines after each task block on an app save (owner 2026-10-01; see NoteFile.spaceTasks)

function parseDoc(text) {
  return text.split(/\r?\n/).map(line => {
    const t = parseTaskLine(line);
    return t ? { type: 'task', task: t } : { type: 'raw', text: line };
  });
}

function docToText(doc, eol) {
  // unchanged tasks emit their raw line verbatim => clean round-trip is byte-identical for any file
  return doc.map(e => (e.type === 'task' ? (e.task.dirty ? fmtTask(e.task) : e.task.raw) : e.text)).join(eol);
}

class NoteFile {
  constructor(filePath, opts = {}) {
    this.path = filePath;
    this.doneHeading = opts.doneHeading || null;   // e.g. '## Done' — checked tasks move under it
    this.fileTag = opts.fileTag || require('path').basename(filePath);
    this.reload();
  }
  reload() {
    const text = fs.readFileSync(this.path, 'utf8');
    this.eol = text.includes('\r\n') ? '\r\n' : '\n';
    this.doc = parseDoc(text);
    this._index();
  }
  // every real change to a top task (content, Now, priority, due, done, subtasks, description) → u = now.
  // #11 (owner 2026-10-05): a subtask's own add / tick / rename / priority stamps the SUBTASK line too (c on add).
  // Old tasks get no invented created stamp. Reordering is position, not content: no stamp.
  _touch(t) { if (t) { t.updated = stampNow(); t.uid = t.uid || newId(); t.dirty = true; } }
  // every task and subtask line (open and done) gets a hidden id; a duplicate (a hand-copied line) gets a fresh one.
  // `seen` is shared across both notes by the caller. The id is spliced into the RAW line (an existing stamp comment
  // gains it, else one is appended), so the rest of a hand-typed line stays byte-identical (legacy tokens are not
  // re-formatted). Returns how many lines changed.
  ensureIds(seen = new Set()) {
    let n = 0;
    for (const e of this.doc) {
      if (e.type !== 'task') continue;
      const t = e.task;
      if (t.uid && !seen.has(t.uid)) { seen.add(t.uid); continue; }
      do t.uid = newId(); while (seen.has(t.uid));
      seen.add(t.uid); n++;
      if (t.dirty) continue; // fmtTask writes it
      const m = t.raw.match(STAMP_RE);
      const toks = m ? m[1].trim().split(/\s+/).filter(k => !k.startsWith('id:')) : [];
      t.raw = (m ? t.raw.slice(0, m.index) : t.raw.replace(/\s+$/, '')) + ` <!-- ${['id:' + t.uid, ...toks].join(' ')} -->`;
    }
    return n;
  }
  findByUid(uid) { return (uid && this.tasks.find(t => t.uid === uid)) || null; }
  _index() { this.tasks = this.doc.filter(e => e.type === 'task' && !e.task.subtask).map(e => e.task); }
  topTasks() { return this.tasks; }
  entryOf(task) { return this.doc.find(e => e.type === 'task' && e.task === task); }
  // a task's block = the task line + contiguous subtasks AND indented plain lines (its description)
  _blockRange(task) {
    const i = this.doc.indexOf(this.entryOf(task));
    let j = i + 1;
    while (j < this.doc.length) {
      const e = this.doc[j];
      if (e.type === 'task' && e.task.subtask) { j++; continue; }
      if (e.type === 'raw' && e.text !== '' && /^\s/.test(e.text)) { j++; continue; }
      break;
    }
    return [i, j];
  }
  // the block + the blank lines after it — what moves or goes away with a task, so its gap travels with it
  // (spaceTasks re-spaces on save); undo captures still use the exact block (_blockRange)
  _takeRange(task) {
    const [i, j0] = this._blockRange(task);
    let j = j0;
    while (j < this.doc.length && this.doc[j].type === 'raw' && this.doc[j].text.trim() === '') j++;
    if (j === this.doc.length && j > j0) j--; // the file's final newline stays where it is
    return [i, j];
  }
  subtasksOf(task) {
    const [i, j] = this._blockRange(task);
    return this.doc.slice(i + 1, j).filter(e => e.type === 'task').map(e => e.task);
  }
  // ---- phases (owner 2026-10-29) ----
  // A phase = a FIRST-LEVEL subtask marked "#phase"; the subtasks indented one level deeper right under it are its
  // steps. The "unit" of a subtask = its line + the deeper lines right after it (exactly what takeSubtask lifts).
  // First-level = its indentWidth equals the smallest subtask indentWidth in the block; anything deeper = a step.
  _unitRange(task, sub) {
    const end = this._blockRange(task)[1], i = this.doc.indexOf(this.entryOf(sub)), w = indentWidth(sub.indent);
    let j = i + 1;
    while (j < end && indentWidth(entryIndent(this.doc[j])) > w) j++;
    return [i, j];
  }
  subInfo(task) { // [{ sub, under }] in note order — under = the first-level subtask this line sits under (null = first-level)
    const subs = this.subtasksOf(task);
    const min = subs.length ? Math.min(...subs.map(s => indentWidth(s.indent))) : 0;
    let cur = null;
    return subs.map(sub => (indentWidth(sub.indent) === min ? (cur = sub, { sub, under: null }) : { sub, under: cur }));
  }
  _reindent(entries, base, L) { // L = the target's one-level-under prefix; relative indent inside the unit is kept
    for (const e of entries) {
      const old = entryIndent(e), next = L + (old.startsWith(base) ? old.slice(base.length) : L.slice(-1));
      if (e.type === 'task') { e.task.raw = next + e.task.raw.slice(old.length); e.task.indent = next; }
      else e.text = next + e.text.slice(old.length);
    }
  }
  _outdent(entries, base) { // drop one `base` indent prefix in place (a phase's steps → first level); odd indents stay
    for (const e of entries) {
      const old = entryIndent(e);
      if (!old.startsWith(base)) continue;
      const next = old.slice(base.length);
      if (e.type === 'task') { e.task.raw = next + e.task.raw.slice(old.length); e.task.indent = next; }
      else e.text = next + e.text.slice(old.length);
    }
  }
  // mark / unmark a phase. Off also outdents its steps one level in place (they become quick first-level subtasks).
  // Only a first-level subtask; returns true on a change.
  setPhase(parentId, subTitle, on) {
    const parent = this.findById(parentId);
    const info = parent && this.subInfo(parent).find(x => x.sub.title === subTitle);
    if (!info || info.under) return false;
    const sub = info.sub;
    if (!!sub.phase === !!on) return false;
    sub.phase = !!on; this._touch(sub);
    if (!on) {
      const [i, j] = this._unitRange(parent, sub);
      this._outdent(this.doc.slice(i + 1, j), sub.indent);
    }
    this._touch(parent);
    return true;
  }
  // Tab: a first-level quick subtask (with its unit) joins the END of the nearest phase above it, one level deeper
  nestSubtask(parentId, subTitle) {
    const parent = this.findById(parentId);
    const info = parent && this.subInfo(parent).find(x => x.sub.title === subTitle);
    if (!parent || !info || info.under || info.sub.phase) return false;
    const at = this.doc.indexOf(this.entryOf(info.sub));
    const phase = this.subInfo(parent).filter(x => !x.under && x.sub.phase && this.doc.indexOf(this.entryOf(x.sub)) < at).pop();
    if (!phase) return false;
    const taken = this.takeSubtask(parentId, subTitle);
    return !!(taken && this.putSubtask(parentId, taken, phase.sub.title));
  }
  // Shift+Tab: a step (with its unit) moves out to first level, right AFTER its phase's unit
  unnestSubtask(parentId, subTitle) {
    const parent = this.findById(parentId);
    const info = parent && this.subInfo(parent).find(x => x.sub.title === subTitle);
    if (!info || !info.under) return false;
    const phase = info.under, taken = this.takeSubtask(parentId, subTitle);
    if (!taken) return false;
    this._reindent(taken, taken[0].task.indent, phase.indent);
    this.doc.splice(this._unitRange(parent, phase)[1], 0, ...taken);
    this._touch(taken[0].task); this._touch(parent);
    this._index();
    return true;
  }
  // drag a subtask of the SAME task onto a phase: it (with its unit) lands at the end of that phase's unit
  moveUnderPhase(parentId, subTitle, phaseTitle) {
    const parent = this.findById(parentId);
    const info = parent && this.subInfo(parent).find(x => x.sub.title === subTitle);
    const ph = parent && this.subInfo(parent).find(x => !x.under && x.sub.phase && x.sub.title === phaseTitle);
    if (!info || !ph || info.sub.phase || info.under === ph.sub) return false;
    const taken = this.takeSubtask(parentId, subTitle);
    return !!(taken && this.putSubtask(parentId, taken, phaseTitle));
  }
  // drag a subtask to a new place among its OWN task's subtasks (owner 2026-10-30): the drop position decides the
  // level. underTitle = a first-level phase → it lands among that phase's steps; null → among the first-level
  // subtasks (a step leaves its phase). beforeTitle = the subtask it lands right before (null = the end of the
  // destination group). A phase never goes under a phase; whatever moves carries its unit (takeSubtask). Every
  // refusal — unknown title, before outside the group, before === itself, an in-place drop — changes nothing.
  reorderSubtask(parentId, subTitle, beforeTitle, underTitle) {
    const parent = this.findById(parentId);
    const subs = parent && this.subInfo(parent);
    const info = subs && subs.find(x => x.sub.title === subTitle);
    if (!info || beforeTitle === subTitle) return false;
    const under = underTitle ? subs.find(x => !x.under && x.sub.phase && x.sub.title === underTitle) : null;
    if (underTitle && !under) return false;
    if (under && info.sub.phase) return false; // a phase always stays first-level
    const before = beforeTitle ? subs.find(x => x.sub.title === beforeTitle && x.under === (under ? under.sub : null)) : null;
    if (beforeTitle && !before) return false; // not in the destination group
    if (info.under === (under ? under.sub : null)) { // same group: already in place = nothing to move
      const end = this._unitRange(parent, info.sub)[1];
      if (before ? this.doc[end] === this.entryOf(before.sub)
        : end === (under ? this._unitRange(parent, under.sub)[1] : this._blockRange(parent)[1])) return false;
    }
    const L = this.subtasksOf(parent).reduce((a, s) => indentWidth(s.indent) < indentWidth(a) ? s.indent : a, '\t'); // first level, read before taking
    const taken = this.takeSubtask(parentId, subTitle);
    if (!taken) return false;
    this._reindent(taken, taken[0].task.indent, under ? under.sub.indent + under.sub.indent.slice(-1) : L);
    const at = before ? this.doc.indexOf(this.entryOf(before.sub))
      : under ? this._unitRange(parent, under.sub)[1] : this._blockRange(parent)[1];
    this.doc.splice(at, 0, ...taken);
    this._touch(taken[0].task); this._touch(parent);
    this._index();
    return true;
  }
  // Share → Markdown (owner 2026-09-29): the task's block EXACTLY as the note has it (task line, description, subtasks,
  // same indents and tokens), minus the hidden c:/u: stamp. A line the app changed but hasn't saved yet reads as it will be.
  blockLines(task) {
    const [i, j] = this._blockRange(task);
    return this.doc.slice(i, j).map(e => {
      if (e.type !== 'task') return e.text;
      const line = e.task.dirty ? fmtTask(e.task) : e.task.raw;
      return line.replace(STAMP_RE, '');
    });
  }
  // the task's OWN description lines: plain lines of its block that don't sit inside a subtask's unit (a line indented
  // deeper right under a subtask belongs to that subtask — e.g. the description a task carries when it is dragged into
  // another one, owner 2026-10-29). Before that change every plain line of the block counted, so setNotes moved them.
  _ownNotes(task) {
    const [i, j] = this._blockRange(task);
    const own = [];
    let w = null; // the indent width of the subtask whose unit we are in (null = not in one)
    for (const e of this.doc.slice(i + 1, j)) {
      if (e.type === 'task') { w = indentWidth(e.task.indent); continue; }
      if (w !== null && indentWidth(entryIndent(e)) > w) continue;
      w = null; own.push(e);
    }
    return own;
  }
  notesOf(task) {
    return this._ownNotes(task).map(e => e.text.trim());
  }
  setNotes(id, lines) {
    const t = this.findById(id);
    if (!t) return;
    const [i, j] = this._blockRange(t);
    const head = this.doc[i];
    const own = new Set(this._ownNotes(t));
    const subs = this.doc.slice(i + 1, j).filter(e => !own.has(e)); // subtasks + the lines under them, in order
    const notes = (lines || []).filter(l => l && l.trim()).map(l => ({ type: 'raw', text: '\t' + l.trim() }));
    const before = this.notesOf(t).join('\n');
    this.doc.splice(i, j - i, head, ...notes, ...subs);
    if (notes.map(n => n.text.trim()).join('\n') !== before) this._touch(t);
    this._index();
  }
  id(task) { return `${this.fileTag}#${task.title}#${task.priority || ''}#${task.due ? task.due.d + task.due.m : ''}${task.time != null ? '@' + task.time : ''}`; }
  findById(id) { return this.tasks.find(t => this.id(t) === id) || null; }
  text() { return docToText(this.doc, this.eol); }
  // TASK_GAP blank lines after every top task block (owner 2026-10-01: the raw note reads task by task, not as one
  // long run of lines). Set on every app save for the whole note (both notes, Open and Done), so the gap travels with
  // each task through add / move / complete / restore / delete / undo and old pile-ups shrink to the gap. Headings and
  // other text between tasks stay; a run of blanks that reaches the end of the file keeps just the final newline.
  spaceTasks() {
    const d = this.doc, out = [];
    const cont = e => (e.type === 'task' && e.task.subtask) || (e.type === 'raw' && e.text !== '' && /^\s/.test(e.text)); // = _blockRange
    let k = 0;
    while (k < d.length) {
      const e = d[k++];
      out.push(e);
      if (e.type !== 'task' || e.task.subtask) continue;
      while (k < d.length && cont(d[k])) out.push(d[k++]);
      let n = 0;
      while (k < d.length && d[k].type === 'raw' && d[k].text.trim() === '') { n++; k++; }
      const gap = k >= d.length ? Math.min(n, 1) : TASK_GAP;
      for (let i = 0; i < gap; i++) out.push({ type: 'raw', text: '' });
    }
    this.doc = out;
    this._index();
  }
  save() {
    this.spaceTasks();
    const text = this.text();
    try {
      const tmp = this.path + '.tmp';
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, this.path);
    } catch (e) { fs.writeFileSync(this.path, text); } // ponytail: if rename blocked (Obsidian lock), direct write
  }
  _freshTask(data) {
    const now = stampNow();
    return { indent: '', checked: false, title: data.title, priority: data.priority || null,
      due: data.due || null, time: data.time == null ? null : data.time, active: !!data.active, created: now, updated: now, uid: newId(), subtask: false, raw: '', dirty: true, phase: false };
  }
  addTask(data) {
    const entry = { type: 'task', task: this._freshTask(data) };
    if (this.doneHeading) { // right after the last open task — never a new blank line (they piled up before ## Done)
      const h = this.doc.findIndex(e => e.type === 'raw' && e.text.trim() === this.doneHeading);
      if (h !== -1) { this.doc.splice(this._endOfTasks(), 0, entry); this._index(); return entry.task; }
    }
    // append after last non-empty entry (keeps trailing newline last)
    let last = this.doc.length - 1;
    while (last >= 0 && this.doc[last].type === 'raw' && this.doc[last].text.trim() === '') last--;
    this.doc.splice(last + 1, 0, entry);
    this._index();
    return entry.task;
  }
  addSubtask(parentId, text, underTitle) {
    const parent = this.findById(parentId);
    if (!parent) return;
    const subs = this.subtasksOf(parent);
    const { title, priority } = subMeta(text);
    if (!title) return;
    const now = stampNow(); // #11 (owner 2026-10-05): subtasks carry the hidden c/u stamp too
    const sub = { indent: '\t', checked: false, title, priority, phase: false, due: null, created: now, updated: now, uid: newId(), subtask: true, raw: '', dirty: true };
    // underTitle = a first-level PHASE: the new subtask becomes one of its steps (one level deeper, at the unit's end).
    // Without it: after the last subtask's WHOLE unit — a first-level line never lands between a phase and its steps.
    const under = underTitle && this.subInfo(parent).find(x => !x.under && x.sub.phase && x.sub.title === underTitle);
    let at;
    if (under) { sub.indent = under.sub.indent + under.sub.indent.slice(-1); at = this._unitRange(parent, under.sub)[1]; }
    else at = subs.length ? this._unitRange(parent, subs[subs.length - 1])[1] : this.doc.indexOf(this.entryOf(parent)) + 1;
    this.doc.splice(at, 0, { type: 'task', task: sub });
    this._touch(parent);
    this._index();
  }
  update(id, patch) {
    const t = this.findById(id);
    if (!t) return;
    const was = fmtTask({ ...t, updated: null });
    if (patch.title !== undefined) t.title = patch.title;
    if (patch.priority !== undefined) t.priority = patch.priority || null;
    if (patch.due !== undefined) t.due = patch.due || null;
    if (patch.time !== undefined) t.time = patch.time == null ? null : patch.time;
    if (patch.active !== undefined) t.active = !!patch.active;
    if (fmtTask({ ...t, updated: null }) !== was) this._touch(t); // a save that changes nothing leaves the stamp alone
    t.dirty = true; // ponytail: id changes when title/prio/due change — an active-task pointer may go stale until re-picked
  }
  toggleActive(id) {
    const t = this.findById(id);
    if (!t) return;
    t.active = !t.active; this._touch(t);
  }
  toggleSubtask(parentId, subTitle) {
    // ponytail: subtasks addressed by title text — a duplicate title toggles the first match
    const parent = this.findById(parentId);
    if (!parent) return;
    const sub = this.subtasksOf(parent).find(s => s.title === subTitle);
    if (!sub) return;
    sub.checked = !sub.checked; this._touch(sub); this._touch(parent); // a tick: the subtask's u = when it was done
  }
  // rename one subtask (side-panel editor, owner 2026-09-28): only its title text changes — tick state, indent and any
  // leading meta stay. An empty or unchanged title is a no-op (deleting is its own action). Returns true on a change.
  // Typed leading bangs set its priority ("!! call Sam"); without them the priority stays (the panel's bang clears it).
  renameSubtask(parentId, subTitle, newTitle) {
    const parent = this.findById(parentId);
    const { title, priority } = subMeta(newTitle);
    if (!parent || !title) return false;
    const sub = this.subtasksOf(parent).find(s => s.title === subTitle);
    if (!sub) return false;
    const p = priority || sub.priority;
    if (title === sub.title && p === sub.priority) return false;
    sub.title = title; sub.priority = p; this._touch(sub); this._touch(parent);
    return true;
  }
  // move a subtask to another task (owner 2026-10-09): takeSubtask lifts it out together with the lines indented deeper
  // right under it (its own notes / nested items); putSubtask files them at the end of the new parent's block, re-indented
  // one level under it. Tick, priority and the c stamp travel; the subtask and both parents get u. Two files = take on
  // one NoteFile, put on the other. takeSubtask returns the doc entries (null if not found).
  takeSubtask(parentId, subTitle) {
    const parent = this.findById(parentId);
    const sub = parent && this.subtasksOf(parent).find(s => s.title === subTitle);
    if (!sub) return null;
    const end = this._blockRange(parent)[1], i = this.doc.indexOf(this.entryOf(sub)), w = indentWidth(sub.indent);
    let j = i + 1;
    while (j < end && indentWidth(entryIndent(this.doc[j])) > w) j++;
    const taken = this.doc.splice(i, j - i);
    this._touch(parent);
    this._index();
    return taken;
  }
  putSubtask(parentId, entries, underTitle) {
    const parent = this.findById(parentId);
    if (!parent || !entries || !entries.length || entries[0].type !== 'task') return false;
    if (underTitle && entries[0].task.phase) return false; // a phase never goes under a phase — the caller keeps it
    // underTitle = a first-level PHASE of this task: the entries land at the END of its unit, one level under it
    const under = underTitle && this.subInfo(parent).find(x => !x.under && x.sub.phase && x.sub.title === underTitle);
    this._reindent(entries, entries[0].task.indent, under ? under.sub.indent + under.sub.indent.slice(-1) : '\t');
    this.doc.splice(under ? this._unitRange(parent, under.sub)[1] : this._blockRange(parent)[1], 0, ...entries);
    this._touch(entries[0].task); this._touch(parent);
    this._index();
    return true;
  }
  // drag a whole task INTO another task of the same note (owner 2026-10-29): the dragged task becomes a first-level
  // subtask of the target — title, bangs, hidden id and the c stamp travel; due / time / Now drop (a subtask keeps
  // importance only) and it is never a phase. Its description lines follow right under it one level deeper; its subtasks
  // follow after them as first-level subtasks (flattened one level, phases stay phases), each with the lines indented
  // under it. The whole run lands at the END of the target's block. False unless both are open top tasks, and not the
  // same one. Returns the new subtask.
  taskToSubtask(id, targetId) {
    const t = this.findById(id), target = this.findById(targetId);
    if (!t || !target || t === target || t.checked || target.checked) return false;
    const [i, j] = this._takeRange(t); // with its gap, so nothing is left behind (spaceTasks re-spaces on save)
    const block = this.doc.splice(i, j - i);
    while (block.length && block[block.length - 1].type === 'raw' && block[block.length - 1].text.trim() === '') block.pop();
    const narrow = ts => ts.reduce((a, s) => indentWidth(s.indent) < indentWidth(a) ? s.indent : a, ts[0].indent);
    const L = this.subtasksOf(target).reduce((a, s) => indentWidth(s.indent) < indentWidth(a) ? s.indent : a, '\t'); // the target's first level
    const inner = L + L.slice(-1); // one level under the new subtask (its description lines)
    const takenSubs = block.slice(1).filter(e => e.type === 'task').map(e => e.task);
    const S = takenSubs.length ? narrow(takenSubs) : L; // the dragged task's own first level
    // split what followed the task line: head description lines, then first-level subtask units (a subtask + the
    // lines indented under it) — exactly what takeSubtask would lift one by one
    const head = [], units = [];
    let cur = head;
    for (const e of block.slice(1)) {
      if (e.type === 'task' && indentWidth(e.task.indent) === indentWidth(S)) { cur = [e]; units.push(cur); continue; }
      cur.push(e);
    }
    this._reindent(head, S, inner);
    for (const u of units) this._reindent(u, S, L);
    const sub = block[0].task; // the task line itself: a subtask now, importance only
    sub.subtask = true; sub.phase = false; sub.indent = L;
    sub.due = null; sub.time = null; sub.active = false;
    this._touch(sub);
    this.doc.splice(this._blockRange(target)[1], 0, block[0], ...head, ...units.flat());
    this._touch(target);
    this._index();
    return sub;
  }
  // open subtasks first, IN THE NOTE (owner 2026-10-09: "order inside the md itself, not in memory"): main runs this at
  // startup. A subtask travels with the lines indented deeper under it; a description line between subtasks stays where it
  // is (only runs of subtasks are reordered). Stable: open ones keep their order, done ones too. Position, not content: no
  // stamp, and the lines themselves stay byte-identical. Returns true when something moved.
  sortSubtasks() {
    let moved = false;
    for (const t of this.tasks) {
      const [i, end] = this._blockRange(t);
      let k = i + 1;
      while (k < end) {
        const run = []; // [{ done, entries }]
        while (k < end && this.doc[k].type === 'task') {
          const w = indentWidth(this.doc[k].task.indent), unit = [this.doc[k++]];
          while (k < end && indentWidth(entryIndent(this.doc[k])) > w) unit.push(this.doc[k++]);
          run.push({ done: unit[0].task.checked, entries: unit });
        }
        if (run.length > 1) {
          const sorted = [...run.filter(u => !u.done), ...run.filter(u => u.done)];
          if (sorted.some((u, n) => u !== run[n])) {
            const start = k - run.reduce((s, u) => s + u.entries.length, 0);
            this.doc.splice(start, k - start, ...sorted.flatMap(u => u.entries));
            moved = true;
          }
        }
        if (!run.length) k++; // a description line: skip it
      }
    }
    if (moved) this._index();
    return moved;
  }
  // subtask priority (owner 2026-09-29): importance only — subtasks get no Now and no due date from the app.
  // p = '!' | '!!' | '!!!' | null. Returns true on a real change.
  setSubtaskPriority(parentId, subTitle, p) {
    const parent = this.findById(parentId);
    if (!parent) return false;
    const sub = this.subtasksOf(parent).find(s => s.title === subTitle);
    const next = ['!', '!!', '!!!'].includes(p) ? p : null;
    if (!sub || (sub.priority || null) === next) return false;
    sub.priority = next; this._touch(sub); this._touch(parent);
    return true;
  }
  // undo support: capture a task block (with subtasks) before mutation, restore the raw lines later
  captureBlock(id) {
    const t = this.findById(id);
    if (!t) return null;
    const [i, j] = this._takeRange(t); // with its gap: delete → undo puts the same lines back
    const lines = this.doc.slice(i, j).map(e => (e.type === 'task' ? e.task.raw : e.text));
    return { index: i, lines, title: t.title };
  }
  restoreBlock(cap) {
    if (!cap) return false;
    // exact rollback: remove any current copy of this task, then splice the captured lines back at the captured index
    this.removeByTitle(cap.title);
    this.insertBlockAt(cap.index, cap.lines);
    return true;
  }
  removeByTitle(title) { // removes the whole block (task + subtasks + description) of the first top task with this title
    const t = this.topTasks().find(x => x.title === title);
    if (!t) return false;
    const [i, j] = this._takeRange(t);
    this.doc.splice(i, j - i);
    this._index();
    return true;
  }
  insertBlockAt(index, lines) {
    const rebuilt = lines.map(l => {
      const t = parseTaskLine(l);
      return t ? { type: 'task', task: t } : { type: 'raw', text: l };
    });
    // the captured index may predate a save that re-spaced the note: never land inside another task's block
    let at = Math.max(0, Math.min(index, this.doc.length));
    const cont = e => (e.type === 'task' && e.task.subtask) || (e.type === 'raw' && e.text !== '' && /^\s/.test(e.text));
    while (at > 0 && at < this.doc.length && cont(this.doc[at])) at++;
    this.doc.splice(at, 0, ...rebuilt);
    this._index();
  }
  complete(id) {
    const t = this.findById(id);
    if (!t) return;
    t.checked = true; this._touch(t); // u = the done date
    if (this.doneHeading) {
      // ponytail: assumes ## Done is a section (insert right under its heading, newest first)
      const [i, j] = this._takeRange(t);
      const block = this.doc.slice(i, j);
      this.doc.splice(i, j - i);
      const h = this.doc.findIndex(e => e.type === 'raw' && e.text.trim() === this.doneHeading);
      this.doc.splice(h === -1 ? this.doc.length : h + 1, 0, ...block);
      this._index();
    }
  }
  deleteTask(id) {
    const cap = this.captureBlock(id); // capture for undo before removing
    if (!cap) return null;
    const [i, j] = this._takeRange(this.findById(id));
    this.doc.splice(i, j - i);
    this._index();
    return cap;
  }
  deleteSubtask(parentId, subTitle) {
    const parent = this.findById(parentId);
    if (!parent) return;
    const sub = this.subtasksOf(parent).find(s => s.title === subTitle);
    if (!sub) return;
    const info = this.subInfo(parent).find(x => x.sub === sub);
    if (sub.phase && !info.under) {
      // a phase: only its line goes — its steps are kept, outdented to first level right where they are
      const [i, j] = this._unitRange(parent, sub);
      this.doc.splice(i, 1);
      this._outdent(this.doc.slice(i, j - 1), sub.indent);
    } else this.doc.splice(this.doc.indexOf(this.entryOf(sub)), 1);
    this._touch(parent);
    this._index();
  }
  uncomplete(id) {
    const t = this.findById(id);
    if (!t) return;
    t.checked = false; this._touch(t);
    if (this.doneHeading) {
      const [i, j] = this._takeRange(t);
      const block = this.doc.slice(i, j);
      this.doc.splice(i, j - i);
      // the tail of the Open section: after the last open task, before the blank line(s) above the Done heading
      const h = this.doc.findIndex(e => e.type === 'raw' && e.text.trim() === this.doneHeading);
      this._index();
      this.doc.splice(h === -1 ? i : this._endOfTasks(), 0, ...block);
    }
    this._index();
  }
  moveTask(id, dir) {
    const t = this.findById(id);
    if (!t) return;
    const k = this.tasks.indexOf(t);
    const other = dir === 'up' ? this.tasks[k - 1] : this.tasks[k + 1];
    if (!other) return; // boundary — nowhere to move
    const [ai, aj] = this._takeRange(t);
    const block = this.doc.splice(ai, aj - ai); // pull A out first: B's range must be recomputed
    const [bi, bj] = this._takeRange(other);
    const otherBlock = this.doc.splice(bi, bj - bi);
    const reinsert = dir === 'up' ? [...block, ...otherBlock] : [...otherBlock, ...block];
    this.doc.splice(Math.min(ai, bi), 0, ...reinsert);
    this._index();
  }
  // move a whole task to the other note (owner 2026-10-10): takeTask lifts its block (task line, description, subtasks,
  // hidden ids + stamps, the blank gap after it); putTask files it after this note's last open task (like addTask).
  // Lines travel byte-identical: a move is position, not content, so no stamp. Two notes = take on one NoteFile, put on
  // the other. takeTask returns the doc entries (null if not found).
  takeTask(id) {
    const t = this.findById(id);
    if (!t) return null;
    const [i, j] = this._takeRange(t);
    const taken = this.doc.splice(i, j - i);
    this._index();
    return taken;
  }
  putTask(entries) {
    if (!entries || !entries.length || entries[0].type !== 'task') return false;
    this.doc.splice(this._endOfTasks(), 0, ...entries);
    this._index();
    return true;
  }
  reorderTask(id, beforeId) { // move a whole task block before another task (null = end of the task list)
    const t = this.findById(id);
    if (!t) return;
    const [i, j] = this._takeRange(t);
    const block = this.doc.splice(i, j - i);
    this._index();
    let at;
    if (beforeId) {
      const target = this.findById(beforeId);
      at = target && target !== t ? this.doc.indexOf(this.entryOf(target)) : this._endOfTasks();
    } else at = this._endOfTasks();
    this.doc.splice(at, 0, ...block);
    this._index();
  }
  _endOfTasks() {
    let at = this.doc.length;
    if (this.doneHeading) {
      const h = this.doc.findIndex(e => e.type === 'raw' && e.text.trim() === this.doneHeading);
      if (h !== -1) at = h;
    } else {
      let last = this.doc.length - 1;
      while (last >= 0 && this.doc[last].type === 'raw' && this.doc[last].text.trim() === '') last--;
      at = last + 1;
    }
    while (at > 0 && this.doc[at - 1].type === 'raw' && this.doc[at - 1].text.trim() === '') at--; // keep the blank line before ## Done
    return at;
  }
  clearDone() {
    let n = 0;
    for (let k = this.doc.length - 1; k >= 0; k--) { // end-down: splices never shift pending blocks
      const e = this.doc[k];
      if (e.type !== 'task' || e.task.subtask || !e.task.checked) continue;
      const [, j] = this._takeRange(e.task);
      this.doc.splice(k, j - k);
      n++;
    }
    this._index();
    return n;
  }
}

module.exports = { parseTime, fmtTime, parseDueText, subMeta, newId, stampNow, stampMs, splitStamp, MONTHS, monthFromToken, resolveDue, parseMeta, parseTaskLine, fmtTask, parseDoc, docToText, NoteFile };
