const pathSeparatorRegex = /[\\/]+/;

export const splitPath = (path: string): string[] => {
    if (!path) return [];
    return path.split(pathSeparatorRegex).filter(Boolean);
};

export const getPathLabel = (path: string): string => {
    if (!path) return 'Home';
    const parts = splitPath(path);
    return parts[parts.length - 1] ?? path;
};

export const joinPathParts = (parts: string[], isUnixRoot: boolean): string => {
    if (parts.length === 0) return isUnixRoot ? '/' : '';
    const joined = parts.join('/');
    return isUnixRoot ? `/${joined}` : joined;
};

export const isWindowsDrive = (path: string): boolean => /^[A-Za-z]:$/.test(path);

export const getParentPath = (path: string): string | null => {
    if (!path) return null;
    if (path === '/' || isWindowsDrive(path)) return null;

    const parts = splitPath(path);
    if (parts.length <= 1) return path.startsWith('/') ? '/' : '';

    const isUnixRoot = path.startsWith('/');
    return joinPathParts(parts.slice(0, -1), isUnixRoot);
};
