'use strict';
// Recent AI sessions on this PC, for the editor's "Attach → AI session" list (owner 2026-10-09).
// Read-only: names, ids and folders only — nothing is sent anywhere. Each tool keeps them differently:
//   Claude Code  %USERPROFILE%\.claude\projects\<folder>\<session id>.jsonl   (custom-title / summary / first prompt, cwd)
//   Codex        %USERPROFILE%\.codex\sessions\YYYY\MM\DD\rollout-…-<id>.jsonl (first line = session_meta: id, cwd)
//                + %USERPROFILE%\.codex\history.jsonl                         (first prompt per session_id = the name)
//   opencode     `opencode session list --format json`                         (id, title, directory, updated)
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const MAX = 15;
const head = (file, bytes = 65536) => { // the first lines of a big jsonl, without reading it all
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(bytes); const n = fs.readSync(fd, b, 0, bytes, 0); return b.slice(0, n).toString('utf8').split('\n').slice(0, -1); }
  finally { fs.closeSync(fd); }
};
const json = l => { try { return JSON.parse(l); } catch (e) { return null; } };
const oneLine = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? (c.find(x => x && x.type === 'text') || {}).text : '') || '';

function claude(home) {
  const root = path.join(home, '.claude', 'projects');
  let files = [];
  for (const d of fs.readdirSync(root)) {
    const dir = path.join(root, d);
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) { const p = path.join(dir, f); files.push({ p, at: fs.statSync(p).mtimeMs }); } } catch (e) {}
  }
  files = files.sort((a, b) => b.at - a.at).slice(0, MAX);
  return files.map(({ p, at }) => {
    let title = '', summary = '', prompt = '', cwd = '';
    for (const o of head(p).map(json)) {
      if (!o) continue;
      if (o.type === 'custom-title' && o.customTitle) title = o.customTitle;
      if (o.type === 'summary' && o.summary && !summary) summary = o.summary;
      if (!cwd && o.cwd) cwd = o.cwd;
      if (!prompt && o.type === 'user' && o.message && !o.isMeta) prompt = textOf(o.message.content);
    }
    return { id: path.basename(p, '.jsonl'), name: oneLine(title || summary || prompt), dir: cwd, at };
  }).filter(s => s.dir);
}

function codex(home) {
  const root = path.join(home, '.codex', 'sessions');
  const files = [];
  const desc = d => { try { return fs.readdirSync(d).sort().reverse(); } catch (e) { return []; } };
  for (const y of desc(root)) for (const m of desc(path.join(root, y))) for (const d of desc(path.join(root, y, m))) {
    for (const f of desc(path.join(root, y, m, d))) if (f.endsWith('.jsonl') && files.length < MAX) files.push(path.join(root, y, m, d, f));
    if (files.length >= MAX) break;
  }
  const names = new Map();
  try {
    const hist = path.join(home, '.codex', 'history.jsonl'), size = fs.statSync(hist).size, from = Math.max(0, size - 4e6);
    const fd = fs.openSync(hist, 'r'), b = Buffer.alloc(size - from); fs.readSync(fd, b, 0, b.length, from); fs.closeSync(fd);
    for (const o of b.toString('utf8').split('\n').map(json)) if (o && o.session_id && !names.has(o.session_id)) names.set(o.session_id, o.text);
  } catch (e) {}
  return files.map(p => {
    const meta = (head(p, 16384).map(json).find(o => o && o.type === 'session_meta') || {}).payload || {};
    return { id: meta.id, name: oneLine(names.get(meta.id) || ''), dir: meta.cwd, at: fs.statSync(p).mtimeMs };
  }).filter(s => s.id && s.dir);
}

function opencode() {
  return new Promise(resolve => {
    // `session list` only lists the CURRENT folder's project; the db query sees every project (top-level, not archived)
    const q = `select id, title, directory, time_updated from session where parent_id is null and time_archived is null order by time_updated desc limit ${MAX}`;
    exec(`opencode db "${q}" --format json`, { timeout: 20000, windowsHide: true, maxBuffer: 4e6 }, (err, out) => {
      const list = !err && json(String(out).slice(String(out).indexOf('[')));
      resolve(Array.isArray(list) ? list.map(s => ({ id: s.id, name: oneLine(s.title), dir: String(s.directory || '').replace(/\//g, '\\'), at: s.time_updated })).filter(s => s.id && s.dir) : []);
    });
  });
}

// tool → [{ id, name, dir, at }] newest first; any failure (tool not installed, no folder) = an empty list
async function recentSessions(tool, home) {
  try {
    const list = tool === 'claude' ? claude(home) : tool === 'codex' ? codex(home) : tool === 'opencode' ? await opencode() : [];
    return list.map(s => ({ ...s, name: s.name || s.id })).sort((a, b) => b.at - a.at);
  } catch (e) { return []; }
}

module.exports = { recentSessions };
