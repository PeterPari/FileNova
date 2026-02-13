import { useCallback, useEffect, useState } from 'react';
import type { AiStatus, ExtractionStats } from '../store/fileStore';
import { settingsService } from '../services/settingsService';

export interface SettingsState {
  aiProvider: string;
  providerUrl: string;
  openaiApiKey: string;
  geminiApiKey: string;
  modelName: string;
  aiStatus: AiStatus | null;
  checkingAi: boolean;
  extractionStats: ExtractionStats | null;
  trashRetention: number;
  crashReporting: boolean;
  loading: boolean;
}

export const useSettingsData = () => {
  const [state, setState] = useState<SettingsState>({
    aiProvider: 'ollama',
    providerUrl: 'http://localhost:11434',
    openaiApiKey: '',
    geminiApiKey: '',
    modelName: 'nomic-embed-text',
    aiStatus: null,
    checkingAi: false,
    extractionStats: null,
    trashRetention: 30,
    crashReporting: false,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const settings = await settingsService.loadSettingsBundle();
      if (cancelled) return;
      setState((prev) => ({
        ...prev,
        aiProvider: settings.aiProvider,
        providerUrl: settings.providerUrl,
        openaiApiKey: settings.openaiApiKey,
        geminiApiKey: settings.geminiApiKey,
        modelName: settings.modelName,
        extractionStats: settings.extractionStats,
        trashRetention: settings.trashRetention,
        crashReporting: settings.crashReporting,
        loading: false,
      }));
    };

    load().catch(() => {
      if (!cancelled) {
        setState((prev) => ({ ...prev, loading: false }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setField = useCallback(<K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const saveAiSettings = useCallback(async () => {
    await settingsService.saveAiSettings({
      aiProvider: state.aiProvider,
      providerUrl: state.providerUrl,
      openaiApiKey: state.openaiApiKey,
      geminiApiKey: state.geminiApiKey,
      modelName: state.modelName,
    });
  }, [state.aiProvider, state.providerUrl, state.openaiApiKey, state.geminiApiKey, state.modelName]);

  const saveRetention = useCallback(async () => {
    await settingsService.saveTrashRetention(state.trashRetention);
  }, [state.trashRetention]);

  const toggleCrashReporting = useCallback(async (enabled: boolean) => {
    setState((prev) => ({ ...prev, crashReporting: enabled }));
    await settingsService.setCrashReporting(enabled);
  }, []);

  const checkConnection = useCallback(async () => {
    setState((prev) => ({ ...prev, checkingAi: true, aiStatus: null }));
    await saveAiSettings();
    try {
      const status = await settingsService.checkAiStatus();
      setState((prev) => ({ ...prev, checkingAi: false, aiStatus: status }));
    } catch {
      setState((prev) => ({
        ...prev,
        checkingAi: false,
        aiStatus: {
          ollama_running: false,
          model_available: false,
          model_name: prev.modelName,
          provider_url: prev.providerUrl,
        },
      }));
    }
  }, [saveAiSettings]);

  return {
    state,
    setField,
    saveAiSettings,
    saveRetention,
    toggleCrashReporting,
    checkConnection,
  };
};
