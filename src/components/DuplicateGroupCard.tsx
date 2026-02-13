import { useState } from 'react';
import { ChevronRight, Trash2, Shield, Clock, Image, Hash, FileText } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DuplicateGroup, DuplicateFileEntry, useDuplicateStore } from '../store/duplicateStore';

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(ts: number): string {
    if (!ts) return 'Unknown';
    return new Date(ts * 1000).toLocaleDateString();
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);

function isImageFile(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXTENSIONS.has(ext);
}

const TYPE_BADGE: Record<string, { label: string; color: string; icon: typeof Hash }> = {
    exact: { label: 'Exact', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: Hash },
    perceptual: { label: 'Similar Image', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Image },
    smart: { label: 'Smart Match', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Shield },
};

export const DuplicateGroupCard = ({ group }: { group: DuplicateGroup }) => {
    const [expanded, setExpanded] = useState(false);
    const {
        selectedFilePaths,
        keepFilePath,
        setKeepFile,
        toggleFileForDeletion,
        autoSelectKeepNewest,
        autoSelectKeepInPath,
        selectAllExceptKeep,
        deleteSelectedFiles,
        isLoading,
    } = useDuplicateStore();

    const badge = TYPE_BADGE[group.group_type] || TYPE_BADGE.exact;
    const BadgeIcon = badge.icon;
    const representativeName = group.files.length > 0 ? group.files[0].name : 'Unknown';

    // Check if this group has active selections
    const groupPaths = new Set(group.files.map((f) => f.path));
    const activeKeep = keepFilePath && groupPaths.has(keepFilePath) ? keepFilePath : null;
    const activeDeletes = selectedFilePaths.filter((p) => groupPaths.has(p));

    const handleKeepNewest = () => {
        autoSelectKeepNewest(group);
        setExpanded(true);
    };

    const handleDeleteSelected = async () => {
        if (activeDeletes.length === 0 || !activeKeep) return;
        await deleteSelectedFiles();
    };

    return (
        <div className="bg-base rounded-xl shadow-sm border border-base overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full p-4 flex items-center gap-3 hover:bg-surface-hover transition-colors text-left"
            >
                <ChevronRight
                    size={16}
                    className={`text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
                />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-primary truncate">
                            {representativeName}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                            <BadgeIcon size={10} className="inline mr-1" />
                            {badge.label}
                        </span>
                    </div>
                    <div className="text-xs text-muted mt-1">
                        {group.file_count} copies &middot; {formatSize(group.total_wasted_bytes)} wasted
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleKeepNewest();
                        }}
                        className="text-xs px-3 py-1.5 text-accent-primary rounded-md transition-colors whitespace-nowrap"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}
                    >
                        <Clock size={12} className="inline mr-1" />
                        Newest
                    </button>
                    {/* Unique Folders Actions */}
                    {Array.from(new Set(group.files.map(f => f.parent_path))).slice(0, 2).map(parentPath => {
                        const folderName = parentPath.split(/[\\/]/).pop() || parentPath;
                        return (
                            <button
                                key={parentPath}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    autoSelectKeepInPath(group, parentPath);
                                    setExpanded(true);
                                }}
                                className="text-xs px-3 py-1.5 bg-surface-hover text-secondary rounded-md hover:bg-surface-active transition-colors whitespace-nowrap overflow-hidden max-w-[120px] truncate"
                                title={`Keep file in ${parentPath}`}
                            >
                                Keep in {folderName}
                            </button>
                        );
                    })}
                </div>
            </button>

            {/* Expanded file list */}
            {expanded && (
                <div className="border-t border-base">
                    <div className="divide-y divide-base">
                        {group.files.map((file) => {
                            const isKept = activeKeep === file.path;
                            const isDeleting = activeDeletes.includes(file.path);
                            return (
                                <FileRow
                                    key={file.path}
                                    file={file}
                                    isKept={isKept}
                                    isDeleting={isDeleting}
                                    onKeep={() => {
                                        setKeepFile(file.path);
                                        selectAllExceptKeep(group.files, file.path);
                                    }}
                                    onToggleDelete={() => toggleFileForDeletion(file.path)}
                                />
                            );
                        })}
                    </div>

                    {/* Actions */}
                    {activeKeep && activeDeletes.length > 0 && (
                        <div className="p-3 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
                            <span className="text-xs text-gray-500">
                                Keeping 1, deleting {activeDeletes.length} file{activeDeletes.length > 1 ? 's' : ''}
                            </span>
                            <button
                                onClick={handleDeleteSelected}
                                disabled={isLoading}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-white text-xs rounded-md hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                                <Trash2 size={12} />
                                Delete Selected
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const FileRow = ({
    file,
    isKept,
    isDeleting,
    onKeep,
    onToggleDelete,
}: {
    file: DuplicateFileEntry;
    isKept: boolean;
    isDeleting: boolean;
    onKeep: () => void;
    onToggleDelete: () => void;
}) => {
    let bgClass = '';
    if (isKept) bgClass = 'bg-green-50 dark:bg-green-900/20';
    else if (isDeleting) bgClass = 'bg-red-50 dark:bg-red-900/20';

    return (
        <div className={`flex items-center gap-3 px-4 py-2.5 ${bgClass}`}>
            {/* Keep radio */}
            <button
                onClick={onKeep}
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isKept
                    ? 'border-green-500 bg-green-500'
                    : 'border-gray-300 dark:border-gray-600 hover:border-green-400'
                    }`}
                title="Keep this file"
            >
                {isKept && <Shield size={10} className="text-white" />}
            </button>

            {/* Thumbnail */}
            <div className="w-9 h-9 rounded-md bg-gray-100 dark:bg-gray-700 overflow-hidden flex items-center justify-center flex-shrink-0">
                {isImageFile(file.path) ? (
                    <img
                        src={convertFileSrc(file.path)}
                        alt={file.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <FileText size={16} className="text-gray-400" />
                )}
            </div>

            {/* File info */}
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {file.name}
                </div>
                <div className="text-xs text-gray-400 truncate" title={file.path}>
                    {file.parent_path}
                </div>
            </div>

            {/* Size & date */}
            <div className="text-right flex-shrink-0">
                <div className="text-xs font-mono text-gray-600 dark:text-gray-300">
                    {formatSize(file.size)}
                </div>
                <div className="text-xs text-gray-400">{formatDate(file.modified_at)}</div>
            </div>

            {/* Delete checkbox */}
            {!isKept && (
                <button
                    onClick={onToggleDelete}
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${isDeleting
                        ? 'border-red-500 bg-red-500 text-white'
                        : 'border-gray-300 dark:border-gray-600 hover:border-red-400'
                        }`}
                    title={isDeleting ? 'Unmark for deletion' : 'Mark for deletion'}
                >
                    {isDeleting && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                            <path d="M1 4L3 6L7 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    )}
                </button>
            )}
        </div>
    );
};
