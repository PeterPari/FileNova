import { useEffect, useState, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { FileEntry, useFileStore } from '../store/fileStore';
import { HardDrive, File } from 'lucide-react';
import { Treemap } from './Treemap';

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

interface FolderSize {
    name: string;
    path: string;
    size: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'];

export const AnalyticsDashboard = () => {
    const { currentPath } = useFileStore();
    const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
    const [largestFiles, setLargestFiles] = useState<FileEntry[]>([]);
    const [folderSizes, setFolderSizes] = useState<FolderSize[]>([]);
    const [tagStats, setTagStats] = useState<{ tag: string, count: number }[]>([]);
    const [treemapData, setTreemapData] = useState<any>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

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
                children: folderSizes.map(f => ({ name: f.name, value: f.size }))
            });
        }
    }, [folderSizes]);

    const fetchGlobalData = async () => {
        try {
            const bd = await invoke<StorageBreakdown>('get_storage_breakdown');
            setBreakdown(bd);
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

    return (
        <div className="p-6 h-full overflow-y-auto bg-gray-50 dark:bg-gray-900 pb-20">
            <h1 className="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <HardDrive /> Storage Analytics
            </h1>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-500 uppercase">Total Usage</h3>
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-2">
                        {breakdown ? formatSize(breakdown.total_size) : '...'}
                    </p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-500 uppercase">Total Files</h3>
                    <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-2">
                        {breakdown ? breakdown.file_count.toLocaleString() : '...'}
                    </p>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <h3 className="text-sm font-medium text-gray-500 uppercase">Largest File</h3>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100 mt-2 truncate">
                        {largestFiles.length > 0 ? largestFiles[0].name : '...'}
                    </p>
                    <p className="text-sm text-gray-500">
                        {largestFiles.length > 0 ? formatSize(largestFiles[0].size) : ''}
                    </p>
                </div>
            </div>

            {/* Visualizations Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* File Type Distribution */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-100">Storage by File Type</h3>
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
                                    <Tooltip formatter={(value: any) => formatSize(value)} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>}
                    </div>
                </div>
            </div>

            {/* Tag Cloud & Folder Sizes */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                {/* Tag Cloud */}
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-100">Tag Cloud</h3>
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
                <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-100">Folder Sizes (Current Dir)</h3>
                    <div className="h-64">
                        {folderSizes.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={folderSizes.slice(0, 10)} layout="vertical">
                                    <XAxis type="number" hide />
                                    <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                                    <Tooltip formatter={(value: any) => formatSize(value)} labelStyle={{ color: '#6b7280' }} />
                                    <Bar dataKey="size" fill="#8884d8" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : <div className="flex items-center justify-center h-full text-gray-400">
                            {currentPath ? "No folders found" : "Select a folder to view sizes"}
                        </div>}
                    </div>
                </div>
            </div>

            {/* Treemap */}
            <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-8" ref={containerRef}>
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-100">Directory Treemap</h3>
                <div className="w-full flex justify-center">
                    {treemapData && treemapData.children.length > 0 ? (
                        <Treemap data={treemapData} width={dimensions.width - 48} height={400} />
                    ) : (
                        <div className="h-[400px] flex items-center justify-center text-gray-400 w-full">
                            {currentPath ? "Not enough data for Treemap" : "Select a folder to view map"}
                        </div>
                    )}
                </div>
            </div>

            {/* Largest Files Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Top 50 Largest Files</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-gray-500 dark:text-gray-400">
                        <thead className="bg-gray-50 dark:bg-gray-900/50 text-xs uppercase text-gray-700 dark:text-gray-300">
                            <tr>
                                <th className="px-6 py-3">Name</th>
                                <th className="px-6 py-3">Path</th>
                                <th className="px-6 py-3">Size</th>
                                <th className="px-6 py-3">Type</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {largestFiles.map((file) => (
                                <tr key={file.path} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
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
                                        {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
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
