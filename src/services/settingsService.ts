import { invoke } from '@tauri-apps/api/core';
import type { AiStatus, ExtractionStats } from '../store/fileStore';

export interface SettingsBundle {
  aiProvider: string;
  providerUrl: string;
  openaiApiKey: string;
  geminiApiKey: string;
  modelName: string;
  trashRetention: number;
  crashReporting: boolean;
  extractionStats: ExtractionStats | null;
}

const DEFAULTS: SettingsBundle = {
  aiProvider: 'ollama',
  providerUrl: 'http://localhost:11434',
  openaiApiKey: '',
  geminiApiKey: '',
  modelName: 'nomic-embed-text',
  trashRetention: 30,
  crashReporting: false,
  extractionStats: null,
};

const parseIntOr = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const settingsService = {
  async loadSettingsBundle(): Promise<SettingsBundle> {
    const [
      provider,
      ollamaUrl,
      legacyUrl,
      openAiKey,
      geminiKey,
      tagModel,
      embeddingModel,
      retention,
      crashReportingEnabled,
      extractionStatsResult,
    ] = await Promise.allSettled([
      invoke<string | null>('get_app_setting', { key: 'ai_provider' }),
      invoke<string | null>('get_app_setting', { key: 'ollama_url' }),
      invoke<string | null>('get_app_setting', { key: 'ai_provider_url' }),
      invoke<string | null>('get_openai_api_key'),
      invoke<string | null>('get_gemini_api_key'),
      invoke<string | null>('get_app_setting', { key: 'ai_tag_model' }),
      invoke<string | null>('get_app_setting', { key: 'ai_embedding_model' }),
      invoke<string | null>('get_app_setting', { key: 'trash_retention_days' }),
      invoke<string | null>('get_app_setting', { key: 'crash_reporting_enabled' }),
      invoke<ExtractionStats>('get_extraction_stats'),
    ]);

    const providerUrl =
      ollamaUrl.status === 'fulfilled' && ollamaUrl.value
        ? ollamaUrl.value
        : legacyUrl.status === 'fulfilled' && legacyUrl.value
          ? legacyUrl.value
          : DEFAULTS.providerUrl;

    const modelName =
      tagModel.status === 'fulfilled' && tagModel.value
        ? tagModel.value
        : embeddingModel.status === 'fulfilled' && embeddingModel.value
          ? embeddingModel.value
          : DEFAULTS.modelName;

    return {
      aiProvider: provider.status === 'fulfilled' && provider.value ? provider.value : DEFAULTS.aiProvider,
      providerUrl,
      openaiApiKey: openAiKey.status === 'fulfilled' && openAiKey.value ? openAiKey.value : DEFAULTS.openaiApiKey,
      geminiApiKey: geminiKey.status === 'fulfilled' && geminiKey.value ? geminiKey.value : DEFAULTS.geminiApiKey,
      modelName,
      trashRetention: parseIntOr(retention.status === 'fulfilled' ? retention.value : null, DEFAULTS.trashRetention),
      crashReporting:
        crashReportingEnabled.status === 'fulfilled' ? crashReportingEnabled.value === 'true' : DEFAULTS.crashReporting,
      extractionStats: extractionStatsResult.status === 'fulfilled' ? extractionStatsResult.value : null,
    };
  },

  async saveAiSettings(payload: {
    aiProvider: string;
    providerUrl: string;
    openaiApiKey: string;
    geminiApiKey: string;
    modelName: string;
  }): Promise<void> {
    await Promise.all([
      invoke('save_app_setting', { key: 'ai_provider', value: payload.aiProvider }),
      invoke('save_app_setting', { key: 'ollama_url', value: payload.providerUrl }),
      invoke('save_openai_api_key', { value: payload.openaiApiKey }),
      invoke('save_gemini_api_key', { value: payload.geminiApiKey }),
      invoke('save_app_setting', { key: 'ai_embedding_model', value: payload.modelName }),
      invoke('save_app_setting', { key: 'ai_tag_model', value: payload.modelName }),
    ]);
  },

  async saveTrashRetention(days: number): Promise<void> {
    await invoke('save_app_setting', { key: 'trash_retention_days', value: String(days) });
  },

  async setCrashReporting(enabled: boolean): Promise<void> {
    await invoke('save_app_setting', {
      key: 'crash_reporting_enabled',
      value: enabled ? 'true' : 'false',
    });
  },

  async checkAiStatus(): Promise<AiStatus> {
    return invoke<AiStatus>('check_ai_status');
  },
};
