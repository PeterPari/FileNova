import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface DuplicateFileEntry {
    id: number;
    file_id: number;
    name: string;
    path: string;
    size: number;
    modified_at: number;
    parent_path: string;
}

export interface DuplicateGroup {
    id: number;
    group_type: 'exact' | 'perceptual';
    hash_blake3: string | null;
    file_count: number;
    total_wasted_bytes: number;
    files: DuplicateFileEntry[];
}

export interface DuplicateSummary {
    total_groups: number;
    total_wasted_bytes: number;
    exact_groups: number;
    perceptual_groups: number;
    smart_groups: number;
}

export interface DuplicateScanStatus {
    phase: string;
    total_groups: number;
    total_wasted_bytes: number;
    files_processed: number;
    total_files: number;
    is_scanning: boolean;
}

export interface BatchResult {
    batch_id: string;
    files_processed: number;
    bytes_recovered: number;
}

export interface OperationBatch {
    batch_id: string;
    file_count: number;
    total_size: number;
    performed_at: string;
}

interface DuplicateStore {
    summary: DuplicateSummary | null;
    groups: DuplicateGroup[];
    scanStatus: DuplicateScanStatus | null;
    selectedGroupId: number | null;
    selectedFilePaths: string[];
    keepFilePath: string | null;
    filterType: string | null;
    recentBatches: OperationBatch[];
    isLoading: boolean;
    error: string | null;

    startScan: () => Promise<void>;
    setScanStatus: (status: DuplicateScanStatus) => void;
    fetchSummary: () => Promise<void>;
    fetchGroups: (type?: string | null) => Promise<void>;
    selectGroup: (groupId: number | null) => void;
    setKeepFile: (path: string) => void;
    toggleFileForDeletion: (path: string) => void;
    selectAllExceptKeep: (groupFiles: DuplicateFileEntry[], keepPath: string) => void;
    deleteSelectedFiles: () => Promise<BatchResult | null>;
    undoBatch: (batchId: string) => Promise<void>;
    fetchRecentBatches: () => Promise<void>;
    setFilterType: (type: string | null) => void;
    autoSelectKeepNewest: (group: DuplicateGroup) => void;
}

export const useDuplicateStore = create<DuplicateStore>((set, get) => ({
    summary: null,
    groups: [],
    scanStatus: null,
    selectedGroupId: null,
    selectedFilePaths: [],
    keepFilePath: null,
    filterType: null,
    recentBatches: [],
    isLoading: false,
    error: null,

    startScan: async () => {
        try {
            await invoke('scan_duplicates');
        } catch (err) {
            set({ error: String(err) });
        }
    },

    setScanStatus: (status) => set({ scanStatus: status }),

    fetchSummary: async () => {
        try {
            const summary = await invoke<DuplicateSummary>('get_duplicate_summary');
            set({ summary });
        } catch (err) {
            set({ error: String(err) });
        }
    },

    fetchGroups: async (type) => {
        set({ isLoading: true });
        try {
            const filterType = type !== undefined ? type : get().filterType;
            const groups = await invoke<DuplicateGroup[]>('get_duplicates', {
                groupType: filterType,
                offset: 0,
                limit: 100,
            });
            set({ groups, isLoading: false });
        } catch (err) {
            set({ error: String(err), isLoading: false });
        }
    },

    selectGroup: (groupId) =>
        set({
            selectedGroupId: groupId,
            selectedFilePaths: [],
            keepFilePath: null,
        }),

    setKeepFile: (path) => {
        const current = get().selectedFilePaths.filter((p) => p !== path);
        set({ keepFilePath: path, selectedFilePaths: current });
    },

    toggleFileForDeletion: (path) => {
        const current = get().selectedFilePaths;
        if (path === get().keepFilePath) return;
        if (current.includes(path)) {
            set({ selectedFilePaths: current.filter((p) => p !== path) });
        } else {
            set({ selectedFilePaths: [...current, path] });
        }
    },

    selectAllExceptKeep: (groupFiles, keepPath) => {
        const toDelete = groupFiles.map((f) => f.path).filter((p) => p !== keepPath);
        set({ keepFilePath: keepPath, selectedFilePaths: toDelete });
    },

    deleteSelectedFiles: async () => {
        const { selectedFilePaths, keepFilePath } = get();
        if (!keepFilePath || selectedFilePaths.length === 0) return null;

        set({ isLoading: true });
        try {
            const result = await invoke<BatchResult>('delete_duplicate_files', {
                filePaths: selectedFilePaths,
                keepPath: keepFilePath,
            });
            await get().fetchSummary();
            await get().fetchGroups();
            await get().fetchRecentBatches();
            set({
                isLoading: false,
                selectedFilePaths: [],
                keepFilePath: null,
                selectedGroupId: null,
            });
            return result;
        } catch (err) {
            set({ error: String(err), isLoading: false });
            return null;
        }
    },

    undoBatch: async (batchId) => {
        try {
            await invoke('undo_batch', { batchId });
            await get().fetchSummary();
            await get().fetchGroups();
            await get().fetchRecentBatches();
        } catch (err) {
            set({ error: String(err) });
        }
    },

    fetchRecentBatches: async () => {
        try {
            const batches = await invoke<OperationBatch[]>('get_recent_operations', {
                limit: 10,
            });
            set({ recentBatches: batches });
        } catch (err) {
            set({ error: String(err) });
        }
    },

    setFilterType: (type) => {
        set({ filterType: type });
        get().fetchGroups(type);
    },

    autoSelectKeepNewest: (group) => {
        if (group.files.length === 0) return;
        const newest = group.files.reduce((a, b) =>
            a.modified_at > b.modified_at ? a : b
        );
        get().selectAllExceptKeep(group.files, newest.path);
    },
}));
