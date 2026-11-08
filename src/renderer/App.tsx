import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Minimize2 } from 'lucide-react';
import Sidebar, { type NavTarget } from './components/Sidebar';
import TitleBar from './components/TitleBar';
import CommandPalette from './components/CommandPalette';
import ToastStack, { type ToastItem } from './components/Toast';
import Dashboard from './pages/Dashboard';
import CourseView from './pages/CourseView';
import Player from './pages/Player';
import Review from './pages/Review';
import SettingsPage from './pages/Settings';
import type { CourseDetail, Lecture, Settings, Stats, ToastType, WindowState } from './types';

type View =
  | { name: 'dashboard' }
  | { name: 'course'; courseId: string }
  | { name: 'player'; courseId: string; lectureId: string }
  | { name: 'review' }
  | { name: 'settings' };

const DEFAULT_SETTINGS: Settings = {
  theme: 'minimal',
  autoplay: true,
  completionThreshold: 90,
  playbackRate: 1,
  captionSize: 100,
  captionColor: '#ffffff',
  captionBg: 55
};

function App() {
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [courseData, setCourseData] = useState<CourseDetail | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<Stats | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [windowState, setWindowState] = useState<WindowState>({ maximized: false, fullscreen: false });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('courseflow.sidebar') === '1');
  const [importing, setImporting] = useState(false);
  const [loadingCourse, setLoadingCourse] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const toastCounter = useRef(0);

  const notify = useCallback((message: string, type: ToastType = 'success') => {
    const id = (toastCounter.current += 1);
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await window.api.getStats());
    } catch {
      // Stats are non-critical; keep the previous values.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.api.getSettings().then((loaded) => {
      if (!cancelled) setSettings({ ...DEFAULT_SETTINGS, ...loaded });
    });
    refreshStats();

    window.api.getWindowState().then(setWindowState);
    const unsubscribe = window.api.onWindowState(setWindowState);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshStats]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // Record time genuinely spent in the app, separate from video playback.
  // Visible + focused time only, and only while the user is actually active
  // (recent input) or a video is playing. Leaving the app open and idle no
  // longer inflates the consistency calendar.
  useEffect(() => {
    let last = Date.now();
    let lastInteraction = Date.now();
    let active = document.visibilityState === 'visible' && document.hasFocus();

    const markInteraction = () => {
      lastInteraction = Date.now();
    };

    const videoPlaying = () => {
      const video = document.querySelector('video');
      return video instanceof HTMLVideoElement
        && !video.paused
        && !video.ended
        && video.readyState >= 2;
    };

    const tick = () => {
      const now = Date.now();
      const elapsed = Math.max(0, (now - last) / 1000);
      last = now;
      // Count the interval that just ended if the app was active for it, but
      // only when there was recent input or a video was playing.
      if (active && elapsed >= 1) {
        const recentlyActive = now - lastInteraction < 30000;
        if (recentlyActive || videoPlaying()) {
          window.api.addAppActivity(Math.min(elapsed, 60)).catch(() => undefined);
        }
      }
      active = document.visibilityState === 'visible' && document.hasFocus();
    };

    const interactionEvents = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of interactionEvents) {
      window.addEventListener(name, markInteraction, { passive: true });
    }
    window.addEventListener('focus', markInteraction);

    const timer = window.setInterval(tick, 5000);
    window.addEventListener('focus', tick);
    window.addEventListener('blur', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      tick();
      window.clearInterval(timer);
      for (const name of interactionEvents) {
        window.removeEventListener(name, markInteraction);
      }
      window.removeEventListener('focus', markInteraction);
      window.removeEventListener('focus', tick);
      window.removeEventListener('blur', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  // 'minimal' and 'warm' are light-tone palettes; 'dark' is the dark tone and
  // 'system' follows the OS. data-theme keeps the existing tone-specific
  // styles working while data-palette selects the colour palette.
  const palette = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
  const resolvedTheme: 'dark' | 'light' = palette === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.palette = palette;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, palette]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === 'F11') {
        event.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
        else window.api.toggleFullscreen();
        return;
      }
      if (event.key === 'Escape') {
        // Prevent the native "escape leaves OS fullscreen" default while a
        // video element is in HTML fullscreen: it desyncs the two fullscreen
        // layers and leaves the player covering a windowed app.
        if (document.fullscreenElement) {
          event.preventDefault();
          document.exitFullscreen().catch(() => undefined);
          return;
        }
        if (windowState.fullscreen) {
          event.preventDefault();
          window.api.toggleFullscreen();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [windowState.fullscreen]);

  // Safety net: if the OS window leaves fullscreen while a video element is
  // still in HTML fullscreen (e.g. a native gesture), unwind the HTML layer so
  // the app cannot be left with a full-screen video but no window chrome.
  useEffect(() => {
    if (!document.fullscreenElement || windowState.fullscreen) return;
    const timer = window.setTimeout(() => {
      if (document.fullscreenElement && !windowState.fullscreen) {
        document.exitFullscreen().catch(() => undefined);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [windowState.fullscreen]);

  const leaveFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else window.api.toggleFullscreen();
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    await Promise.all(Object.entries(patch).map(([key, value]) => window.api.setSetting(key, value)));
  }, []);

  const openCourse = useCallback(async (courseId: string) => {
    setLoadingCourse(true);
    try {
      const data = await window.api.getCourse(courseId);
      if (!data) {
        notify('This course could not be loaded', 'error');
        return;
      }
      setCourseData(data);
      setView({ name: 'course', courseId });
    } finally {
      setLoadingCourse(false);
    }
  }, [notify]);

  const openLecture = useCallback(async (courseId: string, lectureId: string) => {
    setLoadingCourse(true);
    try {
      const data = courseData?.course.id === courseId ? courseData : await window.api.getCourse(courseId);
      if (!data) {
        notify('This lecture could not be loaded', 'error');
        return;
      }
      setCourseData(data);
      setView({ name: 'player', courseId, lectureId });
    } finally {
      setLoadingCourse(false);
    }
  }, [courseData, notify]);

  const handleImport = useCallback(async () => {
    if (importing) return;
    const folder = await window.api.selectFolder();
    if (!folder) return;

    setImporting(true);
    try {
      const result = await window.api.importCourse(folder);
      if (!result.success || !result.courseId) {
        notify(result.error || 'Could not import that folder', 'error');
        return;
      }
      notify(result.alreadyImported ? 'That course is already in your library' : 'Course imported successfully');
      await refreshStats();
      setDataVersion((value) => value + 1);
      await openCourse(result.courseId);
    } catch {
      notify('Could not import that folder', 'error');
    } finally {
      setImporting(false);
    }
  }, [importing, notify, openCourse, refreshStats]);

  const patchLecture = useCallback((lectureId: string, patch: Partial<Lecture>) => {
    setCourseData((current) => {
      if (!current) return current;
      return {
        ...current,
        sections: current.sections.map((section) => ({
          ...section,
          lectures: section.lectures.map((lecture) => (lecture.id === lectureId ? { ...lecture, ...patch } : lecture))
        }))
      };
    });
  }, []);

  const refreshCourse = useCallback(async (courseId: string) => {
    const data = await window.api.getCourse(courseId);
    if (data) setCourseData(data);
    await refreshStats();
    setDataVersion((value) => value + 1);
  }, [refreshStats]);

  const handleNavigate = useCallback((target: NavTarget) => {
    setView({ name: target } as View);
    refreshStats();
    if (target !== 'dashboard') setDataVersion((value) => value + 1);
  }, [refreshStats]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem('courseflow.sidebar', next ? '1' : '0');
      return next;
    });
  }, []);

  const titleBar = useMemo(() => {
    switch (view.name) {
      case 'dashboard':
        return { title: 'Dashboard', subtitle: 'Library overview' };
      case 'review':
        return { title: 'Review later', subtitle: `${stats?.needsReview ?? 0} saved` };
      case 'settings':
        return { title: 'Settings', subtitle: 'Preferences' };
      case 'course':
        return { title: courseData?.course.title ?? 'Course', subtitle: 'Course content' };
      case 'player': {
        const lecture = courseData?.sections.flatMap((section) => section.lectures).find((item) => item.id === view.lectureId);
        return { title: courseData?.course.title ?? 'Player', subtitle: lecture?.title };
      }
      default:
        return { title: 'CourseFlow' };
    }
  }, [view, courseData, stats?.needsReview]);

  const immersive = windowState.fullscreen && view.name === 'player';

  return (
    <div className={`app-shell${immersive ? ' immersive' : ''}`}>
      <Sidebar
        view={view.name}
        stats={stats}
        collapsed={collapsed}
        importing={importing}
        onToggleCollapse={toggleSidebar}
        onNavigate={handleNavigate}
        onImport={handleImport}
      />

      <div className="app-column">
        {!windowState.fullscreen && (
          <TitleBar
            title={titleBar.title}
            subtitle={titleBar.subtitle}
            resolvedTheme={resolvedTheme}
            maximized={windowState.maximized}
            onSearch={() => setPaletteOpen(true)}
            onToggleTheme={() => updateSettings({ theme: palette === 'dark' ? 'minimal' : 'dark' })}
            onToggleFullscreen={() => window.api.toggleFullscreen()}
            onMinimize={() => window.api.minimize()}
            onToggleMaximize={() => window.api.toggleMaximize()}
            onClose={() => window.api.closeWindow()}
          />
        )}

        <main className={`content view-${view.name}`}>
          {view.name === 'dashboard' && (
            <Dashboard
              stats={stats}
              dataVersion={dataVersion}
              importing={importing}
              onImport={handleImport}
              onOpenCourse={openCourse}
              onOpenLecture={openLecture}
              onOpenReview={() => handleNavigate('review')}
              notify={notify}
              onDataChanged={() => { setDataVersion((value) => value + 1); refreshStats(); }}
            />
          )}

          {view.name === 'course' && courseData && (
            <CourseView
              data={courseData}
              onBack={() => setView({ name: 'dashboard' })}
              onPlay={(lectureId) => openLecture(courseData.course.id, lectureId)}
              onRefresh={() => refreshCourse(courseData.course.id)}
              onLecturePatch={patchLecture}
              onStatsRefresh={refreshStats}
              onDeleted={() => {
                setCourseData(null);
                setView({ name: 'dashboard' });
                setDataVersion((value) => value + 1);
                refreshStats();
              }}
              notify={notify}
            />
          )}

          {view.name === 'player' && courseData && (
            <Player
              data={courseData}
              lectureId={view.lectureId}
              settings={settings}
              onBack={() => openCourse(view.courseId)}
              onNavigate={(lectureId) => setView({ name: 'player', courseId: view.courseId, lectureId })}
              onLecturePatch={patchLecture}
              onStatsRefresh={refreshStats}
              onSettingsChange={updateSettings}
              notify={notify}
            />
          )}

          {view.name === 'review' && (
            <Review
              dataVersion={dataVersion}
              onOpenLecture={openLecture}
              onDataChanged={() => { setDataVersion((value) => value + 1); refreshStats(); }}
              notify={notify}
            />
          )}

          {view.name === 'settings' && (
            <SettingsPage
              settings={settings}
              onChange={updateSettings}
              onImport={handleImport}
              importing={importing}
              notify={notify}
            />
          )}

          {loadingCourse && (
            <div className="loading-overlay">
              <Loader2 size={22} className="spin" />
              <span>Loading course...</span>
            </div>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenLecture={openLecture}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {windowState.fullscreen && (
        <button className="floating-exit" onClick={leaveFullscreen} title="Exit fullscreen (F11 or Esc)">
          <Minimize2 size={15} /> Exit fullscreen
        </button>
      )}
    </div>
  );
}

export default App;
