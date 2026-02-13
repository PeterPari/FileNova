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
            <div className="w-80 bg-surface p-6 flex flex-col items-center justify-center text-muted relative h-full">
                <button
                    onClick={togglePreviewPanel}
                    className="absolute top-4 right-4 p-1 hover:bg-surface-hover rounded transition-theme"
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
            <aside className="w-80 bg-surface p-6 flex flex-col relative h-full">
                <button
                    onClick={togglePreviewPanel}
                    className="absolute top-4 right-4 p-1 hover:bg-surface-hover rounded transition-theme"
                    title="Close Preview Panel (Ctrl+P)"
                >
                    <X size={20} />
                </button>
                <div className="flex flex-col items-center mb-6">
                    <div className="w-24 h-24 rounded-lg flex items-center justify-center mb-4" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' }}>
                        <FileText size={48} className="text-accent-primary" />
                    </div>
                    <h2 className="font-semibold text-lg text-center break-all text-primary">{selectedFile.name}</h2>
                    <p className="text-sm text-secondary mt-1">Folder</p>
                </div>
            </aside>
        );
    }

    return (
        <aside className="w-full bg-surface flex flex-col h-full overflow-y-auto relative">
            <div className="p-6 border-b border-base">
                <button
                    onClick={togglePreviewPanel}
                    className="absolute top-4 right-4 p-1 hover:bg-surface-hover rounded z-10 transition-theme"
                    title="Close Preview Panel (Ctrl+P)"
                >
                    <X size={20} />
                </button>
                <h2 className="font-semibold text-lg pr-8 break-all text-primary">{selectedFile.name}</h2>
                <p className="text-sm text-secondary mt-1">
                    {preview?.metadata.file_type.toUpperCase() || 'File'}
                </p>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'var(--accent-blue)' }}></div>
                </div>
            ) : preview ? (
                <>
                    {/* Preview Content */}
                    <div className="flex-1 overflow-y-auto p-6">
                        {renderPreviewContent(preview, showRawMode, setShowRawMode, copied, copyToClipboard)}
                    </div>

                    {/* Metadata Section */}
                    <div className="border-t border-base p-6 space-y-4">
                        <div>
                            <h3 className="text-xs font-semibold text-muted uppercase mb-2 flex items-center gap-2">
                                <Database size={12} /> Size
                            </h3>
                            <p className="text-sm text-primary">{formatFileSize(preview.metadata.size_bytes)}</p>
                        </div>

                        {preview.metadata.dimensions && (
                            <div>
                                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Dimensions</h3>
                                <p className="text-sm text-primary">
                                    {preview.metadata.dimensions[0]} x {preview.metadata.dimensions[1]} px
                                </p>
                            </div>
                        )}

                        {preview.metadata.duration && (
                            <div>
                                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Duration</h3>
                                <p className="text-sm text-primary">{formatDuration(preview.metadata.duration)}</p>
                            </div>
                        )}

                        {preview.metadata.page_count && (
                            <div>
                                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Pages</h3>
                                <p className="text-sm text-primary">{preview.metadata.page_count}</p>
                            </div>
                        )}

                        {preview.metadata.line_count && (
                            <div>
                                <h3 className="text-xs font-semibold text-muted uppercase mb-2">Lines</h3>
                                <p className="text-sm text-primary">{preview.metadata.line_count.toLocaleString()}</p>
                            </div>
                        )}

                        {preview.metadata.exif && (
                            <div>
                                <h3 className="text-xs font-semibold text-muted uppercase mb-2">EXIF Data</h3>
                                <div className="space-y-1 text-sm text-secondary">
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
                            <h3 className="text-xs font-semibold text-muted uppercase mb-2 flex items-center gap-2">
                                <Calendar size={12} /> Modified
                            </h3>
                            <p className="text-sm text-primary">
                                {new Date(selectedFile.modified_at * 1000).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </>
            ) : (
                <div className="flex-1 flex items-center justify-center text-muted">
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
                        className="max-w-full h-auto rounded-lg shadow-theme-lg"
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
                        className="max-w-full h-auto rounded-lg shadow-theme-lg border border-base"
                    />
                ) : preview.content ? (
                    <div className="w-full">
                        <div className="flex items-center gap-2 mb-3 text-sm text-secondary">
                            <FileText size={16} />
                            <span>PDF Text Content</span>
                            {preview.metadata.page_count && (
                                <span className="ml-auto px-2 py-0.5 text-xs rounded bg-surface-hover">
                                    {preview.metadata.page_count} page{preview.metadata.page_count !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                        <pre className="w-full max-h-[600px] overflow-auto p-4 bg-base border border-base rounded-lg text-sm text-primary whitespace-pre-wrap font-sans leading-relaxed">
                            {preview.content}
                        </pre>
                    </div>
                ) : (
                    <div className="flex flex-col items-center text-muted">
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
                        className="max-w-full h-auto rounded-lg shadow-theme-lg"
                    />
                ) : (
                    <div className="flex flex-col items-center text-muted">
                        <Film size={64} className="mb-4 opacity-30" />
                        <p>Video preview not available</p>
                        <p className="text-xs mt-1">Install ffmpeg for video thumbnails</p>
                    </div>
                )}
                {/* Video metadata */}
                <div className="flex items-center gap-4 mt-3 text-xs text-secondary">
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
                <Music size={48} className="mb-3" style={{ color: 'var(--accent-blue)' }} />
                {preview.metadata?.duration && (
                    <p className="text-sm text-secondary mb-3">
                        Duration: {fmtDuration(preview.metadata.duration)}
                    </p>
                )}
                {preview.metadata?.waveform && preview.metadata.waveform.length > 0 ? (
                    <div className="w-full px-4">
                        <div className="flex items-end gap-px h-24 w-full bg-surface-hover rounded-lg p-2">
                            {preview.metadata.waveform.map((amp: number, i: number) => (
                                <div
                                    key={i}
                                    className="flex-1 rounded-t-sm min-w-[1px] transition-all"
                                    style={{
                                        height: `${Math.max(amp * 100, 2)}%`,
                                        opacity: 0.5 + amp * 0.5,
                                        backgroundColor: 'var(--accent-blue)',
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-muted">Waveform unavailable</p>
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
                                        className={`px-3 py-1 text-xs rounded transition-theme ${
                                            !showRawMode
                                                ? 'bg-accent-primary text-white'
                                                : 'bg-surface-hover text-secondary'
                                        }`}
                                    >
                                        <Eye size={14} className="inline mr-1" />
                                        Preview
                                    </button>
                                    <button
                                        onClick={() => setShowRawMode(true)}
                                        className={`px-3 py-1 text-xs rounded transition-theme ${
                                            showRawMode
                                                ? 'bg-accent-primary text-white'
                                                : 'bg-surface-hover text-secondary'
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
                            className="px-3 py-1 text-xs rounded bg-surface-hover hover:bg-surface-active text-secondary transition-theme"
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

                <div className="bg-surface-hover rounded-lg p-4 overflow-x-auto">
                    {isMarkdown && !showRawMode ? (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-primary">
                            {preview.content}
                        </pre>
                    ) : (
                        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-primary">
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
                    <FileArchive size={24} style={{ color: 'var(--accent-yellow)' }} />
                    {preview.content && (
                        <p className="text-xs text-secondary">{preview.content}</p>
                    )}
                </div>
                {entries && entries.length > 0 ? (
                    <div className="bg-surface-hover rounded-lg overflow-hidden">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1.5 text-xs font-medium text-muted border-b border-base">
                            <span>Name</span>
                            <span className="text-right">Size</span>
                            <span className="text-right">Compressed</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto custom-scrollbar">
                            {entries.map((entry, i) => {
                                const depth = (entry.name.match(/\//g) || []).length - (entry.is_directory ? 1 : 0);
                                return (
                                    <div
                                        key={i}
                                        className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1 text-xs hover:bg-surface-active border-b border-base/30 transition-theme"
                                    >
                                        <span
                                            className={`truncate ${entry.is_directory ? 'text-yellow-400' : 'text-primary'}`}
                                            style={{ paddingLeft: `${depth * 12}px` }}
                                            title={entry.name}
                                        >
                                            {entry.is_directory ? '📁 ' : '📄 '}
                                            {entry.name.replace(/\/$/, '').split('/').pop()}
                                        </span>
                                        <span className="text-muted text-right whitespace-nowrap">
                                            {entry.is_directory ? '—' : fmtSize(entry.uncompressed_size)}
                                        </span>
                                        <span className="text-muted text-right whitespace-nowrap">
                                            {entry.is_directory ? '—' : fmtSize(entry.compressed_size)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-muted">No entries found or unsupported archive format</p>
                )}
            </div>
        );
    }

    // Fallback
    return (
        <div className="flex flex-col items-center text-muted">
            <FileText size={64} className="mb-4 opacity-30" />
            <p>Preview not available for this file type</p>
        </div>
    );
}
