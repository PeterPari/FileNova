import React, { useEffect, useState, useCallback } from 'react';
import { useFileStore, ActivityFilters } from '../store/fileStore';
import { Clock, Filter, RefreshCw, Folder, File, Plus, Edit2, Trash2, AlertTriangle } from 'lucide-react';

export const ActivityFeed: React.FC = () => {
    const { activityFeed, loadActivityFeed } = useFileStore();
    const [filters, setFilters] = useState<ActivityFilters>({
        limit: 50,
        time_range: 'all',
        action_type: [],
        folder: '',
        file_type: []
    });
    const [isAutoRefresh, setIsAutoRefresh] = useState(true);

    const fetchActivity = useCallback(() => {
        // Convert 'all' to undefined for backend
        const apiFilters = {
            ...filters,
            time_range: filters.time_range === 'all' ? undefined : filters.time_range
        };
        loadActivityFeed(apiFilters);
    }, [filters, loadActivityFeed]);

    useEffect(() => {
        fetchActivity();
    }, [fetchActivity]);

    useEffect(() => {
        if (!isAutoRefresh) return;
        const interval = setInterval(fetchActivity, 5000);
        return () => clearInterval(interval);
    }, [isAutoRefresh, fetchActivity]);

    const handleActionToggle = (action: string) => {
        const current = filters.action_type || [];
        const updated = current.includes(action)
            ? current.filter(a => a !== action)
            : [...current, action];
        setFilters({ ...filters, action_type: updated });
    };

    const getIcon = (action: string) => {
        if (action.includes('Create')) return <Plus className="text-green-500" size={18} />;
        if (action.includes('Modify')) return <Edit2 className="text-blue-500" size={18} />;
        if (action.includes('Remove') || action.includes('Delete')) return <Trash2 className="text-red-500" size={18} />;
        if (action.includes('Rename')) return <Folder className="text-orange-500" size={18} />;
        return <AlertTriangle className="text-yellow-500" size={18} />;
    };

    const getActionLabel = (action: string) => {
        // Clean up "kind(Modify(Name))" etc
        if (action.includes('Create')) return 'Created';
        if (action.includes('Modify')) return 'Modified';
        if (action.includes('Remove') || action.includes('Delete')) return 'Deleted';
        if (action.includes('Rename')) return 'Moved';
        return action;
    };

    const getActionColor = (action: string) => {
        if (action.includes('Create')) return 'text-green-400';
        if (action.includes('Modify')) return 'text-blue-400';
        if (action.includes('Remove') || action.includes('Delete')) return 'text-red-400';
        if (action.includes('Rename')) return 'text-orange-400';
        return 'text-yellow-400';
    };

    const grouped = activityFeed.reduce<Record<string, typeof activityFeed>>((acc, item) => {
        const day = new Date(item.detected_at).toDateString();
        if (!acc[day]) acc[day] = [];
        acc[day].push(item);
        return acc;
    }, {});

    return (
        <div className="h-full flex flex-col bg-gray-900 text-white">
            <div className="p-6 border-b border-gray-800">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold flex items-center gap-3">
                        <Clock className="text-purple-400" /> Activity Feed
                    </h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                            className={`p-2 rounded-lg transition-colors ${isAutoRefresh ? 'bg-purple-900/50 text-purple-300' : 'bg-gray-800 text-gray-500'}`}
                            title="Auto Refresh"
                        >
                            <RefreshCw size={18} className={isAutoRefresh ? "animate-spin-slow" : ""} />
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-col gap-4 bg-gray-800/50 p-4 rounded-xl border border-gray-700/50">
                    <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
                        <Filter size={14} /> <span>Filters</span>
                    </div>

                    <div className="flex flex-wrap gap-4">
                        {/* Time Range */}
                        <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-1 border border-gray-700">
                            {['all', 'today', 'week', 'month'].map(range => (
                                <button
                                    key={range}
                                    onClick={() => setFilters({ ...filters, time_range: range })}
                                    className={`px-3 py-1.5 rounded-md text-sm capitalize transition-colors ${filters.time_range === range
                                            ? 'bg-purple-600 text-white shadow-lg'
                                            : 'text-gray-400 hover:text-white hover:bg-gray-800'
                                        }`}
                                >
                                    {range}
                                </button>
                            ))}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2">
                            {['Create', 'Modify', 'Delete', 'Rename'].map(action => {
                                const isActive = filters.action_type?.includes(action);
                                return (
                                    <button
                                        key={action}
                                        onClick={() => handleActionToggle(action)}
                                        className={`px-3 py-1.5 rounded-lg text-sm border transition-all flex items-center gap-2 ${isActive
                                                ? 'bg-blue-900/30 border-blue-500/50 text-blue-300'
                                                : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500'
                                            }`}
                                    >
                                        {action === 'Create' && <Plus size={14} />}
                                        {action === 'Modify' && <Edit2 size={14} />}
                                        {action === 'Delete' && <Trash2 size={14} />}
                                        {action === 'Rename' && <Folder size={14} />}
                                        {action}
                                    </button>
                                );
                            })}
                        </div>
                        {/* Folder */}
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={filters.folder || ''}
                                onChange={(e) => setFilters({ ...filters, folder: e.target.value })}
                                placeholder="Folder path filter"
                                className="px-3 py-1.5 rounded-lg text-sm bg-gray-900 border border-gray-700 text-gray-300 w-56"
                            />
                        </div>
                        {/* File Type */}
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={(filters.file_type || []).join(', ')}
                                onChange={(e) =>
                                    setFilters({
                                        ...filters,
                                        file_type: e.target.value
                                            .split(',')
                                            .map((t) => t.trim().toLowerCase())
                                            .filter(Boolean)
                                    })
                                }
                                placeholder="File types (e.g. pdf, jpg)"
                                className="px-3 py-1.5 rounded-lg text-sm bg-gray-900 border border-gray-700 text-gray-300 w-52"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                <div className="space-y-6">
                    {activityFeed.length === 0 ? (
                        <div className="text-center text-gray-500 py-20 flex flex-col items-center gap-4">
                            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center">
                                <Clock size={32} className="text-gray-600" />
                            </div>
                            <p>No activity found for current filters.</p>
                        </div>
                    ) : (
                        Object.entries(grouped).map(([day, items]) => (
                            <div key={day}>
                                <div className="text-xs uppercase tracking-wider text-gray-400 mb-2">{day}</div>
                                <div className="space-y-3">
                                    {items.map((activity) => (
                                        <div key={activity.id} className="group bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-gray-600 p-4 rounded-xl transition-all flex items-start gap-4">
                                            <div className="p-2 rounded-lg bg-gray-900 border border-gray-700 group-hover:border-gray-600 transition-colors">
                                                {getIcon(activity.action)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <span className={`font-semibold ${getActionColor(activity.action)}`}>
                                                        {getActionLabel(activity.action)}
                                                    </span>
                                                    <span className="text-xs text-gray-500 font-mono bg-gray-900 px-2 py-1 rounded">
                                                        {new Date(activity.detected_at).toLocaleTimeString()}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-purple-300 mt-1 font-mono break-all hover:text-purple-200 cursor-pointer transition-colors" title={activity.file_path}>
                                                    {activity.file_path}
                                                </div>
                                                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                                                    <span className="flex items-center gap-1">
                                                        <Folder size={12} />
                                                        {activity.file_path.split(/[/\\]/).slice(0, -1).pop() || 'Root'}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <File size={12} />
                                                        {activity.file_path.split('.').pop()?.toUpperCase() || 'FILE'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};
