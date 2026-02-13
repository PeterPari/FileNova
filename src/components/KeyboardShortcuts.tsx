// Stage 10: Keyboard Shortcuts System
import { useState, useEffect } from 'react';
import { X, Edit2, Save, RotateCcw } from 'lucide-react';

interface KeyboardShortcut {
    id: string;
    action: string;
    description: string;
    category: 'Navigation' | 'Search' | 'Views' | 'Preview' | 'Tabs' | 'Selection' | 'File Operations';
    keys: string[];
    editable: boolean;
}

interface KeyboardShortcutsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const defaultShortcuts: KeyboardShortcut[] = [
    // Navigation
    { id: 'nav-up', action: 'Navigate Up', description: 'Go to parent directory', category: 'Navigation', keys: ['Backspace'], editable: false },
    { id: 'nav-enter', action: 'Open/Enter', description: 'Open selected file or folder', category: 'Navigation', keys: ['Enter'], editable: false },
    { id: 'nav-arrows', action: 'Navigate', description: 'Move selection', category: 'Navigation', keys: ['↑', '↓', '←', '→'], editable: false },

    // Search
    { id: 'search-focus', action: 'Focus Search', description: 'Focus the search input', category: 'Search', keys: ['Ctrl', 'F'], editable: true },
    { id: 'command-palette', action: 'Command Palette', description: 'Open command palette', category: 'Search', keys: ['Ctrl', 'K'], editable: true },

    // Views
    { id: 'view-grid', action: 'Grid View', description: 'Switch to grid view', category: 'Views', keys: ['Ctrl', '1'], editable: true },
    { id: 'view-list', action: 'List View', description: 'Switch to list view', category: 'Views', keys: ['Ctrl', '2'], editable: true },

    // Preview
    { id: 'preview-toggle', action: 'Toggle Preview Panel', description: 'Show/hide preview panel', category: 'Preview', keys: ['Ctrl', 'P'], editable: true },
    { id: 'quick-look', action: 'Quick Look', description: 'Open quick look modal', category: 'Preview', keys: ['Space'], editable: false },

    // Tabs
    { id: 'tab-new', action: 'New Tab', description: 'Open new tab', category: 'Tabs', keys: ['Ctrl', 'T'], editable: true },
    { id: 'tab-close', action: 'Close Tab', description: 'Close current tab', category: 'Tabs', keys: ['Ctrl', 'W'], editable: true },
    { id: 'tab-next', action: 'Next Tab', description: 'Switch to next tab', category: 'Tabs', keys: ['Ctrl', 'Tab'], editable: true },

    // Selection
    { id: 'select-all', action: 'Select All', description: 'Select all files', category: 'Selection', keys: ['Ctrl', 'A'], editable: false },
    { id: 'select-multi', action: 'Multi Select', description: 'Add to selection', category: 'Selection', keys: ['Ctrl', 'Click'], editable: false },
    { id: 'select-range', action: 'Range Select', description: 'Select range', category: 'Selection', keys: ['Shift', 'Click'], editable: false },

    // File Operations
    { id: 'file-delete', action: 'Delete', description: 'Move to trash', category: 'File Operations', keys: ['Delete'], editable: false },
    { id: 'file-rename', action: 'Rename', description: 'Rename file', category: 'File Operations', keys: ['F2'], editable: true },
    { id: 'file-copy', action: 'Copy', description: 'Copy file', category: 'File Operations', keys: ['Ctrl', 'C'], editable: false },
    { id: 'file-paste', action: 'Paste', description: 'Paste file', category: 'File Operations', keys: ['Ctrl', 'V'], editable: false },
];

