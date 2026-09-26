# AGENTS.md — Todos Island

Standing instructions for AI agents working in this repo. Read this first, every session.

## What this is

**Todos Island** is a Windows tray app (Electron) that reads two plain-markdown todo notes and reminds you via a Dynamic-Island-style pill that drops from the top of the screen. The notes are the single source of truth — the app is a lens over them, never a database.

## Why this app exists — the product core (read before designing ANY feature)

Confirmed with the owner (interview, 2026-09-26). This is what makes it different from every other todo app; a feature that fights these is wrong even if it is "standard" elsewhere.

| # | Core why | What it means for code/design |
|---|---|---|
| 1 | **Push, not pull.** Tasks come to you. Built first for people who lose track of a task the moment the list is out of sight (focus / ADHD-style minds). A normal todo app waits to be opened, and opening a big window is itself a distraction. | Auto reminders are **ON by default**. The island is the main surface; the tasks window is secondary. The island shows itself, then tucks away. |
| 2 | **Few, not many.** People really work on ~1–3 things a day. Short-term focus lives here; long-term goals and projects live elsewhere (project boards and similar). | The default view is **Now (★) emphasized + a short top few**; the full list is one deliberate step away (expand / tasks window). This is a soft default: users may configure more, but defaults stay few. |
| 3 | **Notes are the state.** Plain markdown the user owns, editable anywhere. | The app never owns task data. More sources (MS To Do, Azure Boards, a DB…) may come later as a **one-time-setup connector**. Their behavior is undecided; don't design it without the owner. Markdown stays the default and the reference format. |
| 4 | **Time decides focus.** Work leads in work hours; personal leads after hours and on weekends. | The work/off-time schedule, dual cadence and `focusByTime` are **core**, not extras. |
| 5 | **The look is the motivation.** The Apple Dynamic-Island feel is what makes the user *want* to glance at it and review reminders. | Polish is a feature: Ink & Notation tokens, glass-look pill, light motion. Never ship a plain/utilitarian island. |
| 6 | **Share is core.** Many people must report their daily progress to someone: a lead on WhatsApp, a teammate, or an AI. Other todo apps miss this. | Share = **Done today · In progress / Now · Next**. **Work-only is the default selection.** Copy as WhatsApp / Markdown text. Share templates are a welcome future direction. |
| 7 | **The notation is the power feature.** Priority, due date and Now are set by just typing `!`/`!!`/`!!!`, `*` and a short date (`26 Sep`, no year) at the line start. The user can hand-edit any note in any editor and still configure every attribute, with no UI needed and no syntax to learn beyond what people already type. | Every attribute must stay **typable by hand as a short, common token** in the line itself. Never add an attribute that needs the app to set it: no hidden IDs, no metadata blocks, no front-matter. The parser stays tolerant (any order, year inferred, legacy styles read). The composer accepts the same tokens as the note. A new attribute gets a new short token, designed with the owner. |

**Must never break (owner rule, 2026-09-26)** — every change keeps these:
1. A timed island pop **never steals focus** (keyboard/typing is never interrupted). Only the global shortcut focuses the island.
2. Every complete/delete (and every other note write) is **undoable**.
3. The app **shows exactly what it will write** before it writes (the editor/composer "will write" line).
4. **Honest failure:** a missing or unreadable note shows an error, never an empty "all done" list.
5. **The user's hands only:** the app writes notes only on the user's own clicks. AI agents never write through the app.

**Never becomes:**
- **A project manager:** no projects, boards, assignees or recurring-task engines.
- **A notes-keeping app:** no Notion-style knowledge base.
- **Heavy or slow:** no runtime deps, no framework; the tray app stays light and instant.

**Feature test:** before building anything, ask:
1. Does the default view stay few and focused?
2. Do reminders stay automatic?
3. Does the data stay in the user's source?
4. Does it stay light?
5. Can the user still set every attribute by hand-typing the note?

A "no" on any of these → propose it to the owner, don't build it.

