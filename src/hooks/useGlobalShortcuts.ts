import { useEffect } from 'react';

interface UseGlobalShortcutsArgs {
  tabsLength: number;
  activeTabIndex: number;
  onToggleCommandPalette: () => void;
  onTogglePreview: () => void;
  onOpenQuickLook: () => void;
  onToggleShortcuts: () => void;
  addTab: () => void;
  closeTab: (index: number) => void;
}

export const useGlobalShortcuts = ({
  tabsLength,
  activeTabIndex,
  onToggleCommandPalette,
  onTogglePreview,
  onOpenQuickLook,
  onToggleShortcuts,
  addTab,
  closeTab,
}: UseGlobalShortcutsArgs) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        onToggleCommandPalette();
        return;
      }
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        onTogglePreview();
        return;
      }
      if (e.key === ' ' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const tagName = (e.target as HTMLElement)?.tagName;
        if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
          e.preventDefault();
          onOpenQuickLook();
          return;
        }
      }
      if (e.key === '?') {
        const tagName = (e.target as HTMLElement)?.tagName;
        if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
          e.preventDefault();
          onToggleShortcuts();
          return;
        }
      }
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        addTab();
        return;
      }
      if (e.ctrlKey && e.key === 'w' && tabsLength > 1) {
        e.preventDefault();
        closeTab(activeTabIndex);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    tabsLength,
    activeTabIndex,
    onToggleCommandPalette,
    onTogglePreview,
    onOpenQuickLook,
    onToggleShortcuts,
    addTab,
    closeTab,
  ]);
};
