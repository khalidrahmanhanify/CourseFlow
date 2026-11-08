import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { parseSync, stringifySync } from 'subtitle';
import { initDb, getDb } from './db';
import { scanCourseFolder, listSubtitlesForVideo } from './scanner';
import { probeVideoDuration } from './media';
import { v4 as uuidv4 } from 'uuid';

// Keep one library folder for both `electron .` and the packaged CourseFlow
// app. Without this, changing the installer product name would move userData
// and make the existing database look empty.
app.setPath('userData', path.join(app.getPath('appData'), 'local-course-learning'));
app.setAppUserModelId('com.opencourse.local');

// Windows can mark a window as "occluded" when it is covered or when the user
// Alt-Tabs away. Chromium then stops painting the video surface, so coming back
// shows a black frame until the next repaint. CourseFlow is a single-window
// media app: always keep painting and never background-throttle the renderer.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

let mainWindow: BrowserWindow | null = null;
let wasFullscreenBeforeHtml = false;
let htmlFullscreen = false;
let intendedMaximized = false;
let intendedFullscreen = false;
let windowStateTimer: NodeJS.Timeout | null = null;

Menu.setApplicationMenu(null);

const windowState = () => ({
  maximized: mainWindow?.isMaximized() ?? false,
  fullscreen: mainWindow?.isFullScreen() ?? false
});

function emitWindowState() {
  mainWindow?.webContents.send('window:state', windowState());
}

// Windows reports maximize/fullscreen transitions asynchronously. Debounce a
// resync so rapid clicks and native title-bar gestures always converge on the
// real window state instead of leaving the custom chrome out of sync.
function scheduleWindowStateSync() {
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    windowStateTimer = null;
    if (!mainWindow) return;
    intendedMaximized = mainWindow.isMaximized();
    intendedFullscreen = mainWindow.isFullScreen();
    emitWindowState();
  }, 90);
}

function windowBackground() {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = 'theme'").get() as any;
    const theme = row ? JSON.parse(row.value) : 'minimal';
    const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
    return dark ? '#07090d' : '#f6f7f9';
  } catch {
    return '#f6f7f9';
  }
}

function createWindow() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '../../build/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: windowBackground(),
    show: false,
    paintWhenInitiallyHidden: true,
    title: 'CourseFlow',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // allow loading local video/resource files
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('maximize', scheduleWindowStateSync);
  mainWindow.on('unmaximize', scheduleWindowStateSync);
  mainWindow.on('enter-full-screen', scheduleWindowStateSync);
  mainWindow.on('leave-full-screen', scheduleWindowStateSync);
  mainWindow.on('restore', scheduleWindowStateSync);
  mainWindow.on('resize', scheduleWindowStateSync);
  mainWindow.on('focus', scheduleWindowStateSync);

  // Make HTML/video fullscreen actually fill the screen, hiding all app chrome.
  mainWindow.webContents.on('enter-html-full-screen', () => {
    if (!mainWindow) return;
    htmlFullscreen = true;
    wasFullscreenBeforeHtml = mainWindow.isFullScreen();
    if (!mainWindow.isFullScreen()) {
      intendedFullscreen = true;
      mainWindow.setFullScreen(true);
    }
    scheduleWindowStateSync();
  });

  mainWindow.webContents.on('leave-html-full-screen', () => {
    if (!mainWindow) return;
    htmlFullscreen = false;
    if (!wasFullscreenBeforeHtml && mainWindow.isFullScreen()) {
      intendedFullscreen = false;
      mainWindow.setFullScreen(false);
    }
    scheduleWindowStateSync();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initDb();
  backfillLectureDurations();
  normalizeProgressCoverage();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// Window controls (frameless window)
// ---------------------------------------------------------------------------
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow) return false;
  // Use the intended state rather than the live one: Windows updates
  // isMaximized() asynchronously, so reading it twice in a row during a fast
  // click could apply the same direction twice.
  intendedMaximized = !intendedMaximized;
  if (intendedMaximized) mainWindow.maximize();
  else mainWindow.unmaximize();
  scheduleWindowStateSync();
  return intendedMaximized;
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:toggleFullscreen', () => {
  if (!mainWindow) return false;
  if (htmlFullscreen) {
    // Never stack window fullscreen on top of video fullscreen.
    return true;
  }
  intendedFullscreen = !intendedFullscreen;
  mainWindow.setFullScreen(intendedFullscreen);
  scheduleWindowStateSync();
  return intendedFullscreen;
});

ipcMain.handle('window:state', () => windowState());

