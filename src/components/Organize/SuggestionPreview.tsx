import React from 'react';
import { FileMove } from './SuggestionCard';

interface SuggestionPreviewProps {
    moves: FileMove[];
}

const SuggestionPreview: React.FC<SuggestionPreviewProps> = ({ moves }) => {
    // Group by parent folder for a tree-like view?
    // For now, let's do a simple list with better visual cues.

    return (
        <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden font-mono text-xs">
            <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex justify-between font-bold text-gray-400">
                <span>Source</span>
                <span>Destination</span>
            </div>
            <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                    <tbody>
                        {moves.map((move, idx) => {
                            const srcName = move.file_path.split(/[/\\]/).pop();
                            const dstName = move.new_path.split(/[/\\]/).pop();
                            const srcParent = move.file_path.replace(srcName || '', '');
                            const dstParent = move.new_path.replace(dstName || '', '');

                            return (
                                <tr key={idx} className="border-b border-gray-800 hover:bg-gray-800 transition-colors">
                                    <td className="p-2 border-r border-gray-800 w-1/2 align-top">
                                        <div className="text-red-400 font-bold">{srcName}</div>
                                        <div className="text-gray-600 truncate" title={srcParent}>{srcParent}</div>
                                    </td>
                                    <td className="p-2 w-1/2 align-top">
                                        <div className="text-green-400 font-bold">{dstName}</div>
                                        <div className="text-gray-500 truncate" title={dstParent}>{dstParent}</div>
                                        {move.reason && (
                                            <div className="text-blue-400 italic mt-1 text-[10px]">
                                                {move.reason}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="bg-gray-800 px-4 py-2 text-center text-gray-500 text-xs">
                Total {moves.length} file operations
            </div>
        </div>
    );
};

export default SuggestionPreview;
