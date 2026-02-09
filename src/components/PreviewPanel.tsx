import { useFileStore } from '../store/fileStore';
import { FileText, Calendar, Database } from 'lucide-react';

export const PreviewPanel = () => {
    const { selectedFile, previewInfo } = useFileStore();

    if (!selectedFile) {
        return (
            <div className="w-80 bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 p-6 flex flex-col items-center justify-center text-gray-400">
                <FileText size={48} className="mb-4 opacity-20" />
                <p>Select a file to preview</p>
            </div>
        );
    }

    return (
        <aside className="w-80 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 p-6 flex flex-col h-full overflow-y-auto">
            <div className="flex flex-col items-center mb-6">
                <div className="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center mb-4">
                    <FileText size={48} className="text-blue-500" />
                </div>
                <h2 className="font-semibold text-lg text-center break-all">{selectedFile.name}</h2>
                <p className="text-sm text-gray-500 mt-1">{selectedFile.is_directory ? 'Folder' : 'File'}</p>
            </div>

            <div className="space-y-6">
                <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
                        <Database size={12} /> Size
                    </h3>
                    <p className="text-sm">{selectedFile.size} bytes</p>
                </div>

                <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3 flex items-center gap-2">
                        <Calendar size={12} /> Modified
                    </h3>
                    <p className="text-sm">
                        {new Date(selectedFile.modified_at * 1000).toLocaleString()}
                    </p>
                </div>

                {previewInfo && (
                    <>
                        <div>
                            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Created</h3>
                            <p className="text-sm">
                                {previewInfo.created_at ? new Date(previewInfo.created_at * 1000).toLocaleString() : '-'}
                            </p>
                        </div>
                        <div>
                            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Accessed</h3>
                            <p className="text-sm">
                                {previewInfo.accessed_at ? new Date(previewInfo.accessed_at * 1000).toLocaleString() : '-'}
                            </p>
                        </div>
                    </>
                )}
            </div>
        </aside>
    );
};
