import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { FileEntry, useFileStore } from '../store/fileStore';
import { HardDrive, File } from 'lucide-react';
import { Treemap } from './Treemap';
import { getParentPath } from '../utils/path';

interface FileTypeStats {
    category: string;
    size: number;
    count: number;
}

interface StorageBreakdown {
    total_size: number;
    file_count: number;
    breakdown: FileTypeStats[];
}

interface DuplicateSummary {
    total_groups: number;
    total_wasted_bytes: number;
    exact_groups: number;
    perceptual_groups: number;
    smart_groups: number;
}

interface FolderSize {
    name: string;
    path: string;
    size: number;
    category: string;
}

// Updated Compass/FileNova Theme Colors
const COLORS = [
    '#0ea5e9', // Sky 500 (Primary)
    '#22c55e', // Green 500 (Secondary)
    '#6366f1', // Indigo 500
    '#f59e0b', // Amber 500
    '#ec4899', // Pink 500
    '#8b5cf6', // Violet 500
    '#14b8a6', // Teal 500
];

export const AnalyticsDashboard = () => {
    const { currentPath, setCurrentPath, setCurrentView } = useFileStore();
    const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
    const [duplicateSummary, setDuplicateSummary] = useState<DuplicateSummary | null>(null);
    const [largestFiles, setLargestFiles] = useState<FileEntry[]>([]);
    const [folderSizes, setFolderSizes] = useState<FolderSize[]>([]);
    const [tagStats, setTagStats] = useState<{ tag: string, count: number }[]>([]);
    const [treemapData, setTreemapData] = useState<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
    const [largestSort, setLargestSort] = useState<{ key: 'size' | 'path' | 'type' | 'name'; direction: 'asc' | 'desc' }>({
        key: 'size',
        direction: 'desc'
    });

    useEffect(() => {
        if (containerRef.current) {
            setDimensions({
                width: containerRef.current.clientWidth,
                height: 400
            });
        }
    }, [containerRef.current]);

    useEffect(() => {
        fetchData();
    }, [currentPath]);

    useEffect(() => {
        fetchGlobalData();
    }, []);

    // Prepare Treemap data when folderSizes change
    useEffect(() => {
        if (folderSizes.length > 0) {
            // Convert folderSizes to hierarchy
            // For now, just one level depth for simplicity, or we can fetch deeper.
            // Treemap expects { name: 'root', children: [...] }
            setTreemapData({
                name: 'root',
                children: folderSizes.map(f => ({ name: f.name, value: f.size, path: f.path, category: f.category }))
            });
        }
    }, [folderSizes]);

    const fetchGlobalData = async () => {
        try {
            const bd = await invoke<StorageBreakdown>('get_storage_breakdown');
            setBreakdown(bd);
            const dup = await invoke<DuplicateSummary>('get_duplicate_summary');
            setDuplicateSummary(dup);
            const lf = await invoke<FileEntry[]>('get_largest_files', { limit: 50 });
            setLargestFiles(lf);
            const ts = await invoke<{ tag: string, count: number }[]>('get_tag_stats');
            setTagStats(ts);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchData = async () => {
        try {
            if (currentPath) {
                const fs = await invoke<FolderSize[]>('get_folder_sizes', { path: currentPath });
                setFolderSizes(fs);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const totalSize = breakdown?.total_size ?? 0;
    const formatPercent = (size: number) => {
        if (!totalSize) return '0%';
        return `${((size / totalSize) * 100).toFixed(1)}%`;
    };

    const getFileTypeLabel = (name: string) => name.split('.').pop()?.toUpperCase() || 'FILE';

    const sortedLargestFiles = [...largestFiles].sort((a, b) => {
        let compare = 0;
        switch (largestSort.key) {
            case 'size':
                compare = a.size - b.size;
                break;
            case 'path':
                compare = a.path.localeCompare(b.path);
                break;
            case 'type':
                compare = getFileTypeLabel(a.name).localeCompare(getFileTypeLabel(b.name));
                break;
            case 'name':
            default:
                compare = a.name.localeCompare(b.name);
                break;
        }
        return largestSort.direction === 'asc' ? compare : -compare;
    });

    const handleSort = (key: 'size' | 'path' | 'type' | 'name') => {
        setLargestSort(prev => {
            if (prev.key === key) {
                return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
            }
            const defaultDir = key === 'size' ? 'desc' : 'asc';
            return { key, direction: defaultDir };
        });
    };

    const navigateToFile = async (path: string) => {
        const parent = getParentPath(path);
        setCurrentView('browser');
        if (parent !== null) {
            await setCurrentPath(parent);
        }
    };

    const drillDownToFolder = async (path: string) => {
        await setCurrentPath(path);
    };

    return (
        <div className="p-6 h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 pb-20">
            <h1 className="text-2xl font-bold mb-6 text-primary flex items-center gap-2">
                <HardDrive /> Storage Analytics
            </h1>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-surface p-6 rounded-xl shadow-sm border border-base">
                    <h3 className="text-sm font-medium text-secondary uppercase">Total Usage</h3>
                    <p className="text-3xl font-bold text-primary mt-2">
                        {breakdown ? formatSize(breakdown.total_size) : '...'}
                    </p>
                </div>
                <div className="bg-surface p-6 rounded-xl shadow-sm border border-base">
                    <h3 className="text-sm font-medium text-secondary uppercase">Total Files</h3>
                    <p className="text-3xl font-bold text-primary mt-2">
                        {breakdown ? breakdown.file_count.toLocaleString() : '...'}
                    </p>
                </div>
                <div className="bg-surface p-6 rounded-xl shadow-sm border border-base">
                    <h3 className="text-sm font-medium text-secondary uppercase">Largest File</h3>
                    <p className="text-lg font-medium text-primary mt-2 truncate">
                        {largestFiles.length > 0 ? largestFiles[0].name : '...'}
                    </p>
                    <p className="text-sm text-secondary">
                        {largestFiles.length > 0 ? formatSize(largestFiles[0].size) : ''}
                    </p>
                </div>
            </div>

            {/* Duplicates Summary */}
            {duplicateSummary && (
                <div className="bg-surface p-6 rounded-xl shadow-sm border border-base mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-medium text-secondary uppercase">Duplicates Found</h3>
                        <p className="text-2xl font-bold text-primary mt-2">
                            {duplicateSummary.total_groups} groups
                        </p>
                        <p className="text-sm text-secondary mt-1">
                            {formatSize(duplicateSummary.total_wasted_bytes)} wasted
                        </p>
                    </div>
                    <div className="text-sm text-secondary">
                        {duplicateSummary.exact_groups} exact &middot; {duplicateSummary.perceptual_groups} image &middot; {duplicateSummary.smart_groups} smart
                    </div>
                    <button
                        onClick={() => setCurrentView('duplicates')}
                        className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                        Review Duplicates
                    </button>
                </div>
            )}

            {/* Visualizations Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* File Type Distribution */}
                <div className="bg-surface p-6 rounded-xl shadow-sm border border-base">
                    <h3 className="text-lg font-semibold mb-4 text-primary">Storage by File Type</h3>
                    <div className="h-64">
                        {breakdown ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={breakdown.breakdown}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="size"
                                    >
                                        {breakdown.breakdown.map((_entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value: any) => {
                                            const size = Number(value) || 0;
                                            return `${formatSize(size)} (${formatPercent(size)})`;
                                        }}
                                    />
                                    <Legend
                                        formatter={(value: string, _entry: any, index: number) => {
                                            const size = breakdown?.breakdown[index]?.size ?? 0;
                                            return `${value} - ${formatPercent(size)} (${formatSize(size)})`;
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>}
                    </div>
                </div>
            </div>

            {/* Tag Cloud & Folder Sizes */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* Tag Cloud */}
                <div className="bg-surface p-6 rounded-xl shadow-sm border border-base">
                    <h3 className="text-lg font-semibold mb-4 text-primary">Tag Cloud</h3>
                    <div className="flex flex-wrap gap-2">
                        {tagStats.length > 0 ? (
                            tagStats.map((stat) => (
                                <span
                                    key={stat.tag}
                                    className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium"
                                    style={{ fontSize: `${Math.max(0.8, Math.min(2, 0.8 + (stat.count / 10)))}rem` }}
                                >
                                    {stat.tag} <span className="text-xs opacity-70">({stat.count})</span>
                                </span>
                            ))
                        ) : (
                            <div className="text-gray-400 w-full text-center h-40 flex items-center justify-center">No tags found</div>
                        )}
                    </div>
                </div>

                {/* Folder Sizes Bar Chart */}
                <div className="bg-surface p-6 rounded-xl shadow-sm border border-base">
                    <h3 className="text-lg font-semibold mb-4 text-primary">Folder Sizes (Current Dir)</h3>
                    <div className="h-64">
                        {folderSizes.length > 0 ? (
                            <div style={{ height: Math.max(240, folderSizes.length * 24) }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={folderSizes} layout="vertical">
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                                    <Tooltip formatter={(value: any) => formatSize(value)} labelStyle={{ color: '#6b7280' }} />
                                    <Bar dataKey="size" fill="#8884d8" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : <div className="flex items-center justify-center h-full text-gray-400">
                            {currentPath ? "No folders found" : "Select a folder to view sizes"}
                        </div>}
                    </div>
                </div>
            </div>

            {/* Treemap */}
            <div className="bg-surface p-6 rounded-xl shadow-sm border border-base mb-8" ref={containerRef}>
                <h3 className="text-lg font-semibold mb-4 text-primary">Directory Treemap</h3>
                <div className="w-full flex justify-center">
                    {treemapData && treemapData.children.length > 0 ? (
                        <Treemap
                            data={treemapData}
                            width={dimensions.width - 48}
                            height={400}
                            onNodeClick={(node) => {
                                if (node?.path) {
                                    drillDownToFolder(node.path);
                                }
                            }}
                        />
                    ) : (
                        <div className="h-[400px] flex items-center justify-center text-gray-400 w-full">
                            {currentPath ? "Not enough data for Treemap" : "Select a folder to view map"}
                        </div>
                    )}
                </div>
            </div>

            {/* Largest Files Table */}
            <div className="bg-surface rounded-xl shadow-sm border border-base overflow-hidden">
                <div className="p-6 border-b border-base">
                    <h3 className="text-lg font-semibold text-primary">Top 50 Largest Files</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-secondary dark:text-gray-400">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-700 dark:text-gray-300">
                            <tr>
                                <th className="px-6 py-3 cursor-pointer" onClick={() => handleSort('name')}>Name</th>
                                <th className="px-6 py-3 cursor-pointer" onClick={() => handleSort('path')}>Path</th>
                                <th className="px-6 py-3 cursor-pointer" onClick={() => handleSort('size')}>Size</th>
                                <th className="px-6 py-3 cursor-pointer" onClick={() => handleSort('type')}>Type</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {sortedLargestFiles.map((file) => (
                                <tr
                                    key={file.path}
                                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                                    onClick={() => navigateToFile(file.path)}
                                >
                                    <td className="px-6 py-4 font-medium text-primary flex items-center gap-2">
                                        <File size={16} className="text-gray-400" />
                                        <div className="truncate max-w-[200px]" title={file.name}>{file.name}</div>
                                    </td>
                                    <td className="px-6 py-4 truncate max-w-[300px]" title={file.path}>
                                        {file.path}
                                    </td>
                                    <td className="px-6 py-4 font-mono">
                                        {formatSize(file.size)}
                                    </td>
                                    <td className="px-6 py-4">
                                        {/* Simple type inference */}
                                        {getFileTypeLabel(file.name)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

