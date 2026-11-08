# CourseFlow — Project Context & Instructions

This document is the complete handoff for any developer or AI assistant working on
CourseFlow. Read it before changing code. It describes what the app is, how it is
built, the data model, the invariants that must not regress, and how to run and
verify changes.

---

## 1. What CourseFlow is

CourseFlow is a **local-first Windows desktop app** for watching downloaded video
courses. It is built with **Electron + React + TypeScript + Vite + SQLite**. It has
no server, no account, and no network calls for library data. Everything (course
index, progress, notes, bookmarks, review flags, activity) lives in a SQLite
database in the user's AppData folder.

Core capabilities:

- Import a folder of videos. Subfolders become sections, videos become lectures.
- Scan video durations from MP4/MOV headers, detect subtitles and resources.
- Watch videos in a custom player with resume, speed, PiP, fullscreen, captions.
- Track **real watched coverage** (never rewound/replayed time twice).
- Mark lectures complete manually or automatically at a threshold.
- Timestamped notes and named moments/bookmarks that jump to video positions.
- “Review later” queue and global lecture search (`Ctrl+K`).
- Time-based course progress and a GitHub-style consistency calendar.
- Five themes, export/import of the entire library as one JSON backup.

The project is **not a git repository** in its current folder. Treat files as the
source of truth and avoid destructive rewrites.

---

## 2. Repository layout

```
CourseFlow/
  package.json               scripts, Electron/Vite build config, electron-builder
  vite.config.ts             renderer build (root: src/renderer, out: dist/renderer)
  tsconfig.json              renderer TS config
  tsconfig.main.json         main-process TS config -> dist/main
  tsconfig.preload.json      preload TS config -> dist/preload
  scripts/                   icon generation + native module rebuild helper
  build/                     icon assets used by electron-builder
  dist/                      build output (generated; do not hand-edit)
  src/
    main/
      main.ts                Electron main process: window, all IPC handlers, progress,
                             stats, backup/import, settings, subtitles, activity
      db.ts                  SQLite schema, migrations, seed data
      scanner.ts             folder scan -> sections/lectures/subtitles/resources
      media.ts               header-only MP4/MOV duration probe
    preload/
      preload.ts             contextBridge API (`window.api`); no Node in renderer
    renderer/
      App.tsx                view routing, global state (settings/stats/course),
                             import/export flows, sidebar/titlebar
      types.ts               shared renderer types + full `Api` interface
      utils.ts               progress/format/sort helpers, `courseTimeProgress`
      pages/
        Dashboard.tsx        continue watching, course grid, calendar, recent
        CourseView.tsx       course hero, sections, lecture rows, complete toggle
        Player.tsx           video player, coverage tracking, notes/moments/
                             resources/subtitles tabs, autoplay, completion
        Review.tsx           review-later queue
        Settings.tsx         appearance, playback, captions, storage, backup,
                             shortcuts, about
      components/            Modal, Sidebar, TitleBar, CourseCard, CommandPalette,
                             ProgressRing, ConsistencyCard, Toast
      hooks/                 useSectionExpansion
      styles/                base/layout/pages/dashboard/refine/responsive +
                             bundled player.css
```

`dist/renderer` is produced by Vite; `dist/main` and `dist/preload` by `tsc`.
`player.css` is a bundled/minified stylesheet. Add new player-related rules in
`styles/refine.css` instead of editing the minified file.

---

## 3. Commands

```bash
npm install          # also rebuilds better-sqlite3 for Electron
npm run dev          # tsc main/preload + Vite dev server + Electron (hot reload UI)
npm run build        # Vite renderer build + tsc main/preload
npm start            # launch the production build (dist)
npm run pack         # unpacked electron-builder output
npm run dist         # Windows NSIS installer in release/
npm run icons        # regenerate build/icon.ico and PNG sizes
```

For testing the production build with remote debugging:

```powershell
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
.\node_modules\.bin\electron.cmd . --remote-debugging-port=9222
```

`NODE_ENV=development` makes the main process load the Vite dev server; leave it
unset to load `dist/renderer/index.html`.

---

## 4. Runtime architecture

- **Main process** (`src/main/main.ts`) owns the database, filesystem, dialogs,
  window lifecycle, media probing and all IPC. It is the only place that touches
  `better-sqlite3` or Node APIs.
