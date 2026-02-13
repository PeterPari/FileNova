import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useFileStore } from '../store/fileStore';
import { X, RefreshCw, ArrowRight, Check, AlertTriangle, Wand2 } from 'lucide-react';

interface RenamePreview {
    file_id: number | null;
    original_name: string;
    new_name: string;
    original_path: string;
    new_path: string;
    conflict?: {
        kind: 'exists' | 'duplicate' | string;
        message: string;
    } | null;
}

interface RenamePatternSuggestion {
    pattern: string;
    examples: { old: string; new: string }[];
}

interface BatchRenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMode?: 'default' | 'smart';
}

export const BatchRenameModal: React.FC<BatchRenameModalProps> = ({ isOpen, onClose, initialMode = 'default' }) => {
    const { selectedFiles, loadFiles, currentPath } = useFileStore();
    const [pattern, setPattern] = useState('{name}_{counter}');
    const [previews, setPreviews] = useState<RenamePreview[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [aiSuggestion, setAiSuggestion] = useState<RenamePatternSuggestion | null>(null);
    const [actionOverrides, setActionOverrides] = useState<Record<string, { skip?: boolean; overwrite?: boolean }>>({});
    const [applyToAllConflicts, setApplyToAllConflicts] = useState(false);

    useEffect(() => {
        if (isOpen && selectedFiles.length > 0) {
            if (initialMode === 'smart') {
                handleSmartDetect();
            } else {
                updatePreview();
            }
        } else {
            setPreviews([]);
            setSuccessMsg(null);
            setError(null);
            setPattern('{name}_{counter}');
            setAiSuggestion(null);
            setActionOverrides({});
            setApplyToAllConflicts(false);
        }
    }, [isOpen, selectedFiles]);

    // re-run preview when pattern changes
    useEffect(() => {
        if (isOpen && selectedFiles.length > 0 && !isDetecting) {
            const timer = setTimeout(() => updatePreview(), 300);
            return () => clearTimeout(timer);
        }
    }, [pattern]);

    const handleSmartDetect = async () => {
        setIsDetecting(true);
        setError(null);
        try {
            const samplePaths = selectedFiles.slice(0, 50).map(f => f.path);
            const suggestion = await invoke<RenamePatternSuggestion>('detect_rename_pattern', { files: samplePaths });
            setAiSuggestion(suggestion);
            if (suggestion?.pattern) {
                setPattern(suggestion.pattern);
            }
            // Preview will update via useEffect on pattern change
        } catch (err) {
            console.error("Smart detect failed:", err);
            setError('Smart detect failed. Try again or adjust the pattern manually.');
            // Fallback
        } finally {
            setIsDetecting(false);
        }
    };

    const updatePreview = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const paths = selectedFiles.map(f => f.path);
            const res = await invoke<RenamePreview[]>('batch_rename_preview', {
                paths,
                pattern
            });
            setPreviews(res);
            setActionOverrides({});
        } catch (err) {
            setError(String(err));
        } finally {
            setIsLoading(false);
        }
    };

    const executeRename = async () => {
        setIsLoading(true);
        try {
            const hasUnresolvedConflicts = previews.some(p => {
                if (!p.conflict) return false;
                const override = actionOverrides[p.original_path];
                return !override?.skip && !override?.overwrite;
            });

            if (hasUnresolvedConflicts) {
                setError('Resolve rename conflicts before executing.');
                return;
            }

            const operations = previews.map(p => ({
                original_path: p.original_path,
                new_path: p.new_path,
                overwrite: !!actionOverrides[p.original_path]?.overwrite,
                skip: !!actionOverrides[p.original_path]?.skip
            }));

            await invoke('execute_batch_rename', { renames: operations });
            setSuccessMsg(`Successfully renamed ${previews.length} files.`);
            setTimeout(() => {
                onClose();
                loadFiles(currentPath); // Refresh
            }, 1500);
        } catch (err) {
            setError("Failed to execute rename: " + String(err));
        } finally {
            setIsLoading(false);
        }
    };

    const splitName = (fileName: string) => {
        const idx = fileName.lastIndexOf('.');
        if (idx > 0) {
            return { base: fileName.slice(0, idx), ext: fileName.slice(idx + 1) };
        }
        return { base: fileName, ext: '' };
    };

    const joinPath = (parent: string, name: string, samplePath: string) => {
        const sep = samplePath.includes('\\') ? '\\' : '/';
        if (!parent) return name;
        return `${parent}${sep}${name}`;
    };

    const applyConflictAction = (preview: RenamePreview, action: 'skip' | 'rename' | 'overwrite') => {
        const targets = applyToAllConflicts
            ? previews.filter(p => p.conflict)
            : [preview];

        const updatedPreviews = [...previews];
        const updatedOverrides = { ...actionOverrides };

        for (const target of targets) {
            const idx = updatedPreviews.findIndex(p => p.original_path === target.original_path);
            if (idx === -1) continue;

            if (action === 'skip') {
                updatedOverrides[target.original_path] = { skip: true };
                continue;
            }

            if (action === 'overwrite') {
                updatedOverrides[target.original_path] = { overwrite: true };
                continue;
            }

            const existingNames = new Set(
                updatedPreviews.map(p => p.new_name.toLowerCase())
            );

            const { base, ext } = splitName(updatedPreviews[idx].new_name);
            let counter = 1;
            let candidate = '';
            do {
                candidate = ext ? `${base} (${counter}).${ext}` : `${base} (${counter})`;
                counter += 1;
            } while (existingNames.has(candidate.toLowerCase()));

            const parent = updatedPreviews[idx].new_path.replace(/[/\\][^/\\]*$/, '');
            const newPath = joinPath(parent, candidate, updatedPreviews[idx].new_path);

            updatedPreviews[idx] = {
                ...updatedPreviews[idx],
                new_name: candidate,
                new_path: newPath,
                conflict: null
            };
            delete updatedOverrides[target.original_path];
        }

        setPreviews(updatedPreviews);
        setActionOverrides(updatedOverrides);
    };

    const conflictCount = previews.filter(p => p.conflict).length;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-base border border-base rounded-xl w-[800px] h-[600px] flex flex-col" style={{ boxShadow: 'var(--shadow-xl)' }}>
                {/* Header */}
                <div className="p-4 border-b border-base flex justify-between items-center">
                    <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 text-blue-400" />
                        Batch Rename
                    </h2>
                    <button onClick={onClose} className="text-muted hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 p-6 overflow-hidden flex flex-col gap-6">
                    {/* Pattern Input */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-secondary">Naming Pattern</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={pattern}
                                onChange={(e) => setPattern(e.target.value)}
                                className="flex-1 bg-surface border border-base rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="{name}_{counter}"
                            />
                            <button
                                onClick={handleSmartDetect}
                                disabled={isDetecting}
                                className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors flex items-center gap-2 text-sm font-medium disabled:opacity-50"
                                title="AI Smart Detect"
                            >
                                <Wand2 size={16} className={isDetecting ? "animate-pulse" : ""} />
                                {isDetecting ? "Detecting..." : "Smart Detect"}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                            <TemplateButton label="Date + Tag + Seq" onClick={() => setPattern('{YYYY}-{MM}-{DD}_{tag}_{counter}')} />
                            <TemplateButton label="Filename + Seq" onClick={() => setPattern('{filename}_{counter}')} />
                            <TemplateButton label="Date + Filename" onClick={() => setPattern('{YYYY}-{MM}-{DD}_{filename}')} />
                        </div>
                        <div className="flex flex-wrap gap-1 mt-2">
                            <TokenButton token="{filename}" onClick={() => setPattern(p => p + '{filename}')} />
                            <TokenButton token="{tag}" onClick={() => setPattern(p => p + '{tag}')} />
                            <TokenButton token="{counter}" onClick={() => setPattern(p => p + '{counter}')} />
                            <TokenButton token="{YYYY}" onClick={() => setPattern(p => p + '{YYYY}')} />
                            <TokenButton token="{MM}" onClick={() => setPattern(p => p + '{MM}')} />
                            <TokenButton token="{DD}" onClick={() => setPattern(p => p + '{DD}')} />
                            <TokenButton token="{ext}" onClick={() => setPattern(p => p + '{ext}')} />
                        </div>
                        <p className="text-xs text-muted">Available tokens: {"{filename}, {tag}, {counter}, {YYYY}, {MM}, {DD}, {ext}"}</p>
                        {aiSuggestion && aiSuggestion.examples?.length > 0 && (
                            <div className="mt-3 bg-surface-hover border border-base rounded-lg p-3">
                                <div className="text-xs uppercase text-muted font-semibold mb-2">AI Examples</div>
                                <div className="space-y-1 text-xs text-secondary">
                                    {aiSuggestion.examples.slice(0, 3).map((ex, idx) => (
                                        <div key={idx} className="flex items-center gap-2">
                                            <span className="text-muted truncate">{ex.old}</span>
                                            <ArrowRight className="w-3 h-3 text-secondary" />
                                            <span className="text-green-400 truncate">{ex.new}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Preview List */}
                    {conflictCount > 0 && (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-xs text-amber-300 flex items-center justify-between">
                            <span>{conflictCount} rename conflict{conflictCount !== 1 ? 's' : ''} detected.</span>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={applyToAllConflicts}
                                    onChange={(e) => setApplyToAllConflicts(e.target.checked)}
                                    className="w-3.5 h-3.5 rounded bg-surface border-base"
                                />
                                Apply to all conflicts
                            </label>
                        </div>
                    )}
                    <div className="flex-1 border border-base rounded-lg overflow-hidden flex flex-col bg-base">
                        <div className="bg-surface px-4 py-2 border-b border-base grid grid-cols-2 gap-4 text-xs font-medium text-muted uppercase tracking-wider">
                            <div>Original Name</div>
                            <div>New Name</div>
                        </div>
                        <div className="overflow-y-auto flex-1 p-2 space-y-1">
                            {isLoading && previews.length === 0 ? (
                                <div className="text-center py-10 text-muted flex flex-col items-center gap-2">
                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                    <span>Generating preview...</span>
                                </div>
                            ) : (
                                previews.map((preview, idx) => (
                                    <div key={preview.file_id || idx} className="grid grid-cols-2 gap-4 px-2 py-2 hover:bg-surface-hover rounded text-sm group">
                                        <div className="text-muted truncate">{preview.original_name}</div>
                                        <div className="flex flex-col gap-1">
                                            <div className="text-green-400 truncate flex items-center gap-2">
                                                <ArrowRight className="w-3 h-3 text-secondary group-hover:text-muted" />
                                                {preview.new_name}
                                            </div>
                                            {preview.conflict && (
                                                <div className="flex items-center gap-2 text-xs text-amber-400">
                                                    <AlertTriangle className="w-3 h-3" />
                                                    <span>{preview.conflict.message}</span>
                                                    <div className="ml-auto flex items-center gap-2">
                                                        <select
                                                            className="bg-surface border border-base rounded px-2 py-1 text-xs text-primary"
                                                            value={actionOverrides[preview.original_path]?.skip ? 'skip' : actionOverrides[preview.original_path]?.overwrite ? 'overwrite' : 'unresolved'}
                                                            onChange={(e) => {
                                                                const value = e.target.value as 'skip' | 'rename' | 'overwrite' | 'unresolved';
                                                                if (value !== 'unresolved') {
                                                                    applyConflictAction(preview, value);
                                                                }
                                                            }}
                                                        >
                                                            <option value="unresolved" disabled>Resolve...</option>
                                                            <option value="rename">Rename (1)</option>
                                                            <option value="skip">Skip</option>
                                                            <option value="overwrite">Overwrite</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            )}
                                            {!preview.conflict && actionOverrides[preview.original_path]?.skip && (
                                                <div className="text-xs text-muted">Skipped</div>
                                            )}
                                            {!preview.conflict && actionOverrides[preview.original_path]?.overwrite && (
                                                <div className="text-xs text-muted">Overwrite enabled</div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-2 text-red-400 text-sm">
                            <AlertTriangle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    {successMsg && (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 flex items-center gap-2 text-green-400 text-sm">
                            <Check className="w-4 h-4" />
                            {successMsg}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-base flex justify-end gap-3 bg-surface">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-secondary hover:bg-surface-hover hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={executeRename}
                        disabled={
                            isLoading ||
                            previews.length === 0 ||
                            !!successMsg ||
                            previews.some(p => p.conflict && !actionOverrides[p.original_path]?.skip && !actionOverrides[p.original_path]?.overwrite)
                        }
                        className="px-6 py-2 rounded-lg bg-accent-primary hover:bg-blue-500 text-white font-medium hover:shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        style={{ boxShadow: 'var(--shadow-lg)' }}
                    >
                        {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Rename {previews.length} Files
                    </button>
                </div>
            </div>
        </div>
    );
};

const TokenButton = ({ token, onClick }: { token: string; onClick: () => void }) => (
    <button
        onClick={onClick}
        className="px-2 py-1 bg-surface hover:bg-surface-hover border border-base rounded text-xs text-secondary transition-colors"
    >
        {token}
    </button>
);

const TemplateButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button
        onClick={onClick}
        className="px-2.5 py-1 bg-surface hover:bg-surface-hover border border-base rounded text-xs text-primary transition-colors"
    >
        {label}
    </button>
);
