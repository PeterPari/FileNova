// Stage 10: Workspace & Tab Management
import { useState, useEffect } from 'react';
import { Plus, X, Folder, Save, MoreHorizontal, Pin, Copy as CopyIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface Tab {
    id: string;
    path: string;
    viewMode: 'grid' | 'list';
    isPinned: boolean;
}

interface Workspace {
    id: number;
    name: string;
    created_at: string;
}

interface WorkspaceConfig {
    id: number;
    name: string;
    tabs: Array<{ path: string; view_mode: string }>;
    preview_panel_open: boolean;
    active_tab_index: number;
}

interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabChange: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onTabAdd: () => void;
    onTabPin: (tabId: string) => void;
    onTabDuplicate: (tabId: string) => void;
}

export const TabBar = ({
    tabs,
    activeTabId,
    onTabChange,
    onTabClose,
    onTabAdd,
    onTabPin,
    onTabDuplicate
}: TabBarProps) => {
    const [showMenu, setShowMenu] = useState<string | null>(null);

    const getTabName = (path: string) => {
        if (!path) return 'Home';
        const parts = path.split(/[/\\]/);
        return parts[parts.length - 1] || 'Home';
    };

    return (
        <div className="bg-gray-100 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700 flex items-center gap-1 px-2 py-1 overflow-x-auto">
            {tabs.map((tab) => (
                <div
                    key={tab.id}
                    className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-t min-w-[120px] max-w-[200px] cursor-pointer ${
                        tab.id === activeTabId
                            ? 'bg-white dark:bg-gray-900 border-t-2 border-blue-500'
                            : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                    onClick={() => onTabChange(tab.id)}
                >
                    <Folder size={14} className="flex-shrink-0 text-blue-500" />
                    <span className="text-sm truncate flex-1">{getTabName(tab.path)}</span>
                    {tab.isPinned && <Pin size={12} className="text-gray-500 flex-shrink-0" />}
                    
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMenu(showMenu === tab.id ? null : tab.id);
                            }}
                            className="p-0.5 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
                        >
                            <MoreHorizontal size={14} />
                        </button>
                        {!tab.isPinned && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTabClose(tab.id);
                                }}
                                className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                                title="Close tab (Ctrl+W)"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {showMenu === tab.id && (
                        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-10 py-1 min-w-[150px]">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTabPin(tab.id);
                                    setShowMenu(null);
                                }}
                                className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                            >
                                <Pin size={14} />
                                {tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
                            </button>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTabDuplicate(tab.id);
                                    setShowMenu(null);
                                }}
                                className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                            >
                                <CopyIcon size={14} />
                                Duplicate Tab
                            </button>
                            {!tab.isPinned && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onTabClose(tab.id);
                                        setShowMenu(null);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-red-500"
                                >
                                    <X size={14} />
                                    Close Tab
                                </button>
                            )}
                        </div>
                    )}
                </div>
            ))}
            
            <button
                onClick={onTabAdd}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                title="New tab (Ctrl+T)"
            >
                <Plus size={16} />
            </button>
        </div>
    );
};

export const WorkspaceManager = () => {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [workspaceName, setWorkspaceName] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);

    useEffect(() => {
        loadWorkspaces();
    }, []);

    const loadWorkspaces = async () => {
        try {
            const result = await invoke<Workspace[]>('get_workspaces');
            setWorkspaces(result);
        } catch (error) {
            console.error('Failed to load workspaces:', error);
        }
    };

    const saveCurrentWorkspace = async () => {
        if (!workspaceName) return;

        try {
            // Get current tabs from localStorage or app state
            const tabs = JSON.parse(localStorage.getItem('openTabs') || '[]');
            const config = {
                tabs: tabs.map((tab: Tab) => ({
                    path: tab.path,
                    view_mode: tab.viewMode
                })),
                preview_panel_open: true,
                active_tab_index: 0
            };

            await invoke('save_workspace', {
                name: workspaceName,
                config: JSON.stringify(config)
            });

            setWorkspaceName('');
            setShowModal(false);
            loadWorkspaces();
        } catch (error) {
            console.error('Failed to save workspace:', error);
            alert('Failed to save workspace: ' + error);
        }
    };

    const loadWorkspace = async (id: number) => {
        try {
            const config = await invoke<WorkspaceConfig>('load_workspace', { id });
            
            // Restore tabs
            const tabs: Tab[] = config.tabs.map((tab, index) => ({
                id: `tab-${Date.now()}-${index}`,
                path: tab.path,
                viewMode: tab.view_mode as 'grid' | 'list',
                isPinned: false
            }));

            localStorage.setItem('openTabs', JSON.stringify(tabs));
            
            // Trigger app to reload tabs
            window.location.reload();
            
            setShowDropdown(false);
        } catch (error) {
            console.error('Failed to load workspace:', error);
            alert('Failed to load workspace: ' + error);
        }
    };

    return (
        <>
            <div className="relative">
                <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded flex items-center gap-2"
                    title="Workspaces"
                >
                    <Folder size={14} />
                    Workspaces
                </button>

                {showDropdown && (
                    <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-10 py-1 min-w-[200px]">
                        <button
                            onClick={() => {
                                setShowModal(true);
                                setShowDropdown(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                        >
                            <Save size={14} />
                            Save Current Workspace
                        </button>
                        
                        {workspaces.length > 0 && (
                            <>
                                <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                                <div className="px-3 py-1 text-xs text-gray-500 uppercase font-semibold">
                                    Load Workspace
                                </div>
                                {workspaces.map((workspace) => (
                                    <button
                                        key={workspace.id}
                                        onClick={() => loadWorkspace(workspace.id)}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                                    >
                                        <div className="font-medium">{workspace.name}</div>
                                        <div className="text-xs text-gray-500">
                                            {new Date(workspace.created_at).toLocaleDateString()}
                                        </div>
                                    </button>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Save Workspace Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl p-6 w-full max-w-md">
                        <h2 className="text-xl font-semibold mb-4">Save Workspace</h2>
                        <input
                            type="text"
                            value={workspaceName}
                            onChange={(e) => setWorkspaceName(e.target.value)}
                            placeholder="Workspace name"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-transparent mb-4"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => {
                                    setShowModal(false);
                                    setWorkspaceName('');
                                }}
                                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveCurrentWorkspace}
                                disabled={!workspaceName}
                                className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