**Defaults:** `DEFAULT_SETTINGS` in main.js are the owner's own tuned setup: 60/60 min cadence, 10 s dismiss, 5 s undo, 1 s hover, weekend-aware, autostart and sound on. Every new install starts from them. Change a default only on the owner's word.

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
| lib/setup.js | pure first-run planner: onboarding answers → settings patch + notes to create/adopt (`planSetup`) | onboarding / task-mode work |
| lib/setup.test.js | setup planner self-check (skip, folder/file picks, adopt-existing, reminder mapping) | after touching setup.js |
| lib/i18n.js + locales/en.js, ar.js | interface strings (English/Arabic), dual-mode loader | any user-visible text |
| lib/icon.js | tray icon PNG generated in pure Node (zlib + CRC32) | icon changes |
| scripts/make-icon.js | regenerates `build/icon.ico` (7 sizes) — run `npm run icon` | icon changes |
| island.html/css/js | the drop-down pill UI (top of screen) | island behavior/looks |
| window.html/css/js | main tasks window: tabs, list, search, settings | main window |
| editor.html/css/js | quick-edit popup for one task | editor |
| share.html/css/js | share window: pick tasks → copy as WhatsApp/Markdown text or export .md | share/export |
| onboard.html/css/js + onboard-preload.js | first-run setup window (4 screens) | onboarding |
| sfx.js | WebAudio synth engine, no audio assets (SFX.play(name)) | sounds |
| tokens.css | THE design tokens (type/radius/space/motion scales + guards), linked first by every window | any styling |
| motion.js | `window.Motion` WAAPI wrapper — reduced-motion gated, always returns a Promise | any JS-driven animation |
| ui-shared.js | `window.UI` — shared helpers (`esc`, `bangCls`, due parsing) + components (priority chips, due control) | shared UI |
| island-preload.js / window-preload.js / onboard-preload.js | contextBridge IPC contracts | adding any main↔renderer call |

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
- **Invariant:** unchanged tasks emit their raw line verbatim → clean round-trip is byte-identical. Every parse.js change must keep `npm test` green (35 parser asserts; the two real-note round-trip tests activate via `TODO_WORK_NOTE`/`TODO_PERSONAL_NOTE` env vars).

## Reminder scheduling (v1.3)

`lib/schedule.js` is a **pure** function `nextFireAt(settings, lastShown, now)` — no timers inside; main.js polls it every 15 s from the tray tick.

