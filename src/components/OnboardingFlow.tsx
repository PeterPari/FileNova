import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { 
  FolderOpen, 
  Brain, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  ChevronRight,
  FolderPlus
} from 'lucide-react';
import { useThemeStore } from '../store/themeStore';

interface OnboardingFlowProps {
  onComplete: () => void;
}

type Step = 'welcome' | 'folders' | 'ai-provider' | 'settings' | 'indexing' | 'complete';

const setupSteps: Step[] = ['folders', 'ai-provider', 'settings', 'indexing'];

const stepLabels: Record<Step, string> = {
  welcome: 'Welcome',
  folders: 'Folders',
  'ai-provider': 'AI Provider',
  settings: 'Setup',
  indexing: 'Indexing',
  complete: 'Done',
};

interface FolderToIndex {
  path: string;
  selected: boolean;
  estimated_files?: number;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const [foldersToIndex, setFoldersToIndex] = useState<FolderToIndex[]>([]);
  const [aiProvider, setAiProvider] = useState<'ollama' | 'openai'>('ollama');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [embeddingModel, setEmbeddingModel] = useState('nomic-embed-text');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [indexingProgress, setIndexingProgress] = useState(0);
  const [_isIndexing, setIsIndexing] = useState(false);
  
  const { setTheme, theme, setCompactMode, compactMode } = useThemeStore();

  // Load suggested folders on mount
  useEffect(() => {
    loadSuggestedFolders();
  }, []);

  const loadSuggestedFolders = async () => {
    try {
      const suggested = await invoke<FolderToIndex[]>('get_suggested_folders');
      setFoldersToIndex(suggested);
    } catch (error) {
      console.error('Failed to load suggested folders:', error);
      // Fallback to default suggestions
      setFoldersToIndex([
        { path: '~/Documents', selected: true },
        { path: '~/Downloads', selected: true },
        { path: '~/Desktop', selected: false },
        { path: '~/Pictures', selected: false },
      ]);
    }
  };

