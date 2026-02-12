import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getParentPath, getPathLabel } from '../utils/path';

export interface FileEntry {
    name: string;
    path: string;
    is_directory: boolean;
    size: number;
    modified_at: number;
    tags?: Tag[]; // Added tags to file entry
}

export interface FileInfo {
    name: string;
    path: string;
    is_directory: boolean;
    size: number;
    created_at?: number;
    modified_at?: number;
    accessed_at?: number;
    readonly: boolean;
}

export interface IndexStatus {
    total_files: number;
    processed_files: number;
    current_path: string;
    is_indexing: boolean;
    percentage_complete: number;
    estimated_time_remaining_secs: number;
}

// Stage 5: Content Extraction & Semantic Search types
export interface ExtractionStatus {
    is_extracting: boolean;
    is_paused: boolean;
    total_files: number;
    processed_files: number;
    failed_files: number;
    current_file: string;
}

export interface ExtractionStats {
    total_files: number;
    extracted_files: number;
    failed_files: number;
    embedded_files: number;
    pending_files: number;
}

export interface AiStatus {
    ollama_running: boolean;
    model_available: boolean;
    model_name: string;
    provider_url: string;
}

export interface HybridSearchResult {
    path: string;
    name: string;
    extension?: string;
    size_bytes: number;
    modified_at: number;
    keyword_score?: number;
    semantic_score?: number;
    combined_score: number;
    snippet?: string;
    chunk_index?: number;
    char_offset?: number;
    source: string;
}

// Stage 6 Types
export interface Tag {
    id: number;
    file_id: number;
    tag: string;
    source: 'ai' | 'user' | 'rule';
    confidence: number;
    created_at: string;
}

export interface Activity {
    id?: number; // DB id might not always be needed in frontend list if just log
    file_path: string;
    action: string;
    detected_at: string; // ISO string from backend datetime('now')
}

export interface ActivityFilters {
    time_range?: string;
    action_type?: string[];
    folder?: string;
    file_type?: string[];
    limit?: number;
}

export interface Rule {
    id: number;
    name: string;
    condition_json: string;
    action_json: string;
    enabled: boolean;
    trigger: string;
    schedule_cron?: string | null;
}

interface FileStore {
    currentPath: string;
    files: FileEntry[];
    viewMode: 'grid' | 'list';
    sortField: 'name' | 'size' | 'date' | 'type';
    sortDirection: 'asc' | 'desc';

    currentView: 'browser' | 'dashboard' | 'duplicates' | 'semantic-search' | 'activity' | 'organize' | 'rules' | 'trash' | 'chat';
    selectedFile: FileEntry | null; // Primary selection (last clicked)
    selectedFiles: FileEntry[]; // All selected files
    previewInfo: FileInfo | null;
    isLoading: boolean;
    error: string | null;

    isSettingsOpen: boolean;
    toggleSettings: () => void;

    setCurrentPath: (path: string) => Promise<void>;
    loadFiles: (path: string) => Promise<void>;
    setViewMode: (mode: 'grid' | 'list') => void;
    setSort: (field: 'name' | 'size' | 'date' | 'type') => void;

    // Sort helper
    getSortedFiles: () => FileEntry[];
    setCurrentView: (view: 'browser' | 'dashboard' | 'duplicates' | 'semantic-search' | 'activity' | 'organize' | 'rules' | 'trash' | 'chat') => void;
    selectFile: (file: FileEntry | null, multi?: boolean, range?: boolean) => Promise<void>;
    selectAll: () => void;
    clearSelection: () => void;
    navigateUp: () => Promise<void>;

    // Tabs
    tabs: { path: string; label: string; history: string[]; historyIndex: number }[];
    activeTabIndex: number;
    addTab: (path?: string) => void;
    closeTab: (index: number) => void;
    setActiveTab: (index: number) => void;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;

    // Indexing
    indexingStatus: IndexStatus | null;
    settings: {
        indexedPaths: string[];
    };
    setIndexingStatus: (status: IndexStatus) => void;
    addIndexedPath: (path: string) => Promise<void>;
    removeIndexedPath: (path: string) => Promise<void>;
    loadIndexedPaths: () => Promise<void>;
    startIndexing: () => Promise<void>;
    pauseIndexing: () => Promise<void>;
    resumeIndexing: () => Promise<void>;

