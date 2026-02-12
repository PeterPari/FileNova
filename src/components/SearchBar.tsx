import { useState, useEffect, useRef } from 'react';
import { Search, X, File, Folder, Clock, ArrowRight } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useFileStore } from '../store/fileStore';
import { getParentPath } from '../utils/path';

interface SearchResult {
    path: string;
    score: number;
    name: string;
    extension?: string;
    parent_path: string;
    size_bytes: number;
    modified_at: number;
}

interface SearchHistoryEntry {
    id: number;
    query: string;
    result_count: number;
    searched_at: number;
}

export const SearchBar = () => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
    const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { performSearch, setCurrentPath, setCurrentView } = useFileStore();

    const emptyFilters = {
        file_types: [],
        size_range: null as [number, number] | null,
        date_range: null as [string, string] | null,
        location: null as string | null,
    };

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (query.trim()) {
                search(query);
            } else {
                setResults([]);
                fetchHistory(); // Show history when query cleared
            }
        }, 300); // 300ms debounce

        return () => clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        if (isOpen && !query) {
            fetchHistory();
            fetchTags();
        }
    }, [isOpen, query]);

    // Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'k')) {
                e.preventDefault();
                inputRef.current?.focus();
                setIsOpen(true);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        const handleTagSearch = (event: Event) => {
            const detail = (event as CustomEvent<{ tag: string }>).detail;
            if (!detail?.tag) return;
            setQuery(`tag:${detail.tag}`);
            setIsOpen(true);
            inputRef.current?.focus();
        };

        window.addEventListener('tag-search', handleTagSearch as EventListener);
        return () => window.removeEventListener('tag-search', handleTagSearch as EventListener);
    }, []);

    const fetchHistory = async () => {
        try {
            const hist = await invoke<SearchHistoryEntry[]>('get_search_history', { limit: 5 });
            setHistory(hist);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchTags = async () => {
        try {
            const tags = await invoke<string[]>('get_all_tags');
            setTagSuggestions(tags.slice(0, 12));
        } catch (e) {
            console.error(e);
        }
    };

    // List navigation shortcuts
    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsOpen(false);
            inputRef.current?.blur();
        }

        const items = query ? results : history;
        if (isOpen && items.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(i => (i + 1) % items.length);
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(i => (i - 1 + items.length) % items.length);
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (query) {
                    // Open result
                    openFile(results[selectedIndex].path);
                } else {
                    // Use history item
                    setQuery(history[selectedIndex].query);
                }
            }
        } else if (e.key === 'Enter' && query.trim()) {
            // Trigger full semantic search
            e.preventDefault();
            performSearch(query, 'hybrid');
            setIsOpen(false);
        }
    };

    // Click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const search = async (q: string) => {
        try {
            const res = await invoke<SearchResult[]>('search_keyword', { query: q, filters: emptyFilters });
            setResults(res);
            setSelectedIndex(0);
            setIsOpen(true);
        } catch (error) {
            console.error('Search error:', error);
        }
    };

    const openFile = async (path: string) => {
        const parent = getParentPath(path);
        setCurrentView('browser');
        if (parent !== null) {
            await setCurrentPath(parent);
        }
        setIsOpen(false);
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const formatDate = (ts: number) => {
        if (!ts) return '';
        return new Date(ts * 1000).toLocaleDateString();
    };

    return (
        <div className="relative w-full max-w-xl mx-auto" ref={containerRef}>
            <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-blue-500 transition-colors" size={18} />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Search files (Ctrl+P)..."
                    className="w-full bg-surface border border-base focus:border-blue-500 dark:focus:border-blue-500 rounded-lg pl-10 pr-10 py-2.5 text-sm focus:ring-2 focus:ring-blue-100 outline-none transition-all shadow-sm"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {query && (
                        <button
                            onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
                            className="text-muted hover:text-gray-600 p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                            <X size={14} />
                        </button>
                    )}
                    <span className="text-muted text-xs border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 ml-1 hidden sm:block">
                        Ctrl+P
                    </span>
                </div>
            </div>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-surface rounded-xl shadow-2xl border border-base max-h-[60vh] overflow-y-auto z-50 divide-y divide-gray-100 dark:divide-gray-700">

                    {query ? (
                        <>
                            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs text-secondary font-medium flex justify-between items-center sticky top-0 backdrop-blur-sm z-10">
                                <span>{results.length} results found</span>
                                <span className="text-[10px] uppercase tracking-wider text-muted">Arrow Key Navigation</span>
                            </div>
                            <ul className="py-2">
                                {results.map((result, index) => (
                                    <li
                                        key={result.path}
                                        className={`px-4 py-3 cursor-pointer flex items-center gap-3 transition-colors duration-150 group ${index === selectedIndex ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                                        onClick={() => openFile(result.path)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <div className={`p-2.5 rounded-lg shrink-0 ${index === selectedIndex ? 'bg-blue-100/50 dark:bg-blue-800/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-muted'}`}>
                                            {result.extension ? <File size={20} className="stroke-[1.5]" /> : <Folder size={20} className="stroke-[1.5]" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-baseline mb-0.5">
                                                <h4 className={`text-sm font-medium truncate ${index === selectedIndex ? 'text-blue-900 dark:text-blue-100' : 'text-primary'}`}>
                                                    {result.name}
                                                </h4>
                                                <span className="text-xs text-muted whitespace-nowrap ml-3 font-mono">
                                                    {formatSize(result.size_bytes)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-secondary dark:text-muted">
                                                <span className="truncate mr-4 opacity-75" title={result.path}>
                                                    {result.path}
                                                </span>
                                                <span className="flex items-center gap-1 whitespace-nowrap opacity-75">
                                                    {formatDate(result.modified_at)}
                                                </span>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : (
                        <>
                            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs text-secondary font-medium flex justify-between items-center sticky top-0 backdrop-blur-sm z-10">
                                <span>Recent Searches</span>
                            </div>
                            <ul className="py-2">
                                {history.length > 0 ? history.map((item, index) => (
                                    <li
                                        key={item.id}
                                        className={`px-4 py-2 cursor-pointer flex items-center gap-3 ${index === selectedIndex ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                                        onClick={() => setQuery(item.query)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <Clock size={16} className="text-muted" />
                                        <div className="flex-1">
                                            <span className="text-sm text-gray-700 dark:text-gray-200">{item.query}</span>
                                        </div>
                                        <ArrowRight size={14} className="text-gray-300 -rotate-45" />
                                    </li>
                                )) : (
                                    <li className="px-4 py-4 text-center text-muted text-sm">
                                        No recent searches
                                    </li>
                                )}
                            </ul>
                            {tagSuggestions.length > 0 && (
                                <div className="px-4 pb-3">
                                    <div className="text-[10px] uppercase tracking-wider text-muted mb-2">Tags</div>
                                    <div className="flex flex-wrap gap-2">
                                        {tagSuggestions.map((tag) => (
                                            <button
                                                key={tag}
                                                className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                                                onClick={() => {
                                                    setQuery(`tag:${tag}`);
                                                    setIsOpen(true);
                                                }}
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