- **Dual cadence:** `workIntervalMin` inside the workday, `offIntervalMin` outside — each with its own on/off toggle (`workRemindersOn` / `offRemindersOn`). Both off = manual mode (never auto-fires).
- **Night guard:** nothing fires between midnight and `dayStart`; evening fires never cross midnight (they clamp to tomorrow's start — no 00:00 pops, honest tooltips).
- **`weekendAware`** means weekends run the OFF-hours schedule (personal time), NOT total silence. With it off, weekends count as workdays.
- **`focusByTime`** (default on): the island shows work tasks only during work hours, personal only outside. The filter lives in island.js rendering ONLY — the snapshot always carries both sections, so the tasks/share windows are never filtered.
- Any cadence change must keep `lib/schedule.test.js` green and ideally add a case for the new behavior.

## First run & task mode (v1.4)

- **Task mode** `settings.mode`: `both` | `work` | `personal`. A disabled note is never read (no section, no error, no source), its tab and Settings rows hide, and the composer targets the enabled note. `focusByTime` filters the island only in `both` mode, because a one-note user would otherwise get an empty island half the day. Switching a note ON in Settings creates its file if missing (`createNote`, `wx`: never overwrites).
- **Onboarding** shows only when there is no state.json. A state.json without `onboarded` is an existing install, and `onboarded` is set to true. Until onboarded: no launch pop, no timed pops, and tray/shortcut/second-instance all open the setup window.
- Flow: Welcome (hero) → Your tasks (mode + "Use existing file…" / "Choose folder…") → Reminders (on, hours, every, Start with Windows) → Ready (keycaps; the real island drops in).
- **Skip** (button, Esc, or closing the window) = Personal only, one `personal.md` in `Documents/todos-island/`, defaults untouched. Picking nothing = the note is created in that default folder. A picked folder that already holds the note name → adopted, not created.
- `planSetup` (lib/setup.js) is the single rule for all of this; main.js only performs the plan.
- E2E: a fresh `TODO_ISLAND_USERDATA` dir (no state.json) triggers onboarding. `TODO_ISLAND_PICK=<path>` answers the native file/folder dialog in sandbox runs. `applyAutoStart` is a no-op in sandbox runs, so tests never touch the real login item.

## Undo (v2)

In-memory `undoLog` Map in main.js: one tokened entry per interaction, exact rollback material (`captureBlock` = task lines + index). One-shot per token; entries die via the popup's own `undo-expire` countdown — there is NO sweeper interval and nothing persists to disk. If you add an undoable action, follow the same shape (see `delete-task`).

## UI contract (v1.4 redesign)

- **Vocabulary:** the `*` state is **Now** (★); clearing it is **Not now**; children are **subtasks**. Undo verbs come from `UI.undoText` only.
- **Island rows (owner, 2026-09-25):** row click = stage/unstage **Now** (the fast path). Edit = the pencil button at row end — it retracts the pill, opens the tasks window, and puts the editor on top for that task (`editFromIsland` in island.js). Writes also via `[ ]` complete, Done, Not now, subtask tick.
- **Honest failure:** a note that can't be read shows `[!]` + a persistent banner (island pins itself; window shows an error strip, `Work ·!` tab and an "unavailable" empty state) — never an empty "Nice." list.
- **Keyboard:** task lists are ONE roving tab stop (↑/↓, Enter edit, Space/x complete, `*`/s Now, 0–3 priority, Del delete, `/` search, `n` new, `?` key list). The island takes focus ONLY when summoned by the global shortcut and drops focusability on hide — timed pops never steal focus. The shortcut is a **toggle**: the same key dismisses a visible island through the animated retract (`retract-island` channel → `onRetract`).
- **Shared components (ui-shared.js):** `UI.mountUndo` is THE undo bubble (window toast + island bar); `UI.countdown` drains bars with `transform: scaleX` and pauses from elapsed time; `UI.prioChips` / `UI.dueControl` are the only priority/due inputs. Don't fork them per window.
- **Editor:** shows a "will write" line (via `compose-task`); Save writes what that line says. Rare actions (move/delete) live in the ⋯ menu.
- **Glass (liquid-glass pass):** real `backdrop-filter` glass ONLY on floating layers (undo toast, notice, `?` popover, editor ⋯ menu). The island pill gets glass-LOOK only — `.rim` specular edge + top sheen drawn inside; never acrylic/mica/backdrop/outer shadow on the island (square halo). The tasks window uses Win 11 Mica (`backgroundMaterial`) only on build ≥ 22621 (`MICA` in main.js, `?mica=1` → `.mica` class); set `TODO_ISLAND_NO_MICA=1` to force solid.
- **CSS coverage (hard gate):** every class in a window’s markup must resolve in the stylesheets that window loads — `npm test` runs `scripts/css-coverage.js` and FAILS on unresolved classes (born from the unstyled Language segmented control, 2026-09-26). Shared component styles live in tokens.css (`.seg` lives there; share.css must not re-declare). Adding markup that references a style = adding/verifying the style in the same change. JS-only state classes go in the ALLOW list with a reason.
- **i18n (v1.4):** interface English/Arabic via `locales/${code}.js` + `lib/i18n.js` (dual-mode: window.I18N / require). Setting `uiLang`: system|en|ar; snapshot carries resolved `lang`. **Notation never translates** (bangs, stars, dates, numerals). Renderers re-apply via `I18N.applyDoc` (data-i18n/-ph/-title/-aria + dir/lang) on lang change; `UI.setLang` feeds shared components. Locale consts must be unique per file (`STRINGS_EN`/`STRINGS_AR`) — plain script tags share one global scope. `npm test` includes the en/ar parity gate.
- **Colors:** only through tokens.css; `npm run contrast` must pass (≥4.5:1 text in both schemes). Native title-bar colors live in main.js `THEME` and must match `--paper`/`--muted`.
- **Motion writes in parallel, never first:** animate while the IPC write runs (`Promise.all`), roll the animation back on failure. While an animation runs, incoming snapshots/refreshes are deferred (`animating` counter) so the moving row isn't destroyed.

## Commands

- `npm start` — run the app in dev
- `npm test` — full self-check: parser + scheduler + composer + i18n parity + setup planner (83 asserts; run before any commit)
- `npm run contrast` — WCAG gate over tokens.css (light + dark); run after any color change
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