    // Stage 5: Extraction
    extractionStatus: ExtractionStatus | null;
    setExtractionStatus: (status: ExtractionStatus | null) => void;
    startContentExtraction: () => Promise<void>;
    pauseContentExtraction: () => Promise<void>;
    resumeContentExtraction: () => Promise<void>;

    // Semantic Search
    searchResults: HybridSearchResult[];
    searchQuery: string;
    isSearching: boolean;
    performSearch: (query: string, type: 'hybrid' | 'semantic' | 'keyword') => Promise<void>;

    // Stage 6: Tagging
    fileTags: Tag[];
    loadTagsForFile: (fileId: number) => Promise<void>;
    addTag: (fileId: number, tag: string) => Promise<void>;
    removeTag: (tagId: number) => Promise<void>;
    autoTagFile: (fileId: number) => Promise<void>;
    availableTags: string[];
    loadAllTags: () => Promise<void>;

    // Stage 6: Activity
    activityFeed: Activity[];
    loadActivityFeed: (filters?: ActivityFilters) => Promise<void>;

    rules: Rule[];
    loadRules: () => Promise<void>;
    saveRule: (rule: Rule) => Promise<void>;
    deleteRule: (ruleId: number) => Promise<void>;

    // Stage 10: Preview & Power Features
    previewPanelOpen: boolean;
    quickLookOpen: boolean;
    commandPaletteOpen: boolean;
    shortcutsCheatSheetOpen: boolean;
    
    togglePreviewPanel: () => void;
    openQuickLook: () => void;
    closeQuickLook: () => void;
    toggleCommandPalette: () => void;
    toggleShortcutsCheatSheet: () => void;
}

