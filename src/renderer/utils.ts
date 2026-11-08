import type { CourseDetail, Lecture, Section } from './types';

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function formatTime(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/** Human friendly length, e.g. "45 min" or "12.5 hr". */
export function formatHours(seconds: number | null | undefined) {
  const total = Math.max(0, Number(seconds) || 0);
  if (total <= 0) return '0 min';
  if (total < 3600) return `${Math.max(1, Math.round(total / 60))} min`;
  const hours = total / 3600;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} hr`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return '—';
  return formatTime(seconds);
}

/**
 * Compact study time for summaries. Unlike `formatHours`, small values keep
 * their seconds so a two-minute session never collapses into "1 min".
 */
export function formatStudyTime(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total <= 0) return '0 min';
  if (total < 60) return `${total} sec`;
  if (total < 3600) {
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return rest >= 30 && minutes < 10 ? `${minutes} min ${rest} sec` : `${minutes} min`;
  }
  const hours = total / 3600;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} hr`;
}

/**
 * Progress is time based, so a single lecture in a long course can move the
 * bar by a fraction of a percent. Rounding to whole numbers made those changes
 * invisible; keep one decimal for anything that is not a clean whole number.
 */
export function formatPercent(value: number | null | undefined) {
  const total = Math.max(0, Math.min(100, Number(value) || 0));
  if (total <= 0) return '0';
  if (total >= 100) return '100';
  const rounded = Math.round(total * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1);
}

/** Local calendar day key (`YYYY-MM-DD`) used by the consistency calendar. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatRelative(timestamp: number | null | undefined) {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.round(diff / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDate(timestamp: number | null | undefined) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function parseList(value: string | null | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function courseGradient(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  const hue2 = (hue + 42) % 360;
  return `linear-gradient(140deg, hsl(${hue} 62% 30%), hsl(${hue2} 70% 13%) 70%)`;
}

export function courseAccent(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 75% 62%)`;
}

export function initials(title: string) {
  const words = title.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export interface FlatLecture {
  lecture: Lecture;
  section: Section;
  index: number;
}

export function flattenCourse(data: CourseDetail | null): FlatLecture[] {
  if (!data) return [];
  const result: FlatLecture[] = [];
  for (const section of data.sections) {
    for (const lecture of section.lectures) {
      result.push({ lecture, section, index: result.length });
    }
  }
  return result;
}

export function isComplete(lecture: Lecture) {
  return lecture.progress?.completed === 1;
}

export function lecturePercent(lecture: Lecture) {
  if (isComplete(lecture)) return 100;
  // Deliberately not rounded: a few watched seconds must still show up as
  // progress instead of collapsing to "Not started".
  return Math.max(0, Math.min(100, Number(lecture.progress?.percent) || 0));
}

export function lectureDurationSeconds(lecture: Lecture) {
  return Math.max(0, Number(lecture.duration) || Number(lecture.progress?.duration) || 0);
}

export function lectureWatchedSeconds(lecture: Lecture) {
  const duration = lectureDurationSeconds(lecture);
  const position = Math.max(0, Number(lecture.progress?.position || lecture.progress?.watched || 0));
  if (isComplete(lecture)) return Math.max(duration, position);
  return duration > 0 ? Math.min(duration, position) : position;
}

export interface CourseTime {
  totalLectures: number;
  completed: number;
  totalDuration: number;
  watchedDuration: number;
  percent: number;
}

/**
 * Time based course progress. Completed lectures contribute their full
 * duration, everything else contributes the seconds that were actually
 * played. Falls back to lecture counts only when no duration is known yet.
 */
export function courseTimeProgress(sections: Section[] | null | undefined): CourseTime {
  let totalLectures = 0;
  let completed = 0;
  let totalDuration = 0;
  let watchedDuration = 0;

  for (const section of sections ?? []) {
    for (const lecture of section.lectures) {
      totalLectures += 1;
      const finished = isComplete(lecture);
      if (finished) completed += 1;
      const duration = lectureDurationSeconds(lecture);
      totalDuration += duration;
      watchedDuration += finished ? Math.max(duration, lectureWatchedSeconds(lecture)) : lectureWatchedSeconds(lecture);
    }
  }

  if (totalDuration > 0) watchedDuration = Math.min(totalDuration, watchedDuration);
  const percent = totalDuration > 0
    ? (watchedDuration / totalDuration) * 100
    : totalLectures > 0 ? (completed / totalLectures) * 100 : 0;

  return {
    totalLectures,
    completed,
    totalDuration,
    watchedDuration,
    percent: Math.max(0, Math.min(100, percent))
  };
}

export function mergeIntervals(intervals: Array<[number, number]> | null | undefined, cap = Infinity): Array<[number, number]> {
  const cleaned = (intervals ?? [])
    .map((item) => {
      if (!Array.isArray(item) || item.length < 2) return null;
      const start = Number(item[0]);
      const end = Number(item[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      const lo = Math.max(0, Math.min(start, end));
      const hi = Math.min(cap, Math.max(0, Math.max(start, end)));
      if (hi <= lo) return null;
      return [lo, hi] as [number, number];
    })
    .filter(Boolean) as Array<[number, number]>;
  cleaned.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of cleaned) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 0.5) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function courseCoverStyle(seed: string) {
  return { backgroundImage: courseGradient(seed) };
}
