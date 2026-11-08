import {
  ChevronsLeft,
  ChevronsRight,
  FolderPlus,
  GraduationCap,
  LayoutDashboard,
  Loader2,
  Settings as SettingsIcon,
  Flag
} from 'lucide-react';
import type { Stats } from '../types';
import { cn, formatHours } from '../utils';

export type NavTarget = 'dashboard' | 'review' | 'settings';
export type NavView = NavTarget | 'course' | 'player';

interface SidebarProps {
  view: NavView;
  stats: Stats | null;
  collapsed: boolean;
  importing: boolean;
  onToggleCollapse: () => void;
  onNavigate: (target: NavTarget) => void;
  onImport: () => void;
}

export default function Sidebar({
  view,
  stats,
  collapsed,
  importing,
  onToggleCollapse,
  onNavigate,
  onImport
}: SidebarProps) {
  const active: NavTarget = view === 'course' || view === 'player' ? 'dashboard' : view;
  const progress = stats ? Math.round(stats.progress) : 0;

  const items: Array<{ target: NavTarget; label: string; icon: typeof LayoutDashboard; badge?: number }> = [
    { target: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { target: 'review', label: 'Review later', icon: Flag, badge: stats?.needsReview },
    { target: 'settings', label: 'Settings', icon: SettingsIcon }
  ];

  return (
    <aside className={cn('sidebar', collapsed && 'collapsed')}>
      <div className="sidebar-brand">
        <div className="brand-mark">
          <GraduationCap size={22} />
        </div>
        <div className="brand-text">
          <strong>CourseFlow</strong>
          <span>Local learning</span>
        </div>
        <button className="sidebar-collapse" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-label">Menu</span>
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.target;
          return (
            <button
              key={item.target}
              className={cn('nav-item', isActive && 'active')}
              onClick={() => onNavigate(item.target)}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} />
              <span className="nav-label">{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge > 99 ? '99+' : item.badge}</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-library">
        <span className="sidebar-label">Library</span>
        <div className="library-meter">
          <div className="library-meter-top">
            <span className="library-count">{stats?.totalCourses ?? 0} courses</span>
            <span className="library-percent">{progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="library-sub">
            {progress}% watched · {formatHours(stats?.watchedDuration)} of {formatHours(stats?.totalDuration)}
          </span>
        </div>
      </div>

      <button className="btn btn-primary sidebar-import" onClick={onImport} disabled={importing} title={collapsed ? 'Import course' : undefined}>
        {importing ? <Loader2 size={17} className="spin" /> : <FolderPlus size={17} />}
        <span className="nav-label">{importing ? 'Importing...' : 'Import course'}</span>
      </button>
    </aside>
  );
}
