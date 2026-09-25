'use strict';
// Share window — all tasks in one view (active / work / personal / done), pick any mix,
// copy as WhatsApp text or Markdown, or export the Markdown to a file.
const { MONTHS, esc } = window.UI;
const $ = id => document.getElementById(id);

let snap = null, fmt = 'wa', LANG = 'en';
const T = (k, prm) => window.I18N.t(LANG, k, prm);
const sel = new Set();

function sections() {
  const work = (snap.sections.find(s => s.name === 'Work') || { items: [] }).items;
  const personal = (snap.sections.find(s => s.name === 'Personal') || { items: [] }).items;
  const flat = [...work, ...personal];
  return [
    { name: T('isl.sec.now'), items: flat.filter(t => t.active) },
    { name: T('isl.sec.work'), items: work.filter(t => !t.active) },
    { name: T('isl.sec.personal'), items: personal.filter(t => !t.active) },
    { name: T('sh.sec.done'), items: (snap.done || []).map(d => ({ ...d, isDone: true })) }
  ].filter(s => s.items.length);
}
function render() {
  $('share-list').innerHTML = sections().map(sec => `
    <div class="sh-sec"><span class="hash">##</span> ${esc(sec.name)} <span class="cnt">${sec.items.length}</span></div>
    ${sec.items.map(t => `
      <div class="sh-row ${sel.has(t.id) ? 'sel' : ''}" data-id="${esc(t.id)}">
        <span class="selbox ${sel.has(t.id) ? 'on' : ''}"></span>
        ${t.active ? '<span class="star">\u2605</span>' : ''}
        <span class="shtitle">${esc(t.title)}</span>
        ${t.isDone ? `<span class="tag">${t.file === 'work' ? 'work' : 'personal'}</span>` : ''}
        ${t.dueText ? `<span class="tag">${esc(t.dueText)}</span>` : ''}
      </div>`).join('')}
  `).join('') || '<p class="empty">Nothing to share — no tasks found.</p>';
  syncButtons();
}
function syncButtons() { // zero selection: buttons say so instead of silently doing nothing
  const n = sel.size;
  $('btn-copy').disabled = !n; $('btn-export').disabled = !n;
  $('sel-hint').textContent = n ? T('sh.selN', { n }) : T('sh.selHint');
}
function selected() {
  const all = sections().flatMap(s => s.items);
  return all.filter(t => sel.has(t.id));
}
function buildText(kind) {
  const ts = selected();
  const today = `${new Date().getDate()} ${MONTHS[new Date().getMonth()]}`;
  const done = ts.filter(t => t.isDone);
  const open = ts.filter(t => !t.isDone);
  const active = open.filter(t => t.active);
  const todo = open.filter(t => !t.active);
  if (kind === 'md') {
    const part = (arr, mark) => arr.map(t => `- [${mark}] ${t.active ? '* ' : ''}${t.title}`).join('\n');
    return [
      `## ${T('sh.daily', { d: today })}`, '',
      done.length ? `**Done**\n${part(done, 'x')}` : '',
      active.length ? `**In progress**\n${part(active, ' ')}` : '',
      todo.length ? `**To do**\n${part(todo, ' ')}` : ''
    ].filter(Boolean).join('\n\n') + '\n';
  }
  const waPart = (arr, icon) => arr.map(t => `${icon} ${t.title}`).join('\n');
  return [
    `*${T('sh.daily', { d: today })}*`, '',
    done.length ? `\u2705 *Done*\n${waPart(done, '\u2705')}` : '',
    active.length ? `\ud83d\udd04 *In progress*\n${waPart(active, '\ud83d\udd04')}` : '',
    todo.length ? `\u23f3 *To do*\n${waPart(todo, '\u2022')}` : ''
  ].filter(Boolean).join('\n\n');
}
$('share-list').addEventListener('click', e => {
  const row = e.target.closest('.sh-row');
  if (!row) return;
  const id = row.dataset.id;
  sel.has(id) ? sel.delete(id) : sel.add(id);
  row.classList.toggle('sel', sel.has(id));
  const box = row.querySelector('.selbox');
  if (box) box.classList.toggle('on', sel.has(id));
  syncButtons();
});
$('sel-all').addEventListener('click', () => {
  for (const t of sections().flatMap(s => s.items)) sel.add(t.id);
  render();
});
$('sel-clear').addEventListener('click', () => { sel.clear(); render(); });
$('fmt-seg').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  fmt = b.dataset.fmt;
  document.querySelectorAll('.seg-btn').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel');
});
$('btn-copy').addEventListener('click', async () => {
  if (!sel.size) return;
  await window.api.copyText(buildText(fmt));
  window.SFX.play('tick');
  const old = $('btn-copy').textContent;
  $('btn-copy').textContent = T('sh.copied');
  setTimeout(() => { $('btn-copy').textContent = old; }, 1200);
});
$('btn-export').addEventListener('click', async () => {
  if (!sel.size) return;
  const res = await window.api.exportMd(buildText('md'));
  if (res && res.ok) {
    window.SFX.play('tick');
    $('share-note').textContent = `saved ${res.path.split(/[\\/]/).pop()}`; // filename only — full path on hover
    $('share-note').title = res.path;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });

(async () => {
  snap = await window.api.getSnapshot();
  if (snap && snap.lang && snap.lang !== LANG) { LANG = snap.lang; window.UI.setLang(LANG); window.I18N.applyDoc(LANG); }
  window.SFX.enabled = !!(snap.settings && snap.settings.soundOn); // respects the app's sound setting
  render();
})();
window.api.onTasksChanged(async () => { snap = await window.api.getSnapshot(); render(); });

window.api.onLangChanged(lang => { LANG = lang; window.UI.setLang(LANG); window.I18N.applyDoc(LANG); });
