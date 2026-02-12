import { ReactNode, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { SearchBar } from './SearchBar';
import { EnhancedPreviewPanel } from './EnhancedPreviewPanel';
import { QuickLookModal } from './QuickLookModal';
import { CommandPalette } from './CommandPalette';
import { ShortcutsCheatSheet, KeyboardShortcutsModal } from './KeyboardShortcuts';
import { FeatureDiscovery } from './FeatureDiscovery';
import { useFileStore, IndexStatus, ExtractionStatus } from '../store/fileStore';
import { ChevronRight, ArrowLeft, ChevronLeft, Eye, EyeOff, Home, AlertTriangle, X } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { IndexingStatus } from './IndexingStatus';
import { ExtractionProgress } from './ExtractionProgress';
import { TabBar } from './TabBar';
import { listen } from '@tauri-apps/api/event';
import { joinPathParts, splitPath } from '../utils/path';

interface LayoutProps {
    children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
    const {
        currentPath, navigateUp, setCurrentPath, setIndexingStatus, setExtractionStatus, loadFiles,
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

    // Stage 10: Global keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'k') { e.preventDefault(); toggleCommandPalette(); return; }
            if (e.ctrlKey && e.key === 'p') { e.preventDefault(); togglePreviewPanel(); return; }
            if (e.key === ' ' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                const tagName = (e.target as HTMLElement)?.tagName;
                if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') { e.preventDefault(); openQuickLook(); return; }
            }
            if (e.key === '?') {
                const tagName = (e.target as HTMLElement)?.tagName;
                if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') { e.preventDefault(); toggleShortcutsCheatSheet(); return; }
            }
            if (e.ctrlKey && e.key === 't') { e.preventDefault(); useFileStore.getState().addTab(); return; }
            if (e.ctrlKey && e.key === 'w') { e.preventDefault(); if (tabs.length > 1) { useFileStore.getState().closeTab(activeTabIndex); } return; }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [tabs, activeTabIndex]);

    // Event listeners
    useEffect(() => {
        const unlistenIndex = listen('indexing_progress', (event: any) => {
            const status = event.payload as IndexStatus;
            setIndexingStatus(status);
            if (status.stage === 'Complete') loadFiles();
        });
        const unlistenExtraction = listen('extraction_progress', (event: any) => {
            setExtractionStatus(event.payload as ExtractionStatus);
        });
        const unlistenSuspicious = listen('suspicious_activity', (event: any) => {
             setSuspiciousCount(prev => prev + 1);
        });

        return () => {
            unlistenIndex.then(f => f());
            unlistenExtraction.then(f => f());
            unlistenSuspicious.then(f => f());
        };
    }, []);

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
        <div className="flex h-screen bg-base text-primary overflow-hidden font-sans">
            <Sidebar onOpenSettings={toggleSettings} />

            <main className="flex-1 flex flex-col min-w-0 relative bg-base">
                {/* Suspicious Activity Banner */}
                {suspiciousCount > 0 && (
                    <div className="bg-red-500 text-white px-4 py-3 flex justify-between items-center shadow-lg z-50 animate-in slide-in-from-top-2">
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

                {/* Tab Bar - Integrated with top of application */}
                <div className="pt-2 px-2 bg-surface border-b border-base w-full z-10 box-border">
                    <TabBar />
                </div>

                {/* Header Toolbar */}
                <header className="flex items-center gap-3 px-4 py-3 border-b border-base bg-base sticky top-0 z-20 shadow-sm box-border h-16">
                    {/* Navigation Controls */}
                    <div className="flex items-center bg-surface rounded-lg border border-base p-1 shrink-0">
                        <button
                            onClick={() => goBack()}
                            className={`p-1.5 rounded-md transition-all ${canGoBack ? 'hover:bg-surface-hover text-primary' : 'text-muted cursor-not-allowed'}`}
                            disabled={!canGoBack}
                            title="Go Back"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <button
                            onClick={() => goForward()}
                            className={`p-1.5 rounded-md transition-all ${canGoForward ? 'hover:bg-surface-hover text-primary' : 'text-muted cursor-not-allowed'}`}
                            disabled={!canGoForward}
                            title="Go Forward"
                        >
                            <ChevronRight size={18} />
                        </button>
                        <div className="w-px h-4 bg-border-base mx-1"></div>
                        <button
                            onClick={() => navigateUp()}
                            className={`p-1.5 rounded-md transition-all ${currentPath && currentPath !== '/' ? 'hover:bg-surface-hover text-primary' : 'text-muted cursor-not-allowed'}`}
                            disabled={!currentPath || currentPath === '/'}
                            title="Up Directory"
                        >
                            <ArrowLeft size={18} className="rotate-90" />
                        </button>
                    </div>

                    {/* Breadcrumbs Path Bar */}
                    <div className="flex-1 flex items-center bg-surface border border-base rounded-lg px-3 py-1.5 text-sm overflow-hidden h-10 transition-colors focus-within:ring-2 focus-within:ring-accent-primary/20 focus-within:border-accent-primary">
                        <button
                            onClick={() => setCurrentPath('')}
                            className={`hover:bg-surface-hover px-1.5 py-0.5 rounded mr-1 transition-colors ${!currentPath ? 'text-accent-primary font-medium' : 'text-secondary'}`}
                            title="Home"
                        >
                            <Home size={16} />
                        </button>
                        
                        <div className="flex items-center overflow-x-auto custom-scrollbar no-scrollbar whitespace-nowrap mask-linear-fade flex-1">
                            {parts.map((part, index) => (
                                <div key={index} className="flex items-center shrink-0">
                                    <ChevronRight size={14} className="text-muted mx-0.5" />
                                    <button
                                        onClick={() => handleBreadcrumbClick(index)}
                                        className="hover:bg-surface-hover hover:text-primary px-2 py-0.5 rounded transition-colors truncate max-w-[200px] text-primary"
                                        title={part}
                                    >
                                        {part}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Search Bar - Flex Grow if needed or fixed width */}
                    <div className="w-64 xl:w-80 shrink-0">
                        <SearchBar />
                    </div>

                    {/* View Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                         <button
                            onClick={() => togglePreviewPanel()}
                            className={`p-2 rounded-lg border border-base transition-all ${previewPanelOpen ? 'bg-surface-active text-accent-primary border-accent-primary' : 'bg-surface hover:bg-surface-hover text-secondary'}`}
                            title={previewPanelOpen ? 'Hide Preview (Ctrl+P)' : 'Show Preview (Ctrl+P)'}
                        >
                            {previewPanelOpen ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </header>

                {/* Main View Area */}
                <div className="flex-1 overflow-hidden relative flex flex-row">
                    <div className="flex-1 overflow-hidden relative flex flex-col">
                        {children}
                    </div>

                     {/* Right Panel: Enhanced Preview */}
                    {previewPanelOpen && (
                        <div className="w-80 border-l border-base bg-surface overflow-hidden flex flex-col shadow-xl z-30">
                            <EnhancedPreviewPanel />
                        </div>
                    )}
                </div>

                {/* Consolidated Status Bar */}
                <footer className="bg-surface border-t border-base px-3 py-1 text-xs flex items-center justify-between text-secondary h-8 shrink-0 select-none">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                             <IndexingStatus />
                        </div>
                        <div className="w-px h-3 bg-border-base"></div>
                         <ExtractionProgress />
                    </div>
                    {/* Add more status items here (e.g., selection count) */}
                    <div>
                        {selectedFile ? `Selected: ${selectedFile.name}` : `${files.length} Item${files.length !== 1 ? 's' : ''}`}
                    </div>
                </footer>

                {isSettingsOpen && <SettingsModal onClose={toggleSettings} />}
            </main>

            {/* Global Modals */}
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
        </div>
    );
};
