# AGENTS.md — Todos Island

Standing instructions for AI agents working in this repo. Read this first, every session.

## What this is

**Todos Island** is a Windows tray app (Electron) that reads two plain-markdown todo notes and reminds you via a Dynamic-Island-style pill that drops from the top of the screen. The notes are the single source of truth — the app is a lens over them, never a database.

## Architecture map

| file | purpose | read when |
|---|---|---|
| AGENTS.md (this) | standing contract | every session |
| main.js | Electron main: tray, island window, main window, quick editor, IPC, settings, undo stack | touching any cross-window behavior |
| lib/parse.js | THE parser: markdown ↔ task model, `NoteFile` class, all block ops (complete/delete/move/undo) | any format or note-operation work |
| lib/parse.test.js | self-check suite (`npm test`) — run before every commit | after touching parse.js |
| lib/icon.js | tray icon PNG generated in pure Node (zlib + CRC32) | icon changes |
| scripts/make-icon.js | regenerates `build/icon.ico` (7 sizes) — run `npm run icon` | icon changes |
| island.html/css/js | the drop-down pill UI (top of screen) | island behavior/looks |
| window.html/css/js | main tasks window: tabs, list, search, settings | main window |
| editor.html/css/js | quick-edit popup for one task | editor |
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
- **Invariant:** unchanged tasks emit their raw line verbatim → clean round-trip is byte-identical. Every parse.js change must keep `npm test` green (34 asserts; the two real-note round-trip tests activate via `TODO_WORK_NOTE`/`TODO_PERSONAL_NOTE` env vars).

## Commands

- `npm start` — run the app in dev
- `npm test` — parser self-check (run before any commit)
- `npm run icon` — regenerate build/icon.ico after icon.js changes
- `npm run dist` — build the Windows NSIS installer into dist/

## House rules (learned the hard way)

1. **Transparent island window:** NEVER add a CSS box-shadow to the pill — it clips against the window edge and shows as a square halo.
2. **Nested flex:** every flexible ancestor in a chain that holds long `nowrap`/clamped text needs `min-width: 0` — flex items default to `min-width: auto` and will stretch the window.
3. **`[hidden]`**: any element with a `display` rule needs the global `[hidden] { display: none !important; }` guard (already in both CSS files — keep it).
4. **Task IDs change** when title/priority/due change; `update-task` returns the new id and the editor adopts it.
5. **Native controls:** `color-scheme: light dark` on `:root` keeps time/select/scrollbar icons visible in both themes; all colors go through CSS tokens.
6. **Zoom is locked** (`lockZoom`) — do not remove; accidental Ctrl+scroll wrecks the layout.
7. New IPC: add to the handler in main.js AND the matching preload, same channel name, then run `node --check` on all touched js files.
8. No new npm dependencies without a strong reason. No personal data (paths, names, sample tasks) in code, tests, or docs.

## Write access

The two note files are the END USER's data. The app writes them only on explicit user actions in the UI. AI agents never bulk-edit user notes.
