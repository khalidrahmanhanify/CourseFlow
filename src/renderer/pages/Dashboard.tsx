import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Clock3,
  Flag,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react';
import CourseCard from '../components/CourseCard';
import ConsistencyCard from '../components/ConsistencyCard';
import ProgressRing from '../components/ProgressRing';
import { ConfirmDialog, RenameDialog } from '../components/Modal';
import type { ActivityDay, Course, Stats, ToastType } from '../types';
import { formatHours, formatPercent, formatRelative, pluralize } from '../utils';

interface DashboardProps {
  stats: Stats | null;
  dataVersion: number;
  importing: boolean;
  onImport: () => void;
  onOpenCourse: (courseId: string) => void;
  onOpenLecture: (courseId: string, lectureId: string) => void;
  onOpenReview: () => void;
  notify: (message: string, type?: ToastType) => void;
  onDataChanged: () => void;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard({
  stats,
  dataVersion,
  importing,
  onImport,
  onOpenCourse,
  onOpenLecture,
  onOpenReview,
  notify,
  onDataChanged
}: DashboardProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [activity, setActivity] = useState<ActivityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);
  const [renameTarget, setRenameTarget] = useState<Course | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadCourses = useCallback(async () => {
    try {
      setCourses(await window.api.getCourses());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCourses();
  }, [loadCourses, dataVersion]);

  useEffect(() => {
    window.api.getActivity().then(setActivity).catch(() => undefined);
  }, [dataVersion]);

  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((course) => course.title.toLowerCase().includes(q));
  }, [courses, query]);

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const handleRescan = async (course: Course) => {
    setBusyId(course.id);
    try {
      const result = await window.api.scanCourse(course.id);
      if (!result.success) {
        notify(result.error || 'Could not rescan this course', 'error');
        return;
      }
      notify(result.added ? `Found ${pluralize(result.added, 'new lecture')}` : 'No new lectures found', 'info');
      await loadCourses();
      onDataChanged();
    } finally {
      setBusyId(null);
    }
  };

  const handleRelocate = async (course: Course) => {
    const folder = await window.api.selectFolder(`Locate the folder for "${course.title}"`);
    if (!folder) return;
    setBusyId(course.id);
    try {
      const result = await window.api.relocateCourse(course.id, folder);
      if (!result.success) {
        notify(result.error || 'Could not relocate this course', 'error');
        return;
      }
      if (result.missing && result.missing > 0) {
        notify(
          `Folder updated, but ${pluralize(result.missing, 'lecture file')} could not be found. Try Rescan folder.`,
          'info'
        );
      } else {
        notify(`"${course.title}" now points at ${folder}`, 'success');
      }
      await loadCourses();
      onDataChanged();
    } catch {
      notify('Could not relocate this course', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await window.api.deleteCourse(deleteTarget.id);
    notify(`Removed "${deleteTarget.title}" from your library`, 'info');
    setDeleteTarget(null);
    await loadCourses();
    onDataChanged();
  };

  const handleRename = async (name: string) => {
    if (!renameTarget) return;
    const result = await window.api.renameCourse(renameTarget.id, name);
    if (!result.success) {
      notify(result.error || 'Could not rename this course', 'error');
      return;
    }
    notify(`Course renamed to "${result.title ?? name}"`, 'success');
    setRenameTarget(null);
    await loadCourses();
    onDataChanged();
  };

  const continueLecture = stats?.continueLecture;
  const recent = (stats?.recent ?? []).filter((item) => item.lecture_title);
  const lecturePercentWatched = continueLecture ? continueLecture.percent : 0;
  const coursePercent = continueLecture ? continueLecture.course_progress ?? 0 : 0;

  return (
    <div className="page dashboard-page">
      <div className="page-top">
        <div>
          <p className="eyebrow">{today}</p>
          <h1 className="page-title">{greeting()}</h1>
          <p className="page-subtitle">Pick up where you left off, or explore your library.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={onImport} disabled={importing}>
            {importing ? <Loader2 size={17} className="spin" /> : <Plus size={17} />}
            {importing ? 'Importing...' : 'Import course'}
          </button>
        </div>
      </div>

      {continueLecture ? (
        <section className="hero-card">
          <div className="hero-glow" />
          <div className="hero-body">
            <span className="hero-kicker"><Sparkles size={14} /> Continue learning</span>
            <h2>{continueLecture.course_title}</h2>
            <p className="hero-lecture">
              {continueLecture.section_title ? `${continueLecture.section_title} · ` : ''}
              {continueLecture.title}
            </p>
            <div className="hero-progress">
              <div className="progress-track large">
                <div className="progress-fill" style={{ width: `${coursePercent}%` }} />
              </div>
              <span>
                {formatPercent(coursePercent)}% watched
                {' · '}{formatHours(continueLecture.course_watched)} of {formatHours(continueLecture.course_duration)}
                {' · '}{continueLecture.course_completed} of {continueLecture.course_total} lectures done
              </span>
            </div>
            <p className="hero-lecture-note">
              {lecturePercentWatched > 0
                ? `Last lecture is ${formatPercent(lecturePercentWatched)}% watched — pick up from there or open the course overview.`
                : 'A fresh lecture is waiting for you.'}
            </p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg" onClick={() => onOpenLecture(continueLecture.course_id, continueLecture.id)}>
                <Play size={17} fill="currentColor" /> {lecturePercentWatched > 0 ? 'Resume lecture' : 'Start course'}
              </button>
              <button className="btn btn-ghost btn-lg" onClick={() => onOpenCourse(continueLecture.course_id)}>
                <LayoutGrid size={16} /> Course overview
              </button>
            </div>
          </div>
          <div className="hero-visual">
            <ProgressRing value={coursePercent} size={126} stroke={9} subLabel="watched" />
          </div>
        </section>
      ) : courses.length > 0 ? (
        <section className="hero-card complete">
          <div className="hero-glow" />
          <div className="hero-body">
            <span className="hero-kicker"><CheckCircle2 size={14} /> All caught up</span>
            <h2>You finished every lecture</h2>
            <p className="hero-lecture">Nice work. Import a new course or revisit something you marked for review.</p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg" onClick={onImport}><Plus size={17} /> Import course</button>
              {stats && stats.needsReview > 0 && (
                <button className="btn btn-ghost btn-lg" onClick={onOpenReview}><Flag size={16} /> Review later ({stats.needsReview})</button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <section className="hero-card empty-hero">
          <div className="hero-glow" />
          <div className="hero-body">
            <span className="hero-kicker"><FolderOpen size={14} /> Your library is empty</span>
            <h2>Bring your first course in</h2>
            <p className="hero-lecture">Choose a folder of videos. Sections, lectures, and subtitles are detected automatically.</p>
            <div className="hero-actions">
              <button className="btn btn-primary btn-lg" onClick={onImport}><Plus size={17} /> Import your first course</button>
            </div>
          </div>
        </section>
      )}

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon indigo"><BookOpen size={19} /></div>
          <div><strong>{stats?.totalCourses ?? '—'}</strong><span>Courses</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon sky"><Play size={19} /></div>
          <div><strong>{stats?.totalLectures ?? '—'}</strong><span>Lectures</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle2 size={19} /></div>
          <div><strong>{stats?.completed ?? '—'}</strong><span>Completed</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber"><Clock3 size={19} /></div>
          <div><strong>{stats?.inProgress ?? '—'}</strong><span>In progress</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon rose"><Flag size={19} /></div>
          <div><strong>{stats?.needsReview ?? '—'}</strong><span>Review later</span></div>
        </div>
      </section>

      {stats && stats.needsReview > 0 && (
        <button className="review-banner" onClick={onOpenReview}>
          <span className="review-banner-icon"><Flag size={17} /></span>
          <span className="review-banner-text">
            <strong>{pluralize(stats.needsReview, 'lecture')} marked for review</strong>
            <span>Revisit the parts that were tricky while they are still fresh.</span>
          </span>
          <span className="btn btn-ghost btn-sm">Open review queue</span>
        </button>
      )}

      <ConsistencyCard days={activity} />

      <div className="section-heading">
        <div>
          <h2>Your courses</h2>
          <p>{courses.length > 0 ? pluralize(courses.length, 'course') + ' in your library' : 'Everything you import stays on this device'}</p>
        </div>
        {courses.length > 0 && (
          <div className="inline-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter courses..." />
          </div>
        )}
      </div>

      {loading && courses.length === 0 ? (
        <div className="course-grid">
          {[1, 2, 3].map((key) => <div key={key} className="course-card skeleton" />)}
        </div>
      ) : filteredCourses.length > 0 ? (
        <div className="course-grid">
          {filteredCourses.map((course) => (
            <CourseCard
              key={course.id}
              course={course}
              onOpen={onOpenCourse}
              onRename={setRenameTarget}
              onRescan={handleRescan}
              onRelocate={handleRelocate}
              onDelete={setDeleteTarget}
            />
          ))}
          <button className="import-card" onClick={onImport} disabled={importing}>
            <span className="import-card-icon"><Plus size={24} /></span>
            <strong>Import another course</strong>
            <span>Pick a folder of videos to add.</span>
          </button>
        </div>
      ) : courses.length > 0 ? (
        <div className="empty-panel small">
          <Search size={22} />
          <h3>No courses match “{query}”</h3>
          <button className="btn btn-ghost" onClick={() => setQuery('')}>Clear filter</button>
        </div>
      ) : null}

      {recent.length > 0 && (
        <section className="recent-section">
          <div className="section-heading">
            <div>
              <h2>Recently watched</h2>
              <p>Jump back into your latest activity</p>
            </div>
          </div>
          <div className="recent-list">
            {recent.map((item) => (
              <button
                key={item.id}
                className="recent-item"
                onClick={() => onOpenLecture(item.course_id, item.lecture_id)}
              >
                <span className="recent-icon"><Play size={15} /></span>
                <span className="recent-main">
                  <strong>{item.lecture_title}</strong>
                  <span>{item.course_title}</span>
                </span>
                <span className="recent-time">{formatRelative(item.watched_at)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Remove "${deleteTarget?.title ?? 'course'}"?`}
        description="The course is removed from your library. Your video files stay untouched on disk."
        confirmLabel="Remove course"
        danger
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />

      <RenameDialog
        open={Boolean(renameTarget)}
        currentName={renameTarget?.title ?? ''}
        onRename={handleRename}
        onClose={() => setRenameTarget(null)}
      />

      {busyId && (
        <div className="busy-pill"><Loader2 size={14} className="spin" /> Scanning folder...</div>
      )}
    </div>
  );
}