- **Preload** (`src/preload/preload.ts`) exposes a narrow, typed `window.api`
  through `contextBridge`. The renderer has `nodeIntegration: false` and
  `contextIsolation: true`.
- **Renderer** is a React SPA. `App.tsx` holds `settings`, `stats`, `courseData`,
  current `view`, and `dataVersion`; pages receive callbacks such as
  `onLecturePatch`, `onRefresh`, `onStatsRefresh`.
- Window is **frameless** with a custom draggable title bar. Fullscreen hides the
  title bar/sidebar and shows only the player.
- The app intentionally disables background throttling and keeps painting so
  Alt-Tab / occlusion does not produce a black video frame.

### IPC surface (names are stable)

Window: `window:minimize`, `window:toggleMaximize`, `window:close`,
`window:toggleFullscreen`, `window:state`.

App/dialogs: `dialog:selectFolder`, `app:versions`, `app:openDataFolder`,
`app:openPath`, `app:showInFolder`, `data:export`, `data:import`.

Courses: `course:import`, `course:list`, `course:get`, `course:scan`,
`course:delete`, `course:rename`, `course:relocate`.

Lectures/review: `lecture:search`, `lecture:listReview`, `lecture:setReview`,
`lecture:setDuration`.

Progress/activity: `progress:all`, `progress:get`, `progress:update`,
`progress:complete`, `activity:get`, `activity:addAppTime`.

Notes/bookmarks: `note:save|update|delete|list`,
`bookmark:add|delete|list`.

Settings/stats: `settings:get`, `settings:set`, `stats:get`.

Files/subtitles: `file:url`, `subtitle:listForVideo`, `subtitle:vtt`,
`subtitle:open`, `subtitle:add`.

`src/preload/preload.ts` and the `Api` interface in `src/renderer/types.ts` must
stay in sync. If you add a handler in main, add it to both.

---

## 5. Database

Location (Windows): `%APPDATA%\local-course-learning\learn.db`.
`main.ts` calls `app.setPath('userData', .../local-course-learning)` so dev and
installed builds share the same library. WAL mode and foreign keys are enabled.

Tables (`src/main/db.ts`):

- `courses(id, title, folder_path UNIQUE, created_at, last_watched, thumbnail_path)`
- `sections(id, course_id, title, order_index)`
- `lectures(id, course_id, section_id, title, file_path, duration, order_index,
  subtitle_paths, resources, needs_review)`
  - `subtitle_paths` / `resources` are JSON string arrays.
  - `duration` is seconds (INTEGER) from the header probe; the renderer fills it
    from the media element when unknown.
- `progress(lecture_id PK, position, duration, percent, watched, intervals,
  prior_intervals, prior_watched, completed, last_watched)`
  - `intervals` is a JSON array of `[start, end]` media-time ranges.
  - `watched` is the union length of `intervals`, capped at `duration`.
  - `prior_intervals` / `prior_watched` remember coverage before a manual
    completion so un-marking can restore real progress.
- `notes(id, course_id, lecture_id, timestamp, content, created_at)`
- `bookmarks(id, course_id, lecture_id, timestamp, description, created_at)`
- `settings(key PK, value)` — JSON-encoded values.
- `history(id, lecture_id, course_id, watched_at)` — one row per 5 minutes/lecture.
- `activity(day PK, seconds, app_seconds, updated_at)` — consistency calendar.

Migrations are additive and guarded by `PRAGMA table_info`. When adding a column,
follow that pattern; never drop or recreate user tables.

Default settings inserted on first run: `theme=minimal`, `autoplay=true`,
`completionThreshold=90`, `playbackRate=1`. `settings:get` also supplies caption
defaults (`captionSize=100`, `captionColor=#ffffff`, `captionBg=55`).

Current dev DB values at handoff: `theme=warm`, `autoplay=true`,
`completionThreshold=95`, `playbackRate=1`; caption settings are at their defaults
(`captionSize=100`, `captionColor=#ffffff`, `captionBg=55`).

---

## 6. Progress tracking — the core invariant

**The source of truth is a set of covered media-time intervals, not a counter.**
A lecture's `watched` is the length of the union of its intervals, capped at the
lecture duration. `percent = watched / duration * 100`, capped at 100.

This guarantees:

