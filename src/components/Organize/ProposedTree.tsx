import React, { useMemo } from 'react';
import { FileTree } from './FileTree';
import { FileMove } from './SuggestionCard';

interface DirectoryNode {
    name: string;
    path: string;
    children: DirectoryNode[];
    is_directory: boolean;
    size: number;
    file_count: number;
}

interface ProposedTreeProps {
    originalTree: DirectoryNode;
    moves: FileMove[];
}

const ProposedTree: React.FC<ProposedTreeProps> = ({ originalTree, moves }) => {

    // Simulate the moves on the tree
    const proposedTree = useMemo(() => {
        if (!originalTree) return null;

        // ALTERNATIVE APPROACH: Rebuild the tree from scratch based on resulting paths
        // 1. Collect all files from original tree
        // 2. Apply moves (change paths)
        // 3. Rebuild tree structure from list of paths

        const allFiles: DirectoryNode[] = [];
        const collectFiles = (node: DirectoryNode) => {
            if (!node.is_directory) {
                allFiles.push({ ...node, children: [] });
            } else {
                node.children.forEach(collectFiles);
            }
        };
        collectFiles(originalTree);

        // Map of path changes
        const moveMap = new Map(moves.map(m => [m.file_path, m.new_path]));

        // Update paths
        const updatedFiles = allFiles.map(f => {
            if (moveMap.has(f.path)) {
                const newPath = moveMap.get(f.path)!;
                const newName = newPath.split(/[/\\]/).pop() || f.name;
                return { ...f, path: newPath, name: newName };
            }
            return f;
        });

        // Rebuild Tree
        const rootPath = originalTree.path;
        const newRoot: DirectoryNode = {
            ...originalTree,
            children: [],
            file_count: 0,
            size: 0
        };

        // Map to store directory nodes by path
        const dirMap = new Map<string, DirectoryNode>();
        dirMap.set(rootPath, newRoot);

        updatedFiles.forEach(file => {
            // Determine parent path
            // Handle both separators
            // const parts = file.path.split(/[/\\]/);
            // const fileName = parts.pop();
            // const parentPath = parts.join('/'); // Normalize to /

            // Ensure parent chain exists
            // But we need to be careful about matching `rootPath`.
            // If file is moved outside root, it won't show up?
            // Assuming moves are internal or to subfolders.

            if (!file.path.startsWith(rootPath)) {
                // Moved outside? Skip for now.
                return;
            }

            // Find or create directories relative to root
            let currentPath = rootPath;
            const relativePath = file.path.substring(rootPath.length);
            const relativeParts = relativePath.split(/[/\\]/).filter(Boolean);
            relativeParts.pop(); // Remove filename

            let currentNode = newRoot;

            for (const part of relativeParts) {
                const nextPath = currentPath.endsWith('/') || currentPath.endsWith('\\')
                    ? currentPath + part
                    : currentPath + '/' + part;

                if (!dirMap.has(nextPath)) {
                    const newDir: DirectoryNode = {
                        name: part,
                        path: nextPath,
                        is_directory: true,
                        children: [],
                        size: 0,
                        file_count: 0
                    };
                    currentNode.children.push(newDir);
                    dirMap.set(nextPath, newDir);
                }
                currentNode = dirMap.get(nextPath)!;
                currentPath = nextPath;
            }

            // Add file to parent
            currentNode.children.push(file);
        });

        // Recalculate sizes and counts (recursive post-process)
        const recalcInfo = (node: DirectoryNode) => {
            if (!node.is_directory) return;

            let size = 0;
            let count = 0;

            node.children.forEach(child => {
                recalcInfo(child);
                size += child.size;
                count += child.is_directory ? child.file_count : 1;
            });

            node.size = size;
            node.file_count = count;

            // Sort children
            node.children.sort((a, b) => {
                if (a.is_directory === b.is_directory) return a.name.localeCompare(b.name);
                return a.is_directory ? -1 : 1;
            });
        };

        recalcInfo(newRoot);

        return newRoot;
    }, [originalTree, moves]);

    if (!proposedTree) return <div>No data</div>;

    return (
        <div className="bg-base border border-base rounded-lg p-4 h-[500px] overflow-y-auto custom-scrollbar">
            <h3 className="text-sm font-bold text-green-400 mb-2 uppercase tracking-wider">Proposed Structure</h3>
            <FileTree node={proposedTree} />
        </div>
    );
};

export default ProposedTree;
