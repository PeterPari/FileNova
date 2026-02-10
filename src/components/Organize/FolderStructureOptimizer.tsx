import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileTree } from './FileTree';

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

interface DirectoryNode {
    name: string;
    path: string;
    children: DirectoryNode[];
    is_directory: boolean;
    size: number;
    file_count: number;
}

const FolderStructureOptimizer: React.FC = () => {
    const [path, setPath] = useState('');
    const [analysis, setAnalysis] = useState<StructureAnalysis | null>(null);
    const [treeData, setTreeData] = useState<DirectoryNode | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState<'analysis' | 'tree'>('analysis');

    const handleAnalyze = async () => {
        if (!path) return;
        setLoading(true);
        setError('');
        setAnalysis(null);
        setTreeData(null);

        try {
            const [res, tree] = await Promise.all([
                invoke<StructureAnalysis>('get_folder_structure_analysis', { path }),
                invoke<DirectoryNode>('get_directory_tree', { path, maxDepth: 3 })
            ]);
            setAnalysis(res);
            setTreeData(tree);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
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
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-lg mt-8">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <span>🏗️</span> Folder Structure Optimizer
            </h2>

            <div className="flex gap-2 mb-6">
                <input
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="Enter absolute folder path to analyze..."
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500"
                />
                <button
                    onClick={handleAnalyze}
                    disabled={loading || !path}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {loading ? 'Analyzing...' : 'Analyze'}
                </button>
            </div>

            {error && (
                <div className="bg-red-900/30 border border-red-800 text-red-300 p-4 rounded-lg mb-4">
                    Error: {error}
                </div>
            )}

            {analysis && (
                <div className="animate-fade-in">
                    <div className="flex gap-4 mb-4 border-b border-gray-700">
                        <button
                            className={`px-4 py-2 font-medium text-sm ${activeTab === 'analysis' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
                            onClick={() => setActiveTab('analysis')}
                        >
                            Analysis & Stats
                        </button>
                        <button
                            className={`px-4 py-2 font-medium text-sm ${activeTab === 'tree' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-white'}`}
                            onClick={() => setActiveTab('tree')}
                        >
                            Directory Tree
                        </button>
                    </div>

                    {activeTab === 'analysis' ? (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-gray-700/50 p-4 rounded-lg text-center">
                                    <div className="text-2xl font-bold text-white">{analysis.file_count}</div>
                                    <div className="text-xs text-gray-400 uppercase tracking-widest">Files</div>
                                </div>
                                <div className="bg-gray-700/50 p-4 rounded-lg text-center">
                                    <div className="text-2xl font-bold text-white">{analysis.subfolder_count}</div>
                                    <div className="text-xs text-gray-400 uppercase tracking-widest">Subfolders</div>
                                </div>
                                <div className="bg-gray-700/50 p-4 rounded-lg text-center">
                                    <div className="text-2xl font-bold text-white">
                                        {Object.keys(analysis.extensions).length}
                                    </div>
                                    <div className="text-xs text-gray-400 uppercase tracking-widest">File Types</div>
                                </div>
                                <div className="bg-gray-700/50 p-4 rounded-lg text-center">
                                    <div className={`text-2xl font-bold ${analysis.clutter_score > 0.5 ? 'text-red-400' : 'text-green-400'}`}>
                                        {Math.round(analysis.clutter_score * 100)}/100
                                    </div>
                                    <div className="text-xs text-gray-400 uppercase tracking-widest">Clutter Score</div>
                                </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                                    <h3 className="text-gray-400 font-bold mb-3 uppercase text-xs tracking-wider">File Types</h3>
                                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                        {Object.entries(analysis.extensions)
                                            .sort(([, a], [, b]) => b - a)
                                            .map(([ext, count]) => (
                                                <div key={ext} className="flex justify-between items-center text-sm">
                                                    <span className="text-gray-300 font-mono">.{ext}</span>
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-blue-500 rounded-full"
                                                                style={{ width: `${Math.min(100, (count / analysis.file_count) * 100)}%` }}
                                                            ></div>
                                                        </div>
                                                        <span className="text-gray-500 w-8 text-right">{count}</span>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                </div>

                                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                                    <h3 className="text-gray-400 font-bold mb-3 uppercase text-xs tracking-wider">Suggestions</h3>
                                    <ul className="space-y-2">
                                        {analysis.suggestions.map((s, i) => (
                                            <li key={i} className="flex gap-2 text-sm text-yellow-300">
                                                <span>💡</span>
                                                <span>{s}</span>
                                            </li>
                                        ))}
                                        {analysis.suggestions.length === 0 && (
                                            <li className="text-gray-500 italic">No specific suggestions. Folder looks okay.</li>
                                        )}
                                    </ul>
                                </div>
                            </div>

                            {analysis.huge_files.length > 0 && (
                                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                                    <h3 className="text-gray-400 font-bold mb-3 uppercase text-xs tracking-wider">Large Files</h3>
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {analysis.huge_files.map(([name, size], idx) => (
                                            <div key={idx} className="flex justify-between text-sm">
                                                <span className="text-gray-300 truncate pr-4">{name}</span>
                                                <span className="text-red-400 font-mono whitespace-nowrap">{formatSize(size)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 h-[500px] overflow-y-auto custom-scrollbar">
                            {treeData ? (
                                <FileTree node={treeData} />
                            ) : (
                                <div className="text-center text-gray-500 py-10">No tree data available.</div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default FolderStructureOptimizer;
