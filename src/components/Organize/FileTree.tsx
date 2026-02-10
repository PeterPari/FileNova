import { useState } from 'react';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';

interface DirectoryNode {
    name: string;
    path: string;
    children: DirectoryNode[];
    is_directory: boolean;
    size: number;
    file_count: number;
}

export const FileTree = ({ node, level = 0 }: { node: DirectoryNode; level?: number }) => {
    const [expanded, setExpanded] = useState(level === 0);
    const hasChildren = node.children && node.children.length > 0;

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="select-none">
            <div
                className={`flex items-center gap-2 py-1 px-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded cursor-pointer text-sm ${level === 0 ? 'font-medium' : ''}`}
                style={{ paddingLeft: `${Math.max(4, level * 16)}px` }}
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-1 min-w-[20px]">
                    {hasChildren && node.is_directory ? (
                        expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />
                    ) : <span className="w-[14px]" />}
                </div>

                {node.is_directory ? (
                    <Folder size={16} className="text-blue-500 fill-blue-500/20" />
                ) : (
                    <File size={16} className="text-gray-400" />
                )}

                <span className="truncate flex-1">{node.name}</span>

                <div className="flex items-center gap-3 text-xs text-gray-400">
                    {node.is_directory && <span>{node.file_count} files</span>}
                    <span>{formatBytes(node.size)}</span>
                </div>
            </div>

            {expanded && hasChildren && (
                <div className="border-l border-gray-200 dark:border-gray-800 ml-[11px]">
                    {node.children.map((child) => (
                        <FileTree key={child.path} node={child} level={level + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};