- Replaying an already-watched section never increases progress.
- Rewinding (10 min video, 1 min rewound) counts 9 minutes, not 10.
- Jumping to the end counts nothing by itself.
- Seeking forward during playback only adds the small amount actually played.
- Course-level watched time is the sum of lecture `watched` (completed lectures
  count their full duration), capped at total duration.
- No progress value can exceed 100% or the lecture duration.

### Renderer (`Player.tsx`)

Key refs:

- `intervalsRef: [number, number][]` — current coverage.
- `watchedRef: number` — cached union length.
- `lastTickRef: number` — previous media position for delta accumulation.
- `seekingRef` + `markSeeking()` / `clearSeeking()` — suppress counting across
  seeks. A delta larger than 0.5s while seeking, or larger than 30s otherwise, is
  ignored.
- `mediaLectureIdRef` — ignores media events left over from the previous lecture.
- `progressSeqRef` — ignores stale `progress:update` responses.
- `completedRef`, `autoCompletedRef` — completion state / one auto-complete per
  lecture session.

`accumulateWatched(video)` runs on `timeupdate`:

```
position = video.currentTime
delta = position - lastTick
maxDelta = seeking ? 0.5 : 30
if (!paused && delta > 0.05 && delta <= maxDelta) {
  intervals = merge(intervals + [lastTick, position])
  watched = unionLength(intervals)
}
lastTick = position
```

Coverage is therefore **media-time based**: at 2× speed, 1 real second covers 2
seconds of content.

`persistProgress()` runs on a 15-second position delta, on pause, on seek end, on
visibility change/beforeunload, and on unmount. It sends `position`, `duration`,
`watched`, `intervals`, `percent`, `completed`, and `clientTime`.

The player loads authoritative progress from `progress:get` after mount and merges
it with course data, so switching lectures quickly cannot overwrite newer data.
`onLecturePatch` keeps the in-memory course/playlist in sync optimistically.

### Main process (`main.ts`)

Helpers: `parseIntervals`, `mergeIntervals`, `intervalUnionLength`,
`trimIntervalsToLength`, `reconcileCoverage`. `reconcileCoverage` handles legacy
rows that have `watched` but no `intervals` by assuming the watched time started at
0 (`[0, watched]`).

`progress:update`:

1. Reads previous `watched`, `intervals`, `completed`, `last_watched`.
2. Merges stored + client intervals.
3. Target watched = `max(previousWatched, requestedWatched)` capped at duration.
4. Reconciles missing coverage (legacy) without ever shrinking stored coverage.
5. Computes percent from coverage.
6. Completes when previous completed, client says completed, or coverage ≥
   `completionThreshold`.
7. Adds activity only for a plausible live delta (`0.5s..300s`).
8. Rejects a stale in-flight auto-complete: if the row is currently un-completed,
   the incoming save would complete it, and `clientTime` is more than 1s older
   than `last_watched`, the save is ignored. This prevents a save started before
   an explicit un-mark from silently re-completing the lecture.

`progress:complete(lectureId, completed)`:

- **Complete:** stores `[0, duration]`, `percent=100`, `watched=duration`.
  On the first completion it saves the pre-completion `intervals`/`watched` into
  `prior_intervals`/`prior_watched`.
- **Un-complete:** restores `prior_intervals`/`prior_watched` if present, otherwise
  falls back to the current intervals. It then trims coverage to at most
  `completionThreshold - 1` percent and clears the prior columns. A never-watched
  lecture returns to `watched=0` / “Not started”; a partly watched lecture keeps
  its real coverage capped just below the threshold. This is what prevents the
  next `timeupdate` from instantly re-completing it.

When the completion threshold changes, `settings:set` calls
`normalizeProgressCoverage()` to reconcile every row (including legacy rows) with
the new threshold/duration.

### Display helpers (`utils.ts`)

- `isComplete(lecture)` = `progress.completed === 1`.
- `lecturePercent` returns 100 for completed, otherwise raw percent (no rounding).
- `lectureWatchedSeconds` caps at duration, or max(duration, watched) if complete.
- `courseTimeProgress(sections)` sums durations and watched seconds; percent is
  time-based, falling back to completed/lecture count only when no durations are
  known. This is used by dashboard, course view, and player.

---

## 7. Completion, un-marking and autoplay

- Auto-complete triggers when coverage reaches `completionThreshold`
  (`maybeAutoComplete`) or when playback ends with enough coverage (`handleEnded`).
  `autoCompletedRef` ensures it happens once per lecture session.
