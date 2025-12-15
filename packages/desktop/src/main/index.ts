import { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } from 'electron';
import { join } from 'path';
import { homedir } from 'os';
import { promises as fs, statSync } from 'fs';
import { spawn, ChildProcess } from 'child_process';

// Daemon API configuration
const DAEMON_PORT = 6969;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const STARTUP_TIMEOUT_MS = 30000;
const STARTUP_CHECK_INTERVAL_MS = 500;

// Disable sandbox for development on Linux
app.commandLine.appendSwitch('no-sandbox');

// Store the initial working directory
const initialCwd = process.cwd();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const iconPath = process.env.NODE_ENV === 'development'
    ? join(initialCwd, 'public', 'ragforge_logo.png')
    : join(__dirname, '../renderer/ragforge_logo.png');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ============================================
// Daemon API helpers
// ============================================

async function callDaemonTool(toolName: string, params: Record<string, any>): Promise<{ success: boolean; result?: any; error?: string }> {
  // Ensure daemon is running (auto-start if needed)
  const daemonReady = await ensureDaemonRunning();
  if (!daemonReady) {
    return { success: false, error: 'Daemon not available. Install ragforge CLI globally: npm install -g @luciformresearch/ragforge-cli' };
  }

  try {
    const response = await fetch(`${DAEMON_URL}/tool/${toolName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await response.json();
  } catch (error: any) {
    return { success: false, error: error.message || 'Daemon request failed' };
  }
}

async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, { method: 'GET', signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function getDaemonStatus(): Promise<any | null> {
  try {
    const response = await fetch(`${DAEMON_URL}/status`);
    if (response.ok) return await response.json();
  } catch {}
  return null;
}

// Ensure daemon is running, start it if needed
let daemonStartPromise: Promise<boolean> | null = null;

async function ensureDaemonRunning(): Promise<boolean> {
  // If already checking/starting, wait for that
  if (daemonStartPromise) return daemonStartPromise;

  daemonStartPromise = (async () => {
    try {
      // First check if already running
      if (await isDaemonRunning()) {
        return true;
      }

      console.log('[Desktop] Starting daemon...');

      // Spawn ragforge daemon start in background
      const child = spawn('ragforge', ['daemon', 'start'], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      child.unref();

      // Wait for daemon to be ready
      const startTime = Date.now();
      while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, STARTUP_CHECK_INTERVAL_MS));
        if (await isDaemonRunning()) {
          console.log('[Desktop] Daemon started successfully');
          return true;
        }
      }

      console.error('[Desktop] Failed to start daemon within timeout');
      return false;
    } finally {
      daemonStartPromise = null;
    }
  })();

  return daemonStartPromise;
}

// ============================================
// File System IPC Handlers
// ============================================

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

ipcMain.handle('fs:getCwd', (): string => initialCwd);
ipcMain.handle('fs:getHomePath', (): string => homedir());

ipcMain.handle('fs:readDirectory', async (_, dirPath: string): Promise<FileEntry[]> => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: FileEntry[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (['node_modules', 'dist', 'build', '__pycache__', '.git'].includes(entry.name)) continue;

      const fullPath = join(dirPath, entry.name);
      try {
        const stats = statSync(fullPath);
        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? undefined : stats.size,
          modified: stats.mtime.toISOString(),
        });
      } catch { continue; }
    }

    results.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  } catch (error: any) {
    console.error('Error reading directory:', error);
    return [];
  }
});

ipcMain.handle('fs:readFile', async (_, filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch { return null; }
});

ipcMain.handle('fs:readBinaryFile', async (_, filePath: string): Promise<string | null> => {
  try {
    const buffer = await fs.readFile(filePath);
    return buffer.toString('base64');
  } catch { return null; }
});

ipcMain.handle('fs:getStats', async (_, filePath: string): Promise<{ size: number; modified: string } | null> => {
  try {
    const stats = await fs.stat(filePath);
    return { size: stats.size, modified: stats.mtime.toISOString() };
  } catch { return null; }
});

ipcMain.handle('fs:getDirectoryStats', async (_, dirPath: string): Promise<{ fileCount: number; dirCount: number; totalSize: number }> => {
  let fileCount = 0, dirCount = 0, totalSize = 0;

  async function countRecursive(path: string, depth: number) {
    if (depth > 3) return;
    try {
      const entries = await fs.readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;

        const fullPath = join(path, entry.name);
        if (entry.isDirectory()) {
          dirCount++;
          await countRecursive(fullPath, depth + 1);
        } else {
          fileCount++;
          try { totalSize += statSync(fullPath).size; } catch {}
        }
      }
    } catch {}
  }

  await countRecursive(dirPath, 0);
  return { fileCount, dirCount, totalSize };
});

ipcMain.handle('fs:readTextPreview', async (_, filePath: string, maxLines = 50): Promise<string | null> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content.split('\n').slice(0, maxLines).join('\n');
  } catch { return null; }
});

ipcMain.handle('fs:getThumbnail', async (_, filePath: string): Promise<string | null> => {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return null;
    return image.resize({ width: 128, height: 128, quality: 'good' }).toDataURL();
  } catch { return null; }
});

ipcMain.handle('fs:openWithEditor', async (_, filePath: string): Promise<boolean> => {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try { await execAsync('which codium'); exec(`codium "${filePath}"`); return true; } catch {}
    try { await execAsync('which code'); exec(`code "${filePath}"`); return true; } catch {}

    await shell.openPath(filePath);
    return true;
  } catch { return false; }
});

// ============================================
// Shell/Dialog IPC Handlers
// ============================================

ipcMain.handle('shell:openExternal', async (_, url: string) => shell.openExternal(url));

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

// Terminal shell execution
let currentProcess: ChildProcess | null = null;
let shellCwd = initialCwd;

ipcMain.handle('shell:setCwd', (_, cwd: string) => { shellCwd = cwd; });

ipcMain.handle('shell:exec', (_, command: string) => {
  if (currentProcess) currentProcess.kill();

  const shellPath = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

  currentProcess = spawn(shellPath, shellArgs, {
    cwd: shellCwd,
    env: process.env as { [key: string]: string },
  });

  currentProcess.stdout?.on('data', (data) => mainWindow?.webContents.send('shell:stdout', data.toString()));
  currentProcess.stderr?.on('data', (data) => mainWindow?.webContents.send('shell:stderr', data.toString()));
  currentProcess.on('close', (code) => { mainWindow?.webContents.send('shell:exit', code); currentProcess = null; });

  return true;
});

ipcMain.handle('shell:kill', () => {
  if (currentProcess) { currentProcess.kill(); currentProcess = null; }
});

// ============================================
// Daemon status IPC Handler
// ============================================

ipcMain.handle('daemon:status', async () => {
  const running = await isDaemonRunning();
  if (!running) return { running: false };
  const status = await getDaemonStatus();
  return { running: true, ...status };
});

// ============================================
// Search IPC Handlers - All via Daemon
// ============================================

interface SearchResult {
  type: 'semantic' | 'grep';
  file: string;
  line?: number;
  content?: string;
  match?: string;
  score?: number;
  name?: string;
  nodeType?: string;
  snippet?: string;
}

interface CombinedSearchResult {
  results: SearchResult[];
  semanticCount: number;
  grepCount: number;
  error?: string;
}

// Combined search via daemon
ipcMain.handle('search:combined', async (_, params: {
  query: string;
  basePath: string;
  indexedOnly?: boolean;
  limit?: number;
}): Promise<CombinedSearchResult> => {
  const { query, basePath, indexedOnly = false, limit = 30 } = params;
  const results: SearchResult[] = [];
  let semanticCount = 0;
  let grepCount = 0;
  let error: string | undefined;

  // Brain semantic search via daemon
  // Note: RRF scores are much lower than raw similarity scores, so don't use min_score
  // base_path filters results server-side to only include files under basePath
  const brainResult = await callDaemonTool('brain_search', {
    query,
    semantic: true,
    base_path: basePath,
    limit: Math.floor(limit / 2),
  });

  if (brainResult.success && brainResult.result?.results) {
    for (const r of brainResult.result.results) {
      results.push({
        type: 'semantic',
        file: r.filePath,
        line: r.matchedRange?.startLine,
        score: r.score,
        name: r.node?.name || r.node?.title,
        nodeType: r.node?.type || r.node?.labels?.[0],
        snippet: r.node?.content?.substring(0, 200) || r.node?.description?.substring(0, 200),
      });
      semanticCount++;
    }
  } else if (brainResult.error) {
    error = brainResult.error;
  }

  // TODO: Add local grep search for non-indexed files
  // The daemon doesn't have grep_files - we'd need to either:
  // 1. Add it to the daemon
  // 2. Implement local grep using ripgrep or Node.js
  // For now, we only use brain_search (semantic search on indexed files)

  // Sort: semantic first (by score), then grep
  results.sort((a, b) => {
    if (a.type === 'semantic' && b.type === 'grep') return -1;
    if (a.type === 'grep' && b.type === 'semantic') return 1;
    if (a.type === 'semantic' && b.type === 'semantic') return (b.score || 0) - (a.score || 0);
    return a.file.localeCompare(b.file);
  });

  return { results: results.slice(0, limit), semanticCount, grepCount, error };
});

// List indexed projects via daemon
ipcMain.handle('search:projects', async () => {
  try {
    const response = await fetch(`${DAEMON_URL}/projects`);
    if (response.ok) {
      const projects = await response.json();
      return { projects, error: undefined };
    }
  } catch {}
  return { projects: [], error: 'Daemon not available' };
});

// ============================================
// Agent IPC Handlers
// ============================================

interface AgentChatResponse {
  conversationId: string;
  content: string;
  toolCalls?: Array<{ name: string; success: boolean; duration?: number }>;
}

// Chat with Research Agent via daemon (SSE streaming)
ipcMain.handle('agent:chat', async (event, message: string, conversationId?: string | null, cwd?: string): Promise<AgentChatResponse> => {
  const running = await isDaemonRunning();
  if (!running) {
    throw new Error('Daemon not running');
  }

  try {
    const response = await fetch(`${DAEMON_URL}/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversationId: conversationId || undefined, cwd: cwd || undefined }),
    });

    if (!response.ok) {
      throw new Error(`Daemon error: ${response.status}`);
    }

    // Parse SSE stream
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalContent = '';
    let finalConversationId = conversationId || '';
    const toolCalls: Array<{ name: string; success: boolean; duration?: number }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            // Forward events to all windows (main and chat popout)
            if (mainWindow) {
              mainWindow.webContents.send('agent:event', data);
            }
            if (chatWindow) {
              chatWindow.webContents.send('agent:event', data);
            }

            // Track tool calls
            if (data.type === 'tool_result') {
              toolCalls.push({
                name: data.name,
                success: data.success,
                duration: data.duration,
              });
            }

            // Capture report updates for streaming display
            if (data.type === 'report_update') {
              finalContent = data.report;
            }

            // Capture final response
            if (data.type === 'response') {
              finalContent = data.message;
              finalConversationId = data.conversationId || finalConversationId;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    }

    return {
      conversationId: finalConversationId,
      content: finalContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  } catch (err: any) {
    throw new Error(err.message || 'Agent chat failed');
  }
});