// ---------------------------------------------------------------------------
// Dialogs / app info
// ---------------------------------------------------------------------------
ipcMain.handle('dialog:selectFolder', async (_, title?: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Select a course folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('app:versions', () => ({
  app: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome
}));

ipcMain.handle('app:openDataFolder', async () => {
  return shell.openPath(app.getPath('userData'));
});

ipcMain.handle('app:openPath', async (_, filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const error = await shell.openPath(filePath);
  return error === '';
});

ipcMain.handle('app:showInFolder', async (_, filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) return false;
  shell.showItemInFolder(filePath);
  return true;
});

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------
ipcMain.handle('course:import', async (_, folderPath: string) => {
  const db = getDb();

  if (!folderPath || !fs.existsSync(folderPath)) {
    return { success: false, error: 'Folder not found' };
  }

  const existing = db.prepare('SELECT id FROM courses WHERE folder_path = ?').get(folderPath) as any;
  if (existing) {
    return { success: true, courseId: existing.id, alreadyImported: true };
  }

  const scanned = scanCourseFolder(folderPath);
  if (scanned.sections.length === 0) {
    return { success: false, error: 'No video files found in this folder' };
  }

  const courseId = uuidv4();
  const now = Date.now();

  const importCourse = db.transaction(() => {
    db.prepare('INSERT INTO courses (id, title, folder_path, created_at) VALUES (?, ?, ?, ?)')
      .run(courseId, scanned.courseTitle, folderPath, now);

    for (const section of scanned.sections) {
      db.prepare('INSERT INTO sections (id, course_id, title, order_index) VALUES (?, ?, ?, ?)')
        .run(section.id, courseId, section.title, section.order_index);

      for (const lecture of section.lectures) {
        db.prepare('INSERT INTO lectures (id, course_id, section_id, title, file_path, duration, order_index, subtitle_paths, resources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(lecture.id, courseId, section.id, lecture.title, lecture.file_path, lecture.duration ?? null, lecture.order_index, lecture.subtitle_paths, lecture.resources);
        db.prepare('INSERT OR IGNORE INTO progress (lecture_id) VALUES (?)').run(lecture.id);
      }
    }
  });

  importCourse();
  return { success: true, courseId };
});

// ---------------------------------------------------------------------------
// Time accounting
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function localDayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Record real time on the day it happened. Video playback and app time are
 * stored in separate columns so the dashboard can show both. Seeking, buffering
 * and manually completing a lecture add nothing here.
 */
function addActivity(seconds: number, kind: 'video' | 'app' = 'video', timestamp = Date.now()) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return;
  const column = kind === 'app' ? 'app_seconds' : 'seconds';
  getDb().prepare(`
    INSERT INTO activity (day, seconds, app_seconds, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET
      ${column} = activity.${column} + excluded.${column},
      updated_at = excluded.updated_at
  `).run(
    localDayKey(timestamp),
    kind === 'app' ? 0 : value,
    kind === 'app' ? value : 0,
    timestamp
  );
}

/**
 * Course progress is time based: watched seconds over total course seconds.
 * Counting lectures would make a course of ten 2-minute clips look finished
 * next to a single 3-hour masterclass. Completed lectures always contribute
 * their full duration so a manually completed lecture counts as watched.
 */
function getCourseTimeStats(db: any, courseId: string) {
  const row = db.prepare(`
    SELECT COUNT(l.id) AS total,
           COALESCE(SUM(CASE WHEN p.completed = 1 THEN 1 ELSE 0 END), 0) AS completed,
           COALESCE(SUM(COALESCE(NULLIF(l.duration, 0), p.duration, 0)), 0) AS total_duration,
           COALESCE(SUM(
             CASE WHEN p.completed = 1
               THEN COALESCE(NULLIF(l.duration, 0), p.duration, 0)
               ELSE COALESCE(p.watched, 0)
             END
           ), 0) AS watched
    FROM lectures l
    LEFT JOIN progress p ON p.lecture_id = l.id
    WHERE l.course_id = ?
  `).get(courseId) as any;

  const totalLectures = Number(row?.total) || 0;
  const completed = Number(row?.completed) || 0;
  const totalDuration = Math.max(0, Number(row?.total_duration) || 0);
  const watchedDuration = totalDuration > 0
    ? Math.min(totalDuration, Math.max(0, Number(row?.watched) || 0))
    : Math.max(0, Number(row?.watched) || 0);
  const percent = totalDuration > 0
    ? Math.max(0, Math.min(100, (watchedDuration / totalDuration) * 100))
    : totalLectures > 0 ? (completed / totalLectures) * 100 : 0;

  return { totalLectures, completed, totalDuration, watchedDuration, percent };
}

/**
 * Older libraries have no lecture durations yet. MP4 headers are cheap to
 * read, so fill missing rows once at startup before the first course list is
 * rendered. Subsequent launches do no work.
 */
function backfillLectureDurations() {
  const db = getDb();
  const rows = db.prepare('SELECT id, file_path FROM lectures WHERE duration IS NULL OR duration <= 0').all() as any[];
  if (rows.length === 0) return;

  const updateLecture = db.prepare('UPDATE lectures SET duration = ? WHERE id = ?');
  const updateProgress = db.prepare('UPDATE progress SET duration = ? WHERE lecture_id = ? AND (duration IS NULL OR duration <= 0)');
  const run = db.transaction(() => {
    for (const row of rows) {
      const duration = probeVideoDuration(row.file_path);
      if (!duration) continue;
      updateLecture.run(duration, row.id);
      updateProgress.run(duration, row.id);
    }
  });
  run();
}

ipcMain.handle('course:list', async () => {
  const db = getDb();
  const courses = db.prepare(`
    SELECT c.*, (SELECT MAX(watched_at) FROM history WHERE course_id = c.id) AS last_activity
    FROM courses c
    ORDER BY COALESCE(last_activity, c.created_at) DESC
  `).all() as any[];

  return courses.map((c) => {
    const review = (db.prepare('SELECT COUNT(*) AS cnt FROM lectures WHERE course_id = ? AND needs_review = 1').get(c.id) as any).cnt;
    const time = getCourseTimeStats(db, c.id);

    return {
      ...c,
      lecture_count: time.totalLectures,
      completed_count: time.completed,
      review_count: review,
      progress: time.percent,
      total_duration: time.totalDuration,
      watched_duration: time.watchedDuration,
      last_watched: c.last_activity || c.last_watched
    };
  });
});

ipcMain.handle('course:get', async (_, id: string) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as any;
  if (!course) return null;

  const sections = db.prepare('SELECT * FROM sections WHERE course_id = ? ORDER BY order_index').all(id) as any[];
  const result: any = { course, sections: [] };

  for (const section of sections) {
    const lectures = db.prepare('SELECT * FROM lectures WHERE section_id = ? ORDER BY order_index').all(section.id) as any[];
    const lecturesWithProgress = lectures.map((lecture) => {
      const progress = db.prepare('SELECT * FROM progress WHERE lecture_id = ?').get(lecture.id);
      return { ...lecture, progress: progress || {} };
    });
    result.sections.push({ ...section, lectures: lecturesWithProgress });
  }

  return result;
});