- `applyCompleted(next)` updates local state immediately, calls
  `progress:complete`, then reconciles the returned coverage. It bumps
  `progressSeqRef` so older in-flight saves cannot undo the explicit action.
- Marking complete shows confetti and (on manual completion) the completion modal.
- Un-marking must never leave the UI showing “Completed”. Verified in:
  - Player: button changes to “Mark complete”, Completed chip disappears, playlist
    row shows “94% watched” or “Not started”.
  - Course view: row loses `done`, shows percent/“Not started”.
  - Dashboard stats/course ring refresh via `onStatsRefresh`.
  - SQLite: `completed=0`, `percent<=threshold-1`, coverage trimmed/restored.
- Autoplay (`handleEnded` → countdown effect) advances exactly **one** lecture.
  `autoplayNavigatedRef` is reset only in `handleEnded`; the load effect must not
  reset it, otherwise the old `nextEntry` re-navigates and skips a lecture.
- `Shift+N` also moves to the next lecture.

---

## 8. Player details

- Video element is kept mounted while switching lectures; `mediaLectureIdRef`
  prevents cross-lecture event corruption.
- Resume: saved `position` is applied once (`resumeAppliedRef`), with a notice.
- Controls: play/pause, ±10s, mute/volume, speed menu, captions menu, PiP,
  fullscreen, seek bar, keyboard shortcuts (`?` overlay).
- Keyboard: Space/K play, arrows seek, J/L ±10s, Shift+arrows ±30s, M mute,
  F fullscreen, P PiP, C captions, B moment, N notes, Shift+N next, `[`/`]` speed.
- Tabs under video: Notes, Moments, Resources, Subtitles.
- Notes/moments capture the current media time; clicking a note/moment seeks.

### Subtitles / captions

- Scanner detects `.srt`, `.vtt`, `.ass`, `.ssa` next to a video and matches by
  basename.
- Playable formats: SRT and VTT. ASS/SSA are detected but flagged unsupported.
- The renderer calls `window.api.getSubtitleVtt(path)`. The **main process**
  `subtitle:vtt` handler:
  - returns `.vtt` contents unchanged;
  - parses `.srt` with `parseSync` and stringifies as WebVTT (`stringifySync`);
  - returns `null` on missing file/parse failure.
- The renderer creates a Blob URL (`text/vtt`) and renders
  `<track kind="subtitles" src=... default>`.
- Caption visibility is driven by `track.mode = captionsOn && trackUrl ? 'showing'
  : 'hidden'` in an effect after the track is mounted.
- The matched subtitle (or first playable one) is preselected on lecture load, so
  the captions toggle works immediately.
- “Add subtitle file” opens a file dialog, attaches the file via `subtitle:add`,
  reloads the list, selects it, and turns captions on. It exists both in the
  captions menu and the Subtitles tab.
- **Caption appearance is global and lives in Settings**, not the player:
  `captionSize` (70–160%), `captionColor` (hex), `captionBg` (0–90% opacity).
  The player injects `.video-frame video::cue { font-size; color; background }`
  from `settings`. Settings shows a live preview and persists via `settings:set`.

If subtitles do not appear, check in this order:

1. `dist/main/main.js` contains the `subtitle:vtt` handler (rebuild after changes).
2. `getSubtitleVtt(path)` returns a string (test via DevTools).
3. The `<track>` element exists and `video.textTracks[0].cues.length > 0`.
4. `track.mode === 'showing'` (toggle captions).
5. The file is SRT/VTT, not ASS/SSA.

---

## 9. Course scanning and media

`scanner.ts`:

- Video extensions: `.mp4`, `.mkv`, `.webm`, `.mov`, `.avi`.
- Subtitle extensions: `.srt`, `.vtt`, `.ass`, `.ssa`.
- Resource extensions: `.pdf`, `.txt`, `.md`, `.json`, `.js`, `.py`, `.html`,
  `.css`.
- Top-level videos go into a synthetic “Lectures” section; each subfolder with
  videos becomes a section. If neither exists, a deep recursive scan is used.
- Titles strip leading numbering (`01 - `, `01_`, etc.) and underscores.
- Natural sort order (`natural-compare`).
- `probeVideoDuration` reads `moov/mvhd` for MP4/MOV/M4V/M4A without external
  binaries. Other containers return null; the player fills duration on load and
  persists it via `lecture:setDuration`.

