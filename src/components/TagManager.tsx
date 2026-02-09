import React, { useEffect, useState } from 'react';
import { useFileStore } from '../store/fileStore';
import { invoke } from '@tauri-apps/api/core';

interface TagManagerProps {
    filePath: string;
    onClose: () => void;
}

export const TagManager: React.FC<TagManagerProps> = ({ filePath, onClose }) => {
    const { fileTags, loadTagsForFile, addTag, removeTag, autoTagFile, availableTags, loadAllTags } = useFileStore();
    const [fileId, setFileId] = useState<number | null>(null);
    const [newTag, setNewTag] = useState('');
    const [isAutoTagging, setIsAutoTagging] = useState(false);

    useEffect(() => {
        const fetchId = async () => {
            try {
                const id = await invoke<number | null>('get_file_db_id', { path: filePath });
                if (id) {
                    setFileId(id);
                    loadTagsForFile(id);
                    loadAllTags();
                } else {
                    console.error("File ID not found for path:", filePath);
                }
            } catch (err) {
                console.error("Failed to get file ID:", err);
            }
        };
        fetchId();
    }, [filePath]);

    const handleAddTag = async () => {
        if (!fileId || !newTag.trim()) return;
        await addTag(fileId, newTag);
        setNewTag('');
    };

    const handleRemoveTag = async (tagId: number) => {
        if (!fileId) return;
        await removeTag(tagId);
        loadTagsForFile(fileId); // Refresh
    };

    const handleAutoTag = async () => {
        if (!fileId) return;
        setIsAutoTagging(true);
        await autoTagFile(fileId);
        setIsAutoTagging(false);
    };

    return (
        <div className="p-4 bg-gray-800 rounded-lg shadow-lg border border-gray-700 w-80">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-white">Manage Tags</h3>
                <button onClick={onClose} className="text-gray-400 hover:text-white">&times;</button>
            </div>

            <div className="mb-4">
                <div className="flex flex-wrap gap-2 mb-2">
                    {fileTags.map(tag => (
                        <span key={tag.id} className={`px-2 py-1 rounded text-sm flex items-center gap-1 ${tag.source === 'ai' ? 'bg-blue-900 text-blue-200' : 'bg-green-900 text-green-200'}`}>
                            {tag.tag}
                            <button onClick={() => handleRemoveTag(tag.id)} className="hover:text-red-400 ml-1">&times;</button>
                        </span>
                    ))}
                    {fileTags.length === 0 && <span className="text-gray-500 text-sm">No tags yet.</span>}
                </div>
            </div>

            <div className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="Add tag..."
                    className="flex-1 bg-gray-700 text-white rounded px-2 py-1 border border-gray-600 focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    list="available-tags"
                />
                <datalist id="available-tags">
                    {availableTags.map(t => <option key={t} value={t} />)}
                </datalist>
                <button onClick={handleAddTag} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded">Add</button>
            </div>

            <button
                onClick={handleAutoTag}
                disabled={isAutoTagging}
                className={`w-full py-2 rounded flex justify-center items-center gap-2 ${isAutoTagging ? 'bg-gray-600 cursor-wait' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}
            >
                {isAutoTagging ? 'Analyzing...' : '✨ Auto-Tag with AI'}
            </button>
            {isAutoTagging && <p className="text-xs text-center mt-2 text-gray-400">This may take a few seconds...</p>}
        </div>
    );
};
