import { useEffect, useState } from 'react';
import {
  Captions,
  Check,
  DatabaseBackup,
  Download,
  Flame,
  FolderOpen,
  FolderPlus,
  Gauge,
  GraduationCap,
  HardDrive,
  Info,
  Keyboard,
  Loader2,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload
} from 'lucide-react';
import { ConfirmDialog } from '../components/Modal';
import type { AppVersions, Settings, Stats, ToastType } from '../types';
import { cn, pluralize } from '../utils';

interface SettingsPageProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => Promise<void> | void;
  onImport: () => void;
  importing: boolean;
  notify: (message: string, type?: ToastType) => void;
}

const THEMES: Array<{ value: Settings['theme']; label: string; icon: typeof Sun; description: string }> = [
  { value: 'minimal', label: 'Minimal', icon: Sparkles, description: 'Neutral, quiet and easy to read' },
  { value: 'light', label: 'Light', icon: Sun, description: 'Crisp and bright for daytime' },
  { value: 'dark', label: 'Dark', icon: Moon, description: 'Easy on the eyes for evening sessions' },
  { value: 'warm', label: 'Warm', icon: Flame, description: 'Soft paper tones for long sessions' },
  { value: 'system', label: 'System', icon: Monitor, description: 'Follow your OS appearance' }
];

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const CAPTION_COLORS = ['#ffffff', '#fde047', '#34d399', '#60a5fa', '#f9a8d4'];

function collectPreferences() {
  const preferences: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith('courseflow.')) continue;
    const value = localStorage.getItem(key);
    if (value !== null) preferences[key] = value;
  }
  return preferences;
}

