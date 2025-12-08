/**
 * Brain Daemon Server
 *
 * HTTP API server that keeps BrainManager alive between tool calls.
 * Provides persistent file watchers and faster tool execution.
 *
 * Port: 6666 (configurable via RAGFORGE_DAEMON_PORT)
 * Logs: ~/.ragforge/logs/daemon.log
 *
 * @since 2025-12-08
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  BrainManager,
  generateBrainToolHandlers,
  generateSetupToolHandlers,
  generateImageTools,
  generate3DTools,
  getLocalTimestamp,
  type BrainToolsContext,
  type ImageToolsContext,
  type ThreeDToolsContext,
} from '@luciformresearch/ragforge';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PORT = 6969;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const LOG_DIR = path.join(os.homedir(), '.ragforge', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'daemon.log');
const PID_FILE = path.join(os.homedir(), '.ragforge', 'daemon.pid');

// ============================================================================
// Logger
// ============================================================================

class DaemonLogger {
  private logStream: fs.FileHandle | null = null;
  private buffer: string[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;

  constructor() {
    // Save original console methods
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(LOG_DIR, { recursive: true });
    this.logStream = await fs.open(LOG_FILE, 'a');

    // Intercept all console output and redirect to log file
    this.interceptConsole();

    // Flush buffer every second
    this.flushInterval = setInterval(() => this.flush(), 1000);

    this.info('='.repeat(60));
    this.info('Brain Daemon starting...');
    this.info(`PID: ${process.pid}`);
    this.info(`Log file: ${LOG_FILE}`);
  }

  /**
   * Intercept console.log/error/warn and redirect to log file
   * This captures all output from BrainManager and other modules
   */
  private interceptConsole(): void {
    const self = this;

    console.log = (...args: any[]) => {
      const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      self.writeRaw(message);
      // Also write to stdout in verbose mode
      if (process.env.RAGFORGE_DAEMON_VERBOSE) {
        self.originalConsoleLog(...args);
      }
    };

    console.error = (...args: any[]) => {
      const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      self.writeRaw(`[ERROR] ${message}`);
      // Always write errors to stderr
      self.originalConsoleError(...args);
    };

    console.warn = (...args: any[]) => {
      const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      self.writeRaw(`[WARN] ${message}`);
      if (process.env.RAGFORGE_DAEMON_VERBOSE) {
        self.originalConsoleWarn(...args);
      }
    };
  }

  /**
   * Write raw message (from intercepted console) with timestamp
   */
  private writeRaw(message: string): void {
    const timestamp = getLocalTimestamp();
    const formatted = `[${timestamp}] ${message}\n`;
    this.buffer.push(formatted);
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = getLocalTimestamp();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
  }

  private write(level: string, message: string, meta?: any): void {
    const formatted = this.formatMessage(level, message, meta);
    this.buffer.push(formatted);

    // Also write to console in dev mode
    if (process.env.RAGFORGE_DAEMON_VERBOSE) {
      this.originalConsoleLog(formatted.trim());
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.logStream) return;

    const content = this.buffer.join('');
    this.buffer = [];
    await this.logStream.write(content);
  }

  info(message: string, meta?: any): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: any): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: any): void {
    this.write('error', message, meta);
    // Flush immediately on error
    this.flush();
  }

  debug(message: string, meta?: any): void {
    if (process.env.RAGFORGE_DAEMON_DEBUG) {
      this.write('debug', message, meta);
    }
  }

  async close(): Promise<void> {
    // Restore original console methods
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;

    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
    if (this.logStream) {
      await this.logStream.close();
    }
  }
}

// ============================================================================
// Daemon Server
// ============================================================================

class BrainDaemon {
  private server: FastifyInstance;
  private brain: BrainManager | null = null;
  private toolHandlers: Record<string, (params: any) => Promise<any>> = {};
  private logger: DaemonLogger;
  private idleTimer: NodeJS.Timeout | null = null;
  private startTime: Date;
  private requestCount: number = 0;
  private lastActivity: Date;

  constructor() {
    this.logger = new DaemonLogger();
    this.startTime = new Date();
    this.lastActivity = new Date();

    this.server = Fastify({
      logger: false, // We use our own logger
    });
  }