  const selectCustomFolder = async () => {
    try {
      const path = await open({ directory: true, multiple: false });
      if (path && !foldersToIndex.find(f => f.path === path)) {
        setFoldersToIndex([...foldersToIndex, { path, selected: true }]);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const toggleFolder = (path: string) => {
    setFoldersToIndex(
      foldersToIndex.map(f => 
        f.path === path ? { ...f, selected: !f.selected } : f
      )
    );
  };

  const startIndexing = async () => {
    setIsIndexing(true);
    setSetupError(null);
    setCurrentStep('indexing');
    
    const selectedFolders = foldersToIndex.filter(f => f.selected).map(f => f.path);

    if (selectedFolders.length === 0) {
      setSetupError('Select at least one folder before starting indexing.');
      setCurrentStep('folders');
      setIsIndexing(false);
      return;
    }

    if (!geminiApiKey.trim()) {
      setSetupError('Gemini API key is required to enable AI chat.');
      setCurrentStep('settings');
      setIsIndexing(false);
      return;
    }

    if (aiProvider === 'openai' && !openaiApiKey.trim()) {
      setSetupError('OpenAI API key is required when OpenAI is selected.');
      setCurrentStep('settings');
      setIsIndexing(false);
      return;
    }
    
    try {
      await Promise.all([
        invoke('save_app_setting', { key: 'ai_provider', value: aiProvider }),
        invoke('save_app_setting', { key: 'ollama_url', value: ollamaUrl }),
        invoke('save_app_setting', { key: 'ai_embedding_model', value: embeddingModel }),
        invoke('save_app_setting', { key: 'ai_tag_model', value: embeddingModel }),
        invoke('save_openai_api_key', { value: openaiApiKey.trim() }),
        invoke('save_gemini_api_key', { value: geminiApiKey.trim() }),
      ]);

      // Start indexing with progress updates
      await invoke('start_initial_indexing', { 
        folders: selectedFolders,
        aiProvider,
      });
      
      // Simulate progress (in real implementation, this would come from backend events)
      const progressInterval = setInterval(() => {
        setIndexingProgress(prev => {
          if (prev >= 100) {
            clearInterval(progressInterval);
            setIsIndexing(false);
            setCurrentStep('complete');
            return 100;
          }
          return prev + 2;
        });
      }, 100);
    } catch (error) {
      console.error('Indexing failed:', error);
      setSetupError(`Indexing failed: ${String(error)}`);
      setCurrentStep('settings');
      setIsIndexing(false);
    }
  };

  const handleComplete = async () => {
    try {
      await invoke('set_onboarding_completed', { completed: true });
    } catch (error) {
      console.error('Failed to persist onboarding completion:', error);
    } finally {
      onComplete();
    }
  };

  const selectedFolderCount = foldersToIndex.filter((f) => f.selected).length;
  const setupStepIndex = setupSteps.indexOf(currentStep);

  const renderProgressHeader = () => {
    if (setupStepIndex === -1) return null;

    return (
      <div className="max-w-5xl mx-auto px-6 pt-6">
        <div className="bg-surface border border-base rounded-xl p-4 shadow-theme-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-secondary">Setup progress</p>
            <p className="text-xs text-muted">
              Step {setupStepIndex + 1} of {setupSteps.length}
            </p>
          </div>
          <div className="w-full h-2 rounded-full bg-tertiary overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-theme"
              style={{ width: `${((setupStepIndex + 1) / setupSteps.length) * 100}%` }}
            />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-3">
            {setupSteps.map((step, index) => {
              const isActive = step === currentStep;
              const isComplete = index < setupStepIndex;
              return (
                <div
                  key={step}
                  className={`text-xs rounded-md px-2 py-1 text-center border transition-theme ${
                    isActive
                      ? 'border-accent-primary/50 text-accent-primary bg-surface-hover'
                      : isComplete
                        ? 'border-base text-secondary bg-surface-hover'
                        : 'border-base text-muted bg-base'
                  }`}
                >
                  {stepLabels[step]}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderWelcome = () => (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-24 h-24 bg-[var(--accent-blue)] rounded-full flex items-center justify-center mb-6">
        <FolderOpen size={48} className="text-white" />
      </div>
      <h1 className="text-4xl font-bold text-[var(--text-primary)] mb-4">
        Welcome to FileNova
      </h1>
      <p className="text-lg text-[var(--text-secondary)] max-w-2xl mb-8">
        Your AI-powered file manager. Let's get started by setting up your workspace 
        and indexing your files for intelligent search and organization.
      </p>
      <button
        onClick={() => setCurrentStep('folders')}
        className="px-8 py-3 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-hover)] text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
      >
        Get Started
        <ChevronRight size={20} />
      </button>
    </div>
  );

  const renderFolderSelection = () => (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
        Select Folders to Index
      </h2>
      <p className="text-[var(--text-secondary)] mb-6">
        Choose which folders FileNova should monitor and index. We recommend starting 
        with your most important folders.
      </p>

      <div className="bg-[var(--bg-secondary)] border border-[var(--accent-yellow)] rounded-lg p-4 mb-6 flex items-start gap-3">
        <AlertCircle size={20} className="text-[var(--accent-yellow)] flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-[var(--text-primary)]">Important Note</p>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Indexing your entire drive can take a long time and consume significant resources. 
            We recommend selecting specific folders instead.
          </p>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {foldersToIndex.map((folder) => (
          <label
            key={folder.path}
            className="flex items-center justify-between p-4 bg-[var(--bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] transition-colors border-2 border-transparent hover:border-[var(--border-focus)]"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={folder.selected}
                onChange={() => toggleFolder(folder.path)}
                className="w-5 h-5 accent-[var(--accent-blue)]"
              />
              <FolderOpen size={20} className="text-[var(--accent-blue)]" />
              <span className="text-[var(--text-primary)] font-medium">{folder.path}</span>
            </div>
            {folder.estimated_files && (
              <span className="text-sm text-[var(--text-secondary)]">
                ~{folder.estimated_files.toLocaleString()} files
              </span>
            )}
          </label>
        ))}
      </div>

      <div className="text-xs text-[var(--text-secondary)] mb-6">
        {selectedFolderCount} folder{selectedFolderCount === 1 ? '' : 's'} selected
      </div>

      <button
        onClick={selectCustomFolder}
        className="w-full p-4 border-2 border-dashed border-[var(--border-primary)] rounded-lg text-[var(--text-secondary)] hover:border-[var(--accent-blue)] hover:text-[var(--accent-blue)] transition-colors flex items-center justify-center gap-2"
      >
        <FolderPlus size={20} />
        Add Custom Folder...
      </button>

      <div className="flex justify-between mt-8">
        <button
          onClick={() => setCurrentStep('welcome')}
          className="px-6 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => setCurrentStep('ai-provider')}
          disabled={!foldersToIndex.some(f => f.selected)}
          className="px-8 py-3 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-hover)] text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
          Continue
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );

  const renderAiProvider = () => (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
        Choose AI Provider
      </h2>
      <p className="text-[var(--text-secondary)] mb-6">
        Select how you want to power FileNova's AI features like semantic search, 
        file organization, and smart suggestions.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <button
          onClick={() => {
            setAiProvider('ollama');
            setEmbeddingModel('nomic-embed-text');
          }}
          className={`p-6 rounded-lg border-2 transition-all text-left ${
            aiProvider === 'ollama'
              ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10'
              : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-focus)]'
          }`}
        >
          <div className="flex items-center gap-3 mb-3">
            <Brain size={24} className="text-[var(--accent-blue)]" />
            <h3 className="text-xl font-semibold text-[var(--text-primary)]">Local (Ollama)</h3>
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-[var(--text-primary)]">✓ Complete privacy - no data leaves your PC</p>
            <p className="text-[var(--text-primary)]">✓ Free to use</p>
            <p className="text-[var(--text-secondary)] flex flex-wrap gap-1">
              ⚠ Requires <span 
                className="text-[var(--accent-blue)] underline hover:text-[var(--accent-blue-hover)] z-10 relative"
                onClick={(e) => {
                  e.stopPropagation();
                  openUrl('https://ollama.com');
                }}
              >Ollama</span> installed
            </p>
            <p className="text-[var(--text-secondary)]">⚠ Depends on your hardware speed</p>
          </div>
        </button>

        <button
          onClick={() => {
            setAiProvider('openai');
            setEmbeddingModel('text-embedding-3-small');
          }}
          className={`p-6 rounded-lg border-2 transition-all text-left ${
            aiProvider === 'openai'
              ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10'
              : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-focus)]'
          }`}
        >
          <div className="flex items-center gap-3 mb-3">
            <Brain size={24} className="text-[var(--accent-green)]" />
            <h3 className="text-xl font-semibold text-[var(--text-primary)]">Cloud (OpenAI)</h3>
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-[var(--text-primary)]">✓ Higher accuracy & speed</p>
            <p className="text-[var(--text-primary)]">✓ Works on any computer</p>
            <p className="text-[var(--text-secondary)] flex flex-wrap gap-1">
              ⚠ Requires <span 
                className="text-[var(--accent-blue)] underline hover:text-[var(--accent-blue-hover)] z-10 relative"
                onClick={(e) => {
                  e.stopPropagation();
                  openUrl('https://platform.openai.com/api-keys');
                }}
              >OpenAI API Key</span>
            </p>
            <p className="text-[var(--text-secondary)]">⚠ Small cost per usage</p>
          </div>
        </button>
      </div>

      <div className="flex justify-between">
        <button
          onClick={() => setCurrentStep('folders')}
          className="px-6 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => setCurrentStep('settings')}
          className="px-8 py-3 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-hover)] text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
        >
          Continue
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="p-8 max-w-3xl mx-auto">
      <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
        Configure Intelligence
      </h2>
      <p className="text-[var(--text-secondary)] mb-6">
        Set up the AI keys needed for smart features. You can change these later in Settings.
      </p>

      <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4 mb-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <Brain size={18} />
          Why do I need these keys?
        </h3>
        <ul className="text-sm text-[var(--text-secondary)] space-y-2 list-disc pl-5">
          {aiProvider === 'ollama' ? (
            <li>
              <strong>Ollama (Local):</strong> Free and private. Download from <button onClick={() => openUrl('https://ollama.com')} className="text-[var(--accent-blue)] hover:underline inline">ollama.com</button>. Keep Ollama running in the background while using FileNova.
            </li>
          ) : (
            <li>
              <strong>OpenAI (Cloud):</strong> Requires a paid API key from the <button onClick={() => openUrl('https://platform.openai.com/api-keys')} className="text-[var(--accent-blue)] hover:underline inline">OpenAI Platform</button>.
            </li>
          )}
          <li>
            <strong>Gemini (Chat):</strong> Used for the AI Chat feature. Get a free key from <button onClick={() => openUrl('https://aistudio.google.com/app/apikey')} className="text-[var(--accent-blue)] hover:underline inline">Google AI Studio</button>.
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <div className={`rounded-lg border p-3 text-sm ${selectedFolderCount > 0 ? 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/10 text-[var(--text-primary)]' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}>
          Indexed folders: <span className="font-semibold">{selectedFolderCount}</span>
        </div>
        <div className={`rounded-lg border p-3 text-sm ${geminiApiKey.trim() ? 'border-[var(--accent-green)]/40 bg-[var(--accent-green)]/10 text-[var(--text-primary)]' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}>
          Gemini key: <span className="font-semibold">{geminiApiKey.trim() ? 'Configured' : 'Required'}</span>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        {aiProvider === 'ollama' ? (
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">Ollama URL</label>
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              placeholder="http://localhost:11434"
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">OpenAI API Key</label>
            <input
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              className="w-full px-3 py-2 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
              placeholder="sk-..."
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">Embedding Model</label>
          <input
            type="text"
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">Gemini API Key (required for Chat)</label>
          <input
            type="password"
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            className="w-full px-3 py-2 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)]"
            placeholder="AIza..."
          />
        </div>
      </div>

      {setupError && (
        <div className="mb-6 p-3 rounded-lg bg-red-900/20 border border-red-900/40 text-red-300 text-sm">
          {setupError}
        </div>
      )}

      <div className="space-y-6">
        {/* Theme */}
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Theme</h3>
          <div className="flex gap-3">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all capitalize ${
                  theme === t
                    ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--border-focus)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Compact Mode */}
        <label className="flex items-center justify-between p-4 bg-[var(--bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--bg-hover)] transition-colors">
          <div>
            <div className="text-[var(--text-primary)] font-medium">Compact Mode</div>
            <div className="text-sm text-[var(--text-secondary)]">Reduce spacing for a denser view</div>
          </div>
          <input
            type="checkbox"
            checked={compactMode}
            onChange={(e) => setCompactMode(e.target.checked)}
            className="w-5 h-5 accent-[var(--accent-blue)]"
          />
        </label>
      </div>

      <div className="flex justify-between mt-8">
        <button
          onClick={() => setCurrentStep('ai-provider')}
          className="px-6 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Back
        </button>
        <button
          onClick={startIndexing}
          disabled={!geminiApiKey.trim() || (aiProvider === 'openai' && !openaiApiKey.trim())}
          className="px-8 py-3 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-hover)] text-white rounded-lg font-medium flex items-center gap-2 transition-colors"
        >
          Start Indexing
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );

  const renderIndexing = () => (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <Loader2 size={64} className="text-[var(--accent-blue)] animate-spin mb-6" />
      <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
        Indexing Your Files
      </h2>
      <p className="text-[var(--text-secondary)] mb-8 text-center max-w-lg">
        FileNova is analyzing your selected folders. This may take a few minutes depending 
        on the number of files.
      </p>
      
      <div className="w-full max-w-md">
        <div className="bg-[var(--bg-secondary)] rounded-full h-3 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-green)] transition-all duration-300"
            style={{ width: `${indexingProgress}%` }}
          />
        </div>
        <p className="text-center text-[var(--text-secondary)] mt-3">
          {indexingProgress}% Complete
        </p>
      </div>
    </div>
  );

  const renderComplete = () => (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-24 h-24 bg-[var(--accent-green)] rounded-full flex items-center justify-center mb-6">
        <CheckCircle2 size={48} className="text-white" />
      </div>
      <h2 className="text-4xl font-bold text-[var(--text-primary)] mb-4">
        All Set!
      </h2>
      <p className="text-lg text-[var(--text-secondary)] max-w-2xl mb-8">
        FileNova has finished indexing your files. You're ready to experience 
        intelligent file management with AI-powered features.
      </p>
      <button
        onClick={handleComplete}
        className="px-8 py-3 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-hover)] text-white rounded-lg font-medium transition-colors"
      >
        Start Using FileNova
      </button>
    </div>
  );

  const steps: Record<Step, () => React.ReactNode> = {
    welcome: renderWelcome,
    folders: renderFolderSelection,
    'ai-provider': renderAiProvider,
    settings: renderSettings,
    indexing: renderIndexing,
    complete: renderComplete,
  };

  return (
      <div className="fixed inset-0 bg-[var(--bg-base)] z-50 overflow-auto">
      {renderProgressHeader()}
      <div className="max-w-5xl mx-auto px-6 pb-8">
        <div className="bg-base border border-base rounded-xl shadow-theme-md min-h-[calc(100vh-96px)]">
          {steps[currentStep]()}
        </div>
      </div>
    </div>
  );
};
