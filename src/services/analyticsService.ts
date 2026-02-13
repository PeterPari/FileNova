import { invoke } from '@tauri-apps/api/core';
import type { FileEntry } from '../store/fileStore';

export interface FileTypeStats {
  category: string;
  size: number;
  count: number;
}

export interface StorageBreakdown {
  total_size: number;
  file_count: number;
  breakdown: FileTypeStats[];
}

export interface DuplicateSummary {
  total_groups: number;
  total_wasted_bytes: number;
  exact_groups: number;
  perceptual_groups: number;
  smart_groups: number;
}

export interface FolderSize {
  name: string;
  path: string;
  size: number;
  category: string;
}

export interface AnalyticsGlobalData {
  breakdown: StorageBreakdown;
  duplicateSummary: DuplicateSummary;
  largestFiles: FileEntry[];
  tagStats: Array<{ tag: string; count: number }>;
}

export const analyticsService = {
  async loadGlobalData(): Promise<AnalyticsGlobalData> {
    const [breakdown, duplicateSummary, largestFiles, tagStats] = await Promise.all([
      invoke<StorageBreakdown>('get_storage_breakdown'),
      invoke<DuplicateSummary>('get_duplicate_summary'),
      invoke<FileEntry[]>('get_largest_files', { limit: 50 }),
      invoke<Array<{ tag: string; count: number }>>('get_tag_stats'),
    ]);

    return { breakdown, duplicateSummary, largestFiles, tagStats };
  },

  async loadFolderSizes(path: string): Promise<FolderSize[]> {
    if (!path) return [];
    return invoke<FolderSize[]>('get_folder_sizes', { path });
  },
};