// List agent conversations
ipcMain.handle('agent:conversations', async (): Promise<Array<{ id: string; title: string; updatedAt: string }>> => {
  const running = await isDaemonRunning();
  if (!running) {
    return [];
  }

  try {
    const response = await fetch(`${DAEMON_URL}/agent/conversations`);
    if (response.ok) {
      const data = await response.json();
      return data.conversations || [];
    }
  } catch (err) {
    console.error('Failed to list conversations:', err);
  }
  return [];
});

// Get a specific conversation with messages
ipcMain.handle('agent:getConversation', async (_event, conversationId: string): Promise<{ id: string; title: string; messages: any[] }> => {
  const running = await isDaemonRunning();
  if (!running) {
    throw new Error('Daemon not running');
  }

  try {
    const response = await fetch(`${DAEMON_URL}/agent/conversations/${conversationId}`);
    if (response.ok) {
      return await response.json();
    }
    throw new Error(`Failed to get conversation: ${response.status}`);
  } catch (err) {
    console.error('Failed to get conversation:', err);
    throw err;
  }
});

// ============================================
// Chat Pop-out Window
// ============================================

let chatWindow: BrowserWindow | null = null;

ipcMain.handle('chat:popOut', async () => {
  if (chatWindow) {
    // Already open - focus it
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 500,
    height: 700,
    minWidth: 350,
    minHeight: 400,
    title: 'RagForge - Research Assistant',
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  // Load chat mode URL
  if (import.meta.env.DEV) {
    chatWindow.loadURL(`http://localhost:5173?mode=chat`);
  } else {
    chatWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { mode: 'chat' } });
  }

  // Notify main window when chat window is closed
  chatWindow.on('closed', () => {
    chatWindow = null;
    if (mainWindow) {
      mainWindow.webContents.send('chat:poppedIn');
    }
  });

  // Forward agent events to chat window as well
  if (mainWindow) {
    // We need to intercept agent events and forward to both windows
    // This is handled by checking both windows in the agent:chat handler
  }
});

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
