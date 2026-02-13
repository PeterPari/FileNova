import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileEntry, useFileStore } from '../store/fileStore';
import { File, Folder, X, Grid, List as ListIcon, ChevronUp, ChevronDown, Edit2, Wand2, Pin } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { TagManager } from './TagManager';
import { BatchRenameModal } from './BatchRenameModal';
import { UndoManager } from './UndoManager';
import { FileContextMenu } from './FileContextMenu';
import { useFileSelectionNavigation } from '../hooks/useFileSelectionNavigation';

export const FileBrowser = () => {
    const {
        files, loadFiles, currentPath, selectFile, selectedFiles, selectedFile, setCurrentPath,
        viewMode, setViewMode, sortField, sortDirection, setSort, navigateUp
    } = useFileStore();

    const parentRef = useRef<HTMLDivElement>(null);
    const [showTags, setShowTags] = useState(false);
    const [containerWidth, setContainerWidth] = useState(0);
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renameModalMode, setRenameModalMode] = useState<'default' | 'smart'>('default');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);

    useEffect(() => {
        if (!currentPath) {
            loadFiles('.');
            setCurrentPath('.');
        }
        loadPinnedFiles();
    }, [currentPath, loadFiles, setCurrentPath]);

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

    // Use the store's single source-of-truth sorting (memoized inside the store)
    const sortedFiles = useFileStore(state => state.getSortedFiles());

    useEffect(() => {
        if (!selectedFile) {
            setFocusedIndex(sortedFiles.length > 0 ? 0 : -1);
            return;
        }
        const index = sortedFiles.findIndex((file) => file.path === selectedFile.path);
        setFocusedIndex(index);
    }, [selectedFile, sortedFiles]);

    const GRID_ITEM_WIDTH = 120;
    const GRID_GAP = 16;
    const columns = Math.max(1, Math.floor((containerWidth - 32) / (GRID_ITEM_WIDTH + GRID_GAP)));

    const rowVirtualizer = useVirtualizer({
        count: viewMode === 'list' ? sortedFiles.length : Math.ceil(sortedFiles.length / columns),
        getScrollElement: () => parentRef.current,
        estimateSize: () => viewMode === 'list' ? 44 : 180,
        overscan: 5,
    });

    const selectedPathSet = useMemo(() => new Set(selectedFiles.map((file) => file.path)), [selectedFiles]);

    const getFileTypeLabel = (file: FileEntry) => {
        if (file.is_directory) return 'Folder';
        const ext = file.name.split('.').pop() || '';
        return ext ? ext.toUpperCase() : 'File';
    };

    const scrollToFileIndex = (index: number) => {
        if (index < 0) return;
        const rowIndex = viewMode === 'list' ? index : Math.floor(index / columns);
        rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
    };

    useFileSelectionNavigation({
        sortedFiles,
        focusedIndex,
        columns,
        viewMode,
        selectedFile,
        navigateUp,
        setCurrentPath,
        selectFile,
        onFocusIndexChange: setFocusedIndex,
        onSelectAll: () => useFileStore.getState().selectAll(),
        scrollToIndex: scrollToFileIndex,
    });

    const handleDoubleClick = (file: FileEntry) => {
        if (file.is_directory) {
            setCurrentPath(file.path);
        }
    };

    const handleSelect = useCallback((file: FileEntry, e: React.MouseEvent) => {
        // Standard Desktop Behavior: Single click selects. Double click navigates (handled separately).
        selectFile(file, e.ctrlKey || e.metaKey, e.shiftKey);

        if (!file.is_directory && !e.ctrlKey && !e.shiftKey) {
            setShowTags(true);
        } else if (e.ctrlKey || e.shiftKey) {
            setShowTags(false);
        }
    }, [selectFile]);

    const handleContextMenu = useCallback((e: React.MouseEvent, file: FileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        const isSelected = selectedPathSet.has(file.path);
        if (!isSelected) {
            selectFile(file, false, false);
        }
        setContextMenu({ x: e.clientX, y: e.clientY });
    }, [selectFile, selectedPathSet]);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const loadPinnedFiles = async () => {
        try { const result = await invoke<string[]>('get_pinned_files'); setPinnedFiles(result); } catch (e) { }
    };

    const handleTogglePin = async () => {
        if (!selectedFile) return;
        try { await invoke('toggle_pin_file', { path: selectedFile.path }); await loadPinnedFiles(); } catch (e) { }
    };

    const SortIcon = ({ field }: { field: 'name' | 'size' | 'date' | 'type' }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
    };

    const SortHeader = ({ label, field, className }: { label: string, field: 'name' | 'size' | 'date' | 'type', className?: string }) => (
        <div
            className={`flex items-center gap-1 cursor-pointer hover:bg-surface-hover hover:text-primary p-2 rounded transition-colors ${className}`}
            onClick={() => setSort(field)}
        >
            {label}
            <SortIcon field={field} />
        </div>
    );

    return (
        <div className="flex h-full flex-col bg-base text-primary">
            {/* Toolbar */}
            <div className="h-12 border-b border-base flex items-center justify-between px-4 bg-surface shrink-0">
                <div className="text-sm text-secondary flex items-center gap-4">
                    <span className="font-medium">{files.length} items</span>
                    {selectedFiles.length > 0 && (
                        <span className="text-accent-primary bg-surface-active px-2 py-0.5 rounded text-xs font-semibold">
                            {selectedFiles.length} selected
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                     {selectedFiles.length > 0 && (
                        <div className="flex items-center bg-surface border border-base rounded-lg overflow-hidden h-8">
                            <button
                                onClick={() => { setRenameModalMode('default'); setIsRenameModalOpen(true); }}
                                className="flex items-center gap-1.5 px-3 h-full text-secondary hover:text-primary hover:bg-surface-hover text-sm transition-colors border-r border-base"
                            >
                                <Edit2 size={14} />
                                Rename
                            </button>
                            <button
                                onClick={() => { setRenameModalMode('smart'); setIsRenameModalOpen(true); }}
                                className="flex items-center gap-1.5 px-3 h-full text-indigo-500 hover:text-indigo-600 hover:bg-surface-hover text-sm transition-colors"
                                title="AI Smart Rename"
                            >
                                <Wand2 size={14} />
                                Smart
                            </button>
                        </div>
                    )}
                    <div className="h-4 w-px bg-border-base mx-1"></div>
                    <UndoManager />
                     <div className="flex items-center bg-surface border border-base rounded-lg p-0.5 ml-2">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-surface-active text-accent-primary shadow-sm' : 'text-secondary hover:text-primary hover:bg-surface-hover'}`}
                            title="Grid View"
                        >
                            <Grid size={16} />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-surface-active text-accent-primary shadow-sm' : 'text-secondary hover:text-primary hover:bg-surface-hover'}`}
                            title="List View"
                        >
                            <ListIcon size={16} />
                        </button>
                    </div>
                </div>
            </div>

            {/* List Header */}
            {viewMode === 'list' && (
                <div className="flex items-center px-4 h-10 bg-surface border-b border-base text-xs font-semibold text-secondary shrink-0 uppercase tracking-wide">
                     <div className="w-8 shrink-0"></div> {/* Icon space */}
                    <SortHeader label="Name" field="name" className="flex-1" />
                    <div className="w-40 mr-4 hidden md:block pl-2">Tags</div>
                    <SortHeader label="Type" field="type" className="w-24 hidden lg:flex" />
                    <div className="w-60 flex items-center justify-end gap-4">
                        <SortHeader label="Size" field="size" className="w-20 justify-end" />
                        <SortHeader label="Modified" field="date" className="w-36 justify-end" />
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-hidden flex">
                <div ref={parentRef} className="flex-1 overflow-auto custom-scrollbar bg-base" onClick={() => selectFile(null, false, false)}>
                    <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            if (viewMode === 'list') {
                                const file = sortedFiles[virtualRow.index];
                                const isSelected = selectedPathSet.has(file.path);
                                return (
                                    <div
                                        key={virtualRow.key}
                                        onClick={(e) => { e.stopPropagation(); handleSelect(file, e); }}
                                        onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(file); }}
                                        onContextMenu={(e) => handleContextMenu(e, file)}
                                        className={`absolute top-0 left-0 w-full h-[44px] flex items-center px-4 cursor-pointer border-b border-base/50 transition-colors select-none group
                                            ${isSelected ? 'bg-surface-active' : 'hover:bg-surface-hover'}
                                        `}
                                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                                    >
                                        <div className="w-8 shrink-0 flex items-center justify-center text-secondary group-hover:text-primary">
                                            {file.is_directory ? <Folder className="text-yellow-400 fill-yellow-400" size={20} /> : <File size={20} />}
                                        </div>
                                        <span className={`flex-1 truncate text-sm font-medium flex items-center gap-2 ${isSelected ? 'text-primary' : 'text-secondary group-hover:text-primary'}`}>
                                            {pinnedFiles.includes(file.path) && <Pin size={12} className="text-accent-primary shrink-0" />}
                                            {file.name}
                                        </span>

                                        <div className="w-40 mr-4 hidden md:flex items-center gap-1 overflow-hidden">
                                            {file.tags?.slice(0, 2).map((tag) => (
                                                <button
                                                    key={tag.id}
                                                    className="text-[10px] bg-surface-hover px-1.5 py-0.5 rounded text-secondary hover:text-primary truncate max-w-[80px]"
                                                    onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('tag-search', { detail: { tag: tag.tag } })); }}
                                                >
                                                    {tag.tag}
                                                </button>
                                            ))}
                                            {file.tags && file.tags.length > 2 && <span className="text-[10px] text-muted">+{file.tags.length - 2}</span>}
                                        </div>

                                        <div className="w-24 hidden lg:block text-xs text-muted truncate">
                                            {getFileTypeLabel(file)}
                                        </div>

                                        <div className="w-60 flex items-center justify-end gap-4 text-xs text-muted">
                                            <span className="w-20 text-right">{!file.is_directory && formatSize(file.size)}</span>
                                            <span className="w-36 text-right truncate font-mono">{new Date(file.modified_at * 1000).toLocaleString()}</span>
                                        </div>
                                    </div>
                                );
                            } else {
                                const startIndex = virtualRow.index * columns;
                                const rowFiles = sortedFiles.slice(startIndex, startIndex + columns);
                                return (
                                    <div
                                        key={virtualRow.key}
                                        className="absolute top-0 left-0 w-full flex gap-4 px-4"
                                        style={{ transform: `translateY(${virtualRow.start}px)`, height: '180px' }}
                                    >
                                        {rowFiles.map((file) => {
                                            const isSelected = selectedPathSet.has(file.path);
                                            return (
                                                <div
                                                    key={file.path}
                                                    onClick={(e) => { e.stopPropagation(); handleSelect(file, e); }}
                                                    onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClick(file); }}
                                                    onContextMenu={(e) => handleContextMenu(e, file)}
                                                    className={`
                                                        flex flex-col items-center p-3 rounded-xl cursor-pointer transition-all duration-200 border select-none relative group
                                                        ${isSelected 
                                                            ? 'bg-surface-active border-accent-primary/50 shadow-sm' 
                                                            : 'bg-surface border-transparent hover:bg-surface-hover hover:shadow-md hover:border-border-highlight'}
                                                    `}
                                                    style={{ width: `${GRID_ITEM_WIDTH}px`, height: '100%' }}
                                                >
                                                    <div className="mb-3 relative mt-2 transform transition-transform group-hover:scale-105 duration-200">
                                                        {file.is_directory ? <Folder className="text-yellow-400 fill-yellow-400 drop-shadow-sm" size={56} /> : <File className="text-secondary" size={56} />}
                                                        {pinnedFiles.includes(file.path) && <Pin size={16} className="absolute -top-1 -right-2 text-accent-primary fill-current" />}
                                                    </div>
                                                    
                                                    <span className={`text-center text-xs font-medium line-clamp-2 w-full break-words px-1 leading-tight ${isSelected ? 'text-primary' : 'text-secondary group-hover:text-primary'}`} title={file.name}>
                                                        {file.name}
                                                    </span>

                                                    <div className="flex flex-wrap justify-center gap-1 mt-auto px-1 h-5 overflow-hidden w-full opacity-0 group-hover:opacity-100 transition-opacity">
                                                        {file.tags?.slice(0, 2).map((tag) => (
                                                            <span key={tag.id} className="text-[9px] bg-accent-primary/10 text-accent-primary px-1 rounded truncate max-w-full">
                                                                {tag.tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    
                                                     {!file.is_directory && (
                                                        <span className="text-[10px] text-muted mt-1">{formatSize(file.size)}</span>
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

                {selectedFile && !selectedFile.is_directory && showTags && selectedFiles.length === 1 && (
                    <div className="w-80 bg-surface border-l border-base overflow-y-auto shrink-0 transition-all shadow-xl z-20">
                        <div className="p-4 border-b border-base flex justify-between items-center bg-surface sticky top-0">
                            <h3 className="font-semibold text-primary truncate pr-2" title={selectedFile.name}>
                                {selectedFile.name}
                            </h3>
                            <button onClick={() => setShowTags(false)} className="text-muted hover:text-primary p-1 rounded hover:bg-surface-hover">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="p-4 bg-surface-hover rounded-xl">
                                    <File className="text-accent-primary" size={40} />
                                </div>
                                <div>
                                    <p className="text-xs text-muted uppercase tracking-wider font-semibold">Size</p>
                                    <p className="font-medium text-primary text-lg">{formatSize(selectedFile.size)}</p>
                                </div>
                            </div>
                            <div className="mt-2">
                                <TagManager filePath={selectedFile.path} onClose={() => { }} />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <BatchRenameModal isOpen={isRenameModalOpen} onClose={() => setIsRenameModalOpen(false)} initialMode={renameModalMode} />
            {contextMenu && (
                <FileContextMenu
                    x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}
                    onRename={() => { setRenameModalMode('default'); setIsRenameModalOpen(true); }}
                    onSmartRename={() => { setRenameModalMode('smart'); setIsRenameModalOpen(true); }}
                    onDelete={async () => {
                        if (confirm(`Move ${selectedFiles.length} item(s) to trash?`)) {
                            for (const f of selectedFiles) { try { await invoke('move_file_to_trash', { path: f.path }); } catch (e) { console.error(e); } }
                        }
                    }}
                    onOpen={() => { if (selectedFile?.is_directory) setCurrentPath(selectedFile.path); }}
                    onTogglePin={handleTogglePin} isPinned={selectedFile ? pinnedFiles.includes(selectedFile.path) : false} fileCount={selectedFiles.length}
                />
            )}
        </div>
    );
};
