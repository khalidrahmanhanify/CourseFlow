with open('src/main/main.ts','r',encoding='utf-8') as f:
    c = f.read()

old = """ipcMain.handle('progress:complete', async (_, lectureId: string, completed: boolean) => {
  const db = getDb();
  const now = Date.now();
  const lectureRow = db.prepare('SELECT duration FROM lectures WHERE id = ?').get(lectureId) as any;
  const existing = db.prepare(`
    SELECT position, duration, percent, watched, completed, auto_complete_blocked, intervals, prior_intervals, prior_watched
    FROM progress WHERE lecture_id = ?
  `).get(lectureId) as any;
  const duration = Math.max(0, Number(existing?.duration) || Number(lectureRow?.duration) || 0);
  const threshold = getCompletionThreshold(db);

  if (completed) {
    // Save prior coverage before marking complete
    const currentIntervals = existing?.intervals ?? null;
    const currentWatched = Math.max(0, Number(existing?.watched) || 0);
    const watched = duration > 0 ? duration : currentWatched;
    const percent = 100;
    db.prepare(`
      INSERT INTO progress (lecture_id, position, duration, completed, percent, watched, auto_complete_blocked, last_watched, intervals, prior_intervals, prior_watched)
      VALUES (?, ?, ?, 1, ?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT(lecture_id) DO UPDATE SET
        duration = excluded.duration,
        completed = 1,
        percent = excluded.percent,
        watched = excluded.watched,
        auto_complete_blocked = 0,
        last_watched = excluded.last_watched,
        prior_intervals = excluded.prior_intervals,
        prior_watched = excluded.prior_watched,
        intervals = COALESCE(excluded.intervals, progress.intervals)
    `).run(
      lectureId,
      Math.max(0, Number(existing?.position) || 0),
      duration,
      percent,
      watched,
      now,
      duration > 0 ? JSON.stringify([[0, duration]]) : currentIntervals,
      currentIntervals,
      currentWatched > 0 ? currentWatched : (duration > 0 ? duration : 0)
    );
  } else {
    // Un-marking must restore real prior coverage (or "Not started"), stay below threshold
    const priorIntervals = existing?.prior_intervals ? parseIntervals(existing.prior_intervals) : [];
    const mergedPrior = mergeIntervals(priorIntervals, duration || Infinity);
    const coveredPrior = intervalUnionLength(mergedPrior, duration || Infinity);
    if (coveredPrior > 0 && duration > 0) {
      const watchedRestored = Math.min(duration, coveredPrior);
      const percentRestored = Math.max(0, Math.min(threshold - 0.0001, (watchedRestored / duration) * 100));
      if (percentRestored < threshold) {
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
        `).run(lectureId, Math.max(0, Number(existing?.position) || 0), duration, percentRestored, watchedRestored, now, JSON.stringify(mergedPrior));
      } else {
        db.prepare(`
          INSERT INTO progress (lecture_id, position, duration, completed, percent, watched, auto_complete_blocked, last_watched, intervals)
          VALUES (?, ?, ?, 0, 0, 0, 1, ?, '[]')
          ON CONFLICT(lecture_id) DO UPDATE SET
            duration = excluded.duration,
            completed = 0,
            percent = 0,
            watched = 0,
            auto_complete_blocked = 1,
            last_watched = excluded.last_watched,
            intervals = '[]'
        `).run(lectureId, Math.max(0, Number(existing?.position) || 0), duration, now);
      }
    } else {
      db.prepare(`
        INSERT INTO progress (lecture_id, position, duration, completed, percent, watched, auto_complete_blocked, last_watched, intervals)
        VALUES (?, ?, ?, 0, 0, 0, 1, ?, '[]')
        ON CONFLICT(lecture_id) DO UPDATE SET
          duration = excluded.duration,
          completed = 0,
          percent = 0,
          watched = 0,
          auto_complete_blocked = 1,
          last_watched = excluded.last_watched,
          intervals = '[]'
      `).run(lectureId, Math.max(0, Number(existing?.position) || 0), duration, now);
    }
  }"""

new = """ipcMain.handle('progress:complete', async (_, lectureId: string, completed: boolean) => {
  const db = getDb();
  const now = Date.now();
  const lectureRow = db.prepare('SELECT duration FROM lectures WHERE id = ?').get(lectureId) as any;
  const existing = db.prepare(`
    SELECT position, duration, percent, watched, completed, auto_complete_blocked
    FROM progress WHERE lecture_id = ?
  `).get(lectureId) as any;
  const duration = Math.max(0, Number(existing?.duration) || Number(lectureRow?.duration) || 0);
  const threshold = getCompletionThreshold(db);

  if (completed) {
    const watched = duration;
    const percent = 100;
    db.prepare(`
      INSERT INTO progress (lecture_id, duration, completed, percent, watched, auto_complete_blocked, last_watched)
      VALUES (?, ?, 1, ?, ?, 0, ?)
      ON CONFLICT(lecture_id) DO UPDATE SET
        duration = excluded.duration,
        completed = 1,
        percent = excluded.percent,
        watched = excluded.watched,
        auto_complete_blocked = 0,
        last_watched = excluded.last_watched
    `).run(lectureId, duration, percent, watched, now);
  } else {
    const currentPosition = Math.max(0, Number(existing?.position) || 0);
    let percent = duration > 0 ? Math.min(100, Math.max(0, (currentPosition / duration) * 100)) : 0;
    if (percent >= threshold) {
      percent = Math.max(0, Math.min(threshold - 1, Math.max(0, threshold - 1)));
    }
    const watched = duration > 0 ? Math.min(duration, (percent / 100) * duration) : currentPosition;
    db.prepare(`
      INSERT INTO progress (lecture_id, position, duration, completed, percent, watched, auto_complete_blocked, last_watched)
      VALUES (?, ?, ?, 0, ?, ?, 1, ?)
      ON CONFLICT(lecture_id) DO UPDATE SET
        duration = excluded.duration,
        completed = 0,
        percent = excluded.percent,
        watched = excluded.watched,
        auto_complete_blocked = 1,
        last_watched = excluded.last_watched
    `).run(lectureId, currentPosition, duration, percent, watched, now);
  }"""

if old in c:
    c2 = c.replace(old, new)
    with open('src/main/main.ts','w',encoding='utf-8') as f:
        f.write(c2)
    print('ok')
else:
    print('no')