ipcMain.handle('course:scan', async (_, id: string) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as any;
  if (!course) return { success: false, error: 'Course not found' };

  const scanned = scanCourseFolder(course.folder_path);
  let added = 0;

  const rescan = db.transaction(() => {
    for (const section of scanned.sections) {
      let sectionRow = db.prepare('SELECT id FROM sections WHERE course_id = ? AND title = ?').get(course.id, section.title) as any;
      if (!sectionRow) {
        const sectionId = uuidv4();
        db.prepare('INSERT INTO sections (id, course_id, title, order_index) VALUES (?, ?, ?, ?)')
          .run(sectionId, course.id, section.title, section.order_index);
        sectionRow = { id: sectionId };
      }

      for (const lecture of section.lectures) {
        const exists = db.prepare('SELECT id FROM lectures WHERE file_path = ?').get(lecture.file_path);
        if (!exists) {
          db.prepare('INSERT INTO lectures (id, course_id, section_id, title, file_path, duration, order_index, subtitle_paths, resources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(lecture.id, course.id, sectionRow.id, lecture.title, lecture.file_path, lecture.duration ?? null, lecture.order_index, lecture.subtitle_paths, lecture.resources);
          db.prepare('INSERT OR IGNORE INTO progress (lecture_id) VALUES (?)').run(lecture.id);
          added += 1;
        } else if (lecture.duration) {
          db.prepare('UPDATE lectures SET duration = ? WHERE id = ? AND (duration IS NULL OR duration <= 0)')
            .run(lecture.duration, (exists as any).id);
        }
      }
    }
  });

  rescan();
  return { success: true, added };
});

ipcMain.handle('course:delete', async (_, id: string) => {
  const db = getDb();
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM notes WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM bookmarks WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM history WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM progress WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = ?)').run(id);
    db.prepare('DELETE FROM lectures WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM sections WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  });
  remove();
  return { success: true };
});

ipcMain.handle('course:rename', async (_, id: string, title: string) => {
  const db = getDb();
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return { success: false, error: 'Course name cannot be empty' };
  if (clean.length > 120) return { success: false, error: 'Course name is too long (120 characters max)' };

  const existing = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!existing) return { success: false, error: 'Course not found' };

  // Only the in-app title changes; folder_path (and the files on disk) stay as-is.
  db.prepare('UPDATE courses SET title = ? WHERE id = ?').run(clean, id);
  return { success: true, title: clean };
});

// ---------------------------------------------------------------------------
// Lectures, progress, review flags
// ---------------------------------------------------------------------------
function lectureWithContextQuery() {
  return `
    SELECT l.*,
           c.title AS course_title,
           s.title AS section_title,
           COALESCE(p.completed, 0) AS completed,
           COALESCE(p.percent, 0) AS percent,
           p.position,
           COALESCE(NULLIF(l.duration, 0), p.duration, 0) AS duration,
           COALESCE(p.watched, 0) AS watched,
           p.last_watched
    FROM lectures l
    JOIN courses c ON c.id = l.course_id
    LEFT JOIN sections s ON s.id = l.section_id
    LEFT JOIN progress p ON p.lecture_id = l.id
  `;
}

ipcMain.handle('lecture:search', async (_, query: string) => {
  const db = getDb();
  const q = (query || '').trim();
  if (!q) return [];
  const like = `%${q}%`;
  const startsWith = `${q}%`;
  return db.prepare(`
    ${lectureWithContextQuery()}
    WHERE l.title LIKE ? OR c.title LIKE ? OR COALESCE(s.title, '') LIKE ?
    ORDER BY
      CASE
        WHEN l.title LIKE ? THEN 0
        WHEN l.title LIKE ? THEN 1
        WHEN c.title LIKE ? THEN 2
        ELSE 3
      END,
      c.title COLLATE NOCASE ASC,
      s.order_index ASC,
      l.order_index ASC
    LIMIT 40
  `).all(like, like, like, startsWith, like, like);
});

ipcMain.handle('lecture:listReview', async () => {
  const db = getDb();
  return db.prepare(`
    ${lectureWithContextQuery()}
    WHERE l.needs_review = 1
    ORDER BY c.title COLLATE NOCASE ASC, s.order_index ASC, l.order_index ASC
  `).all();
});

ipcMain.handle('lecture:setReview', async (_, lectureId: string, needsReview: boolean) => {
  const db = getDb();
  db.prepare('UPDATE lectures SET needs_review = ? WHERE id = ?').run(needsReview ? 1 : 0, lectureId);
  return { success: true, needs_review: needsReview ? 1 : 0 };
});

type CoverageInterval = [number, number];

