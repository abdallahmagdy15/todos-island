# AGENTS.md — Todos Island

Standing instructions for AI agents working in this repo. Read this first, every session.

## What this is

**Todos Island** is a Windows tray app (Electron) that reads two plain-markdown todo notes and reminds you via a Dynamic-Island-style pill that drops from the top of the screen. The notes are the single source of truth — the app is a lens over them, never a database.

## Architecture map

| file | purpose | read when |
|---|---|---|
| AGENTS.md (this) | standing contract | every session |
| main.js | Electron main: tray, island window, main window, quick editor, share window, IPC, settings, undo log | touching any cross-window behavior |
| lib/parse.js | THE parser: markdown ↔ task model, `NoteFile` class, all block ops (complete/delete/move/undo) | any format or note-operation work |
| lib/parse.test.js | parser self-check suite | after touching parse.js |
| lib/schedule.js | pure reminder scheduler: when does the island next pop | any reminder-cadence work |
| lib/schedule.test.js | scheduler self-check (dual cadence, night guard, weekends) | after touching schedule.js |
| lib/compose.js | composer: typed text + chip choices → the exact task + note line (`composeTask`, reuses `parseMeta`/`fmtTask`) | add-task / editor preview work |
| lib/compose.test.js | composer self-check | after touching compose.js |
| lib/icon.js | tray icon PNG generated in pure Node (zlib + CRC32) | icon changes |
| scripts/make-icon.js | regenerates `build/icon.ico` (7 sizes) — run `npm run icon` | icon changes |
| island.html/css/js | the drop-down pill UI (top of screen) | island behavior/looks |
| window.html/css/js | main tasks window: tabs, list, search, settings | main window |
| editor.html/css/js | quick-edit popup for one task | editor |
| share.html/css/js | share window: pick tasks → copy as WhatsApp/Markdown text or export .md | share/export |
| sfx.js | WebAudio synth engine, no audio assets (SFX.play(name)) | sounds |
| tokens.css | THE design tokens (type/radius/space/motion scales + guards), linked first by every window | any styling |
| motion.js | `window.Motion` WAAPI wrapper — reduced-motion gated, always returns a Promise | any JS-driven animation |
| ui-shared.js | `window.UI` — shared helpers (`esc`, `bangCls`, due parsing) + components (priority chips, due control) | shared UI |
| island-preload.js / window-preload.js | contextBridge IPC contracts | adding any main↔renderer call |

## The note format (v2.1) — never break it

```markdown
- [ ] * !! 24 Sep — Task title
	description line (indented plain)
	- [ ] subtask (indented checkbox)
```

- Leading meta tokens, any order: `*` active (working on it now, multiple allowed) · `!`/`!!`/`!!!` priority · `D Mon` due (year auto-inferred; rolls to next year if >45 days past)
- Three task states: open / active (`*`) / done (ticked; work notes move it under `## Done`)
- Subtask = indented `- [ ]` (tab or 2+ spaces; a single leading space is still top-level)
- Description = indented plain lines in the task's block
- Parser also accepts legacy trailing styles (`— !! — due:2026-09-24`) and always WRITES v2.1
- **Invariant:** unchanged tasks emit their raw line verbatim → clean round-trip is byte-identical. Every parse.js change must keep `npm test` green (49 asserts: 35 parser + 14 scheduler; the two real-note round-trip tests activate via `TODO_WORK_NOTE`/`TODO_PERSONAL_NOTE` env vars).

## Reminder scheduling (v1.3)

`lib/schedule.js` is a **pure** function `nextFireAt(settings, lastShown, now)` — no timers inside; main.js polls it every 15 s from the tray tick.

- **Dual cadence:** `workIntervalMin` inside the workday, `offIntervalMin` outside — each with its own on/off toggle (`workRemindersOn` / `offRemindersOn`). Both off = manual mode (never auto-fires).
- **Night guard:** nothing fires between midnight and `dayStart`; evening fires never cross midnight (they clamp to tomorrow's start — no 00:00 pops, honest tooltips).
- **`weekendAware`** means weekends run the OFF-hours schedule (personal time), NOT total silence. With it off, weekends count as workdays.
- **`focusByTime`** (default on): the island shows work tasks only during work hours, personal only outside. The filter lives in island.js rendering ONLY — the snapshot always carries both sections, so the tasks/share windows are never filtered.
- Any cadence change must keep `lib/schedule.test.js` green and ideally add a case for the new behavior.

## Undo (v2)

In-memory `undoLog` Map in main.js: one tokened entry per interaction, exact rollback material (`captureBlock` = task lines + index). One-shot per token; entries die via the popup's own `undo-expire` countdown — there is NO sweeper interval and nothing persists to disk. If you add an undoable action, follow the same shape (see `delete-task`).

## Commands

- `npm start` — run the app in dev
- `npm test` — full self-check: parser + scheduler (run before any commit)
- `npm run icon` — regenerate build/icon.ico after icon.js changes
- `npm run dist` — build the Windows NSIS installer into dist/
- E2E smoke: launch with `TODO_ISLAND_UNDO_TEST=1` — drives real UI clicks (complete/delete/star/reorder, composer, Done tab clear+undo, settings dirty guard, share copy) and logs `UTEST` lines to `%TEMP%/todo-island.log`.
- **Always sandbox the E2E:** also set `TODO_ISLAND_USERDATA=<scratch dir>` whose `state.json` points at *copies* of notes — the run then never touches real notes, and it quits itself at the end.

## House rules (learned the hard way)

1. **Transparent island window:** NEVER add a CSS box-shadow to the pill — it clips against the window edge and shows as a square halo.
2. **Nested flex:** every flexible ancestor in a chain that holds long `nowrap`/clamped text needs `min-width: 0` — flex items default to `min-width: auto` and will stretch the window.
3. **`[hidden]`**: any element with a `display` rule needs the global `[hidden] { display: none !important; }` guard (already in both CSS files — keep it).
4. **Task IDs change** when title/priority/due change; `update-task` returns the new id and the editor adopts it.
5. **Native controls:** `color-scheme: light dark` on `:root` keeps time/select/scrollbar icons visible in both themes; all colors go through CSS tokens.
6. **Zoom is locked** (`lockZoom`) — do not remove; accidental Ctrl+scroll wrecks the layout.
7. New IPC: add to the handler in main.js AND the matching preload, same channel name, then run `node --check` on all touched js files.
8. No new npm dependencies without a strong reason. No personal data (paths, names, sample tasks) in code, tests, or docs.
9. **Electron 44 clipboard is async** — `await clipboard.writeText/readText`, or you'll stringify a Promise.
10. **Autostart:** `applyAutoStart()` must pass `app.getAppPath()` (dev) + `--hidden` in login-item args — a bare electron.exe Run entry boots the default Electron welcome page. `--hidden` launches also skip the 1.5 s launch pop; startup re-applies the registration as self-heal.
11. **State lives in `app.getPath('userData')/state.json`** (writable when packaged — asar is read-only). Never write next to `__dirname`.
12. **Island geometry:** top-anchored at `wa.y + 10`, grows DOWN via the `island-size` IPC (height + optional space borrowed above, clamped to the work area). Don't bottom-anchor it.
13. **Settings migration:** `migrateSettings()` upgrades old keys (`intervalMin` → `workIntervalMin`). When adding settings keys, give them a DEFAULT_SETTINGS entry so old state.json files merge cleanly.

## Write access

The two note files are the END USER's data. The app writes them only on explicit user actions in the UI. AI agents never bulk-edit user notes.
