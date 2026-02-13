import { useEffect } from 'react';
import type { FileEntry } from '../store/fileStore';

interface Args {
  sortedFiles: FileEntry[];
  focusedIndex: number;
  columns: number;
  viewMode: 'grid' | 'list';
  selectedFile: FileEntry | null;
  navigateUp: () => Promise<void>;
  setCurrentPath: (path: string) => Promise<void>;
  selectFile: (file: FileEntry, multi?: boolean, range?: boolean) => Promise<void>;
  onFocusIndexChange: (index: number) => void;
  onSelectAll: () => void;
  scrollToIndex: (index: number) => void;
}

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};

export const useFileSelectionNavigation = ({
  sortedFiles,
  focusedIndex,
  columns,
  viewMode,
  selectedFile,
  navigateUp,
  setCurrentPath,
  selectFile,
  onFocusIndexChange,
  onSelectAll,
  scrollToIndex,
}: Args) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onSelectAll();
        return;
      }

      if (sortedFiles.length === 0) return;
      const currentIndex = focusedIndex >= 0 ? focusedIndex : 0;
      let nextIndex = currentIndex;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          nextIndex =
            viewMode === 'grid'
              ? Math.min(currentIndex + columns, sortedFiles.length - 1)
              : Math.min(currentIndex + 1, sortedFiles.length - 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          nextIndex = viewMode === 'grid' ? Math.max(currentIndex - columns, 0) : Math.max(currentIndex - 1, 0);
          break;
        case 'ArrowRight':
          if (viewMode === 'grid') {
            e.preventDefault();
            nextIndex = Math.min(currentIndex + 1, sortedFiles.length - 1);
          }
          break;
        case 'ArrowLeft':
          if (viewMode === 'grid') {
            e.preventDefault();
            nextIndex = Math.max(currentIndex - 1, 0);
          }
          break;
        case 'Enter':
          if (selectedFile?.is_directory) {
            e.preventDefault();
            setCurrentPath(selectedFile.path);
          }
          return;
        case 'Backspace':
          e.preventDefault();
          navigateUp();
          return;
        default:
          return;
      }

      if (nextIndex !== currentIndex) {
        const nextFile = sortedFiles[nextIndex];
        onFocusIndexChange(nextIndex);
        selectFile(nextFile, false, false);
        scrollToIndex(nextIndex);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    sortedFiles,
    focusedIndex,
    columns,
    viewMode,
    selectedFile,
    navigateUp,
    setCurrentPath,
    selectFile,
    onFocusIndexChange,
    onSelectAll,
    scrollToIndex,
  ]);
};
