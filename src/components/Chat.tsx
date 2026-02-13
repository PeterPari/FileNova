import { useState, useEffect, useRef } from 'react';
import { Send, User, Bot, FileText, Plus, Menu, MessageSquare, Calendar, File, Image, Film, Music, Archive, Code, FileSpreadsheet, HardDrive, ExternalLink, Check, X, Undo2, Loader2, Ban, CheckCircle2, BarChart3, GitCompare, TrendingUp, FolderOpen, AlertCircle, Search, HelpCircle } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useChatController, type ChatMetadata } from '../hooks/useChatController';

export const Chat = () => {
    const {
        sessions,
        currentSessionId,
        setCurrentSessionId,
        messages,
        input,
        setInput,
        isLoading,
        actionLoading,
        handleNewChat,
        handleSend,
        handleConfirmAction,
        handleCancelAction,
        handleUndoAction,
    } = useChatController();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    };

    const formatTimestamp = (ts: number): string => {
        if (!ts) return '';
        const date = new Date(ts * 1000);
        return date.toLocaleDateString();
    };

    const getFileIcon = (ext: string | null) => {
        if (!ext) return <File size={18} className="text-muted" />;
        const e = ext.toLowerCase().replace('.', '');
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(e))
            return <Image size={18} className="text-pink-500" />;
        if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(e))
            return <Film size={18} className="text-purple-500" />;
        if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'].includes(e))
            return <Music size={18} className="text-green-500" />;
        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(e))
            return <Archive size={18} className="text-yellow-600" />;
        if (['rs', 'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cpp', 'c', 'h', 'go', 'rb', 'php', 'cs', 'swift', 'kt'].includes(e))
            return <Code size={18} className="text-blue-500" />;
        if (['xlsx', 'xls', 'csv'].includes(e))
            return <FileSpreadsheet size={18} className="text-green-600" />;
        if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(e))
            return <FileText size={18} className="text-red-500" />;
        return <File size={18} className="text-muted" />;
    };

    const parseMetadata = (metadataJson?: string): ChatMetadata | null => {
        if (!metadataJson) return null;
        try {
            return JSON.parse(metadataJson);
        } catch {
            return null;
        }
    };

    return (
        <div className="flex h-full bg-base overflow-hidden">
             {/* Sidebar */}
             <div className={`${isSidebarOpen ? 'w-64' : 'w-0'} bg-surface border-r border-base transition-all duration-300 flex flex-col overflow-hidden`}>
                <div className="p-4 border-b border-base flex justify-between items-center">
                    <h2 className="font-semibold text-primary">History</h2>
                    <button onClick={handleNewChat} className="p-1 hover:bg-surface-hover rounded-full" title="New Chat">
                        <Plus size={18} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {sessions.map(session => (
                        <button
                            key={session.id}
                            onClick={() => setCurrentSessionId(session.id)}
                            className={`w-full text-left p-3 rounded-lg text-sm flex flex-col gap-1 ${
                                currentSessionId === session.id 
                                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                                    : 'hover:bg-surface-hover text-secondary'
                            }`}
                        >
                            <div className="flex items-center gap-2">
                                <MessageSquare size={14} />
                                <span className="font-medium truncate">Session #{session.id}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted">
                                <Calendar size={10} />
                                <span>{formatDate(session.last_message_at)}</span>
                            </div>
                        </button>
                    ))}
                    {sessions.length === 0 && (
                        <div className="text-center p-4 text-muted text-sm">
                            No history yet
                        </div>
                    )}
                </div>
             </div>

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-full min-w-0">
                {/* Header */}
                <div className="p-4 border-b border-base flex justify-between items-center bg-base z-10">
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="p-1 hover:bg-surface-hover text-secondary rounded transition-colors"
                        >
                            <Menu size={20} />
                        </button>
                        <h1 className="text-xl font-bold flex items-center gap-2 text-primary">
                            <Bot className="text-blue-500" />
                            Smart Assistant
                        </h1>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {!currentSessionId && messages.length === 0 && (
                         <div className="flex flex-col items-center justify-center h-full text-muted space-y-4">
                            <Bot size={64} className="opacity-20" />
                            <p className="text-lg">How can I help you organize your files today?</p>
                            <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                                {["Find large video files", "Organize my Downloads", "Show duplicates", "Space usage report"].map(suggestion => (
                                    <button 
                                        key={suggestion}
                                        onClick={() => setInput(suggestion)}
                                        className="p-3 text-sm border border-base rounded-lg hover:bg-surface-hover transition-colors text-left text-secondary"
                                    >
                                        {suggestion}
                                    </button>
                                ))}
                            </div>
                         </div>
                    )}
                    
                    {messages.map(msg => (
                        <div 
                            key={msg.id} 
                            className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                             <div className={`flex max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} gap-3`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-accent-primary' : 'bg-surface-active'}`}>
                                    {msg.role === 'user' ? <User size={16} className="text-white" /> : <Bot size={16} className="text-secondary" />}
                                </div>
                                
                                <div className={`p-4 rounded-2xl ${
                                    msg.role === 'user'
                                        ? 'bg-accent-primary text-white rounded-tr-none'
                                        : 'bg-surface text-primary rounded-tl-none border border-base'
                                }`}>
                                    <p className="whitespace-pre-wrap">{msg.content}</p>

                                    {/* Error Info Card */}
                                    {(() => {
                                        const meta = parseMetadata(msg.metadata_json);
                                        if (!meta?.error_info) return null;
                                        const err = meta.error_info;
                                        const icon = err.error_type === 'no_results' ? <Search size={16} /> 
                                            : err.error_type === 'network_error' ? <AlertCircle size={16} />
                                            : <HelpCircle size={16} />;
                                        const borderColor = err.error_type === 'network_error' || err.error_type === 'action_failed'
                                            ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
                                            : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20';
                                        const textColor = err.error_type === 'network_error' || err.error_type === 'action_failed'
                                            ? 'text-red-700 dark:text-red-300'
                                            : 'text-amber-700 dark:text-amber-300';
                                        
                                        return (
                                            <div className={`mt-3 p-3 rounded-lg border ${borderColor}`}>
                                                <div className={`flex items-center gap-2 text-sm font-medium ${textColor}`}>
                                                    {icon}
                                                    {err.message}
                                                </div>
                                                {err.did_you_mean.length > 0 && (
                                                    <div className="mt-2">
                                                        <p className="text-xs text-muted mb-1.5">Did you mean:</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {err.did_you_mean.map((s, idx) => (
                                                                <button
                                                                    key={idx}
                                                                    onClick={() => setInput(s.replace(/^Did you mean '(.+)'\?$/, '$1').replace(/^Search for /, ''))}
                                                                    className="px-2.5 py-1 text-xs bg-base border border-base rounded-full hover:border-blue-400 dark:hover:border-blue-500 hover:text-accent-primary transition-colors cursor-pointer"
                                                                >
                                                                    {s}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                    
                                    {/* File Cards from metadata */}
                                    {(() => {
                                        const meta = parseMetadata(msg.metadata_json);
                                        if (!meta?.files || meta.files.length === 0) return null;
                                        
                                        return (
                                            <div className="mt-3 space-y-2">
                                                <div className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-2 flex items-center gap-1">
                                                    <HardDrive size={12} />
                                                    {meta.files.length} file{meta.files.length !== 1 ? 's' : ''} found
                                                </div>
                                                <div className="grid gap-2" style={{ maxHeight: meta.files.length > 6 ? '320px' : 'none', overflowY: meta.files.length > 6 ? 'auto' : 'visible' }}>
                                                    {meta.files.map((file, idx) => (
                                                        <div 
                                                            key={idx}
                                                            className="flex items-center gap-3 p-2.5 rounded-lg bg-base/80 border border-base hover:border-blue-400 dark:hover:border-blue-500 transition-colors cursor-pointer group"
                                                            title={file.path}
                                                            onClick={() => {
                                                                // Navigate to file in file browser
                                                                const parentPath = file.path.substring(0, file.path.lastIndexOf('\\')) || file.path.substring(0, file.path.lastIndexOf('/'));
                                                                if (parentPath) {
                                                                    invoke('list_directory', { path: parentPath }).catch(() => {});
                                                                }
                                                            }}
                                                        >
                                                            {/* File type icon */}
                                                            <div className="w-9 h-9 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
                                                                {getFileIcon(file.extension)}
                                                            </div>
                                                            
                                                            {/* File info */}
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-medium text-sm truncate text-primary">
                                                                    {file.name}
                                                                </div>
                                                                <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                                                                    <span>{formatFileSize(file.size_bytes)}</span>
                                                                    {file.modified_at > 0 && (
                                                                        <>
                                                                            <span className="text-disabled">·</span>
                                                                            <span>{formatTimestamp(file.modified_at)}</span>
                                                                        </>
                                                                    )}
                                                                    {file.extension && (
                                                                        <>
                                                                            <span className="text-disabled">·</span>
                                                                            <span className="uppercase">{file.extension.replace('.', '')}</span>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Hover action */}
                                                            <ExternalLink size={14} className="text-disabled group-hover:text-accent-primary transition-colors shrink-0" />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* Action Buttons: Confirm / Cancel / Undo */}
                                    {(() => {
                                        const meta = parseMetadata(msg.metadata_json);
                                        if (!meta) return null;

                                        // Analysis Data Rendering
                                        if (meta.analysis_data) {
                                            const ad = meta.analysis_data;
                                            return (
                                                <div className="mt-3 space-y-3">
                                                    <div className="flex items-center gap-2 text-sm font-semibold opacity-80">
                                                        <BarChart3 size={14} />
                                                        {ad.title}
                                                    </div>
                                                    <p className="text-xs opacity-70">{ad.summary}</p>

                                                    {/* Stats Grid */}
                                                    {ad.stats.length > 0 && (
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {ad.stats.map((stat, idx) => (
                                                                <div key={idx} className="p-2.5 rounded-lg bg-base/80 border border-base">
                                                                    <div className="text-xs text-muted truncate">{stat.label}</div>
                                                                    <div className="text-sm font-semibold text-primary mt-0.5 truncate">{stat.value}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Trend Chart (simple bar visualization) */}
                                                    {ad.trend_data && ad.trend_data.length > 0 && (
                                                        <div className="space-y-2">
                                                            <div className="flex items-center gap-1.5 text-xs font-semibold opacity-70">
                                                                <TrendingUp size={12} />
                                                                Activity Timeline
                                                            </div>
                                                            <div className="flex items-end gap-px h-24 p-2 rounded-lg bg-base/80 border border-base">
                                                                {(() => {
                                                                    const maxCount = Math.max(...ad.trend_data!.map(t => t.count), 1);
                                                                    return ad.trend_data!.map((point, idx) => (
                                                                        <div key={idx} className="flex-1 flex flex-col items-center justify-end gap-0.5 group relative">
                                                                            <div
                                                                                className="w-full bg-blue-400 dark:bg-blue-500 rounded-t-sm min-h-[2px] transition-all hover:bg-blue-500 dark:hover:bg-blue-400"
                                                                                style={{ height: `${(point.count / maxCount) * 100}%` }}
                                                                            />
                                                                            {/* Tooltip */}
                                                                            <div className="absolute bottom-full mb-1 hidden group-hover:block bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap z-10">
                                                                                {point.date}: {point.count} events
                                                                            </div>
                                                                        </div>
                                                                    ));
                                                                })()}
                                                            </div>
                                                            <div className="flex justify-between text-[10px] text-muted">
                                                                <span>{ad.trend_data[0].date}</span>
                                                                <span>{ad.trend_data[ad.trend_data.length - 1].date}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }

                                        // Compare Results Rendering
                                        if (meta.compare_results) {
                                            const cr = meta.compare_results;
                                            return (
                                                <div className="mt-3 space-y-3">
                                                    <div className="flex items-center gap-2 text-sm font-semibold opacity-80">
                                                        <GitCompare size={14} />
                                                        Folder Comparison
                                                    </div>

                                                    {/* Summary Cards */}
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="p-2.5 rounded-lg border border-blue-200 dark:border-blue-800" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}>
                                                            <div className="flex items-center gap-1.5 text-xs text-accent-primary">
                                                                <FolderOpen size={12} />
                                                                {cr.folder_a}
                                                            </div>
                                                            <div className="text-sm font-semibold text-blue-700 dark:text-blue-300 mt-1">
                                                                {formatFileSize(cr.size_a_total)}
                                                            </div>
                                                        </div>
                                                        <div className="p-2.5 rounded-lg border border-purple-200 dark:border-purple-800" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-purple, #8b5cf6) 12%, transparent)' }}>
                                                            <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
                                                                <FolderOpen size={12} />
                                                                {cr.folder_b}
                                                            </div>
                                                            <div className="text-sm font-semibold text-purple-700 dark:text-purple-300 mt-1">
                                                                {formatFileSize(cr.size_b_total)}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Stats */}
                                                    <div className="flex gap-3 text-xs">
                                                        <span className="px-2 py-1 rounded bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                                                            {cr.common_count} common
                                                        </span>
                                                        <span className="px-2 py-1 rounded border border-blue-200 dark:border-blue-800 text-accent-primary" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}>
                                                            {cr.only_in_a.length} unique to {cr.folder_a}
                                                        </span>
                                                        <span className="px-2 py-1 rounded bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                                                            {cr.only_in_b.length} unique to {cr.folder_b}
                                                        </span>
                                                    </div>

                                                    {/* Unique files lists */}
                                                    {cr.only_in_a.length > 0 && (
                                                        <div>
                                                            <div className="text-xs font-semibold text-accent-primary mb-1">
                                                                Only in {cr.folder_a}:
                                                            </div>
                                                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                                                {cr.only_in_a.slice(0, 10).map((f, idx) => (
                                                                    <div key={idx} className="flex items-center gap-2 text-xs p-1.5 rounded bg-base/50">
                                                                        {getFileIcon(f.extension)}
                                                                        <span className="truncate flex-1">{f.name}</span>
                                                                        <span className="text-muted shrink-0">{formatFileSize(f.size_bytes)}</span>
                                                                    </div>
                                                                ))}
                                                                {cr.only_in_a.length > 10 && (
                                                                    <div className="text-xs text-muted text-center">...and {cr.only_in_a.length - 10} more</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {cr.only_in_b.length > 0 && (
                                                        <div>
                                                            <div className="text-xs font-semibold text-purple-600 dark:text-purple-400 mb-1">
                                                                Only in {cr.folder_b}:
                                                            </div>
                                                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                                                {cr.only_in_b.slice(0, 10).map((f, idx) => (
                                                                    <div key={idx} className="flex items-center gap-2 text-xs p-1.5 rounded bg-base/50">
                                                                        {getFileIcon(f.extension)}
                                                                        <span className="truncate flex-1">{f.name}</span>
                                                                        <span className="text-muted shrink-0">{formatFileSize(f.size_bytes)}</span>
                                                                    </div>
                                                                ))}
                                                                {cr.only_in_b.length > 10 && (
                                                                    <div className="text-xs text-muted text-center">...and {cr.only_in_b.length - 10} more</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }

                                        return null;
                                    })()}

                                    {/* Action Buttons: Confirm / Cancel / Undo (separate IIFE so it always renders) */}
                                    {(() => {
                                        const meta = parseMetadata(msg.metadata_json);
                                        if (!meta) return null;
                                        const status = meta.action_status;
                                        const isExecuting = actionLoading === msg.id;

                                        // Pending actions — show Confirm + Cancel
                                        if (status === 'pending' && meta.actions && meta.actions.length > 0) {
                                            return (
                                                <div className="mt-3 pt-3 border-t border-base">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleConfirmAction(msg)}
                                                            disabled={isExecuting}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                                                        >
                                                            {isExecuting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                                            {isExecuting ? 'Executing...' : 'Confirm'}
                                                        </button>
                                                        <button
                                                            onClick={() => handleCancelAction(msg)}
                                                            disabled={isExecuting}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-active hover:bg-surface-hover disabled:opacity-50 text-primary text-sm font-medium rounded-lg transition-colors"
                                                        >
                                                            <X size={14} />
                                                            Cancel
                                                        </button>
                                                    </div>
                                                    <p className="text-xs text-muted mt-1.5">
                                                        {meta.actions.length} action{meta.actions.length !== 1 ? 's' : ''} waiting for confirmation
                                                    </p>
                                                </div>
                                            );
                                        }

                                        // Confirmed — show Undo button
                                        if (status === 'confirmed' && meta.batch_id) {
                                            return (
                                                <div className="mt-3 pt-3 border-t border-base">
                                                    <div className="flex items-center gap-2">
                                                        <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm font-medium">
                                                            <CheckCircle2 size={14} />
                                                            Executed
                                                        </span>
                                                        <button
                                                            onClick={() => handleUndoAction(meta.batch_id!)}
                                                            disabled={actionLoading !== null}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-800/40 text-amber-700 dark:text-amber-300 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                                                        >
                                                            {actionLoading !== null ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />}
                                                            Undo
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        // Cancelled
                                        if (status === 'cancelled') {
                                            return (
                                                <div className="mt-3 pt-3 border-t border-base">
                                                    <span className="flex items-center gap-1.5 text-muted text-sm">
                                                        <Ban size={14} />
                                                        Cancelled
                                                    </span>
                                                </div>
                                            );
                                        }

                                        // Undone
                                        if (status === 'undone') {
                                            return (
                                                <div className="mt-3 pt-3 border-t border-base">
                                                    <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-sm">
                                                        <Undo2 size={14} />
                                                        Undone — changes reverted
                                                    </span>
                                                </div>
                                            );
                                        }

                                        return null;
                                    })()}

                                    {/* Next Action Suggestions */}
                                    {(() => {
                                        const meta = parseMetadata(msg.metadata_json);
                                        if (!meta?.suggestions || meta.suggestions.length === 0) return null;

                                        return (
                                            <div className="mt-3 pt-3 border-t border-base">
                                                <p className="text-xs text-muted mb-2">Try next:</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {meta.suggestions.map((s, idx) => (
                                                        <button
                                                            key={idx}
                                                            onClick={() => setInput(s)}
                                                            className="px-2.5 py-1 text-xs text-accent-primary border border-blue-200 dark:border-blue-800 rounded-full hover:opacity-80 transition-colors"
                                                            style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}
                                                        >
                                                            {s}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                             </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start w-full">
                            <div className="flex flex-row gap-3">
                                <div className="w-8 h-8 rounded-full bg-surface-active flex items-center justify-center shrink-0">
                                    <Bot size={16} className="text-secondary" />
                                </div>
                                <div className="bg-surface p-4 rounded-2xl rounded-tl-none border border-base">
                                    <span className="animate-pulse text-secondary">Thinking...</span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 bg-base border-t border-base">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Ask me to search, analyze, or organize..."
                            className="flex-1 p-3 border border-base rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-blue-500 text-primary"
                            disabled={isLoading}
                        />
                        <button 
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            className="p-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center min-w-[50px]"
                        >
                            <Send size={20} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
