# CourseFlow

A local-first desktop app (Electron + React + SQLite) for watching downloaded
video courses, tracking progress, and keeping timestamped notes. Designed to feel
like a modern learning portal — while keeping every byte on your machine.

## Requirements

- Node.js 20 or newer (tested with Node 24)
- Windows, macOS, or Linux

No C++ build tools are required: `better-sqlite3` ships prebuilt binaries for
both Node and Electron. The `postinstall` script downloads the Electron build
automatically.

## Run

```bash
npm install
npm run dev       # Vite dev server + Electron with hot reload for the renderer
```

## Production build

```bash
npm run build     # renderer (Vite) + main/preload (tsc)
npm start         # launch the built app
npm run dist      # build a Windows installer (release/)
```

## Install on Windows

`npm run dist` produces `release/CourseFlow Setup 1.0.0.exe`. Run it to install
CourseFlow with a Start-menu entry and desktop shortcut. The installed app is named
**CourseFlow**, uses the app icon, and keeps the same data folder as the development
build, so an existing library and progress carry over unchanged.

The icon is generated from a single source by `npm run icons` (writes
`build/icon.ico`, `build/icon.png`, and the PNG sizes under `build/icons/`).

## Features

**Library & tracking**
- Import any folder of videos; subfolders become sections and files become lectures.
- Automatic course scanning with natural sort order, subtitle/resource detection, and
  video durations read directly from the file headers.
- Continue-watching hero, per-course progress rings, and a full activity history.
- **Time-based course progress**: completion is measured as watched time divided by
  total course duration, so a 50-lecture course and a 5-lecture course are measured
  the same way. Progress is based on unique video coverage, so rewinding and
  replaying a section never counts it twice, and seeking ahead never counts as
  watching.
- Mark lectures complete (manually or automatically at a configurable threshold).
  Completion is based on how much of the lecture was actually watched.
- Resume any lecture from where you left off, including after restarting the app.
- Per-lecture watch progress, "next up" highlighting, and course-level completion.
- Rename a course in the app without touching its folder or files on disk.
- **Consistency calendar**: a GitHub-style year of squares on the dashboard. Each day
  you watch fills a square, and darker squares mean more minutes watched. Current
  streak, best streak, active days, and total watched time are summarised above it.
- Percentages are shown to one decimal where needed, so even a small lecture in a
  long course visibly moves the bar.

**Focus & review**
- Flag any lecture as **review later**; it collects in a dedicated Review queue.
- Search every lecture instantly from the command palette (`Ctrl + K`).
- Timestamped notes (create, edit, delete) that jump back to the exact moment.
- Saved "moments" — named bookmarks at precise video positions.

**Player**
- Custom video chrome: scrubbing, volume, speed (0.5×–2×), PiP, and captions.
- Embedded SRT/VTT subtitles converted to WebVTT on the fly (ASS/SSA is detected
  and flagged as unsupported). Caption size, color, and background opacity are
  configured in **Settings → Caption appearance**; the player only toggles captions
  and lets you attach an external subtitle file.
- Real fullscreen: the whole window goes fullscreen, with the title bar and
  sidebar hidden so only the video remains. `Escape` exits the player cleanly.
- Autoplay the next lecture with a visible countdown, plus previous/next controls.
- Moving to the next lecture keeps the player mounted, so playback never flickers
  or resets the layout.
- Per-course playlist with search, section collapsing, and inline progress. The
  playlist scrolls itself to the current lecture without moving the page.
- Notes, moments, resources, and subtitles live in tabs beneath the video.
- Video keeps playing and stays visible while the window is in the background, so
  Alt-Tab previews and switching back do not show a black frame.

**Interface**
- Frameless window with a draggable custom title bar and native window controls.
- Five themes chosen in **Settings** — **Minimal** (default), Light, Dark, Warm,
  and System — that apply instantly and persist. The title bar button toggles
  between Minimal and Dark.
- Sections remember which ones you opened: only the current section starts
  expanded, and anything you open or close stays that way across sessions.
- Bundled Inter variable font with generous type scale and WCAG-friendly contrast.
- Command palette, toasts, dialogs, keyboard shortcuts, and a responsive layout.
- Accessible focus states, reduced-motion support, and readable contrast.

**Backup & transfer**
- **Settings → Backup & transfer → Export data** writes one JSON file containing
  every course, section, lecture, progress record, note, moment, review flag,
  watch history, daily activity, and your interface preferences.
- **Import data** on another computer restores all of it. The current library is
  snapshotted to `learn-pre-import-<time>.db` before anything is replaced.
- Imported courses keep their original file paths. If a course folder no longer
  exists, CourseFlow asks you to point at the new location and rewrites the stored
  paths by prefix, so progress, notes and moments stay attached. You can also do
  this later from a course card's **Locate folder** menu item.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl + K` | Search every lecture |
| `Space` / `K` | Play or pause |
| `←` / `→` | Seek 5 seconds |
| `J` / `L` | Seek 10 seconds |
| `Shift + ←` / `→` | Seek 30 seconds |
| `↑` / `↓` | Volume up or down |
| `M` | Mute |
| `F` | Fullscreen |
| `P` | Picture in picture |
| `C` | Toggle captions |
| `B` | Save a moment |
| `N` | Focus notes |
| `Shift + N` | Next lecture |
| `[` / `]` | Playback speed |
| `?` | Shortcut overlay |

## Course folder layout

Import any folder. Subfolders become sections, and video files become lectures:

```
My Course/
  Getting Started/          <- section
    01 - Welcome.mp4        <- lecture (titled "Welcome")
    01 - Welcome.srt        <- subtitle auto-matches the lecture
    notes.pdf               <- resource
  Advanced/
    02 - Deep Dive.mp4
```

Video files directly in the root are grouped into a single "Lectures" section.
Supported videos: `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`. Subtitles: `.srt`,
`.vtt` (playable), `.ass`, `.ssa` (detected, conversion required).

## Data

Progress, notes, bookmarks, history, daily activity, and preferences are stored
locally:

- Windows: `%APPDATA%\local-course-learning\learn.db`
- macOS: `~/Library/Application Support/local-course-learning/learn.db`
- Linux: `~/.config/local-course-learning/learn.db`

Nothing is uploaded anywhere. You can open this folder from **Settings → App data
folder**. Use **Settings → Backup & transfer** to move the library to another
computer; the JSON backup contains the database plus your CourseFlow preferences,
and the video files themselves stay in their folders.
