// Stage 10: Quick Look Modal (macOS-style)
import { useEffect, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface QuickLookProps {
    isOpen: boolean;
    onClose: () => void;
    currentFile: any;
    allFiles: any[];
}

interface FilePreview {
    file_id: number;
    preview_type: string;
    content: string | null;
    metadata: PreviewMetadata;
    thumbnail: string | null;
}

interface PreviewMetadata {
    file_type: string;
    size_bytes: number;
    dimensions?: [number, number];
    duration?: number;
    page_count?: number;
    line_count?: number;
}

export const QuickLookModal = ({ isOpen, onClose, currentFile, allFiles }: QuickLookProps) => {
    const [preview, setPreview] = useState<FilePreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (isOpen && currentFile) {
            const index = allFiles.findIndex(f => f.path === currentFile.path);
            setCurrentIndex(index >= 0 ? index : 0);
            loadPreview(currentFile);
        }
    }, [isOpen, currentFile]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                case ' ':
                    e.preventDefault();
                    onClose();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    navigatePrevious();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    navigateNext();
                    break;
                case 'Enter':
                    e.preventDefault();
                    openFileFully();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, currentIndex, allFiles]);

    const loadPreview = async (file: any) => {
        if (!file || file.is_directory) {
            setPreview(null);
            return;
        }

        setLoading(true);
        try {
            const fileId = await invoke<number>('get_file_db_id', { path: file.path });
            await invoke('record_file_access', { fileId });

            const result = await invoke<FilePreview>('generate_file_preview', {
                fileId,
                previewType: 'full'
            });
            setPreview(result);
        } catch (error) {
            console.error('Failed to load preview:', error);
            setPreview(null);
        } finally {
            setLoading(false);
        }
    };

    const navigatePrevious = useCallback(() => {
        if (currentIndex > 0) {
            const newIndex = currentIndex - 1;
            setCurrentIndex(newIndex);
            loadPreview(allFiles[newIndex]);
        }
    }, [currentIndex, allFiles]);

    const navigateNext = useCallback(() => {
        if (currentIndex < allFiles.length - 1) {
            const newIndex = currentIndex + 1;
            setCurrentIndex(newIndex);
            loadPreview(allFiles[newIndex]);
        }
    }, [currentIndex, allFiles]);

    const openFileFully = () => {
        if (currentFile) {
            // Open file with default application
            invoke('cmd__plugin_opener__open_path', { path: currentFile.path });
        }
    };

    const formatFileSize = (bytes: number): string => {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    };

    if (!isOpen) return null;

    const file = allFiles[currentIndex];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="relative w-full h-full max-w-6xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 bg-gray-900 bg-opacity-90 rounded-t-lg">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-white text-lg font-semibold truncate">{file?.name}</h2>
                        <p className="text-gray-400 text-sm">
                            {preview ? formatFileSize(preview.metadata.size_bytes) : ''}
                            {preview?.metadata.dimensions && (
                                <span className="ml-3">
                                    {preview.metadata.dimensions[0]} × {preview.metadata.dimensions[1]} px
                                </span>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={openFileFully}
                            className="p-2 text-white hover:bg-gray-700 rounded transition-colors"
                            title="Open file (Enter)"
                        >
                            <ExternalLink size={20} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-white hover:bg-gray-700 rounded transition-colors"
                            title="Close (Esc or Space)"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex items-center justify-center bg-gray-800 bg-opacity-50 overflow-hidden">
                    {loading ? (
                        <div className="flex flex-col items-center text-white">
                            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-white mb-4"></div>
                            <p>Loading preview...</p>
                        </div>
                    ) : preview ? (
                        renderQuickLookContent(preview)
                    ) : (
                        <div className="text-white text-center">
                            <p className="text-xl mb-2">Preview not available</p>
                            <p className="text-gray-400">Press Enter to open with default application</p>
                        </div>
                    )}

                    {/* Navigation Arrows */}
                    {allFiles.length > 1 && (
                        <>
                            <button
                                onClick={navigatePrevious}
                                disabled={currentIndex === 0}
                                className="absolute left-4 top-1/2 transform -translate-y-1/2 p-3 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                title="Previous file (←)"
                            >
                                <ChevronLeft size={32} className="text-white" />
                            </button>
                            <button
                                onClick={navigateNext}
                                disabled={currentIndex === allFiles.length - 1}
                                className="absolute right-4 top-1/2 transform -translate-y-1/2 p-3 bg-black bg-opacity-50 hover:bg-opacity-75 rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                title="Next file (→)"
                            >
                                <ChevronRight size={32} className="text-white" />
                            </button>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-3 bg-gray-900 bg-opacity-90 rounded-b-lg text-center text-gray-400 text-sm">
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">←</kbd>
                    <span className="mx-2">Navigate</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">→</kbd>
                    <span className="mx-4">|</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">Enter</kbd>
                    <span className="mx-2">Open</span>
                    <span className="mx-4">|</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">Esc</kbd>
                    <span className="mx-2">Close</span>
                    <span className="ml-4 text-gray-500">
                        {currentIndex + 1} of {allFiles.length}
                    </span>
                </div>
            </div>
        </div>
    );
};

function renderQuickLookContent(preview: FilePreview) {
    const fileType = preview.metadata.file_type.toLowerCase();

    // Image preview
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(fileType)) {
        return preview.thumbnail ? (
            <img
                src={preview.thumbnail}
                alt="Preview"
                className="max-w-full max-h-full object-contain"
            />
        ) : null;
    }

    // PDF preview
    if (fileType === 'pdf') {
        return preview.thumbnail ? (
            <div className="max-w-4xl max-h-full overflow-auto bg-white p-8">
                <img
                    src={preview.thumbnail}
                    alt="PDF Preview"
                    className="w-full h-auto shadow-2xl"
                />
                {preview.metadata.page_count && (
                    <p className="text-center mt-4 text-gray-600">
                        Page 1 of {preview.metadata.page_count}
                    </p>
                )}
            </div>
        ) : null;
    }

    // Video preview
    if (['mp4', 'mov', 'webm'].includes(fileType)) {
        return (
            <video
                controls
                className="max-w-full max-h-full"
                src={`file://${preview.file_id}`}
            >
                Your browser does not support the video tag.
            </video>
        );
    }

    // Audio preview
    if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileType)) {
        return (
            <div className="flex flex-col items-center">
                <div className="bg-gradient-to-br from-purple-500 to-pink-500 rounded-full w-48 h-48 mb-8 flex items-center justify-center">
                    <svg className="w-24 h-24 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                    </svg>
                </div>
                <audio
                    controls
                    className="w-full max-w-md"
                    src={`file://${preview.file_id}`}
                >
                    Your browser does not support the audio tag.
                </audio>
            </div>
        );
    }

    // Text/Code preview
    if (preview.content) {
        return (
            <div className="w-full h-full overflow-auto p-8">
                <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl p-6 max-w-4xl mx-auto">
                    <pre className="text-sm font-mono whitespace-pre-wrap break-words text-gray-900 dark:text-gray-100">
                        {preview.content}
                    </pre>
                </div>
            </div>
        );
    }

    return null;
}
