'use strict';
// Side panel (owner 2026-09-28): Edit and Share open INSIDE the tasks window, never in a new window.
// One <aside id="side">: it slides in from the end edge and leaves the same way; ✕, Esc or a click outside closes it.
// The editor SAVES ITSELF (owner 2026-09-28, exception to "Save writes what the preview says"): chips save at once,
// typed text after a short pause or when you leave the field. The "will write" line still shows the exact note line,
// and one Undo (the window's toast) rolls back everything changed since the panel opened (main.js 'edit' undo kind).
(() => {
  const { esc, bangCls, inline, plain, parseDueText, MONTHS } = window.UI;
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
    toggleMenu(false); closeWiz(); endMove();
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
      if (selecting) { e.preventDefault(); setSelecting(false); $('ed-sub-move').focus(); return; } // Esc leaves the selection first
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

  // opts.focus = 'sub': a task just added from the composer opens with the cursor in "add subtask" (owner 2026-10-01)
  async function edit(file, id, opts = {}) {
    if (kind === 'edit' && (file !== FILE || id !== ID)) await saveNow(); // switching tasks: the old one lands first
    const same = kind === 'edit' && file === FILE && id === ID;
    FILE = file; ID = id;
    if (!same) { session = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); for (const k of Object.keys(touched)) delete touched[k]; closeWiz(); endMove(); }
    show('edit');
    await load(!same);
    if (opts.focus === 'sub') setTimeout(() => $('ed-sub').focus({ preventScroll: true }), 80);
    else if (!same) setTimeout(() => { const ta = $('ed-title'); ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 80);
  }
  async function load(full) {
    const s = await window.api.getSnapshot();
    if (s && s.lang && s.lang !== LANG) setLang(s.lang);
    const t = s.sections.flatMap(x => x.items).find(x => x.id === ID) || null;
    $('ed-missing').hidden = !!t;
    $('ed-form').hidden = !t || wizOpen || moveOpen; // the Attach steps / Move to keep the view until they close
    $('ed-foot').hidden = !t || wizOpen || moveOpen;
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
    paintAtt(t.att || []);
    paintNoteMenu(t, s.settings && s.settings.mode);
    if (subEditing) return; // a subtask being renamed keeps its field — the list refreshes once it commits
    // a subtask (owner 2026-09-28): its [ ] ticks it; its TEXT is editable (click → a field; Enter / leaving saves, Esc cancels)
    const subs = [...t.subs.filter(x => !x.done), ...t.subs.filter(x => x.done)]; // open first (owner 2026-09-30); the note keeps its order
    $('ed-subs').innerHTML = subs.map(x =>
      `<li class="${x.done ? 'done' : ''}${mvPicked.has(x.t) ? ' picked' : ''}" data-sub="${esc(x.t)}" data-p="${x.p || ''}"><button class="sb" type="button" data-subtick aria-label="${esc(T(x.done ? 'ed.sub.untick' : 'ed.sub.tick', { t: plain(x.t) }))}">${x.done ? '[x]' : '[ ]'}</button><button class="sbp ${x.p ? bangCls(x.p) : 'none'}" type="button" data-subprio title="${esc(T('ed.sub.prio'))}" aria-label="${esc(T('ed.sub.prioAria', { t: plain(x.t), p: x.p || '–' }))}">${x.p ? esc(x.p) : '!'}</button><span class="st" tabindex="0" role="button" title="${esc(T('ed.sub.rename'))}">${inline(x.t)}</span><button class="sub-del" type="button" aria-label="${esc(T('ed.sub.del', { t: plain(x.t) }))}">&times;</button></li>`).join('')
      || `<li class="none-yet">${esc(T('ed.sub.none'))}</li>`;
    if (selecting) { for (const k of [...mvPicked]) if (!subs.some(x => x.t === k)) mvPicked.delete(k); } // a picked one that is gone
    paintSel();
  }
  function paintActive() {
    $('ed-active').classList.toggle('sel', activeState);
    $('ed-active').setAttribute('aria-pressed', activeState);
    $('ed-mark').textContent = activeState ? '[★]' : '[ ]';
    $('ed-mark').classList.toggle('now', activeState);
  }
  // compose — the exact line the note gets (same serializer as the note; typed notation is honored). It syncs the chips with
  // typed tokens and guards the title; the visible "will write" row was removed (owner 2026-09-30)
  let pvT = null, pvSeq = 0;
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
    prioCtl.set(r.priority); dueCtl.set(r.due ? { ...r.due, time: r.time } : null);
    if (r.active !== activeState) { activeState = r.active; paintActive(); }
    $('ed-title').classList.toggle('invalid', !r.ok); // an empty title: the field turns red; the save flash says why
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
  window.UI.fmtBar($('ed-title')); window.UI.fmtBar($('ed-sub')); // the formatting pop-up + shortcuts
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
    if (li && selecting) { // selection mode: a click picks / unpicks, nothing else
      mvPicked.has(li.dataset.sub) ? mvPicked.delete(li.dataset.sub) : mvPicked.add(li.dataset.sub);
      li.classList.toggle('picked', mvPicked.has(li.dataset.sub)); window.SFX.play('tick'); paintSel();
      return;
    }
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
    window.UI.fmtBar(input);
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
  // ---- attachments (owner 2026-10-09): POINTERS on the task (a path, a link, an AI session to reopen), kept in app
  // state by main, never in the note. Added, edited and removed only here (and so while adding: Add opens this editor).
  // Attach → a type → for an AI session: the tool, Terminal or Desktop, then one of its recent sessions on this PC.
  // Files / folders also come by dropping them on the panel.
  let att = [];
  function paintAtt(list) {
    att = list;
    $('ed-att-field').hidden = !list.length; // the block shows only when something is attached
    $('ed-att').innerHTML = list.map((a, i) => `<li title="${esc(a.path || a.url || a.dir || '')}">${window.UI.icon(window.UI.attIcon(a))}<span class="an">${esc(a.name)}</span><span class="ah">${esc(window.UI.attHint(a))}</span><button class="sub-del" type="button" data-attdel="${i}" aria-label="${esc(T('att.del', { t: a.name }))}">&times;</button></li>`).join('');
  }
  async function saveAtt(list) {
    await saveNow(); // a pending title edit lands first: attachments are filed under the task's title
    const r = await window.api.attSet(FILE, ID, list);
    if (r && r.ok) { paintAtt(r.att); flashSaved(T('set.save.saved')); } else flashSaved(T('att.fail'), true);
  }
  $('ed-att').addEventListener('click', e => {
    const d = e.target.closest('[data-attdel]');
    if (!d) return;
    window.SFX.play('delete');
    saveAtt(att.filter((_, i) => i !== +d.dataset.attdel));
  });
  // the Attach steps take over the WHOLE editor view (owner 2026-10-09); the task's name stays on top. Back steps back,
  // and from the first step (or Esc, or once something is attached) the normal editor returns.
  const wiz = $('ed-att-wiz');
  let draft = {}, wizOpen = false;
  const choice = (data, ic, label, small) => `<button class="chip" type="button" ${data}>${ic ? window.UI.icon(ic) : ''}<span>${esc(label)}</span>${small ? `<small>${esc(small)}</small>` : ''}</button>`;
  function openWiz() {
    wizOpen = true; draft = {};
    $('att-task').textContent = $('ed-title').value.split('\n')[0];
    $('ed-form').hidden = true; $('ed-foot').hidden = true; $('ed-att-view').hidden = false;
    wizStep('type');
    $('ed-att-view').closest('.side-scroll').scrollTop = 0;
  }
  function closeWiz() {
    if (!wizOpen) return;
    wizOpen = false; draft = {}; wiz.innerHTML = '';
    $('ed-att-view').hidden = true; $('ed-form').hidden = false; $('ed-foot').hidden = false;
  }
  function stepBack() {
    if (draft.mode != null) { delete draft.mode; wizStep('mode'); }
    else if (draft.tool) { delete draft.tool; wizStep('tool'); }
    else if (draft.type) { draft = {}; wizStep('type'); }
    else { closeWiz(); $('ed-att-add').focus(); }
  }
  function paintSessions() {
    const q = ($('att-q') ? $('att-q').value : '').trim().toLowerCase(), list = draft.list || [];
    const hits = list.map((s, i) => [s, i]).filter(([s]) => !q || s.name.toLowerCase().includes(q) || s.dir.toLowerCase().includes(q));
    wiz.querySelector('.att-sess').innerHTML = !list.length ? `<div class="att-none">${esc(T('att.noSess'))}</div>`
      : hits.length ? hits.map(([s, i]) => `<button type="button" data-s="${i}"><span class="sn">${esc(s.name)}</span><span class="sd" dir="ltr">${esc(s.dir)}</span></button>`).join('')
      : `<div class="att-none">${esc(T('att.noMatch'))}</div>`;
  }
  async function wizStep(n) {
    if (n === 'type') {
      wiz.innerHTML = `<div class="att-step">${esc(T('att.q.type'))}</div><div class="att-choices">${[
        ['session', 'terminal'], ['file', 'file'], ['folder', 'folder'], ['link', 'link']
      ].map(([k, ic]) => choice(`data-type="${k}"`, ic, T('att.t.' + k))).join('')}<button class="chip" type="button" disabled>${window.UI.icon('file')}<span>${esc(T('att.t.email'))}</span><small>${esc(T('att.later'))}</small></button></div>`;
    } else if (n === 'tool') {
      wiz.innerHTML = `<div class="att-step">${esc(T('att.q.tool'))}</div><div class="att-choices">${[['claude', 'Claude Code'], ['codex', 'Codex'], ['opencode', 'opencode']].map(([k, v]) => choice(`data-tool="${k}"`, null, v)).join('')}</div>`;
    } else if (n === 'mode') {
      wiz.innerHTML = `<div class="att-step">${esc(T('att.q.mode'))}</div><div class="att-choices">${choice('data-mode="terminal"', 'terminal', T('att.cmd'), T('att.cmd.hint'))}${choice('data-mode="desktop"', 'monitor', T('att.app'), T('att.app.hint'))}</div>`;
    } else if (n === 'session') {
      // searchable (owner 2026-10-09): by name or folder
      wiz.innerHTML = `<div class="att-step">${esc(T('att.q.session'))}</div><input type="text" id="att-q" class="att-q" spellcheck="false" autocomplete="off" placeholder="${esc(T('att.q.find'))}" aria-label="${esc(T('att.q.find'))}"><div class="att-sess"><div class="att-none">${esc(T('att.loading'))}</div></div>`;
      $('att-q').addEventListener('input', paintSessions);
      setTimeout(() => $('att-q') && $('att-q').focus(), 30);
      const tool = draft.tool, list = await window.api.attSessions(tool);
      if (!wizOpen || draft.tool !== tool || draft.mode == null) return; // closed or moved on meanwhile
      draft.list = list; paintSessions();
    } else if (n === 'link') {
      wiz.innerHTML = `<div class="att-step">${esc(T('att.q.link'))}</div><div class="addsub"><input type="text" id="att-url" placeholder="https://…" dir="ltr" spellcheck="false"><button type="button" data-addlink>${esc(T('win.btn.add'))}</button></div>`;
      setTimeout(() => $('att-url').focus(), 30);
    }
  }
  $('ed-att-add').addEventListener('click', () => { window.SFX.play('tick'); openWiz(); });
  $('att-back').addEventListener('click', () => { window.SFX.play('tick'); stepBack(); });
  wiz.addEventListener('click', async e => {
    const el = k => e.target.closest(`[data-${k}]`);
    if (el('type')) {
      const k = el('type').dataset.type;
      if (k === 'session' || k === 'link') { draft = { type: k }; wizStep(k === 'session' ? 'tool' : 'link'); return; }
      const p = await window.api.attPick(k);
      if (!p) return;
      closeWiz(); saveAtt([...att, { type: k, path: p }]);
      return;
    }
    if (el('tool')) { draft.tool = el('tool').dataset.tool; wizStep('mode'); return; }
    if (el('mode')) { draft.mode = el('mode').dataset.mode; wizStep('session'); return; }
    if (el('s')) {
      const s = draft.list[+el('s').dataset.s];
      const a = { type: 'session', tool: draft.tool, mode: draft.mode, id: s.id, dir: s.dir, name: s.name };
      closeWiz(); saveAtt([...att, a]);
      return;
    }
    if (el('addlink')) {
      const v = $('att-url').value.trim();
      if (!/^https?:\/\/\S+$/i.test(v)) { window.Motion.nudge($('att-url')); $('att-url').focus(); return; }
      closeWiz(); saveAtt([...att, { type: 'link', url: v }]);
    }
  });
  $('ed-att-view').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWiz(); $('ed-att-add').focus(); }
    else if (e.key === 'Enter' && e.target.id === 'att-url') { e.preventDefault(); wiz.querySelector('[data-addlink]').click(); }
    else if (e.key === 'Enter' && e.target.id === 'att-q') { e.preventDefault(); const f = wiz.querySelector('[data-s]'); if (f) f.click(); }
  });
  // drop files / folders from Explorer anywhere on the editor
  $('side-edit').addEventListener('dragover', e => { if (kind === 'edit' && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('ed-form').classList.add('drop-on'); } });
  $('side-edit').addEventListener('dragleave', e => { if (!$('side-edit').contains(e.relatedTarget)) $('ed-form').classList.remove('drop-on'); });
  $('side-edit').addEventListener('drop', e => {
    $('ed-form').classList.remove('drop-on');
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])];
    if (kind !== 'edit' || !files.length) return;
    e.preventDefault();
    const add = files.map(f => window.api.pathOf(f)).filter(Boolean).map(p => ({ type: 'file', path: p })); // main tells file from folder
    if (add.length) { window.SFX.play('tick'); saveAtt([...att, ...add]); }
  });

  // Move subtasks (owner 2026-10-09, like WhatsApp's forward; replaced the per-subtask ↳ picker): Move… turns the list
  // into a selection (click subtasks to pick them), "Move to" opens the other OPEN tasks of both notes as the whole editor
  // view (no subtasks shown, searchable), one click moves every mvPicked subtask there (main 'move-subtasks', one Undo)
  // and the normal editor returns. Back = to the selection; Cancel / Esc = out of it.
  let selecting = false, moveOpen = false;
  const mvPicked = new Set();
  function setSelecting(on) {
    selecting = on; mvPicked.clear();
    $('ed-subs').classList.toggle('selecting', on);
    $('ed-subs').querySelectorAll('li.picked').forEach(li => li.classList.remove('picked'));
    paintSel();
  }
  function paintSel() {
    $('ed-move-bar').hidden = !selecting; $('ed-addsub-row').hidden = selecting; $('ed-sub-move').hidden = selecting || !$('ed-subs').querySelector('li[data-sub]');
    $('mv-count').textContent = mvPicked.size ? T('ed.mv.count', { n: mvPicked.size }) : T('ed.mv.hint');
    $('mv-count').classList.toggle('none', !mvPicked.size);
    $('mv-next').disabled = !mvPicked.size;
  }
  // one list at a time, like Share (owner 2026-10-09): the note (Work · Personal, hidden with one note) and Open · Done;
  // it opens on this task's note, Open. Every row carries its own file (snapshot sections are named, not filed).
  let mvSnap = null, mvPage = 'work', mvSub = 'open';
  function paintMoveList() {
    if (!mvSnap) return;
    const w = $('mv-q').value.trim().toLowerCase();
    const pool = mvSub === 'done' ? (mvSnap.done || []) : mvSnap.sections.flatMap(x => x.items).filter(x => !x.shadow); // a linked task once
    const its = pool.filter(t => t.file === mvPage && !(t.file === FILE && t.id === ID) && (!w || plain(t.title).toLowerCase().includes(w)));
    for (const [seg, k, v] of [['mv-page', 'page', mvPage], ['mv-sub', 'sub', mvSub]])
      $(seg).querySelectorAll('.seg-btn').forEach(b => { const on = b.dataset[k] === v; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); });
    $('mv-list').innerHTML = its.map(t => `<button class="mv-opt" type="button" role="option" data-file="${t.file}" data-id="${esc(t.id)}">${inline(t.title)}</button>`).join('')
      || `<div class="mv-none">${esc(T(w ? 'ed.mv.noMatch' : 'ed.mv.none'))}</div>`;
  }
  async function openMoveView() {
    moveOpen = true;
    $('mv-title').textContent = T('ed.mv.title', { n: mvPicked.size });
    $('ed-form').hidden = true; $('ed-foot').hidden = true; $('ed-move-view').hidden = false;
    $('mv-q').value = ''; mvPage = FILE; mvSub = 'open';
    $('ed-move-view').closest('.side-scroll').scrollTop = 0;
    mvSnap = await window.api.getSnapshot();
    const mode = mvSnap.settings && mvSnap.settings.mode;
    $('mv-page').hidden = !!mode && mode !== 'both';
    paintMoveList();
    $('mv-q').focus();
  }
  $('mv-page').addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b && b.dataset.page !== mvPage) { window.SFX.play('tick'); mvPage = b.dataset.page; paintMoveList(); } });
  $('mv-sub').addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b && b.dataset.sub !== mvSub) { window.SFX.play('tick'); mvSub = b.dataset.sub; paintMoveList(); } });
  function closeMoveView() {
    if (!moveOpen) return;
    moveOpen = false;
    $('ed-move-view').hidden = true; $('ed-form').hidden = false; $('ed-foot').hidden = false;
  }
  function endMove() { closeMoveView(); if (selecting) setSelecting(false); }
  $('ed-sub-move').addEventListener('click', () => { window.SFX.play('tick'); setSelecting(true); });
  $('mv-cancel').addEventListener('click', () => { window.SFX.play('tick'); setSelecting(false); });
  $('mv-next').addEventListener('click', () => { if (mvPicked.size) { window.SFX.play('tick'); openMoveView(); } });
  $('mv-back').addEventListener('click', () => { window.SFX.play('tick'); closeMoveView(); $('mv-next').focus(); });
  $('mv-q').addEventListener('input', paintMoveList);
  $('ed-move-view').addEventListener('keydown', e => {
    const o = [...$('mv-list').querySelectorAll('.mv-opt')], i = o.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMoveView(); $('mv-next').focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (o.length) o[i === -1 ? (e.key === 'ArrowDown' ? 0 : o.length - 1) : (i + (e.key === 'ArrowDown' ? 1 : o.length - 1)) % o.length].focus(); }
    else if (e.key === 'Enter' && e.target.id === 'mv-q' && o[0]) { e.preventDefault(); o[0].click(); }
  });
  $('mv-list').addEventListener('click', async e => {
    const o = e.target.closest('.mv-opt');
    if (!o) return;
    const titles = [...mvPicked];
    await saveNow();
    window.SFX.play('tick');
    const r = await window.api.moveSubtasks(FILE, ID, titles, o.dataset.file, o.dataset.id);
    endMove();
    flashSaved(r && r.ok ? T('ed.mv.done') : T('att.fail'), !(r && r.ok));
    load(false);
  });
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
  // linked / moved between notes (owner 2026-10-10). Link = also SHOW this task in the other note (app state, the other
  // .md never changes); Move = the whole task block really moves into the other note. Both one Undo. Hidden when the
  // other note is switched off (one-note mode).
  let linkedTo = null;
  function paintNoteMenu(t, mode) {
    const other = t.file === 'work' ? 'personal' : 'work', note = T(other === 'work' ? 'win.tab.work' : 'win.tab.personal');
    const both = !mode || mode === 'both';
    linkedTo = t.linked || null;
    $('ed-link').hidden = $('ed-move-note').hidden = !both;
    $('ed-link').textContent = T(linkedTo ? 'ed.unlink' : 'ed.link', { n: note });
    $('ed-move-note').textContent = T('ed.moveNote', { n: note });
  }
  $('ed-link').addEventListener('click', async () => {
    toggleMenu(false); await saveNow(); window.SFX.play('tick');
    await window.api.linkTask(FILE, ID, !linkedTo); load(false);
  });
  $('ed-move-note').addEventListener('click', async () => {
    toggleMenu(false); await saveNow(); window.SFX.play('tick');
    const r = await window.api.moveTaskNote(FILE, ID);
    if (!r || !r.ok || !r.id) return load(false);
    window.dispatchEvent(new CustomEvent('task-moved', { detail: { file: r.file, id: r.id } })); // the window shows that tab
    dirty = false; edit(r.file, r.id); // the editor follows the task
  });
  $('ed-delete').addEventListener('click', async () => {
    toggleMenu(false); await saveNow();
    window.SFX.play('delete'); await window.api.deleteTask(ID, FILE); // undo lives in the window's toast
    dirty = false; close();
  });
  // Complete — the sound plays with the write, then the panel slides away (the preview-line strike went with the row)
  $('ed-complete').addEventListener('click', async () => {
    await saveNow();
    window.SFX.play('complete');
    try { await window.api.complete(ID, FILE); close(); } catch (err) { updatePreview(); }
  });

  // ---------- share ----------
  // Owner 2026-09-29: a page per note (Work · Personal), each with Open (Now + open, two foldable sections) and Done
  // lists — never mixed. ONE selection across every page and list; the foot counts it and builds ONE message
  // (lib/share.js: a Work block, then a Personal block). A search filters the list you're on (picks elsewhere stay).
  // Long lists render a first batch and load more as you scroll.
  let shSnap = null, fmt = 'text', page = 'work', sub = 'open', query = '';
  const sel = new Set(); // keys: 'o:<id>' open, 'd:<id>' done — picks survive page switches while the app runs
  const folded = { now: false, open: false };
  // day filter (#12, owner 2026-10-05): All · Today · Yesterday · Pick… (a day or a range). Every opening starts on
  // Today ("this day" is the default); lib/share.js trimTask keeps only what changed in the range (hidden stamps).
  let dayMode = 'today', pickA = null, pickB = null, calMonth = null;
  const DAY = 864e5;
  const midnight = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  function dayFilter() {
    const R = window.ShareText.dayRange, t0 = midnight();
    if (dayMode === 'today') return R(t0);
    if (dayMode === 'yday') return R(new Date(t0.getTime() - DAY));
    if (dayMode === 'pick' && pickA) return R(pickA, pickB || pickA);
    return null;
  }
  const dShort = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  function dayLabel() { // the message header's date: the day (or span) the message covers
    const f = dayFilter();
    if (!f) return dShort(new Date());
    const a = new Date(f.from), b = new Date(f.to);
    return midnight(a).getTime() === midnight(b).getTime() ? dShort(a) : `${dShort(a)} – ${dShort(b)}`;
  }
  const STEP = 30;
  let limit = STEP;
  // Include toggles (owner 2026-09-30): Subtasks · Priority · Dates in BOTH formats, remembered PER format — Markdown starts
  // with all on (the note as written), plain text with subtasks only
  // subs is a MODE: 'all' | 'open' (done subtasks left out) | 'off' — the mini switch in the Subtasks part (owner 2026-09-30)
  const opts = { md: { subs: 'all', prio: true, dates: true }, text: { subs: 'all', prio: false, dates: false } };
  const asMode = v => (v === false || v === 'off' ? 'off' : v === 'open' ? 'open' : 'all'); // earlier builds stored true / false
  try { // per-viewer conveniences only
    const saved = JSON.parse(localStorage.getItem('share.opts') || '{}');
    if (saved.md || saved.text) { for (const f of ['md', 'text']) Object.assign(opts[f], saved[f] || {}); }
    else Object.assign(opts.text, { prio: !!saved.prio, dates: !!saved.dates, subs: saved.subs !== false }); // pre-2026-09-30 shape
    for (const f of ['md', 'text']) opts[f].subs = asMode(opts[f].subs);
  } catch (e) {}
  const saveOpts = () => { try { localStorage.setItem('share.opts', JSON.stringify(opts)); } catch (e) {} };
  const INC = [['sh-prio', 'prio'], ['sh-dates', 'dates']];
  // the format is a setting (shareFmt: 'text' | 'md'), so the island's quick Copy uses the same pick (owner 2026-09-29)
  const fmtFrom = snap => (snap && snap.settings && snap.settings.shareFmt === 'md' ? 'md' : 'text');

  async function share() {
    if (kind === 'share') { close(); return; } // the Share button toggles its panel
    if (kind === 'edit') await saveNow();
    show('share');
    shSnap = await window.api.getSnapshot();
    if (shSnap && shSnap.lang && shSnap.lang !== LANG) setLang(shSnap.lang);
    fmt = fmtFrom(shSnap);
    dayMode = 'today'; pickA = pickB = null; closePops();
    limit = STEP; $('share-list').scrollTop = 0;
    paintControls(); renderShare();
  }
  const notesOn = () => { const m = (shSnap && shSnap.settings.mode) || 'both'; return m === 'both' ? ['work', 'personal'] : [m]; };
  // newest activity first (owner 2026-10-06): a task's newest created/updated stamp, its own or any subtask's; ties keep order
  const byUpdate = arr => arr.map((t, i) => [t, i, window.ShareText.activity(t)]).sort((x, y) => (y[2] - x[2]) || (x[1] - y[1])).map(x => x[0]);
  const keyOf = t => (t.isDone ? 'd:' : 'o:') + t.id;
  function lists(tag) {
    const sec0 = shSnap.sections.find(s => s.name === (tag === 'work' ? 'Work' : 'Personal'));
    const sec = sec0 && { ...sec0, items: sec0.items.filter(t => !t.shadow) }; // Share reports a task in its HOME note only (owner 2026-10-10)
    const items = sec ? sec.items : [];
    return {
      now: byUpdate(items.filter(t => t.active)),
      open: byUpdate(items.filter(t => !t.active)),
      done: byUpdate((shSnap.done || []).filter(d => d.file === tag).map(d => ({ ...d, isDone: true })))
    };
  }
  const hit = t => !query || [t.title, ...(t.notes || []), ...(t.subs || []).map(s => s.t)].some(x => String(x).toLowerCase().includes(query));
  const pickedIn = arr => arr.filter(t => sel.has(keyOf(t))).length;
  function rowHtml(t) {
    const subs = t.subs || [];
    const off = dayFilter() && !window.ShareText.trimTask(t, { day: dayFilter() }); // nothing that day: dimmed, still pickable
    return `<div class="sh-row ${sel.has(keyOf(t)) ? 'sel' : ''}${off ? ' off' : ''}" data-key="${esc(keyOf(t))}"${off ? ` title="${esc(T('sh.day.off'))}"` : ''}>
      <span class="sh-chk" aria-hidden="true"></span>
      <span class="shtitle">${inline(t.title)}</span>
      ${subs.length ? `<span class="tag">${subs.filter(s => s.done).length}/${subs.length}</span>` : ''}
      ${t.dueText ? `<span class="tag">${esc(t.dueText)}</span>` : ''}
    </div>`;
  }
  function renderShare() {
    if (!shSnap) return;
    const on = notesOn();
    if (!on.includes(page)) page = on[0];
    const L = lists(page);
    let budget = limit, more = false;
    const take = arr => { const out = arr.slice(0, Math.max(0, budget)); budget -= out.length; if (out.length < arr.length) more = true; return out; };
    let html = '';
    if (sub === 'open') {
      for (const [k, label] of [['now', T('sh.sec.nowOpen')], ['open', T('sh.open')]]) {
        const arr = L[k].filter(hit);
        if (!arr.length) continue;
        html += `<button class="sh-sec" type="button" data-fold="${k}" aria-expanded="${!folded[k]}">${window.UI.icon('chevronDown', 'chev')}<span class="hash">##</span> ${esc(label)} <span class="cnt">${arr.length}</span></button>`;
        if (!folded[k]) html += take(arr).map(rowHtml).join('');
      }
    } else {
      html = take(L.done.filter(hit)).map(rowHtml).join('');
    }
    $('share-list').innerHTML = html || `<p class="empty">${esc(T(query ? 'win.search.none' : sub === 'done' ? 'sh.none.done' : 'sh.none'))}</p>`;
    $('share-list').dataset.more = more ? '1' : '';
    syncShare();
  }
  function paintControls() {
    const on = notesOn();
    $('sh-page').hidden = on.length < 2; // a one-note setup has no page switch
    $('sh-page').querySelectorAll('.seg-btn').forEach(b => { const s = b.dataset.page === page; b.classList.toggle('sel', s); b.setAttribute('aria-checked', s); });
    $('sh-sub').querySelectorAll('.seg-btn').forEach(b => { const s = b.dataset.sub === sub; b.classList.toggle('sel', s); b.setAttribute('aria-checked', s); });
    $('fmt-seg').querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('sel', x.dataset.fmt === fmt));
    $('sh-day').querySelectorAll('.seg-btn').forEach(b => { const s = b.dataset.day === dayMode; b.classList.toggle('sel', s); b.setAttribute('aria-checked', s); });
    $('sh-day').querySelector('.pick-l').textContent = dayMode === 'pick' && pickA ? dayLabel() : T('sh.day.pick');
    $('sh-day-val').textContent = dayMode === 'pick' && pickA ? dayLabel() : T({ all: 'sh.day.all', today: 'sh.day.today', yday: 'sh.day.yday' }[dayMode] || 'sh.day.today');
    for (const [id, k] of INC) { const v = !!opts[fmt][k]; $(id).classList.toggle('on', v); $(id).setAttribute('aria-pressed', v); }
    const m = opts[fmt].subs;
    $('sh-subs').classList.toggle('on', m !== 'off');
    $('sh-subs').querySelectorAll('[data-subs]').forEach(b => { const s = b.dataset.subs === m; b.classList.toggle('sel', s); b.setAttribute('aria-checked', s); });
    // the options button names the setup in marks: "Plain text · [ ] · !! · 28 Sep" (glyphs over words)
    const g = (cls, x) => `<span class="opt-g ${cls}">${esc(x)}</span>`;
    $('sh-opt-sum').innerHTML = [esc(fmt === 'md' ? 'Markdown' : T('sh.fmt.text')),
      m === 'all' ? g('', '[ ]') : m === 'open' ? g('', '[ ]') + ' ' + esc(T('sh.subs.open')) : '',
      opts[fmt].prio ? g('p', '!!') : '', opts[fmt].dates ? g('d', '28 Sep') : ''].filter(Boolean).join(' · ');
  }
  function syncShare() { // counts on every page / list + the total; zero selection: the buttons say so
    const on = notesOn(), all = {};
    for (const tag of on) { const L = lists(tag); all[tag] = { open: pickedIn(L.now) + pickedIn(L.open), done: pickedIn(L.done) }; }
    const n = on.reduce((a, tag) => a + all[tag].open + all[tag].done, 0);
    const cnt = (el, v) => { el.querySelector('.cnt').textContent = v ? String(v) : ''; };
    $('sh-page').querySelectorAll('.seg-btn').forEach(b => cnt(b, all[b.dataset.page] ? all[b.dataset.page].open + all[b.dataset.page].done : 0));
    $('sh-sub').querySelectorAll('.seg-btn').forEach(b => cnt(b, all[page] ? all[page][b.dataset.sub] : 0));
    $('btn-copy').disabled = !n; $('btn-export').disabled = !n; $('btn-wa').disabled = !n;
    $('sel-hint').textContent = n ? T('sh.selN', { n }) : ''; // owner 2026-09-30: no "select tasks" hint — the disabled buttons say it
    $('sel-clear-all').hidden = !n;
  }
  function buildText(k) {
    const today = `${new Date().getDate()} ${MONTHS[new Date().getMonth()]}`;
    const groups = notesOn().map(tag => {
      const L = lists(tag), p = arr => arr.filter(t => sel.has(keyOf(t)));
      return { name: T(tag === 'work' ? 'win.tab.work' : 'win.tab.personal'), done: p(L.done), now: p(L.now), open: p(L.open) };
    });
    return window.ShareText.buildShare({ groups, fmt: k, withPrio: opts[k].prio, withDates: opts[k].dates, withSubs: opts[k].subs, date: dayFilter() ? dayLabel() : today, day: dayFilter(),
      labels: { done: T('sh.wa.done'), now: T('sh.wa.now'), next: T('sh.wa.next') } });
  }
  const picked = () => notesOn().some(tag => { const L = lists(tag); return pickedIn(L.now) + pickedIn(L.open) + pickedIn(L.done); });
  $('share-list').addEventListener('click', e => {
    const f = e.target.closest('[data-fold]');
    if (f) { folded[f.dataset.fold] = !folded[f.dataset.fold]; window.SFX.play('tick'); renderShare(); return; }
    const row = e.target.closest('.sh-row');
    if (!row) return;
    const k = row.dataset.key;
    sel.has(k) ? sel.delete(k) : sel.add(k);
    row.classList.toggle('sel', sel.has(k)); // the row's [ ] / [x] is drawn from .sel
    syncShare();
  });
  $('share-list').addEventListener('scroll', () => { // more on scroll (owner 2026-09-29)
    const el = $('share-list');
    if (el.dataset.more && el.scrollTop + el.clientHeight > el.scrollHeight - 120) { limit += STEP; renderShare(); }
  });
  const reList = () => { limit = STEP; $('share-list').scrollTop = 0; paintControls(); renderShare(); };
  $('sh-page').addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if (!b || b.dataset.page === page) return; page = b.dataset.page; window.SFX.play('tick'); reList(); });
  $('sh-sub').addEventListener('click', e => { const b = e.target.closest('.seg-btn'); if (!b || b.dataset.sub === sub) return; sub = b.dataset.sub; window.SFX.play('tick'); reList(); });
  $('sh-search').addEventListener('input', () => { query = $('sh-search').value.trim().toLowerCase(); $('sh-search-clear').hidden = !query; limit = STEP; renderShare(); });
  $('sh-search').addEventListener('keydown', e => { if (e.key === 'Escape' && $('sh-search').value) { e.stopPropagation(); $('sh-search-clear').click(); } });
  $('sh-search-clear').addEventListener('click', () => { $('sh-search').value = ''; query = ''; $('sh-search-clear').hidden = true; limit = STEP; renderShare(); $('sh-search').focus(); });
  // Select all / Clear act on the list you're looking at (what the search shows); Clear all empties every page
  const shown = () => { const L = lists(page); return (sub === 'open' ? [...L.now, ...L.open] : L.done).filter(hit); };
  $('sel-all').addEventListener('click', () => { for (const t of shown()) sel.add(keyOf(t)); renderShare(); });
  $('sel-clear').addEventListener('click', () => { for (const t of shown()) sel.delete(keyOf(t)); renderShare(); });
  $('sel-clear-all').addEventListener('click', () => { sel.clear(); window.SFX.play('tick'); renderShare(); });
  $('fmt-seg').addEventListener('click', e => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    fmt = b.dataset.fmt === 'md' ? 'md' : 'text'; paintControls();
    window.api.saveSettings({ shareFmt: fmt });
  });
  // ---- day filter: segments + the small calendar (dots = days something changed; future days disabled) ----
  function changedDays() {
    const keys = new Set(), add = ts => { if (ts) { const d = new Date(ts); keys.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`); } };
    const all = [...shSnap.sections.flatMap(x => x.items).filter(x => !x.shadow), ...(shSnap.done || [])];
    for (const t of all) { add(t.updatedTs); for (const x of t.subs || []) { add(x.u ? new Date(x.u).getTime() : 0); add(x.c ? new Date(x.c).getTime() : 0); } }
    return keys;
  }
  function drawCal() {
    const pop = $('day-pop'), m = calMonth, today = midnight().getTime(), has = changedDays();
    const first = new Date(m.getFullYear(), m.getMonth(), 1), lead = (first.getDay() + 6) % 7, dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const f = dayFilter() && dayMode === 'pick' ? dayFilter() : null;
    const wd = [1, 2, 3, 4, 5, 6, 0].map(i => new Date(2026, 9, 4 + i).toLocaleDateString(LANG === 'ar' ? 'ar' : 'en', { weekday: 'narrow' }));
    let cells = wd.map(x => `<span class="wd">${esc(x)}</span>`).join('') + '<span></span>'.repeat(lead);
    for (let d = 1; d <= dim; d++) {
      const ts = new Date(m.getFullYear(), m.getMonth(), d).getTime();
      const cls = [f && ts >= f.from && ts <= f.to ? (ts === midnight(new Date(f.from)).getTime() || ts === midnight(new Date(f.to)).getTime() ? 'end' : 'in') : '',
        has.has(`${m.getFullYear()}-${m.getMonth()}-${d}`) ? 'has' : ''].join(' ').trim();
      cells += `<button type="button" data-ts="${ts}" class="${cls}"${ts > today ? ' disabled' : ''}>${d}</button>`;
    }
    const nextOff = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() > today;
    pop.innerHTML = `<div class="dcal-head"><button class="dcal-nav" data-nav="-1" type="button" aria-label="${esc(T('sh.day.prev'))}">‹</button><span>${esc(m.toLocaleDateString(LANG === 'ar' ? 'ar' : 'en', { month: 'long', year: 'numeric' }).replace(/[٠-٩]/g, c => String(c.charCodeAt(0) & 0xF)))}</span><button class="dcal-nav" data-nav="1" type="button" aria-label="${esc(T('sh.day.next'))}"${nextOff ? ' disabled' : ''}>›</button></div><div class="dcal">${cells}</div><div class="dcal-hint">${esc(T('sh.day.hint'))}</div>`;
  }
  // ---- the two pops (layout A): the Day chip's menu drops below the filter bar, the options pop rises above the foot ----
  const POPS = [['sh-day-btn', 'day-menu'], ['sh-opt-btn', 'sh-opt-pop']];
  function setPop(btnId, open) {
    const [b, pop] = [$(btnId), $(POPS.find(p => p[0] === btnId)[1])];
    pop.hidden = !open; b.setAttribute('aria-expanded', open);
    if (!open && btnId === 'sh-day-btn') $('day-pop').hidden = true; // the calendar lives inside the day menu
  }
  function closePops() { for (const [b] of POPS) setPop(b, false); }
  for (const [b, p] of POPS) $(b).addEventListener('click', () => { const open = $(p).hidden; closePops(); setPop(b, open); });
  document.addEventListener('pointerdown', e => {
    for (const [b, p] of POPS) if (!$(p).hidden && !e.target.closest(`#${b}, #${p}`)) setPop(b, false);
  });
  document.addEventListener('keydown', e => {
    const open = POPS.find(([, p]) => !$(p).hidden);
    if (e.key === 'Escape' && open) { e.stopPropagation(); setPop(open[0], false); $(open[0]).focus(); }
  }, true);
  let anchorTs = null;
  const applyDay = () => { paintControls(); renderShare(); };
  $('sh-day').addEventListener('click', e => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    if (b.dataset.day === 'pick') {
      const pop = $('day-pop');
      if (!pop.hidden) { pop.hidden = true; return; }
      calMonth = midnight(pickA || new Date()); calMonth.setDate(1); anchorTs = null;
      drawCal(); pop.hidden = false; return;
    }
    setPop('sh-day-btn', false); // a quick day closes the menu
    if (b.dataset.day === dayMode) return;
    dayMode = b.dataset.day; window.SFX.play('tick'); applyDay();
  });
  $('day-pop').addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + +nav.dataset.nav, 1); drawCal(); return; }
    const d = e.target.closest('.dcal button[data-ts]');
    if (!d) return;
    const ts = +d.dataset.ts;
    if (anchorTs === null) { anchorTs = ts; pickA = new Date(ts); pickB = null; } // first click: that day
    else { pickA = new Date(Math.min(anchorTs, ts)); pickB = new Date(Math.max(anchorTs, ts)); anchorTs = null; } // second: the span
    dayMode = 'pick'; window.SFX.play('tick'); drawCal(); applyDay();
    if (anchorTs === null) setTimeout(() => setPop('sh-day-btn', false), 380); // a finished span closes the menu
  });
  for (const [id, k] of INC) $(id).addEventListener('click', () => { opts[fmt][k] = !opts[fmt][k]; window.SFX.play('tick'); saveOpts(); paintControls(); });
  $('sh-subs').addEventListener('click', e => {
    const b = e.target.closest('[data-subs]');
    if (!b || b.dataset.subs === opts[fmt].subs) return;
    opts[fmt].subs = b.dataset.subs; window.SFX.play('tick'); saveOpts(); paintControls();
  });
  const flashBtn = (b, text) => { const old = b.textContent; b.textContent = text; setTimeout(() => { b.textContent = old; }, 1200); };
  $('btn-copy').addEventListener('click', async () => {
    if (!picked()) return;
    await window.api.copyText(buildText(fmt));
    window.SFX.play('tick');
    flashBtn($('btn-copy'), T('sh.copied'));
  });
  // WhatsApp: always the WhatsApp format; the app (or WhatsApp Web) opens with the message ready for a contact / group
  $('btn-wa').addEventListener('click', async () => {
    if (!picked()) return;
    const res = await window.api.openWhatsApp(buildText('text'));
    window.SFX.play('tick');
    $('share-note').textContent = !(res && res.ok) ? T('sh.wa.fail') : res.paste ? T('sh.wa.paste') : T('sh.wa.opened');
    $('share-note').title = '';
  });
  $('btn-export').addEventListener('click', async () => {
    if (!picked()) return;
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
