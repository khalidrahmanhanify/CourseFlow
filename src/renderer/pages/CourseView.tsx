import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Flag,
  FolderOpen,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react';
import ProgressRing from '../components/ProgressRing';
import { ConfirmDialog, RenameDialog } from '../components/Modal';
import { useSectionExpansion } from '../hooks/useSectionExpansion';
import type { CourseDetail, Lecture, ToastType } from '../types';
import {
  cn,
  courseGradient,
  courseTimeProgress,
  flattenCourse,
  formatHours,
  formatPercent,
  formatTime,
  initials,
  isComplete,
  lectureDurationSeconds,
  lecturePercent,
  lectureWatchedSeconds,
  parseList,
  pluralize
} from '../utils';

interface CourseViewProps {
  data: CourseDetail;
  onBack: () => void;
  onPlay: (lectureId: string) => void;
  onRefresh: () => Promise<void>;
  onLecturePatch: (lectureId: string, patch: Partial<Lecture>) => void;
  onStatsRefresh: () => void;
  onDeleted: () => void;
  notify: (message: string, type?: ToastType) => void;
}

export default function CourseView({
  data,
  onBack,
  onPlay,
  onRefresh,
  onLecturePatch,
  onStatsRefresh,
  onDeleted,
  notify
}: CourseViewProps) {
  const [query, setQuery] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busyLectureId, setBusyLectureId] = useState<string | null>(null);

  const flat = useMemo(() => flattenCourse(data), [data]);
  const total = flat.length;
  const completed = flat.filter(({ lecture }) => isComplete(lecture)).length;
  const reviewCount = flat.filter(({ lecture }) => lecture.needs_review === 1).length;
  const courseTime = useMemo(() => courseTimeProgress(data.sections), [data.sections]);
  const progress = courseTime.percent;
  const nextEntry = flat.find(({ lecture }) => !isComplete(lecture)) ?? flat[0] ?? null;
  const nextUp = nextEntry?.lecture;

  const sectionIds = useMemo(() => data.sections.map((section) => section.id), [data.sections]);
  const sectionExpansion = useSectionExpansion(data.course.id, sectionIds, nextEntry?.section.id ?? null);

  const normalized = query.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    if (!normalized) return data.sections;
    return data.sections
      .map((section) => ({
        ...section,
        lectures: section.lectures.filter((lecture) =>
          lecture.title.toLowerCase().includes(normalized) || section.title.toLowerCase().includes(normalized)
        )
      }))
      .filter((section) => section.lectures.length > 0);
  }, [data.sections, normalized]);

  const visibleCount = visibleSections.reduce((sum, section) => sum + section.lectures.length, 0);

  const toggleComplete = async (lecture: Lecture) => {
    if (busyLectureId) return;
    const nextCompleted = !isComplete(lecture);
    setBusyLectureId(lecture.id);
    try {
      await window.api.markComplete(lecture.id, nextCompleted);
      // Reload so the list reflects the real watched coverage (un-marking no
      // longer trims it to a synthetic threshold-minus-one percentage).
      await onRefresh();
      onStatsRefresh();
      notify(nextCompleted ? `Completed “${lecture.title}”` : `Marked “${lecture.title}” as not complete`, nextCompleted ? 'success' : 'info');
    } finally {
      setBusyLectureId(null);
    }
  };

  const toggleReview = async (lecture: Lecture) => {
    const nextReview = lecture.needs_review !== 1;
    await window.api.setLectureReview(lecture.id, nextReview);
    onLecturePatch(lecture.id, { needs_review: nextReview ? 1 : 0 });
    onStatsRefresh();
    notify(nextReview ? 'Saved for review later' : 'Removed from review later', nextReview ? 'info' : 'success');
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const result = await window.api.scanCourse(data.course.id);
      if (!result.success) {
        notify(result.error || 'Could not rescan this folder', 'error');
        return;
      }
      notify(result.added ? `Found ${pluralize(result.added, 'new lecture')}` : 'No new lectures found', 'info');
      await onRefresh();
    } finally {
      setRescanning(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await window.api.deleteCourse(data.course.id);
      notify(`Removed “${data.course.title}” from your library`, 'info');
      onDeleted();
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const handleRename = async (name: string) => {
    const result = await window.api.renameCourse(data.course.id, name);
    if (!result.success) {
      notify(result.error || 'Could not rename this course', 'error');
      return;
    }
    setRenameOpen(false);
    notify(`Course renamed to “${result.title ?? name}”`, 'success');
    await onRefresh();
  };

  return (
    <div className="page course-page">
      <div className="course-topbar">
        <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Back to dashboard</button>
        <div className="course-topbar-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setRenameOpen(true)} title="Rename course">
            <Pencil size={15} /> Rename
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleRescan} disabled={rescanning}>
            {rescanning ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            {rescanning ? 'Scanning...' : 'Rescan folder'}
          </button>
          <button className="btn btn-ghost btn-sm btn-icon-only danger-hover" onClick={() => setDeleteOpen(true)} title="Remove course">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <section className="course-hero">
        <div className="course-hero-glow" />
        <div className="course-hero-cover" style={{ backgroundImage: courseGradient(data.course.title) }}>
          <span>{initials(data.course.title)}</span>
        </div>
        <div className="course-hero-content">
          <p className="eyebrow">Course</p>
          <h1>{data.course.title}</h1>
          <p className="course-path" title={data.course.folder_path}><FolderOpen size={13} /> {data.course.folder_path}</p>
          <div className="chip-row">
            <span className="chip">{pluralize(total, 'lecture')}</span>
            <span className="chip ghost"><Clock3 size={13} /> {formatHours(courseTime.totalDuration)} of video</span>
            <span className="chip success"><CheckCircle2 size={13} /> {completed} complete</span>
            {reviewCount > 0 && <span className="chip warn"><Flag size={13} /> {reviewCount} to review</span>}
            <span className="chip ghost">{data.sections.length} sections</span>
          </div>
          <div className="course-hero-progress">
            <div className="progress-track large">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{formatPercent(progress)}% · {formatHours(courseTime.watchedDuration)} watched</span>
          </div>
          <div className="course-hero-actions">
            <button className="btn btn-primary" onClick={() => nextUp && onPlay(nextUp.id)} disabled={!nextUp}>
              <Play size={16} fill="currentColor" /> {completed === 0 ? 'Start course' : 'Continue watching'}
            </button>
            {nextUp && <span className="next-hint">Up next: <strong>{nextUp.title}</strong></span>}
          </div>
        </div>
        <div className="course-hero-ring">
          <ProgressRing value={progress} size={124} stroke={9} subLabel="watched" />
        </div>
      </section>

      <div className="content-toolbar">
        <div className="inline-search wide">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lectures in this course..."
          />
          {query && <button className="clear-search" onClick={() => setQuery('')}>Clear</button>}
        </div>
        <div className="toolbar-meta">
          <span>{normalized ? `${visibleCount} of ${total} lectures` : pluralize(total, 'lecture')}</span>
          <button className="link-btn" onClick={() => sectionExpansion.expandAll()}>Expand all</button>
          <button className="link-btn" onClick={() => sectionExpansion.collapseAll()}>Collapse all</button>
        </div>
      </div>

      {visibleSections.length === 0 ? (
        <div className="empty-panel">
          <Search size={24} />
          <h3>No lectures match “{query}”</h3>
          <p>Try another keyword or clear the search.</p>
          <button className="btn btn-ghost" onClick={() => setQuery('')}>Clear search</button>
        </div>
      ) : (
        <div className="section-stack">
          {visibleSections.map((section, sectionIndex) => {
            const sectionTime = courseTimeProgress([section]);
            const sectionCompleted = sectionTime.completed;
            const sectionPercent = sectionTime.percent;
            const isCollapsed = !sectionExpansion.isExpanded(section.id) && !normalized;
            const isFocusSection = nextEntry?.section.id === section.id;

            return (
              <section className={cn('section-card', isFocusSection && 'focus')} key={section.id}>
                <button
                  className="section-header"
                  onClick={() => sectionExpansion.toggle(section.id)}
                  aria-expanded={!isCollapsed}
                >
                  <span className="section-number">{String(sectionIndex + 1).padStart(2, '0')}</span>
                  <span className="section-heading-text">
                    <strong>{section.title}</strong>
                    <span className="section-sub">
                      <span>{sectionCompleted}/{section.lectures.length} complete</span>
                      <span className="section-dot" />
                      <span>{formatHours(sectionTime.watchedDuration)} of {formatHours(sectionTime.totalDuration)}</span>
                    </span>
                  </span>
                  <span className="section-progress">
                    <span className="section-progress-value">{formatPercent(sectionPercent)}%</span>
                    <span className="progress-track small"><span className="progress-fill" style={{ width: `${sectionPercent}%` }} /></span>
                  </span>
                  <ChevronDown size={17} className={cn('section-chevron', isCollapsed && 'collapsed')} />
                </button>

                {!isCollapsed && (
                  <div className="lecture-list">
                    {section.lectures.map((lecture, lectureIndex) => {
                      const done = isComplete(lecture);
                      const percent = lecturePercent(lecture);
                      const watchedSeconds = lectureWatchedSeconds(lecture);
                      const durationSeconds = lectureDurationSeconds(lecture);
                      const resources = parseList(lecture.resources);
                      const subtitles = parseList(lecture.subtitle_paths);
                      const isNext = nextUp?.id === lecture.id;
                      const busy = busyLectureId === lecture.id;

                      return (
                        <div
                          key={lecture.id}
                          className={cn('lecture-row', done && 'done', isNext && 'next')}
                          role="button"
                          tabIndex={0}
                          onClick={() => onPlay(lecture.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onPlay(lecture.id);
                            }
                          }}
                        >
                          <button
                            className={cn('complete-toggle', done && 'checked', isNext && 'next')}
                            onClick={(event) => { event.stopPropagation(); toggleComplete(lecture); }}
                            title={done ? 'Mark as not complete' : 'Mark as complete'}
                            aria-label={done ? 'Mark as not complete' : 'Mark as complete'}
                            disabled={busy}
                          >
                            {busy ? (
                              <Loader2 size={14} className="spin" />
                            ) : done ? (
                              <Check size={14} strokeWidth={3} />
                            ) : (
                              <span className="lecture-index">{String(lectureIndex + 1).padStart(2, '0')}</span>
                            )}
                          </button>

                          <div className="lecture-main">
                            <div className="lecture-title-row">
                              <h4>{lecture.title}</h4>
                              {isNext && <span className="chip tiny accent"><CircleDot size={11} /> Next up</span>}
                              {lecture.needs_review === 1 && <span className="chip tiny warn"><Flag size={11} /> Review</span>}
                            </div>
                            <div className="lecture-sub">
                              {done ? (
                                <span className="sub-complete">Completed</span>
                              ) : watchedSeconds > 0 ? (
                                <>
                                  <span>{formatPercent(percent)}% studied</span>
                                  <span>· {formatTime(watchedSeconds)} of {formatTime(durationSeconds)}</span>
                                </>
                              ) : (
                                <span>Not started</span>
                              )}
                              {subtitles.length > 0 && <span>· {pluralize(subtitles.length, 'subtitle')}</span>}
                              {resources.length > 0 && <span>· {pluralize(resources.length, 'resource')}</span>}
                            </div>
                          </div>

                          <div className="lecture-tail">
                            <span className="lecture-duration">
                              {durationSeconds > 0 ? formatTime(durationSeconds) : ''}
                            </span>
                            <div className="lecture-actions" onClick={(event) => event.stopPropagation()}>
                              <button
                                className={cn('icon-btn small', lecture.needs_review === 1 && 'is-warn')}
                                onClick={() => toggleReview(lecture)}
                                title={lecture.needs_review === 1 ? 'Remove from review later' : 'Save for review later'}
                              >
                                <Flag size={15} fill={lecture.needs_review === 1 ? 'currentColor' : 'none'} />
                              </button>
                              <button className="icon-btn small play" onClick={() => onPlay(lecture.id)} title="Play lecture">
                                <Play size={15} fill="currentColor" />
                              </button>
                            </div>
                          </div>

                          {!done && percent > 0 && (
                            <span className="lecture-progress" aria-hidden="true">
                              <span style={{ width: `${percent}%` }} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title={`Remove "${data.course.title}"?`}
        description="This removes the course and its progress from your library. Video files on disk are not deleted."
        confirmLabel={deleting ? 'Removing...' : 'Remove course'}
        danger
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />

      <RenameDialog
        open={renameOpen}
        currentName={data.course.title}
        onRename={handleRename}
        onClose={() => setRenameOpen(false)}
      />
    </div>
  );
}
