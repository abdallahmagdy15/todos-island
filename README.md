# Todos Island

A Dynamic-Island-style **todo reminder for Windows** that lives in your tray and reads your **plain markdown notes** — no accounts, no database, no lock-in. Your notes stay yours.

![status](https://img.shields.io/badge/status-v1.4-blue) ![platform](https://img.shields.io/badge/platform-Windows-lightgrey) ![license](https://img.shields.io/badge/license-MIT-green)

## What it does

- **The Island** — a rounded pill drops from the top of your screen on two schedules you control: one interval inside your workday, another for evenings/weekends, each with its own on/off toggle. Click a task to stage it as **Now**, tick `[ ]` to complete, ✎ to edit.
- **English & العربية** — the whole interface (window, island, editor, share, tray) switches language from Settings or follows your system; Arabic flips the UI to full RTL. Tasks and notation stay exactly as you write them.
- **Three task states** — open · **Now** (`*` — what you're working on right now, multiple allowed) · done. One keyboard-driven list: ↑/↓, Enter, Space, `*`, 0–3 priority, `/` search, `?` shortcuts.
- **Ink & Notation design** — paper-and-ink chrome where color only means something: the `!!!`/`!!`/`!` heat ramp, blue highlighter for Now, frosted glass on floating layers, Windows 11 Mica on the tasks window.
- **Undo everything** — complete, delete, unstage, reorder, clear-done: every write gets a countdown undo bubble.
- **Share your day** — pick any mix of tasks → copy as WhatsApp text or Markdown, or export .md. One click from the island too.
- **Gentle by design** — skeleton shimmer while notes load, pin, hover-pause auto-dismiss, optional sounds, first-run setup wizard, quiet autostart.

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
npm test    # 6 gates: parser, scheduler, composer, i18n parity, setup, css-coverage (91 asserts)
npm run dist  # build the installer
```

Stack: Electron, zero runtime dependencies, one parser, hand-rolled SVG icons. Light/dark follows your system.

## License

MIT
