import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Copy, Search, Undo2, AlertCircle } from 'lucide-react';
import { useDuplicateStore, DuplicateScanStatus } from '../store/duplicateStore';
import { DuplicateGroupCard } from './DuplicateGroupCard';
import { DuplicateScanProgress } from './DuplicateScanProgress';

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const FILTER_TABS = [
    { key: null, label: 'All' },
    { key: 'exact', label: 'Exact Matches' },
    { key: 'perceptual', label: 'Similar Images' },
    { key: 'smart', label: 'Smart Matches' },
] as const;

export const DuplicateReview = () => {
    const {
        summary,
        groups,
        filterType,
        recentBatches,
        error,
        startScan,
        setScanStatus,
        fetchSummary,
        fetchGroups,
        fetchRecentBatches,
        setFilterType,
        undoBatch,
    } = useDuplicateStore();

    const [localScanStatus, setLocalScanStatus] = useState<DuplicateScanStatus | null>(null);
    const hideProgressTimeoutRef = useRef<number | null>(null);

    // Fetch data on mount
    useEffect(() => {
        fetchSummary();
        fetchGroups();
        fetchRecentBatches();
    }, []);

    // Listen for scan events
    useEffect(() => {
        const unlisteners: (() => void)[] = [];

        listen<DuplicateScanStatus>('duplicate-scan-progress', (event) => {
            setLocalScanStatus(event.payload);
            setScanStatus(event.payload);
        }).then((unlisten) => unlisteners.push(unlisten));

        listen<DuplicateScanStatus>('duplicate-scan-finished', (event) => {
            setLocalScanStatus(event.payload);
            setScanStatus(event.payload);
            fetchSummary();
            fetchGroups();
            // Auto-hide progress after 3 seconds
            if (hideProgressTimeoutRef.current !== null) {
                window.clearTimeout(hideProgressTimeoutRef.current);
            }
            hideProgressTimeoutRef.current = window.setTimeout(() => {
                setLocalScanStatus(null);
                hideProgressTimeoutRef.current = null;
            }, 3000);
        }).then((unlisten) => unlisteners.push(unlisten));

        listen('duplicates-changed', () => {
            fetchSummary();
            fetchGroups();
            fetchRecentBatches();
        }).then((unlisten) => unlisteners.push(unlisten));

        return () => {
            unlisteners.forEach((u) => u());
            if (hideProgressTimeoutRef.current !== null) {
                window.clearTimeout(hideProgressTimeoutRef.current);
                hideProgressTimeoutRef.current = null;
            }
        };
    }, []);

    const isScanning = localScanStatus?.is_scanning ?? false;
    const totalFiles = summary
        ? (summary.exact_groups + summary.perceptual_groups > 0
            ? groups.reduce((acc, g) => acc + g.file_count, 0)
            : 0)
        : 0;

    return (
        <div className="p-6 h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
                    <Copy /> Duplicate Files
                </h1>
                <button
                    onClick={startScan}
                    disabled={isScanning}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Search size={16} />
                    {isScanning ? 'Scanning...' : 'Scan for Duplicates'}
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
                    <AlertCircle size={16} />
                    {error}
                </div>
            )}

            {/* Summary Cards */}
            {summary && summary.total_groups > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                        <h3 className="text-sm font-medium text-gray-500 uppercase">
                            Groups Found
                        </h3>
                        <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-2">
                            {summary.total_groups}
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                            {summary.exact_groups} exact, {summary.perceptual_groups} image, {summary.smart_groups} smart
                        </p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                        <h3 className="text-sm font-medium text-gray-500 uppercase">
                            Wasted Space
                        </h3>
                        <p className="text-3xl font-bold text-orange-500 mt-2">
                            {formatSize(summary.total_wasted_bytes)}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                        <h3 className="text-sm font-medium text-gray-500 uppercase">
                            Files Affected
                        </h3>
                        <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-2">
                            {totalFiles}
                        </p>
                    </div>
                </div>
            )}

            {/* Filter Tabs */}
            {summary && summary.total_groups > 0 && (
                <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
                    {FILTER_TABS.map((tab) => (
                        <button
                            key={tab.key ?? 'all'}
                            onClick={() => setFilterType(tab.key)}
                            className={`px-4 py-2 text-sm rounded-md transition-colors ${filterType === tab.key
                                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Group List */}
            {groups.length > 0 ? (
                <div className="space-y-3">
                    {groups.map((group) => (
                        <DuplicateGroupCard key={group.id} group={group} />
                    ))}
                </div>
            ) : !isScanning && summary && summary.total_groups === 0 ? (
                <div className="text-center py-20 text-gray-400">
                    <Copy size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="text-lg">No duplicates found</p>
                    <p className="text-sm mt-1">
                        Click "Scan for Duplicates" to analyze your indexed files
                    </p>
                </div>
            ) : !summary ? (
                <div className="text-center py-20 text-gray-400">
                    <Copy size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="text-lg">Ready to scan</p>
                    <p className="text-sm mt-1">
                        Click "Scan for Duplicates" to find duplicate files in your indexed directories
                    </p>
                </div>
            ) : null}

            {/* Undo Bar */}
            {recentBatches.length > 0 && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-gray-700 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-4 z-40">
                    <span className="text-sm">
                        Deleted {recentBatches[0].file_count} file
                        {recentBatches[0].file_count > 1 ? 's' : ''} (
                        {formatSize(recentBatches[0].total_size)})
                    </span>
                    <button
                        onClick={() => undoBatch(recentBatches[0].batch_id)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-white/20 rounded-md hover:bg-white/30 transition-colors text-sm"
                    >
                        <Undo2 size={14} />
                        Undo
                    </button>
                </div>
            )}

            {/* Scan Progress Overlay */}
            {localScanStatus && (localScanStatus.is_scanning || localScanStatus.phase === 'complete') && (
                <DuplicateScanProgress status={localScanStatus} />
            )}
        </div>
    );
};
