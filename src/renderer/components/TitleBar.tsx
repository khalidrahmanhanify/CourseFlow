import {
  Copy,
  Maximize2,
  Minus,
  Moon,
  Search,
  Square,
  Sun,
  X
} from 'lucide-react';

interface TitleBarProps {
  title: string;
  subtitle?: string;
  resolvedTheme: 'dark' | 'light';
  maximized: boolean;
  onSearch: () => void;
  onToggleTheme: () => void;
  onToggleFullscreen: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export default function TitleBar({
  title,
  subtitle,
  resolvedTheme,
  maximized,
  onSearch,
  onToggleTheme,
  onToggleFullscreen,
  onMinimize,
  onToggleMaximize,
  onClose
}: TitleBarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <div className="titlebar-title">
          <span className="titlebar-crumb">{title}</span>
          {subtitle && (
            <>
              <span className="titlebar-sep">/</span>
              <span className="titlebar-crumb subtle">{subtitle}</span>
            </>
          )}
        </div>
      </div>

      <button className="search-trigger no-drag" onClick={onSearch} aria-label="Search lectures">
        <Search size={15} />
        <span className="search-trigger-text">Search lectures, courses...</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="titlebar-actions no-drag">
        <button className="titlebar-btn" onClick={onToggleTheme} title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`} aria-label="Toggle theme">
          {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="titlebar-btn" onClick={onToggleFullscreen} title="Toggle fullscreen (F11)" aria-label="Toggle fullscreen">
          <Maximize2 size={16} />
        </button>
        <span className="titlebar-divider" />
        <div className="window-controls">
          <button className="window-btn" onClick={onMinimize} title="Minimize" aria-label="Minimize window">
            <Minus size={16} />
          </button>
          <button className="window-btn" onClick={onToggleMaximize} title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore window' : 'Maximize window'}>
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button className="window-btn window-btn-close" onClick={onClose} title="Close" aria-label="Close window">
            <X size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
