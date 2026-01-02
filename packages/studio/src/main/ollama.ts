/**
 * Ollama Manager - Manages Ollama installation and models
 *
 * Provides detection, installation, and model management for local embeddings.
 */

import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';
import { existsSync, createWriteStream, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import https from 'https';
import http from 'http';

const execAsync = promisify(exec);

const OLLAMA_API_URL = 'http://localhost:11434';
const DEFAULT_EMBEDDING_MODEL = 'mxbai-embed-large';

// Download URLs per platform
const OLLAMA_DOWNLOADS = {
  linux: 'https://ollama.ai/install.sh',
  darwin: 'https://ollama.ai/download/Ollama-darwin.zip',
  win32: 'https://ollama.ai/download/OllamaSetup.exe',
};

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  models?: string[];
  error?: string;
}

export interface ModelPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  percent?: number;
}

export interface InstallProgress {
  stage: 'downloading' | 'installing' | 'complete' | 'error';
  message: string;
  percent?: number;
}

export class OllamaManager {
  private currentProcess: ChildProcess | null = null;

  /**
   * Check if Ollama is installed
   */
  async checkInstalled(): Promise<boolean> {
    const os = platform();

    try {
      if (os === 'win32') {
        // Check Windows paths
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const ollamaPath = join(programFiles, 'Ollama', 'ollama.exe');
        if (existsSync(ollamaPath)) return true;

        // Also check if it's in PATH
        await execAsync('where ollama');
        return true;
      } else {
        // Linux/macOS - check if ollama command exists
        await execAsync('which ollama');
        return true;
      }
    } catch {
      return false;
    }
  }

