import React, { useEffect } from 'react';
import { useFileStore } from '../store/fileStore';

export const ActivityFeed: React.FC = () => {
    const { activityFeed, loadActivityFeed } = useFileStore();

    useEffect(() => {
        loadActivityFeed();
        // Set up interval to refresh activity feed? 
        // Or listen to 'activity' event? 
        // For now, load once on mount. Refresh button could be added.
        const interval = setInterval(() => loadActivityFeed(), 5000);
        return () => clearInterval(interval);
    }, []);

    const getIcon = (action: string) => {
        if (action.includes('Create')) return '➕';
        if (action.includes('Modify')) return '✏️';
        if (action.includes('Remove')) return '🗑️';
        return '📝';
    };

    const getColor = (action: string) => {
        if (action.includes('Create')) return 'text-green-400';
        if (action.includes('Modify')) return 'text-blue-400';
        if (action.includes('Remove')) return 'text-red-400';
        return 'text-gray-400';
    };

    return (
        <div className="h-full overflow-y-auto p-6 text-white custom-scrollbar">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <span className="text-3xl">📊</span> Activity Feed
            </h2>

            <div className="space-y-4">
                {activityFeed.length === 0 ? (
                    <div className="text-center text-gray-500 py-10">No recent activity detected.</div>
                ) : (
                    activityFeed.map((activity) => (
                        <div key={activity.id} className="bg-gray-800 p-4 rounded-lg flex items-center gap-4 hover:bg-gray-750 transition-colors border border-gray-700">
                            <span className="text-2xl">{getIcon(activity.action)}</span>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <span className={`font-medium ${getColor(activity.action)}`}>
                                        {activity.action}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {new Date(activity.detected_at).toLocaleString()}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-300 break-all">
                                    {activity.file_path}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
