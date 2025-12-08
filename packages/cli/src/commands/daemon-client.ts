/**
 * Brain Daemon Client
 *
 * HTTP client for communicating with the Brain Daemon.
 * Used by test-tool and other CLI commands to call tools via the daemon.
 *
 * @since 2025-12-08
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { getLocalTimestamp } from '@luciformresearch/ragforge';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAEMON_PORT = 6969;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const STARTUP_TIMEOUT_MS = 30000; // 30 seconds to start daemon
const STARTUP_CHECK_INTERVAL_MS = 500;
const LOG_DIR = path.join(os.homedir(), '.ragforge', 'logs');
const CLIENT_LOG_FILE = path.join(LOG_DIR, 'daemon-client.log');

/**
 * Log to file for debugging
 */
async function logToFile(level: string, message: string, meta?: any): Promise<void> {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const timestamp = getLocalTimestamp();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
    await fs.appendFile(CLIENT_LOG_FILE, line);
  } catch {
    // Ignore logging errors
  }
}

/**
 * Check if the daemon is running
 */
export async function isDaemonRunning(): Promise<boolean> {
  const url = `${DAEMON_URL}/health`;
  await logToFile('debug', `Checking daemon health at ${url}`);

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(2000),
    });
    const isRunning = response.ok;
    await logToFile('debug', `Daemon health check result`, { ok: isRunning, status: response.status });
    return isRunning;
  } catch (error: any) {
    await logToFile('debug', `Daemon health check failed`, { error: error.message, code: error.code });
    return false;
  }
}

/**
 * Start the daemon in background if not running
 */
export async function ensureDaemonRunning(verbose: boolean = false): Promise<boolean> {
  await logToFile('info', 'ensureDaemonRunning called', { verbose });

  const alreadyRunning = await isDaemonRunning();
  if (alreadyRunning) {
    await logToFile('info', 'Daemon already running');
    if (verbose) {
      console.log('✓ Daemon already running');
    }
    return true;
  }

  await logToFile('info', 'Daemon not running, starting...');
  if (verbose) {
    console.log('⏳ Starting daemon...');
  }

  // Find the daemon script - try multiple locations
  const possiblePaths = [
    path.join(__dirname, 'daemon.js'),                    // dist/esm/commands/
    path.join(__dirname, '..', 'commands', 'daemon.js'),  // dist/esm/
    path.join(__dirname, 'daemon.ts'),                    // src/commands/ (for tsx)
  ];

  let daemonScript: string | null = null;
  for (const p of possiblePaths) {
    await logToFile('debug', `Checking daemon script at: ${p}`);
    try {
      await fs.access(p);
      daemonScript = p;
      await logToFile('info', `Found daemon script at: ${p}`);
      break;
    } catch {
      // Continue to next path
    }
  }

  if (!daemonScript) {
    await logToFile('error', 'Could not find daemon script', { tried: possiblePaths });
    console.error('❌ Could not find daemon script');
    return false;
  }

  // Spawn daemon in background
  const isTs = daemonScript.endsWith('.ts');

  // For .ts files, use npx tsx; for .js files, use node directly
  let command: string;
  let args: string[];

  if (isTs) {
    command = 'npx';
    args = ['tsx', daemonScript, 'start'];
  } else {
    command = process.execPath;
    args = [daemonScript, 'start'];
  }

  await logToFile('info', 'Spawning daemon process', {
    command,
    args,
    script: daemonScript,
    cwd: process.cwd(),
  });

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: {
      ...process.env,
      RAGFORGE_DAEMON_VERBOSE: verbose ? '1' : '',
    },
    shell: isTs, // Use shell for npx
  });
  child.unref();

  await logToFile('info', `Daemon process spawned with PID: ${child.pid}`);

  // Wait for daemon to be ready
  const startTime = Date.now();
  let attempts = 0;
  while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
    await new Promise(resolve => setTimeout(resolve, STARTUP_CHECK_INTERVAL_MS));
    attempts++;

    if (await isDaemonRunning()) {
      await logToFile('info', `Daemon started after ${attempts} attempts (${Date.now() - startTime}ms)`);
      if (verbose) {
        console.log('✓ Daemon started');
      }
      return true;
    }

    if (attempts % 10 === 0) {
      await logToFile('debug', `Still waiting for daemon... (attempt ${attempts})`);
    }
  }

  await logToFile('error', `Failed to start daemon within timeout (${STARTUP_TIMEOUT_MS}ms, ${attempts} attempts)`);
  console.error('❌ Failed to start daemon within timeout');
  return false;
}

/**
 * Call a tool via the daemon
 */
export async function callToolViaDaemon(
  toolName: string,
  params: Record<string, any>,
  options: { verbose?: boolean } = {}
): Promise<{ success: boolean; result?: any; error?: string; duration_ms?: number }> {
  const { verbose = false } = options;
  const callStart = Date.now();

  await logToFile('info', `callToolViaDaemon: ${toolName}`, { params: Object.keys(params) });

  // Ensure daemon is running
  const daemonReady = await ensureDaemonRunning(verbose);
  if (!daemonReady) {
    await logToFile('error', 'Daemon not ready');
    return { success: false, error: 'Failed to start daemon' };
  }

  await logToFile('debug', `Daemon ready after ${Date.now() - callStart}ms`);

  try {
    if (verbose) {
      console.log(`⏳ Calling ${toolName}...`);
    }

    const url = `${DAEMON_URL}/tool/${toolName}`;
    await logToFile('debug', `Calling ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await response.json() as { success: boolean; result?: any; error?: string; duration_ms?: number };

    await logToFile('info', `Tool ${toolName} response`, {
      status: response.status,
      success: data.success,
      duration_ms: data.duration_ms,
      totalTime: Date.now() - callStart,
    });

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    return data;
  } catch (error: any) {
    await logToFile('error', `Tool ${toolName} failed`, { error: error.message });
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get daemon status
 */
export async function getDaemonStatus(): Promise<any | null> {
  try {
    const response = await fetch(`${DAEMON_URL}/status`);
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List available tools
 */
export async function listTools(): Promise<string[]> {
  try {
    const response = await fetch(`${DAEMON_URL}/tools`);
    if (response.ok) {
      const data = await response.json() as { tools?: string[] };
      return data.tools || [];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Stop the daemon
 */
export async function stopDaemon(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/shutdown`, {
      method: 'POST',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get recent logs from daemon
 */
export async function getDaemonLogs(lines: number = 100): Promise<string[]> {
  try {
    const response = await fetch(`${DAEMON_URL}/logs?lines=${lines}`);
    if (response.ok) {
      const data = await response.json() as { logs?: string[] };
      return data.logs || [];
    }
    return [];
  } catch {
    return [];
  }
}

export { DAEMON_PORT, DAEMON_URL };