  /**
   * Check if Ollama service is running and responsive
   */
  async checkRunning(): Promise<boolean> {
    try {
      const response = await this.fetch(`${OLLAMA_API_URL}/api/tags`);
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get full Ollama status including version and models
   */
  async getStatus(): Promise<OllamaStatus> {
    const installed = await this.checkInstalled();

    if (!installed) {
      return {
        installed: false,
        running: false,
        error: 'Ollama is not installed',
      };
    }

    const running = await this.checkRunning();

    if (!running) {
      return {
        installed: true,
        running: false,
        error: 'Ollama is not running. Start it with "ollama serve" or open the Ollama app.',
      };
    }

    // Get version and models
    try {
      // Get version
      let version: string | undefined;
      try {
        const { stdout } = await execAsync('ollama --version');
        version = stdout.trim();
      } catch {
        version = 'unknown';
      }

      // Get models
      const response = await this.fetch(`${OLLAMA_API_URL}/api/tags`);
      const data = await response.json() as { models?: Array<{ name: string }> };
      const models = data.models?.map(m => m.name) || [];

      return {
        installed: true,
        running: true,
        version,
        models,
      };
    } catch (err: any) {
      return {
        installed: true,
        running: true,
        error: err.message,
      };
    }
  }

  /**
   * Check if a specific model is available
   */
  async hasModel(modelName: string): Promise<boolean> {
    const status = await this.getStatus();
    if (!status.models) return false;
    return status.models.some(m => m.startsWith(modelName));
  }

  /**
   * Get installation instructions for the current platform
   */
  getInstallInstructions(): string {
    const os = platform();

    switch (os) {
      case 'linux':
        return 'Run: curl -fsSL https://ollama.ai/install.sh | sh';
      case 'darwin':
        return 'Download from https://ollama.ai/download or run: brew install ollama';
      case 'win32':
        return 'Download from https://ollama.ai/download and run the installer';
      default:
        return 'Visit https://ollama.ai/download for installation instructions';
    }
  }

  /**
   * Install Ollama (platform-specific)
   *
   * @param onProgress - Progress callback
   * @returns true if installation was successful
   */
  async installOllama(onProgress?: (progress: InstallProgress) => void): Promise<boolean> {
    const os = platform();

    try {
      onProgress?.({ stage: 'downloading', message: 'Starting Ollama installation...' });

      switch (os) {
        case 'linux':
          return await this.installLinux(onProgress);
        case 'darwin':
          return await this.installMacOS(onProgress);
        case 'win32':
          return await this.installWindows(onProgress);
        default:
          onProgress?.({ stage: 'error', message: `Unsupported platform: ${os}` });
          return false;
      }
    } catch (err: any) {
      onProgress?.({ stage: 'error', message: `Installation failed: ${err.message}` });
      return false;
    }
  }

  /**
   * Install Ollama on Linux using the official install script
   */
  private async installLinux(onProgress?: (progress: InstallProgress) => void): Promise<boolean> {
    onProgress?.({ stage: 'downloading', message: 'Downloading Ollama install script...', percent: 10 });

    return new Promise((resolve) => {
      const process = spawn('sh', ['-c', 'curl -fsSL https://ollama.ai/install.sh | sh'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
        onProgress?.({ stage: 'installing', message: data.toString().trim(), percent: 50 });
      });

      process.stderr?.on('data', (data) => {
        output += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          onProgress?.({ stage: 'complete', message: 'Ollama installed successfully!', percent: 100 });
          resolve(true);
        } else {
          onProgress?.({ stage: 'error', message: `Installation failed with code ${code}` });
          resolve(false);
        }
      });

      process.on('error', (err) => {
        onProgress?.({ stage: 'error', message: `Failed to run installer: ${err.message}` });
        resolve(false);
      });
    });
  }

  /**
   * Install Ollama on macOS
   */
  private async installMacOS(onProgress?: (progress: InstallProgress) => void): Promise<boolean> {
    // Try homebrew first
    try {
      onProgress?.({ stage: 'downloading', message: 'Checking for Homebrew...', percent: 10 });
      await execAsync('which brew');

      onProgress?.({ stage: 'installing', message: 'Installing via Homebrew...', percent: 30 });

      return new Promise((resolve) => {
        const process = spawn('brew', ['install', 'ollama'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        process.stdout?.on('data', (data) => {
          onProgress?.({ stage: 'installing', message: data.toString().trim(), percent: 60 });
        });

        process.on('close', (code) => {
          if (code === 0) {
            onProgress?.({ stage: 'complete', message: 'Ollama installed successfully!', percent: 100 });
            resolve(true);
          } else {
            onProgress?.({ stage: 'error', message: `Homebrew installation failed` });
            resolve(false);
          }
        });

        process.on('error', () => resolve(false));
      });
    } catch {
      // Homebrew not available, download the app
      onProgress?.({ stage: 'downloading', message: 'Downloading Ollama app...', percent: 20 });

      const downloadUrl = OLLAMA_DOWNLOADS.darwin;
      const tempFile = join(tmpdir(), 'Ollama.zip');

      const success = await this.downloadFile(downloadUrl, tempFile, (percent) => {
        onProgress?.({ stage: 'downloading', message: `Downloading: ${percent}%`, percent });
      });

      if (!success) {
        onProgress?.({ stage: 'error', message: 'Download failed' });
        return false;
      }

      // Unzip and move to Applications
      onProgress?.({ stage: 'installing', message: 'Extracting and installing...', percent: 80 });

      try {
        await execAsync(`unzip -o "${tempFile}" -d /Applications`);
        unlinkSync(tempFile);
        onProgress?.({ stage: 'complete', message: 'Ollama installed! Please open the Ollama app.', percent: 100 });
        return true;
      } catch (err: any) {
        onProgress?.({ stage: 'error', message: `Failed to extract: ${err.message}` });
        return false;
      }
    }
  }

  /**
   * Install Ollama on Windows
   */
  private async installWindows(onProgress?: (progress: InstallProgress) => void): Promise<boolean> {
    const downloadUrl = OLLAMA_DOWNLOADS.win32;
    const tempFile = join(tmpdir(), 'OllamaSetup.exe');

    onProgress?.({ stage: 'downloading', message: 'Downloading Ollama installer...', percent: 10 });

    const success = await this.downloadFile(downloadUrl, tempFile, (percent) => {
      onProgress?.({ stage: 'downloading', message: `Downloading: ${percent}%`, percent });
    });

    if (!success) {
      onProgress?.({ stage: 'error', message: 'Download failed' });
      return false;
    }

    // Run the installer
    onProgress?.({ stage: 'installing', message: 'Running installer (follow the prompts)...', percent: 70 });

    return new Promise((resolve) => {
      const process = spawn(tempFile, ['/S'], { // /S for silent install
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      process.on('close', (code) => {
        try { unlinkSync(tempFile); } catch {}

        if (code === 0) {
          onProgress?.({ stage: 'complete', message: 'Ollama installed successfully!', percent: 100 });
          resolve(true);
        } else {
          onProgress?.({ stage: 'error', message: `Installer exited with code ${code}` });
          resolve(false);
        }
      });

      process.on('error', (err) => {
        onProgress?.({ stage: 'error', message: `Failed to run installer: ${err.message}` });
        resolve(false);
      });

      // For non-silent installs, consider it started
      setTimeout(() => {
        onProgress?.({ stage: 'complete', message: 'Installer started. Please complete the installation.', percent: 100 });
        resolve(true);
      }, 3000);
    });
  }

  /**
   * Start Ollama service
   */
  async startOllama(): Promise<boolean> {
    const os = platform();

    // Check if already running
    if (await this.checkRunning()) {
      return true;
    }

    try {
      if (os === 'darwin') {
        // On macOS, try to open the app
        await execAsync('open -a Ollama');
      } else if (os === 'linux') {
        // On Linux, start ollama serve in background
        this.currentProcess = spawn('ollama', ['serve'], {
          stdio: 'ignore',
          detached: true,
        });
        this.currentProcess.unref();
      } else if (os === 'win32') {
        // On Windows, start the service
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const ollamaPath = join(programFiles, 'Ollama', 'ollama.exe');

        this.currentProcess = spawn(ollamaPath, ['serve'], {
          stdio: 'ignore',
          detached: true,
        });
        this.currentProcess.unref();
      }

      // Wait for it to start
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await this.checkRunning()) {
          return true;
        }
      }

      return false;
    } catch (err) {
      console.error('Failed to start Ollama:', err);
      return false;
    }
  }

  /**
   * Pull a model with progress callback
   */
  async pullModel(
    modelName: string = DEFAULT_EMBEDDING_MODEL,
    onProgress?: (progress: ModelPullProgress) => void
  ): Promise<boolean> {
    if (!await this.checkRunning()) {
      onProgress?.({ status: 'error: Ollama is not running' });
      return false;
    }

    try {
      onProgress?.({ status: `Pulling model ${modelName}...` });

      return new Promise((resolve) => {
        const process = spawn('ollama', ['pull', modelName], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        process.stdout?.on('data', (data) => {
          const line = data.toString().trim();

          // Parse progress from ollama output
          const progressMatch = line.match(/(\d+)%/);
          const percent = progressMatch ? parseInt(progressMatch[1]) : undefined;

          onProgress?.({
            status: line,
            percent,
          });
        });

        process.stderr?.on('data', (data) => {
          onProgress?.({ status: data.toString().trim() });
        });

        process.on('close', (code) => {
          if (code === 0) {
            onProgress?.({ status: 'Model pulled successfully!', percent: 100 });
            resolve(true);
          } else {
            onProgress?.({ status: `Pull failed with code ${code}` });
            resolve(false);
          }
        });

        process.on('error', (err) => {
          onProgress?.({ status: `Error: ${err.message}` });
          resolve(false);
        });
      });
    } catch (err: any) {
      onProgress?.({ status: `Error: ${err.message}` });
      return false;
    }
  }

  /**
   * Get the default embedding model name
   */
  getDefaultEmbeddingModel(): string {
    return DEFAULT_EMBEDDING_MODEL;
  }

  /**
   * Helper: Download a file with progress
   */
  private downloadFile(
    url: string,
    destPath: string,
    onProgress?: (percent: number) => void
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, {
        headers: { 'User-Agent': 'RagForge-Studio' }
      }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            this.downloadFile(redirectUrl, destPath, onProgress).then(resolve);
            return;
          }
        }

        const totalSize = parseInt(response.headers['content-length'] || '0');
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize > 0) {
            const percent = Math.round((downloadedSize / totalSize) * 100);
            onProgress?.(percent);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve(true);
        });

        file.on('error', (err) => {
          file.close();
          console.error('Download error:', err);
          resolve(false);
        });
      }).on('error', (err) => {
        file.close();
        console.error('Request error:', err);
        resolve(false);
      });
    });
  }

  /**
   * Helper: Simple fetch implementation
   */
  private fetch(url: string): Promise<{ status: number; json: () => Promise<any> }> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          resolve({
            status: response.statusCode || 500,
            json: async () => JSON.parse(data),
          });
        });
      }).on('error', reject);
    });
  }
}
