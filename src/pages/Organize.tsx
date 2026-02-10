import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import SuggestionCard, { Suggestion, SuggestionPlan } from '../components/Organize/SuggestionCard';
import FolderStructureOptimizer from '../components/Organize/FolderStructureOptimizer';

const Organize: React.FC = () => {
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);

    const fetchSuggestions = async () => {
        try {
            setLoading(true);
            const res = await invoke<Suggestion[]>('get_pending_suggestions');
            setSuggestions(res);
        } catch (error) {
            console.error("Failed to fetch suggestions:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleAnalyze = async () => {
        try {
            setAnalyzing(true);
            // Wait for analysis to complete
            await invoke('generate_suggestions');
            // Then refresh list
            await fetchSuggestions();
        } catch (error) {
            console.error("Analysis failed:", error);
        } finally {
            setAnalyzing(false);
        }
    };

    const handleAccept = async (id: number) => {
        try {
            await invoke('accept_suggestion', { id });
            // Optimistically remove
            setSuggestions(prev => prev.filter(s => s.id !== id));
        } catch (e) {
            console.error("Failed to accept suggestion:", e);
            alert("Failed to execute suggestion: " + e);
        }
    };

    const handleReject = async (id: number) => {
        try {
            await invoke('reject_suggestion', { id });
            setSuggestions(prev => prev.filter(s => s.id !== id));
        } catch (e) {
            console.error("Failed to reject suggestion:", e);
        }
    };

    const handleModify = async (id: number, updatedPlan: SuggestionPlan) => {
        try {
            await invoke('modify_suggestion', { id, updatedPlan: JSON.stringify(updatedPlan) });
            // Update local state
            setSuggestions(prev => prev.map(s =>
                s.id === id
                    ? { ...s, plan_json: JSON.stringify(updatedPlan), status: 'modified' }
                    : s
            ));
        } catch (e) {
            console.error("Failed to modify suggestion:", e);
            alert("Failed to update plan: " + e);
        }
    };

    useEffect(() => {
        fetchSuggestions();
    }, []);

    return (
        <div className="h-full bg-gray-900 text-white flex flex-col p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                        Smart Organization
                    </h1>
                    <p className="text-gray-400 mt-1">
                        AI-powered suggestions to declutter and organize your files.
                    </p>
                </div>
                <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold shadow-lg transition-all ${analyzing
                        ? 'bg-gray-700 cursor-not-allowed text-gray-400'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-900/30'
                        }`}
                >
                    {analyzing ? (
                        <>
                            <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Analyzing...
                        </>
                    ) : (
                        <>
                            <span>🔍</span> Run Analysis
                        </>
                    )}
                </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className="max-w-4xl mx-auto pb-12">
                    {loading && suggestions.length === 0 ? (
                        <div className="flex items-center justify-center h-64 text-gray-500">
                            Loading suggestions...
                        </div>
                    ) : suggestions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-500 border-2 border-dashed border-gray-800 rounded-xl mb-8">
                            <span className="text-4xl mb-4">✨</span>
                            <h3 className="text-xl font-medium text-gray-400">All caught up!</h3>
                            <p>No organization suggestions found. Try running an analysis.</p>
                        </div>
                    ) : (
                        <div className="mb-8">
                            {suggestions.map(s => (
                                <SuggestionCard
                                    key={s.id}
                                    suggestion={s}
                                    onAccept={handleAccept}
                                    onReject={handleReject}
                                    onModify={handleModify}
                                />
                            ))}
                        </div>
                    )}

                    <FolderStructureOptimizer />
                </div>
            </div>
        </div>
    );
};

export default Organize;
