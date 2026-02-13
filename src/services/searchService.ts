import { invoke } from '@tauri-apps/api/core';

export interface SearchResult {
  path: string;
  score: number;
  name: string;
  extension?: string;
  parent_path: string;
  size_bytes: number;
  modified_at: number;
}

export interface SearchHistoryEntry {
  id: number;
  query: string;
  result_count: number;
  searched_at: number;
}

export interface SearchFilters {
  file_types: string[];
  size_range: [number, number] | null;
  date_range: [string, string] | null;
  location: string | null;
}

export const EMPTY_FILTERS: SearchFilters = {
  file_types: [],
  size_range: null,
  date_range: null,
  location: null,
};

export const searchService = {
  async keywordSearch(query: string, filters: SearchFilters = EMPTY_FILTERS): Promise<SearchResult[]> {
    return invoke<SearchResult[]>('search_keyword', { query, filters });
  },

  async getHistory(limit = 5): Promise<SearchHistoryEntry[]> {
    return invoke<SearchHistoryEntry[]>('get_search_history', { limit });
  },

  async getTopTags(limit = 12): Promise<string[]> {
    const tags = await invoke<string[]>('get_all_tags');
    return tags.slice(0, limit);
  },
};
