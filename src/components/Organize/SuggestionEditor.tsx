import React, { useState } from 'react';
import { FileMove, SuggestionPlan } from './SuggestionCard';

interface SuggestionEditorProps {
    initialPlan: SuggestionPlan;
    onSave: (updatedPlan: SuggestionPlan) => void;
    onCancel: () => void;
}

const SuggestionEditor: React.FC<SuggestionEditorProps> = ({ initialPlan, onSave, onCancel }) => {
    const [moves, setMoves] = useState<FileMove[]>(initialPlan.moves);

    const getParentPath = (path: string) => path.replace(/[/\\][^/\\]*$/, '');
    const getFileName = (path: string) => path.split(/[/\\]/).pop() || path;
    const joinPath = (base: string, name: string) => {
        const sep = base.includes('\\') ? '\\' : '/';
        const trimmed = base.replace(/[\\/]+$/, '');
        return `${trimmed}${sep}${name}`;
    };

    const destinationFolders = Array.from(
        new Set(moves.map((move) => getParentPath(move.new_path)).filter(Boolean))
    );

    const handleRemoveMove = (index: number) => {
        setMoves(prev => prev.filter((_, i) => i !== index));
    };

    const handlePathChange = (index: number, field: 'new_path', value: string) => {
        setMoves(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const handleSave = () => {
        onSave({ ...initialPlan, moves });
    };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-8 z-50">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-full flex flex-col border border-gray-700">
                <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-white">Modify Suggestion Plan</h2>
                    <button onClick={onCancel} className="text-gray-400 hover:text-white">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                            <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">Files</div>
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {moves.map((move, idx) => (
                                    <div
                                        key={idx}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData('text/plain', String(idx));
                                        }}
                                        className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 cursor-move"
                                        title={move.file_path}
                                    >
                                        {getFileName(move.file_path)}
                                    </div>
                                ))}
                                {moves.length === 0 && (
                                    <div className="text-gray-500 text-sm">No files in this plan.</div>
                                )}
                            </div>
                        </div>

                        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
                            <div className="text-xs text-gray-400 uppercase tracking-wider mb-3">Destinations</div>
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                {destinationFolders.map((folder) => (
                                    <div
                                        key={folder}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                            const idx = Number(e.dataTransfer.getData('text/plain'));
                                            if (Number.isNaN(idx)) return;
                                            setMoves((prev) => {
                                                const next = [...prev];
                                                const fileName = getFileName(next[idx].file_path);
                                                next[idx] = {
                                                    ...next[idx],
                                                    new_path: joinPath(folder, fileName),
                                                };
                                                return next;
                                            });
                                        }}
                                        className="bg-gray-900 border border-dashed border-gray-600 rounded px-3 py-2 text-xs text-gray-300"
                                        title={folder}
                                    >
                                        {folder}
                                    </div>
                                ))}
                                {destinationFolders.length === 0 && (
                                    <div className="text-gray-500 text-sm">No destination folders yet.</div>
                                )}
                            </div>
                            <div className="text-[10px] text-gray-500 mt-2">
                                Drag files onto a destination to update their target folder.
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {moves.map((move, idx) => (
                            <div key={idx} className="flex gap-4 items-start bg-gray-800 p-3 rounded border border-gray-700">
                                <button
                                    onClick={() => handleRemoveMove(idx)}
                                    className="text-red-500 hover:text-red-400 mt-1"
                                    title="Remove this operation"
                                >
                                    ✕
                                </button>
                                <div className="flex-1 grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Source</label>
                                        <div className="text-sm text-gray-300 truncate" title={move.file_path}>
                                            {move.file_path}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 mb-1">Destination</label>
                                        <input
                                            type="text"
                                            value={move.new_path}
                                            onChange={(e) => handlePathChange(idx, 'new_path', e.target.value)}
                                            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-green-400 focus:outline-none focus:border-blue-500"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {moves.length === 0 && (
                        <div className="text-center text-gray-500 py-12">
                            No moves remaining. Reject the suggestion instead?
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-800 bg-gray-900 flex justify-end gap-3 rounded-b-xl">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-300 hover:text-white"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold"
                    >
                        Save & Update Plan
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SuggestionEditor;
