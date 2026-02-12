// Stage 10: Command Palette (VS Code style)
import { useEffect, useState, useMemo } from 'react';
import {
    Search, FolderOpen, Tags, Copy, Settings, Trash2, LayoutGrid,
    List, Moon, FileSearch, Repeat, Sparkles, Eye, Keyboard,
    Star, Clock, Bookmark
} from 'lucide-react';
import { useFileStore } from '../store/fileStore';

interface Command {
    id: string;
    label: string;
    description?: string;
    category: 'Navigation' | 'Search' | 'Actions' | 'View' | 'Settings';
    icon: React.ReactNode;
    action: () => void;
    keywords?: string[];
    isPinned?: boolean;
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
}

export const CommandPalette = ({ isOpen, onClose }: CommandPaletteProps) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [recentCommands, setRecentCommands] = useState<string[]>([]);
    const [pinnedCommands, setPinnedCommands] = useState<string[]>([]);
    const { setCurrentView } = useFileStore();

    useEffect(() => {
        // Load recent and pinned commands from localStorage
        const recent = localStorage.getItem('recentCommands');
        const pinned = localStorage.getItem('pinnedCommands');
        if (recent) setRecentCommands(JSON.parse(recent));
        if (pinned) setPinnedCommands(JSON.parse(pinned));
    }, []);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    const commands: Command[] = useMemo(() => [
        // Navigation
        {
            id: 'nav-browse',
            label: 'Go to File Browser',
            description: 'Browse files and folders',
            category: 'Navigation',
            icon: <FolderOpen size={18} />,
            action: () => {
                setCurrentView('browser');
                executeCommand('nav-browse');
            },
            keywords: ['browse', 'files', 'folders', 'explorer']
        },
        {
            id: 'nav-search',
            label: 'Go to Search',
            description: 'Search for files',
            category: 'Navigation',
            icon: <Search size={18} />,
            action: () => {
                setCurrentView('browser');
                executeCommand('nav-search');
            },
            keywords: ['search', 'find', 'query']
        },
        {
            id: 'nav-duplicates',
            label: 'Go to Duplicate Finder',
            description: 'Find and manage duplicate files',
            category: 'Navigation',
            icon: <Copy size={18} />,
            action: () => {
                setCurrentView('duplicates');
                executeCommand('nav-duplicates');
            },
            keywords: ['duplicates', 'copies', 'same files']
        },
        {
            id: 'nav-analytics',
            label: 'Go to Analytics',
            description: 'View storage analytics',
            category: 'Navigation',
            icon: <LayoutGrid size={18} />,
            action: () => {
                setCurrentView('dashboard');
                executeCommand('nav-analytics');
            },
            keywords: ['analytics', 'storage', 'stats', 'disk usage']
        },
        {
            id: 'nav-organize',
            label: 'Go to Organize',
            description: 'Smart file organization suggestions',
            category: 'Navigation',
            icon: <Sparkles size={18} />,
            action: () => {
                setCurrentView('organize');
                executeCommand('nav-organize');
            },
            keywords: ['organize', 'suggestions', 'smart', 'ai']
        },
        {
            id: 'nav-trash',
            label: 'Go to Trash',
            description: 'View deleted files',
            category: 'Navigation',
            icon: <Trash2 size={18} />,
            action: () => {
                setCurrentView('trash');
                executeCommand('nav-trash');
            },
            keywords: ['trash', 'deleted', 'recycle bin']
        },

        // Search
        {
            id: 'search-files',
            label: 'Search Files',
            description: 'Search files by name',
            category: 'Search',
            icon: <FileSearch size={18} />,
            action: () => {
                // Focus search input
                document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
                executeCommand('search-files');
            },
            keywords: ['search', 'find', 'query', 'name']
        },
        {
            id: 'search-semantic',
            label: 'Semantic Search',
            description: 'Search by content and meaning',
            category: 'Search',
            icon: <Sparkles size={18} />,
            action: () => {
                setCurrentView('semantic-search');
                executeCommand('search-semantic');
            },
            keywords: ['semantic', 'ai', 'content', 'meaning']
        },
        {
            id: 'search-tags',
            label: 'Search by Tags',
            description: 'Find files by tags',
            category: 'Search',
            icon: <Tags size={18} />,
            action: () => {
                setCurrentView('browser');
                executeCommand('search-tags');
            },
            keywords: ['tags', 'labels', 'categories']
        },

        // Actions
        {
            id: 'action-scan-duplicates',
            label: 'Scan for Duplicates',
            description: 'Find duplicate files',
            category: 'Actions',
            icon: <Repeat size={18} />,
            action: () => {
                setCurrentView('duplicates');
                executeCommand('action-scan-duplicates');
            },
            keywords: ['scan', 'duplicates', 'find', 'search']
        },
        {
            id: 'action-generate-suggestions',
            label: 'Generate Organization Suggestions',
            description: 'Get AI-powered organization suggestions',
            category: 'Actions',
            icon: <Sparkles size={18} />,
            action: () => {
                setCurrentView('organize');
                executeCommand('action-generate-suggestions');
            },
            keywords: ['organize', 'suggestions', 'ai', 'smart']
        },
        {
            id: 'action-show-recent',
            label: 'Show Recent Files',
            description: 'View recently accessed files',
            category: 'Actions',
            icon: <Clock size={18} />,
            action: () => {
                // TODO: Implement recent files view
                executeCommand('action-show-recent');
            },
            keywords: ['recent', 'history', 'last']
        },
        {
            id: 'action-show-bookmarks',
            label: 'Show Bookmarks',
            description: 'View bookmarked folders',
            category: 'Actions',
            icon: <Bookmark size={18} />,
            action: () => {
                // TODO: Implement bookmarks view
                executeCommand('action-show-bookmarks');
            },
            keywords: ['bookmarks', 'favorites', 'starred']
        },

        // View
        {
            id: 'view-grid',
            label: 'Switch to Grid View',
            description: 'Display files as grid',
            category: 'View',
            icon: <LayoutGrid size={18} />,
            action: () => {
                // TODO: Switch view mode
                executeCommand('view-grid');
            },
            keywords: ['grid', 'view', 'layout', 'tiles']
        },
        {
            id: 'view-list',
            label: 'Switch to List View',
            description: 'Display files as list',
            category: 'View',
            icon: <List size={18} />,
            action: () => {
                // TODO: Switch view mode
                executeCommand('view-list');
            },
            keywords: ['list', 'view', 'layout', 'rows']
        },
        {
            id: 'view-toggle-preview',
            label: 'Toggle Preview Panel',
            description: 'Show/hide file preview panel',
            category: 'View',
            icon: <Eye size={18} />,
            action: () => {
                // TODO: Toggle preview panel
                executeCommand('view-toggle-preview');
            },
            keywords: ['preview', 'panel', 'sidebar', 'toggle']
        },
        {
            id: 'view-dark-mode',
            label: 'Toggle Dark Mode',
            description: 'Switch between light and dark theme',
            category: 'View',
            icon: <Moon size={18} />,
            action: () => {
                document.documentElement.classList.toggle('dark');
                executeCommand('view-dark-mode');
            },
            keywords: ['dark', 'light', 'theme', 'mode']
        },

        // Settings
        {
            id: 'settings-open',
            label: 'Open Settings',
            description: 'Configure application settings',
            category: 'Settings',
            icon: <Settings size={18} />,
            action: () => {
                executeCommand('settings-open');
            },
            keywords: ['settings', 'preferences', 'config', 'options']
        },
        {
            id: 'settings-shortcuts',
            label: 'Keyboard Shortcuts',
            description: 'View and edit keyboard shortcuts',
            category: 'Settings',
            icon: <Keyboard size={18} />,
            action: () => {
                // TODO: Show shortcuts modal
                executeCommand('settings-shortcuts');
            },
            keywords: ['keyboard', 'shortcuts', 'hotkeys', 'keys']
        },
    ], [setCurrentView]);

    const executeCommand = (commandId: string) => {
        // Add to recent commands
        const updated = [commandId, ...recentCommands.filter(id => id !== commandId)].slice(0, 5);
        setRecentCommands(updated);
        localStorage.setItem('recentCommands', JSON.stringify(updated));
        onClose();
    };

    const togglePin = (commandId: string) => {
        const updated = pinnedCommands.includes(commandId)
            ? pinnedCommands.filter(id => id !== commandId)
            : [...pinnedCommands, commandId];
        setPinnedCommands(updated);
        localStorage.setItem('pinnedCommands', JSON.stringify(updated));
    };

    const filteredCommands = useMemo(() => {
        if (!query) {
            // Show pinned and recent commands
            const pinned = commands.filter(cmd => pinnedCommands.includes(cmd.id));
            const recent = commands.filter(cmd => 
                recentCommands.includes(cmd.id) && !pinnedCommands.includes(cmd.id)
            );
            const others = commands.filter(cmd => 
                !recentCommands.includes(cmd.id) && !pinnedCommands.includes(cmd.id)
            );
            return [...pinned, ...recent, ...others];
        }

        // Fuzzy search
        const lowerQuery = query.toLowerCase();
        return commands.filter(cmd => {
            const searchText = [
                cmd.label,
                cmd.description || '',
                ...(cmd.keywords || [])
            ].join(' ').toLowerCase();

            return searchText.includes(lowerQuery);
        }).sort((a, b) => {
            // Prioritize label matches
            const aLabelMatch = a.label.toLowerCase().includes(lowerQuery);
            const bLabelMatch = b.label.toLowerCase().includes(lowerQuery);
            if (aLabelMatch && !bLabelMatch) return -1;
            if (!aLabelMatch && bLabelMatch) return 1;
            return 0;
        });
    }, [query, commands, recentCommands, pinnedCommands]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (filteredCommands[selectedIndex]) {
                        filteredCommands[selectedIndex].action();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, selectedIndex, filteredCommands, onClose]);

    // Auto-scroll selected item into view
    useEffect(() => {
        const element = document.getElementById(`command-${selectedIndex}`);
        element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [selectedIndex]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black bg-opacity-50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Search Input */}
                <div className="flex items-center gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
                    <Search size={20} className="text-gray-400" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelectedIndex(0);
                        }}
                        placeholder="Type a command or search..."
                        className="flex-1 bg-transparent outline-none text-lg"
                        autoFocus
                    />
                    <kbd className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded">Esc</kbd>
                </div>

                {/* Results */}
                <div className="max-h-96 overflow-y-auto">
                    {filteredCommands.length === 0 ? (
                        <div className="p-8 text-center text-gray-400">
                            <p>No commands found</p>
                        </div>
                    ) : (
                        <div className="py-2">
                            {!query && recentCommands.length > 0 && (
                                <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">
                                    Recent
                                </div>
                            )}
                            {filteredCommands.map((cmd, index) => (
                                <div
                                    key={cmd.id}
                                    id={`command-${index}`}
                                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                                        index === selectedIndex
                                            ? 'bg-blue-50 dark:bg-blue-900 dark:bg-opacity-30'
                                            : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                                    }`}
                                    onClick={() => cmd.action()}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center text-blue-500">
                                        {cmd.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium">{cmd.label}</div>
                                        {cmd.description && (
                                            <div className="text-sm text-gray-500 truncate">
                                                {cmd.description}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                togglePin(cmd.id);
                                            }}
                                            className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
                                                pinnedCommands.includes(cmd.id)
                                                    ? 'text-yellow-500'
                                                    : 'text-gray-400'
                                            }`}
                                            title={pinnedCommands.includes(cmd.id) ? 'Unpin' : 'Pin'}
                                        >
                                            <Star size={14} fill={pinnedCommands.includes(cmd.id) ? 'currentColor' : 'none'} />
                                        </button>
                                        <span className="text-xs text-gray-400 uppercase bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                                            {cmd.category}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-center gap-4 text-xs text-gray-500">
                    <span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">↑</kbd>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded ml-1">↓</kbd>
                        <span className="ml-2">Navigate</span>
                    </span>
                    <span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">Enter</kbd>
                        <span className="ml-2">Execute</span>
                    </span>
                    <span>
                        <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">Esc</kbd>
                        <span className="ml-2">Close</span>
                    </span>
                </div>
            </div>
        </div>
    );
};
