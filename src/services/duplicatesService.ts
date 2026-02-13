import { invoke } from '@tauri-apps/api/core';
import type { DuplicateGroup, DuplicateSummary, OperationBatch } from '../store/duplicateStore';

export interface DuplicatesDashboardSnapshot {
  summary: DuplicateSummary;
  groups: DuplicateGroup[];
  recentBatches: OperationBatch[];
}

export const duplicatesService = {
  async refreshDashboard(filterType: string | null): Promise<DuplicatesDashboardSnapshot> {
    const [summary, groups, recentBatches] = await Promise.all([
      invoke<DuplicateSummary>('get_duplicate_summary'),
      invoke<DuplicateGroup[]>('get_duplicates', {
        groupType: filterType,
        offset: 0,
        limit: 100,
      }),
      invoke<OperationBatch[]>('get_recent_operations', { limit: 10 }),
    ]);

    return { summary, groups, recentBatches };
  },
};
