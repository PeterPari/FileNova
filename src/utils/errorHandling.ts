// Error handling utilities for comprehensive error management

export class FileNovaError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'FileNovaError';
  }
}

export class PermissionError extends FileNovaError {
  constructor(path: string, details?: any) {
    super(
      'PERMISSION_DENIED',
      `Permission denied for: ${path}`,
      details
    );
  }
}

export class NetworkError extends FileNovaError {
  constructor(message: string, details?: any) {
    super('NETWORK_ERROR', message, details);
  }
}

export class FileSystemError extends FileNovaError {
  constructor(message: string, details?: any) {
    super('FILESYSTEM_ERROR', message, details);
  }
}

export class AIServiceError extends FileNovaError {
  constructor(message: string, details?: any) {
    super('AI_SERVICE_ERROR', message, details);
  }
}

export class IndexCorruptionError extends FileNovaError {
  constructor(message: string, details?: any) {
    super('INDEX_CORRUPTION', message, details);
  }
}

export class DiskSpaceError extends FileNovaError {
  constructor(availableBytes: number) {
    super(
      'INSUFFICIENT_DISK_SPACE',
      `Insufficient disk space. Available: ${formatBytes(availableBytes)}`,
      { availableBytes }
    );
  }
}

// Retry utility with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxAttempts) {
        break;
      }

      const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      
      if (onRetry) {
        onRetry(attempt, lastError);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// Format bytes utility
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// Timeout utility
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

// Validate filename
export function validateFileName(name: string): { valid: boolean; error?: string } {
  const invalidChars = /[\/\\:*?"<>|]/g;
  
  if (invalidChars.test(name)) {
    return {
      valid: false,
      error: 'Filename contains invalid characters: / \\ : * ? " < > |',
    };
  }

  if (name.length === 0) {
    return { valid: false, error: 'Filename cannot be empty' };
  }

  if (name.length > 255) {
    return { valid: false, error: 'Filename is too long (max 255 characters)' };
  }

  const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'LPT1', 'LPT2', 'LPT3'];
  if (reservedNames.includes(name.toUpperCase())) {
    return { valid: false, error: 'Filename is a reserved system name' };
  }

  return { valid: true };
}

// Sanitize filename
export function sanitizeFileName(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, '_');
}

// Handle name conflicts
export function resolveNameConflict(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  const lastDotIndex = baseName.lastIndexOf('.');
  const nameWithoutExt = lastDotIndex > 0 ? baseName.slice(0, lastDotIndex) : baseName;
  const ext = lastDotIndex > 0 ? baseName.slice(lastDotIndex) : '';

  let counter = 1;
  let newName = `${nameWithoutExt} (${counter})${ext}`;

  while (existingNames.includes(newName)) {
    counter++;
    newName = `${nameWithoutExt} (${counter})${ext}`;
  }

  return newName;
}

// Truncate path for display
export function truncatePath(path: string, maxLength: number = 50): string {
  if (path.length <= maxLength) {
    return path;
  }

  const parts = path.split(/[\/\\]/);
  if (parts.length <= 2) {
    return `...${path.slice(-(maxLength - 3))}`;
  }

  let result = parts[parts.length - 1];
  let i = parts.length - 2;

  while (i >= 0 && result.length + parts[i].length + 4 < maxLength) {
    result = parts[i] + '/' + result;
    i--;
  }

  return '.../' + result;
}

// LRU Cache implementation
export class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    const value = this.cache.get(key)!;
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Debounce utility
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;

  return function (...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
    }, waitMs);
  };
}

// Batch events utility
export class EventBatcher<T> {
  private batch: T[] = [];
  private timeoutId: number | null = null;

  constructor(
    private callback: (events: T[]) => void,
    private windowMs: number
  ) {}

  add(event: T): void {
    this.batch.push(event);

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      if (this.batch.length > 0) {
        this.callback([...this.batch]);
        this.batch = [];
      }
    }, this.windowMs);
  }

  flush(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.batch.length > 0) {
      this.callback([...this.batch]);
      this.batch = [];
    }
  }
}
