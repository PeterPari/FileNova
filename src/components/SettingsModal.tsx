import { useState, useEffect } from 'react';
import { useFileStore, ExtractionStats, AiStatus, Rule } from '../store/fileStore';
import { X, Plus, Trash2, Folder, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export const SettingsModal = ({ onClose }: { onClose: () => void }) => {
    const { settings, addIndexedPath, removeIndexedPath, startIndexing, startContentExtraction, rules, loadRules, saveRule, deleteRule } = useFileStore();
    const [pathInput, setPathInput] = useState('');

    // AI settings
    const [aiProvider, setAiProvider] = useState('ollama');
    const [providerUrl, setProviderUrl] = useState('http://localhost:11434');
    const [openaiApiKey, setOpenaiApiKey] = useState('');
    const [modelName, setModelName] = useState('nomic-embed-text');
    const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
    const [checkingAi, setCheckingAi] = useState(false);
    const [extractionStats, setExtractionStats] = useState<ExtractionStats | null>(null);
    const [trashRetention, setTrashRetention] = useState(30);

    // Rules
    const [editingRule, setEditingRule] = useState<Rule | null>(null);

    useEffect(() => {
        // Load saved AI settings
        const loadSettings = async () => {
            loadRules(); // Load rules
            try {
                const provider = await invoke<string | null>('get_app_setting', { key: 'ai_provider' });
                if (provider) setAiProvider(provider);

                const url = await invoke<string | null>('get_app_setting', { key: 'ai_provider_url' });
                if (url) setProviderUrl(url);

                const key = await invoke<string | null>('get_app_setting', { key: 'openai_api_key' });
                if (key) setOpenaiApiKey(key);

                const model = await invoke<string | null>('get_app_setting', { key: 'ai_embedding_model' });
                if (model) setModelName(model);

                const retention = await invoke<string | null>('get_app_setting', { key: 'trash_retention_days' });
                if (retention) setTrashRetention(parseInt(retention));
            } catch { /* use defaults */ }

            // Load extraction stats
            try {
                const stats = await invoke<ExtractionStats>('get_extraction_stats');
                setExtractionStats(stats);
            } catch { /* ignore */ }
        };
        loadSettings();
    }, []);

    const handleSaveRetention = async () => {
        await invoke('save_app_setting', { key: 'trash_retention_days', value: trashRetention.toString() });
    };

    const handleSaveRule = async () => {
        if (editingRule) {
            await saveRule(editingRule);
            setEditingRule(null);
        }
    };

    const handleAddPath = () => {
        if (pathInput) {
            addIndexedPath(pathInput);
            setPathInput('');
        }
    };

    const handleSaveAiSettings = async () => {
        await invoke('save_app_setting', { key: 'ai_provider', value: aiProvider });
        await invoke('save_app_setting', { key: 'ai_provider_url', value: providerUrl });
        await invoke('save_app_setting', { key: 'openai_api_key', value: openaiApiKey });
        await invoke('save_app_setting', { key: 'ai_embedding_model', value: modelName });
    };

    const handleCheckConnection = async () => {
        setCheckingAi(true);
        setAiStatus(null);
        await handleSaveAiSettings();
        try {
            const status = await invoke<AiStatus>('check_ai_status');
            setAiStatus(status);
        } catch (err) {
            setAiStatus({
                ollama_running: false,
                model_available: false,
                model_name: modelName,
                provider_url: providerUrl,
            });
        }
        setCheckingAi(false);
    };

    const handleStartExtraction = async () => {
        await handleSaveAiSettings();
        startContentExtraction();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[540px] max-w-full max-h-[85vh] overflow-y-auto">
                <header className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
                    <h2 className="font-semibold text-lg">Settings</h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
                        <X size={20} />
                    </button>
                </header>

                <div className="p-6 space-y-8">
                    {/* Indexed Directories */}
                    <section>
                        <h3 className="font-medium mb-4">Indexed Directories</h3>
                        <div className="flex gap-2 mb-4">
                            <input
                                type="text"
                                value={pathInput}
                                onChange={(e) => setPathInput(e.target.value)}
                                placeholder="Enter folder path (e.g. D:\Photos)"
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent text-sm"
                            />
                            <button
                                onClick={handleAddPath}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center gap-2 text-sm"
                            >
                                <Plus size={16} /> Add
                            </button>
                        </div>

                        <div className="border border-gray-200 dark:border-gray-700 rounded-md max-h-40 overflow-y-auto mb-4">
                            {settings.indexedPaths.length === 0 ? (
                                <div className="p-6 text-center text-gray-400 text-sm">
                                    No directories added.
                                </div>
                            ) : (
                                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                    {settings.indexedPaths.map((path) => (
                                        <li key={path} className="p-3 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800">
                                            <div className="flex items-center gap-3">
                                                <Folder size={18} className="text-gray-400" />
                                                <span className="text-sm truncate max-w-[300px]" title={path}>{path}</span>
                                            </div>
                                            <button
                                                onClick={() => removeIndexedPath(path)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="flex justify-end">
                            <button
                                onClick={() => { startIndexing(); }}
                                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-medium"
                            >
                                Start Indexing
                            </button>
                        </div>
                    </section>

                    {/* General Settings */}
                    <section className="border-t border-gray-200 dark:border-gray-700 pt-6">
                        <h3 className="font-medium mb-4">General Settings</h3>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Trash Retention (Days)</label>
                            <input
                                type="number"
                                min="1"
                                max="365"
                                value={trashRetention}
                                onChange={(e) => setTrashRetention(parseInt(e.target.value) || 30)}
                                onBlur={() => handleSaveRetention()}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent text-sm"
                            />
                            <p className="text-xs text-gray-400 mt-1">Files in FileNova Trash older than this will be permanently deleted on app startup.</p>
                        </div>
                    </section>

                    {/* AI Provider Settings */}
                    <section className="border-t border-gray-200 dark:border-gray-700 pt-6">
                        <h3 className="font-medium mb-4">AI Provider Settings</h3>

                        <div className="space-y-3 mb-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Provider</label>
                                <select
                                    value={aiProvider}
                                    onChange={(e) => {
                                        setAiProvider(e.target.value);
                                        // Set default models when switching
                                        if (e.target.value === 'openai') {
                                            setModelName('text-embedding-3-small');
                                        } else {
                                            setModelName('nomic-embed-text');
                                        }
                                    }}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent text-sm"
                                >
                                    <option value="ollama">Ollama (Local)</option>
                                    <option value="openai">OpenAI (Cloud)</option>
                                </select>
                            </div>

                            {aiProvider === 'ollama' && (
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Ollama URL</label>
                                    <input
                                        type="text"
                                        value={providerUrl}
                                        onChange={(e) => setProviderUrl(e.target.value)}
                                        placeholder="http://localhost:11434"
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent text-sm"
                                    />
                                </div>
                            )}

                            {aiProvider === 'openai' && (
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">OpenAI API Key</label>
                                    <input
                                        type="password"
                                        value={openaiApiKey}
                                        onChange={(e) => setOpenaiApiKey(e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent text-sm"
                                    />
                                    <p className="text-xs text-gray-400 mt-1">Key is stored locally.</p>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Embedding Model</label>
                                <input
                                    type="text"
                                    value={modelName}
                                    onChange={(e) => setModelName(e.target.value)}
                                    placeholder={aiProvider === 'openai' ? "text-embedding-3-small" : "nomic-embed-text"}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent text-sm"
                                />
                                {aiProvider === 'openai' && (
                                    <p className="text-xs text-gray-400 mt-1">Recommended: text-embedding-3-small (1536 dims) or text-embedding-3-large (3072 dims)</p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-3 mb-4">
                            <button
                                onClick={handleCheckConnection}
                                disabled={checkingAi}
                                className="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                            >
                                {checkingAi ? <Loader2 size={14} className="animate-spin" /> : null}
                                Check Connection
                            </button>

                            {aiStatus && (
                                <span className="flex items-center gap-1.5 text-sm">
                                    {aiStatus.ollama_running && aiStatus.model_available ? (
                                        <>
                                            <CheckCircle size={16} className="text-green-500" />
                                            <span className="text-green-600 dark:text-green-400">Connected - {aiStatus.model_name}</span>
                                        </>
                                    ) : (
                                        <>
                                            <XCircle size={16} className="text-red-500" />
                                            <span className="text-red-600 dark:text-red-400">
                                                {!aiStatus.ollama_running ? (aiProvider === 'openai' ? 'Connection Failed' : 'Ollama not running') : 'Model not found'}
                                            </span>
                                        </>
                                    )}
                                </span>
                            )}
                        </div>
                    </section>

                    {/* Content Extraction */}
                    <section className="border-t border-gray-200 dark:border-gray-700 pt-6">
                        <h3 className="font-medium mb-4">Content Extraction</h3>

                        {extractionStats && (
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                                    <p className="text-xs text-gray-500">Extracted</p>
                                    <p className="text-lg font-semibold">{extractionStats.extracted_files.toLocaleString()}</p>
                                    <p className="text-xs text-gray-400">of {extractionStats.total_files.toLocaleString()} files</p>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                                    <p className="text-xs text-gray-500">Embeddings</p>
                                    <p className="text-lg font-semibold">{extractionStats.embedded_files.toLocaleString()}</p>
                                    <p className="text-xs text-gray-400">{extractionStats.pending_files.toLocaleString()} pending</p>
                                </div>
                                {extractionStats.failed_files > 0 && (
                                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 col-span-2">
                                        <p className="text-xs text-amber-600">{extractionStats.failed_files.toLocaleString()} files failed extraction</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={handleStartExtraction}
                            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded text-sm font-medium"
                        >
                            Start Content Extraction
                        </button>
                        <p className="text-xs text-gray-400 mt-2">
                            Extracts text from PDFs, documents, and code files, then generates embeddings for semantic search.
                        </p>
                    </section>

                    {/* Rules Management */}
                    <section className="border-t border-gray-200 dark:border-gray-700 pt-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-medium">Auto-Tagging Rules</h3>
                            <button
                                onClick={() => {
                                    // Start adding new rule
                                    setEditingRule({
                                        id: 0,
                                        name: 'New Rule',
                                        condition_json: JSON.stringify({ type: 'extension', value: 'pdf' }),
                                        action_json: JSON.stringify({ tag: 'document' }),
                                        enabled: true,
                                        trigger: 'on_create'
                                    });
                                }}
                                className="text-blue-600 hover:text-blue-700 text-sm flex items-center gap-1"
                            >
                                <Plus size={14} /> New Rule
                            </button>
                        </div>

                        {editingRule ? (
                            <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-3">
                                <h4 className="font-medium text-sm">Edit Rule</h4>
                                <input
                                    type="text"
                                    value={editingRule.name}
                                    onChange={e => setEditingRule({ ...editingRule, name: e.target.value })}
                                    placeholder="Rule Name"
                                    className="w-full px-3 py-2 text-sm border rounded"
                                />
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-xs text-gray-500">Trigger</label>
                                        <select
                                            value={editingRule.trigger}
                                            onChange={e => setEditingRule({ ...editingRule, trigger: e.target.value })}
                                            className="w-full px-3 py-2 text-sm border rounded"
                                        >
                                            <option value="on_create">On File Create</option>
                                            <option value="on_modify">On File Modify</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center">
                                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editingRule.enabled}
                                                onChange={e => setEditingRule({ ...editingRule, enabled: e.target.checked })}
                                            />
                                            Enabled
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Condition (JSON for now)</label>
                                    <input
                                        type="text"
                                        value={editingRule.condition_json}
                                        onChange={e => setEditingRule({ ...editingRule, condition_json: e.target.value })}
                                        className="w-full px-3 py-2 text-sm border rounded font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500">Action (JSON for now)</label>
                                    <input
                                        type="text"
                                        value={editingRule.action_json}
                                        onChange={e => setEditingRule({ ...editingRule, action_json: e.target.value })}
                                        className="w-full px-3 py-2 text-sm border rounded font-mono"
                                    />
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => setEditingRule(null)} className="px-3 py-1 text-sm bg-gray-200 rounded">Cancel</button>
                                    <button onClick={handleSaveRule} className="px-3 py-1 text-sm bg-blue-600 text-white rounded">Save</button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {rules.length === 0 ? <p className="text-sm text-gray-400">No rules defined.</p> : rules.map(rule => (
                                    <div key={rule.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                                        <div>
                                            <p className="font-medium text-sm">{rule.name}</p>
                                            <p className="text-xs text-gray-500">{rule.trigger} • {rule.enabled ? 'Enabled' : 'Disabled'}</p>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => setEditingRule(rule)} className="text-blue-500 hover:text-blue-700 text-xs">Edit</button>
                                            <button onClick={() => deleteRule(rule.id)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Footer */}
                    <div className="flex justify-end pt-2">
                        <button onClick={onClose} className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-sm">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

