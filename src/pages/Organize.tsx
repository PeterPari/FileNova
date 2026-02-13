import React from 'react';
import SuggestionCard from '../components/Organize/SuggestionCard';
import FolderStructureOptimizer from '../components/Organize/FolderStructureOptimizer';
import { Toast } from '../components/Toast';
import { useSuggestionsWorkflow } from '../hooks/useSuggestionsWorkflow';

const Organize: React.FC = () => {
    const {
        suggestions,
        loading,
        analyzing,
        toast,
        setToast,
        handleAnalyze,
        handleAccept,
        handleReject,
        handleModify,
    } = useSuggestionsWorkflow();

    return (
        <div className="h-full bg-base text-primary flex flex-col p-6 overflow-hidden">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-500">
                        Smart Organization
                    </h1>
                    <p className="text-muted mt-1">
                        AI-powered suggestions to declutter and organize your files.
                    </p>
                </div>
                <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${analyzing
                        ? 'bg-surface-hover cursor-not-allowed text-muted'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white'
                        }`}
                    style={{ boxShadow: 'var(--shadow-lg)' }}
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
                        <div className="flex items-center justify-center h-64 text-muted">
                            Loading suggestions...
                        </div>
                    ) : suggestions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted border-2 border-dashed border-base rounded-xl mb-8">
                            <span className="text-4xl mb-4">✨</span>
                            <h3 className="text-xl font-medium text-secondary">All caught up!</h3>
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
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    action={toast.action}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
};

export default Organize;
