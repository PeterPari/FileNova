import { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFileStore } from '../store/fileStore';
import { File, Folder, X } from 'lucide-react';
import { TagManager } from './TagManager';

export const FileBrowser = () => {
    const { files, loadFiles, currentPath, selectFile, selectedFile, setCurrentPath } = useFileStore();
    const parentRef = useRef<HTMLDivElement>(null);
    const [showTags, setShowTags] = useState(false);

    // Initial load
    useEffect(() => {
        if (!currentPath) {
            loadFiles('.');
            setCurrentPath('.');
        }
    }, [currentPath, loadFiles, setCurrentPath]);

    const rowVirtualizer = useVirtualizer({
        count: files.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 40,
        overscan: 5,
    });

    const handleDoubleClick = (file: any) => {
        if (file.is_directory) {
            setCurrentPath(file.path);
        }
    };

    const handleSelect = (file: any) => {
        selectFile(file);
        if (!file.is_directory) {
            setShowTags(true);
        } else {
            setShowTags(false);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className="flex h-full">
            <div
                ref={parentRef}
                className="flex-1 overflow-auto bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700"
            >
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const file = files[virtualRow.index];
                        const isSelected = selectedFile?.path === file.path;

                        return (
                            <div
                                key={virtualRow.key}
                                onClick={() => handleSelect(file)}
                                onDoubleClick={() => handleDoubleClick(file)}
                                className={`absolute top-0 left-0 w-full h-[40px] flex items-center px-4 cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors
                                    ${isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}
                                `}
                                style={{
                                    transform: `translateY(${virtualRow.start}px)`,
                                }}
                            >
                                <span className="mr-3 text-gray-400">
                                    {file.is_directory ? (
                                        <Folder className="text-yellow-500 fill-yellow-500" size={20} />
                                    ) : (
                                        <File className="text-gray-400" size={20} />
                                    )}
                                </span>

                                <span className="flex-1 truncate font-medium text-sm text-gray-700 dark:text-gray-200">
                                    {file.name}
                                </span>

                                <div className="w-48 flex items-center gap-8 text-xs text-gray-500">
                                    <span className="w-20 text-right">
                                        {!file.is_directory && formatSize(file.size)}
                                    </span>
                                    <span className="w-32 text-right truncate">
                                        {new Date(file.modified_at * 1000).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
                {files.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <Folder size={48} className="mb-4 opacity-20" />
                        <p>Folder is empty</p>
                    </div>
                )}
            </div>

            {/* Right Panel for Details/Tags */}
            {selectedFile && !selectedFile.is_directory && showTags && (
                <div className="w-80 bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
                    <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                        <h3 className="font-semibold text-gray-700 dark:text-gray-200 truncate pr-2" title={selectedFile.name}>
                            {selectedFile.name}
                        </h3>
                        <button onClick={() => setShowTags(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <X size={18} />
                        </button>
                    </div>
                    <div className="p-4">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
                                <File className="text-blue-600 dark:text-blue-400" size={32} />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Size</p>
                                <p className="font-medium text-gray-700 dark:text-gray-200">{formatSize(selectedFile.size)}</p>
                            </div>
                        </div>

                        <div className="mt-6">
                            <TagManager
                                filePath={selectedFile.path}
                                onClose={() => { }} // No close needed here as it's embedded
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
