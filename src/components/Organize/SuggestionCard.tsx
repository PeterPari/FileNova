import React, { useState } from 'react';
import SuggestionPreview from './SuggestionPreview';
import SuggestionEditor from './SuggestionEditor';

export interface FileMove {
    file_path: string;
    new_path: string;
    reason?: string;
}

export interface SuggestionPlan {
    moves: FileMove[];
    reason: string;
}

export interface Suggestion {
    id: number;
    category: string;
    title: string;
    description: string;
    plan_json: string;
    file_count: number;
    confidence: number;
    status: string;
    created_at: string;
    total_size_bytes?: number | null;
}

interface SuggestionCardProps {
    suggestion: Suggestion;
    onAccept: (id: number) => void;
    onReject: (id: number) => void;
    onModify: (id: number, plan: SuggestionPlan) => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({ suggestion, onAccept, onReject, onModify }) => {
    const [showPreview, setShowPreview] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const plan: SuggestionPlan = JSON.parse(suggestion.plan_json);

    const getConfidenceColor = (score: number) => {
        if (score >= 0.8) return 'bg-green-500 text-white';
        if (score >= 0.5) return 'bg-yellow-500 text-black';
        return 'bg-red-500 text-white';
    };

    const formatSize = (bytes?: number | null) => {
        if (!bytes || bytes <= 0) return '—';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    };

    const Icon = () => {
        switch (suggestion.category) {
            case 'declutter': return <span>🧹</span>;
            case 'consolidate': return <span>📦</span>;
            case 'rename': return <span>🏷️</span>;
            case 'archive': return <span>🗄️</span>;
            case 'sort': return <span>📂</span>;
            default: return <span>💡</span>;
        }
    };

    const handleSaveEdit = (updatedPlan: SuggestionPlan) => {
        onModify(suggestion.id, updatedPlan);
        setIsEditing(false);
    };

    return (
        <div className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700 shadow-lg relative overflow-hidden group">
            {/* Status Indicator Stripe */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 ${suggestion.status === 'modified' ? 'bg-blue-400' : 'bg-transparent'}`}></div>

            <div className="flex justify-between items-start pl-2">
                <div className="flex items-center gap-3">
                    <div className="text-2xl p-2 bg-gray-700 rounded-lg shadow-inner">
                        <Icon />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white tracking-tight">{suggestion.title}</h3>
                        <p className="text-gray-400 text-sm leading-snug">{suggestion.description}</p>
                    </div>
                </div>
                <div className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${getConfidenceColor(suggestion.confidence)}`}>
                    {Math.round(suggestion.confidence * 100)}% Confidence
                </div>
            </div>

            <div className="mt-4 flex gap-3 text-xs text-gray-300 pl-2">
                <span className="bg-gray-700/50 px-2 py-1 rounded border border-gray-600">
                    {suggestion.file_count} files
                </span>
                <span className="bg-gray-700/50 px-2 py-1 rounded border border-gray-600">
                    {formatSize(suggestion.total_size_bytes)} total
                </span>
                <span className="bg-gray-700/50 px-2 py-1 rounded border border-gray-600 capitalize">
                    {suggestion.category}
                </span>
                {suggestion.status === 'modified' && (
                    <span className="bg-blue-900/40 text-blue-300 px-2 py-1 rounded border border-blue-800">
                        Modified
                    </span>
                )}
            </div>

            {showPreview && (
                <div className="mt-4 pl-2">
                    <SuggestionPreview moves={plan.moves} />
                </div>
            )}

            <div className="mt-4 flex justify-between items-center pl-2 pt-2 border-t border-gray-700/50">
                <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="text-gray-400 hover:text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1 transition-colors"
                >
                    {showPreview ? (
                        <><span>Hide Preview</span> <span>▲</span></>
                    ) : (
                        <><span>Show Preview</span> <span>▼</span></>
                    )}
                </button>

                <div className="flex gap-2">
                    <button
                        onClick={() => setIsEditing(true)}
                        className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors border border-gray-600"
                    >
                        Modify
                    </button>
                    <button
                        onClick={() => onReject(suggestion.id)}
                        className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-red-900/50 hover:text-red-300 hover:border-red-800 text-gray-300 transition-colors border border-gray-600"
                    >
                        Reject
                    </button>
                    <button
                        onClick={() => onAccept(suggestion.id)}
                        className="px-4 py-1.5 rounded text-sm bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold transition-all shadow-lg shadow-blue-900/20 border border-blue-500/50"
                    >
                        Accept Suggestion
                    </button>
                </div>
            </div>

            {isEditing && (
                <SuggestionEditor
                    initialPlan={plan}
                    onSave={handleSaveEdit}
                    onCancel={() => setIsEditing(false)}
                />
            )}
        </div>
    );
};

export default SuggestionCard;
