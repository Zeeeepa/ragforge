/**
 * Community Docs Logger
 *
 * Logs to both console and file for debugging.
 * Log files are stored in ~/.ragforge/logs/community-docs/
 *
 * @since 2025-01-04
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// ============================================================================
// CONFIGURATION
// ============================================================================

const LOG_DIR = path.join(os.homedir(), ".ragforge", "logs", "community-docs");
const API_LOG_FILE = path.join(LOG_DIR, "api.log");
const PIPELINE_LOG_FILE = path.join(LOG_DIR, "pipeline.log");
const ERROR_LOG_FILE = path.join(LOG_DIR, "error.log");

// Max log file size before rotation (5MB)
const MAX_LOG_SIZE = 5 * 1024 * 1024;

// ============================================================================
// TYPES
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  /** Component name for log prefix */
  component: string;
  /** Log file to write to */
  logFile?: string;
  /** Minimum log level (default: info) */
  minLevel?: LogLevel;
  /** Also log to console (default: true) */
  console?: boolean;
}

// ============================================================================
// LOG LEVEL PRIORITY
// ============================================================================

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get local timestamp in ISO-like format (YYYY-MM-DD HH:mm:ss.mmm)
 * Uses LOCAL time, not UTC
 */
function getLocalTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Ensure log directory exists
 */
async function ensureLogDir(): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Rotate log file if too large
 */
async function rotateIfNeeded(logFile: string): Promise<void> {
  try {
    const stats = await fs.stat(logFile);
    if (stats.size > MAX_LOG_SIZE) {
      const rotatedFile = `${logFile}.${Date.now()}.old`;
      await fs.rename(logFile, rotatedFile);

      // Keep only last 3 rotated files
      const dir = path.dirname(logFile);
      const baseName = path.basename(logFile);
      const files = await fs.readdir(dir);
      const oldFiles = files
        .filter((f) => f.startsWith(baseName) && f.endsWith(".old"))
        .sort()
        .reverse();

      for (const oldFile of oldFiles.slice(3)) {
        await fs.unlink(path.join(dir, oldFile)).catch(() => {});
      }
    }
  } catch {
    // File doesn't exist or other error, ignore
  }
}

// ============================================================================
// LOGGER CLASS
// ============================================================================

export class Logger {
  private component: string;
  private logFile: string;
  private minLevel: LogLevel;
  private toConsole: boolean;
  private initialized = false;

  constructor(options: LoggerOptions) {
    this.component = options.component;
    this.logFile = options.logFile || API_LOG_FILE;
    this.minLevel = options.minLevel || "info";
    this.toConsole = options.console ?? true;
  }

  /**
   * Initialize the logger (ensure directories exist)
   */
  private async init(): Promise<void> {
    if (this.initialized) return;
    await ensureLogDir();
    this.initialized = true;
  }

  /**
   * Format a log message
   */
  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = getLocalTimestamp();
    const levelStr = level.toUpperCase().padEnd(5);
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${levelStr}] [${this.component}] ${message}${metaStr}`;
  }

  /**
   * Write to log file
   */
  private async writeToFile(line: string, isError = false): Promise<void> {
    try {
      await this.init();
      await rotateIfNeeded(this.logFile);
      await fs.appendFile(this.logFile, line + "\n");

      // Also write errors to error log
      if (isError) {
        await rotateIfNeeded(ERROR_LOG_FILE);
        await fs.appendFile(ERROR_LOG_FILE, line + "\n");
      }
    } catch {
      // Ignore logging errors
    }
  }

  /**
   * Log a message
   */
  async log(level: LogLevel, message: string, meta?: any): Promise<void> {
    // Check minimum level
    if (LOG_PRIORITY[level] < LOG_PRIORITY[this.minLevel]) {
      return;
    }

    const formatted = this.formatMessage(level, message, meta);

    // Console output
    if (this.toConsole) {
      switch (level) {
        case "debug":
          console.debug(formatted);
          break;
        case "info":
          console.log(formatted);
          break;
        case "warn":
          console.warn(formatted);
          break;
        case "error":
          console.error(formatted);
          break;
      }
    }

    // File output
    await this.writeToFile(formatted, level === "error");
  }

  /**
   * Log debug message
   */
  debug(message: string, meta?: any): void {
    this.log("debug", message, meta);
  }

  /**
   * Log info message
   */
  info(message: string, meta?: any): void {
    this.log("info", message, meta);
  }

  /**
   * Log warning message
   */
  warn(message: string, meta?: any): void {
    this.log("warn", message, meta);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | any, meta?: any): void {
    const errorMeta =
      error instanceof Error
        ? { ...meta, error: error.message, stack: error.stack?.split("\n").slice(0, 3).join("\n") }
        : error
          ? { ...meta, error: String(error) }
          : meta;
    this.log("error", message, errorMeta);
  }

  /**
   * Create a child logger with sub-component
   */
  child(subComponent: string): Logger {
    return new Logger({
      component: `${this.component}:${subComponent}`,
      logFile: this.logFile,
      minLevel: this.minLevel,
      console: this.toConsole,
    });
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create API logger
 */
export function createAPILogger(component = "API"): Logger {
  return new Logger({
    component,
    logFile: API_LOG_FILE,
    minLevel: process.env.LOG_LEVEL as LogLevel || "info",
  });
}

/**
 * Create pipeline logger
 */
export function createPipelineLogger(component = "Pipeline"): Logger {
  return new Logger({
    component,
    logFile: PIPELINE_LOG_FILE,
    minLevel: process.env.LOG_LEVEL as LogLevel || "info",
  });
}

// ============================================================================
// SINGLETON LOGGERS
// ============================================================================

let _apiLogger: Logger | null = null;
let _pipelineLogger: Logger | null = null;

/**
 * Get the API logger singleton
 */
export function getAPILogger(): Logger {
  if (!_apiLogger) {
    _apiLogger = createAPILogger();
  }
  return _apiLogger;
}

/**
 * Get the pipeline logger singleton
 */
export function getPipelineLogger(): Logger {
  if (!_pipelineLogger) {
    _pipelineLogger = createPipelineLogger();
  }
  return _pipelineLogger;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const LOG_FILES = {
  api: API_LOG_FILE,
  pipeline: PIPELINE_LOG_FILE,
  error: ERROR_LOG_FILE,
  dir: LOG_DIR,
};

// Default logger instance for convenience imports
export const logger = getAPILogger();
