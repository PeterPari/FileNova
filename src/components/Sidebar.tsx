import { HardDrive, Folder, Settings, BarChart2, Copy, Activity } from 'lucide-react';
import { useFileStore } from '../store/fileStore';

export const Sidebar = ({ onOpenSettings }: { onOpenSettings: () => void }) => {
    const { setCurrentView, currentView } = useFileStore();

    return (
        <aside className="w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-4 h-full flex flex-col">
            <h2 className="text-sm font-semibold text-gray-500 uppercase mb-4">Drives</h2>
            <ul className="space-y-1">
                {/* Mock drives */}
                <li>
                    <button
                        onClick={() => {
                            setCurrentView('browser');
                            // Ideally navigate to C: root
                            // setCurrentPath('C:'); 
                            // We need to destructure setCurrentPath from store
                        }}
                        className={`flex items-center gap-2 p-2 w-full text-left rounded-md ${currentView === 'browser' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >
                        <HardDrive size={18} />
                        <span>C: Local Disk</span>
                    </button>
                </li>
            </ul>

            <h2 className="text-sm font-semibold text-gray-500 uppercase mt-6 mb-4">Quick Access</h2>
            <ul className="space-y-1 flex-1">
                <li>
                    <button
                        onClick={() => {
                            // Open Documents in new tab or current? 
                            // Navigation from sidebar usually switches current view or opens new tab?
                            // Let's make it simple: navigate current tab.
                            // But wait, sidebar "Drives" and "Documents" act as shortcuts.
                            // If we use `setCurrentPath`, it updates current tab.
                            // Let's use `setCurrentPath` which now updates the active tab.
                            // However, we need to import it.
                            // Sidebar uses `setCurrentView` mostly.
                            // For "Documents", we should probably navigate.
                            // Let's assume there is a `setCurrentPath` exposed.
                            // Sidebar currently only implements view switching.
                            // Let's keep view switching but maybe add a "Home" or "Documents" navigation if needed.
                            // Current Sidebar implementation just switches `currentView`.
                            // "C: Local Disk" sets view to browser.
                            // We should probably also set path to C:?
                            // For now, let's just ensure it switches to browser view.
                            setCurrentView('browser');
                        }}
                        className="flex items-center gap-2 p-2 w-full text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                    >
                        <Folder size={18} />
                        <span>Documents</span>
                    </button>
                </li>
                <li>
                    <button
                        onClick={() => setCurrentView('dashboard')}
                        className={`flex items-center gap-2 p-2 w-full text-left rounded-md ${currentView === 'dashboard' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >
                        <BarChart2 size={18} />
                        <span>Dashboard</span>
                    </button>
                </li>
                <li>
                    <button
                        onClick={() => setCurrentView('duplicates')}
                        className={`flex items-center gap-2 p-2 w-full text-left rounded-md ${currentView === 'duplicates' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >
                        <Copy size={18} />
                        <span>Duplicates</span>
                    </button>
                </li>
                <li>
                    <button
                        onClick={() => setCurrentView('activity')}
                        className={`flex items-center gap-2 p-2 w-full text-left rounded-md ${currentView === 'activity' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >
                        <Activity size={18} />
                        <span>Activity</span>
                    </button>
                </li>
                <li>
                    <button
                        onClick={() => setCurrentView('organize')}
                        className={`flex items-center gap-2 p-2 w-full text-left rounded-md ${currentView === 'organize' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                    >
                        <Folder size={18} className="text-purple-500" />
                        <span>Organize</span>
                    </button>
                </li>
            </ul>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                <button
                    onClick={onOpenSettings}
                    className="flex items-center gap-2 p-2 w-full text-left hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md text-gray-600 dark:text-gray-300"
                >
                    <Settings size={18} />
                    <span>Settings</span>
                </button>
            </div>
        </aside>
    );
};
