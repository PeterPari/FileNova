import { Loader2, CheckCircle } from 'lucide-react';
import { useFileStore } from '../store/fileStore';

export const IndexingStatus = () => {
    const { indexingStatus } = useFileStore();

    if (!indexingStatus) return null;

    // If not indexing and no files processed, hide
    if (!indexingStatus.is_indexing && indexingStatus.total_files === 0) return null;

    if (!indexingStatus.is_indexing && indexingStatus.total_files > 0 && indexingStatus.processed_files === indexingStatus.total_files) {
        return (
            <div className="fixed bottom-4 right-4 px-4 py-3 rounded-lg flex items-center gap-3 z-50 animate-slide-up text-white" style={{ backgroundColor: 'var(--status-success)', boxShadow: 'var(--shadow-lg)' }}>
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
        <div className="fixed bottom-4 right-4 bg-surface border border-base p-4 rounded-xl w-80 z-50 animate-slide-up" style={{ boxShadow: 'var(--shadow-lg)' }}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <Loader2 size={16} className="text-accent-primary animate-spin" />
                    <span className="font-medium text-sm text-primary">
                        {indexingStatus.is_indexing ? 'Indexing content...' : 'Paused'}
                    </span>
                </div>
                <span className="text-xs font-mono text-muted">{percentage}%</span>
            </div>

            <div className="w-full bg-surface-hover rounded-full h-1.5 mb-2 overflow-hidden">
                <div
                    className="h-1.5 rounded-full transition-all duration-300 ease-out bg-accent-primary"
                    style={{ width: `${percentage}%` }}
                />
            </div>

            <div className="flex justify-between items-center text-xs text-muted">
                <span className="truncate max-w-[150px]" title={indexingStatus.current_path}>{indexingStatus.current_path || 'Preparing...'}</span>
                <span>{indexingStatus.processed_files} / {indexingStatus.total_files}</span>
            </div>
            <div className="mt-2 text-[11px] text-muted flex justify-between">
                <span>ETA</span>
                <span>{formatEta(indexingStatus.estimated_time_remaining_secs)}</span>
            </div>
        </div>
    );
};
