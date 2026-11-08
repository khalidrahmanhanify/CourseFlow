import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

let db: Database.Database;

export function initDb() {
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(userData, 'learn.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      folder_path TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_watched INTEGER,
      thumbnail_path TEXT
    );
    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      title TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS lectures (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      section_id TEXT,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      duration INTEGER,
      order_index INTEGER NOT NULL,
      subtitle_paths TEXT,
      resources TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS progress (
      lecture_id TEXT PRIMARY KEY,
      position REAL DEFAULT 0,
      duration REAL DEFAULT 0,
      percent REAL DEFAULT 0,
      watched REAL DEFAULT 0,
      intervals TEXT,
      completed INTEGER DEFAULT 0,
      auto_complete_blocked INTEGER NOT NULL DEFAULT 0,
      last_watched INTEGER,
      FOREIGN KEY(lecture_id) REFERENCES lectures(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      lecture_id TEXT,
      timestamp REAL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      course_id TEXT,
      lecture_id TEXT NOT NULL,
      timestamp REAL,
      description TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lecture_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      watched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity (
      day TEXT PRIMARY KEY,
      seconds REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);

  // --- Schema migrations for databases created by older versions ---
  const lectureColumns = db.prepare('PRAGMA table_info(lectures)').all() as { name: string }[];
  if (!lectureColumns.some((column) => column.name === 'needs_review')) {
    db.exec('ALTER TABLE lectures ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0');
  }

  // Older builds measured "watched" from the furthest seek position. Track
  // actual playback seconds separately so jumping to the end no longer counts
  // as having watched a lecture.
  const progressColumns = db.prepare('PRAGMA table_info(progress)').all() as { name: string }[];
  if (!progressColumns.some((column) => column.name === 'watched')) {
    db.exec('ALTER TABLE progress ADD COLUMN watched REAL DEFAULT 0');
    db.exec(`
      UPDATE progress SET watched = CASE
        WHEN completed = 1 THEN COALESCE(duration, 0)
        ELSE (COALESCE(percent, 0) / 100.0) * COALESCE(duration, 0)
      END
    `);
  }
  if (!progressColumns.some((column) => column.name === 'auto_complete_blocked')) {
    db.exec('ALTER TABLE progress ADD COLUMN auto_complete_blocked INTEGER DEFAULT 0');
  }
  if (!progressColumns.some((column) => column.name === 'intervals')) {
    db.exec('ALTER TABLE progress ADD COLUMN intervals TEXT');
  }
  if (!progressColumns.some((column) => column.name === 'prior_intervals')) {
    db.exec('ALTER TABLE progress ADD COLUMN prior_intervals TEXT');
  }
  if (!progressColumns.some((column) => column.name === 'prior_watched')) {
    db.exec('ALTER TABLE progress ADD COLUMN prior_watched REAL DEFAULT 0');
  }

  // Activity powers the consistency calendar. `seconds` is real video playback
  // time; `app_seconds` is time spent in the app with a lecture open, tracked
  // separately so both numbers can be shown without one hiding the other.
  const progressColumns2 = db.prepare('PRAGMA table_info(progress)').all() as { name: string }[];
  if (!progressColumns2.some((column) => column.name === 'intervals')) {
    db.exec('ALTER TABLE progress ADD COLUMN intervals TEXT');
  }

  // Manual completion replaces the real watch coverage with [0, duration].
  // Remember the coverage from before that so un-marking can restore the true
  // progress (or "Not started") instead of a synthetic near-complete value.
  if (!progressColumns2.some((column) => column.name === 'prior_intervals')) {
    db.exec('ALTER TABLE progress ADD COLUMN prior_intervals TEXT');
  }
  if (!progressColumns2.some((column) => column.name === 'prior_watched')) {
    db.exec('ALTER TABLE progress ADD COLUMN prior_watched REAL');
  }

  // Completion is only a flag now: it never rewrites the real coverage ranges.
  // This remembers an explicit "not complete" so auto-completion cannot undo it
  // until the user marks the lecture complete again.
  if (!progressColumns2.some((column) => column.name === 'auto_complete_blocked')) {
    db.exec('ALTER TABLE progress ADD COLUMN auto_complete_blocked INTEGER NOT NULL DEFAULT 0');
  }

  const activityColumns = db.prepare('PRAGMA table_info(activity)').all() as { name: string }[];
  if (!activityColumns.some((column) => column.name === 'app_seconds')) {
    db.exec('ALTER TABLE activity ADD COLUMN app_seconds REAL NOT NULL DEFAULT 0');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lectures_course ON lectures(course_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_lectures_review ON lectures(needs_review);
    CREATE INDEX IF NOT EXISTS idx_progress_completed ON progress(completed);
    CREATE INDEX IF NOT EXISTS idx_history_course ON history(course_id, watched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_lecture ON notes(lecture_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_day ON activity(day);
  `);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('theme', JSON.stringify('minimal'));
  insertSetting.run('autoplay', JSON.stringify(true));
  insertSetting.run('completionThreshold', JSON.stringify(90));
  insertSetting.run('playbackRate', JSON.stringify(1));

  // Existing libraries stored the old dark default. Move them to the new
  // minimal default exactly once; afterwards the user's choice is respected.
  const themeChosen = db.prepare("SELECT value FROM settings WHERE key = 'themeChosen'").get();
  if (!themeChosen) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify('minimal'));
    insertSetting.run('themeChosen', JSON.stringify(false));
  }

  repairLegacyUnmarkArtifacts(db);

  seedActivityFromHistory(db);

  return db;
}

/**
 * Older builds un-marked a completed lecture by trimming its coverage to
 * exactly `completionThreshold - 1` percent and discarding the real ranges.
 * That is where the fake 94% came from. Those rows were completed before the
 * un-mark, so restore their full coverage once (the best baseline available)
 * and keep them explicitly un-completed until the user marks them complete.
 *
 * The repair is keyed in settings so it only ever runs once, and it only
 * matches the exact trim signature so genuinely partial lectures are untouched.
 */
function repairLegacyUnmarkArtifacts(database: Database.Database) {
  const done = database.prepare("SELECT value FROM settings WHERE key = 'progressUnmarkRepairV1'").get();
  if (done) return;

  let threshold = 90;
  try {
    const row = database.prepare("SELECT value FROM settings WHERE key = 'completionThreshold'").get() as any;
    const parsed = Number(row ? JSON.parse(row.value) : 90);
    if (Number.isFinite(parsed)) threshold = Math.min(100, Math.max(1, parsed));
  } catch {
    // use the default
  }
  const artifactPercent = Math.max(0, threshold - 1);

  const rows = database.prepare(`
    SELECT lecture_id, percent, watched, duration, intervals, prior_intervals
    FROM progress
    WHERE completed = 0
      AND prior_intervals IS NULL
      AND duration > 0
      AND intervals IS NOT NULL
  `).all() as any[];

  const update = database.prepare(`
    UPDATE progress
    SET watched = ?, percent = 100, intervals = ?, auto_complete_blocked = 1
    WHERE lecture_id = ?
  `);

  const run = database.transaction(() => {
    for (const row of rows) {
      const duration = Number(row.duration) || 0;
      if (duration <= 0) continue;
      const expected = (artifactPercent / 100) * duration;
      const watched = Number(row.watched) || 0;
      const percent = Number(row.percent) || 0;
      if (Math.abs(percent - artifactPercent) > 0.01) continue;
      if (Math.abs(watched - expected) > 0.05) continue;
      let intervals: any;
      try {
        intervals = JSON.parse(row.intervals);
      } catch {
        continue;
      }
      // The old trim always kept a prefix that ends exactly at the cap. Require
      // that shape so a real 94%-watched lecture is not mistaken for it.
      if (!Array.isArray(intervals) || intervals.length !== 1) continue;
      const [start, end] = intervals[0] || [];
      if (Number(start) !== 0 || Math.abs(Number(end) - expected) > 0.05) continue;
      update.run(duration, JSON.stringify([[0, duration]]), row.lecture_id);
    }
    database.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('progressUnmarkRepairV1', ?)")
      .run(JSON.stringify(true));
  });
  run();
}

function localDayKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Activity is tracked per day from real playback seconds. Libraries created
 * before the consistency calendar existed still have watch history, so seed
 * one conservative five-minute block for each past day that has history.
 * Today is left alone because live playback adds its own seconds.
 */
function seedActivityFromHistory(database: Database.Database) {
  const existing = database.prepare('SELECT COUNT(*) AS count FROM activity').get() as any;
  if ((Number(existing?.count) || 0) > 0) return;

  const rows = database.prepare('SELECT watched_at FROM history').all() as any[];
  if (rows.length === 0) return;

  const todayKey = localDayKey(Date.now());
  const days = new Map<string, number>();
  for (const row of rows) {
    const timestamp = Number(row.watched_at);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const key = localDayKey(timestamp);
    if (key === todayKey) continue;
    days.set(key, 300);
  }

  const insert = database.prepare('INSERT OR IGNORE INTO activity (day, seconds, updated_at) VALUES (?, ?, ?)');
  const seed = database.transaction(() => {
    for (const [day, seconds] of days) insert.run(day, seconds, Date.now());
  });
  seed();
}

export function getDb() {
  return db;
}
