'use strict';
// Linked ("shadow") tasks (owner 2026-10-10): one task also SHOWN in the other note — a pointer in app state, never a line
// in that .md. state.links = { "<hidden id>": "work" | "personal" } = "also show this task in that note".
// Pure rules here; main.js applies them to the snapshot. A shadow is a copy of the real snapshot item that keeps its HOME
// `file` and `id`, so every action on it (tick, Now, priority, subtasks, edit, timer, attachments) writes the home note.

const NOTES = ['work', 'personal'];
const noteOf = section => String(section.name || '').toLowerCase();

// snapshot sections → the same sections, each with the other note's linked OPEN tasks added (marked shadow + home)
function withShadows(sections, links) {
  if (!links || !Object.keys(links).length) return sections;
  const all = sections.flatMap(s => s.items);
  return sections.map(s => {
    const here = noteOf(s);
    const extra = all.filter(t => t.uid && links[t.uid] === here && t.file !== here).map(t => ({ ...t, shadow: true, home: t.file }));
    return extra.length ? { ...s, items: [...s.items, ...extra] } : s;
  });
}

// drop links that point at nothing useful. open = { work: Set(uids of open top tasks) | null, personal: … | null };
// null = that note couldn't be read (or is switched off): we can't tell, so a link that might live there is KEPT.
function pruneLinks(links, open) {
  const out = {};
  for (const [uid, target] of Object.entries(links || {})) {
    if (!NOTES.includes(target)) continue;
    const home = NOTES.find(n => open[n] && open[n].has(uid));
    if (home) { if (home !== target) out[uid] = target; continue; } // living in its target already = nothing to link
    if (NOTES.some(n => !open[n])) out[uid] = target; // gone or done — unless an unreadable note may still hold it
  }
  return out;
}

const otherNote = note => (note === 'work' ? 'personal' : 'work');

module.exports = { NOTES, withShadows, pruneLinks, otherNote };
