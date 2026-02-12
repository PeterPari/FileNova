import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Trash2, RotateCcw, CheckSquare, Square, AlertTriangle } from 'lucide-react';

interface TrashItem {
    id: number;
    original_path: string;
    file_name: string;
    file_size: number;
    deleted_at: string;
}

export const TrashManager: React.FC = () => {
    const [items, setItems] = useState<TrashItem[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        loadTrash();
    }, []);

    const loadTrash = async () => {
        setIsLoading(true);
        try {
            const result = await invoke<TrashItem[]>('get_trash_contents');
            setItems(result);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleRestore = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`Restore ${selectedIds.size} items?`)) return;

        try {
            await invoke('restore_from_trash', { fileIds: Array.from(selectedIds) });
            setSelectedIds(new Set());
            loadTrash();
        } catch (e) {
            alert('Failed to restore items: ' + e);
        }
    };

    const handleEmptyTrash = async () => {
        if (!confirm('Are you sure you want to permanently delete all items in the trash? This cannot be undone.')) return;

        try {
            await invoke('empty_trash');
            setItems([]);
            setSelectedIds(new Set());
        } catch (e) {
            alert('Failed to empty trash: ' + e);
        }
    };

    const toggleSelect = (id: number) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === items.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(items.map(i => i.id)));
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 text-white">
            <div className="flex justify-between items-center p-4 border-b border-gray-700">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Trash2 size={24} className="text-red-400" /> Trash Bin
                </h2>
                <div className="flex gap-2">
                    <button
                        onClick={handleRestore}
                        disabled={selectedIds.size === 0}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors"
                    >
                        <RotateCcw size={16} /> Restore Selected
                    </button>
                    <button
                        onClick={handleEmptyTrash}
                        disabled={items.length === 0}
                        className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors"
                    >
                        <AlertTriangle size={16} /> Empty Trash
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {isLoading ? (
                    <div className="text-center text-gray-500 mt-10">Loading trash...</div>
                ) : items.length === 0 ? (
                    <div className="text-center text-gray-500 mt-10">
                        Trash is empty.
                    </div>
                ) : (
                    <div className="space-y-1">
                        <div className="flex items-center p-2 text-xs font-semibold text-gray-400 border-b border-gray-700 mb-2">
                            <div className="w-8 flex justify-center cursor-pointer" onClick={toggleSelectAll}>
                                {selectedIds.size === items.length ? <CheckSquare size={16} /> : <Square size={16} />}
                            </div>
                            <div className="flex-1">File Name</div>
                            <div className="w-32">Original Location</div>
                            <div className="w-24 text-right">Size</div>
                            <div className="w-32 text-right">Deleted At</div>
                        </div>
                        {items.map(item => (
                            <div
                                key={item.id}
                                className={`flex items-center p-2 rounded hover:bg-gray-800 transition-colors ${selectedIds.has(item.id) ? 'bg-gray-800/50' : ''}`}
                                onClick={() => toggleSelect(item.id)}
                            >
                                <div className="w-8 flex justify-center text-gray-400">
                                    {selectedIds.has(item.id) ? <CheckSquare size={16} className="text-blue-400" /> : <Square size={16} />}
                                </div>
                                <div className="flex-1 truncate pr-4 font-medium" title={item.file_name}>
                                    {item.file_name}
                                </div>
                                <div className="w-32 truncate text-xs text-gray-500" title={item.original_path}>
                                    {item.original_path}
                                </div>
                                <div className="w-24 text-right text-xs text-gray-400">
                                    {formatSize(item.file_size)}
                                </div>
                                <div className="w-32 text-right text-xs text-gray-500">
                                    {new Date(item.deleted_at).toLocaleString()}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
