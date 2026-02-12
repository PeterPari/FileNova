import React, { useState } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRuleStore, Rule, Condition, Action } from '../store/ruleStore';
import { Plus, Trash2, Save, X, Play, AlertTriangle, CheckCircle, GripVertical } from 'lucide-react';

type UiCondition = Condition & { id: string };

const buildConditionId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `cond_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const assignConditionIds = (condition: Condition): UiCondition => {
    const id = buildConditionId();
    if (condition.type === 'And' || condition.type === 'Or') {
        const children = Array.isArray(condition.value) ? condition.value : [];
        return {
            ...condition,
            id,
            value: children.map(assignConditionIds),
        } as UiCondition;
    }
    if (condition.type === 'Not') {
        const child = condition.value ? assignConditionIds(condition.value) : assignConditionIds({ type: 'NameMatches', value: '' });
        return { ...condition, id, value: child } as UiCondition;
    }
    return { ...condition, id } as UiCondition;
};

const stripConditionIds = (condition: UiCondition): Condition => {
    if (condition.type === 'And' || condition.type === 'Or') {
        const children = Array.isArray(condition.value) ? condition.value : [];
        return {
            type: condition.type,
            value: children.map(stripConditionIds),
        } as Condition;
    }
    if (condition.type === 'Not') {
        return {
            type: condition.type,
            value: condition.value ? stripConditionIds(condition.value as UiCondition) : undefined,
        } as Condition;
    }
    return { type: condition.type, value: condition.value } as Condition;
};

const createDefaultCondition = (type: string): UiCondition => {
    if (type === 'And' || type === 'Or') {
        return assignConditionIds({ type, value: [] } as Condition);
    }
    if (type === 'Not') {
        return assignConditionIds({ type, value: { type: 'NameMatches', value: '' } } as Condition);
    }
    if (type.includes('Size')) {
        return assignConditionIds({ type, value: 1024 * 1024 } as Condition);
    }
    if (type.includes('Modified')) {
        return assignConditionIds({ type, value: Math.floor(Date.now() / 1000) } as Condition);
    }
    return assignConditionIds({ type, value: '' } as Condition);
};

const SortableConditionRow: React.FC<{
    condition: UiCondition;
    children: React.ReactNode;
}> = ({ condition, children }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: condition.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex gap-2 items-start">
            <button
                type="button"
                className="mt-2 text-gray-500 hover:text-gray-300"
                title="Drag to reorder"
                {...attributes}
                {...listeners}
            >
                <GripVertical size={16} />
            </button>
            <div className="flex-1">{children}</div>
        </div>
    );
};

interface RuleBuilderProps {
    existingRule?: Rule | null;
    onClose: () => void;
    onSave: () => void;
}

const ConditionBuilder: React.FC<{
    condition: UiCondition;
    onChange: (c: UiCondition) => void;
    onRemove: () => void;
    depth?: number;
}> = ({ condition, onChange, onRemove, depth = 0 }) => {
    const parseTextCondition = (raw?: string) => {
        const value = typeof raw === 'string' ? raw : '';
        const lower = value.toLowerCase();

        if (lower.startsWith('regex:')) {
            return { op: 'regex', text: value.slice(6).trim() };
        }
        if (lower.startsWith('equals:')) {
            return { op: 'equals', text: value.slice(7).trim() };
        }
        if (lower.startsWith('contains:')) {
            return { op: 'contains', text: value.slice(9).trim() };
        }
        if (lower.startsWith('wildcard:')) {
            return { op: 'wildcard', text: value.slice(9).trim() };
        }
        if (value.includes('*')) {
            return { op: 'wildcard', text: value };
        }

        return { op: 'contains', text: value };
    };

    const buildTextConditionValue = (op: string, text: string) => {
        if (!text) return '';
        if (op === 'wildcard') return text;
        return `${op}:${text}`;
    };

    const updateTextCondition = (op: string, text: string) => {
        handleValueChange(buildTextConditionValue(op, text));
    };

    const handleTypeChange = (newType: string) => {
        const updated = createDefaultCondition(newType);
        onChange({ ...updated, id: condition.id } as UiCondition);
    };

    const handleValueChange = (val: any) => {
        onChange({ ...condition, value: val });
    };

    const addSubCondition = () => {
        if (Array.isArray(condition.value)) {
            const newSub = createDefaultCondition('NameMatches');
            onChange({ ...condition, value: [...condition.value, newSub] });
        }
    };

    const updateSubCondition = (index: number, newSub: Condition) => {
        if (Array.isArray(condition.value)) {
            const newArr = [...condition.value];
            newArr[index] = newSub as UiCondition;
            onChange({ ...condition, value: newArr });
        }
    };

    const removeSubCondition = (index: number) => {
        if (Array.isArray(condition.value)) {
            const newArr = [...condition.value];
            newArr.splice(index, 1);
            onChange({ ...condition, value: newArr });
        }
    };

    const handleDragEnd = (event: any) => {
        const { active, over } = event;
        if (!active || !over || active.id === over.id) return;

        if (Array.isArray(condition.value)) {
            const items = condition.value as UiCondition[];
            const oldIndex = items.findIndex((item) => item.id === active.id);
            const newIndex = items.findIndex((item) => item.id === over.id);
            if (oldIndex !== -1 && newIndex !== -1) {
                const reordered = arrayMove(items, oldIndex, newIndex);
                onChange({ ...condition, value: reordered });
            }
        }
    };

    return (
        <div className="flex flex-col gap-2 p-2 border rounded border-gray-700 bg-gray-800/50" style={{ marginLeft: depth * 10 }}>
            <div className="flex items-center gap-2">
                <select
                    value={condition.type}
                    onChange={(e) => handleTypeChange(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200"
                >
                    <option value="And">AND (All match)</option>
                    <option value="Or">OR (Any match)</option>
                    <option value="Not">NOT (None match)</option>
                    <hr />
                    <option value="NameMatches">Name Matches</option>
                    <option value="ExtensionEquals">Extension Equals</option>
                    <option value="SizeGreaterThan">Size &gt;</option>
                    <option value="SizeLessThan">Size &lt;</option>
                    <option value="SizeEquals">Size =</option>
                    <option value="ModifiedBefore">Modified Before</option>
                    <option value="ModifiedAfter">Modified After</option>
                    <option value="PathContains">Path Contains</option>
                    <option value="HasTag">Has Tag</option>
                </select>

                {condition.type === 'NameMatches' && (
                    <div className="flex items-center gap-2 flex-1">
                        <select
                            value={parseTextCondition(condition.value).op}
                            onChange={(e) => updateTextCondition(e.target.value, parseTextCondition(condition.value).text)}
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200"
                        >
                            <option value="contains">Contains</option>
                            <option value="equals">Equals</option>
                            <option value="regex">Matches (Regex)</option>
                            <option value="wildcard">Wildcard</option>
                        </select>
                        <input
                            type="text"
                            value={parseTextCondition(condition.value).text}
                            onChange={(e) => updateTextCondition(parseTextCondition(condition.value).op, e.target.value)}
                            placeholder="value"
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm flex-1 text-gray-200"
                        />
                    </div>
                )}
                {condition.type === 'ExtensionEquals' && (
                    <input
                        type="text"
                        value={condition.value}
                        onChange={(e) => handleValueChange(e.target.value)}
                        placeholder="jpg"
                        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm flex-1 text-gray-200"
                    />
                )}
                {(condition.type === 'SizeGreaterThan' || condition.type === 'SizeLessThan') && (
                    <div className="flex items-center gap-2 flex-1">
                        <input
                            type="number"
                            value={condition.value}
                            onChange={(e) => handleValueChange(parseInt(e.target.value))}
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm w-24 text-gray-200"
                        />
                        <span className="text-xs text-gray-400">bytes</span>
                    </div>
                )}
                {condition.type === 'SizeEquals' && (
                    <div className="flex items-center gap-2 flex-1">
                        <input
                            type="number"
                            value={condition.value}
                            onChange={(e) => handleValueChange(parseInt(e.target.value))}
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm w-24 text-gray-200"
                        />
                        <span className="text-xs text-gray-400">bytes</span>
                    </div>
                )}
                {(condition.type === 'ModifiedBefore' || condition.type === 'ModifiedAfter') && (
                    <div className="flex items-center gap-2 flex-1">
                        <span className="text-xs text-gray-400">Timestamp:</span>
                        <input
                            type="number"
                            value={condition.value}
                            onChange={(e) => handleValueChange(parseInt(e.target.value))}
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm flex-1 text-gray-200"
                        />
                    </div>
                )}
                {condition.type === 'PathContains' && (
                    <div className="flex items-center gap-2 flex-1">
                        <select
                            value={parseTextCondition(condition.value).op}
                            onChange={(e) => updateTextCondition(e.target.value, parseTextCondition(condition.value).text)}
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200"
                        >
                            <option value="contains">Contains</option>
                            <option value="equals">Equals</option>
                            <option value="regex">Matches (Regex)</option>
                        </select>
                        <input
                            type="text"
                            value={parseTextCondition(condition.value).text}
                            onChange={(e) => updateTextCondition(parseTextCondition(condition.value).op, e.target.value)}
                            placeholder="/images/"
                            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm flex-1 text-gray-200"
                        />
                    </div>
                )}
                {condition.type === 'HasTag' && (
                    <input
                        type="text"
                        value={condition.value}
                        onChange={(e) => handleValueChange(e.target.value)}
                        placeholder="Tag name"
                        className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm flex-1 text-gray-200"
                    />
                )}

                <button onClick={onRemove} className="text-red-400 hover:text-red-300 p-1">
                    <Trash2 size={14} />
                </button>
            </div>

            {(condition.type === 'And' || condition.type === 'Or') && (
                <div className="flex flex-col gap-2 pl-4 border-l-2 border-gray-600">
                    {Array.isArray(condition.value) && (
                        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext
                                items={condition.value.map((sub: UiCondition) => sub.id)}
                                strategy={verticalListSortingStrategy}
                            >
                                <div className="flex flex-col gap-2">
                                    {(condition.value as UiCondition[]).map((sub, idx) => (
                                        <SortableConditionRow key={sub.id} condition={sub}>
                                            <ConditionBuilder
                                                condition={sub}
                                                onChange={(c) => updateSubCondition(idx, c)}
                                                onRemove={() => removeSubCondition(idx)}
                                                depth={depth + 1}
                                            />
                                        </SortableConditionRow>
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    )}
                    <button onClick={addSubCondition} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1">
                        <Plus size={12} /> Add Condition
                    </button>
                </div>
            )}
        </div>
    );
};

export const RuleBuilder: React.FC<RuleBuilderProps> = ({ existingRule, onClose, onSave }) => {
    const { saveRule, runRule, isLoading } = useRuleStore();
    const [name, setName] = useState(existingRule?.name || 'New Rule');
    const [trigger, setTrigger] = useState(existingRule?.trigger || 'manual');
    const [enabled, setEnabled] = useState(existingRule?.enabled ?? true);
    const [scheduleCron, setScheduleCron] = useState(existingRule?.schedule_cron || '');

    const [condition, setCondition] = useState<UiCondition>(() =>
        existingRule
            ? assignConditionIds(JSON.parse(existingRule.condition_json))
            : assignConditionIds({ type: 'And', value: [] })
    );

    const [action, setAction] = useState<Action>(
        existingRule ? JSON.parse(existingRule.action_json) : { type: 'Move', value: { destination: '' } }
    );

    const [testResult, setTestResult] = useState<any>(null);

    const handleSave = async () => {
        const ruleData = {
            id: existingRule?.id,
            name,
            trigger,
            enabled,
            schedule_cron: scheduleCron || null,
            condition_json: JSON.stringify(stripConditionIds(condition)),
            action_json: JSON.stringify(action)
        };
        await saveRule(ruleData);
        onSave();
    };

    const handleTestRun = async () => {
        if (!existingRule?.id) {
            // Need to save first? Or we can implement a backend endpoint to run transient rule.
            // For now, let's just save automatically or alert.
            // Better UX: Save temporarily or simulate.
            // But runRule takes ID. So we must save.
            // "Save & Test"
            alert("Please save the rule first before testing.");
            return;
        }
        try {
            const res = await runRule(existingRule.id, true);
            setTestResult(res);
        } catch (e) {
            console.error("Test failed", e);
            setTestResult({ error: String(e) });
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
            <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
                <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-800 rounded-t-lg">
                    <h2 className="text-lg font-semibold text-white">
                        {existingRule ? 'Edit Rule' : 'Create New Rule'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* General Settings */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Rule Name</label>
                            <input
                                type="text"
                                value={name} onChange={(e) => setName(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Trigger</label>
                            <select
                                value={trigger} onChange={(e) => setTrigger(e.target.value)}
                                className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
                            >
                                <option value="manual">Manual Run</option>
                                <option value="file_change">On File Change (Watcher)</option>
                                <option value="schedule">Scheduled</option>
                            </select>
                        </div>
                        {trigger === 'schedule' && (
                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Schedule (Cron)</label>
                                <input
                                    type="text"
                                    value={scheduleCron}
                                    onChange={(e) => setScheduleCron(e.target.value)}
                                    className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white"
                                    placeholder="0 0 * * * *"
                                />
                                <p className="text-xs text-gray-500 mt-1">Use cron format with seconds. Example: every day at 2am = 0 0 2 * * *</p>
                            </div>
                        )}
                        <div className="flex items-end pb-2">
                            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={(e) => setEnabled(e.target.checked)}
                                    className="w-4 h-4 rounded bg-gray-700 border-gray-600"
                                />
                                Rule Enabled
                            </label>
                        </div>
                    </div>

                    {/* Conditions */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-300 mb-2">Conditions</h3>
                        <div className="bg-gray-800/30 p-4 rounded border border-gray-700">
                            <ConditionBuilder
                                condition={condition}
                                onChange={setCondition}
                                onRemove={() => { }} // Can't remove root
                            />
                        </div>
                    </div>

                    {/* Actions */}
                    <div>
                        <h3 className="text-sm font-semibold text-gray-300 mb-2">Action</h3>
                        <div className="bg-gray-800/30 p-4 rounded border border-gray-700 flex flex-col gap-3">
                            <select
                                value={action.type}
                                onChange={(e) => setAction({ type: e.target.value as any, value: {} })}
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm w-full md:w-1/3 text-gray-200"
                            >
                                <option value="Move">Move to...</option>
                                <option value="Copy">Copy to...</option>
                                <option value="Archive">Archive (Zip)</option>
                                <option value="Rename">Rename</option>
                                <option value="Delete">Delete</option>
                                <option value="Trash">Move to Trash</option>
                                <option value="AddTag">Add Tag</option>
                            </select>

                            {(action.type === 'Move' || action.type === 'Copy' || action.type === 'Archive') && (
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Destination Path</label>
                                    <input
                                        type="text"
                                        value={action.value?.destination || ''}
                                        onChange={(e) => setAction({ ...action, value: { destination: e.target.value } })}
                                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200"
                                        placeholder={action.type === 'Archive' ? "/path/to/archive/ or /path/to/file.zip" : "/path/to/folder"}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Supports {'{YYYY}'}, {'{MM}'} etc.</p>
                                </div>
                            )}
                            {action.type === 'Rename' && (
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Rename Pattern</label>
                                    <input
                                        type="text"
                                        value={action.value?.pattern || ''}
                                        onChange={(e) => setAction({ ...action, value: { pattern: e.target.value } })}
                                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200"
                                        placeholder="Prefix_{name}"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Supports {'{name}'}, {'{ext}'}, {'{date}'}</p>
                                </div>
                            )}
                            {action.type === 'AddTag' && (
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Tag Name</label>
                                    <input
                                        type="text"
                                        value={action.value?.tag || ''}
                                        onChange={(e) => setAction({ ...action, value: { tag: e.target.value } })}
                                        className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200"
                                        placeholder="review-needed"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Test Result */}
                    {testResult && (
                        <div className={`p-4 rounded border ${testResult.error ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}>
                            {testResult.error ? (
                                <div className="flex items-center gap-2 text-red-400">
                                    <AlertTriangle size={16} />
                                    <span>Error: {testResult.error}</span>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2 text-green-400 font-medium">
                                        <CheckCircle size={16} />
                                        <span>Dry Run Complete</span>
                                    </div>
                                    <div className="text-sm text-gray-300 pl-6">
                                        <p>Files Matched: {testResult.files_matched}</p>
                                        <p>Files Processed (Simulated): {testResult.files_processed}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-700 bg-gray-800 rounded-b-lg flex justify-between">
                    <div className="flex gap-2">
                        {existingRule && (
                            <button
                                onClick={handleTestRun}
                                disabled={isLoading}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded flex items-center gap-2 disabled:opacity-50"
                            >
                                <Play size={16} /> Test Rule (Dry Run)
                            </button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:bg-gray-700 rounded">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={isLoading}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-2 disabled:opacity-50"
                        >
                            <Save size={16} /> Save Rule
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