`course:scan` re-scans an existing course, adds new lectures, and updates
durations/subtitles/resources without deleting progress.

---

## 10. Backup / import

- Export (`data:export`) writes one JSON file: `format: "courseflow-backup"`,
  `version: 1`, `database` (all allow-listed tables), `preferences`
  (`courseflow.*` localStorage keys), and metadata.
- `BACKUP_TABLES` in `main.ts` is the import schema/column allow-list. Add new
  columns there if they must survive a backup. Missing fields import as null
  (`app_seconds` defaults to 0).
- Import snapshots the live DB to `learn-pre-import-<time>.db` (keeps the 3 newest),
  validates the payload, deletes/reinserts tables inside a transaction, then asks
  the renderer to locate any missing course folders and rewrites path prefixes.
- Video files are never copied or deleted.

---

## 11. Settings and themes

Settings are stored as JSON in `settings(key, value)` and loaded by
`settings:get`. The renderer merges them over `DEFAULT_SETTINGS` in `App.tsx`.

Keys:

- `theme`: `minimal | light | dark | warm | system`.
- `themeChosen`: marks that the user picked a theme (prevents the one-time
  migration from overwriting it).
- `autoplay`: boolean.
- `completionThreshold`: 50–100 (default 90; current DB 95).
- `playbackRate`: default speed.
- `captionSize`, `captionColor`, `captionBg`: caption appearance.

`onChange` in `App.tsx` updates local state optimistically and calls
`window.api.setSetting(key, value)`.

Themes are CSS variables on the root; `system` follows `nativeTheme`/OS.

---

## 12. Verification and debugging

### SQLite

`better-sqlite3` is compiled for Electron, so inspect the DB with Python:

```python
import sqlite3, os
p = os.path.join(os.environ['APPDATA'], 'local-course-learning', 'learn.db')
c = sqlite3.connect(p)
for row in c.execute("SELECT key, value FROM settings"):
    print(row)
```

Useful checks:

```sql
SELECT COUNT(*) FROM progress WHERE watched > duration + 0.01;   -- must be 0
SELECT COUNT(*) FROM progress WHERE percent > 100.01;            -- must be 0
SELECT lecture_id, completed, percent, watched, intervals,
       prior_intervals, prior_watched
FROM progress WHERE lecture_id = ?;
```

### Remote debugging (production build)

Start Electron with `--remote-debugging-port=9222`, then evaluate JS against the
page. A helper used during development lives at
`C:\Users\LENOVO\AppData\Local\Temp\opencode\cdp.mjs`:

```bash
node cdp.mjs "document.querySelector('.page-title')?.innerText"
```

Useful expressions:

```js
// caption state
const v = document.querySelector('video');
const t = v.textTracks[0];
({ mode: t.mode, cues: t.cues.length, active: [...t.activeCues].map(c => c.text) })
```

```js
// completion UI
[...document.querySelectorAll('.player-headline-actions button')]
  .find(b => /complete/i.test(b.innerText))?.innerText
```

### Manual regression checklist

1. Play 4s, rewind 2s, replay: `watched` stays ~4s (no inflation).
2. Seek to the end, play 2s: not complete; watched only grows by ~2s.
3. Reload lecture: resumes at saved position and preserves coverage.
4. Switch lecture while playing: new lecture starts at 0, no cross-contamination.
5. Mark complete → unmark: player/course/dashboard no longer say Completed; DB
   `completed=0`; a never-watched lecture returns to “Not started”.
6. Let a lecture end with autoplay on: exactly the next lecture opens (no skip).
7. Toggle captions: `textTracks[0].mode === 'showing'` and cues render.
8. Change caption size/color in Settings: player `::cue` style updates.
9. Change completion threshold: no row ends above 100%; completed rows stay valid.

---

## 13. Invariants and gotchas

- **Never derive progress from `video.currentTime` alone.** Use interval coverage.
- **Never increase `watched` without increasing covered intervals.** `watched` is
  the union length, not a counter.
- **Never let a save restore coverage that was intentionally trimmed by un-mark.**
  The `clientTime`/`last_watched` guard and `prior_*` columns exist for this.
- **Do not reset `autoplayNavigatedRef` in the lecture-load effect.** Only reset it
  in `handleEnded`; otherwise autoplay skips a lecture.
