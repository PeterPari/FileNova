import { Loader2, CheckCircle } from 'lucide-react';
import { DuplicateScanStatus } from '../store/duplicateStore';

const PHASE_LABELS: Record<string, string> = {
    exact: 'Finding Exact Duplicates',
    perceptual: 'Analyzing Similar Images',
    complete: 'Scan Complete',
};

export const DuplicateScanProgress = ({ status }: { status: DuplicateScanStatus }) => {
    if (!status.is_scanning && status.phase !== 'complete') return null;

    const percentage =
        status.total_files > 0
            ? Math.round((status.files_processed / status.total_files) * 100)
            : 0;

    const phaseLabel = PHASE_LABELS[status.phase] || status.phase;
    const isComplete = status.phase === 'complete';

    return (
        <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 w-80 z-50">
            <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                    {isComplete ? (
                        <CheckCircle className="text-green-500" size={16} />
                    ) : (
                        <Loader2 className="animate-spin text-blue-500" size={16} />
                    )}
                    {phaseLabel}
                </h3>
            </div>

            {status.phase === 'perceptual' && status.total_files > 0 && (
                <div className="mb-2">
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${percentage}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>
                            {status.files_processed} / {status.total_files} images
                        </span>
                        <span>{percentage}%</span>
                    </div>
                </div>
            )}

            <div className="text-xs text-gray-500">
                {status.total_groups} groups found ({formatSize(status.total_wasted_bytes)} wasted)
            </div>
        </div>
    );
};

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
