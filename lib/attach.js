'use strict';
// Task attachments (owner 2026-10-09): POINTERS a task keeps in app state (state.attachments, keyed by note + task title),
// never note lines and never copies of files. Pure rules here: what is a valid attachment, and what a click runs.
// main.js performs the plan; the renderers only ever send an index, never a path or a command.
const TOOLS = ['claude', 'codex', 'opencode'];
const TYPES = ['session', 'file', 'folder', 'link']; // VS Code / cmd-in-a-folder dropped (owner 2026-10-09: not needed)
const ID_RE = /^[A-Za-z0-9_-]{4,80}$/; // Claude / Codex uuids, opencode ses_…
const ABS_RE = /^(?:[A-Za-z]:\\|\\\\)/; // a Windows absolute path
const BAD_PATH = /["\r\n%]/; // cmd expands %VAR% even inside quotes; a quote would end ours

const key = (file, title) => `${file}|${title}`;
const baseName = p => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();

// anything from a renderer → a safe attachment, or null
function clean(a) {
  if (!a || !TYPES.includes(a.type)) return null;
  const name = String(a.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (a.type === 'link') {
    const url = String(a.url || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return null;
    return { type: 'link', url, name: name || url.replace(/^https?:\/\//i, '').slice(0, 60) };
  }
  if (a.type === 'session') {
    const dir = String(a.dir || '');
    if (!TOOLS.includes(a.tool) || !['terminal', 'desktop'].includes(a.mode) || !ID_RE.test(a.id || '') || !ABS_RE.test(dir) || BAD_PATH.test(dir)) return null;
    return { type: 'session', tool: a.tool, mode: a.mode, id: a.id, dir, name: name || a.id };
  }
  const path = String(a.path || '');
  if (!ABS_RE.test(path) || BAD_PATH.test(path)) return null;
  return { type: a.type, path, name: name || baseName(path) };
}

// the exact session, resumed in its own folder (the terminal starts there, so opencode's "." is that folder)
const RESUME = { claude: id => `claude --resume ${id}`, codex: id => `codex resume ${id}`, opencode: id => `opencode . -s ${id}` };
// a click → what main does: { open } = shell.openPath · { external } = shell.openExternal · { cmd } = cmd.exe verbatim
// arguments (a NEW console via start) · { app, copy } = open that desktop app, copy the session name
function plan(a) {
  switch (a.type) {
    case 'file': case 'folder': return { open: a.path };
    case 'link': return { external: a.url };
    case 'session': return a.mode === 'terminal'
      ? { cmd: `/d /c start "" /D "${a.dir}" cmd.exe /K ${RESUME[a.tool](a.id)}` }
      : { app: a.tool, copy: a.name };
  }
  return null;
}

module.exports = { TOOLS, TYPES, key, clean, plan };
