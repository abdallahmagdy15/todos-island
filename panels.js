'use strict';
// Side panel (owner 2026-09-28): Edit and Share open INSIDE the tasks window, never in a new window.
// One <aside id="side">: it slides in from the end edge and leaves the same way; ✕, Esc or a click outside closes it.
// The editor SAVES ITSELF (owner 2026-09-28, exception to "Save writes what the preview says"): chips save at once,
// typed text after a short pause or when you leave the field. The "will write" line still shows the exact note line,
// and one Undo (the window's toast) rolls back everything changed since the panel opened (main.js 'edit' undo kind).
(() => {
  const { esc, bangCls, parseDueText, MONTHS } = window.UI;
  const $ = id => document.getElementById(id);
  let LANG = 'en';
  const T = (k, prm) => window.I18N.t(LANG, k, prm);
  const side = $('side');
  let kind = null, returnFocus = null;

  // ---------- panel shell ----------
  function show(k) {
    if (kind !== k) returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : returnFocus;
    kind = k;
    $('side-edit').hidden = k !== 'edit';
    $('side-share').hidden = k !== 'share';
    $('side-title').textContent = T(k === 'edit' ? 'ed.title' : 'sh.header');
    $('ed-badge').hidden = k !== 'edit';
    $('ed-mark').hidden = k !== 'edit';
    side.setAttribute('aria-hidden', 'false');
    side.classList.add('open');
    document.body.classList.add('side-open');
  }
  async function close() {
    if (!kind) return;
    toggleMenu(false);
    await saveNow(); // a pending edit lands before the panel goes
    kind = null;
    side.classList.remove('open');
    document.body.classList.remove('side-open');
    side.setAttribute('aria-hidden', 'true');
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  $('side-close').addEventListener('click', () => { window.SFX.play('tick'); close(); });
  // a click outside closes it. What OPENS a panel (the Edit tab, Share, a subtask's text, a row with nothing to unfold)
  // and the floating layers above it (undo toast, notices) don't count as outside — they switch or act on the panel.
  document.addEventListener('pointerdown', e => {
    if (!kind || e.button !== 0) return;
    if (e.target.closest('#side, .etab, #btn-share, #undo-toast, #notice, #keys-pop')) return;
    if (e.target.closest('.wsubrow .st') || (e.target.closest('.wrow:not(.has-detail):not(.done)') && !e.target.closest('.chk'))) return;
    close();
  }, true);
  document.addEventListener('keydown', e => {
    if (!kind) return;
    if (e.key === 'Escape') {
      if (!$('ed-menu').hidden) { toggleMenu(false); $('ed-more').focus(); return; }
      e.preventDefault(); close(); return;
    }
    if (kind === 'edit' && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); saveNow(); }
  });

  // ---------- editor ----------
  let FILE = 'work', ID = '', session = '', activeState = false;
  const touched = {}; // fields the user set with a control since the panel opened — those override typed notation
  const prioCtl = window.UI.prioChips($('ed-prio'), { onPick: () => { touched.priority = true; schedulePreview(0); queueSave(0); } });
  const dueCtl = window.UI.dueControl($('ed-due'), { onPick: () => { touched.due = true; schedulePreview(0); queueSave(0); } });
  const MAX_TA = 212; // ≈ 10 lines, then the field scrolls inside
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, MAX_TA) + 'px'; }

  async function edit(file, id) {
    if (kind === 'edit' && (file !== FILE || id !== ID)) await saveNow(); // switching tasks: the old one lands first
    const same = kind === 'edit' && file === FILE && id === ID;
    FILE = file; ID = id;
    if (!same) { session = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); for (const k of Object.keys(touched)) delete touched[k]; }
    show('edit');
    await load(!same);
    if (!same) setTimeout(() => { const ta = $('ed-title'); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 80);
  }
  async function load(full) {
    const s = await window.api.getSnapshot();
    if (s && s.lang && s.lang !== LANG) setLang(s.lang);
    const t = s.sections.flatMap(x => x.items).find(x => x.id === ID) || null;
    $('ed-missing').hidden = !!t;
    $('ed-form').hidden = !t;
    $('ed-foot').hidden = !t;
    if (!t) return;
    $('ed-badge').textContent = T(t.file === 'work' ? 'win.st.file.work' : 'win.st.file.personal');
    if (full) {
      $('ed-title').value = [t.title, ...(t.notes || [])].join('\n');
      autoGrow($('ed-title'));
      activeState = !!t.active; paintActive();
      prioCtl.set(t.priority); dueCtl.set(parseDueText(t.dueText));
      $('ed-saved').textContent = '';
      updatePreview();
    }
    if (subEditing) return; // a subtask being renamed keeps its field — the list refreshes once it commits
    // a subtask (owner 2026-09-28): its [ ] ticks it; its TEXT is editable (click → a field; Enter / leaving saves, Esc cancels)
    $('ed-subs').innerHTML = t.subs.map(x =>
      `<li class="${x.done ? 'done' : ''}" data-sub="${esc(x.t)}" data-p="${x.p || ''}"><button class="sb" type="button" data-subtick aria-label="${esc(T(x.done ? 'ed.sub.untick' : 'ed.sub.tick', { t: x.t }))}">${x.done ? '[x]' : '[ ]'}</button><button class="sbp ${x.p ? bangCls(x.p) : 'none'}" type="button" data-subprio title="${esc(T('ed.sub.prio'))}" aria-label="${esc(T('ed.sub.prioAria', { t: x.t, p: x.p || '–' }))}">${x.p ? esc(x.p) : '!'}</button><span class="st" tabindex="0" role="button" title="${esc(T('ed.sub.rename'))}">${esc(x.t)}</span><button class="sub-del" type="button" aria-label="${esc(T('ed.sub.del', { t: x.t }))}">&times;</button></li>`).join('')
      || `<li class="none-yet">${esc(T('ed.sub.none'))}</li>`;
  }
  function paintActive() {
    $('ed-active').classList.toggle('sel', activeState);
    $('ed-active').setAttribute('aria-pressed', activeState);
    $('ed-mark').textContent = activeState ? '[★]' : '[ ]';
    $('ed-mark').classList.toggle('now', activeState);
  }
  // "will write" — the exact line the note gets (same serializer as the note; typed notation is honored)
  let pvT = null, pvSeq = 0, last = null;
  function schedulePreview(ms = 80) { clearTimeout(pvT); pvT = setTimeout(updatePreview, ms); }
  async function updatePreview() {
    clearTimeout(pvT);
    const my = ++pvSeq;
    const r = await window.api.composeTask({
      text: $('ed-title').value,
      priority: touched.priority ? prioCtl.value : undefined,
      due: touched.due ? dueCtl.value : undefined,
      active: touched.active ? activeState : undefined,
      fallback: { priority: prioCtl.value, due: dueCtl.value, active: activeState }
    });
    if (my !== pvSeq) return r;
    last = r;
    prioCtl.set(r.priority); dueCtl.set(r.due);
    if (r.active !== activeState) { activeState = r.active; paintActive(); }
    $('ed-preview-line').textContent = r.ok ? r.line : T('ed.noTitle');
    $('ed-preview-line').classList.toggle('bad', !r.ok);
    return r;
  }
  // autosave: one save at a time, in order; typed text waits for a pause, picks save at once
  let saveT = null, dirty = false, chain = Promise.resolve(), savedT = null;
  function queueSave(ms) { dirty = true; clearTimeout(saveT); saveT = setTimeout(saveNow, ms); }
  function saveNow() {
    clearTimeout(saveT);
    if (!dirty || kind !== 'edit') return chain;
    dirty = false;
    chain = chain.then(doSave).catch(() => {});
    return chain;
  }
  async function doSave() {
    const r = await updatePreview();
    if (!r || !r.ok) { flashSaved(T('ed.noTitle'), true); return; } // never save an empty title — the line says why
    const res = await window.api.updateTask(FILE, ID, { title: r.title, priority: r.priority, active: r.active, desc: r.desc, dueText: r.dueText, session });
    if (res && res.id && res.id !== ID) { // the id follows title/priority/due — adopt it or the panel loses the task
      window.dispatchEvent(new CustomEvent('task-id', { detail: { from: ID, to: res.id } })); // the list keeps the row in place
      ID = res.id;
    }
    if (res && res.changed) flashSaved(T('set.save.saved'));
  }
  function flashSaved(text, bad = false) {
    const el = $('ed-saved');
    el.textContent = text; el.classList.toggle('bad', bad);
    clearTimeout(savedT); savedT = setTimeout(() => { el.textContent = ''; }, 1600);
  }
  $('ed-title').addEventListener('input', () => { autoGrow($('ed-title')); schedulePreview(); queueSave(700); });
  $('ed-title').addEventListener('blur', () => { if (dirty) saveNow(); });
  $('ed-active').addEventListener('click', () => {
    activeState = !activeState; touched.active = true;
    window.SFX.play(activeState ? 'starOn' : 'starOff');
    paintActive(); schedulePreview(0); queueSave(0);
  });
  // subtasks: every change joins the panel's session, so the one Undo covers them too
  let subEditing = null;
  $('ed-subs').addEventListener('click', async e => {
    const li = e.target.closest('li[data-sub]');
    if (!li || e.target.closest('.sub-edit')) return;
    if (e.target.closest('.st')) { startSubEdit(li); return; }
    await saveNow();
    if (e.target.closest('.sub-del')) { window.SFX.play('delete'); await window.api.deleteSubtask(FILE, ID, li.dataset.sub, session); }
    else if (e.target.closest('[data-subprio]')) { // one click steps the importance: none → ! → !! → !!! → none (owner 2026-09-29)
      const next = { '': '!', '!': '!!', '!!': '!!!', '!!!': null }[li.dataset.p || ''];
      window.SFX.play('tick'); await window.api.subtaskPriority(FILE, ID, li.dataset.sub, next, session);
    }
    else if (e.target.closest('[data-subtick]')) { window.SFX.play('tick'); await window.api.toggleSubtask(FILE, ID, li.dataset.sub, session); }
    else return;
    load(false);
  });
  $('ed-subs').addEventListener('keydown', e => { const st = e.target.closest('.st'); if (st && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startSubEdit(st.closest('li')); } });
  function startSubEdit(li) {
    if (subEditing) return;
    const old = li.dataset.sub, st = li.querySelector('.st');
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'sub-edit'; input.value = old; input.spellcheck = false;
    input.setAttribute('aria-label', T('ed.sub.rename'));
    st.replaceWith(input);
    subEditing = old;
    input.focus(); input.select();
    let done = false;
    const finish = async commit => {
      if (done) return; done = true;
      const v = input.value.replace(/\s+/g, ' ').trim();
      subEditing = null;
      if (commit && v && v !== old) {
        await saveNow();
        const res = await window.api.renameSubtask(FILE, ID, old, v, session);
        if (res && res.changed) { window.SFX.play('tick'); flashSaved(T('set.save.saved')); }
      }
      load(false);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } // Esc cancels the rename, not the panel
    });
    input.addEventListener('blur', () => finish(true));
  }
  $('ed-addsub').addEventListener('click', async () => {
    const v = $('ed-sub').value.trim();
    if (!v) { window.Motion.nudge($('ed-sub')); $('ed-sub').focus(); return; }
    await saveNow();
    window.SFX.play('tick');
    await window.api.addSubtask(FILE, ID, v, session);
    $('ed-sub').value = '';
    load(false);
  });
  $('ed-sub').addEventListener('keydown', e => { if (e.key === 'Enter') $('ed-addsub').click(); });
  // ⋯ menu — the rare, structural actions live here, out of the way
  function toggleMenu(open) {
    const m = $('ed-menu');
    open = open === undefined ? m.hidden : open;
    m.hidden = !open;
    $('ed-more').setAttribute('aria-expanded', open);
    if (open) m.querySelector('[role=menuitem]').focus();
  }
  $('ed-more').addEventListener('click', () => toggleMenu());
  document.addEventListener('click', e => { if (!$('ed-menu').hidden && !e.target.closest('.menu-wrap')) toggleMenu(false); });
  $('ed-menu').addEventListener('keydown', e => {
    const items = [...$('ed-menu').querySelectorAll('[role=menuitem]')], i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  });
  $('ed-up').addEventListener('click', async () => { toggleMenu(false); await saveNow(); window.SFX.play('tick'); await window.api.moveTask(FILE, ID, 'up'); load(false); });
  $('ed-down').addEventListener('click', async () => { toggleMenu(false); await saveNow(); window.SFX.play('tick'); await window.api.moveTask(FILE, ID, 'down'); load(false); });
  $('ed-delete').addEventListener('click', async () => {
    toggleMenu(false); await saveNow();
    window.SFX.play('delete'); await window.api.deleteTask(ID, FILE); // undo lives in the window's toast
    dirty = false; close();
  });
  // Complete — M1 on the preview line itself: the bracket ticks, a pen line strikes it, then the panel slides away
  $('ed-complete').addEventListener('click', async () => {
    await saveNow();
    window.SFX.play('complete');
    const line = $('ed-preview-line');
    if (last && last.ok) line.textContent = last.line.replace('- [ ]', '- [x]');
    line.classList.add('tt', 'striking');
    try {
      await Promise.all([
        window.api.complete(ID, FILE),
        window.Motion.play(line, [{ backgroundSize: '0% 1.5px' }, { backgroundSize: '100% 1.5px' }], { duration: 220, delay: 120 })
      ]);
      await new Promise(r => setTimeout(r, window.Motion.reduced ? 0 : 160));
      close();
    } catch (err) {
      updatePreview();
    } finally { line.classList.remove('tt', 'striking'); }
  });

  // ---------- share ----------
  let shSnap = null, fmt = 'wa';
  const sel = new Set();
  async function share() {
    if (kind === 'share') { close(); return; } // the Share button toggles its panel
    if (kind === 'edit') await saveNow();
    show('share');
    shSnap = await window.api.getSnapshot();
    if (shSnap && shSnap.lang && shSnap.lang !== LANG) setLang(shSnap.lang);
    renderShare();
  }
  function sections() {
    const work = (shSnap.sections.find(s => s.name === 'Work') || { items: [] }).items;
    const personal = (shSnap.sections.find(s => s.name === 'Personal') || { items: [] }).items;
    // Share lists the latest-updated first (owner 2026-09-29): the task's own u stamp, newest on top
    const byUpdate = arr => [...arr].sort((a, b) => (b.updatedTs || 0) - (a.updatedTs || 0));
    const flat = byUpdate([...work, ...personal]);
    return [
      { name: T('isl.sec.now'), items: flat.filter(t => t.active) },
      { name: T('isl.sec.work'), items: byUpdate(work.filter(t => !t.active)) },
      { name: T('isl.sec.personal'), items: byUpdate(personal.filter(t => !t.active)) },
      { name: T('sh.sec.done'), items: (shSnap.done || []).map(d => ({ ...d, isDone: true })) }
    ].filter(s => s.items.length);
  }
  function renderShare() {
    if (!shSnap) return;
    $('share-list').innerHTML = sections().map(sec => `
      <div class="sh-sec"><span class="hash">##</span> ${esc(sec.name)} <span class="cnt">${sec.items.length}</span></div>
      ${sec.items.map(t => `
        <div class="sh-row ${sel.has(t.id) ? 'sel' : ''}" data-id="${esc(t.id)}">
          <span class="sh-chk" aria-hidden="true"></span>
          ${t.active ? '<span class="star">★</span>' : ''}
          <span class="shtitle">${esc(t.title)}</span>
          ${t.isDone ? `<span class="tag">${t.file === 'work' ? 'work' : 'personal'}</span>` : ''}
          ${t.dueText ? `<span class="tag">${esc(t.dueText)}</span>` : ''}
        </div>`).join('')}
    `).join('') || `<p class="empty">${esc(T('sh.none'))}</p>`;
    syncShare();
  }
  function syncShare() { // zero selection: the buttons say so instead of silently doing nothing
    const n = [...sel].filter(id => sections().some(s => s.items.some(t => t.id === id))).length;
    $('btn-copy').disabled = !n; $('btn-export').disabled = !n;
    $('sel-hint').textContent = n ? T('sh.selN', { n }) : T('sh.selHint');
  }
  const picked = () => sections().flatMap(s => s.items).filter(t => sel.has(t.id));
  function buildText(k) {
    const ts = picked();
    const today = `${new Date().getDate()} ${MONTHS[new Date().getMonth()]}`;
    const done = ts.filter(t => t.isDone), open = ts.filter(t => !t.isDone);
    const active = open.filter(t => t.active), todo = open.filter(t => !t.active);
    if (k === 'md') {
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
      done.length ? `✅ *Done*\n${waPart(done, '✅')}` : '',
      active.length ? `🔄 *In progress*\n${waPart(active, '🔄')}` : '',
      todo.length ? `⏳ *To do*\n${waPart(todo, '•')}` : ''
    ].filter(Boolean).join('\n\n');
  }
  $('share-list').addEventListener('click', e => {
    const row = e.target.closest('.sh-row');
    if (!row) return;
    const id = row.dataset.id;
    sel.has(id) ? sel.delete(id) : sel.add(id);
    row.classList.toggle('sel', sel.has(id)); // the row's [ ] / [x] is drawn from .sel
    syncShare();
  });
  $('sel-all').addEventListener('click', () => { for (const t of sections().flatMap(s => s.items)) sel.add(t.id); renderShare(); });
  $('sel-clear').addEventListener('click', () => { sel.clear(); renderShare(); });
  $('fmt-seg').addEventListener('click', e => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    fmt = b.dataset.fmt;
    $('fmt-seg').querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('sel', x === b));
  });
  $('btn-copy').addEventListener('click', async () => {
    if (!picked().length) return;
    await window.api.copyText(buildText(fmt));
    window.SFX.play('tick');
    const b = $('btn-copy'), old = b.textContent;
    b.textContent = T('sh.copied');
    setTimeout(() => { b.textContent = old; }, 1200);
  });
  $('btn-export').addEventListener('click', async () => {
    if (!picked().length) return;
    const res = await window.api.exportMd(buildText('md'));
    if (res && res.ok) {
      window.SFX.play('tick');
      $('share-note').textContent = T('sh.savedFile', { f: res.path.split(/[\\/]/).pop() }); // file name only — full path on hover
      $('share-note').title = res.path;
    }
  });

  // ---------- live data + language ----------
  window.api.onTasksChanged(async () => {
    if (kind === 'edit') load(false);
    else if (kind === 'share') { shSnap = await window.api.getSnapshot(); renderShare(); }
  });
  function setLang(lang) {
    LANG = lang;
    if (kind) $('side-title').textContent = T(kind === 'edit' ? 'ed.title' : 'sh.header');
    if (kind === 'share') renderShare();
  }
  window.api.onLangChanged(setLang);
  // the island's ✎ Edit and Share arrive here (main.js sendPanel)
  window.api.onOpenPanel(p => { if (p && p.kind === 'edit') edit(p.file, p.id); else if (p && p.kind === 'share') { if (kind !== 'share') share(); } });

  window.Panels = { edit, share, close, get kind() { return kind; }, get editing() { return kind === 'edit' ? { file: FILE, id: ID } : null } };
})();
