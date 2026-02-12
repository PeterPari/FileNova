import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';

export interface RuleConflict {
    source_path: string;
    dest_path: string;
    action: string;
    message: string;
}

export interface RulePlanExecution {
    action: string;
    source_path: string;
    dest_path?: string | null;
    overwrite: boolean;
    skip: boolean;
    tag?: string | null;
}

interface RuleConflictModalProps {
    isOpen: boolean;
    conflicts: RuleConflict[];
    actions: RulePlanExecution[];
    onClose: () => void;
    onConfirm: (actions: RulePlanExecution[]) => void;
}

const splitName = (fileName: string) => {
    const idx = fileName.lastIndexOf('.');
    if (idx > 0) {
        return { base: fileName.slice(0, idx), ext: fileName.slice(idx + 1) };
    }
    return { base: fileName, ext: '' };
};

const buildRenameCandidate = (pathValue: string) => {
    const parts = pathValue.replace(/\\/g, '/').split('/');
    const fileName = parts.pop() || '';
    const { base, ext } = splitName(fileName);
    const candidate = ext ? `${base} (1).${ext}` : `${base} (1)`;
    return [...parts, candidate].join('/');
};

export const RuleConflictModal: React.FC<RuleConflictModalProps> = ({
    isOpen,
    conflicts,
    actions,
    onClose,
    onConfirm,
}) => {
    const [resolvedActions, setResolvedActions] = useState<RulePlanExecution[]>(actions);
    const [applyToAll, setApplyToAll] = useState(false);

    React.useEffect(() => {
        setResolvedActions(actions);
        setApplyToAll(false);
    }, [actions]);

    if (!isOpen) return null;

    const resolveConflict = (conflict: RuleConflict, resolution: 'skip' | 'overwrite' | 'rename') => {
        const targets = applyToAll ? conflicts : [conflict];

        setResolvedActions((prev) =>
            prev.map((action) => {
                const matches = targets.some(
                    (target) =>
                        action.action === target.action &&
                        action.source_path === target.source_path &&
                        action.dest_path === target.dest_path
                );

                if (!matches) return action;

                if (resolution === 'skip') {
                    return { ...action, skip: true, overwrite: false };
                }

                if (resolution === 'overwrite') {
                    return { ...action, overwrite: true, skip: false };
                }

                const newPath = action.dest_path ? buildRenameCandidate(action.dest_path) : action.dest_path;
                return { ...action, dest_path: newPath, overwrite: false, skip: false };
            })
        );
    };

    const isConflictResolved = (conflict: RuleConflict) => {
        const match = resolvedActions.find(
            (action) =>
                action.action === conflict.action &&
                action.source_path === conflict.source_path &&
                action.dest_path === conflict.dest_path
        );

        if (!match) return true;
        return match.skip || match.overwrite || match.dest_path !== conflict.dest_path;
    };

    const unresolvedCount = conflicts.filter((conflict) => !isConflictResolved(conflict)).length;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70]">
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[860px] max-h-[80vh] flex flex-col">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <div className="flex items-center gap-2 text-white">
                        <AlertTriangle className="w-5 h-5 text-amber-400" />
                        <h3 className="text-lg font-semibold">Resolve Conflicts</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-4 border-b border-gray-800 text-xs text-gray-400 flex items-center justify-between">
                    <span>{conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} detected.</span>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={applyToAll}
                            onChange={(e) => setApplyToAll(e.target.checked)}
                            className="w-3.5 h-3.5 rounded bg-gray-800 border-gray-600"
                        />
                        Apply to all conflicts
                    </label>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {conflicts.map((conflict) => (
                        <div key={`${conflict.action}-${conflict.source_path}`} className="border border-gray-800 rounded-lg p-3 bg-gray-950/40">
                            <div className="text-sm text-gray-200 font-medium mb-2">
                                {conflict.action.toUpperCase()} conflict
                            </div>
                            <div className="text-xs text-gray-400 space-y-1">
                                <div className="flex items-center gap-2">
                                    <span className="truncate">{conflict.source_path}</span>
                                    <ArrowRight className="w-3 h-3 text-gray-600" />
                                    <span className="text-amber-300 truncate">{conflict.dest_path}</span>
                                </div>
                                <div className="text-amber-400">{conflict.message}</div>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                    onClick={() => resolveConflict(conflict, 'skip')}
                                    className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
                                >
                                    Skip
                                </button>
                                <button
                                    onClick={() => resolveConflict(conflict, 'rename')}
                                    className="px-3 py-1.5 text-xs bg-blue-900/40 hover:bg-blue-900/60 text-blue-300 rounded"
                                >
                                    Rename to (1)
                                </button>
                                <button
                                    onClick={() => resolveConflict(conflict, 'overwrite')}
                                    className="px-3 py-1.5 text-xs bg-red-900/40 hover:bg-red-900/60 text-red-300 rounded"
                                >
                                    Overwrite
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-4 border-t border-gray-800 flex items-center justify-between">
                    <div className="text-xs text-gray-400">
                        {unresolvedCount === 0
                            ? 'All conflicts resolved.'
                            : `${unresolvedCount} conflict${unresolvedCount !== 1 ? 's' : ''} unresolved.`}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded">
                            Cancel
                        </button>
                        <button
                            onClick={() => onConfirm(resolvedActions)}
                            disabled={unresolvedCount > 0}
                            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50"
                        >
                            Apply Resolutions
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
