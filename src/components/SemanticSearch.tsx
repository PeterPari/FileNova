import { useFileStore } from '../store/fileStore';
import { File, Folder, Search, Scale, Zap, Sparkles } from 'lucide-react';

export const SemanticSearch = () => {
    const { searchResults, searchQuery, isSearching, selectFile } = useFileStore();

    const handleResultClick = (path: string) => {
        // We can reuse selectFile if we construct a partial FileEntry
        // or just invoke 'open_file' directly.
        // For now, let's just log it or maybe open it if we had a proper 'open' command.
        // But re-using selectFile might trigger preview if we have file info.
        // Actually, let's just use the store's selectFile which handles file info fetching.
        selectFile({
            name: path.split(/[/\\]/).pop() || path,
            path: path,
            is_directory: false, // Assume files for now
            size: 0, // Placeholder
            modified_at: 0 // Placeholder
        });
    };

    if (isSearching) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <div className="relative">
                    <div className="w-16 h-16 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles size={24} className="text-purple-600 animate-pulse" />
                    </div>
                </div>
                <p className="mt-4 text-lg font-medium text-gray-700 dark:text-gray-300">Searching your knowledge base...</p>
                <p className="text-sm text-gray-400">Analyzing meanings and keywords</p>
            </div>
        );
    }

    if (!searchResults || searchResults.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
                <Search size={64} className="text-gray-300 dark:text-gray-700 mb-4" />
                <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    {searchQuery ? `No results for "${searchQuery}"` : "Ready to Search"}
                </h3>
                <p className="max-w-md text-gray-400">
                    {searchQuery
                        ? "Try rephrasing your query or using different keywords. Make sure your files have been extracted."
                        : "Enter a query to search through your documents using AI-powered semantic understanding."}
                </p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-6">
            <header className="mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-3">
                    <Sparkles className="text-purple-600" />
                    Results for "{searchQuery}"
                </h2>
                <p className="text-gray-500 text-sm mt-1">
                    Found {searchResults.length} relevant documents
                </p>
            </header>

            <div className="space-y-4 max-w-4xl">
                {searchResults.map((result, index) => (
                    <div
                        key={`${result.path}-${index}`}
                        onClick={() => handleResultClick(result.path)}
                        className="group bg-white dark:bg-gray-800/50 rounded-xl p-4 border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700/50 hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                    >
                        {/* Score Indicator Background */}
                        <div
                            className="absolute left-0 top-0 bottom-0 bg-purple-500/5 transition-all duration-500"
                            style={{ width: `${result.combined_score * 100}%` }}
                        />

                        <div className="relative flex gap-4">
                            <div className="mt-1 flex-shrink-0">
                                <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 group-hover:bg-purple-100 group-hover:text-purple-600 dark:group-hover:bg-purple-900/30 dark:group-hover:text-purple-400 transition-colors">
                                    {result.extension ? <File size={20} /> : <Folder size={20} />}
                                </div>
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate pr-4 text-lg group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                                        {result.name}
                                    </h3>
                                    <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-1 flex-shrink-0">
                                        {result.source === 'semantic' && <Zap size={12} className="text-amber-500" />}
                                        {result.source === 'keyword' && <Search size={12} className="text-blue-500" />}
                                        {result.source === 'hybrid' && <Scale size={12} className="text-purple-500" />}
                                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                            {Math.round(result.combined_score * 100)}%
                                        </span>
                                    </div>
                                </div>

                                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mb-2 truncate" title={result.path}>
                                    {result.path}
                                </p>

                                {result.snippet && (
                                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 rounded p-2 italic border-l-2 border-purple-300 dark:border-purple-700">
                                        "...{result.snippet}..."
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