  async initialize(): Promise<void> {
    await this.logger.initialize();

    // Register CORS for dashboard access
    await this.server.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'DELETE'],
    });

    // Setup routes
    this.setupRoutes();

    // Setup error handlers
    this.setupErrorHandlers();

    // Initialize BrainManager
    await this.initializeBrain();

    // Reset idle timer on each request
    this.server.addHook('onRequest', async () => {
      this.resetIdleTimer();
      this.requestCount++;
      this.lastActivity = new Date();
    });

    this.logger.info('Daemon initialized successfully');
  }

  private async initializeBrain(): Promise<void> {
    try {
      this.logger.info('Initializing BrainManager...');
      this.brain = await BrainManager.getInstance();
      await this.brain.initialize();
      this.logger.info('BrainManager ready');

      // Generate tool handlers
      this.logger.info('Generating tool handlers...');
      const brainCtx: BrainToolsContext = { brain: this.brain };
      const imageCtx: ImageToolsContext = {
        projectRoot: process.cwd(),
        onContentExtracted: async (params) => {
          return await this.brain!.updateMediaContent(params);
        },
      };
      const threeDCtx: ThreeDToolsContext = {
        projectRoot: process.cwd(),
        onContentExtracted: async (params) => {
          return await this.brain!.updateMediaContent(params);
        },
      };

      const brainHandlers = generateBrainToolHandlers(brainCtx);
      const setupHandlers = generateSetupToolHandlers(brainCtx);
      const imageTools = generateImageTools(imageCtx);
      const threeDTools = generate3DTools(threeDCtx);

      this.toolHandlers = {
        ...brainHandlers,
        ...setupHandlers,
        ...imageTools.handlers,
        ...threeDTools.handlers,
      };

      this.logger.info(`${Object.keys(this.toolHandlers).length} tools ready`);
    } catch (error: any) {
      this.logger.error('Failed to initialize BrainManager', { error: error.message });
      throw error;
    }
  }

  private setupRoutes(): void {
    // Health check
    this.server.get('/health', async () => {
      return { status: 'ok', timestamp: getLocalTimestamp() };
    });

    // Daemon status
    this.server.get('/status', async () => {
      const uptime = Date.now() - this.startTime.getTime();
      const watchers = this.brain?.getWatchedProjects() || [];
      const projects = this.brain?.listProjects() || [];

      return {
        status: 'running',
        pid: process.pid,
        port: DEFAULT_PORT,
        uptime_ms: uptime,
        uptime_human: this.formatUptime(uptime),
        started_at: getLocalTimestamp(this.startTime),
        last_activity: getLocalTimestamp(this.lastActivity),
        request_count: this.requestCount,
        idle_timeout_ms: IDLE_TIMEOUT_MS,
        brain: {
          connected: !!this.brain,
          projects: projects.length,
          active_watchers: watchers.length,
          watched_projects: watchers,
        },
        tools: {
          count: Object.keys(this.toolHandlers).length,
        },
        memory: {
          rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        },
      };
    });

    // List projects
    this.server.get('/projects', async () => {
      if (!this.brain) {
        return { error: 'BrainManager not initialized' };
      }
      return { projects: this.brain.listProjects() };
    });

    // List watchers
    this.server.get('/watchers', async () => {
      if (!this.brain) {
        return { error: 'BrainManager not initialized' };
      }
      return { watchers: this.brain.getWatchedProjects() };
    });

    // List available tools
    this.server.get('/tools', async () => {
      return {
        tools: Object.keys(this.toolHandlers).sort(),
        count: Object.keys(this.toolHandlers).length,
      };
    });

    // Call a tool
    this.server.post<{
      Params: { toolName: string };
      Body: Record<string, any>;
    }>('/tool/:toolName', async (request, reply) => {
      const { toolName } = request.params;
      const args = request.body || {};

      this.logger.info(`Tool call: ${toolName}`, { args: Object.keys(args) });

      try {
        const handler = this.toolHandlers[toolName];
        if (!handler) {
          this.logger.warn(`Unknown tool: ${toolName}`);
          reply.status(404);
          return {
            success: false,
            error: `Unknown tool: ${toolName}`,
            available_tools: Object.keys(this.toolHandlers).sort(),
          };
        }

        const startTime = Date.now();
        const result = await handler(args);
        const duration = Date.now() - startTime;

        this.logger.info(`Tool ${toolName} completed in ${duration}ms`);
        return { success: true, result, duration_ms: duration };
      } catch (error: any) {
        this.logger.error(`Tool ${toolName} failed`, {
          error: error.message,
          stack: error.stack,
        });
        reply.status(500);
        return { success: false, error: error.message };
      }
    });

    // Graceful shutdown
    this.server.post('/shutdown', async () => {
      this.logger.info('Shutdown requested via API');

      // Schedule shutdown after response
      setTimeout(() => this.shutdown(), 100);

      return { status: 'shutting_down' };
    });

    // View recent logs
    this.server.get<{
      Querystring: { lines?: string };
    }>('/logs', async (request) => {
      const lines = parseInt(request.query.lines || '100', 10);

      try {
        const content = await fs.readFile(LOG_FILE, 'utf-8');
        const allLines = content.trim().split('\n');
        const recentLines = allLines.slice(-lines);
        return {
          log_file: LOG_FILE,
          total_lines: allLines.length,
          returned_lines: recentLines.length,
          logs: recentLines
        };
      } catch {
        return { logs: [], error: 'Could not read log file' };
      }
    });
  }

  private setupErrorHandlers(): void {
    // Uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack
      });
    });

    // Unhandled rejections
    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection', { reason: String(reason) });
    });

    // Graceful shutdown signals
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM');
      this.shutdown();
    });
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.logger.info(`Idle timeout reached (${IDLE_TIMEOUT_MS / 1000}s), shutting down...`);
      this.shutdown();
    }, IDLE_TIMEOUT_MS);
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async start(): Promise<void> {
    const port = parseInt(process.env.RAGFORGE_DAEMON_PORT || String(DEFAULT_PORT), 10);

    try {
      await this.server.listen({ port, host: '127.0.0.1' });

      // Write PID file
      await fs.mkdir(path.dirname(PID_FILE), { recursive: true });
      await fs.writeFile(PID_FILE, String(process.pid));

      this.logger.info(`Daemon listening on http://127.0.0.1:${port}`);
      this.logger.info(`Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`);

      // Start idle timer
      this.resetIdleTimer();

      console.log(`🧠 Brain Daemon running on http://127.0.0.1:${port}`);
      console.log(`📝 Logs: ${LOG_FILE}`);
      console.log(`⏰ Auto-shutdown after ${IDLE_TIMEOUT_MS / 1000}s of inactivity`);
    } catch (error: any) {
      this.logger.error('Failed to start server', { error: error.message });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down daemon...');

    // Clear idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    // Shutdown BrainManager (stops watchers, closes connections)
    if (this.brain) {
      try {
        await this.brain.shutdown();
        this.logger.info('BrainManager shutdown complete');
      } catch (error: any) {
        this.logger.error('Error during BrainManager shutdown', { error: error.message });
      }
    }

    // Remove PID file
    try {
      await fs.unlink(PID_FILE);
    } catch {
      // Ignore if doesn't exist
    }

    // Close server
    await this.server.close();

    this.logger.info('Daemon shutdown complete');
    await this.logger.close();

    process.exit(0);
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

export async function startDaemon(options: { detached?: boolean; verbose?: boolean } = {}): Promise<void> {
  if (options.verbose) {
    process.env.RAGFORGE_DAEMON_VERBOSE = '1';
  }

  if (options.detached) {
    // Spawn detached process
    const { spawn } = await import('child_process');
    const child = spawn(process.execPath, [process.argv[1], 'daemon', 'start'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(`🧠 Brain Daemon started in background (PID: ${child.pid})`);
    return;
  }

  const daemon = new BrainDaemon();
  await daemon.initialize();
  await daemon.start();
}

export async function stopDaemon(): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/shutdown`, {
      method: 'POST',
    });

    if (response.ok) {
      console.log('🛑 Daemon shutdown initiated');
    } else {
      console.log('❌ Failed to stop daemon');
    }
  } catch {
    console.log('ℹ️  Daemon is not running');
  }
}

interface DaemonStatusResponse {
  status: string;
  pid: number;
  port: number;
  uptime_human: string;
  request_count: number;
  last_activity: string;
  memory: { heap_used_mb: number; rss_mb: number };
  brain: { projects: number; active_watchers: number; watched_projects: string[] };
}

export async function getDaemonStatus(): Promise<void> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/status`);

    if (response.ok) {
      const status = await response.json() as DaemonStatusResponse;
      console.log('🧠 Brain Daemon Status');
      console.log('─'.repeat(40));
      console.log(`Status: ${status.status}`);
      console.log(`PID: ${status.pid}`);
      console.log(`Port: ${status.port}`);
      console.log(`Uptime: ${status.uptime_human}`);
      console.log(`Requests: ${status.request_count}`);
      console.log(`Last activity: ${status.last_activity}`);
      console.log(`Memory: ${status.memory.heap_used_mb}MB heap / ${status.memory.rss_mb}MB RSS`);
      console.log('─'.repeat(40));
      console.log(`Projects: ${status.brain.projects}`);
      console.log(`Active watchers: ${status.brain.active_watchers}`);
      if (status.brain.watched_projects.length > 0) {
        console.log(`Watched: ${status.brain.watched_projects.join(', ')}`);
      }
    } else {
      console.log('❌ Daemon returned error');
    }
  } catch {
    console.log('ℹ️  Daemon is not running');
  }
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEFAULT_PORT}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Export port for client usage
export const DAEMON_PORT = DEFAULT_PORT;

// ============================================================================
// Entry Point (when run directly)
// ============================================================================

// Check if this file is being run directly (not imported)
const isMainModule = process.argv[1]?.includes('daemon');

if (isMainModule) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'start':
      startDaemon({
        verbose: args.includes('-v') || args.includes('--verbose'),
      }).catch((error) => {
        console.error('Failed to start daemon:', error);
        process.exit(1);
      });
      break;

    case 'stop':
      stopDaemon().then(() => process.exit(0));
      break;

    case 'status':
      getDaemonStatus().then(() => process.exit(0));
      break;

    default:
      console.log(`
Brain Daemon - Keeps BrainManager alive for fast tool execution

Usage:
  daemon start [-v]    Start the daemon
  daemon stop          Stop the daemon
  daemon status        Show daemon status
`);
      process.exit(0);
  }
}
