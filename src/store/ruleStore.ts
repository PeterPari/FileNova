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

export interface Condition {
    type: ConditionType;
    value?: any; // Vec<Condition> for And/Or, Condition for Not, primitive for others
}

export type ActionType =
    | 'Move' | 'Copy' | 'Rename' | 'Archive' | 'Delete' | 'Trash' | 'AddTag';

export interface Action {
    type: ActionType;
    value?: any; // { destination: string } etc
}

interface RuleStore {
    rules: Rule[];
    isLoading: boolean;
    error: string | null;

    fetchRules: () => Promise<void>;
    saveRule: (rule: Omit<Rule, 'id'> & { id?: number }) => Promise<void>;
    deleteRule: (id: number) => Promise<void>;
    runRule: (id: number, dryRun: boolean) => Promise<any>;
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
        } catch (e: any) {
            set({ error: e.toString(), isLoading: false });
        }
    },

    saveRule: async (rule) => {
        set({ isLoading: true, error: null });
        try {
            // Ensure ID is set (0 for new)
            const ruleToSave = { ...rule, id: rule.id || 0 };
            await invoke('save_rule', { rule: ruleToSave });
            await get().fetchRules();
        } catch (e: any) {
            set({ error: e.toString(), isLoading: false });
        }
    },

    deleteRule: async (id) => {
        set({ isLoading: true, error: null });
        try {
            await invoke('delete_rule', { ruleId: id });
            await get().fetchRules();
        } catch (e: any) {
            set({ error: e.toString(), isLoading: false });
        }
    },

    runRule: async (id, dryRun) => {
        set({ isLoading: true });
        try {
            const result = await invoke('run_rule', { ruleId: id, dryRun });
            set({ isLoading: false });
            return result;
        } catch (e: any) {
            set({ isLoading: false, error: e.toString() });
            throw e;
        }
    }
}));
