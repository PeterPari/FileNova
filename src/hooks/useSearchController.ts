import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchService, type SearchHistoryEntry, type SearchResult } from '../services/searchService';

interface SearchControllerState {
  query: string;
  results: SearchResult[];
  history: SearchHistoryEntry[];
  tagSuggestions: string[];
  isOpen: boolean;
  selectedIndex: number;
}

export const useSearchController = () => {
  const [state, setState] = useState<SearchControllerState>({
    query: '',
    results: [],
    history: [],
    tagSuggestions: [],
    isOpen: false,
    selectedIndex: 0,
  });

  const cacheRef = useRef<{ history: SearchHistoryEntry[]; tags: string[] } | null>(null);
  const requestSeq = useRef(0);

  const setOpen = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, isOpen: value }));
  }, []);

  const setQuery = useCallback((query: string) => {
    setState((prev) => ({ ...prev, query }));
  }, []);

  const setSelectedIndex = useCallback((index: number) => {
    setState((prev) => ({ ...prev, selectedIndex: index }));
  }, []);

  const loadHistoryAndTags = useCallback(async () => {
    if (cacheRef.current) {
      setState((prev) => ({
        ...prev,
        history: cacheRef.current?.history ?? prev.history,
        tagSuggestions: cacheRef.current?.tags ?? prev.tagSuggestions,
      }));
      return;
    }

    const [history, tags] = await Promise.all([searchService.getHistory(5), searchService.getTopTags(12)]);
    cacheRef.current = { history, tags };
    setState((prev) => ({ ...prev, history, tagSuggestions: tags }));
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const seq = ++requestSeq.current;
    const results = await searchService.keywordSearch(q);
    if (seq !== requestSeq.current) return;
    setState((prev) => ({ ...prev, results, selectedIndex: 0, isOpen: true }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (state.query.trim()) {
        runSearch(state.query).catch(console.error);
      } else {
        setState((prev) => ({ ...prev, results: [] }));
        loadHistoryAndTags().catch(console.error);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [state.query, loadHistoryAndTags, runSearch]);

  useEffect(() => {
    if (state.isOpen && !state.query.trim()) {
      loadHistoryAndTags().catch(console.error);
    }
  }, [state.isOpen, state.query, loadHistoryAndTags]);

  const activeItems = useMemo(() => (state.query ? state.results : state.history), [state.query, state.results, state.history]);

  return {
    state,
    activeItems,
    setOpen,
    setQuery,
    setSelectedIndex,
    loadHistoryAndTags,
    runSearch,
  };
};
