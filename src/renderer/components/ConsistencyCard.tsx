import { useMemo } from 'react';
import { CalendarDays, Clock3, Flame, Monitor, Trophy } from 'lucide-react';
import type { ActivityDay } from '../types';
import { dayKey, formatStudyTime } from '../utils';

interface ConsistencyCardProps {
  days: ActivityDay[];
}

interface DayCell {
  date: Date;
  key: string;
  seconds: number;
  appSeconds: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LENGTH = 7;
const PAST_WEEKS = 52;

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function levelFor(seconds: number) {
  if (seconds <= 0) return 0;
  if (seconds < 15 * 60) return 1;
  if (seconds < 45 * 60) return 2;
  if (seconds < 90 * 60) return 3;
  return 4;
}

export default function ConsistencyCard({ days }: ConsistencyCardProps) {
  const model = useMemo(() => {
    const byDay = new Map<string, { seconds: number; appSeconds: number }>();
    for (const row of days) {
      if (!row.day) continue;
      byDay.set(row.day, {
        seconds: Math.max(0, Number(row.seconds) || 0),
        appSeconds: Math.max(0, Number(row.app_seconds) || 0)
      });
    }

    const end = startOfToday();
    // Start on a Sunday so every column is a real calendar week.
    const start = new Date(end);
    start.setDate(start.getDate() - (PAST_WEEKS * WEEK_LENGTH + end.getDay()));

    const weeks: Array<Array<DayCell | null>> = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= end.getTime()) {
      const week: Array<DayCell | null> = [];
      for (let index = 0; index < WEEK_LENGTH; index += 1) {
        if (cursor.getTime() > end.getTime()) {
          week.push(null);
        } else {
          const key = dayKey(cursor);
          const entry = byDay.get(key);
          week.push({
            date: new Date(cursor),
            key,
            seconds: entry?.seconds ?? 0,
            appSeconds: entry?.appSeconds ?? 0
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }

    // Label the column that contains the first day of each month.
    const monthLabels: string[] = weeks.map((week, index) => {
      const firstOfMonth = week.find((cell) => cell && cell.date.getDate() === 1) as DayCell | undefined;
      if (firstOfMonth) return firstOfMonth.date.toLocaleDateString(undefined, { month: 'short' });
      if (index === 0) {
        const first = week.find(Boolean) as DayCell | undefined;
        return first ? first.date.toLocaleDateString(undefined, { month: 'short' }) : '';
      }
      return '';
    });

    const watchedDays = [...byDay.entries()]
      .filter(([, value]) => value.seconds > 0)
      .map(([key]) => key)
      .sort();
    const activeKeys = new Set(watchedDays);

    let currentStreak = 0;
    const streakCursor = startOfToday();
    // A streak is still alive if you have not watched *yet* today but did
    // yesterday; it only breaks after a full missed day.
    if (!activeKeys.has(dayKey(streakCursor))) streakCursor.setDate(streakCursor.getDate() - 1);
    for (let index = 0; index < PAST_WEEKS * WEEK_LENGTH + 1; index += 1) {
      if (!activeKeys.has(dayKey(streakCursor))) break;
      currentStreak += 1;
      streakCursor.setDate(streakCursor.getDate() - 1);
    }

    let bestStreak = 0;
    let run = 0;
    let previous: number | null = null;
    for (const key of watchedDays) {
      const timestamp = new Date(`${key}T00:00:00`).getTime();
      if (previous !== null && Math.round((timestamp - previous) / DAY_MS) === 1) run += 1;
      else run = 1;
      previous = timestamp;
      bestStreak = Math.max(bestStreak, run);
    }

    let videoSeconds = 0;
    let appSeconds = 0;
    for (const value of byDay.values()) {
      videoSeconds += value.seconds;
      appSeconds += value.appSeconds;
    }

    return {
      weeks,
      monthLabels,
      currentStreak,
      bestStreak,
      videoSeconds,
      appSeconds,
      activeDays: activeKeys.size
    };
  }, [days]);

  const weekdayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

  return (
    <section className="consistency-card">
      <header className="consistency-head">
        <div className="consistency-copy">
          <p className="eyebrow">Consistency</p>
          <h2>Your learning rhythm</h2>
          <p>Every day you watch a lecture fills a square. Darker squares mean more time watched.</p>
        </div>
        <div className="consistency-stats">
          <div className="consistency-stat">
            <span className="consistency-icon flame"><Flame size={16} /></span>
            <div><strong>{model.currentStreak}</strong><span>day streak</span></div>
          </div>
          <div className="consistency-stat">
            <span className="consistency-icon trophy"><Trophy size={16} /></span>
            <div><strong>{model.bestStreak}</strong><span>best streak</span></div>
          </div>
          <div className="consistency-stat">
            <span className="consistency-icon clock"><Clock3 size={16} /></span>
            <div><strong>{formatStudyTime(model.videoSeconds)}</strong><span>video watched</span></div>
          </div>
          <div className="consistency-stat">
            <span className="consistency-icon app"><Monitor size={16} /></span>
            <div><strong>{formatStudyTime(model.appSeconds)}</strong><span>time in app</span></div>
          </div>
        </div>
      </header>

      <div className="heatmap-scroll">
        <div className="heatmap-inner">
          <div className="heatmap-months">
            {model.monthLabels.map((label, index) => (
              <span key={`month-${index}`}>{label}</span>
            ))}
          </div>
          <div className="heatmap-body">
            <div className="heatmap-weekdays">
              {weekdayLabels.map((label, index) => (
                <span key={`weekday-${index}`}>{label}</span>
              ))}
            </div>
            <div className="heatmap-grid">
              {model.weeks.map((week, weekIndex) => (
                <div className="heatmap-week" key={`week-${weekIndex}`}>
                  {week.map((cell, dayIndex) => {
                    if (!cell) {
                      return <span className="heatmap-cell empty" key={`empty-${weekIndex}-${dayIndex}`} />;
                    }
                    const label = cell.date.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    });
                    const description = [
                      label,
                      cell.seconds > 0 ? `${formatStudyTime(cell.seconds)} of video` : 'no video watched',
                      cell.appSeconds > 0 ? `${formatStudyTime(cell.appSeconds)} in the app` : ''
                    ].filter(Boolean).join(' · ');
                    return (
                      <span
                        key={cell.key}
                        className={`heatmap-cell level-${levelFor(cell.seconds)}`}
                        title={description}
                        role="img"
                        aria-label={description}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="consistency-footer">
        <span>
          {model.currentStreak > 0
            ? `You are on a ${model.currentStreak} day streak. Keep it alive.`
            : 'Watch a lecture today to start a new streak.'}
          {model.activeDays > 0 ? ` ${model.activeDays} active ${model.activeDays === 1 ? 'day' : 'days'} this year.` : ''}
        </span>
        <span className="heatmap-legend">
          Less
          {[0, 1, 2, 3, 4].map((level) => <i key={level} className={`heatmap-cell level-${level}`} />)}
          More
        </span>
      </footer>
    </section>
  );
}
