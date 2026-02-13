import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileTree, DirectoryNode } from './FileTree';
import { SuggestionPlan } from './SuggestionCard';
import SuggestionPreview from './SuggestionPreview';
import SuggestionEditor from './SuggestionEditor';
import ProposedTree from './ProposedTree';
import { Toast } from '../Toast';

interface StructureAnalysis {
    path: string;
    file_count: number;
    subfolder_count: number;
    depth: number;
    clutter_score: number;
    suggestions: string[];
    extensions: Record<string, number>;
    huge_files: [string, number][];
}

const FolderStructureOptimizer: React.FC = () => {
    const [path, setPath] = useState('');
    const [analysis, setAnalysis] = useState<StructureAnalysis | null>(null);
    const [treeData, setTreeData] = useState<DirectoryNode | null>(null);
    const [proposal, setProposal] = useState<SuggestionPlan | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    const [loading, setLoading] = useState(false);
    const [generatingProposal, setGeneratingProposal] = useState(false);
    const [applying, setApplying] = useState(false);

    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'analysis' | 'tree' | 'proposal'>('analysis');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const handleAnalyze = async () => {
        if (!path) return;
        setLoading(true);
        setError('');
        setAnalysis(null);
        setTreeData(null);
        setProposal(null);
        setActiveTab('analysis');

        try {
            const [res, tree] = await Promise.all([
                invoke<StructureAnalysis>('get_folder_structure_analysis', { path }),
                invoke<DirectoryNode>('get_directory_tree', { path, max_depth: 3 })
            ]);
            setAnalysis(res);
            setTreeData(tree);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateProposal = async () => {
        if (!path) return;
        setGeneratingProposal(true);
        setError('');
        try {
            const plan = await invoke<SuggestionPlan>('get_structure_proposal', { path });
            setProposal(plan);
            setActiveTab('proposal');
        } catch (e) {
            setError("AI Proposal Failed: " + String(e));
        } finally {
            setGeneratingProposal(false);
        }
    };

    const handleApplyProposal = async () => {
        if (!proposal) return;
        setApplying(true);
        try {
            await invoke('apply_structure_plan', { plan: proposal });
            setToast({ message: "Organization plan applied successfully!", type: 'success' });
            // Refresh analysis
            handleAnalyze();
        } catch (e) {
            setToast({ message: "Failed to apply plan: " + e, type: 'error' });
        } finally {
            setApplying(false);
        }
    };

    const formatSize = (bytes: number) => {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    };

    return (
        <div className="bg-surface rounded-xl p-6 border border-base shadow-theme-lg mt-8 mb-12">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🏗️</span> Folder Structure Optimizer
            </h2>

            <div className="flex gap-2 mb-6">
                <input
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="Enter absolute folder path to analyze..."
                    className="flex-1 bg-base border border-base rounded-lg px-4 py-2 text-primary focus:outline-none focus:border-focus"
                />
                <button
                    onClick={handleAnalyze}
                    disabled={loading || !path}
                    className="bg-accent-primary hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {loading ? 'Analyzing...' : 'Analyze'}
                </button>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 text-red-300 p-4 rounded-lg mb-4">
                    {error}
                </div>
            )}

            {analysis && (
                <div className="animate-fade-in">
                    <div className="flex gap-4 mb-4 border-b border-base">
                        <button
                            className={`px-4 py-2 font-medium text-sm ${activeTab === 'analysis' ? 'text-accent-primary border-b-2 border-focus' : 'text-muted hover:text-primary'}`}
                            onClick={() => setActiveTab('analysis')}
                        >
                            Analysis & Stats
                        </button>
                        <button
                            className={`px-4 py-2 font-medium text-sm ${activeTab === 'tree' ? 'text-accent-primary border-b-2 border-focus' : 'text-muted hover:text-primary'}`}
                            onClick={() => setActiveTab('tree')}
                        >
                            Current Structure
                        </button>
                        <button
                            className={`px-4 py-2 font-medium text-sm ${activeTab === 'proposal' ? 'text-accent-primary border-b-2 border-focus' : 'text-muted hover:text-primary'}`}
                            onClick={() => setActiveTab('proposal')}
                        >
                            AI Proposal
                        </button>
                    </div>

                    {activeTab === 'analysis' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-surface-hover p-4 rounded-lg text-center">
                                    <div className="text-2xl font-bold text-white">{analysis.file_count}</div>
                                    <div className="text-xs text-muted uppercase tracking-widest">Files</div>
                                </div>
                                <div className="bg-surface-hover p-4 rounded-lg text-center">
                                    <div className="text-2xl font-bold text-white">{analysis.subfolder_count}</div>
                                    <div className="text-xs text-muted uppercase tracking-widest">Subfolders</div>
                                </div>
                                <div className="bg-surface-hover p-4 rounded-lg text-center">
                                    <div className="text-2xl font-bold text-white">
                                        {Object.keys(analysis.extensions).length}
                                    </div>
                                    <div className="text-xs text-muted uppercase tracking-widest">File Types</div>
                                </div>
                                <div className="bg-surface-hover p-4 rounded-lg text-center">
                                    <div className={`text-2xl font-bold ${analysis.clutter_score > 0.5 ? 'text-red-400' : 'text-green-400'}`}>
                                        {Math.round(analysis.clutter_score * 100)}/100
                                    </div>
                                    <div className="text-xs text-muted uppercase tracking-widest">Clutter Score</div>
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div className="bg-base rounded-lg p-4 border border-base">
                                    <h3 className="text-muted font-bold mb-3 uppercase text-xs tracking-wider">File Types</h3>
                                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                        {Object.entries(analysis.extensions)
                                            .sort(([, a], [, b]) => b - a)
                                            .map(([ext, count]) => (
                                                <div key={ext} className="flex justify-between items-center text-sm">
                                                    <span className="text-disabled font-mono">.{ext}</span>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-24 h-1.5 bg-surface-hover rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-accent-primary rounded-full"
                                                                style={{ width: `${Math.min(100, (count / analysis.file_count) * 100)}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-muted w-8 text-right">{count}</span>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>

                                <div className="bg-base rounded-lg p-4 border border-base flex flex-col">
                                    <h3 className="text-muted font-bold mb-3 uppercase text-xs tracking-wider">Suggestions</h3>
                                    <ul className="space-y-2 flex-1">
                                        {analysis.suggestions.map((s, i) => (
                                            <li key={i} className="flex gap-2 text-sm text-yellow-300">
                                                <span>💡</span>
                                                <span>{s}</span>
                                            </li>
                                        ))}
                                        {analysis.suggestions.length === 0 && (
                                            <li className="text-muted italic">No specific suggestions. Folder looks okay.</li>
                                        )}
                                    </ul>

                                    <button
                                        onClick={handleGenerateProposal}
                                        disabled={generatingProposal}
                                        className="mt-4 w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-2 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                                        style={{ boxShadow: 'var(--shadow-lg)' }}
                                    >
                                        {generatingProposal ? (
                                            <>
                                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                                Generating AI Proposal...
                                            </>
                                        ) : (
                                            <>
                                                <span>✨</span> Generate Reorganization Plan
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>

                            {analysis.huge_files.length > 0 && (
                                <div className="bg-base rounded-lg p-4 border border-base">
                                    <h3 className="text-muted font-bold mb-3 uppercase text-xs tracking-wider">Large Files</h3>
                                    <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                                        {analysis.huge_files.map(([name, size], idx) => (
                                            <div key={idx} className="flex justify-between text-sm">
                                                <span className="text-disabled truncate pr-4">{name}</span>
                                                <span className="text-red-400 font-mono whitespace-nowrap">{formatSize(size)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'tree' && (
                        <div className="bg-base rounded-lg p-4 border border-base h-[500px] overflow-y-auto custom-scrollbar">
                            {treeData ? (
                                <FileTree node={treeData} />
                            ) : (
                                <div className="text-center text-muted py-10">No tree data available.</div>
                            )}
                        </div>
                    )}

                    {activeTab === 'proposal' && (
                        <div className="space-y-4">
                            {proposal ? (
                                <>
                                    <div className="bg-blue-900/30 border border-blue-800 p-4 rounded-lg">
                                        <h3 className="font-bold text-blue-300 mb-2">AI Strategy</h3>
                                        <p className="text-disabled text-sm">{proposal.reason}</p>
                                        <div className="mt-2 text-xs text-muted">
                                            {proposal.moves.length} file operations proposed
                                        </div>
                                    </div>

                                    {treeData && <ProposedTree originalTree={treeData} moves={proposal.moves} />}

                                    <div className="mt-4">
                                        <h3 className="text-sm font-bold text-muted mb-2 uppercase tracking-wider">Detailed Move Plan</h3>
                                        <SuggestionPreview moves={proposal.moves} />
                                    </div>

                                    <div className="flex justify-end gap-3 pt-4 border-t border-base">
                                        <button
                                            onClick={() => setIsEditing(true)}
                                            className="px-4 py-2 text-disabled hover:text-primary"
                                        >
                                            Modify Plan
                                        </button>
                                        <button
                                            onClick={() => setProposal(null)}
                                            className="px-4 py-2 text-muted hover:text-primary"
                                        >
                                            Discard
                                        </button>
                                        <button
                                            onClick={handleApplyProposal}
                                            disabled={applying}
                                            className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 flex items-center gap-2"
                                            style={{ boxShadow: 'var(--shadow-lg)' }}
                                        >
                                            {applying ? 'Applying...' : 'Apply Plan'}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center py-12 text-muted border-2 border-dashed border-base rounded-xl">
                                    <span className="text-4xl block mb-2">🤖</span>
                                    <p>No proposal generated yet.</p>
                                    <button
                                        onClick={handleGenerateProposal}
                                        className="text-accent-primary hover:underline mt-2"
                                    >
                                        Generate one now
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {proposal && isEditing && (
                <SuggestionEditor
                    initialPlan={proposal}
                    onSave={(updatedPlan) => {
                        setProposal(updatedPlan);
                        setIsEditing(false);
                    }}
                    onCancel={() => setIsEditing(false)}
                />
            )}

            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    );
};

export default FolderStructureOptimizer;
