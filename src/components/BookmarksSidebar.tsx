// Stage 10: Bookmarks & Quick Access Component
import { useState, useEffect, useRef } from 'react';
import { Star, Folder, Clock, Pin, X, Plus, GripVertical, File } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Bookmark {
    path: string;
    name: string;
    order: number;
}

interface RecentFile {
    name: string;
    path: string;
    is_directory: boolean;
    size: number;
    modified_at: number;
}

interface BookmarksSidebarProps {
    onNavigate: (path: string) => void;
}

export const BookmarksSidebar = ({ onNavigate }: BookmarksSidebarProps) => {
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
    const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
    const [showAddBookmark, setShowAddBookmark] = useState(false);
    const [newBookmarkPath, setNewBookmarkPath] = useState('');
    const [newBookmarkName, setNewBookmarkName] = useState('');
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const dragCounter = useRef(0);

    useEffect(() => {
        loadBookmarks();
        loadRecentFiles();
        loadPinnedFiles();
    }, []);

    const loadBookmarks = async () => {
        try {
            const result = await invoke<Bookmark[]>('get_bookmarks');
            setBookmarks(result);
        } catch (error) {
            console.error('Failed to load bookmarks:', error);
        }
    };

    const loadRecentFiles = async () => {
        try {
            const result = await invoke<RecentFile[]>('get_recent_files', { limit: 10 });
            setRecentFiles(result);
        } catch (error) {
            console.error('Failed to load recent files:', error);
        }
    };

    const loadPinnedFiles = async () => {
        try {
            const result = await invoke<string[]>('get_pinned_files');
            setPinnedFiles(result);
        } catch (error) {
            console.error('Failed to load pinned files:', error);
        }
    };

    const unpinFile = async (path: string) => {
        try {
            await invoke('toggle_pin_file', { path });
            loadPinnedFiles();
        } catch (error) {
            console.error('Failed to unpin file:', error);
        }
    };

    const addBookmark = async () => {
        if (!newBookmarkPath || !newBookmarkName) return;

        try {
            await invoke('add_bookmark', {
                path: newBookmarkPath,
                name: newBookmarkName
            });
            setNewBookmarkPath('');
            setNewBookmarkName('');
            setShowAddBookmark(false);
            loadBookmarks();
        } catch (error) {
            console.error('Failed to add bookmark:', error);
            alert('Failed to add bookmark: ' + error);
        }
    };

    const removeBookmark = async (path: string) => {
        try {
            await invoke('remove_bookmark', { path });
            loadBookmarks();
        } catch (error) {
            console.error('Failed to remove bookmark:', error);
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDragIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        // Make the drag image slightly transparent
        if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.style.opacity = '0.5';
        }
    };

    const handleDragEnd = (e: React.DragEvent) => {
        if (e.currentTarget instanceof HTMLElement) {
            e.currentTarget.style.opacity = '1';
        }
        setDragIndex(null);
        setDragOverIndex(null);
        dragCounter.current = 0;
    };

    const handleDragEnter = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        dragCounter.current++;
        setDragOverIndex(index);
    };

    const handleDragLeave = () => {
        dragCounter.current--;
        if (dragCounter.current <= 0) {
            setDragOverIndex(null);
            dragCounter.current = 0;
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        setDragOverIndex(null);
        dragCounter.current = 0;

        if (dragIndex === null || dragIndex === dropIndex) return;

        // Reorder locally
        const reordered = [...bookmarks];
        const [moved] = reordered.splice(dragIndex, 1);
        reordered.splice(dropIndex, 0, moved);
        setBookmarks(reordered);
        setDragIndex(null);

        // Persist to backend
        try {
            const orderedPaths = reordered.map(b => b.path);
            await invoke('reorder_bookmarks', { orderedPaths });
        } catch (error) {
            console.error('Failed to reorder bookmarks:', error);
            loadBookmarks(); // Reload on failure
        }
    };

    const formatFileSize = (bytes: number): string => {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    };

    const formatRelativeTime = (timestamp: number): string => {
        const now = Date.now() / 1000;
        const diff = now - timestamp;
        
        if (diff < 60) return 'Just now';
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
        return new Date(timestamp * 1000).toLocaleDateString();
    };

    return (
        <div className="w-64 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col h-full overflow-y-auto">
            {/* Bookmarks Section */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Star size={16} className="text-yellow-500" />
                        Quick Access
                    </h3>
                    <button
                        onClick={() => setShowAddBookmark(!showAddBookmark)}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                        title="Add Bookmark"
                    >
                        {showAddBookmark ? <X size={14} /> : <Plus size={14} />}
                    </button>
                </div>

                {showAddBookmark && (
                    <div className="mb-3 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 space-y-2">
                        <input
                            type="text"
                            placeholder="Bookmark name"
                            value={newBookmarkName}
                            onChange={(e) => setNewBookmarkName(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-transparent"
                        />
                        <input
                            type="text"
                            placeholder="Folder path"
                            value={newBookmarkPath}
                            onChange={(e) => setNewBookmarkPath(e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-transparent"
                        />
                        <button
                            onClick={addBookmark}
                            className="w-full px-2 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            Add
                        </button>
                    </div>
                )}

                <div className="space-y-1">
                    {bookmarks.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No bookmarks yet</p>
                    ) : (
                        bookmarks.map((bookmark, index) => (
                            <div
                                key={bookmark.path}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragEnd={handleDragEnd}
                                onDragEnter={(e) => handleDragEnter(e, index)}
                                onDragLeave={handleDragLeave}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, index)}
                                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                                    dragOverIndex === index && dragIndex !== index
                                        ? 'bg-blue-100 dark:bg-blue-900/30 border border-blue-400 border-dashed'
                                        : 'hover:bg-gray-200 dark:hover:bg-gray-800 border border-transparent'
                                }`}
                                onClick={() => onNavigate(bookmark.path)}
                            >
                                <GripVertical
                                    size={12}
                                    className="text-gray-400 opacity-0 group-hover:opacity-100 flex-shrink-0 cursor-grab active:cursor-grabbing"
                                />
                                <Folder size={14} className="text-blue-500 flex-shrink-0" />
                                <span className="text-sm flex-1 truncate">{bookmark.name}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeBookmark(bookmark.path);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                                    title="Remove bookmark"
                                >
                                    <X size={12} className="text-red-500" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Pinned Files Section */}
            {pinnedFiles.length > 0 && (
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                        <Pin size={16} className="text-blue-500" />
                        Pinned Files
                    </h3>
                    <div className="space-y-1">
                        {pinnedFiles.map((filePath) => {
                            const fileName = filePath.split(/[\\/]/).pop() || filePath;
                            const isDir = !fileName.includes('.');
                            return (
                                <div
                                    key={filePath}
                                    className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer"
                                    onClick={() => onNavigate(filePath)}
                                    title={filePath}
                                >
                                    {isDir ? (
                                        <Folder size={14} className="text-blue-500 flex-shrink-0" />
                                    ) : (
                                        <File size={14} className="text-gray-400 flex-shrink-0" />
                                    )}
                                    <span className="text-sm flex-1 truncate">{fileName}</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            unpinFile(filePath);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                                        title="Unpin"
                                    >
                                        <X size={12} className="text-red-500" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Pinned Files Section */}
            {pinnedFiles.length > 0 && (
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                        <Pin size={16} className="text-blue-500" />
                        Pinned Files
                    </h3>
                    <div className="space-y-1">
                        {pinnedFiles.map((filePath) => {
                            const fileName = filePath.split(/[\\/]/).pop() || filePath;
                            const isDir = !fileName.includes('.');
                            return (
                                <div
                                    key={filePath}
                                    className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer"
                                    onClick={() => onNavigate(filePath)}
                                    title={filePath}
                                >
                                    {isDir ? (
                                        <Folder size={14} className="text-blue-500 flex-shrink-0" />
                                    ) : (
                                        <File size={14} className="text-gray-400 flex-shrink-0" />
                                    )}
                                    <span className="text-sm flex-1 truncate">{fileName}</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            unpinFile(filePath);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                                        title="Unpin"
                                    >
                                        <X size={12} className="text-red-500" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Recent Files Section */}
            <div className="p-4">
                <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                    <Clock size={16} className="text-gray-500" />
                    Recent Files
                </h3>
                <div className="space-y-1">
                    {recentFiles.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">No recent files</p>
                    ) : (
                        recentFiles.map((file) => (
                            <div
                                key={file.path}
                                className="group flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer"
                                onClick={() => onNavigate(file.path)}
                            >
                                {file.is_directory ? (
                                    <Folder size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
                                ) : (
                                    <div className="w-3.5 h-3.5 flex-shrink-0 mt-0.5">
                                        <div className="w-full h-full bg-gray-300 dark:bg-gray-600 rounded" />
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm truncate">{file.name}</div>
                                    <div className="text-xs text-gray-500 flex items-center gap-2">
                                        {!file.is_directory && <span>{formatFileSize(file.size)}</span>}
                                        <span>•</span>
                                        <span>{formatRelativeTime(file.modified_at)}</span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