function parseIntervals(value: any): CoverageInterval[] {
  if (Array.isArray(value)) return value as CoverageInterval[];
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeIntervals(intervals: any[], cap = Infinity): CoverageInterval[] {
  const cleaned = intervals
    .map((item) => {
      if (!Array.isArray(item) || item.length < 2) return null;
      const start = Number(item[0]);
      const end = Number(item[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const lo = Math.max(0, Math.min(start, end));
      const hi = Math.min(cap, Math.max(0, Math.max(start, end)));
      if (hi <= lo) return null;
      return [lo, hi] as CoverageInterval;
    })
    .filter(Boolean) as CoverageInterval[];
  cleaned.sort((a, b) => a[0] - b[0]);
  const merged: CoverageInterval[] = [];
  for (const [start, end] of cleaned) {
    const last = merged[merged.length - 1];
    // A small tolerance keeps consecutive timeupdate ticks from fragmenting a
    // continuous playback range into hundreds of tiny intervals.
    if (last && start <= last[1] + 0.5) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

function intervalUnionLength(intervals: any[], cap = Infinity) {
  const merged = mergeIntervals(intervals, cap);
  let total = 0;
  for (const [start, end] of merged) {
    total += Math.max(0, Math.min(end, cap) - Math.max(start, 0));
  }
  return total;
}

function trimIntervalsToLength(intervals: any[], maxLength: number, cap = Infinity): CoverageInterval[] {
  const merged = mergeIntervals(intervals, cap);
  const limit = Math.max(0, Math.min(maxLength, cap));
  const trimmed: CoverageInterval[] = [];
  let remaining = limit;
  for (const [start, end] of merged) {
    if (remaining <= 0) break;
    const length = end - start;
    if (length <= remaining + 1e-6) {
      trimmed.push([start, end]);
      remaining -= length;
    } else {
      trimmed.push([start, start + remaining]);
      remaining = 0;
    }
  }
  return trimmed;
}

/**
 * Coverage ranges are the source of truth for how much of a video was really
 * watched. Older databases stored a `watched` number without ranges; only then
 * assume the missing time was covered from the beginning so the number and the
 * ranges agree. When ranges exist they always win, which stops a bogus watched
 * number from fabricating coverage (and inflating the video-watched total).
 */
function reconcileCoverage(watched: number, intervals: any[], cap = Infinity) {
  let merged = mergeIntervals(intervals, cap);
  let covered = intervalUnionLength(merged, cap);
  if (merged.length === 0) {
    const target = Number.isFinite(cap)
      ? Math.min(cap, Math.max(0, watched))
      : Math.max(0, watched);
    if (target > 0) {
      merged = mergeIntervals([[0, target]], cap);
      covered = intervalUnionLength(merged, cap);
    }
  }
  return { intervals: merged, watched: covered };
}

function getCompletionThreshold(db: any = getDb()) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'completionThreshold'").get() as any;
    const parsed = row ? JSON.parse(row.value) : 90;
    const value = Number(parsed);
    if (Number.isFinite(value)) return Math.min(100, Math.max(1, value));
  } catch {
    // fall through to the default
  }
  return 90;
}

// Older builds derived "watched %" from the furthest seek position, which made
// a single jump to the end look like a finished lecture. Rows written before
// range tracking have no trustworthy coverage data, so reconcile every row so
// `watched` always matches the union of its stored ranges. Completion is a flag
// only: it must never expand or trim the real coverage.
function normalizeProgressCoverage() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.lecture_id, p.position, p.duration, p.percent, p.watched, p.intervals, p.completed,
           l.duration AS lecture_duration
    FROM progress p
    LEFT JOIN lectures l ON l.id = p.lecture_id
  `).all() as any[];
  if (rows.length === 0) return;

  const update = db.prepare(`
    UPDATE progress SET position = ?, duration = ?, watched = ?, percent = ?, intervals = ?, completed = ?
    WHERE lecture_id = ?
  `);

  const run = db.transaction(() => {
    for (const row of rows) {
      // Progress rows created by an early "mark complete" may not have a
      // duration yet even though the lecture itself does.
      const duration = Math.max(0, Number(row.duration) || Number(row.lecture_duration) || 0);
      const completed = Number(row.completed) === 1;
      const position = Math.max(0, Number(row.position) || 0);
      const stored = parseIntervals(row.intervals);
      const merged = mergeIntervals(stored, duration || Infinity);
      const covered = intervalUnionLength(merged, duration || Infinity);

      if (covered > 0) {
        // Ranges are authoritative, even for completed lectures. A completed
        // lecture that was really watched 96% keeps 96% of coverage.
        const watched = duration > 0 ? Math.min(duration, covered) : covered;
        const percent = duration > 0
          ? Math.max(0, Math.min(100, (watched / duration) * 100))
          : Math.max(0, Math.min(100, Number(row.percent) || 0));
        update.run(position, duration, watched, percent, JSON.stringify(merged), completed ? 1 : 0, row.lecture_id);
        continue;
      }

      if (completed) {
        // Legacy completed row from a build that never stored ranges. It was
        // finished, so give it full coverage once; otherwise un-marking would
        // claim the lecture was never watched.
        const watched = duration;
        const percent = duration > 0 ? 100 : Math.max(0, Math.min(100, Number(row.percent) || 0));
        const intervals = duration > 0 ? [[0, duration]] : [];
        update.run(position, duration, watched, percent, JSON.stringify(intervals), 1, row.lecture_id);
      } else if ((Number(row.watched) || 0) > 0 || (Number(row.percent) || 0) > 0) {
        // Legacy seek-based progress without ranges cannot be trusted.
        update.run(0, duration, 0, 0, JSON.stringify([]), 0, row.lecture_id);
      } else if (duration > 0 && !(Number(row.duration) > 0)) {
        // Backfill the duration so later saves have a stable baseline.
        update.run(position, duration, 0, 0, JSON.stringify([]), 0, row.lecture_id);
      }
    }
  });
  run();
}

ipcMain.handle('progress:update', async (_, lectureId: string, data: any) => {
  const db = getDb();
  const now = Date.now();
  const threshold = getCompletionThreshold(db);
  const position = Math.max(0, Number(data.position) || 0);
  const duration = Math.max(0, Number(data.duration) || 0);
  const previous = db.prepare(
    'SELECT position, watched, completed, auto_complete_blocked, last_watched, intervals FROM progress WHERE lecture_id = ?'
  ).get(lectureId) as any;
  const previousWatched = Math.max(0, Number(previous?.watched) || 0);
  const blocked = Number(previous?.auto_complete_blocked) === 1;
  const clientTime = Number(data.clientTime) || 0;

  // A save that started before a newer state was written must never win. This
  // is what keeps an in-flight save from undoing an explicit un-mark.
  if (clientTime > 0 && clientTime < Number(previous?.last_watched) - 1000) {
    return { success: true, progress: db.prepare('SELECT * FROM progress WHERE lecture_id = ?').get(lectureId) };
  }

  let watched = duration > 0 ? Math.min(duration, position) : Math.max(0, position);
  const percent = duration > 0 ? Math.min(100, Math.max(0, (watched / duration) * 100)) : Math.max(0, Math.min(100, Number(data.percent) || 0));
  const wouldComplete = !blocked && (
    Number(previous?.completed) === 1 || Boolean(data.completed) || percent >= threshold
  );
  const completed = wouldComplete ? 1 : 0;
  if (completed) {
    watched = duration > 0 ? duration : watched;
  }
  const finalPercent = completed ? 100 : percent;
  const blockedValue = completed ? 0 : (blocked ? 1 : 0);

  const watchedDelta = Math.max(0, watched - previousWatched);

  db.prepare(`
    INSERT INTO progress (lecture_id, position, duration, percent, watched, completed, auto_complete_blocked, last_watched, intervals)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lecture_id) DO UPDATE SET
      position = excluded.position,
      duration = excluded.duration,
      percent = excluded.percent,
      watched = excluded.watched,
      completed = excluded.completed,
      auto_complete_blocked = excluded.auto_complete_blocked,
      last_watched = excluded.last_watched,
      intervals = excluded.intervals
  `).run(
    lectureId,
    position,
    duration,
    finalPercent,
    watched,
    completed,
    blockedValue,
    now,
    JSON.stringify([])
  );

  // Keep the lecture's own duration current as well. It is used for
  // time-based course progress even before the player has opened a lecture.
  if (duration > 0) {
    db.prepare('UPDATE lectures SET duration = ? WHERE id = ? AND (duration IS NULL OR duration <= 0)')
      .run(duration, lectureId);
  }

  // Live playback is the only thing that counts as study activity. A delta
  // larger than five minutes can only come from a stale/reset client, so it is
  // ignored rather than inflating the calendar.
  if (watchedDelta >= 0.5 && watchedDelta <= 300) {
    addActivity(watchedDelta, 'video', now);
  }

  const lecture = db.prepare('SELECT course_id FROM lectures WHERE id = ?').get(lectureId) as any;
  if (lecture) {
    db.prepare('UPDATE courses SET last_watched = ? WHERE id = ?').run(now, lecture.course_id);

    // Only keep one history entry every five minutes per lecture.
    const last = db.prepare('SELECT watched_at FROM history WHERE lecture_id = ? ORDER BY watched_at DESC LIMIT 1').get(lectureId) as any;
    if (!last || now - last.watched_at > 5 * 60 * 1000) {
      db.prepare('INSERT INTO history (lecture_id, course_id, watched_at) VALUES (?, ?, ?)').run(lectureId, lecture.course_id, now);
    }
  }

  return {
    success: true,
    progress: {
      position: Number(data.position) || 0,
      duration,
      percent: finalPercent,
      watched,
      intervals: JSON.stringify([]),
      completed,
      auto_complete_blocked: blockedValue,
      last_watched: now
    }
  };
});

ipcMain.handle('progress:get', async (_, lectureId: string) => {
  return getDb().prepare('SELECT * FROM progress WHERE lecture_id = ?').get(lectureId) ?? null;
});

ipcMain.handle('progress:complete', async (_, lectureId: string, completed: boolean) => {
  const db = getDb();
  const now = Date.now();
  const lectureRow = db.prepare('SELECT duration FROM lectures WHERE id = ?').get(lectureId) as any;
  const existing = db.prepare(`
    SELECT position, duration, percent, watched, completed, auto_complete_blocked, intervals
    FROM progress WHERE lecture_id = ?
  `).get(lectureId) as any;
  const duration = Math.max(0, Number(existing?.duration) || Number(lectureRow?.duration) || 0);
  const threshold = getCompletionThreshold(db);

  if (completed) {
    const watched = duration > 0 ? duration : Math.max(0, Number(existing?.watched) || 0);
    const percent = 100;
    db.prepare(`
      INSERT INTO progress (lecture_id, position, duration, completed, percent, watched, auto_complete_blocked, last_watched, intervals)
      VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?)
      ON CONFLICT(lecture_id) DO UPDATE SET
        duration = excluded.duration,
        completed = 1,
        percent = excluded.percent,
        watched = excluded.watched,
        auto_complete_blocked = 0,
        last_watched = excluded.last_watched,
        intervals = excluded.intervals
    `).run(
      lectureId,
      Math.max(0, Number(existing?.position) || 0),
      duration,
      percent,
      watched,
      now,
      JSON.stringify([])
    );
  } else {
    const position = Math.max(0, Number(existing?.position) || 0);
    let percentFromPos = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;
    if (percentFromPos >= threshold) {
      percentFromPos = Math.max(0, threshold - 1);
    }
    const watchedRestored = duration > 0 ? Math.min(duration, (percentFromPos / 100) * duration) : 0;
    db.prepare(`
      INSERT INTO progress (lecture_id, position, duration, completed, percent, watched, auto_complete_blocked, last_watched, intervals)
      VALUES (?, ?, ?, 0, ?, ?, 1, ?, ?)
      ON CONFLICT(lecture_id) DO UPDATE SET
        duration = excluded.duration,
        completed = 0,
        percent = excluded.percent,
        watched = excluded.watched,
        auto_complete_blocked = 1,
        last_watched = excluded.last_watched,
        intervals = excluded.intervals
    `).run(
      lectureId,
      position,
      duration,
      percentFromPos,
      watchedRestored,
      now,
      JSON.stringify([])
    );
  }

  const lecture = db.prepare('SELECT course_id FROM lectures WHERE id = ?').get(lectureId) as any;
  if (lecture) {
    db.prepare('UPDATE courses SET last_watched = ? WHERE id = ?').run(now, lecture.course_id);
    db.prepare('INSERT INTO history (lecture_id, course_id, watched_at) VALUES (?, ?, ?)').run(lectureId, lecture.course_id, now);
  }

  const saved = db.prepare('SELECT * FROM progress WHERE lecture_id = ?').get(lectureId);
  return { success: true, progress: saved };
});

ipcMain.handle('progress:all', async () => {
  const db = getDb();
  return db.prepare('SELECT * FROM progress').all();
});

ipcMain.handle('activity:get', async () => {
  const db = getDb();
  const since = localDayKey(Date.now() - 371 * DAY_MS);
  return db.prepare('SELECT day, seconds, app_seconds FROM activity WHERE day >= ? ORDER BY day ASC').all(since);
});

/**
 * Time spent in the app itself, reported by the renderer while the window is
 * visible and focused. Kept separate from video playback so a long paused
 * session does not look like study time.
 */
ipcMain.handle('activity:addAppTime', async (_, seconds: number) => {
  const value = Math.max(0, Math.min(60, Number(seconds) || 0));
  if (value > 0) addActivity(value, 'app');
  return { success: true };
});

ipcMain.handle('lecture:setDuration', async (_, lectureId: string, seconds: number) => {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return { success: false };
  const rounded = Math.round(value * 1000) / 1000;
  const db = getDb();
  db.prepare('UPDATE lectures SET duration = ? WHERE id = ?').run(rounded, lectureId);
  db.prepare('UPDATE progress SET duration = ? WHERE lecture_id = ? AND (duration IS NULL OR duration <= 0)')
    .run(rounded, lectureId);
  return { success: true };
});

// ---------------------------------------------------------------------------
// Notes / bookmarks
// ---------------------------------------------------------------------------
ipcMain.handle('note:save', async (_, note: any) => {
  const db = getDb();
  const id = note.id || uuidv4();
  const now = Date.now();
  db.prepare('INSERT INTO notes (id, course_id, lecture_id, timestamp, content, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(id, note.course_id, note.lecture_id, note.timestamp ?? null, note.content, now);
  return { success: true, id };
});

ipcMain.handle('note:update', async (_, id: string, content: string) => {
  const db = getDb();
  db.prepare('UPDATE notes SET content = ? WHERE id = ?').run(content, id);
  return { success: true };
});

ipcMain.handle('note:delete', async (_, id: string) => {
  const db = getDb();
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('note:list', async (_, courseId?: string, lectureId?: string) => {
  const db = getDb();
  if (lectureId) return db.prepare('SELECT * FROM notes WHERE lecture_id = ? ORDER BY created_at DESC').all(lectureId);
  if (courseId) return db.prepare('SELECT * FROM notes WHERE course_id = ? ORDER BY created_at DESC').all(courseId);
  return db.prepare('SELECT * FROM notes ORDER BY created_at DESC').all();
});

ipcMain.handle('bookmark:add', async (_, bookmark: any) => {
  const db = getDb();
  const id = uuidv4();
  const now = Date.now();
  db.prepare('INSERT INTO bookmarks (id, course_id, lecture_id, timestamp, description, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, bookmark.course_id, bookmark.lecture_id, bookmark.timestamp ?? null, bookmark.description || '', now);
  return { success: true, id };
});

ipcMain.handle('bookmark:delete', async (_, id: string) => {
  const db = getDb();
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('bookmark:list', async (_, courseId?: string, lectureId?: string) => {
  const db = getDb();
  if (lectureId) return db.prepare('SELECT * FROM bookmarks WHERE lecture_id = ? ORDER BY timestamp').all(lectureId);
  if (courseId) return db.prepare('SELECT * FROM bookmarks WHERE course_id = ? ORDER BY created_at DESC').all(courseId);
  return db.prepare('SELECT * FROM bookmarks ORDER BY created_at DESC').all();
});

// ---------------------------------------------------------------------------
// Settings / stats
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', async () => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM settings').all() as any[];
  const settings: any = {
    theme: 'minimal',
    autoplay: true,
    completionThreshold: 90,
    playbackRate: 1,
    captionSize: 100,
    captionColor: '#ffffff',
    captionBg: 55
  };
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings;
});

ipcMain.handle('settings:set', async (_, key: string, value: any) => {
  const db = getDb();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
  if (key === 'theme') {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('themeChosen', JSON.stringify(true));
  }
  if (key === 'completionThreshold') normalizeProgressCoverage();
  return { success: true };
});

ipcMain.handle('stats:get', async () => {
  const db = getDb();
  const threshold = getCompletionThreshold(db);
  const totalCourses = (db.prepare('SELECT COUNT(*) AS c FROM courses').get() as any).c;
  const totalLectures = (db.prepare('SELECT COUNT(*) AS c FROM lectures').get() as any).c;
  const completed = (db.prepare('SELECT COUNT(*) AS c FROM progress WHERE completed = 1').get() as any).c;
  const inProgress = (db.prepare('SELECT COUNT(*) AS c FROM progress WHERE completed = 0 AND COALESCE(watched, 0) > 0').get() as any).c;
  const needsReview = (db.prepare('SELECT COUNT(*) AS c FROM lectures WHERE needs_review = 1').get() as any).c;

  const totals = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(NULLIF(l.duration, 0), p.duration, 0)), 0) AS total_duration,
           COALESCE(SUM(
             CASE WHEN p.completed = 1
               THEN COALESCE(NULLIF(l.duration, 0), p.duration, 0)
               ELSE COALESCE(p.watched, 0)
             END
           ), 0) AS watched
    FROM lectures l
    LEFT JOIN progress p ON p.lecture_id = l.id
  `).get() as any;
  const totalDuration = Math.max(0, Number(totals?.total_duration) || 0);
  const watchedDuration = totalDuration > 0
    ? Math.min(totalDuration, Math.max(0, Number(totals?.watched) || 0))
    : Math.max(0, Number(totals?.watched) || 0);
  const progress = totalDuration > 0
    ? (watchedDuration / totalDuration) * 100
    : totalLectures > 0 ? (completed / totalLectures) * 100 : 0;

  const recent = db.prepare(`
    SELECT h.*, l.title AS lecture_title, c.title AS course_title
    FROM history h
    LEFT JOIN lectures l ON h.lecture_id = l.id
    LEFT JOIN courses c ON h.course_id = c.id
    ORDER BY watched_at DESC
    LIMIT 8
  `).all();

  const continueLecture = db.prepare(`
    SELECT l.id, l.title, l.course_id, c.title AS course_title, s.title AS section_title,
           COALESCE(p.position, 0) AS position, COALESCE(p.duration, 0) AS duration,
           COALESCE(p.percent, 0) AS percent, p.last_watched,
           (SELECT COUNT(*) FROM lectures cl WHERE cl.course_id = c.id) AS course_total,
           (SELECT COUNT(*) FROM lectures cl
              JOIN progress cp ON cp.lecture_id = cl.id
              WHERE cl.course_id = c.id AND cp.completed = 1) AS course_completed
    FROM lectures l
    JOIN courses c ON c.id = l.course_id
    LEFT JOIN sections s ON s.id = l.section_id
    LEFT JOIN progress p ON p.lecture_id = l.id
    WHERE COALESCE(p.completed, 0) = 0
      AND COALESCE(p.percent, 0) < ?
    ORDER BY
      CASE WHEN COALESCE(p.percent, 0) > 0 THEN 0 ELSE 1 END,
      COALESCE(p.last_watched, 0) DESC,
      c.last_watched IS NULL,
      c.last_watched DESC,
      c.created_at DESC,
      s.order_index ASC,
      l.order_index ASC
    LIMIT 1
  `).get(threshold) as any;

  if (continueLecture) {
    const time = getCourseTimeStats(db, continueLecture.course_id);
    continueLecture.course_progress = time.percent;
    continueLecture.course_duration = time.totalDuration;
    continueLecture.course_watched = time.watchedDuration;
  }

  return {
    totalCourses,
    totalLectures,
    completed,
    inProgress,
    needsReview,
    unwatched: Math.max(0, totalLectures - completed - inProgress),
    progress,
    totalDuration,
    watchedDuration,
    continueLecture: continueLecture || null,
    recent
  };
});

