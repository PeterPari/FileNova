import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useRuleStore, Rule } from '../store/ruleStore';
import { RuleConflictModal, RuleConflict, RulePlanExecution } from './RuleConflictModal';
import { RuleBuilder } from './RuleBuilder';
import { RuleSuggestions } from './RuleSuggestions';
import { Plus, Edit2, Trash2, Play, Settings } from 'lucide-react';

interface RuleConflictBatch {
    rule_id: number;
    batch_id: string;
    conflicts: RuleConflict[];
    planned_actions: RulePlanExecution[];
}

export const RulesManager: React.FC = () => {
    const { rules, fetchRules, deleteRule, runRule, saveRule, isLoading } = useRuleStore();
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<Rule | null>(null);
    const [runStatus, setRunStatus] = useState<{
        type: 'running' | 'success' | 'error';
        message: string;
    } | null>(null);
    const [pendingResolution, setPendingResolution] = useState<{
        ruleId: number;
        batchId: string;
        conflicts: RuleConflict[];
        actions: RulePlanExecution[];
    } | null>(null);

    useEffect(() => {
        fetchRules();
    }, [fetchRules]);

    useEffect(() => {
        const setupListener = async () => {
            const unlisten = await listen<RuleConflictBatch>('rule-conflicts', (event) => {
                const payload = event.payload;
                if (!payload) return;
                setPendingResolution({
                    ruleId: payload.rule_id,
                    batchId: payload.batch_id,
                    conflicts: payload.conflicts || [],
                    actions: payload.planned_actions || [],
                });
            });
            return unlisten;
        };

        let cleanup: (() => void) | null = null;
        setupListener().then((unlisten) => {
            cleanup = unlisten;
        });

        return () => {
            if (cleanup) cleanup();
        };
    }, []);

    const handleCreate = () => {
        setEditingRule(null);
        setIsBuilderOpen(true);
    };

    const handleEdit = (rule: Rule) => {
        setEditingRule(rule);
        setIsBuilderOpen(true);
    };

    const handleDelete = async (id: number) => {
        if (confirm('Are you sure you want to delete this rule?')) {
            await deleteRule(id);
        }
    };

    const handleRun = async (id: number) => {
        // Dry run first? Or just run?
        // For now, let's just run it.
        try {
            const dryRun = await runRule(id, true);
            setRunStatus({
                type: 'running',
                message: `Processing ${dryRun.files_matched} files...`,
            });
            const result = await runRule(id, false);
            if (result.requires_resolution && result.batch_id) {
                setRunStatus(null);
                setPendingResolution({
                    ruleId: id,
                    batchId: result.batch_id,
                    conflicts: result.conflicts || [],
                    actions: result.planned_actions || [],
                });
                return;
            }
            const message = `Rule executed. Matched: ${result.files_matched}, Processed: ${result.files_processed}, Errors: ${result.errors.length}`;
            setRunStatus({ type: 'success', message });
            setTimeout(() => setRunStatus(null), 6000);
        } catch (e) {
            setRunStatus({ type: 'error', message: `Failed to run rule: ${e}` });
            setTimeout(() => setRunStatus(null), 6000);
        }
    };

    const handleResolveConflicts = async (actions: RulePlanExecution[]) => {
        if (!pendingResolution) return;
        try {
            setRunStatus({ type: 'running', message: 'Applying conflict resolutions...' });
            const result = await invoke<any>('execute_rule_plan', {
                ruleId: pendingResolution.ruleId,
                batchId: pendingResolution.batchId,
                actions,
            });
            const message = `Rule executed. Matched: ${result.files_matched}, Processed: ${result.files_processed}, Errors: ${result.errors.length}`;
            setRunStatus({ type: 'success', message });
            setTimeout(() => setRunStatus(null), 6000);
            setPendingResolution(null);
        } catch (e) {
            setRunStatus({ type: 'error', message: `Failed to apply resolutions: ${e}` });
            setTimeout(() => setRunStatus(null), 6000);
        }
    };

    const handleToggleEnabled = async (rule: Rule) => {
        await saveRule({
            ...rule,
            enabled: !rule.enabled,
            id: rule.id
        });
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 icon-white">
            <div className="flex justify-between items-center p-4 border-b border-gray-700">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Settings size={24} /> Rules Engine
                </h2>
                <button
                    onClick={handleCreate}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
                >
                    <Plus size={16} /> New Rule
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {runStatus && (
                    <div
                        className={`mb-4 rounded border px-3 py-2 text-sm ${
                            runStatus.type === 'running'
                                ? 'bg-blue-900/30 border-blue-700 text-blue-300'
                                : runStatus.type === 'success'
                                ? 'bg-green-900/30 border-green-700 text-green-300'
                                : 'bg-red-900/30 border-red-700 text-red-300'
                        }`}
                    >
                        {runStatus.message}
                    </div>
                )}
                <RuleSuggestions />

                {isLoading && rules.length === 0 ? (
                    <div className="text-center text-gray-500 mt-10">Loading rules...</div>
                ) : rules.length === 0 ? (
                    <div className="text-center text-gray-500 mt-10">
                        No rules defined. Create one to automate your organization.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {rules.map(rule => (
                            <div key={rule.id} className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex justify-between items-center hover:bg-gray-750 transition-colors">
                                <div>
                                    <h3 className="font-semibold text-lg">{rule.name}</h3>
                                    <div className="text-xs text-gray-400 mt-1 flex gap-2">
                                        <span className={`px-1.5 py-0.5 rounded ${rule.enabled ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                                            {rule.enabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                        <span className="bg-gray-700/50 px-1.5 py-0.5 rounded text-gray-300">
                                            Trigger: {rule.trigger}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-2 truncate w-96">
                                        Condition: {rule.condition_json.substring(0, 50)}...
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleToggleEnabled(rule)}
                                        title={rule.enabled ? 'Disable Rule' : 'Enable Rule'}
                                        className={`px-2 py-1 rounded text-xs border ${rule.enabled ? 'bg-green-900/30 border-green-700 text-green-300' : 'bg-gray-700 border-gray-600 text-gray-300'}`}
                                    >
                                        {rule.enabled ? 'Enabled' : 'Disabled'}
                                    </button>
                                    <button
                                        onClick={() => handleRun(rule.id)}
                                        title="Run Rule Now"
                                        className="p-2 hover:bg-gray-700 rounded text-green-400"
                                    >
                                        <Play size={18} />
                                    </button>
                                    <button
                                        onClick={() => handleEdit(rule)}
                                        title="Edit Rule"
                                        className="p-2 hover:bg-gray-700 rounded text-blue-400"
                                    >
                                        <Edit2 size={18} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(rule.id)}
                                        title="Delete Rule"
                                        className="p-2 hover:bg-gray-700 rounded text-red-400"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {isBuilderOpen && (
                <RuleBuilder
                    existingRule={editingRule}
                    onClose={() => setIsBuilderOpen(false)}
                    onSave={() => {
                        setIsBuilderOpen(false);
                        fetchRules();
                    }}
                />
            )}

            {pendingResolution && (
                <RuleConflictModal
                    isOpen
                    conflicts={pendingResolution.conflicts}
                    actions={pendingResolution.actions}
                    onClose={() => setPendingResolution(null)}
                    onConfirm={handleResolveConflicts}
                />
            )}
        </div>
    );
};
