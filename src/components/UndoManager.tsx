import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RotateCcw, RotateCw, History } from 'lucide-react';

interface OperationHistoryItem {
    batch_id: string;
    operation: string;
    file_count: number;
    description: string;
    performed_at: string;
    undone: boolean;
}

export const UndoManager: React.FC = () => {
    const [history, setHistory] = useState<OperationHistoryItem[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [bulkCount, setBulkCount] = useState(1);

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen]);

    const loadHistory = async () => {
        try {
            const res = await invoke<OperationHistoryItem[]>('get_operation_history');
            setHistory(res);
        } catch (e) {
            console.error(e);
        }
    };

    const handleUndo = async (batchId: string) => {
        try {
            await invoke('undo_operation', { batchId });
            loadHistory();
        } catch (e) {
            alert('Failed to undo: ' + e);
        }
    };

    const handleRedo = async (batchId: string) => {
        try {
            await invoke('redo_operation', { batchId });
            loadHistory();
        } catch (e) {
            alert('Failed to redo: ' + e);
        }
    };

    const handleUndoLast = async () => {
        try {
            await invoke('undo_last_operations', { count: bulkCount });
            loadHistory();
        } catch (e) {
            alert('Failed to undo: ' + e);
        }
    };

    return (
        <div className="relative z-50">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 hover:bg-gray-700 rounded text-gray-300"
                title="Operation History"
            >
                <History size={18} />
            </button>

            {isOpen && (
                <div className="absolute right-0 top-10 w-80 bg-gray-800 border border-gray-700 rounded shadow-xl max-h-96 overflow-y-auto">
                    <div className="p-3 border-b border-gray-700 font-semibold text-sm flex justify-between">
                        <span>Recent Operations</span>
                        <div className="flex items-center gap-2">
                            <select
                                value={bulkCount}
                                onChange={(e) => setBulkCount(parseInt(e.target.value, 10))}
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
                            >
                                <option value={1}>Undo 1</option>
                                <option value={3}>Undo 3</option>
                                <option value={5}>Undo 5</option>
                                <option value={10}>Undo 10</option>
                            </select>
                            <button onClick={handleUndoLast} className="text-xs text-blue-400">Run</button>
                            <button onClick={() => loadHistory()} className="text-xs text-blue-400">Refresh</button>
                        </div>
                    </div>
                    {history.length === 0 ? (
                        <div className="p-4 text-center text-gray-500 text-sm">No operations history</div>
                    ) : (
                        <div className="divide-y divide-gray-700">
                            {history.map((op) => (
                                <div key={op.batch_id} className="p-3 hover:bg-gray-750">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="text-sm font-medium text-gray-200">{op.description}</span>
                                        <span className="text-xs text-gray-500">{new Date(op.performed_at).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <div className="text-xs text-gray-500 capitalize">{op.operation.replace(/_/g, ' ')}</div>
                                        {op.undone ? (
                                            <button
                                                onClick={() => handleRedo(op.batch_id)}
                                                className="flex items-center gap-1 px-2 py-1 bg-blue-900/50 hover:bg-blue-900 text-blue-300 text-xs rounded"
                                            >
                                                <RotateCw size={12} /> Redo
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => handleUndo(op.batch_id)}
                                                className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded"
                                            >
                                                <RotateCcw size={12} /> Undo
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
