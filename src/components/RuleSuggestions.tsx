import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lightbulb, Check, X } from 'lucide-react';
import { useRuleStore } from '../store/ruleStore';

interface SuggestedRule {
    description: string;
    signature: string;
    rule_config: {
        name: string;
        condition: any;
        actions: any[];
        enabled: boolean;
    };
    confidence: number;
    based_on_count: number;
}

export const RuleSuggestions: React.FC = () => {
    const [suggestions, setSuggestions] = useState<SuggestedRule[]>([]);
    const { fetchRules } = useRuleStore();

    useEffect(() => {
        loadSuggestions();
    }, []);

    const loadSuggestions = async () => {
        try {
            const res = await invoke<SuggestedRule[]>('get_rule_suggestions');
            setSuggestions(res);
        } catch (e) {
            console.error(e);
        }
    };

    const handleAccept = async (suggestion: SuggestedRule) => {
        try {
            // Convert structured config to DB-ready Rule object
            const rulePayload = {
                id: 0, // New rule
                name: suggestion.rule_config.name,
                condition_json: JSON.stringify(suggestion.rule_config.condition),
                action_json: JSON.stringify(suggestion.rule_config.actions), // actions is array?
                enabled: true,
                trigger: 'manual', // Default for now
            };

            // We need to match the backend 'save_rule' command signature
            // defined in rules_engine.rs: pub fn save_rule(app: AppHandle, rule: Rule)
            await invoke('save_rule', { rule: rulePayload });
            await invoke('record_rule_suggestion_feedback', {
                signature: suggestion.signature,
                status: 'accepted',
            });

            // Refresh
            fetchRules();
            setSuggestions(prev => prev.filter(s => s !== suggestion));
            alert('Rule created successfully!');
        } catch (e) {
            alert('Failed to create rule: ' + e);
        }
    };

    const handleDismiss = (suggestion: SuggestedRule) => {
        invoke('record_rule_suggestion_feedback', {
            signature: suggestion.signature,
            status: 'rejected',
        }).catch((e) => console.error(e));
        setSuggestions(prev => prev.filter(s => s !== suggestion));
    };

    if (suggestions.length === 0) return null;

    return (
        <div className="mb-6 space-y-4">
            <div className="flex items-center gap-2 text-yellow-500 font-semibold px-2">
                <Lightbulb size={20} />
                <span>AI Suggestions</span>
            </div>
            <div className="grid gap-3">
                {suggestions.map((suggestion, idx) => (
                    <div key={idx} className="bg-gray-800 border border-yellow-500/30 rounded-lg p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition-all hover:bg-gray-750">
                        <div className="flex-1">
                            <h4 className="font-medium text-gray-200">{suggestion.rule_config.name}</h4>
                            <p className="text-sm text-gray-400 mt-1">{suggestion.description}</p>
                            <div className="text-xs text-gray-500 mt-2 flex gap-4">
                                <span>Based on {suggestion.based_on_count} ops</span>
                                <span>Confidence: {(suggestion.confidence * 100).toFixed(0)}%</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => handleAccept(suggestion)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-900/40 hover:bg-green-900/60 text-green-400 border border-green-900 rounded-md text-sm transition-colors"
                            >
                                <Check size={16} />
                                Accept
                            </button>
                            <button
                                onClick={() => handleDismiss(suggestion)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-gray-700/50 hover:bg-gray-700 text-gray-400 border border-gray-600 rounded-md text-sm transition-colors"
                            >
                                <X size={16} />
                                Dismiss
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
