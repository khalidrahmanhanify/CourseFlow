const fs = require('fs');
let c = fs.readFileSync('src/renderer/pages/Player.tsx', 'utf8');
const old = `      const position = Math.min(total, Math.max(0, video.currentTime || 0));
      // Close any active interval at current position.
      closeCurrentInterval(video.currentTime);
      const intervals = [...intervalsRef.current];
      const merged = mergeIntervals(intervals, total);
      let watched = 0;
      for (const iv of merged) {
        watched += Math.max(0, Math.min(iv[1], total) - Math.max(iv[0], 0));
      }
      if (total > 0) watched = Math.min(total, watched);
      const currentPercent =
        total > 0 ? Math.min(100, Math.max(0, (watched / total) * 100)) : 0;`;
const neu = `      const position = Math.min(total, Math.max(0, video.currentTime || 0));
      const currentPercent =
        total > 0 ? Math.min(100, Math.max(0, (position / total) * 100)) : 0;`;
if (c.includes(old)) { c = c.split(old).join(neu); console.log('1ok'); } else console.log('1no');
const old2 = `      if (finished && total > 0) watched = total;
      const percent = finished ? 100 : currentPercent;
      lastSavedRef.current = position;
      watchedRef.current = watched;
      const seq = ++progressSeqRef.current;
      const optimistic: Progress = {
        lecture_id: lecture.id,
        position,
        duration: total,
        percent,
        watched,
        completed: finished ? 1 : 0,
        auto_complete_blocked: autoCompleteBlockedRef.current ? 1 : 0,
        last_watched: Date.now(),
        intervals: JSON.stringify(merged),
      };`;
const neu2 = `      const watched = finished ? total : position;
      const percent = finished ? 100 : currentPercent;
      lastSavedRef.current = position;
      watchedRef.current = watched;
      const seq = ++progressSeqRef.current;
      const optimistic: Progress = {
        lecture_id: lecture.id,
        position,
        duration: total,
        percent,
        watched,
        completed: finished ? 1 : 0,
        auto_complete_blocked: autoCompleteBlockedRef.current ? 1 : 0,
        last_watched: Date.now(),
      };`;
if (c.includes(old2)) { c = c.split(old2).join(neu2); console.log('2ok'); } else console.log('2no');
const old3 = `      window.api
        .updateProgress(lecture.id, {
          position,
          duration: total,
          watched,
          percent,
          completed: finished ? 1 : 0,
          intervals: merged,
          clientTime: Date.now(),
        })`;
const neu3 = `      window.api
        .updateProgress(lecture.id, {
          position,
          duration: total,
          watched,
          percent,
          completed: finished ? 1 : 0,
          clientTime: Date.now(),
        })`;
if (c.includes(old3)) { c = c.split(old3).join(neu3); console.log('3ok'); } else console.log('3no');
fs.writeFileSync('src/renderer/pages/Player.tsx', c);
