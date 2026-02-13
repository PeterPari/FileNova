import { invoke } from '@tauri-apps/api/core';
import type { Suggestion, SuggestionPlan } from '../components/Organize/SuggestionCard';

export const suggestionsService = {
  async listPending(): Promise<Suggestion[]> {
    return invoke<Suggestion[]>('get_pending_suggestions');
  },

  async analyze(): Promise<void> {
    await invoke('generate_suggestions');
  },

  async accept(id: number): Promise<string> {
    return invoke<string>('accept_suggestion', { id });
  },

  async reject(id: number): Promise<void> {
    await invoke('reject_suggestion', { id });
  },

  async modify(id: number, plan: SuggestionPlan): Promise<void> {
    await invoke('modify_suggestion', { id, updatedPlan: JSON.stringify(plan) });
  },

  async undoBatch(batchId: string): Promise<void> {
    await invoke('undo_batch', { batchId });
  },
};
