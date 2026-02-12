import { Loader2, CheckCircle } from 'lucide-react';
import { useFileStore } from '../store/fileStore';

export const IndexingStatus = () => {
    const { indexingStatus } = useFileStore();

    if (!indexingStatus) return null;

    // If not indexing and no files processed, hide
    if (!indexingStatus.is_indexing && indexingStatus.total_files === 0) return null;

    if (!indexingStatus.is_indexing && indexingStatus.total_files > 0 && indexingStatus.processed_files === indexingStatus.total_files) {
        return (
            <div className="fixed bottom-4 right-4 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
                <CheckCircle size={20} />
                <div>
                    <h3 className="font-medium text-sm">Indexing Complete</h3>
                    <p className="text-xs opacity-90">{indexingStatus.total_files.toLocaleString()} files processed</p>
                </div>
            </div>
        );
    }

    const percentage = indexingStatus.percentage_complete > 0
        ? Math.round(indexingStatus.percentage_complete)
        : (indexingStatus.total_files > 0
            ? Math.round((indexingStatus.processed_files / indexingStatus.total_files) * 100)
            : 0);

    const formatEta = (seconds: number) => {
        if (!seconds) return 'Calculating...';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins > 0) {
            return `${mins}m ${secs}s`;
        }
        return `${secs}s`;
    };

    return (
        <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-xl shadow-lg w-80 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Loader2 size={16} className="text-blue-500 animate-spin" />
                    <span className="font-medium text-sm text-gray-700 dark:text-gray-200">
                        {indexingStatus.is_indexing ? 'Indexing content...' : 'Paused'}
                    </span>
                </div>
                <span className="text-xs font-mono text-gray-500">{percentage}%</span>
            </div>

            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 mb-2 overflow-hidden">
                <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${percentage}%` }}
                />
            </div>

            <div className="flex justify-between items-center text-xs text-gray-400">
                <span className="truncate max-w-[150px]" title={indexingStatus.current_path}>{indexingStatus.current_path || 'Preparing...'}</span>
                <span>{indexingStatus.processed_files} / {indexingStatus.total_files}</span>
            </div>
            <div className="mt-2 text-[11px] text-gray-400 flex justify-between">
                <span>ETA</span>
                <span>{formatEta(indexingStatus.estimated_time_remaining_secs)}</span>
            </div>
        </div>
    );
};