export default function SettingsPage({ settings, onChange, onImport, importing, notify }: SettingsPageProps) {
  const [versions, setVersions] = useState<AppVersions | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importingData, setImportingData] = useState(false);
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);

  useEffect(() => {
    window.api.getVersions().then(setVersions).catch(() => undefined);
    window.api.getStats().then(setStats).catch(() => undefined);
  }, []);

  const openDataFolder = async () => {
    setOpeningFolder(true);
    try {
      const error = await window.api.openDataFolder();
      if (error) notify('Could not open the data folder', 'error');
    } finally {
      setOpeningFolder(false);
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await window.api.exportData(collectPreferences());
      if (result.canceled) return;
      if (!result.success) {
        notify(result.error || 'Could not export your data', 'error');
        return;
      }
      notify(`Backup saved to ${result.path}`, 'success');
    } catch {
      notify('Could not export your data', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImportData = async () => {
    if (importingData) return;
    setConfirmImportOpen(false);
    setImportingData(true);
    try {
      const result = await window.api.importData();
      if (result.canceled) return;
      if (!result.success) {
        notify(result.error || 'Could not import that backup', 'error');
        return;
      }

      for (const [key, value] of Object.entries(result.preferences ?? {})) {
        if (key.startsWith('courseflow.')) {
          try {
            localStorage.setItem(key, value);
          } catch {
            // Preferences are a convenience; the database is the important part.
          }
        }
      }

      const missing = result.missingCourses ?? [];
      let lost = 0;
      for (const course of missing) {
        const folder = await window.api.selectFolder(`Locate the folder for "${course.title}"`);
        if (!folder) {
          lost += 1;
          continue;
        }
        const relocated = await window.api.relocateCourse(course.id, folder);
        if (!relocated.success) lost += 1;
      }

      const courseCount = result.counts?.courses ?? 0;
      const lectureCount = result.counts?.lectures ?? 0;
      if (lost > 0) {
        notify(
          `Imported ${pluralize(courseCount, 'course')} and ${pluralize(lectureCount, 'lecture')}. ${pluralize(lost, 'course')} still need the folder located — use the course menu.`,
          'info'
        );
      } else {
        notify(`Imported ${pluralize(courseCount, 'course')} and ${pluralize(lectureCount, 'lecture')}. Reloading...`, 'success');
      }

      window.setTimeout(() => window.location.reload(), 900);
    } catch {
      notify('Could not import that backup', 'error');
    } finally {
      setImportingData(false);
    }
  };

  const threshold = settings.completionThreshold ?? 90;
  const captionSize = Number(settings.captionSize) || 100;
  const captionColor = settings.captionColor || '#ffffff';
  const captionBg = Number.isFinite(Number(settings.captionBg)) ? Number(settings.captionBg) : 55;

  return (
    <div className="page settings-page">
      <div className="page-top">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Tune CourseFlow to how you like to learn. Changes save instantly.</p>
        </div>
        <div className="saved-pill"><Check size={13} /> Saved automatically</div>
      </div>

      <div className="settings-stack">
        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-icon"><Palette size={18} /></div>
            <div>
              <h2>Appearance</h2>
              <p>Choose the theme for the whole app.</p>
            </div>
          </header>
          <div className="theme-options">
            {THEMES.map((theme) => {
              const Icon = theme.icon;
              const active = settings.theme === theme.value;
              return (
                <button
                  key={theme.value}
                  className={cn('theme-option', active && 'active')}
                  onClick={() => onChange({ theme: theme.value })}
                >
                  <span className={cn('theme-preview', theme.value)}>
                    <span className="theme-preview-bar" />
                    <span className="theme-preview-body">
                      <span />
                      <span />
                    </span>
                  </span>
                  <span className="theme-option-text">
                    <strong><Icon size={15} /> {theme.label}</strong>
                    <span>{theme.description}</span>
                  </span>
                  {active && <span className="theme-check"><Check size={13} /></span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-icon"><Gauge size={18} /></div>
            <div>
              <h2>Playback</h2>
              <p>How lectures behave when you watch them.</p>
            </div>
          </header>

          <div className="setting-row">
            <div className="setting-copy">
              <strong>Autoplay next lecture</strong>
              <p>When a lecture ends, start the next one after a short countdown.</p>
            </div>
            <button
              className={cn('switch', settings.autoplay && 'on')}
              onClick={() => onChange({ autoplay: !settings.autoplay })}
              aria-label="Toggle autoplay"
            >
              <span />
            </button>
          </div>

          <div className="setting-row column">
            <div className="setting-copy">
              <strong>Auto-complete threshold</strong>
              <p>A lecture is marked complete after you have watched this much of it.</p>
            </div>
            <div className="threshold-control">
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={threshold}
                className="threshold-slider"
                style={{ '--seek-progress': `${((threshold - 50) / 50) * 100}%` } as React.CSSProperties}
                onChange={(event) => onChange({ completionThreshold: Number(event.target.value) })}
              />
              <span className="threshold-value">{threshold}%</span>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-copy">
              <strong>Default playback speed</strong>
              <p>Applied whenever a new lecture opens. You can still change it in the player.</p>
            </div>
            <div className="segmented">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  className={cn(settings.playbackRate === speed && 'active')}
                  onClick={() => onChange({ playbackRate: speed })}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-icon"><Captions size={18} /></div>
            <div>
              <h2>Caption appearance</h2>
              <p>How subtitles look in the player. Applies to every lecture.</p>
            </div>
          </header>

          <div className="caption-preview">
            <span
              className="caption-preview-line"
              style={{
                fontSize: `${Math.round(captionSize * 0.22)}px`,
                color: captionColor,
                background: `rgba(0, 0, 0, ${captionBg / 100})`
              }}
            >
              Captions look like this
            </span>
          </div>

          <div className="setting-row column">
            <div className="setting-copy">
              <strong>Caption size</strong>
              <p>Scale subtitle text without changing the video size.</p>
            </div>
            <div className="threshold-control">
              <input
                type="range"
                min={70}
                max={160}
                step={5}
                value={captionSize}
                className="threshold-slider"
                style={{ '--seek-progress': `${((captionSize - 70) / 90) * 100}%` } as React.CSSProperties}
                onChange={(event) => onChange({ captionSize: Number(event.target.value) })}
              />
              <span className="threshold-value">{captionSize}%</span>
            </div>
          </div>

          <div className="setting-row column">
            <div className="setting-copy">
              <strong>Background opacity</strong>
              <p>Darker boxes make captions easier to read over bright scenes.</p>
            </div>
            <div className="threshold-control">
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={captionBg}
                className="threshold-slider"
                style={{ '--seek-progress': `${(captionBg / 90) * 100}%` } as React.CSSProperties}
                onChange={(event) => onChange({ captionBg: Number(event.target.value) })}
              />
              <span className="threshold-value">{captionBg}%</span>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-copy">
              <strong>Caption color</strong>
              <p>Pick the text color that stays readable for you.</p>
            </div>
            <div className="caption-color-options">
              {CAPTION_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn('caption-color-dot', captionColor.toLowerCase() === color && 'active')}
                  style={{ background: color }}
                  onClick={() => onChange({ captionColor: color })}
                  aria-label={`Use ${color} for captions`}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-icon"><HardDrive size={18} /></div>
            <div>
              <h2>Library & storage</h2>
              <p>Everything is stored locally. Nothing leaves this device.</p>
            </div>
          </header>

          <div className="storage-summary">
            <div className="storage-stat">
              <GraduationCap size={16} />
              <div><strong>{stats?.totalCourses ?? '—'}</strong><span>Courses</span></div>
            </div>
            <div className="storage-stat">
              <FolderOpen size={16} />
              <div><strong>{stats?.totalLectures ?? '—'}</strong><span>Lectures</span></div>
            </div>
            <div className="storage-stat">
              <Check size={16} />
              <div><strong>{stats?.completed ?? '—'}</strong><span>Completed</span></div>
            </div>
          </div>

          <div className="setting-row">
            <div className="setting-copy">
              <strong>Import a course folder</strong>
              <p>Pick a folder of videos. Sections and subtitles are detected automatically.</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={onImport} disabled={importing}>
              {importing ? <Loader2 size={15} className="spin" /> : <FolderPlus size={15} />}
              {importing ? 'Importing...' : 'Import course'}
            </button>
          </div>

          <div className="setting-row">
            <div className="setting-copy">
              <strong>App data folder</strong>
              <p>Database, progress, notes, and moments live in this folder.</p>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={openDataFolder} disabled={openingFolder}>
              {openingFolder ? <Loader2 size={15} className="spin" /> : <FolderOpen size={15} />}
              Open folder
            </button>
          </div>
        </section>

        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-icon"><DatabaseBackup size={18} /></div>
            <div>
              <h2>Backup & transfer</h2>
              <p>Take your whole library to another computer, progress included.</p>
            </div>
          </header>

          <div className="backup-panel">
            <div className="backup-copy">
              <strong>One file with everything</strong>
              <p>
                Courses, sections, progress, notes, moments, review flags and your daily
                activity. Video files stay where they are — the backup points at them.
              </p>
            </div>
            <div className="backup-actions">
              <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={exporting || importingData}>
                {exporting ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                {exporting ? 'Exporting...' : 'Export data'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmImportOpen(true)}
                disabled={exporting || importingData}
              >
                {importingData ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
                {importingData ? 'Importing...' : 'Import data'}
              </button>
            </div>
          </div>

          <p className="backup-note">
            <ShieldCheck size={14} />
            Importing replaces the current library. CourseFlow saves a safety copy of the
            database first, and asks you to locate any course folders that moved.
          </p>
        </section>

        <section className="settings-card">
          <header className="settings-card-header">
            <div className="settings-icon"><Keyboard size={18} /></div>
            <div>
              <h2>Keyboard shortcuts</h2>
              <p>For when your hands never leave the keyboard.</p>
            </div>
          </header>
          <div className="shortcut-grid settings-shortcuts">
            {[
              ['Ctrl + K', 'Search every lecture'],
              ['Space / K', 'Play or pause'],
              ['← / →', 'Seek 5 seconds'],
              ['J / L', 'Seek 10 seconds'],
              ['F', 'Fullscreen'],
              ['C', 'Toggle captions'],
              ['B', 'Save a moment'],
              ['N', 'Focus notes'],
              ['Shift + N', 'Next lecture'],
              ['M', 'Mute'],
              ['P', 'Picture in picture'],
              ['?', 'Shortcut overlay']
            ].map(([keys, description]) => (
              <div className="shortcut-row" key={keys}>
                <span className="shortcut-keys">{keys}</span>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-card about-card">
          <header className="settings-card-header">
            <div className="settings-icon"><Info size={18} /></div>
            <div>
              <h2>About CourseFlow</h2>
              <p>A private, offline course player built for focused learning.</p>
            </div>
          </header>
          <div className="about-grid">
            <div><span>App version</span><strong>{versions?.app ?? '—'}</strong></div>
            <div><span>Electron</span><strong>{versions?.electron ?? '—'}</strong></div>
            <div><span>Chromium</span><strong>{versions?.chrome ?? '—'}</strong></div>
            <div><span>Node</span><strong>{versions?.node ?? '—'}</strong></div>
          </div>
          <p className="about-note">
            {stats ? `${pluralize(stats.totalLectures, 'lecture')} indexed locally.` : 'Your library stays on this device.'}
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={confirmImportOpen}
        title="Import a CourseFlow backup?"
        description="This replaces every course, lecture and progress record in the current library with the contents of the backup file. Video files on disk are not changed."
        confirmLabel="Choose backup file"
        onConfirm={handleImportData}
        onClose={() => setConfirmImportOpen(false)}
      />
    </div>
  );
}
