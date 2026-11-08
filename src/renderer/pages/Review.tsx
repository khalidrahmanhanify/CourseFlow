import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Flag,
  Loader2,
  Play,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react';
import type { SearchResult, ToastType } from '../types';
import { cn, formatRelative, formatTime, pluralize } from '../utils';

interface ReviewProps {
  dataVersion: number;
  onOpenLecture: (courseId: string, lectureId: string) => void;
  onDataChanged: () => void;
  notify: (message: string, type?: ToastType) => void;
}

export default function Review({ dataVersion, onOpenLecture, onDataChanged, notify }: ReviewProps) {
  const [lectures, setLectures] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLectures(await window.api.listReviewLectures());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? lectures.filter((lecture) =>
          lecture.title.toLowerCase().includes(q) ||
          lecture.course_title.toLowerCase().includes(q) ||
          (lecture.section_title || '').toLowerCase().includes(q)
        )
      : lectures;

    const map = new Map<string, { title: string; items: SearchResult[] }>();
    for (const lecture of filtered) {
      const group = map.get(lecture.course_id) ?? { title: lecture.course_title, items: [] };
      group.items.push(lecture);
      map.set(lecture.course_id, group);
    }
    return Array.from(map.values());
  }, [lectures, query]);

  const dismiss = async (lecture: SearchResult) => {
    setBusyId(lecture.id);
    try {
      await window.api.setLectureReview(lecture.id, false);
      setLectures((current) => current.filter((item) => item.id !== lecture.id));
      notify('Removed from your review queue', 'success');
      onDataChanged();
    } finally {
      setBusyId(null);
    }
  };

  const complete = async (lecture: SearchResult) => {
    setBusyId(lecture.id);
    try {
      await window.api.markComplete(lecture.id, true);
      await window.api.setLectureReview(lecture.id, false);
      setLectures((current) => current.filter((item) => item.id !== lecture.id));
      notify(`Completed “${lecture.title}”`, 'success');
      onDataChanged();
    } finally {
      setBusyId(null);
    }
  };

  const total = lectures.length;

  return (
    <div className="page review-page">
      <div className="page-top">
        <div>
          <p className="eyebrow"><Flag size={13} /> Saved for later</p>
          <h1 className="page-title">Review queue</h1>
          <p className="page-subtitle">
            {total > 0
              ? `${pluralize(total, 'lecture')} you flagged as tricky. Revisit them while the questions are still fresh.`
              : 'Lectures you mark as hard will collect here so you never lose track of them.'}
          </p>
        </div>
        {total > 0 && (
          <div className="review-summary">
            <span className="review-summary-number">{total}</span>
            <span>{total === 1 ? 'lecture waiting' : 'lectures waiting'}</span>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="content-toolbar">
          <div className="inline-search wide">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search your review queue..."
            />
            {query && <button className="clear-search" onClick={() => setQuery('')}>Clear</button>}
          </div>
          <div className="toolbar-meta">
            <span>{pluralize(total, 'saved lecture')}</span>
          </div>
        </div>
      )}

      {loading ? (
        <div className="empty-panel">
          <Loader2 size={24} className="spin" />
          <p>Loading your review queue...</p>
        </div>
      ) : total === 0 ? (
        <div className="empty-panel review-empty">
          <div className="empty-illustration"><Sparkles size={26} /></div>
          <h3>Nothing to review right now</h3>
          <p>
            When a lecture feels hard to follow, open it and press <kbd>Mark for review</kbd>.
            It will show up here, ready when you are.
          </p>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-panel">
          <Search size={24} />
          <h3>No saved lectures match “{query}”</h3>
          <button className="btn btn-ghost" onClick={() => setQuery('')}>Clear search</button>
        </div>
      ) : (
        <div className="review-groups">
          {groups.map((group) => (
            <section className="review-group" key={group.title}>
              <header className="review-group-header">
                <Flag size={14} />
                <h2>{group.title}</h2>
                <span>{pluralize(group.items.length, 'lecture')}</span>
              </header>

              <div className="review-list">
                {group.items.map((lecture) => {
                  const percent = Math.round(lecture.percent || 0);
                  return (
                    <article key={lecture.id} className="review-card">
                      <button className="review-play" onClick={() => onOpenLecture(lecture.course_id, lecture.id)} aria-label={`Play ${lecture.title}`}>
                        <Play size={18} fill="currentColor" />
                      </button>

                      <div className="review-main">
                        <div className="review-title-row">
                          <h3>{lecture.title}</h3>
                          {lecture.completed === 1 && <span className="chip tiny success"><CheckCircle2 size={11} /> Completed</span>}
                        </div>
                        <div className="review-meta">
                          {lecture.section_title && <span>{lecture.section_title}</span>}
                          {lecture.duration ? <span>{formatTime(lecture.duration)}</span> : null}
                          <span>{percent > 0 ? `${percent}% watched` : 'Not started'}</span>
                          {lecture.last_watched ? <span>Last opened {formatRelative(lecture.last_watched)}</span> : null}
                        </div>
                        {percent > 0 && (
                          <div className="progress-track small">
                            <div className="progress-fill" style={{ width: `${percent}%` }} />
                          </div>
                        )}
                      </div>

                      <div className="review-actions">
                        <button
                          className="btn btn-ghost btn-xs"
                          onClick={() => dismiss(lecture)}
                          disabled={busyId === lecture.id}
                          title="Remove from review queue"
                        >
                          {busyId === lecture.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
                          Got it
                        </button>
                        <button
                          className={cn('btn btn-xs', lecture.completed === 1 ? 'btn-ghost' : 'btn-primary')}
                          onClick={() => complete(lecture)}
                          disabled={busyId === lecture.id || lecture.completed === 1}
                        >
                          <CheckCircle2 size={13} /> {lecture.completed === 1 ? 'Completed' : 'Mark complete'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
