import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Clock3, Flag, FolderOpen, MoreVertical, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { Course } from '../types';
import { cn, courseGradient, formatHours, formatPercent, initials } from '../utils';

interface CourseCardProps {
  course: Course;
  onOpen: (courseId: string) => void;
  onRename: (course: Course) => void;
  onRescan: (course: Course) => void;
  onRelocate: (course: Course) => void;
  onDelete: (course: Course) => void;
}

interface MenuPosition {
  top?: number;
  bottom?: number;
  right: number;
}

const MENU_HEIGHT = 138;
const MENU_GAP = 6;
const MENU_MARGIN = 8;

export default function CourseCard({ course, onOpen, onRename, onRescan, onRelocate, onDelete }: CourseCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  // Give the pointer a moment to travel from the button to the portal menu.
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setMenuOpen(false);
    }, 220);
  }, [cancelClose]);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openAbove = spaceBelow < MENU_HEIGHT + MENU_GAP + MENU_MARGIN;
    setPosition({
      top: openAbove ? undefined : rect.bottom + MENU_GAP,
      bottom: openAbove ? window.innerHeight - rect.top + MENU_GAP : undefined,
      right: Math.max(MENU_MARGIN, window.innerWidth - rect.right)
    });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [menuOpen, updatePosition]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const closeOnViewportChange = () => setMenuOpen(false);

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', closeOnViewportChange, true);
    window.addEventListener('resize', closeOnViewportChange);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', closeOnViewportChange, true);
      window.removeEventListener('resize', closeOnViewportChange);
    };
  }, [menuOpen]);

  useEffect(() => cancelClose, [cancelClose]);

  const closeMenu = () => {
    cancelClose();
    setMenuOpen(false);
  };

  const menuStyle: CSSProperties = position
    ? { top: position.top, bottom: position.bottom, right: position.right }
    : { visibility: 'hidden' };

  return (
    <article className="course-card" onClick={() => onOpen(course.id)} onMouseLeave={scheduleClose} onMouseEnter={cancelClose}>
      <div className="course-cover" style={{ backgroundImage: courseGradient(course.title) }}>
        <div className="course-cover-glow" />
        <span className="course-cover-initials">{initials(course.title)}</span>
        <div className="course-cover-top">
          {course.review_count > 0 && (
            <span className="cover-chip review"><Flag size={12} /> {course.review_count}</span>
          )}
          <div className="card-menu-wrap" onClick={(event) => event.stopPropagation()}>
            <button
              ref={buttonRef}
              className={cn('cover-menu-btn', menuOpen && 'open')}
              onClick={() => {
                cancelClose();
                setMenuOpen((value) => !value);
              }}
              aria-label="Course options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreVertical size={16} />
            </button>
          </div>
        </div>
        <button className="cover-play" aria-label={`Open ${course.title}`}>
          <Play size={20} fill="currentColor" />
        </button>
        <div className="course-cover-footer">
          <span className="cover-tag">{course.completed_count}/{course.lecture_count} lectures</span>
        </div>
      </div>

      <div className="course-card-body">
        <h3 title={course.title}>{course.title}</h3>
        <div className="course-card-meta">
          <span><Clock3 size={13} /> {formatHours(course.watched_duration)} of {formatHours(course.total_duration)}</span>
          <span className="course-card-percent">{formatPercent(course.progress)}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${course.progress}%` }} />
        </div>
      </div>

      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="card-menu"
          style={menuStyle}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <button role="menuitem" onClick={() => { closeMenu(); onRename(course); }}>
            <Pencil size={14} /> Rename course
          </button>
          <button role="menuitem" onClick={() => { closeMenu(); onRescan(course); }}>
            <RefreshCw size={14} /> Rescan folder
          </button>
          <button role="menuitem" onClick={() => { closeMenu(); onRelocate(course); }}>
            <FolderOpen size={14} /> Locate folder
          </button>
          <button role="menuitem" className="danger" onClick={() => { closeMenu(); onDelete(course); }}>
            <Trash2 size={14} /> Remove course
          </button>
        </div>,
        document.body
      )}
    </article>
  );
}