// ---------------------------------------------------------------------------
// Backup / restore (move a library between computers)
// ---------------------------------------------------------------------------

const BACKUP_FORMAT = 'courseflow-backup';
const BACKUP_VERSION = 1;

// Column allow-lists are also the import schema. Table and column names are
// application constants, never user input.
const BACKUP_TABLES: Record<string, string[]> = {
  courses: ['id', 'title', 'folder_path', 'created_at', 'last_watched', 'thumbnail_path'],
  sections: ['id', 'course_id', 'title', 'order_index'],
  lectures: ['id', 'course_id', 'section_id', 'title', 'file_path', 'duration', 'order_index', 'subtitle_paths', 'resources', 'needs_review'],
  progress: ['lecture_id', 'position', 'duration', 'percent', 'watched', 'intervals', 'prior_intervals', 'prior_watched', 'completed', 'auto_complete_blocked', 'last_watched'],
  notes: ['id', 'course_id', 'lecture_id', 'timestamp', 'content', 'created_at'],
  bookmarks: ['id', 'course_id', 'lecture_id', 'timestamp', 'description', 'created_at'],
  history: ['id', 'lecture_id', 'course_id', 'watched_at'],
  settings: ['key', 'value'],
  activity: ['day', 'seconds', 'app_seconds', 'updated_at']
};