export const useFileStore = create<FileStore>((set, get) => ({
    currentPath: '',
    files: [],
    viewMode: 'grid',
    sortField: 'name',
    sortDirection: 'asc',

    currentView: 'browser',
    selectedFile: null,
    selectedFiles: [],
    previewInfo: null,
    isLoading: false,
    error: null,
    isSettingsOpen: false,
    toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

    // Tabs
    tabs: [{ path: '', label: 'Home', history: [''], historyIndex: 0 }],
    activeTabIndex: 0,

    addTab: (path: string = '') => {
        const { tabs } = get();
        const newTab = {
            path,
            label: getPathLabel(path),
            history: [path],
            historyIndex: 0
        };
        set({ tabs: [...tabs, newTab], activeTabIndex: tabs.length });
        get().loadFiles(path); // Load for new tab
    },

    closeTab: (index: number) => {
        const { tabs, activeTabIndex } = get();
        if (tabs.length <= 1) return; // Don't close last tab

        const newTabs = tabs.filter((_, i) => i !== index);
        let newIndex = activeTabIndex;

        if (index < activeTabIndex) {
            newIndex = activeTabIndex - 1;
        } else if (index === activeTabIndex) {
            newIndex = Math.max(0, index - 1);
        } else {
            // Closed tab was to the right, index stays same
            newIndex = activeTabIndex;
        }

        // Safety clamp
        if (newIndex >= newTabs.length) newIndex = newTabs.length - 1;

        set({ tabs: newTabs, activeTabIndex: newIndex });
        get().loadFiles(newTabs[newIndex].path);
    },

    setActiveTab: (index: number) => {
        set({ activeTabIndex: index });
        const { tabs } = get();
        if (tabs[index]) {
            // Load regardless to refresh view
            set({ currentPath: tabs[index].path }); // Sync currentPath immediately
            get().loadFiles(tabs[index].path);
        }

        // When >10 tabs, trim history of inactive tabs to save memory
        if (tabs.length > 10) {
            const MAX_INACTIVE_HISTORY = 5;
            const trimmed = tabs.map((tab, i) => {
                if (i === index) return tab; // keep active tab intact
                if (tab.history.length > MAX_INACTIVE_HISTORY) {
                    // Keep only the last MAX_INACTIVE_HISTORY entries
                    const trimStart = tab.history.length - MAX_INACTIVE_HISTORY;
                    return {
                        ...tab,
                        history: tab.history.slice(trimStart),
                        historyIndex: Math.max(0, tab.historyIndex - trimStart),
                    };
                }
                return tab;
            });
            set({ tabs: trimmed });
        }
    },

    // Modified to update current tab and history
    setCurrentPath: async (path: string) => {
        const { tabs, activeTabIndex } = get();
        const activeTab = tabs[activeTabIndex];

        if (!activeTab) return;

        // Verify if we are actually changing path to avoid history dupes if called redundantly
        if (activeTab.path === path) {
            // Just reload
            await get().loadFiles(path);
            return;
        }

        const newTabs = [...tabs];
        const newHistory = activeTab.history.slice(0, activeTab.historyIndex + 1);
        newHistory.push(path);

        newTabs[activeTabIndex] = {
            ...activeTab,
            path: path,
            label: getPathLabel(path),
            history: newHistory,
            historyIndex: newHistory.length - 1
        };

        set({ tabs: newTabs }); // Update tabs state

        // Also update legacy currentPath for backward compat if anyone uses it directly (Layout uses it)
        set({ currentPath: path });
        await get().loadFiles(path);
    },

    goBack: async () => {
        const { tabs, activeTabIndex } = get();
        const activeTab = tabs[activeTabIndex];
        if (!activeTab || activeTab.historyIndex <= 0) return;

        const newIndex = activeTab.historyIndex - 1;
        const newPath = activeTab.history[newIndex];

        const newTabs = [...tabs];
        newTabs[activeTabIndex] = {
            ...activeTab,
            path: newPath,
            label: getPathLabel(newPath),
            historyIndex: newIndex
        };

        set({ tabs: newTabs, currentPath: newPath });
        await get().loadFiles(newPath);
    },

    goForward: async () => {
        const { tabs, activeTabIndex } = get();
        const activeTab = tabs[activeTabIndex];
        if (!activeTab || activeTab.historyIndex >= activeTab.history.length - 1) return;

        const newIndex = activeTab.historyIndex + 1;
        const newPath = activeTab.history[newIndex];

        const newTabs = [...tabs];
        newTabs[activeTabIndex] = {
            ...activeTab,
            path: newPath,
            label: getPathLabel(newPath),
            historyIndex: newIndex
        };

        set({ tabs: newTabs, currentPath: newPath });
        await get().loadFiles(newPath);
    },


    loadFiles: async (path: string) => {
        set({ isLoading: true, error: null });
        try {
            const files = await invoke<FileEntry[]>('list_directory', { path });
            try {
                const tagsMap = await invoke<Record<string, Tag[]>>('get_tags_for_directory', { path });
                const filesWithTags = files.map(f => ({
                    ...f,
                    tags: tagsMap[f.name] || []
                }));
                set({ files: filesWithTags, isLoading: false });
            } catch (tagErr) {
                console.warn("Failed to load tags for directory:", tagErr);
                set({ files, isLoading: false });
            }
        } catch (err) {
            set({ error: String(err), isLoading: false });
        }
    },

    setViewMode: (mode) => set({ viewMode: mode }),

    setSort: (field) => {
        const currentField = get().sortField;
        const currentDir = get().sortDirection;

        if (currentField === field) {
            set({ sortDirection: currentDir === 'asc' ? 'desc' : 'asc' });
        } else {
            set({ sortField: field, sortDirection: 'asc' });
        }
    },

    getSortedFiles: () => {
        const { files, sortField, sortDirection } = get();
        const sorted = [...files].sort((a, b) => {
            // Always directories first
            if (a.is_directory !== b.is_directory) {
                return a.is_directory ? -1 : 1;
            }

            let compare = 0;
            switch (sortField) {
                case 'name':
                    compare = a.name.localeCompare(b.name);
                    break;
                case 'size':
                    compare = a.size - b.size;
                    break;
                case 'date':
                    compare = a.modified_at - b.modified_at;
                    break;
                case 'type':
                    // Extension sort
                    const extA = a.name.split('.').pop() || '';
                    const extB = b.name.split('.').pop() || '';
                    compare = extA.localeCompare(extB);
                    break;
            }
            return sortDirection === 'asc' ? compare : -compare;
        });
        return sorted;
    },
    setCurrentView: (view) => set({ currentView: view }),

    selectFile: async (file, multi = false, range = false) => {
        const { selectedFiles, selectedFile } = get();

        let newSelection: FileEntry[] = [];

        if (!file) {
            newSelection = [];
            set({ selectedFile: null, selectedFiles: [], previewInfo: null, fileTags: [] });
            return;
        }

        if (range && selectedFile) {
            // Range selection (Shift+Click)
            const sorted = get().getSortedFiles(); // Use current sorted view
            const idx1 = sorted.findIndex(f => f.path === selectedFile.path);
            const idx2 = sorted.findIndex(f => f.path === file.path);

            if (idx1 !== -1 && idx2 !== -1) {
                const start = Math.min(idx1, idx2);
                const end = Math.max(idx1, idx2);
                newSelection = sorted.slice(start, end + 1);
            } else {
                newSelection = [file];
            }
        } else if (multi) {
            // Multi selection (Ctrl+Click)
            const exists = selectedFiles.some(f => f.path === file.path);
            if (exists) {
                newSelection = selectedFiles.filter(f => f.path !== file.path);
            } else {
                newSelection = [...selectedFiles, file];
            }
        } else {
            // Single selection
            newSelection = [file];
        }

        set({ selectedFile: file, selectedFiles: newSelection, previewInfo: null, fileTags: [] });

        // Update preview only if single file selected (or last clicked is significant)
        // If multiple, maybe show summary? For now, show info for the last clicked one (primary)
        if (file && !file.is_directory) {
            try {
                const info = await invoke<FileInfo>('get_file_info', { path: file.path });
                set({ previewInfo: info });
                // We assume ID fetching is handled where needed (auto-fetch not implemented yet)
            } catch (err) {
                console.error('Failed to get file info:', err);
            }
        } else if (newSelection.length > 1) {
            // Maybe clear preview or show summary?
            set({ previewInfo: null });
        }
    },

    selectAll: () => {
        const sorted = get().getSortedFiles();
        set({ selectedFiles: sorted, selectedFile: sorted[sorted.length - 1] || null });
    },

    clearSelection: () => {
        set({ selectedFiles: [], selectedFile: null, previewInfo: null });
    },

    navigateUp: async () => {
        const current = get().currentPath;
        if (!current) return;
        const parent = getParentPath(current);
        if (parent === null) return;
        await get().setCurrentPath(parent);
    },

    // Indexing & Settings
    indexingStatus: null as IndexStatus | null,
    settings: {
        indexedPaths: [],
    },

    setIndexingStatus: (status: IndexStatus) => set({ indexingStatus: status }),

    addIndexedPath: async (path: string) => {
        const currentPaths = get().settings.indexedPaths;
        if (!currentPaths.includes(path)) {
            const newPaths = [...currentPaths, path];
            set({ settings: { ...get().settings, indexedPaths: newPaths } });
            try {
                await invoke('save_app_setting', { key: 'indexed_paths', value: JSON.stringify(newPaths) });
            } catch (err) {
                console.error('Failed to save indexed paths:', err);
            }
        }
    },

    removeIndexedPath: async (path: string) => {
        const newPaths = get().settings.indexedPaths.filter(p => p !== path);
        set({ settings: { ...get().settings, indexedPaths: newPaths } });
        try {
            await invoke('save_app_setting', { key: 'indexed_paths', value: JSON.stringify(newPaths) });
        } catch (err) {
            console.error('Failed to save indexed paths:', err);
        }
    },

    loadIndexedPaths: async () => {
        try {
            const pathsJson = await invoke<string | null>('get_app_setting', { key: 'indexed_paths' });
            if (pathsJson) {
                const paths = JSON.parse(pathsJson) as string[];
                set({ settings: { ...get().settings, indexedPaths: paths } });
            }
        } catch (err) {
            console.error("Failed to load indexed paths:", err);
        }
    },

    startIndexing: async () => {
        await invoke('start_indexing', { paths: get().settings.indexedPaths });
    },

    pauseIndexing: async () => {
        await invoke('pause_indexing');
    },

    resumeIndexing: async () => {
        await invoke('resume_indexing');
    },

    // Stage 5: Extraction
    extractionStatus: null,
    setExtractionStatus: (status) => set({ extractionStatus: status }),

    startContentExtraction: async () => {
        await invoke('start_content_extraction');
    },

    pauseContentExtraction: async () => {
        await invoke('pause_content_extraction');
    },

    resumeContentExtraction: async () => {
        await invoke('resume_content_extraction');
    },

    // Semantic Search
    searchResults: [],
    searchQuery: '',
    isSearching: false,

    performSearch: async (query: string, type: 'hybrid' | 'semantic' | 'keyword') => {
        set({ isSearching: true, searchQuery: query, currentView: 'semantic-search', searchResults: [] });
        try {
            let results: HybridSearchResult[] = [];
            const emptyFilters = {
                file_types: [],
                size_range: null as [number, number] | null,
                date_range: null as [string, string] | null,
                location: null as string | null,
            };
            if (type === 'hybrid') {
                results = await invoke('search_hybrid', { query, limit: 30, filters: emptyFilters });
            } else if (type === 'semantic') {
                results = await invoke('search_semantic', { query, limit: 30 });
            } else {
                // Wrap keyword results in HybridSearchResult
                const keywordResults = await invoke<any[]>('search_keyword', { query, filters: emptyFilters });
                results = keywordResults.map(r => ({
                    ...r,
                    combined_score: r.score, // specific normalization might be needed
                    source: 'keyword'
                }));
            }
            set({ searchResults: results, isSearching: false });
        } catch (err) {
            console.error("Search failed:", err);
            set({ error: String(err), isSearching: false });
        }
    },

    // Stage 6: Tagging
    fileTags: [],
    availableTags: [],

    loadTagsForFile: async (fileId: number) => {
        try {
            const tags = await invoke<Tag[]>('get_tags', { fileId });
            set({ fileTags: tags });
        } catch (err) {
            console.error("Failed to load tags:", err);
        }
    },

    addTag: async (fileId: number, tag: string) => {
        try {
            await invoke('add_tag', { fileId, tag });
            await get().loadTagsForFile(fileId);
            await get().loadAllTags();
        } catch (err) {
            console.error("Failed to add tag:", err);
        }
    },

    removeTag: async (tagId: number) => {
        try {
            await invoke('remove_tag', { tagId });
            // Reload tags for selected file if applicable
            const selected = get().selectedFile;
            if (selected) {
                // We would ideally reload, but we need ID logic sorted
                // Assuming logic elsewhere triggering reload
            }
        } catch (err) {
            console.error("Failed to remove tag:", err);
        }
    },

    autoTagFile: async (fileId: number) => {
        try {
            await invoke('auto_tag_file', { fileId });
            await get().loadTagsForFile(fileId);
        } catch (err) {
            console.error("Failed to auto tag:", err);
        }
    },

    loadAllTags: async () => {
        try {
            const tags = await invoke<string[]>('get_all_tags');
            set({ availableTags: tags });
        } catch (err) {
            console.error("Failed to load all tags:", err);
        }
    },

    // Stage 6: Activity
    activityFeed: [],
    loadActivityFeed: async (filters: ActivityFilters = {}) => {
        try {
            const activity = await invoke<Activity[]>('get_activity_feed', { filters });
            set({ activityFeed: activity });
        } catch (err) {
            console.error("Failed to load activity feed:", err);
        }
    },

    // Stage 6: Rules
    rules: [],
    loadRules: async () => {
        try {
            const rules = await invoke<Rule[]>('get_rules');
            set({ rules });
        } catch (err) {
            console.error("Failed to load rules:", err);
        }
    },
    saveRule: async (rule: Rule) => {
        try {
            await invoke('save_rule', { rule });
            await get().loadRules();
        } catch (err) {
            console.error("Failed to save rule:", err);
        }
    },
    deleteRule: async (ruleId: number) => {
        try {
            await invoke('delete_rule', { ruleId });
            await get().loadRules();
        } catch (err) {
            console.error("Failed to delete rule:", err);
        }
    },

    // Stage 10: Preview & Power Features
    previewPanelOpen: true, // Default open
    quickLookOpen: false,
    commandPaletteOpen: false,
    shortcutsCheatSheetOpen: false,

    togglePreviewPanel: () => {
        set((state) => ({ previewPanelOpen: !state.previewPanelOpen }));
    },

    openQuickLook: () => {
        const { selectedFile } = get();
        if (selectedFile && !selectedFile.is_directory) {
            set({ quickLookOpen: true });
        }
    },

    closeQuickLook: () => {
        set({ quickLookOpen: false });
    },

    toggleCommandPalette: () => {
        set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen }));
    },

    toggleShortcutsCheatSheet: () => {
        set((state) => ({ shortcutsCheatSheetOpen: !state.shortcutsCheatSheetOpen }));
    }
}));