export const KeyboardShortcutsModal = ({ isOpen, onClose }: KeyboardShortcutsModalProps) => {
    const [shortcuts, setShortcuts] = useState<KeyboardShortcut[]>(defaultShortcuts);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingKeys, setEditingKeys] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('All');

    /**
     * Load persisted shortcuts once on mount and persist whenever `shortcuts` changes.
     */
    useEffect(() => {
        const saved = localStorage.getItem('keyboardShortcuts');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setShortcuts(parsed);
            } catch (error) {
                console.error('Failed to load shortcuts:', error);
            }
        }
    }, []);

    useEffect(() => {
        // Persist normalized shortcuts whenever they change
        try {
            localStorage.setItem('keyboardShortcuts', JSON.stringify(shortcuts));
        } catch (e) {
            console.error('Failed to persist shortcuts:', e);
        }
    }, [shortcuts]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === '?') {
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const normalizeKeys = (keys: string[]) => {
        return keys
            .map(k => k.trim().toLowerCase())
            .filter(Boolean)
            .join('+');
    };

    const resetToDefaults = () => {
        if (confirm('Reset all shortcuts to defaults?')) {
            setShortcuts(defaultShortcuts);
            localStorage.removeItem('keyboardShortcuts');
        }
    };

    const startEditing = (shortcut: KeyboardShortcut) => {
        setEditingId(shortcut.id);
        setEditingKeys(shortcut.keys);
    };

    const saveEdit = () => {
        if (!editingId) return;

        // Check for conflicts using normalized canonical string
        const newKeySig = normalizeKeys(editingKeys);
        const conflict = shortcuts.find(
            s => s.id !== editingId && normalizeKeys(s.keys) === newKeySig
        );

        if (conflict) {
            alert(`Conflict: This shortcut is already used for "${conflict.action}"`);
            return;
        }

        setShortcuts(prev =>
            prev.map(s => (s.id === editingId ? { ...s, keys: editingKeys } : s))
        );
        setEditingId(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditingKeys([]);
    };

    const categories = ['All', ...Array.from(new Set(shortcuts.map(s => s.category)))];
    const filteredShortcuts = selectedCategory === 'All'
        ? shortcuts
        : shortcuts.filter(s => s.category === selectedCategory);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-base rounded-lg shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-base">
                    <div>
                        <h2 className="text-2xl font-semibold">Keyboard Shortcuts</h2>
                        <p className="text-sm text-muted mt-1">
                            Customize keyboard shortcuts for FileNova
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={resetToDefaults}
                            className="px-3 py-1.5 text-sm bg-surface-hover hover:bg-surface-active rounded flex items-center gap-2"
                        >
                            <RotateCcw size={14} />
                            Reset
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-surface-hover rounded"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Category Tabs */}
                <div className="flex gap-2 px-6 py-3 border-b border-base overflow-x-auto">
                    {categories.map((category) => (
                        <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={`px-3 py-1 text-sm rounded transition-colors whitespace-nowrap ${
                                selectedCategory === category
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-surface-hover hover:bg-surface-active'
                            }`}
                        >
                            {category}
                        </button>
                    ))}
                </div>

                {/* Shortcuts List */}
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-2">
                        {filteredShortcuts.map((shortcut) => (
                            <div
                                key={shortcut.id}
                                className="flex items-center justify-between p-3 bg-surface rounded hover:bg-surface-hover"
                            >
                                <div className="flex-1">
                                    <div className="font-medium">{shortcut.action}</div>
                                    <div className="text-sm text-muted">{shortcut.description}</div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {editingId === shortcut.id ? (
                                        <>
                                            <div className="flex gap-1">
                                                {editingKeys.map((key, index) => (
                                                    <kbd
                                                        key={index}
                                                        className="px-2 py-1 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded font-mono"
                                                    >
                                                        {key}
                                                    </kbd>
                                                ))}
                                            </div>
                                            <button
                                                onClick={saveEdit}
                                                className="p-1.5 text-green-500 hover:bg-green-100 dark:hover:bg-green-900 rounded"
                                                title="Save"
                                            >
                                                <Save size={16} />
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                                                title="Cancel"
                                            >
                                                <X size={16} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex gap-1">
                                                {shortcut.keys.map((key, index) => (
                                                    <kbd
                                                        key={index}
                                                        className="px-2 py-1 text-sm bg-gray-200 dark:bg-gray-700 rounded font-mono"
                                                    >
                                                        {key}
                                                    </kbd>
                                                ))}
                                            </div>
                                            {shortcut.editable && (
                                                <button
                                                    onClick={() => startEditing(shortcut)}
                                                    className="p-1.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                                                    title="Edit shortcut"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500">
                    Press <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs">?</kbd> anytime to view shortcuts
                </div>
            </div>
        </div>
    );
};

// Keyboard Shortcuts Cheat Sheet (Quick View)
interface ShortcutsCheatSheetProps {
    isOpen: boolean;
    onClose: () => void;
}

export const ShortcutsCheatSheet = ({ isOpen, onClose }: ShortcutsCheatSheetProps) => {
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === '?') {
                e.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const quickShortcuts = [
        { keys: ['Ctrl', 'K'], action: 'Command Palette' },
        { keys: ['Ctrl', 'P'], action: 'Toggle Preview' },
        { keys: ['Space'], action: 'Quick Look' },
        { keys: ['Ctrl', 'F'], action: 'Search' },
        { keys: ['Ctrl', 'T'], action: 'New Tab' },
        { keys: ['Ctrl', 'W'], action: 'Close Tab' },
        { keys: ['F2'], action: 'Rename' },
        { keys: ['Delete'], action: 'Delete' },
        { keys: ['?'], action: 'Show Shortcuts' },
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl p-6 max-w-md"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Quick Shortcuts</h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-2">
                    {quickShortcuts.map((shortcut, index) => (
                        <div key={index} className="flex items-center justify-between py-2">
                            <span className="text-sm">{shortcut.action}</span>
                            <div className="flex gap-1">
                                {shortcut.keys.map((key, keyIndex) => (
                                    <kbd
                                        key={keyIndex}
                                        className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded font-mono"
                                    >
                                        {key}
                                    </kbd>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500">
                    Press <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs">Ctrl+K</kbd>
                    {' '}for full command palette
                </div>
            </div>
        </div>
    );
};