const BACKUP_INSERT_ORDER = ['courses', 'sections', 'lectures', 'progress', 'notes', 'bookmarks', 'history', 'settings', 'activity'];
const BACKUP_DELETE_ORDER = ['activity', 'history', 'bookmarks', 'notes', 'progress', 'lectures', 'sections', 'courses', 'settings'];

function tableCounts(db: any) {
  const counts: Record<string, number> = {};
  for (const table of Object.keys(BACKUP_TABLES)) {
    counts[table] = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any)?.count) || 0;
  }
  return counts;
}

function validateBackup(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return 'That file does not contain a CourseFlow backup.';
  if (payload.format !== BACKUP_FORMAT) return 'That file was not created by CourseFlow.';
  if (Number(payload.version) > BACKUP_VERSION) return 'This backup was made by a newer version of CourseFlow.';
  if (!payload.database || typeof payload.database !== 'object') return 'The backup has no database section.';
  for (const table of ['courses', 'sections', 'lectures', 'progress', 'settings']) {
    if (!Array.isArray(payload.database[table])) return `The backup is missing its ${table} records.`;
  }
  for (const table of Object.keys(BACKUP_TABLES)) {
    const rows = payload.database[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return `The backup has invalid ${table} records.`;
    if (rows.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))) {
      return `The backup has invalid ${table} records.`;
    }
  }
  return null;
}

