import { X, Plus, Home } from 'lucide-react';
import { useFileStore } from '../store/fileStore';

export const TabBar = () => {
    const { tabs, activeTabIndex, setActiveTab, closeTab, addTab } = useFileStore();

    return (
        <div className="flex items-center bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 pt-2 gap-1 overflow-x-auto no-scrollbar">
            {tabs.map((tab, index) => {
                const isActive = index === activeTabIndex;
                return (
                    <div
                        key={index}
                        onClick={() => setActiveTab(index)}
                        className={`
                            group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-sm cursor-pointer select-none min-w-[120px] max-w-[200px] border-t border-x
                            ${isActive
                                ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 font-medium z-10 -mb-[1px] pb-2'
                                : 'bg-gray-200 dark:bg-gray-800 border-transparent text-gray-500 hover:bg-gray-300 dark:hover:bg-gray-700'
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
                                className={`p-0.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 opacity-0 group-hover:opacity-100 ${isActive ? 'opacity-100' : ''}`}
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                );
            })}

            <button
                onClick={() => addTab('')}
                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md ml-1"
            >
                <Plus size={16} />
            </button>
        </div>
    );
};
