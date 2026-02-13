import { useEffect, useRef } from 'react';
import { Search, X, File, Folder, Clock, ArrowRight } from 'lucide-react';
import { useFileStore } from '../store/fileStore';
import { getParentPath } from '../utils/path';
import { useSearchController } from '../hooks/useSearchController';

export const SearchBar = () => {
    const {
        state: { query, results, history, tagSuggestions, isOpen, selectedIndex },
        activeItems,
        setOpen,
        setQuery,
        setSelectedIndex,
    } = useSearchController();
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { performSearch, setCurrentPath, setCurrentView } = useFileStore();

    // Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'k')) {
                e.preventDefault();
                inputRef.current?.focus();
                setOpen(true);
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
            setOpen(true);
            inputRef.current?.focus();
        };

        window.addEventListener('tag-search', handleTagSearch as EventListener);
        return () => window.removeEventListener('tag-search', handleTagSearch as EventListener);
    }, []);

    // List navigation shortcuts
    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setOpen(false);
            inputRef.current?.blur();
        }

        if (isOpen && activeItems.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex((selectedIndex + 1) % activeItems.length);
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex((selectedIndex - 1 + activeItems.length) % activeItems.length);
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
            setOpen(false);
        }
    };

    // Click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const openFile = async (path: string) => {
        const parent = getParentPath(path);
        setCurrentView('browser');
        if (parent !== null) {
            await setCurrentPath(parent);
        }
        setOpen(false);
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-accent-primary transition-colors" size={18} />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={handleInputKeyDown}
                    placeholder="Search files (Ctrl+P)..."
                    className="w-full bg-surface border border-base rounded-lg pl-10 pr-10 py-2 text-sm outline-none transition-all text-primary placeholder:text-muted"
                    style={{ boxShadow: 'var(--shadow-sm)' }}
                    onFocusCapture={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border-focus)'; (e.target as HTMLElement).style.boxShadow = `0 0 0 2px color-mix(in srgb, var(--accent-blue) 20%, transparent)`; }}
                    onBlurCapture={(e) => { (e.target as HTMLElement).style.borderColor = ''; (e.target as HTMLElement).style.boxShadow = 'var(--shadow-sm)'; }}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {query && (
                        <button
                            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                            className="text-muted hover:text-primary p-1 rounded-full hover:bg-surface-hover transition-theme"
                        >
                            <X size={14} />
                        </button>
                    )}
                    <span className="text-muted text-xs border border-base rounded px-1.5 py-0.5 ml-1 hidden sm:block">
                        Ctrl+P
                    </span>
                </div>
            </div>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-surface rounded-xl border border-base max-h-[60vh] overflow-y-auto z-50 custom-scrollbar" style={{ boxShadow: 'var(--shadow-xl)' }}>

                    {query ? (
                        <>
                            <div className="px-4 py-2 bg-surface-hover text-xs text-secondary font-medium flex justify-between items-center sticky top-0 z-10">
                                <span>{results.length} results found</span>
                                <span className="text-[10px] uppercase tracking-wider text-muted">Arrow Key Navigation</span>
                            </div>
                            <ul className="py-2">
                                {results.map((result, index) => (
                                    <li
                                        key={result.path}
                                        className={`px-4 py-3 cursor-pointer flex items-center gap-3 transition-theme group ${index === selectedIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
                                        onClick={() => openFile(result.path)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <div className={`p-2.5 rounded-lg shrink-0 ${index === selectedIndex ? 'bg-surface-active text-accent-primary' : 'bg-surface-hover text-muted'}`}>
                                            {result.extension ? <File size={20} className="stroke-[1.5]" /> : <Folder size={20} className="stroke-[1.5]" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-baseline mb-0.5">
                                                <h4 className={`text-sm font-medium truncate ${index === selectedIndex ? 'text-accent-primary' : 'text-primary'}`}>
                                                    {result.name}
                                                </h4>
                                                <span className="text-xs text-muted whitespace-nowrap ml-3 font-mono">
                                                    {formatSize(result.size_bytes)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-muted">
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
                            <div className="px-4 py-2 bg-surface-hover text-xs text-secondary font-medium flex justify-between items-center sticky top-0 z-10">
                                <span>Recent Searches</span>
                            </div>
                            <ul className="py-2">
                                {history.length > 0 ? history.map((item, index) => (
                                    <li
                                        key={item.id}
                                        className={`px-4 py-2 cursor-pointer flex items-center gap-3 transition-theme ${index === selectedIndex ? 'bg-surface-active' : 'hover:bg-surface-hover'}`}
                                        onClick={() => setQuery(item.query)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <Clock size={16} className="text-muted" />
                                        <div className="flex-1">
                                            <span className="text-sm text-primary">{item.query}</span>
                                        </div>
                                        <ArrowRight size={14} className="text-muted -rotate-45" />
                                    </li>
                                )) : (
                                    <li className="px-4 py-4 text-center text-muted text-sm">
                                        No recent searches
                                    </li>
                                )}
                            </ul>
                            {tagSuggestions.length > 0 && (
                                <div className="px-4 pb-3 border-t border-base pt-3">
                                    <div className="text-[10px] uppercase tracking-wider text-muted mb-2">Tags</div>
                                    <div className="flex flex-wrap gap-2">
                                        {tagSuggestions.map((tag) => (
                                            <button
                                                key={tag}
                                                className="text-xs px-2 py-1 rounded-full text-accent-primary hover:bg-surface-active transition-theme"
                                                style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}
                                                onClick={() => {
                                                    setQuery(`tag:${tag}`);
                                                    setOpen(true);
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
