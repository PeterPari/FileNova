import { useState, useEffect } from 'react';
import { useFileStore, ExtractionStats, AiStatus } from '../store/fileStore';
import { X, Plus, Trash2, Folder, CheckCircle, XCircle, Loader2, Settings, Database, Cpu, ListTree, Palette, Activity } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { RulesManager } from './RulesManager';
import { TrashManager } from './TrashManager';
import { ThemeSettings } from './ThemeSettings';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { resetFeatureDiscovery } from './FeatureDiscovery';

type Tab = 'general' | 'indexing' | 'ai' | 'appearance' | 'diagnostics' | 'rules' | 'trash';

export const SettingsModal = ({ onClose }: { onClose: () => void }) => {
    const { settings, addIndexedPath, removeIndexedPath, startIndexing, startContentExtraction } = useFileStore();
    const [activeTab, setActiveTab] = useState<Tab>('general');
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
    const [crashReporting, setCrashReporting] = useState(false);

    useEffect(() => {
        // Load saved AI settings
        const loadSettings = async () => {
            try {
                const provider = await invoke<string | null>('get_app_setting', { key: 'ai_provider' });
                if (provider) setAiProvider(provider);

                const url = await invoke<string | null>('get_app_setting', { key: 'ollama_url' });
                if (url) {
                    setProviderUrl(url);
                } else {
                    const legacyUrl = await invoke<string | null>('get_app_setting', { key: 'ai_provider_url' });
                    if (legacyUrl) setProviderUrl(legacyUrl);
                }

                const key = await invoke<string | null>('get_app_setting', { key: 'openai_api_key' });
                if (key) setOpenaiApiKey(key);

                const tagModel = await invoke<string | null>('get_app_setting', { key: 'ai_tag_model' });
                if (tagModel) {
                    setModelName(tagModel);
                } else {
                    const model = await invoke<string | null>('get_app_setting', { key: 'ai_embedding_model' });
                    if (model) setModelName(model);
                }

                const retention = await invoke<string | null>('get_app_setting', { key: 'trash_retention_days' });
                if (retention) setTrashRetention(parseInt(retention));

                const crashOpt = await invoke<string | null>('get_app_setting', { key: 'crash_reporting_enabled' });
                setCrashReporting(crashOpt === 'true');
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

    const handleAddPath = () => {
        if (pathInput) {
            addIndexedPath(pathInput);
            setPathInput('');
        }
    };

    const handleBrowsePath = async () => {
        const selected = await open({ directory: true, multiple: false });
        if (typeof selected === 'string') {
            setPathInput(selected);
        }
    };

    const handleSaveAiSettings = async () => {
        await invoke('save_app_setting', { key: 'ai_provider', value: aiProvider });
        await invoke('save_app_setting', { key: 'ollama_url', value: providerUrl });
        await invoke('save_app_setting', { key: 'openai_api_key', value: openaiApiKey });
        await invoke('save_app_setting', { key: 'ai_embedding_model', value: modelName });
        await invoke('save_app_setting', { key: 'ai_tag_model', value: modelName });
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

    const TabButton = ({ id, label, icon: Icon }: { id: Tab, label: string, icon: any }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 w-full text-left rounded-md transition-colors ${activeTab === id
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
        >
            <Icon size={18} />
            {label}
        </button>
    );

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-[900px] h-[600px] max-w-full flex overflow-hidden">
                {/* Sidebar */}
                <div className="w-64 bg-gray-50 dark:bg-gray-800 p-4 border-r border-gray-200 dark:border-gray-700 flex flex-col">
                    <h2 className="font-bold text-xl mb-6 px-4">Settings</h2>
                    <nav className="space-y-1 flex-1">
                        <TabButton id="general" label="General" icon={Settings} />
                        <TabButton id="appearance" label="Appearance" icon={Palette} />
                        <TabButton id="indexing" label="Indexing" icon={Database} />
                        <TabButton id="ai" label="AI & Extraction" icon={Cpu} />
                        <TabButton id="rules" label="Rules Engine" icon={ListTree} />
                        <TabButton id="trash" label="Trash Bin" icon={Trash2} />
                        <TabButton id="diagnostics" label="Diagnostics" icon={Activity} />
                    </nav>
                    <button onClick={onClose} className="mt-auto flex items-center gap-2 px-4 py-2 text-gray-500 hover:text-white transition-colors">
                        <X size={18} /> Close
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 bg-gray-900">
                    {activeTab === 'general' && (
                        <div className="space-y-6">
                            <h3 className="text-lg font-medium border-b border-gray-700 pb-2">General Settings</h3>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Trash Retention (Days)</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="365"
                                    value={trashRetention}
                                    onChange={(e) => setTrashRetention(parseInt(e.target.value) || 30)}
                                    onBlur={() => handleSaveRetention()}
                                    className="w-full max-w-xs px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm"
                                />
                                <p className="text-xs text-gray-500 mt-1">Files in FileNova Trash older than this are permanently deleted.</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Feature Discovery</label>
                                <button
                                    onClick={() => {
                                        resetFeatureDiscovery();
                                        alert('Feature tips have been reset. They will appear again on next load.');
                                    }}
                                    className="px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm hover:bg-gray-700 transition-colors"
                                >
                                    Reset Feature Tips
                                </button>
                                <p className="text-xs text-gray-500 mt-1">Show dismissed feature discovery tooltips again.</p>
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Sample Data</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={async () => {
                                            try {
                                                const result = await invoke<{ root_path: string; files_created: number; folders_created: number }>('generate_sample_data');
                                                alert(`Sample data created!\n\nPath: ${result.root_path}\nFiles: ${result.files_created}\nFolders: ${result.folders_created}\n\nAdd this folder in Indexed Directories to explore it.`);
                                            } catch (e) {
                                                alert(String(e));
                                            }
                                        }}
                                        className="px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm hover:bg-gray-700 transition-colors"
                                    >
                                        Generate Sample Data
                                    </button>
                                    <button
                                        onClick={async () => {
                                            try {
                                                await invoke('remove_sample_data');
                                                alert('Sample data removed.');
                                            } catch (e) {
                                                alert(String(e));
                                            }
                                        }}
                                        className="px-3 py-2 border border-red-800 rounded bg-gray-800 text-red-400 text-sm hover:bg-red-900/30 transition-colors"
                                    >
                                        Remove Sample Data
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">Create a demo folder with sample files to explore FileNova features.</p>
                            </div>

                            {/* Updates */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Software Updates</label>
                                <button
                                    onClick={async () => {
                                        try {
                                            const { check } = await import('@tauri-apps/plugin-updater');
                                            const update = await check();
                                            if (update) {
                                                const doUpdate = confirm(
                                                    `Update available: v${update.version}\n\n${update.body || 'No release notes.'}\n\nDownload and install now?`
                                                );
                                                if (doUpdate) {
                                                    await update.downloadAndInstall();
                                                    const { relaunch } = await import('@tauri-apps/plugin-process');
                                                    await relaunch();
                                                }
                                            } else {
                                                alert('You are running the latest version.');
                                            }
                                        } catch (e) {
                                            alert(`Update check failed: ${String(e)}`);
                                        }
                                    }}
                                    className="px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm hover:bg-gray-700 transition-colors"
                                >
                                    Check for Updates
                                </button>
                                <p className="text-xs text-gray-500 mt-1">Current version: v1.0.0</p>
                            </div>

                            {/* Crash Reporting */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Crash Reporting</label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={crashReporting}
                                        onChange={async (e) => {
                                            const enabled = e.target.checked;
                                            setCrashReporting(enabled);
                                            await invoke('save_app_setting', { key: 'crash_reporting_enabled', value: enabled ? 'true' : 'false' });
                                            // Toggle Sentry at runtime
                                            try {
                                                const Sentry = await import('@sentry/react');
                                                const client = Sentry.getClient();
                                                if (client) {
                                                    client.getOptions().enabled = enabled;
                                                }
                                            } catch { /* Sentry not available */ }
                                        }}
                                        className="w-4 h-4 rounded border-gray-600 bg-gray-800"
                                    />
                                    <span className="text-sm text-gray-300">Send anonymous crash reports to help improve FileNova</span>
                                </label>
                                <p className="text-xs text-gray-500 mt-1">No personal data or file contents are ever transmitted.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'appearance' && <ThemeSettings />}
                    
                    {activeTab === 'diagnostics' && <DiagnosticsPanel />}

                    {activeTab === 'indexing' && (
                        <div className="space-y-6">
                            <h3 className="text-lg font-medium border-b border-gray-700 pb-2">Indexed Directories</h3>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={pathInput}
                                    onChange={(e) => setPathInput(e.target.value)}
                                    placeholder="Enter folder path (e.g. D:\Photos)"
                                    className="flex-1 px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm"
                                />
                                <button
                                    onClick={handleBrowsePath}
                                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded text-sm"
                                >
                                    Browse
                                </button>
                                <button
                                    onClick={handleAddPath}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center gap-2 text-sm"
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </div>

                            <div className="border border-gray-700 rounded-md max-h-60 overflow-y-auto">
                                {settings.indexedPaths.length === 0 ? (
                                    <div className="p-6 text-center text-gray-500 text-sm">No directories added.</div>
                                ) : (
                                    <ul className="divide-y divide-gray-700">
                                        {settings.indexedPaths.map((path) => (
                                            <li key={path} className="p-3 flex justify-between items-center hover:bg-gray-800">
                                                <div className="flex items-center gap-3">
                                                    <Folder size={18} className="text-gray-400" />
                                                    <span className="text-sm truncate max-w-[400px]" title={path}>{path}</span>
                                                </div>
                                                <button onClick={() => removeIndexedPath(path)} className="text-red-500 hover:text-red-400 p-1">
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
                        </div>
                    )}

                    {activeTab === 'ai' && (
                        <div className="space-y-8">
                            <div>
                                <h3 className="text-lg font-medium border-b border-gray-700 pb-2 mb-4">Content Extraction</h3>
                                {extractionStats && (
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                                            <p className="text-xs text-gray-400">Extracted</p>
                                            <p className="text-lg font-semibold">{extractionStats.extracted_files.toLocaleString()}</p>
                                            <p className="text-xs text-gray-500">of {extractionStats.total_files.toLocaleString()} files</p>
                                        </div>
                                        <div className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                                            <p className="text-xs text-gray-400">Embeddings</p>
                                            <p className="text-lg font-semibold">{extractionStats.embedded_files.toLocaleString()}</p>
                                            <p className="text-xs text-gray-500">{extractionStats.pending_files.toLocaleString()} pending</p>
                                        </div>
                                        {extractionStats.failed_files > 0 && (
                                            <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-3 col-span-2">
                                                <p className="text-xs text-red-400">{extractionStats.failed_files.toLocaleString()} files failed extraction</p>
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
                            </div>

                            <div>
                                <h3 className="text-lg font-medium border-b border-gray-700 pb-2 mb-4">AI Provider</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Provider</label>
                                        <select
                                            value={aiProvider}
                                            onChange={(e) => {
                                                setAiProvider(e.target.value);
                                                if (e.target.value === 'openai') setModelName('text-embedding-3-small');
                                                else setModelName('nomic-embed-text');
                                            }}
                                            className="w-full px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm"
                                        >
                                            <option value="ollama">Ollama (Local)</option>
                                            <option value="openai">OpenAI (Cloud)</option>
                                        </select>
                                    </div>

                                    {aiProvider === 'ollama' && (
                                        <div>
                                            <label className="block text-xs text-gray-400 mb-1">Ollama URL</label>
                                            <input
                                                type="text"
                                                value={providerUrl}
                                                onChange={(e) => setProviderUrl(e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm"
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-xs text-gray-400 mb-1">Embedding Model</label>
                                        <input
                                            type="text"
                                            value={modelName}
                                            onChange={(e) => setModelName(e.target.value)}
                                            className="w-full px-3 py-2 border border-gray-600 rounded bg-gray-800 text-white text-sm"
                                        />
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handleCheckConnection}
                                            disabled={checkingAi}
                                            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                                        >
                                            {checkingAi ? <Loader2 size={14} className="animate-spin" /> : null}
                                            Check Connection
                                        </button>
                                        {aiStatus && (
                                            <span className="flex items-center gap-1.5 text-sm">
                                                {aiStatus.ollama_running && aiStatus.model_available ? (
                                                    <>
                                                        <CheckCircle size={16} className="text-green-500" />
                                                        <span className="text-green-400">Connected - {aiStatus.model_name}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <XCircle size={16} className="text-red-500" />
                                                        <span className="text-red-400">Failed</span>
                                                    </>
                                                )}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'rules' && (
                        <div className="h-full flex flex-col">
                            <RulesManager />
                        </div>
                    )}
                    {activeTab === 'trash' && (
                        <div className="h-full flex flex-col -m-8">
                            {/* Negative margin to fill padding */}
                            <TrashManager />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

