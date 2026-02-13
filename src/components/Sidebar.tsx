import { 
    HardDrive, Folder, Settings, BarChart2, Copy, Activity, Cog, Trash2, 
    MessageSquare, Boxes, PanelLeft
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useFileStore } from '../store/fileStore';
import { useState } from 'react';
import { FileNovaLogo } from './FileNovaLogo';

interface SidebarProps {
    onOpenSettings: () => void;
}

export const Sidebar = ({ onOpenSettings }: SidebarProps) => {
    const { setCurrentView, currentView } = useFileStore();
    const [collapsed, setCollapsed] = useState(false);

    const toggleCollapse = () => setCollapsed(!collapsed);

    const navItems = [
        { id: 'browser', label: 'My Files', icon: HardDrive, action: () => setCurrentView('browser'), activeFor: ['browser'] },
        { id: 'documents', label: 'Documents', icon: Folder, action: () => setCurrentView('browser'), activeFor: ['browser'] },
    ];

    const toolsItems = [
        { id: 'dashboard', label: 'Dashboard', icon: BarChart2, action: () => setCurrentView('dashboard') },
        { id: 'duplicates', label: 'Duplicates', icon: Copy, action: () => setCurrentView('duplicates') },
        { id: 'organize', label: 'Organize', icon: Boxes, action: () => setCurrentView('organize') },
        { id: 'rules', label: 'Rules', icon: Cog, action: () => setCurrentView('rules') },
        { id: 'activity', label: 'Activity', icon: Activity, action: () => setCurrentView('activity') },
    ];

    const assistantItems = [
        { id: 'chat', label: 'Assistant', icon: MessageSquare, action: () => setCurrentView('chat') },
    ];

    type NavItemProps = { item: { id: string; label: string; icon: LucideIcon; action: () => void; activeFor?: string[] }; isActive: boolean };

    const classNames = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

    const NavItem = ({ item, isActive }: NavItemProps) => (
        <button
            onClick={item.action}
            title={collapsed ? item.label : ''}
            className={classNames(
                'flex items-center w-full p-2 mb-1 rounded-md transition-all duration-200',
                isActive
                    ? 'bg-surface-active text-primary font-medium border-l-2 border-accent-primary'
                    : 'text-secondary hover:bg-surface-hover hover:text-primary border-l-2 border-transparent',
                collapsed ? 'justify-center px-0 border-l-0' : 'px-3 gap-3'
            )}
        >
            <item.icon size={20} className={isActive ? 'text-accent-primary' : ''} />
            {!collapsed && <span>{item.label}</span>}
        </button>
    );

    return (
        <aside 
            className={`
                flex flex-col h-full bg-surface border-r border-base transition-all duration-300 ease-elastic
                ${collapsed ? 'w-16' : 'w-64'}
            `}
        >
            {/* Header / Logo */}
            <div className={`flex items-center h-16 border-b border-base px-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
                {!collapsed ? (
                    <FileNovaLogo withText={true} />
                ) : (
                   <FileNovaLogo withText={false} className="w-8 h-8" />
                )}
                
                {!collapsed && (
                    <button 
                        onClick={toggleCollapse}
                        className="p-1.5 rounded-md hover:bg-surface-hover text-secondary transition-colors"
                    >
                        <PanelLeft size={18} />
                    </button>
                )}
            </div>
            
            {collapsed && (
                <div className="flex justify-center py-2 border-b border-base">
                     <button 
                        onClick={toggleCollapse}
                        className="p-1.5 rounded-md hover:bg-surface-hover text-secondary transition-colors"
                    >
                        <PanelLeft size={18} />
                    </button>
                </div>
            )}

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar space-y-8">
                
                {/* Main Navigation */}
                <div>
                    {!collapsed && <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 px-3">Drives</h3>}
                    <ul className="space-y-0.5">
                        {navItems.map(item => (
                            <li key={item.id}>
                                <NavItem item={item} isActive={item.activeFor ? item.activeFor.includes(currentView) : currentView === item.id} />
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Tools */}
                <div>
                    {!collapsed && <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 px-3">Tools</h3>}
                    <ul className="space-y-0.5">
                        {toolsItems.map(item => (
                            <li key={item.id}>
                                <NavItem item={item} isActive={currentView === item.id} />
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Assistant */}
                <div>
                    {!collapsed && <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3 px-3">AI Engine</h3>}
                    <ul className="space-y-0.5">
                        {assistantItems.map(item => (
                            <li key={item.id}>
                                <NavItem item={item} isActive={currentView === item.id} />
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Footer / Settings */}
            <div className="p-3 border-t border-base" style={{ backgroundColor: 'color-mix(in srgb, var(--bg-hover) 30%, transparent)' }}>
                <button
                    onClick={() => setCurrentView('trash')}
                    className={`
                        flex items-center w-full p-2 mb-1 rounded-md transition-all duration-200
                        ${currentView === 'trash'
                            ? 'text-status-error font-medium'
                            : 'text-secondary hover:bg-surface-hover hover:text-status-error'}
                        ${collapsed ? 'justify-center' : 'px-3 gap-3'}
                    `}
                    style={currentView === 'trash' ? { backgroundColor: 'color-mix(in srgb, var(--status-error) 12%, transparent)' } : undefined}
                    title={collapsed ? "Trash" : ""}
                >
                    <Trash2 size={20} />
                    {!collapsed && <span>Trash</span>}
                </button>
                <button
                    onClick={onOpenSettings}
                    className={`
                        flex items-center w-full p-2 rounded-md transition-all duration-200
                        text-secondary hover:bg-surface-hover hover:text-primary
                        ${collapsed ? 'justify-center' : 'px-3 gap-3'}
                    `}
                    title={collapsed ? "Settings" : ""}
                >
                    <Settings size={20} />
                    {!collapsed && <span>Settings</span>}
                </button>
            </div>
        </aside>
    );
};

