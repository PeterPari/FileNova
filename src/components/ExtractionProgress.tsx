import { FileText, AlertCircle } from 'lucide-react';
import { useFileStore } from '../store/fileStore';

export const ExtractionProgress = () => {
    const { extractionStatus } = useFileStore();

    if (!extractionStatus || !extractionStatus.is_extracting) return null;

    const { total_files, processed_files, failed_files, current_file } = extractionStatus;
    const pct = total_files > 0 ? Math.round((processed_files / total_files) * 100) : 0;

    // Truncate long paths
    const shortPath = current_file.length > 60
        ? '...' + current_file.slice(-57)
        : current_file;

    return (
        <div className="fixed bottom-4 right-4 bg-white dark:bg-gray-800 shadow-2xl rounded-xl border border-gray-200 dark:border-gray-700 p-4 w-96 z-50">
            <div className="flex items-center gap-3 mb-3">
                <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-lg">
                    <FileText size={18} className="text-purple-600 dark:text-purple-400 animate-pulse" />
                </div>
                <div className="flex-1">
                    <div className="flex justify-between items-baseline">
                        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            Extracting content...
                        </h4>
                        <span className="text-xs font-mono text-gray-500">{pct}%</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                        {processed_files.toLocaleString()} / {total_files.toLocaleString()} files
                    </p>
                </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mb-2">
                <div
                    className="bg-purple-600 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                />
            </div>

            <div className="flex justify-between items-center text-xs text-gray-400">
                <span className="truncate mr-2" title={current_file}>{shortPath}</span>
                {failed_files > 0 && (
                    <span className="flex items-center gap-1 text-amber-500 whitespace-nowrap">
                        <AlertCircle size={12} />
                        {failed_files} failed
                    </span>
                )}
            </div>
        </div>
    );
};
