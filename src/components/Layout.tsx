import { ReactNode, useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { SearchBar } from './SearchBar';
import { PreviewPanel } from './PreviewPanel';
import { useFileStore, IndexStatus, ExtractionStatus } from '../store/fileStore';
import { ChevronRight, ArrowLeft } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { IndexingStatus } from './IndexingStatus';
import { ExtractionProgress } from './ExtractionProgress';
import { listen } from '@tauri-apps/api/event';

interface LayoutProps {
    children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
    const { currentPath, navigateUp, setCurrentPath, setIndexingStatus, setExtractionStatus, loadFiles } = useFileStore();
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [suspiciousCount, setSuspiciousCount] = useState(0);

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

    // Simple breadcrumb splitting
    const parts = currentPath.split(/[/\\]/).filter(Boolean);

    return (
        <div className="flex h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 overflow-hidden">
            <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />

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

                {/* Header / Breadcrumb */}
                <header className="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 gap-4 bg-gray-50/50 backdrop-blur">
                    <button
                        onClick={() => navigateUp()}
                        className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors"
                        disabled={!currentPath || currentPath === '/'}
                    >
                        <ArrowLeft size={18} />
                    </button>

                    <div className="flex items-center gap-1 text-sm overflow-hidden whitespace-nowrap mask-linear-fade">
                        <button
                            onClick={() => setCurrentPath('/')}
                            className="hover:bg-gray-100 px-2 py-1 rounded"
                        >
                            Home
                        </button>
                        {parts.map((part, index) => (
                            <div key={index} className="flex items-center">
                                <ChevronRight size={14} className="text-gray-400 mx-1" />
                                <button className="hover:bg-gray-100 px-2 py-1 rounded font-medium">
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
                {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
            </main >

            <PreviewPanel />
        </div >
    );
};
