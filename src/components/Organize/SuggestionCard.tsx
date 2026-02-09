import React, { useState } from 'react';

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
}

interface SuggestionCardProps {
    suggestion: Suggestion;
    onAccept: (id: number) => void;
    onReject: (id: number) => void;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({ suggestion, onAccept, onReject }) => {
    const [showPreview, setShowPreview] = useState(false);
    const plan: SuggestionPlan = JSON.parse(suggestion.plan_json);

    const getConfidenceColor = (score: number) => {
        if (score >= 0.8) return 'bg-green-500';
        if (score >= 0.5) return 'bg-yellow-500';
        return 'bg-red-500';
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

    return (
        <div className="bg-gray-800 rounded-lg p-4 mb-4 border border-gray-700 shadow-lg">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                    <div className="text-2xl p-2 bg-gray-700 rounded-lg">
                        <Icon />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white">{suggestion.title}</h3>
                        <p className="text-gray-400 text-sm">{suggestion.description}</p>
                    </div>
                </div>
                <div className={`px-2 py-1 rounded text-xs font-bold text-white ${getConfidenceColor(suggestion.confidence)}`}>
                    {Math.round(suggestion.confidence * 100)}% Confidence
                </div>
            </div>

            <div className="mt-4 flex gap-4 text-sm text-gray-300">
                <span className="bg-gray-700 px-2 py-1 rounded">
                    {suggestion.file_count} files
                </span>
                <span className="bg-gray-700 px-2 py-1 rounded capitalize">
                    {suggestion.category}
                </span>
            </div>

            {showPreview && (
                <div className="mt-4 bg-gray-900 rounded p-4 max-h-60 overflow-y-auto border border-gray-700 font-mono text-xs">
                    <h4 className="text-gray-400 mb-2 font-bold">Proposed Plan:</h4>
                    <ul className="space-y-2">
                        {plan.moves.slice(0, 50).map((move, idx) => (
                            <li key={idx} className="flex gap-2">
                                <span className="text-red-400 truncate w-1/2" title={move.file_path}>
                                    - {move.file_path.split(/[/\\]/).pop()}
                                </span>
                                <span className="text-gray-500">→</span>
                                <span className="text-green-400 truncate w-1/2" title={move.new_path}>
                                    + {move.new_path.split(/[/\\]/).pop()}
                                </span>
                            </li>
                        ))}
                        {plan.moves.length > 50 && (
                            <li className="text-gray-500 italic">...and {plan.moves.length - 50} more</li>
                        )}
                    </ul>
                </div>
            )}

            <div className="mt-4 flex justify-between items-center">
                <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                >
                    {showPreview ? 'Hide Preview' : 'Show Preview'}
                </button>

                <div className="flex gap-2">
                    <button
                        onClick={() => onReject(suggestion.id)}
                        className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                    >
                        Reject
                    </button>
                    <button
                        onClick={() => onAccept(suggestion.id)}
                        className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors shadow-lg shadow-blue-900/20"
                    >
                        Accept Suggestion
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SuggestionCard;
