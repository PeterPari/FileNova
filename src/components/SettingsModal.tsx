import { useState } from 'react';
import { useFileStore } from '../store/fileStore';
import { X, Plus, Trash2, Folder, CheckCircle, XCircle, Loader2, Settings, Database, Cpu, ListTree, Palette, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { RulesManager } from './RulesManager';
import { TrashManager } from './TrashManager';
import { ThemeSettings } from './ThemeSettings';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { resetFeatureDiscovery } from './FeatureDiscovery';
import { useSettingsData } from '../hooks/useSettingsData';

type Tab = 'general' | 'indexing' | 'ai' | 'appearance' | 'diagnostics' | 'rules' | 'trash';

export const SettingsModal = ({ onClose }: { onClose: () => void }) => {
    const { settings, addIndexedPath, removeIndexedPath, startIndexing, startContentExtraction } = useFileStore();
    const [activeTab, setActiveTab] = useState<Tab>('general');
    const [pathInput, setPathInput] = useState('');
    const {
        state,
        setField,
        saveAiSettings,
        saveRetention,
        toggleCrashReporting,
        checkConnection,
    } = useSettingsData();

    const {
        aiProvider,
        providerUrl,
        openaiApiKey,
        geminiApiKey,
        modelName,
        aiStatus,
        checkingAi,
        extractionStats,
        trashRetention,
        crashReporting,
    } = state;

    const handleSaveRetention = async () => {
        await saveRetention();
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

    const handleCheckConnection = async () => {
        await checkConnection();
    };

    const handleStartExtraction = async () => {
        await saveAiSettings();
        startContentExtraction();
    };

    const TabButton = ({ id, label, icon: Icon }: { id: Tab, label: string, icon: LucideIcon }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 w-full text-left rounded-md transition-theme ${activeTab === id
                ? 'bg-accent-primary text-white'
                : 'text-muted hover:bg-surface-hover hover:text-primary'
                }`}
        >
            <Icon size={18} />
            {label}
        </button>
    );

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-base rounded-lg w-[900px] h-[600px] max-w-full flex overflow-hidden" style={{ boxShadow: 'var(--shadow-xl)' }}>
                {/* Sidebar */}
                <div className="w-64 bg-surface p-4 border-r border-base flex flex-col">
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
                    <button onClick={onClose} className="mt-auto flex items-center gap-2 px-4 py-2 text-muted hover:text-primary transition-theme">
                        <X size={18} /> Close
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-8 bg-base">
                    {activeTab === 'general' && (
                        <div className="space-y-6">
                            <h3 className="text-lg font-medium border-b border-base pb-2">General Settings</h3>
                            <div>
                                <label className="block text-sm text-muted mb-1">Trash Retention (Days)</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="365"
                                    value={trashRetention}
                                    onChange={(e) => setField('trashRetention', parseInt(e.target.value) || 30)}
                                    onBlur={() => handleSaveRetention()}
                                    className="w-full max-w-xs px-3 py-2 border border-base rounded bg-surface text-primary text-sm"
                                />
                                <p className="text-xs text-muted mt-1">Files in FileNova Trash older than this are permanently deleted.</p>
                            </div>
                            <div>
                                <label className="block text-sm text-muted mb-1">Feature Discovery</label>
                                <button
                                    onClick={() => {
                                        resetFeatureDiscovery();
                                        alert('Feature tips have been reset. They will appear again on next load.');
                                    }}
                                    className="px-3 py-2 border border-base rounded bg-surface text-primary text-sm hover:bg-surface-hover transition-theme"
                                >
                                    Reset Feature Tips
                                </button>
                                <p className="text-xs text-muted mt-1">Show dismissed feature discovery tooltips again.</p>
                            </div>
                            <div>
                                <label className="block text-sm text-muted mb-1">Sample Data</label>
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
                                        className="px-3 py-2 border border-base rounded bg-surface text-primary text-sm hover:bg-surface-hover transition-theme"
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
                                        className="px-3 py-2 border border-red-800 rounded bg-surface text-red-400 text-sm hover:bg-red-900/30 transition-theme"
                                    >
                                        Remove Sample Data
                                    </button>
                                </div>
                                <p className="text-xs text-muted mt-1">Create a demo folder with sample files to explore FileNova features.</p>
                            </div>

                            {/* Updates */}
                            <div>
                                <label className="block text-sm font-medium text-secondary mb-2">Software Updates</label>
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
                                    className="px-3 py-2 border border-base rounded bg-surface text-primary text-sm hover:bg-surface-hover transition-theme"
                                >
                                    Check for Updates
                                </button>
                                <p className="text-xs text-muted mt-1">Current version: v1.0.0</p>
                            </div>

                            {/* Crash Reporting */}
                            <div>
                                <label className="block text-sm font-medium text-secondary mb-2">Crash Reporting</label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={crashReporting}
                                        onChange={async (e) => {
                                            const enabled = e.target.checked;
                                            await toggleCrashReporting(enabled);
                                            // Toggle Sentry at runtime
                                            try {
                                                const Sentry = await import('@sentry/react');
                                                const client = Sentry.getClient();
                                                if (client) {
                                                    client.getOptions().enabled = enabled;
                                                }
                                            } catch { /* Sentry not available */ }
                                        }}
                                        className="w-4 h-4 rounded border-base bg-surface"
                                    />
                                    <span className="text-sm text-secondary">Send anonymous crash reports to help improve FileNova</span>
                                </label>
                                <p className="text-xs text-muted mt-1">No personal data or file contents are ever transmitted.</p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'appearance' && <ThemeSettings />}
                    
                    {activeTab === 'diagnostics' && <DiagnosticsPanel />}

                    {activeTab === 'indexing' && (
                        <div className="space-y-6">
                            <h3 className="text-lg font-medium border-b border-base pb-2">Indexed Directories</h3>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={pathInput}
                                    onChange={(e) => setPathInput(e.target.value)}
                                    placeholder="Enter folder path (e.g. D:\Photos)"
                                    className="flex-1 px-3 py-2 border border-base rounded bg-surface text-primary text-sm"
                                />
                                <button
                                    onClick={handleBrowsePath}
                                    className="bg-surface-hover hover:bg-surface-active text-primary px-3 py-2 rounded text-sm transition-theme"
                                >
                                    Browse
                                </button>
                                <button
                                    onClick={handleAddPath}
                                    className="bg-accent-primary hover:bg-surface-active text-white px-4 py-2 rounded flex items-center gap-2 text-sm transition-theme"
                                >
                                    <Plus size={16} /> Add
                                </button>
                            </div>

                            <div className="border border-base rounded-md max-h-60 overflow-y-auto">
                                {settings.indexedPaths.length === 0 ? (
                                    <div className="p-6 text-center text-muted text-sm">No directories added.</div>
                                ) : (
                                    <ul className="divide-y divide-base">
                                        {settings.indexedPaths.map((path) => (
                                            <li key={path} className="p-3 flex justify-between items-center hover:bg-surface-hover transition-theme">
                                                <div className="flex items-center gap-3">
                                                    <Folder size={18} className="text-muted" />
                                                    <span className="text-sm truncate max-w-[400px] text-secondary" title={path}>{path}</span>
                                                </div>
                                                <button onClick={() => removeIndexedPath(path)} className="text-status-error hover:text-status-error p-1 opacity-80 hover:opacity-100 transition-theme">
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
                                    className="bg-accent-primary hover:bg-surface-active text-white px-4 py-2 rounded text-sm font-medium transition-theme"
                                >
                                    Start Indexing
                                </button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'ai' && (
                        <div className="space-y-8">
                            <div className="bg-surface border border-base rounded-md p-4">
                                <h4 className="text-sm font-semibold text-secondary mb-3">AI Configuration Guide</h4>
                                <ul className="text-xs text-muted space-y-2 list-disc pl-4">
                                    {aiProvider === 'ollama' ? (
                                        <li>
                                            <strong>Local Search (Ollama):</strong> Download Ollama from <button onClick={() => openUrl('https://ollama.com')} className="text-accent-primary hover:underline inline">ollama.com</button> and keep the service running.
                                        </li>
                                    ) : (
                                        <li>
                                            <strong>Cloud Search (OpenAI):</strong> Add your API key from <button onClick={() => openUrl('https://platform.openai.com/api-keys')} className="text-accent-primary hover:underline inline">OpenAI Platform</button> to enable embeddings.
                                        </li>
                                    )}
                                    <li>
                                        <strong>Chat Assistant:</strong> Requires a Google Gemini key. Get it free from <button onClick={() => openUrl('https://aistudio.google.com/app/apikey')} className="text-accent-primary hover:underline inline">Google AI Studio</button>.
                                    </li>
                                </ul>
                            </div>

                            <div>
                                <h3 className="text-lg font-medium border-b border-base pb-2 mb-4">Content Extraction</h3>
                                {extractionStats && (
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="bg-surface rounded-lg p-3 border border-base">
                                            <p className="text-xs text-muted">Extracted</p>
                                            <p className="text-lg font-semibold text-primary">{extractionStats.extracted_files.toLocaleString()}</p>
                                            <p className="text-xs text-muted">of {extractionStats.total_files.toLocaleString()} files</p>
                                        </div>
                                        <div className="bg-surface rounded-lg p-3 border border-base">
                                            <p className="text-xs text-muted">Embeddings</p>
                                            <p className="text-lg font-semibold text-primary">{extractionStats.embedded_files.toLocaleString()}</p>
                                            <p className="text-xs text-muted">{extractionStats.pending_files.toLocaleString()} pending</p>
                                        </div>
                                        {extractionStats.failed_files > 0 && (
                                            <div className="bg-surface border border-base rounded-lg p-3 col-span-2">
                                                <p className="text-xs text-status-error">{extractionStats.failed_files.toLocaleString()} files failed extraction</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <button
                                    onClick={handleStartExtraction}
                                    className="bg-accent-primary hover:bg-surface-active text-white px-4 py-2 rounded text-sm font-medium transition-theme"
                                >
                                    Start Content Extraction
                                </button>
                            </div>

                            <div>
                                <h3 className="text-lg font-medium border-b border-base pb-2 mb-4">AI Provider</h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs text-muted mb-1">Provider</label>
                                        <select
                                            value={aiProvider}
                                            onChange={(e) => {
                                                setField('aiProvider', e.target.value);
                                                if (e.target.value === 'openai') setField('modelName', 'text-embedding-3-small');
                                                else setField('modelName', 'nomic-embed-text');
                                            }}
                                            className="w-full px-3 py-2 border border-base rounded bg-surface text-primary text-sm"
                                        >
                                            <option value="ollama">Ollama (Local)</option>
                                            <option value="openai">OpenAI (Cloud)</option>
                                        </select>
                                    </div>

                                    {aiProvider === 'ollama' && (
                                        <div>
                                            <label className="block text-xs text-muted mb-1">Ollama URL</label>
                                            <input
                                                type="text"
                                                value={providerUrl}
                                                onChange={(e) => setField('providerUrl', e.target.value)}
                                                className="w-full px-3 py-2 border border-base rounded bg-surface text-primary text-sm"
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-xs text-muted mb-1">Embedding Model</label>
                                        <input
                                            type="text"
                                            value={modelName}
                                            onChange={(e) => setField('modelName', e.target.value)}
                                            className="w-full px-3 py-2 border border-base rounded bg-surface text-primary text-sm"
                                        />
                                    </div>

                                    {aiProvider === 'openai' && (
                                        <div>
                                            <label className="block text-xs text-muted mb-1">OpenAI API Key</label>
                                            <input
                                                type="password"
                                                value={openaiApiKey}
                                                onChange={(e) => setField('openaiApiKey', e.target.value)}
                                                className="w-full px-3 py-2 border border-base rounded bg-surface text-primary text-sm"
                                                placeholder="sk-..."
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-xs text-muted mb-1">Gemini API Key (for Chat)</label>
                                        <input
                                            type="password"
                                            value={geminiApiKey}
                                            onChange={(e) => setField('geminiApiKey', e.target.value)}
                                            className="w-full px-3 py-2 border border-base rounded bg-surface text-primary text-sm"
                                            placeholder="AIza..."
                                        />
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={handleCheckConnection}
                                            disabled={checkingAi}
                                            className="bg-surface-hover hover:bg-surface-active text-secondary px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50 transition-theme"
                                        >
                                            {checkingAi ? <Loader2 size={14} className="animate-spin" /> : null}
                                            Check Connection
                                        </button>
                                        {aiStatus && (
                                            <span className="flex items-center gap-1.5 text-sm">
                                                {aiStatus.ollama_running && aiStatus.model_available ? (
                                                    <>
                                                        <CheckCircle size={16} className="text-status-success" />
                                                        <span className="text-status-success">Connected - {aiStatus.model_name}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <XCircle size={16} className="text-status-error" />
                                                        <span className="text-status-error">Failed</span>
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

