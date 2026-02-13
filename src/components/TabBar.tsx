import { X, Plus, Home, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { useFileStore } from '../store/fileStore';

const TAB_UNLOAD_THRESHOLD = 10;
const VISIBLE_WINDOW = 4; // tabs visible on each side of active

export const TabBar = () => {
    const { tabs, activeTabIndex, setActiveTab, closeTab, addTab } = useFileStore();

    // When >10 tabs, only render nearby tabs to reduce DOM
    const { visibleTabs, hiddenBefore, hiddenAfter } = useMemo(() => {
        if (tabs.length <= TAB_UNLOAD_THRESHOLD) {
            return { visibleTabs: tabs.map((t, i) => ({ tab: t, index: i })), hiddenBefore: 0, hiddenAfter: 0 };
        }

        const start = Math.max(0, activeTabIndex - VISIBLE_WINDOW);
        const end = Math.min(tabs.length, activeTabIndex + VISIBLE_WINDOW + 1);

        return {
            visibleTabs: tabs.slice(start, end).map((t, i) => ({ tab: t, index: start + i })),
            hiddenBefore: start,
            hiddenAfter: Math.max(0, tabs.length - end),
        };
    }, [tabs, activeTabIndex]);

    return (
        <div className="flex items-center bg-surface px-2 pt-1.5 gap-1 overflow-x-auto no-scrollbar">
            {hiddenBefore > 0 && (
                <button
                    onClick={() => setActiveTab(Math.max(0, activeTabIndex - VISIBLE_WINDOW))}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted hover:bg-surface-hover rounded-t-lg transition-theme"
                    title={`${hiddenBefore} more tab(s)`}
                >
                    <ChevronLeft size={12} />
                    <span>{hiddenBefore}</span>
                </button>
            )}

            {visibleTabs.map(({ tab, index }) => {
                const isActive = index === activeTabIndex;
                return (
                    <div
                        key={index}
                        onClick={() => setActiveTab(index)}
                        className={`
                            group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-sm cursor-pointer select-none min-w-[120px] max-w-[200px] border-t border-x transition-theme
                            ${isActive
                                ? 'bg-base border-base text-accent-primary font-medium z-10 -mb-px pb-2'
                                : 'bg-surface-hover border-transparent text-secondary hover:bg-surface-active'
                            }
                        `}
                    >
                        {tab.path === '' ? <Home size={14} /> : null}
                        <span className="truncate flex-1" title={tab.path || 'Home'}>
                            {tab.label}
                        </span>

                        {(tabs.length > 1 || tab.path !== '') && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(index);
                                }}
                                className={`p-0.5 rounded-full hover:bg-surface-active text-muted transition-theme opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''}`}
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                );
            })}

            {hiddenAfter > 0 && (
                <button
                    onClick={() => setActiveTab(Math.min(tabs.length - 1, activeTabIndex + VISIBLE_WINDOW))}
                    className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted hover:bg-surface-hover rounded-t-lg transition-theme"
                    title={`${hiddenAfter} more tab(s)`}
                >
                    <span>{hiddenAfter}</span>
                    <ChevronRight size={12} />
                </button>
            )}

            <button
                onClick={() => addTab('')}
                className="p-1.5 text-muted hover:text-primary hover:bg-surface-hover rounded-md ml-1 transition-theme"
            >
                <Plus size={16} />
            </button>
        </div>
    );
};
