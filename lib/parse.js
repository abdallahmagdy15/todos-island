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
function resolveDue(due) {
  const now = new Date();
  const build = y => new Date(y, MONTH_IDX[due.m.toLowerCase()] - 1, due.d, 12).getTime();
  let ts = build(now.getFullYear());
  if (ts < now.getTime() - 45 * 864e5) ts = build(now.getFullYear() + 1);
  return ts;
}

const TASK_RE = /^(\s*)- \[([ xX])\] (.*)$/;

// Hidden stamps (owner, 2026-09-27): an optional HTML comment at the END of a task line —
//   "- [ ] !! 28 Sep — Title <!-- c:2026-09-27T14:05 u:2026-09-27T15:10 -->"
// c = created, u = last updated (local time, minutes). Markdown renderers (Obsidian reading view, GitHub) hide it.
// Optional: hand-typed tasks without it are fully valid; the app writes it only on the user's own clicks.
// Any other trailing comment is NOT a stamp and stays part of the title.
const STAMP_RE = /\s*<!--\s*((?:[cu]:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\s*)+)-->\s*$/;
const pad2 = n => String(n).padStart(2, '0');
function stampNow(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function splitStamp(rest) {
  const m = rest.match(STAMP_RE);
  if (!m) return { rest, created: null, updated: null };
  const val = k => { const x = m[1].match(new RegExp('(?:^|\\s)' + k + ':(\\S+)')); return x ? x[1] : null; };
  return { rest: rest.slice(0, m.index), created: val('c'), updated: val('u') };
}
const stampMs = s => (s ? new Date(s).getTime() || 0 : 0); // 'YYYY-MM-DDTHH:MM' parses as LOCAL time

function parseMeta(rest) {
  let s = rest.trim();
  const out = { priority: null, due: null };
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
        if (mo) { out.due = { d: +m[1], m: mo }; s = m[3].replace(/^[—-]{1,2}\s*/, '').trim(); continue; }
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

function parseTaskLine(line) {
  const m = line.match(TASK_RE);
  if (!m) return null;
  const st = splitStamp(m[3]);
  const meta = parseMeta(st.rest);
  if (!meta) return null;
  return {
    indent: m[1], checked: m[2] !== ' ',
    title: meta.title, priority: meta.priority, due: meta.due, active: !!meta.active,
    created: st.created, updated: st.updated,
    // subtask = tab or 2+ spaces; a single leading space (personal-note style) is still top-level
    subtask: m[1].includes('\t') || m[1].length >= 2, raw: line, dirty: false
  };
}

function fmtTask(t) {
  const meta = [t.active ? '/now' : null, t.priority, t.due ? `${t.due.d} ${t.due.m}` : null].filter(Boolean).join(' ');
  const stamp = [t.created ? 'c:' + t.created : null, t.updated ? 'u:' + t.updated : null].filter(Boolean).join(' ');
  return `${t.indent}- [${t.checked ? 'x' : ' '}] ${meta ? meta + ' -- ' : ''}${t.title}${stamp ? ` <!-- ${stamp} -->` : ''}`;
}

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
  // Old tasks get no invented created stamp. Reordering is position, not content: no stamp.
  _touch(t) { if (t) { t.updated = stampNow(); t.dirty = true; } }
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
  subtasksOf(task) {
    const [i, j] = this._blockRange(task);
    return this.doc.slice(i + 1, j).filter(e => e.type === 'task').map(e => e.task);
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
  notesOf(task) {
    const [i, j] = this._blockRange(task);
    return this.doc.slice(i + 1, j).filter(e => e.type === 'raw').map(e => e.text.trim());
  }
  setNotes(id, lines) {
    const t = this.findById(id);
    if (!t) return;
    const [i, j] = this._blockRange(t);
    const head = this.doc[i];
    const subs = this.doc.slice(i + 1, j).filter(e => e.type === 'task');
    const notes = (lines || []).filter(l => l && l.trim()).map(l => ({ type: 'raw', text: '\t' + l.trim() }));
    const before = this.notesOf(t).join('\n');
    this.doc.splice(i, j - i, head, ...notes, ...subs);
    if (notes.map(n => n.text.trim()).join('\n') !== before) this._touch(t);
    this._index();
  }
  id(task) { return `${this.fileTag}#${task.title}#${task.priority || ''}#${task.due ? task.due.d + task.due.m : ''}`; }
  findById(id) { return this.tasks.find(t => this.id(t) === id) || null; }
  text() { return docToText(this.doc, this.eol); }
  save() {
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
      due: data.due || null, active: !!data.active, created: now, updated: now, subtask: false, raw: '', dirty: true };
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
  addSubtask(parentId, text) {
    const parent = this.findById(parentId);
    if (!parent) return;
    const subs = this.subtasksOf(parent);
    const { title, priority } = subMeta(text);
    if (!title) return;
    const sub = { indent: '\t', checked: false, title, priority, due: null, subtask: true, raw: '', dirty: true };
    const after = subs.length ? this.entryOf(subs[subs.length - 1]) : this.entryOf(parent);
    this.doc.splice(this.doc.indexOf(after) + 1, 0, { type: 'task', task: sub });
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
    sub.checked = !sub.checked; sub.dirty = true; this._touch(parent);
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
    sub.title = title; sub.priority = p; sub.dirty = true; this._touch(parent);
    return true;
  }
  // subtask priority (owner 2026-09-29): importance only — subtasks get no Now and no due date from the app.
  // p = '!' | '!!' | '!!!' | null. Returns true on a real change.
  setSubtaskPriority(parentId, subTitle, p) {
    const parent = this.findById(parentId);
    if (!parent) return false;
    const sub = this.subtasksOf(parent).find(s => s.title === subTitle);
    const next = ['!', '!!', '!!!'].includes(p) ? p : null;
    if (!sub || (sub.priority || null) === next) return false;
    sub.priority = next; sub.dirty = true; this._touch(parent);
    return true;
  }
  // undo support: capture a task block (with subtasks) before mutation, restore the raw lines later
  captureBlock(id) {
    const t = this.findById(id);
    if (!t) return null;
    const [i, j] = this._blockRange(t);
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
    const [i, j] = this._blockRange(t);
    this.doc.splice(i, j - i);
    this._index();
    return true;
  }
  insertBlockAt(index, lines) {
    const rebuilt = lines.map(l => {
      const t = parseTaskLine(l);
      return t ? { type: 'task', task: t } : { type: 'raw', text: l };
    });
    this.doc.splice(Math.max(0, Math.min(index, this.doc.length)), 0, ...rebuilt);
    this._index();
  }
  complete(id) {
    const t = this.findById(id);
    if (!t) return;
    t.checked = true; this._touch(t); // u = the done date
    if (this.doneHeading) {
      // ponytail: assumes ## Done is a section (insert right under its heading, newest first)
      const [i, j] = this._blockRange(t);
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
    const [i, j] = this._blockRange(this.findById(id));
    this.doc.splice(i, j - i);
    this._index();
    return cap;
  }
  deleteSubtask(parentId, subTitle) {
    const parent = this.findById(parentId);
    if (!parent) return;
    const sub = this.subtasksOf(parent).find(s => s.title === subTitle);
    if (!sub) return;
    this.doc.splice(this.doc.indexOf(this.entryOf(sub)), 1);
    this._touch(parent);
    this._index();
  }
  uncomplete(id) {
    const t = this.findById(id);
    if (!t) return;
    t.checked = false; this._touch(t);
    if (this.doneHeading) {
      const [i, j] = this._blockRange(t);
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
    const [ai, aj] = this._blockRange(t);
    const block = this.doc.splice(ai, aj - ai); // pull A out first: B's range must be recomputed
    const [bi, bj] = this._blockRange(other);
    const otherBlock = this.doc.splice(bi, bj - bi);
    const reinsert = dir === 'up' ? [...block, ...otherBlock] : [...otherBlock, ...block];
    this.doc.splice(Math.min(ai, bi), 0, ...reinsert);
    this._index();
  }
  reorderTask(id, beforeId) { // move a whole task block before another task (null = end of the task list)
    const t = this.findById(id);
    if (!t) return;
    const [i, j] = this._blockRange(t);
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
      const [, j] = this._blockRange(e.task);
      this.doc.splice(k, j - k);
      n++;
    }
    this._index();
    return n;
  }
}

module.exports = { subMeta, stampNow, stampMs, splitStamp, MONTHS, monthFromToken, resolveDue, parseMeta, parseTaskLine, fmtTask, parseDoc, docToText, NoteFile };
