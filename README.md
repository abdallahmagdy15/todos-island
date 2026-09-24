# Todos Island

A Dynamic-Island-style **todo reminder for Windows** that lives in your tray and reads your **plain markdown notes** — no accounts, no database, no lock-in. Your notes stay yours.

![status](https://img.shields.io/badge/status-v1.0-blue) ![platform](https://img.shields.io/badge/platform-Windows-lightgrey) ![license](https://img.shields.io/badge/license-MIT-green)

## What it does

- **The Island** — a rounded pill drops from the top of your screen every N minutes inside your workday: your active tasks, top-3 by priority/deadline, expandable to everything. Work first during the day, personal after hours.
- **Three task states** — open · **active** (`*` — what you're working on right now, multiple allowed) · done.
- **Full task editor** — multiline descriptions, subtasks (add, tick, delete), priority, due date, move up/down, delete with undo.
- **Done tab + restore**, **live search**, tab counts, quick Today/Tomorrow dates.
- **Gentle by design** — pin it, progress-bar auto-dismiss (pauses on hover), 30-second undo for complete/delete, soft optional sound, weekend awareness, global shortcut (default `Ctrl+Alt+T`).

## Your notes are the format

```markdown
- [ ] * !! 24 Sep — Ship the API docs
	client asked for auth examples — send before Thursday
	- [ ] Write the curl samples
	- [ ] Proofread
- [x] !! 20 Sep — Set up CI
```

- `*` = active now · `!` `!!` `!!!` = priority · `24 Sep` = due (year inferred)
- Indented lines under a task = description (plain) or subtasks (`- [ ]`)
- Works with **any** markdown editor — point the app at two note files (work + personal) in Settings and edit them anywhere, anytime. The app never fights you for the file.

## Install

Grab `TodosIsland-Setup-x.y.z.exe` from [Releases](../../releases), install, find the dark pill in your tray. First run: open the gear → Settings → set your two note paths.

## Develop

```bash
npm install
npm start   # run
npm test    # parser self-check (34 asserts)
npm run dist  # build the installer
```

Stack: Electron, zero runtime dependencies, one parser, hand-rolled SVG icons. Light/dark follows your system.

## License

MIT