/** Copy the live database before a destructive import. */
function snapshotDatabase() {
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
    const userData = app.getPath('userData');
    const source = path.join(userData, 'learn.db');
    if (!fs.existsSync(source)) return null;
    const target = path.join(userData, `learn-pre-import-${Date.now()}.db`);
    fs.copyFileSync(source, target);

    const previous = fs.readdirSync(userData)
      .filter((name) => name.startsWith('learn-pre-import-'))
      .sort();
    while (previous.length > 3) {
      const oldest = previous.shift();
      if (oldest) fs.unlinkSync(path.join(userData, oldest));
    }
    return target;
  } catch (error) {
    console.error('Could not snapshot the database before import', error);
    return null;
  }
}

ipcMain.handle('data:export', async (_, preferences: Record<string, string> = {}) => {
  if (!mainWindow) return { success: false, error: 'The app window is not available.' };
  const stamp = new Date().toISOString().slice(0, 10);
  const picked = await dialog.showSaveDialog(mainWindow, {
    title: 'Export CourseFlow data',
    defaultPath: path.join(app.getPath('documents'), `CourseFlow-backup-${stamp}.json`),
    filters: [{ name: 'CourseFlow backup', extensions: ['json'] }]
  });
  if (picked.canceled || !picked.filePath) return { success: false, canceled: true };

  try {
    const db = getDb();
    const database: Record<string, any[]> = {};
    for (const table of Object.keys(BACKUP_TABLES)) {
      database[table] = db.prepare(`SELECT * FROM ${table}`).all();
    }

    const safePreferences: Record<string, string> = {};
    for (const [key, value] of Object.entries(preferences || {})) {
      if (typeof key === 'string' && key.startsWith('courseflow.') && typeof value === 'string') {
        safePreferences[key] = value;
      }
    }

    const payload = {
      app: 'CourseFlow',
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      database,
      preferences: safePreferences
    };

    fs.writeFileSync(picked.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { success: true, path: picked.filePath, counts: tableCounts(db) };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Could not write the backup file.' };
  }
});

ipcMain.handle('data:import', async () => {
  if (!mainWindow) return { success: false, error: 'The app window is not available.' };
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: 'Import CourseFlow data',
    properties: ['openFile'],
    filters: [{ name: 'CourseFlow backup', extensions: ['json'] }]
  });
  if (picked.canceled || picked.filePaths.length === 0) return { success: false, canceled: true };

  let payload: any;
  try {
    payload = JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8'));
  } catch {
    return { success: false, error: 'That file is not valid JSON.' };
  }

  const invalid = validateBackup(payload);
  if (invalid) return { success: false, error: invalid };

  const db = getDb();
  const safetyBackup = snapshotDatabase();

  try {
    const replace = db.transaction(() => {
      for (const table of BACKUP_DELETE_ORDER) db.prepare(`DELETE FROM ${table}`).run();

      for (const table of BACKUP_INSERT_ORDER) {
        const columns = BACKUP_TABLES[table];
        const rows = payload.database[table] ?? [];
        if (rows.length === 0) continue;
        const statement = db.prepare(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
        );
        for (const row of rows) {
          statement.run(...columns.map((column) => (
            row[column] === undefined
              ? (column === 'app_seconds' || column === 'auto_complete_blocked' ? 0 : null)
              : row[column]
          )));
        }
      }
    });
    replace();
  } catch (error: any) {
    return {
      success: false,
      error: `Could not import this backup: ${error?.message || 'unknown database error'}`,
      safetyBackup
    };
  }

  const preferences: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload.preferences || {})) {
    if (typeof key === 'string' && key.startsWith('courseflow.') && typeof value === 'string') {
      preferences[key] = value;
    }
  }

  const courses = db.prepare('SELECT id, title, folder_path FROM courses').all() as any[];
  const missingCourses = courses
    .filter((course) => !course.folder_path || !fs.existsSync(course.folder_path))
    .map((course) => ({ id: course.id, title: course.title, folderPath: course.folder_path }));

  return {
    success: true,
    preferences,
    missingCourses,
    counts: tableCounts(db),
    safetyBackup
  };
});