- **Do not assign `completedRef.current` during render.** Keep refs in effects and
  event handlers.
- **Keep `mediaLectureIdRef` checks** on media events; the video element is reused.
- **Rebuild the main process after IPC changes** (`npm run build`), not just the
  renderer. `dist/main/main.js` is what Electron runs.
- **Do not edit `dist/` by hand** or the minified `player.css`; edit `src` and
  rebuild.
- **Migrations must be additive and idempotent.** Existing libraries must keep
  working.
- **`settings:get` supplies defaults**; new settings should be added there and to
  `DEFAULT_SETTINGS` in `App.tsx` and `Settings` in `types.ts`.
- **Preload and renderer types must match the main handlers.**
- **ASS/SSA subtitles are not supported**; only SRT/VTT play.
- **Course time percent falls back to lecture count** only when durations are
  unknown. Do not switch to count-based progress for normal courses.
- **Completed lectures contribute their full duration** to course watched time,
  even if stored intervals are partial.
- The app shares one userData folder between dev and installed builds. Do not
  change `app.setPath('userData', ...)` casually; it would make libraries appear
  empty.
- `progress:update` ignores activity deltas outside `0.5..300s` to avoid calendar
  inflation from stale clients.
- `history` is throttled to one row per lecture per 5 minutes.

---

## 14. Current status / recent changes

Implemented and verified in the production build:

- Interval-based coverage tracking with DB persistence and legacy reconciliation.
- Seek suppression, rewind protection, duration caps, course-level coverage.
- Stale-save rejection after un-mark; explicit un-mark trimming.
- Prior-coverage restoration so un-marking a manually completed, never-watched
  lecture returns to “Not started” (verified: `completed=0`, `watched=0`,
  `intervals=[]`).
- Autoplay advances exactly one lecture (verified from “Course Structure and
  Projects” to “Watch Before You Start!”).
- Mark complete/unmark verified in player and course view; no stale re-completion
  after 5s.
- Subtitles fixed by adding the missing `subtitle:vtt` IPC handler. VTT passthrough
  and SRT→WebVTT conversion verified. Cues load (`96` cues) and render with
  `track.mode='showing'`.
- Caption appearance moved to Settings (size/color/opacity + live preview);
  player keeps only on/off and add-subtitle-file. Verified settings persist to the
  DB and the player’s `::cue` style updates.
- No save loop while paused; fresh lectures load without a blank screen.

Known limitations / follow-ups:

- ASS/SSA conversion is not implemented.
- Caption appearance preview is approximate (CSS `::cue` support varies slightly
  by platform).
- Autoplay and subtitles were tested against VTT files; SRT conversion was tested
  through the IPC handler, not through a full playback session.
- The project has no automated test suite; verification is manual + CDP/SQLite.
- Not a git repo — no commit history or branches.

---

## 15. Instructions for an AI assistant

When asked to change this project:

1. **Read this document first**, then the specific files involved.
2. For progress/completion work, read `Player.tsx` (coverage, persistence,
   completion), `main.ts` (`progress:update`, `progress:complete`,
   `normalizeProgressCoverage`), `utils.ts` (`courseTimeProgress`), and `db.ts`
   (schema/migrations) together. They form one system.
3. Preserve the invariants in §13. If a change seems to require breaking one,
   explain the tradeoff and update this document.
4. Match the existing style: TypeScript strict-ish, functional React components,
   hooks, CSS classes in `styles/*.css`, lucide-react icons, concise comments that
   explain *why* a non-obvious guard exists.
5. Add new IPC handlers in `main.ts`, expose them in `preload.ts`, and type them
   in `types.ts`.
6. Add schema changes as guarded `ALTER TABLE` migrations in `db.ts`; update
   `BACKUP_TABLES` if the data must survive export/import.
7. After any main/preload change, run `npm run build` and restart Electron before
   testing. The renderer alone can be hot-reloaded in dev, but the production test
   path uses `dist`.
8. Verify with the checklist in §12 and, when possible, inspect SQLite directly.
9. Keep the app offline and local-first: no telemetry, no cloud calls, no external
   binaries required at runtime.
10. When asked for a feature that affects progress, subtitles, or completion,
    test the failure mode that motivated this document (rewind inflation,
    seek-to-end completion, stale un-mark, missing subtitle handler, autoplay
    double-navigation).
