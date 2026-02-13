// Frontend logging utility

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: string;
  data?: any;
}

class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private maxLogs = 1000;
  private minLevel = LogLevel.INFO;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /**
   * Core logger method — stores a structured log entry and writes to console in dev.
   * Routes can be added later (Sentry, remote ingestion) without changing callers.
   */
  private log(level: LogLevel, message: string, context?: string, data?: any): void {
    if (level < this.minLevel) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context,
      data,
    };

    this.logs.push(entry);

    // Maintain max logs limit
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Structured console output (only in dev)
    const prefix = context ? `[${context}]` : '';
    const formatted = `${new Date(entry.timestamp).toISOString()} ${prefix} ${message}`;

    if (import.meta.env && (import.meta as any).env.DEV) {
      const logData = data ? [formatted, data] : [formatted];
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(...logData);
          break;
        case LogLevel.INFO:
          console.info(...logData);
          break;
        case LogLevel.WARN:
          console.warn(...logData);
          break;
        case LogLevel.ERROR:
          console.error(...logData);
          break;
      }
    }

    // Placeholder: hook to send logs to remote / Sentry if configured
    // e.g. if (sentryEnabled) Sentry.captureMessage(message, { level, extra: data })
  }

  debug(message: string, context?: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, context, data);
  }

  info(message: string, context?: string, data?: any): void {
    this.log(LogLevel.INFO, message, context, data);
  }

  warn(message: string, context?: string, data?: any): void {
    this.log(LogLevel.WARN, message, context, data);
  }

  error(message: string, context?: string, data?: any): void {
    this.log(LogLevel.ERROR, message, context, data);
  }

  getLogs(level?: LogLevel): LogEntry[] {
    if (level !== undefined) {
      return this.logs.filter(log => log.level === level);
    }
    return [...this.logs];
  }

  getRecentErrors(count: number = 10): LogEntry[] {
    return this.logs
      .filter(log => log.level === LogLevel.ERROR)
      .slice(-count);
  }

  clear(): void {
    this.logs = [];
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

export const logger = Logger.getInstance();

// Convenience exports
export const debug = (message: string, context?: string, data?: any) => 
  logger.debug(message, context, data);

export const info = (message: string, context?: string, data?: any) => 
  logger.info(message, context, data);

export const warn = (message: string, context?: string, data?: any) => 
  logger.warn(message, context, data);

export const error = (message: string, context?: string, data?: any) => 
  logger.error(message, context, data);
