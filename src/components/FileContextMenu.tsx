import React, { useEffect, useRef } from 'react';
import { Edit2, Trash2, FolderOpen, Wand2, Pin } from 'lucide-react';

interface FileContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onRename: () => void;
    onSmartRename: () => void;
    onDelete: () => void;
    onOpen: () => void;
    onTogglePin?: () => void;
    isPinned?: boolean;
    fileCount: number;
}

export const FileContextMenu: React.FC<FileContextMenuProps> = ({
    x, y, onClose, onRename, onSmartRename, onDelete, onOpen, onTogglePin, isPinned, fileCount
}) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    // Prevent rendering off-screen
    const style = {
        top: Math.min(y, window.innerHeight - 200),
        left: Math.min(x, window.innerWidth - 200),
    };

    return (
        <div
            ref={menuRef}
            className="fixed z-50 w-56 bg-base border border-base rounded-lg shadow-xl py-1 text-sm text-secondary"
            style={style}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="px-3 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-base mb-1">
                {fileCount} item{fileCount !== 1 ? 's' : ''} selected
            </div>

            <button
                className="w-full text-left px-4 py-2 hover:bg-surface-hover flex items-center gap-2"
                onClick={() => { onOpen(); onClose(); }}
            >
                <FolderOpen size={16} />
                Open
            </button>

            {onTogglePin && (
                <button
                    className="w-full text-left px-4 py-2 hover:bg-surface-hover flex items-center gap-2"
                    onClick={() => { onTogglePin(); onClose(); }}
                >
                    <Pin size={16} className={isPinned ? 'text-blue-500' : ''} />
                    {isPinned ? 'Unpin' : 'Pin to Top'}
                </button>
            )}

            <div className="my-1 border-t border-base" />

            <button
                className="w-full text-left px-4 py-2 hover:bg-surface-hover flex items-center gap-2"
                onClick={() => { onRename(); onClose(); }}
            >
                <Edit2 size={16} />
                Rename...
            </button>

            <button
                className="w-full text-left px-4 py-2 hover:bg-surface-hover flex items-center gap-2 text-purple-600 dark:text-purple-400"
                onClick={() => { onSmartRename(); onClose(); }}
            >
                <Wand2 size={16} />
                Smart Rename
            </button>

            <div className="my-1 border-t border-base" />

            <button
                className="w-full text-left px-4 py-2 hover:bg-surface-hover flex items-center gap-2 text-red-600 dark:text-red-400"
                onClick={() => { onDelete(); onClose(); }}
            >
                <Trash2 size={16} />
                Delete
            </button>
        </div>
    );
};