/**
 * Point an imported course at a folder on this computer. Lecture paths are
 * rewritten by prefix, so moving `D:\Courses\JavaScript` to
 * `C:\Courses\JavaScript` keeps sections, progress, notes and moments intact.
 */
ipcMain.handle('course:relocate', async (_, id: string, newFolder: string) => {
  if (!newFolder || !fs.existsSync(newFolder)) return { success: false, error: 'That folder does not exist.' };
  const db = getDb();
  const course = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as any;
  if (!course) return { success: false, error: 'Course not found.' };

  const clash = db.prepare('SELECT id FROM courses WHERE folder_path = ? AND id <> ?').get(newFolder, id);
  if (clash) return { success: false, error: 'Another course already points at that folder.' };

  const oldPrefix = String(course.folder_path || '').replace(/[\\/]+$/, '');
  const newPrefix = String(newFolder).replace(/[\\/]+$/, '');
  const oldNormalized = oldPrefix.replace(/\//g, '\\').toLowerCase();

  const rewritePath = (value: string) => {
    if (typeof value !== 'string' || !value) return value;
    const normalized = value.replace(/\//g, '\\');
    if (normalized.toLowerCase() === oldNormalized) return newPrefix;
    if (normalized.toLowerCase().startsWith(`${oldNormalized}\\`)) {
      return newPrefix + normalized.slice(oldPrefix.length);
    }
    return value;
  };

  const rewriteList = (value: string | null) => {
    if (!value) return value;
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return value;
      return JSON.stringify(parsed.map((item) => (typeof item === 'string' ? rewritePath(item) : item)));
    } catch {
      return value;
    }
  };

  const lectures = db.prepare('SELECT id, file_path, subtitle_paths, resources FROM lectures WHERE course_id = ?').all(id) as any[];
  let missing = 0;

  const relocate = db.transaction(() => {
    const updateLecture = db.prepare('UPDATE lectures SET file_path = ?, subtitle_paths = ?, resources = ? WHERE id = ?');
    for (const lecture of lectures) {
      const filePath = rewritePath(lecture.file_path);
      if (!fs.existsSync(filePath)) missing += 1;
      updateLecture.run(filePath, rewriteList(lecture.subtitle_paths), rewriteList(lecture.resources), lecture.id);
    }
    db.prepare('UPDATE courses SET folder_path = ?, thumbnail_path = ? WHERE id = ?')
      .run(newFolder, course.thumbnail_path ? rewritePath(course.thumbnail_path) : course.thumbnail_path, id);
  });
  relocate();

  return { success: true, updated: lectures.length, missing };
});

// ---------------------------------------------------------------------------
// Local files / subtitles
// ---------------------------------------------------------------------------
ipcMain.handle('file:url', async (_, filePath: string) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return pathToFileURL(filePath).toString();
  } catch {
    return null;
  }
});

ipcMain.handle('subtitle:listForVideo', async (_, videoPath: string) => {
  return listSubtitlesForVideo(videoPath);
});

// The renderer plays subtitles through a <track> element, which only accepts
// WebVTT. SRT files are converted here (and .vtt files are passed through).
ipcMain.handle('subtitle:vtt', async (_, subtitlePath: string) => {
  try {
    if (!subtitlePath || !fs.existsSync(subtitlePath)) return null;
    const raw = fs.readFileSync(subtitlePath, 'utf8');
    if (path.extname(subtitlePath).toLowerCase() === '.vtt') return raw;
    return stringifySync(parseSync(raw), { format: 'WebVTT' });
  } catch {
    return null;
  }
});

ipcMain.handle('subtitle:open', async (_, videoPath: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add subtitle file',
    properties: ['openFile'],
    filters: [
      { name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

function parseList(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === 'string');
  } catch {
    // fall through
  }
  return [];
}

ipcMain.handle('subtitle:add', async (_, lectureId: string, subtitlePath: string) => {
  const db = getDb();
  const lecture = db.prepare('SELECT subtitle_paths FROM lectures WHERE id = ?').get(lectureId) as any;
  if (!lecture) return { success: false };
  const existing = parseList(lecture.subtitle_paths);
  if (existing.includes(subtitlePath)) return { success: true, subtitle_paths: JSON.stringify(existing) };
  const updated = [...existing, subtitlePath];
  db.prepare('UPDATE lectures SET subtitle_paths = ? WHERE id = ?').run(JSON.stringify(updated), lectureId);
  return { success: true, subtitle_paths: JSON.stringify(updated) };
});
