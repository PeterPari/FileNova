import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileEntry } from '../store/fileStore';
import { analyticsService, type DuplicateSummary, type FolderSize, type StorageBreakdown } from '../services/analyticsService';

export type LargestSortKey = 'size' | 'path' | 'type' | 'name';

export const useAnalyticsData = (currentPath: string) => {
  const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
  const [duplicateSummary, setDuplicateSummary] = useState<DuplicateSummary | null>(null);
  const [largestFiles, setLargestFiles] = useState<FileEntry[]>([]);
  const [folderSizes, setFolderSizes] = useState<FolderSize[]>([]);
  const [tagStats, setTagStats] = useState<Array<{ tag: string; count: number }>>([]);
  const [largestSort, setLargestSort] = useState<{ key: LargestSortKey; direction: 'asc' | 'desc' }>({
    key: 'size',
    direction: 'desc',
  });

  const refreshGlobal = useCallback(async () => {
    const globalData = await analyticsService.loadGlobalData();
    setBreakdown(globalData.breakdown);
    setDuplicateSummary(globalData.duplicateSummary);
    setLargestFiles(globalData.largestFiles);
    setTagStats(globalData.tagStats);
  }, []);

  const refreshFolderSizes = useCallback(async () => {
    const sizes = await analyticsService.loadFolderSizes(currentPath);
    setFolderSizes(sizes);
  }, [currentPath]);

  useEffect(() => {
    refreshGlobal().catch(console.error);
  }, [refreshGlobal]);

  useEffect(() => {
    refreshFolderSizes().catch(console.error);
  }, [refreshFolderSizes]);

  const sortedLargestFiles = useMemo(() => {
    const getFileTypeLabel = (name: string) => name.split('.').pop()?.toUpperCase() || 'FILE';
    const sorted = [...largestFiles].sort((a, b) => {
      switch (largestSort.key) {
        case 'size':
          return largestSort.direction === 'asc' ? a.size - b.size : b.size - a.size;
        case 'path': {
          const compared = a.path.localeCompare(b.path);
          return largestSort.direction === 'asc' ? compared : -compared;
        }
        case 'type': {
          const compared = getFileTypeLabel(a.name).localeCompare(getFileTypeLabel(b.name));
          return largestSort.direction === 'asc' ? compared : -compared;
        }
        case 'name':
        default: {
          const compared = a.name.localeCompare(b.name);
          return largestSort.direction === 'asc' ? compared : -compared;
        }
      }
    });

    return sorted;
  }, [largestFiles, largestSort]);

  const treemapData = useMemo(() => {
    if (folderSizes.length === 0) return null;
    return {
      name: 'root',
      children: folderSizes.map((f) => ({ name: f.name, value: f.size, path: f.path, category: f.category })),
    };
  }, [folderSizes]);

  const setSortKey = useCallback((key: LargestSortKey) => {
    setLargestSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'size' ? 'desc' : 'asc' };
    });
  }, []);

  return {
    breakdown,
    duplicateSummary,
    largestFiles,
    folderSizes,
    tagStats,
    sortedLargestFiles,
    treemapData,
    largestSort,
    setSortKey,
    refreshGlobal,
    refreshFolderSizes,
  };
};
