import { useState, useEffect, useCallback } from 'react';
import { X, Lightbulb, ChevronRight, ChevronLeft } from 'lucide-react';

// ─── Tip definitions ─────────────────────────────────────────────────────────

export interface FeatureTip {
  id: string;
  title: string;
  description: string;
  shortcut?: string;
  /** CSS selector for the element to highlight (optional). */
  anchorSelector?: string;
}

const FEATURE_TIPS: FeatureTip[] = [
  {
    id: 'command-palette',
    title: 'Command Palette',
    description: 'Press Ctrl+K to open the command palette – quickly jump to any view, file, or action.',
    shortcut: 'Ctrl+K',
  },
  {
    id: 'preview-panel',
    title: 'File Preview',
    description: 'Toggle the preview panel with Ctrl+P to see file contents without opening them.',
    shortcut: 'Ctrl+P',
  },
  {
    id: 'quick-look',
    title: 'Quick Look',
    description: 'Press Space on any selected file for an instant preview overlay.',
    shortcut: 'Space',
  },
  {
    id: 'semantic-search',
    title: 'Semantic Search',
    description: 'Use the search bar to find files by meaning – not just keywords. AI understands your intent.',
  },
  {
    id: 'organize',
    title: 'AI Organize',
    description: 'Visit the Organize page to get intelligent suggestions for decluttering and restructuring your folders.',
  },
  {
    id: 'rules',
    title: 'Automation Rules',
    description: 'Create rules to automatically move, rename, tag, or archive files matching specific patterns.',
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    description: 'Press ? at any time to see a full list of keyboard shortcuts.',
    shortcut: '?',
  },
  {
    id: 'duplicates',
    title: 'Duplicate Finder',
    description: 'Detect exact and visually similar duplicate files. Reclaim disk space with one click.',
  },
];

// ─── Persistence helpers ─────────────────────────────────────────────────────

const STORAGE_KEY = 'filenova-dismissed-tips';

function getDismissedTips(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function persistDismissedTips(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

// ─── Component ───────────────────────────────────────────────────────────────

export const FeatureDiscovery = () => {
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissedTips());
  const [visible, setVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Only tips that haven't been dismissed
  const activeTips = FEATURE_TIPS.filter((t) => !dismissed.has(t.id));

  // Show the tooltip strip after a short delay on first render
  useEffect(() => {
    if (activeTips.length === 0) return;
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, [activeTips.length]);

  const dismissCurrent = useCallback(() => {
    if (activeTips.length === 0) return;
    const tip = activeTips[currentIndex];
    const next = new Set(dismissed);
    next.add(tip.id);
    setDismissed(next);
    persistDismissedTips(next);

    // Move index to stay in bounds
    if (currentIndex >= activeTips.length - 1) {
      setCurrentIndex(Math.max(0, activeTips.length - 2));
    }
  }, [activeTips, currentIndex, dismissed]);

  const dismissAll = useCallback(() => {
    const next = new Set(dismissed);
    FEATURE_TIPS.forEach((t) => next.add(t.id));
    setDismissed(next);
    persistDismissedTips(next);
    setVisible(false);
  }, [dismissed]);

  const prev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const next = () => setCurrentIndex((i) => Math.min(activeTips.length - 1, i + 1));

  if (!visible || activeTips.length === 0) return null;

  const tip = activeTips[currentIndex];

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] animate-slide-up"
      role="status"
      aria-live="polite"
    >
      <div className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl px-5 py-4 max-w-md w-[28rem] flex flex-col gap-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-blue-400">
            <Lightbulb size={16} />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Tip {currentIndex + 1} of {activeTips.length}
            </span>
          </div>
          <button
            onClick={() => setVisible(false)}
            className="text-gray-500 hover:text-gray-300 transition-colors p-0.5"
            title="Hide tips"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <h3 className="text-white font-bold text-sm leading-tight">{tip.title}</h3>
        <p className="text-gray-300 text-xs leading-relaxed">{tip.description}</p>

        {tip.shortcut && (
          <div className="mt-1">
            <kbd className="bg-gray-700 text-gray-200 text-[10px] px-2 py-0.5 rounded border border-gray-600 font-mono">
              {tip.shortcut}
            </kbd>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-700">
          <button
            onClick={dismissAll}
            className="text-gray-500 hover:text-gray-300 text-xs transition-colors"
          >
            Dismiss all
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={prev}
              disabled={currentIndex === 0}
              className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-400 transition-colors"
              title="Previous tip"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={dismissCurrent}
              className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded transition-colors"
            >
              Got it
            </button>
            <button
              onClick={next}
              disabled={currentIndex >= activeTips.length - 1}
              className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-400 transition-colors"
              title="Next tip"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Slide-up animation (defined inline for self-containment) */}
      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translate(-50%, 20px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-slide-up {
          animation: slide-up 0.35s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

/**
 * Reset all dismissed tips (useful from Settings).
 */
export function resetFeatureDiscovery() {
  localStorage.removeItem(STORAGE_KEY);
}
