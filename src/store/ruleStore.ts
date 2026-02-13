import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Rule {
    id: number;
    name: string;
    condition_json: string;
    action_json: string;
    enabled: boolean;
    trigger: string;
    schedule_cron?: string | null;
}

export type ConditionType =
    | 'And' | 'Or' | 'Not'
    | 'NameMatches' | 'ExtensionEquals'
    | 'SizeGreaterThan' | 'SizeLessThan' | 'SizeEquals'
    | 'ModifiedBefore' | 'ModifiedAfter'
    | 'PathContains' | 'HasTag';

export type ConditionScalar = string | number | boolean | null;

export type ConditionValue = Condition[] | Condition | ConditionScalar;

export interface Condition {
    type: ConditionType;
    value?: ConditionValue;
}

export type ActionType =
    | 'Move' | 'Copy' | 'Rename' | 'Archive' | 'Delete' | 'Trash' | 'AddTag';

export interface ActionValue {
    destination?: string;
    pattern?: string;
    tag?: string;
}

export interface Action {
    type: ActionType;
    value?: ActionValue;
}

export interface RuleRunResult {
    files_matched: number;
    files_processed: number;
    errors: string[];
    requires_resolution?: boolean;
    batch_id?: string;
    conflicts?: unknown[];
    planned_actions?: unknown[];
}

interface RuleStore {
    rules: Rule[];
    isLoading: boolean;
    error: string | null;

    fetchRules: () => Promise<void>;
    saveRule: (rule: Omit<Rule, 'id'> & { id?: number }) => Promise<void>;
    deleteRule: (id: number) => Promise<void>;
    runRule: (id: number, dryRun: boolean) => Promise<RuleRunResult>;
}

export const useRuleStore = create<RuleStore>((set, get) => ({
    rules: [],
    isLoading: false,
    error: null,

    fetchRules: async () => {
        set({ isLoading: true, error: null });
        try {
            const rules = await invoke<Rule[]>('get_rules');
            set({ rules, isLoading: false });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            set({ error: message, isLoading: false });
        }
    },

    saveRule: async (rule) => {
        set({ isLoading: true, error: null });
        try {
            // Ensure ID is set (0 for new)
            const ruleToSave = { ...rule, id: rule.id || 0 };
            await invoke('save_rule', { rule: ruleToSave });
            await get().fetchRules();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            set({ error: message, isLoading: false });
        }
    },

    deleteRule: async (id) => {
        set({ isLoading: true, error: null });
        try {
            await invoke('delete_rule', { ruleId: id });
            await get().fetchRules();
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            set({ error: message, isLoading: false });
        }
    },

    runRule: async (id, dryRun) => {
        set({ isLoading: true });
        try {
            const result = await invoke<RuleRunResult>('run_rule', { ruleId: id, dryRun });
            set({ isLoading: false });
            return result;
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            set({ isLoading: false, error: message });
            throw e;
        }
    }
}));
