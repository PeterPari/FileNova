// Stage 10: Enhanced Preview Panel with Multiple Renderers
import { useFileStore } from '../store/fileStore';
import { 
    FileText, Calendar, Database, Film, Music, 
    FileArchive, X, Eye, Code, Copy, Check
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LRUCache } from '../utils/errorHandling';

// Module-level LRU cache for thumbnails/previews (limit 500 items)
const previewCache = new LRUCache<string, FilePreview>(500);

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
    encoding?: string;
    exif?: ExifData;
    waveform?: number[];
    archive_entries?: ArchiveEntry[];
}

interface ArchiveEntry {
    name: string;
    is_directory: boolean;
    compressed_size: number;
    uncompressed_size: number;
}

interface ExifData {
    camera_model?: string;
    date_taken?: string;
    iso?: number;
    shutter_speed?: string;
    aperture?: string;
    focal_length?: string;
}

export const EnhancedPreviewPanel = () => {
    const { selectedFile, previewPanelOpen, togglePreviewPanel } = useFileStore();
    const [preview, setPreview] = useState<FilePreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [showRawMode, setShowRawMode] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (selectedFile && !selectedFile.is_directory && previewPanelOpen) {
            loadPreview();
        } else {
            setPreview(null);
        }
    }, [selectedFile, previewPanelOpen]);

    const loadPreview = async () => {
        if (!selectedFile) return;

        // Check LRU cache first
        const cacheKey = selectedFile.path;
        const cached = previewCache.get(cacheKey);
        if (cached) {
            setPreview(cached);
            // Still record file access in background
            invoke<number>('get_file_db_id', { path: selectedFile.path })
                .then(fileId => invoke('record_file_access', { fileId }))
                .catch(() => {});
            return;
        }

        setLoading(true);
        try {
            // First record the file access
            const fileId = await invoke<number>('get_file_db_id', { path: selectedFile.path });
            await invoke('record_file_access', { fileId });

            // Then generate preview
            const result = await invoke<FilePreview>('generate_file_preview', {
                fileId,
                previewType: 'thumbnail'
            });
            // Store in LRU cache
            previewCache.set(cacheKey, result);
            setPreview(result);
        } catch (error) {
            console.error('Failed to load preview:', error);
            setPreview(null);
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = () => {
        if (preview?.content) {
            navigator.clipboard.writeText(preview.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const formatFileSize = (bytes: number): string => {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    };

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    if (!previewPanelOpen) {
        return null;
    }

    if (!selectedFile) {
        return (
            <div className="w-80 bg-gray-50 dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 p-6 flex flex-col items-center justify-center text-gray-400 relative">
                <button
                    onClick={togglePreviewPanel}
                    className="absolute top-4 right-4 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    title="Close Preview Panel (Ctrl+P)"
                >
                    <X size={20} />
                </button>
                <FileText size={48} className="mb-4 opacity-20" />
                <p>Select a file to preview</p>
            </div>
        );
    }

    if (selectedFile.is_directory) {
        return (
            <aside className="w-80 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 p-6 flex flex-col relative">
                <button
                    onClick={togglePreviewPanel}
                    className="absolute top-4 right-4 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    title="Close Preview Panel (Ctrl+P)"
                >
                    <X size={20} />
                </button>
                <div className="flex flex-col items-center mb-6">
                    <div className="w-24 h-24 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center mb-4">
                        <FileText size={48} className="text-blue-500" />
                    </div>
                    <h2 className="font-semibold text-lg text-center break-all">{selectedFile.name}</h2>
                    <p className="text-sm text-gray-500 mt-1">Folder</p>
                </div>
            </aside>
        );
    }

    return (
        <aside className="w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col h-full overflow-y-auto relative">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <button
                    onClick={togglePreviewPanel}
                    className="absolute top-4 right-4 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded z-10"
                    title="Close Preview Panel (Ctrl+P)"
                >
                    <X size={20} />
                </button>
                <h2 className="font-semibold text-lg pr-8 break-all">{selectedFile.name}</h2>
                <p className="text-sm text-gray-500 mt-1">
                    {preview?.metadata.file_type.toUpperCase() || 'File'}
                </p>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                </div>
            ) : preview ? (
                <>
                    {/* Preview Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {renderPreviewContent(preview, showRawMode, setShowRawMode, copied, copyToClipboard)}
                    </div>

                    {/* Metadata Section */}
                    <div className="border-t border-gray-200 dark:border-gray-700 p-6 space-y-4">
                        <div>
                            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-2">
                                <Database size={12} /> Size
                            </h3>
                            <p className="text-sm">{formatFileSize(preview.metadata.size_bytes)}</p>
                        </div>

                        {preview.metadata.dimensions && (
                            <div>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Dimensions</h3>
                                <p className="text-sm">
                                    {preview.metadata.dimensions[0]} × {preview.metadata.dimensions[1]} px
                                </p>
                            </div>
                        )}

                        {preview.metadata.duration && (
                            <div>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Duration</h3>
                                <p className="text-sm">{formatDuration(preview.metadata.duration)}</p>
                            </div>
                        )}

                        {preview.metadata.page_count && (
                            <div>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Pages</h3>
                                <p className="text-sm">{preview.metadata.page_count}</p>
                            </div>
                        )}

                        {preview.metadata.line_count && (
                            <div>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Lines</h3>
                                <p className="text-sm">{preview.metadata.line_count.toLocaleString()}</p>
                            </div>
                        )}

                        {preview.metadata.exif && (
                            <div>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">EXIF Data</h3>
                                <div className="space-y-1 text-sm">
                                    {preview.metadata.exif.camera_model && (
                                        <p>Camera: {preview.metadata.exif.camera_model}</p>
                                    )}
                                    {preview.metadata.exif.date_taken && (
                                        <p>Date: {preview.metadata.exif.date_taken}</p>
                                    )}
                                    {preview.metadata.exif.iso && (
                                        <p>ISO: {preview.metadata.exif.iso}</p>
                                    )}
                                    {preview.metadata.exif.shutter_speed && (
                                        <p>Shutter: {preview.metadata.exif.shutter_speed}</p>
                                    )}
                                </div>
                            </div>
                        )}

                        <div>
                            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-2">
                                <Calendar size={12} /> Modified
                            </h3>
                            <p className="text-sm">
                                {new Date(selectedFile.modified_at * 1000).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </>
            ) : (
                <div className="flex-1 flex items-center justify-center text-gray-400">
                    <p>Preview not available</p>
                </div>
            )}
        </aside>
    );
};

function renderPreviewContent(
    preview: FilePreview,
    showRawMode: boolean,
    setShowRawMode: (show: boolean) => void,
    copied: boolean,
    copyToClipboard: () => void
) {
    const fileType = preview.metadata.file_type.toLowerCase();

    // Image preview
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(fileType)) {
        return (
            <div className="flex flex-col items-center">
                {preview.thumbnail && (
                    <img
                        src={preview.thumbnail}
                        alt="Preview"
                        className="max-w-full h-auto rounded-lg shadow-lg"
                    />
                )}
            </div>
        );
    }

    // PDF preview
    if (fileType === 'pdf') {
        return (
            <div className="flex flex-col items-center w-full">
                {preview.thumbnail ? (
                    <img
                        src={preview.thumbnail}
                        alt="PDF Preview"
                        className="max-w-full h-auto rounded-lg shadow-lg border border-gray-300 dark:border-gray-600"
                    />
                ) : preview.content ? (
                    <div className="w-full">
                        <div className="flex items-center gap-2 mb-3 text-sm text-gray-500 dark:text-gray-400">
                            <FileText size={16} />
                            <span>PDF Text Content</span>
                            {preview.metadata.page_count && (
                                <span className="ml-auto px-2 py-0.5 text-xs rounded bg-gray-100 dark:bg-gray-700">
                                    {preview.metadata.page_count} page{preview.metadata.page_count !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                        <pre className="w-full max-h-[600px] overflow-auto p-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                            {preview.content}
                        </pre>
                    </div>
                ) : (
                    <div className="flex flex-col items-center text-gray-400">
                        <FileText size={64} className="mb-4 opacity-30" />
                        <p>PDF preview not available</p>
                    </div>
                )}
            </div>
        );
    }

    // Video preview
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(fileType)) {
        const fmtDuration = (seconds: number): string => {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        return (
            <div className="flex flex-col items-center w-full">
                {preview.thumbnail ? (
                    <img
                        src={preview.thumbnail}
                        alt="Video Thumbnail"
                        className="max-w-full h-auto rounded-lg shadow-lg"
                    />
                ) : (
                    <div className="flex flex-col items-center text-gray-400">
                        <Film size={64} className="mb-4 opacity-30" />
                        <p>Video preview not available</p>
                        <p className="text-xs mt-1">Install ffmpeg for video thumbnails</p>
                    </div>
                )}
                {/* Video metadata */}
                <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
                    {preview.metadata.duration != null && (
                        <span>Duration: {fmtDuration(preview.metadata.duration)}</span>
                    )}
                    {preview.metadata.dimensions && (
                        <span>Resolution: {preview.metadata.dimensions[0]}x{preview.metadata.dimensions[1]}</span>
                    )}
                </div>
            </div>
        );
    }

    // Audio preview
    if (['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'].includes(fileType)) {
        const fmtDuration = (secs: number) => {
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        };

        return (
            <div className="flex flex-col items-center w-full">
                <Music size={48} className="mb-3 text-purple-400" />
                {preview.metadata?.duration && (
                    <p className="text-sm text-gray-400 mb-3">
                        Duration: {fmtDuration(preview.metadata.duration)}
                    </p>
                )}
                {preview.metadata?.waveform && preview.metadata.waveform.length > 0 ? (
                    <div className="w-full px-4">
                        <div className="flex items-end gap-px h-24 w-full bg-gray-800/30 rounded-lg p-2">
                            {preview.metadata.waveform.map((amp: number, i: number) => (
                                <div
                                    key={i}
                                    className="flex-1 bg-purple-500 rounded-t-sm min-w-[1px] transition-all"
                                    style={{
                                        height: `${Math.max(amp * 100, 2)}%`,
                                        opacity: 0.5 + amp * 0.5,
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-gray-500">Waveform unavailable</p>
                )}
            </div>
        );
    }

    // Text/Code preview
    if (preview.content) {
        const isMarkdown = fileType === 'md';
        const isCode = ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'java', 'cpp', 'c', 'go', 'rb', 'php'].includes(fileType);

        return (
            <div className="space-y-3">
                {(isMarkdown || isCode) && (
                    <div className="flex gap-2 items-center justify-between">
                        <div className="flex gap-2">
                            {isMarkdown && (
                                <>
                                    <button
                                        onClick={() => setShowRawMode(false)}
                                        className={`px-3 py-1 text-xs rounded ${
                                            !showRawMode
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                        }`}
                                    >
                                        <Eye size={14} className="inline mr-1" />
                                        Preview
                                    </button>
                                    <button
                                        onClick={() => setShowRawMode(true)}
                                        className={`px-3 py-1 text-xs rounded ${
                                            showRawMode
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                                        }`}
                                    >
                                        <Code size={14} className="inline mr-1" />
                                        Raw
                                    </button>
                                </>
                            )}
                        </div>
                        <button
                            onClick={copyToClipboard}
                            className="px-3 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
                            title="Copy to clipboard"
                        >
                            {copied ? (
                                <>
                                    <Check size={14} className="inline mr-1" />
                                    Copied!
                                </>
                            ) : (
                                <>
                                    <Copy size={14} className="inline mr-1" />
                                    Copy
                                </>
                            )}
                        </button>
                    </div>
                )}

                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 overflow-x-auto">
                    {isMarkdown && !showRawMode ? (
                        // TODO: Add markdown rendering with react-markdown
                        <div
                            className="prose dark:prose-invert max-w-none text-sm"
                            dangerouslySetInnerHTML={{ __html: preview.content }}
                        />
                    ) : (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                            {preview.content}
                        </pre>
                    )}
                </div>
            </div>
        );
    }

    // Archive preview
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(fileType)) {
        const fmtSize = (b: number) => {
            if (b >= 1024 * 1024 * 1024) return `${(b / (1024 ** 3)).toFixed(1)} GB`;
            if (b >= 1024 * 1024) return `${(b / (1024 ** 2)).toFixed(1)} MB`;
            if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
            return `${b} B`;
        };
        const entries = preview.metadata?.archive_entries;

        return (
            <div className="flex flex-col w-full">
                <div className="flex items-center gap-2 mb-3">
                    <FileArchive size={24} className="text-orange-400" />
                    {preview.content && (
                        <p className="text-xs text-gray-400">{preview.content}</p>
                    )}
                </div>
                {entries && entries.length > 0 ? (
                    <div className="bg-gray-800/30 rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1.5 text-xs font-medium text-gray-500 border-b border-gray-700/50">
                            <span>Name</span>
                            <span className="text-right">Size</span>
                            <span className="text-right">Compressed</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                            {entries.map((entry, i) => {
                                const depth = (entry.name.match(/\//g) || []).length - (entry.is_directory ? 1 : 0);
                                return (
                                    <div
                                        key={i}
                                        className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1 text-xs hover:bg-gray-700/30 border-b border-gray-800/30"
                                    >
                                        <span
                                            className={`truncate ${entry.is_directory ? 'text-yellow-400' : 'text-gray-300'}`}
                                            style={{ paddingLeft: `${depth * 12}px` }}
                                            title={entry.name}
                                        >
                                            {entry.is_directory ? '📁 ' : '📄 '}
                                            {entry.name.replace(/\/$/, '').split('/').pop()}
                                        </span>
                                        <span className="text-gray-500 text-right whitespace-nowrap">
                                            {entry.is_directory ? '—' : fmtSize(entry.uncompressed_size)}
                                        </span>
                                        <span className="text-gray-500 text-right whitespace-nowrap">
                                            {entry.is_directory ? '—' : fmtSize(entry.compressed_size)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-gray-500">No entries found or unsupported archive format</p>
                )}
            </div>
        );
    }

    // Fallback
    return (
        <div className="flex flex-col items-center text-gray-400">
            <FileText size={64} className="mb-4 opacity-30" />
            <p>Preview not available for this file type</p>
        </div>
    );
}
