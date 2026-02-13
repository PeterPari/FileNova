// Performance monitoring and optimization utilities

export class PerformanceMonitor {
  private static measurements: Map<string, number[]> = new Map();

  static start(label: string): () => void {
    const startTime = performance.now();

    return () => {
      const duration = performance.now() - startTime;
      
      if (!this.measurements.has(label)) {
        this.measurements.set(label, []);
      }
      
      this.measurements.get(label)!.push(duration);
    };
  }

  static async measure<T>(label: string, fn: () => T | Promise<T>): Promise<T> {
    const end = this.start(label);
    try {
      const result = await fn();
      return result;
    } finally {
      end();
    }
  }

  static getMetrics(label: string): { avg: number; min: number; max: number; count: number } | null {
    const measurements = this.measurements.get(label);
    if (!measurements || measurements.length === 0) {
      return null;
    }

    const sum = measurements.reduce((a, b) => a + b, 0);
    return {
      avg: sum / measurements.length,
      min: Math.min(...measurements),
      max: Math.max(...measurements),
      count: measurements.length,
    };
  }

  static getAllMetrics(): Record<string, ReturnType<typeof PerformanceMonitor.getMetrics>> {
    const result: Record<string, any> = {};
    for (const [label, _] of this.measurements) {
      result[label] = this.getMetrics(label);
    }
    return result;
  }

  static clear(label?: string): void {
    if (label) {
      this.measurements.delete(label);
    } else {
      this.measurements.clear();
    }
  }
}

// Memory monitoring
export class MemoryMonitor {
  static getUsage(): {
    used: number;
    total: number;
    percentage: number;
  } | null {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      return {
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        percentage: (memory.usedJSHeapSize / memory.totalJSHeapSize) * 100,
      };
    }
    return null;
  }

  static formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  static startMonitoring(intervalMs: number = 5000): () => void {
    const intervalId = setInterval(() => {
      const usage = this.getUsage();
      if (usage) {
        console.log(
          `Memory: ${this.formatBytes(usage.used)} / ${this.formatBytes(usage.total)} (${usage.percentage.toFixed(1)}%)`
        );
        
        // Warn if memory usage is high
        if (usage.percentage > 80) {
          console.warn('High memory usage detected!');
        }
      }
    }, intervalMs);

    return () => clearInterval(intervalId);
  }
}

// Lazy load utility
export function lazyLoad<T>(factory: () => Promise<T>): {
  load: () => Promise<T>;
  isLoaded: () => boolean;
  get: () => T | null;
} {
  let value: T | null = null;
  let loading: Promise<T> | null = null;

  return {
    load: async () => {
      if (value !== null) {
        return value;
      }

      if (loading) {
        return loading;
      }

      loading = factory();
      value = await loading;
      loading = null;
      return value;
    },

    isLoaded: () => value !== null,

    get: () => value,
  };
}

// Request queue for batching
export class RequestQueue<T, R> {
  private queue: Array<{
    request: T;
    resolve: (result: R) => void;
    reject: (error: Error) => void;
  }> = [];
  private timeoutId: number | null = null;

  constructor(
    private processor: (requests: T[]) => Promise<R[]>,
    private batchSize: number = 10,
    private delayMs: number = 50
  ) {}

  add(request: T): Promise<R> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });

      if (this.queue.length >= this.batchSize) {
        this.flush();
      } else if (!this.timeoutId) {
        this.timeoutId = setTimeout(() => this.flush(), this.delayMs);
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    const requests = batch.map(item => item.request);

    try {
      const results = await this.processor(requests);
      
      if (results.length !== batch.length) {
        throw new Error('Processor returned incorrect number of results');
      }

      batch.forEach((item, index) => {
        item.resolve(results[index]);
      });
    } catch (error) {
      batch.forEach(item => {
        item.reject(error as Error);
      });
    }
  }
}

// Optimize scroll performance
export function useVirtualScrollOptimization() {
  return {
    overscan: 5,
    estimateSize: () => 40, // Estimated row height
    measureElement: (element: HTMLElement) => element.offsetHeight,
  };
}

// Image loading optimization
export class ImageLoader {
  private static loadingImages = new Set<string>();
  private static loadedImages = new Set<string>();
  private static errorImages = new Set<string>();
  private static maxConcurrent = 6;
  private static slotResolvers: Array<() => void> = [];

  private static async waitForSlot(): Promise<void> {
    if (this.loadingImages.size < this.maxConcurrent) return;
    return new Promise(resolve => this.slotResolvers.push(resolve));
  }

  static async load(url: string): Promise<void> {
    if (this.loadedImages.has(url)) {
      return;
    }

    if (this.errorImages.has(url)) {
      throw new Error('Image previously failed to load');
    }

    // Wait for a free slot (no busy-wait)
    await this.waitForSlot();

    this.loadingImages.add(url);

    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
        img.src = url;
      });

      this.loadedImages.add(url);
    } catch (error) {
      this.errorImages.add(url);
      throw error;
    } finally {
      this.loadingImages.delete(url);
      const next = this.slotResolvers.shift();
      if (next) next();
    }
  }

  static preload(urls: string[]): void {
    urls.forEach(url => {
      this.load(url).catch(() => {
        // Ignore errors in background preloading
      });
    });
  }

  static clear(): void {
    this.loadingImages.clear();
    this.loadedImages.clear();
    this.errorImages.clear();
  }
}

// Database query optimization helper
export function optimizeQuery(query: string): string {
  // Add common optimizations
  let optimized = query;

  // Ensure indexes are used
  if (!optimized.toLowerCase().includes('index')) {
    if (optimized.toLowerCase().includes('where')) {
      console.warn('Query may benefit from an index:', query);
    }
  }

  return optimized;
}

// Startup performance tracker
export class StartupTracker {
  private static milestones: Map<string, number> = new Map();
  private static startTime = performance.now();

  static mark(milestone: string): void {
    this.milestones.set(milestone, performance.now() - this.startTime);
  }

  static report(): void {
    console.log('=== Startup Performance ===');
    const sorted = Array.from(this.milestones.entries()).sort((a, b) => a[1] - b[1]);
    sorted.forEach(([milestone, time]) => {
      console.log(`${milestone}: ${time.toFixed(2)}ms`);
    });
    console.log(`Total: ${(performance.now() - this.startTime).toFixed(2)}ms`);
  }

  static getTimeToInteractive(): number {
    return this.milestones.get('interactive') || 0;
  }
}
