import { ReactNode, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { SearchBar } from './SearchBar';
import { PreviewPanel } from './PreviewPanel';
import { useFileStore, IndexStatus, ExtractionStatus } from '../store/fileStore';
import { ChevronRight, ArrowLeft, ChevronLeft } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { IndexingStatus } from './IndexingStatus';
import { ExtractionProgress } from './ExtractionProgress';
import { TabBar } from './TabBar'; // Import TabBar
import { listen } from '@tauri-apps/api/event';

interface LayoutProps {
    children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
    const {
        currentPath, navigateUp, setCurrentPath, setIndexingStatus, setExtractionStatus, loadFiles,
        goBack, goForward, tabs, activeTabIndex, isSettingsOpen, toggleSettings
    } = useFileStore();

    const [suspiciousCount, setSuspiciousCount] = useState(0);

    const activeTab = tabs[activeTabIndex];
    const canGoBack = activeTab && activeTab.historyIndex > 0;
    const canGoForward = activeTab && activeTab.historyIndex < activeTab.history.length - 1;

    // Event listeners
    useEffect(() => {
        const unlistenProgress = listen<IndexStatus>('indexing-progress', (event) => {
            setIndexingStatus(event.payload);
        });

        const unlistenFinished = listen('indexing-finished', () => {
            // Maybe fetch status one last time or set is_indexing false
            setIndexingStatus({
                total_files: 0,
                processed_files: 0,
                current_path: '',
                is_indexing: false
            });
        });

        const unlistenFileChanged = listen('file-changed', () => {
            // Refresh current view if needed
            if (currentPath) {
                loadFiles(currentPath);
            }
        });

        // Stage 5: Extraction events
        const unlistenExtractionProgress = listen<ExtractionStatus>('extraction-progress', (event) => {
            setExtractionStatus(event.payload);
        });

        const unlistenExtractionFinished = listen('extraction-finished', () => {
            setExtractionStatus(null);
        });

        // Stage 6: Suspicious Activity
        const unlistenSuspicious = listen<number>('suspicious-activity', (event) => {
            setSuspiciousCount(event.payload);
        });

        return () => {
            unlistenProgress.then(f => f());
            unlistenFinished.then(f => f());
            unlistenFileChanged.then(f => f());
            unlistenExtractionProgress.then(f => f());
            unlistenExtractionFinished.then(f => f());
            unlistenSuspicious.then(f => f());
        };
    }, [currentPath]);

    // Load settings on mount
    useEffect(() => {
        const { loadIndexedPaths } = useFileStore.getState();
        loadIndexedPaths();
    }, []);

    // Functional Breadcrumb Logic
    const parts = currentPath ? currentPath.split(/[/\\]/).filter(Boolean) : [];

    const handleBreadcrumbClick = (index: number) => {
        // Reconstruct path up to index
        // Handle Windows vs Unix path separators if needed. 
        // For now assuming '/' or standard separator usage from split.
        // Actually, on Windows it's typically 'D:', 'FileNova', etc.
        // We need to be careful about reconstruction.
        // If the path starts with a drive letter, we join with standard separator.

        // This is a simplified reconstruction, ideally we use a path join utility or the stored parts logic better.
        // Let's assume `/` for now as Tauri often normalizes or we can try to respect the separator.
        // If original path had `\`, we might want to use `\`?
        // But `list_directory` accepts both usually or we standardized in backend (not yet).
        // Let's rely on standard `/` join for now as web-friendly.

        // Handling drive root: "C:" -> parts=["C:"] -> join -> "C:" (correct)
        // "C:/Users" -> parts=["C:", "Users"] -> index 0 click -> "C:"

        const newPath = parts.slice(0, index + 1).join('/');
        // If the original path started with /, we might need to prepend / (Unix).
        // Windows drive paths don't start with /.
        const isUnixRoot = currentPath.startsWith('/');
        const finalPath = isUnixRoot ? '/' + newPath : newPath;

        setCurrentPath(finalPath);
    };

    return (
        <div className="flex h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 overflow-hidden">
            <Sidebar onOpenSettings={toggleSettings} />

            <main className="flex-1 flex flex-col min-w-0 relative">
                {/* Suspicious Activity Banner */}
                {suspiciousCount > 0 && (
                    <div className="bg-red-600 text-white px-4 py-2 flex justify-between items-center shadow-md animate-pulse z-50">
                        <div className="flex items-center gap-2">
                            <span className="text-xl">⚠️</span>
                            <span className="font-bold">Unusual Activity Detected:</span>
                            <span>{suspiciousCount} files modified rapidly. Possible ransomware or bulk operation?</span>
                        </div>
                        <button
                            onClick={() => setSuspiciousCount(0)}
                            className="bg-white text-red-600 px-3 py-1 rounded text-sm font-semibold hover:bg-gray-100"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {/* Tab Bar */}
                <TabBar />

                {/* Header / Breadcrumb */}
                <header className="h-12 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4 bg-gray-50/50 backdrop-blur shrink-0">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => goBack()}
                            className={`p-1.5 rounded-md transition-colors ${canGoBack ? 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                            disabled={!canGoBack}
                            title="Back"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <button
                            onClick={() => goForward()}
                            className={`p-1.5 rounded-md transition-colors ${canGoForward ? 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                            disabled={!canGoForward}
                            title="Forward"
                        >
                            <ChevronRight size={18} />
                        </button>
                        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1"></div>
                        <button
                            onClick={() => navigateUp()}
                            className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors"
                            disabled={!currentPath || currentPath === '/'}
                            title="Up"
                        >
                            <ArrowLeft size={18} className="rotate-90" />
                        </button>
                    </div>

                    <div className="flex items-center gap-1 text-sm overflow-hidden whitespace-nowrap mask-linear-fade">
                        <button
                            onClick={() => setCurrentPath('')}
                            className={`hover:bg-gray-100 px-2 py-1 rounded ${!currentPath ? 'font-bold' : ''}`}
                        >
                            Home
                        </button>
                        {parts.map((part, index) => (
                            <div key={index} className="flex items-center">
                                <ChevronRight size={14} className="text-gray-400 mx-0.5" />
                                <button
                                    onClick={() => handleBreadcrumbClick(index)}
                                    className="hover:bg-gray-100 px-2 py-1 rounded font-medium truncate max-w-[150px]"
                                    title={part}
                                >
                                    {part}
                                </button>
                            </div>
                        ))}
                    </div>


                    <div className="flex-1 mx-4">
                        <SearchBar />
                    </div>
                </header >

                <div className="flex-1 overflow-hidden relative">
                    {children}
                </div>

                <IndexingStatus />
                <ExtractionProgress />
                {isSettingsOpen && <SettingsModal onClose={toggleSettings} />}
            </main >

            <PreviewPanel />
        </div >
    );
};
