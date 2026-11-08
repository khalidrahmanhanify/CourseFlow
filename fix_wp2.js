const fs = require('fs');
let c = fs.readFileSync('src/renderer/pages/Player.tsx', 'utf8');

const oldWp = `  const watchedPercent = (video: HTMLVideoElement) => {
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    if (total <= 0) return 0;
    if (completedRef.current) return 100;
    const intervals = [...intervalsRef.current];
    if (currentIntervalStartRef.current !== null) {
      intervals.push([currentIntervalStartRef.current, video.currentTime]);
    }
    let covered = 0;
    const merged = mergeIntervals(intervals, total);
    for (const iv of merged) {
      covered += Math.max(0, Math.min(iv[1], total) - Math.max(iv[0], 0));
    }
    return Math.min(100, Math.max(0, (covered / total) * 100));
  };`;
const newWp = `  const watchedPercent = (video: HTMLVideoElement) => {
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    if (total <= 0) return 0;
    if (completedRef.current) return 100;
    const pos = Math.max(0, video.currentTime || 0);
    return Math.min(100, Math.max(0, (pos / total) * 100));
  };`;
if (c.includes(oldWp)) {
  c = c.split(oldWp).join(newWp);
  console.log('wp ok');
} else {
  console.log('wp no');
}

fs.writeFileSync('src/renderer/pages/Player.tsx', c);
