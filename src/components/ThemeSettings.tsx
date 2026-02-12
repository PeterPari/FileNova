import React from 'react';
import { Info } from 'lucide-react';
import { useThemeStore } from '../store/themeStore';
import { useCustomizationStore } from '../store/customizationStore';

interface ThemeSettingsProps {
  onClose?: () => void;
}

export const ThemeSettings: React.FC<ThemeSettingsProps> = () => {
  const {
    theme,
    fontSize,
    compactMode,
    showFileExtensions,
    showHiddenFiles,
    dateFormat,
    setTheme,
    setFontSize,
    setCompactMode,
    setShowFileExtensions,
    setShowHiddenFiles,
    setDateFormat,
  } = useThemeStore();

  const {
    sidebarSections,
    toggleSectionVisibility,
  } = useCustomizationStore();

  return (
    <div className="p-6 space-y-6">
      {/* Theme Selection */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Theme</h3>
        <div className="flex gap-3">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`px-4 py-2 rounded-lg border-2 transition-all capitalize ${
                theme === t
                  ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                  : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-focus)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
          <Info size={14} />
          System theme follows your operating system preference
        </p>
      </div>

      {/* Font Size */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Font Size</h3>
        <div className="flex gap-3">
          {(['small', 'medium', 'large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => setFontSize(size)}
              className={`px-4 py-2 rounded-lg border-2 transition-all capitalize ${
                fontSize === size
                  ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                  : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-focus)]'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Appearance Options */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Appearance</h3>
        
        <label className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
          <span className="text-[var(--text-primary)]">Compact Mode</span>
          <input
            type="checkbox"
            checked={compactMode}
            onChange={(e) => setCompactMode(e.target.checked)}
            className="w-5 h-5 accent-[var(--accent-blue)]"
          />
        </label>

        <label className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
          <span className="text-[var(--text-primary)]">Show File Extensions</span>
          <input
            type="checkbox"
            checked={showFileExtensions}
            onChange={(e) => setShowFileExtensions(e.target.checked)}
            className="w-5 h-5 accent-[var(--accent-blue)]"
          />
        </label>

        <label className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
          <span className="text-[var(--text-primary)]">Show Hidden Files</span>
          <input
            type="checkbox"
            checked={showHiddenFiles}
            onChange={(e) => setShowHiddenFiles(e.target.checked)}
            className="w-5 h-5 accent-[var(--accent-blue)]"
          />
        </label>
      </div>

      {/* Date Format */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Date Format</h3>
        <div className="flex gap-3">
          <button
            onClick={() => setDateFormat('relative')}
            className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
              dateFormat === 'relative'
                ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-focus)]'
            }`}
          >
            <div className="font-medium">Relative</div>
            <div className="text-xs opacity-70 mt-1">2 days ago</div>
          </button>
          <button
            onClick={() => setDateFormat('absolute')}
            className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
              dateFormat === 'absolute'
                ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-focus)]'
            }`}
          >
            <div className="font-medium">Absolute</div>
            <div className="text-xs opacity-70 mt-1">Feb 10, 2026</div>
          </button>
        </div>
      </div>

      {/* Sidebar Sections */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Sidebar Sections</h3>
        <p className="text-sm text-[var(--text-secondary)]">Control which sections appear in the sidebar</p>
        {sidebarSections
          .sort((a, b) => a.order - b.order)
          .map((section) => (
            <label
              key={section.id}
              className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
            >
              <span className="text-[var(--text-primary)]">{section.label}</span>
              <input
                type="checkbox"
                checked={section.visible}
                onChange={() => toggleSectionVisibility(section.id)}
                className="w-5 h-5 accent-[var(--accent-blue)]"
              />
            </label>
          ))}
      </div>
    </div>
  );
};
