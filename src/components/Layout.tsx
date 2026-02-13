import { ReactNode, lazy, Suspense, useMemo, useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { SearchBar } from './SearchBar';
import { useFileStore, IndexStatus, ExtractionStatus } from '../store/fileStore';
import { ChevronRight, ArrowLeft, ChevronLeft, Eye, EyeOff, Home, AlertTriangle } from 'lucide-react';
import { IndexingStatus } from './IndexingStatus';
import { ExtractionProgress } from './ExtractionProgress';
import { TabBar } from './TabBar';
import { joinPathParts, splitPath } from '../utils/path';
import { useGlobalShortcuts } from '../hooks/useGlobalShortcuts';
import { useAppEvents } from '../hooks/useAppEvents';

const EnhancedPreviewPanel = lazy(() => import('./EnhancedPreviewPanel').then((m) => ({ default: m.EnhancedPreviewPanel })));
const QuickLookModal = lazy(() => import('./QuickLookModal').then((m) => ({ default: m.QuickLookModal })));
const CommandPalette = lazy(() => import('./CommandPalette').then((m) => ({ default: m.CommandPalette })));
const ShortcutsCheatSheet = lazy(() => import('./KeyboardShortcuts').then((m) => ({ default: m.ShortcutsCheatSheet })));
const KeyboardShortcutsModal = lazy(() => import('./KeyboardShortcuts').then((m) => ({ default: m.KeyboardShortcutsModal })));
const FeatureDiscovery = lazy(() => import('./FeatureDiscovery').then((m) => ({ default: m.FeatureDiscovery })));
const SettingsModal = lazy(() => import('./SettingsModal').then((m) => ({ default: m.SettingsModal })));

interface LayoutProps {
    children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
    const {
        currentPath, navigateUp, setCurrentPath,
        goBack, goForward, tabs, activeTabIndex, isSettingsOpen, toggleSettings,
        previewPanelOpen, togglePreviewPanel, quickLookOpen, openQuickLook, closeQuickLook,
        commandPaletteOpen, toggleCommandPalette, shortcutsCheatSheetOpen, toggleShortcutsCheatSheet,
        selectedFile, files
    } = useFileStore();

    const [suspiciousCount, setSuspiciousCount] = useState(0);
    const [showFullShortcuts, setShowFullShortcuts] = useState(false);

    const activeTab = tabs[activeTabIndex];
    const canGoBack = activeTab && activeTab.historyIndex > 0;
    const canGoForward = activeTab && activeTab.historyIndex < activeTab.history.length - 1;

    const commandRegistry = useMemo(() => {
        const store = useFileStore.getState();
        return {
            addTab: () => store.addTab(),
            closeTab: (index: number) => store.closeTab(index),
        };
    }, []);

    useGlobalShortcuts({
        tabsLength: tabs.length,
        activeTabIndex,
        onToggleCommandPalette: toggleCommandPalette,
        onTogglePreview: togglePreviewPanel,
        onOpenQuickLook: openQuickLook,
        onToggleShortcuts: toggleShortcutsCheatSheet,
        addTab: commandRegistry.addTab,
        closeTab: commandRegistry.closeTab,
    });

    const onIndexingProgress = useCallback((status: IndexStatus) => {
        const store = useFileStore.getState();
        store.setIndexingStatus(status);
        if (!status.is_indexing && status.processed_files === status.total_files && status.total_files > 0) {
            store.loadFiles(store.currentPath);
        }
    }, []);

    const onExtractionProgress = useCallback((status: ExtractionStatus) => {
        useFileStore.getState().setExtractionStatus(status);
    }, []);

    const onSuspiciousActivity = useCallback(() => {
        setSuspiciousCount((prev) => prev + 1);
    }, []);

    useAppEvents({
        onIndexingProgress,
        onExtractionProgress,
        onSuspiciousActivity,
    });

    // Initial load
    useEffect(() => {
         const { loadIndexedPaths } = useFileStore.getState();
         loadIndexedPaths();
    }, []);

    const parts = splitPath(currentPath);

    const handleBreadcrumbClick = (index: number) => {
        const isUnixRoot = currentPath.startsWith('/');
        const finalPath = joinPathParts(parts.slice(0, index + 1), isUnixRoot);
        setCurrentPath(finalPath);
    };

    return (
        <>
            <div className="app-shell bg-base text-primary font-sans">
                {/* Grid Area: Sidebar */}
                <div style={{ gridArea: 'sidebar' }}>
                    <Sidebar onOpenSettings={toggleSettings} />
                </div>

                {/* Grid Area: Header */}
                <header style={{ gridArea: 'header' }} className="flex items-center gap-3 px-4 py-2.5 bg-base border-b border-base">
                    {/* Navigation Controls */}
                    <div className="flex items-center bg-surface rounded-lg border border-base p-0.5 shrink-0">
                        <button
                            onClick={() => goBack()}
                            className={`p-1.5 rounded-md transition-theme ${canGoBack ? 'hover:bg-surface-hover text-primary' : 'text-disabled cursor-not-allowed'}`}
                            disabled={!canGoBack}
                            title="Go Back"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <button
                            onClick={() => goForward()}
                            className={`p-1.5 rounded-md transition-theme ${canGoForward ? 'hover:bg-surface-hover text-primary' : 'text-disabled cursor-not-allowed'}`}
                            disabled={!canGoForward}
                            title="Go Forward"
                        >
                            <ChevronRight size={18} />
                        </button>
                        <div className="w-px h-4 mx-0.5" style={{ backgroundColor: 'var(--border-secondary)' }}></div>
                        <button
                            onClick={() => navigateUp()}
                            className={`p-1.5 rounded-md transition-theme ${currentPath && currentPath !== '/' ? 'hover:bg-surface-hover text-primary' : 'text-disabled cursor-not-allowed'}`}
                            disabled={!currentPath || currentPath === '/'}
                            title="Up Directory"
                        >
                            <ArrowLeft size={18} className="rotate-90" />
                        </button>
                    </div>

                    {/* Breadcrumbs Path Bar */}
                    <div className="flex-1 flex items-center bg-surface border border-base rounded-lg px-3 py-1.5 text-sm overflow-hidden h-9">
                        <button
                            onClick={() => setCurrentPath('')}
                            className={`hover:bg-surface-hover px-1.5 py-0.5 rounded mr-1 transition-theme ${!currentPath ? 'text-primary font-medium' : 'text-secondary'}`}
                            title="Home"
                        >
                            <Home size={16} />
                        </button>

                        <div className="flex items-center overflow-x-auto whitespace-nowrap flex-1 no-scrollbar">
                            {parts.map((part, index) => (
                                <div key={index} className="flex items-center shrink-0">
                                    <ChevronRight size={14} className="text-muted mx-0.5" />
                                    <button
                                        onClick={() => handleBreadcrumbClick(index)}
                                        className="hover:bg-surface-hover hover:text-primary px-2 py-0.5 rounded transition-theme truncate max-w-[200px] text-secondary"
                                        title={part}
                                    >
                                        {part}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="w-64 xl:w-80 shrink-0">
                        <SearchBar />
                    </div>

                    {/* View Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            onClick={() => togglePreviewPanel()}
                            className={`p-2 rounded-lg border border-base transition-theme ${previewPanelOpen ? 'bg-surface-active text-primary' : 'bg-surface hover:bg-surface-hover text-secondary'}`}
                            title={previewPanelOpen ? 'Hide Preview (Ctrl+P)' : 'Show Preview (Ctrl+P)'}
                        >
                            {previewPanelOpen ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </header>

                {/* Grid Area: Tabs */}
                <div style={{ gridArea: 'tabs' }} className="bg-surface border-b border-base">
                    <TabBar />
                </div>

                {/* Grid Area: Main */}
                <div style={{ gridArea: 'main' }} className="relative overflow-hidden bg-base">
                    {/* Suspicious Activity Banner */}
                    {suspiciousCount > 0 && (
                        <div className="absolute top-0 left-0 right-0 bg-red-500 text-white px-4 py-3 flex justify-between items-center shadow-lg z-50">
                            <div className="flex items-center gap-3">
                                <div className="bg-white/20 p-1.5 rounded-full">
                                    <AlertTriangle size={20} className="text-white" />
                                </div>
                                <div className="flex flex-col text-sm leading-tight">
                                    <span className="font-bold">Unusual Activity Detected</span>
                                    <span className="opacity-90">{suspiciousCount} files modified rapidly. Possible risk?</span>
                                </div>
                            </div>
                            <button
                                onClick={() => setSuspiciousCount(0)}
                                className="bg-white text-red-600 px-3 py-1.5 rounded-md text-sm font-semibold hover:bg-red-50 transition-colors shadow-sm"
                            >
                                Dismiss
                            </button>
                        </div>
                    )}

                    {/* Main Content */}
                    <div className="h-full overflow-hidden">
                        {children}
                    </div>
                </div>

                {/* Grid Area: Right Panel (Conditional) */}
                {previewPanelOpen && (
                    <div style={{ gridArea: 'right' }} className="w-80 bg-surface overflow-hidden border-l border-base">
                        <Suspense fallback={<div className="h-full w-full" />}>
                            <EnhancedPreviewPanel />
                        </Suspense>
                    </div>
                )}

                {/* Grid Area: Footer */}
                <footer style={{ gridArea: 'footer' }} className="bg-surface px-3 py-1 text-xs flex items-center justify-between text-secondary border-t border-base">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <IndexingStatus />
                        </div>
                        <div className="w-px h-3" style={{ backgroundColor: 'var(--border-secondary)' }}></div>
                        <ExtractionProgress />
                    </div>
                    <div>
                        {selectedFile ? `Selected: ${selectedFile.name}` : `${files.length} Item${files.length !== 1 ? 's' : ''}`}
                    </div>
                </footer>

                {/* Settings Modal */}
                {isSettingsOpen && (
                    <Suspense fallback={null}>
                        <SettingsModal onClose={toggleSettings} />
                    </Suspense>
                )}
            </div>

            {/* Global Modals - Outside Grid */}
            <Suspense fallback={null}>
                <QuickLookModal
                    isOpen={quickLookOpen}
                    onClose={closeQuickLook}
                    currentFile={selectedFile}
                    allFiles={files.filter(f => !f.is_directory)}
                />
                <CommandPalette
                    isOpen={commandPaletteOpen}
                    onClose={toggleCommandPalette}
                />
                <ShortcutsCheatSheet
                    isOpen={shortcutsCheatSheetOpen}
                    onClose={toggleShortcutsCheatSheet}
                />
                {showFullShortcuts && (
                    <KeyboardShortcutsModal
                        isOpen={showFullShortcuts}
                        onClose={() => setShowFullShortcuts(false)}
                    />
                )}
                <FeatureDiscovery />
            </Suspense>
        </>
    );
};
