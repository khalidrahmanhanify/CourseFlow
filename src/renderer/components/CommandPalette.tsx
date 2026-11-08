import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  CornerDownLeft,
  Flag,
  Loader2,
  Play,
  Search
} from 'lucide-react';
import type { SearchResult } from '../types';
import { cn, formatTime } from '../utils';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenLecture: (courseId: string, lectureId: string) => void;
}

export default function CommandPalette({ open, onClose, onOpenLecture }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = await window.api.searchLectures(trimmed);
        if (!cancelled) {
          setResults(found);
          setActiveIndex(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open]);

  if (!open) return null;

  const select = (result: SearchResult) => {
    onOpenLecture(result.course_id, result.id);
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      select(results[activeIndex]);
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search lectures">
        <div className="palette-input-row">
          <Search size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search lectures across your library..."
            aria-label="Search lectures"
          />
          {loading ? <Loader2 size={17} className="spin" /> : <kbd>ESC</kbd>}
        </div>

        <div className="palette-results">
          {query.trim() === '' ? (
            <div className="palette-empty">
              <div className="palette-empty-icon"><Search size={22} /></div>
              <h4>Find any lecture instantly</h4>
              <p>Search by lecture name, course, or section.</p>
              <div className="palette-hints">
                <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
                <span><kbd>↵</kbd> to open</span>
                <span><kbd>Ctrl K</kbd> anywhere</span>
              </div>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="palette-empty">
              <div className="palette-empty-icon"><Search size={22} /></div>
              <h4>No lectures found</h4>
              <p>Try a different title or course name.</p>
            </div>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                className={cn('palette-item', index === activeIndex && 'active')}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(result)}
              >
                <span className={cn('palette-status', result.completed ? 'is-complete' : '')}>
                  {result.completed ? <CheckCircle2 size={17} /> : <Circle size={17} />}
                </span>
                <span className="palette-main">
                  <span className="palette-title">{result.title}</span>
                  <span className="palette-meta">
                    {result.course_title}
                    {result.section_title ? ` · ${result.section_title}` : ''}
                  </span>
                </span>
                <span className="palette-side">
                  {result.needs_review ? <span className="mini-flag" title="Marked for review"><Flag size={13} /></span> : null}
                  {result.percent > 0 && !result.completed ? <span className="palette-percent">{Math.round(result.percent)}%</span> : null}
                  {result.duration ? <span className="palette-time">{formatTime(result.duration)}</span> : null}
                  <Play size={15} className="palette-play" />
                </span>
              </button>
            ))
          )}
        </div>

        <div className="palette-footer">
          <span><CornerDownLeft size={13} /> Open lecture</span>
          <span className="palette-footer-brand">CourseFlow Search</span>
        </div>
      </div>
    </div>
  );
}
