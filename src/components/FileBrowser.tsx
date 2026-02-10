import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useFileStore } from '../store/fileStore';
import { File, Folder, X, Grid, List as ListIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { TagManager } from './TagManager';

export const FileBrowser = () => {
    const {
        files, loadFiles, currentPath, selectFile, selectedFile, setCurrentPath,
        viewMode, setViewMode, sortField, sortDirection, setSort, navigateUp
    } = useFileStore();

    const parentRef = useRef<HTMLDivElement>(null);
    const [showTags, setShowTags] = useState(false);
    const [containerWidth, setContainerWidth] = useState(0);

    // Initial load
    useEffect(() => {
        if (!currentPath) {
            loadFiles('.');
            setCurrentPath('.');
        }
    }, [currentPath, loadFiles, setCurrentPath]);

    // Measure container width for grid layout
    useEffect(() => {
        if (!parentRef.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        resizeObserver.observe(parentRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    const sortedFiles = useMemo(() => {
        return [...files].sort((a, b) => {
            if (a.is_directory !== b.is_directory) {
                return a.is_directory ? -1 : 1;
            }
            let compare = 0;
            switch (sortField) {
                case 'name': compare = a.name.localeCompare(b.name); break;
                case 'size': compare = a.size - b.size; break;
                case 'date': compare = a.modified_at - b.modified_at; break;
                case 'type':
                    const extA = a.name.split('.').pop() || '';
                    const extB = b.name.split('.').pop() || '';
                    compare = extA.localeCompare(extB);
                    break;
            }
            return sortDirection === 'asc' ? compare : -compare;
        });
    }, [files, sortField, sortDirection]);

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (files.length === 0) return;

            // Only handle if not focused on input
            if (document.activeElement?.tagName === 'INPUT') return;

            const currentIndex = selectedFile ? sortedFiles.findIndex(f => f.path === selectedFile.path) : -1;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIndex = currentIndex < sortedFiles.length - 1 ? currentIndex + 1 : 0;
                handleSelect(sortedFiles[nextIndex]);
                // Scroll into view logic would be good here
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : sortedFiles.length - 1;
                handleSelect(sortedFiles[prevIndex]);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedFile) {
                    handleDoubleClick(selectedFile);
                }
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                navigateUp();
            } else if (viewMode === 'grid') {
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    const nextIndex = currentIndex < sortedFiles.length - 1 ? currentIndex + 1 : 0;
                    handleSelect(sortedFiles[nextIndex]);
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const prevIndex = currentIndex > 0 ? currentIndex - 1 : sortedFiles.length - 1;
                    handleSelect(sortedFiles[prevIndex]);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedFile, sortedFiles, navigateUp, viewMode]);

    // Grid Layout Constants
    const GRID_ITEM_WIDTH = 120;
    const GRID_GAP = 16;
    const columns = Math.max(1, Math.floor((containerWidth - 32) / (GRID_ITEM_WIDTH + GRID_GAP))); // -32 for padding

    const rowVirtualizer = useVirtualizer({
        count: viewMode === 'list' ? sortedFiles.length : Math.ceil(sortedFiles.length / columns),
        getScrollElement: () => parentRef.current,
        estimateSize: () => viewMode === 'list' ? 40 : 160, // List row height vs Grid row height
        overscan: 5,
    });

    const handleDoubleClick = (file: any) => {
        if (file.is_directory) {
            setCurrentPath(file.path);
        }
    };

    const handleSelect = useCallback((file: any) => {
        selectFile(file);
        if (!file.is_directory) {
            setShowTags(true);
        } else {
            setShowTags(false);
        }
    }, [selectFile]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const SortIcon = ({ field }: { field: any }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
    };

    const SortHeader = ({ label, field, className }: { label: string, field: any, className?: string }) => (
        <div
            className={`flex items-center gap-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 p-1 rounded ${className}`}
            onClick={() => setSort(field)}
        >
            {label}
            <SortIcon field={field} />
        </div>
    );

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar */}
            <div className="h-10 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 bg-white dark:bg-gray-900 shrink-0">
                <div className="text-sm text-gray-500">
                    {files.length} items
                </div>
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                    <button
                        onClick={() => setViewMode('grid')}
                        className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <Grid size={16} />
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    >
                        <ListIcon size={16} />
                    </button>
                </div>
            </div>

            {/* List Header */}
            {viewMode === 'list' && (
                <div className="flex items-center px-4 h-8 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 shrink-0">
                    <div className="mr-3 w-5"></div>
                    <SortHeader label="Name" field="name" className="flex-1" />
                    <div className="w-40 mr-4 hidden md:block">Tags</div>
                    <div className="w-48 flex items-center gap-8">
                        <SortHeader label="Size" field="size" className="w-20 justify-end" />
                        <SortHeader label="Date Modified" field="date" className="w-32 justify-end" />
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-hidden flex">
                <div
                    ref={parentRef}
                    className="flex-1 overflow-auto bg-white dark:bg-gray-900 custom-scrollbar"
                >
                    <div
                        style={{
                            height: `${rowVirtualizer.getTotalSize()}px`,
                            width: '100%',
                            position: 'relative',
                        }}
                    >
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            // List View
                            if (viewMode === 'list') {
                                const file = sortedFiles[virtualRow.index];
                                const isSelected = selectedFile?.path === file.path;
                                return (
                                    <div
                                        key={virtualRow.key}
                                        onClick={() => handleSelect(file)}
                                        onDoubleClick={() => handleDoubleClick(file)}
                                        className={`absolute top-0 left-0 w-full h-[40px] flex items-center px-4 cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors
                                            ${isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}
                                        `}
                                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                                    >
                                        <span className="mr-3 text-gray-400">
                                            {file.is_directory ? <Folder className="text-yellow-500 fill-yellow-500" size={20} /> : <File className="text-gray-400" size={20} />}
                                        </span>
                                        <span className="flex-1 truncate font-medium text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
                                            {file.name}
                                        </span>

                                        {/* Tags Column */}
                                        <div className="w-40 mr-4 hidden md:flex items-center gap-1 overflow-hidden">
                                            {file.tags?.slice(0, 2).map((tag: any) => (
                                                <span key={tag.id} className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-300 truncate max-w-[80px]" title={tag.tag}>
                                                    {tag.tag}
                                                </span>
                                            ))}
                                            {file.tags && file.tags.length > 2 && <span className="text-[10px] text-gray-400">+{file.tags.length - 2}</span>}
                                        </div>

                                        <div className="w-48 flex items-center gap-8 text-xs text-gray-500">
                                            <span className="w-20 text-right">{!file.is_directory && formatSize(file.size)}</span>
                                            <span className="w-32 text-right truncate">{new Date(file.modified_at * 1000).toLocaleString()}</span>
                                        </div>
                                    </div>
                                );
                            }

                            // Grid View
                            else {
                                const startIndex = virtualRow.index * columns;
                                const rowFiles = sortedFiles.slice(startIndex, startIndex + columns);

                                return (
                                    <div
                                        key={virtualRow.key}
                                        className="absolute top-0 left-0 w-full flex gap-4 px-4"
                                        style={{ transform: `translateY(${virtualRow.start}px)`, height: '160px' }} // Increased height for tags
                                    >
                                        {rowFiles.map((file) => {
                                            const isSelected = selectedFile?.path === file.path;
                                            return (
                                                <div
                                                    key={file.path}
                                                    onClick={() => handleSelect(file)}
                                                    onDoubleClick={() => handleDoubleClick(file)}
                                                    className={`flex flex-col items-center justify-center p-2 rounded-lg cursor-pointer transition-colors border border-transparent
                                                        ${isSelected ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800' : 'hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-200 dark:hover:border-gray-700'}
                                                    `}
                                                    style={{ width: `${GRID_ITEM_WIDTH}px`, height: '100%' }}
                                                >
                                                    <div className="mb-2 relative">
                                                        {file.is_directory ?
                                                            <Folder className="text-yellow-500 fill-yellow-500" size={48} /> :
                                                            <File className="text-gray-400" size={48} />
                                                        }
                                                    </div>
                                                    <span className="text-center text-xs font-medium text-gray-700 dark:text-gray-200 line-clamp-1 w-full break-words px-1" title={file.name}>
                                                        {file.name}
                                                    </span>

                                                    {/* Grid Tags */}
                                                    <div className="flex flex-wrap justify-center gap-1 mt-1 px-1 h-5 overflow-hidden w-full">
                                                        {file.tags?.slice(0, 2).map((tag: any) => (
                                                            <span key={tag.id} className="text-[9px] bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-1 rounded truncate max-w-full">
                                                                {tag.tag}
                                                            </span>
                                                        ))}
                                                    </div>

                                                    {!file.is_directory && (
                                                        <span className="text-[10px] text-gray-400 mt-1">{formatSize(file.size)}</span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            }
                        })}
                    </div>
                </div>

                {/* Right Panel for Details/Tags - Only visible if not directory and tags enabled */}
                {selectedFile && !selectedFile.is_directory && showTags && (
                    <div className="w-80 bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto shrink-0 transition-all">
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
                                    onClose={() => { }}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
