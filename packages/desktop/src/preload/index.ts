import { contextBridge, ipcRenderer } from 'electron';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

export interface SearchResult {
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

export interface CombinedSearchResult {
  results: SearchResult[];
  semanticCount: number;
  grepCount: number;
  error?: string;
}

export interface DaemonStatus {
  running: boolean;
  neo4j?: { connected: boolean };
  projects?: number;
  error?: string;
}

// Chat/Agent types (Phase 4)
export interface AgentChatResponse {
  conversationId: string;
  content: string;
  toolCalls?: Array<{
    name: string;
    success: boolean;
    duration?: number;
  }>;
}

const electronAPI = {
  // File System
  fs: {
    getCwd: (): Promise<string> => ipcRenderer.invoke('fs:getCwd'),
    getHomePath: (): Promise<string> => ipcRenderer.invoke('fs:getHomePath'),
    readDirectory: (dirPath: string): Promise<FileEntry[]> => ipcRenderer.invoke('fs:readDirectory', dirPath),
    readFile: (filePath: string): Promise<string | null> => ipcRenderer.invoke('fs:readFile', filePath),
    readBinaryFile: (filePath: string): Promise<string | null> => ipcRenderer.invoke('fs:readBinaryFile', filePath),
    readTextPreview: (filePath: string, maxLines?: number): Promise<string | null> => ipcRenderer.invoke('fs:readTextPreview', filePath, maxLines),
    getStats: (filePath: string): Promise<{ size: number; modified: string } | null> => ipcRenderer.invoke('fs:getStats', filePath),
    getDirectoryStats: (dirPath: string): Promise<{ fileCount: number; dirCount: number; totalSize: number }> => ipcRenderer.invoke('fs:getDirectoryStats', dirPath),
    getThumbnail: (filePath: string): Promise<string | null> => ipcRenderer.invoke('fs:getThumbnail', filePath),
    openWithEditor: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:openWithEditor', filePath),
  },

  // Shell
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  },

  // Dialog
  dialog: {
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),
  },

  // Shell command execution (terminal)
  terminal: {
    setCwd: (cwd: string): Promise<void> => ipcRenderer.invoke('shell:setCwd', cwd),
    exec: (command: string): Promise<boolean> => ipcRenderer.invoke('shell:exec', command),
    kill: (): Promise<void> => ipcRenderer.invoke('shell:kill'),
    onStdout: (callback: (data: string) => void) => {
      ipcRenderer.on('shell:stdout', (_, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('shell:stdout');
    },
    onStderr: (callback: (data: string) => void) => {
      ipcRenderer.on('shell:stderr', (_, data) => callback(data));
      return () => ipcRenderer.removeAllListeners('shell:stderr');
    },
    onExit: (callback: (exitCode: number) => void) => {
      ipcRenderer.on('shell:exit', (_, exitCode) => callback(exitCode));
      return () => ipcRenderer.removeAllListeners('shell:exit');
    },
  },

  // Daemon (RagForge backend)
  daemon: {
    status: (): Promise<DaemonStatus> => ipcRenderer.invoke('daemon:status'),
  },

  // Search (via daemon)
  search: {
    combined: (params: { query: string; basePath: string; indexedOnly?: boolean; limit?: number }): Promise<CombinedSearchResult> =>
      ipcRenderer.invoke('search:combined', params),
    projects: (): Promise<{ projects: Array<{ id: string; path: string; type: string }>; error?: string }> =>
      ipcRenderer.invoke('search:projects'),
  },

  // Agent (Phase 4 - placeholder until implemented)
  agent: {
    chat: (message: string, conversationId?: string | null, cwd?: string): Promise<AgentChatResponse> =>
      ipcRenderer.invoke('agent:chat', message, conversationId, cwd),
    onEvent: (callback: (event: { type: string; data: any }) => void) => {
      ipcRenderer.on('agent:event', (_, event) => callback(event));
      return () => ipcRenderer.removeAllListeners('agent:event');
    },
    listConversations: (): Promise<Array<{ id: string; title: string; updatedAt: string }>> =>
      ipcRenderer.invoke('agent:conversations'),
    getConversation: (conversationId: string): Promise<{ id: string; title: string; messages: any[] }> =>
      ipcRenderer.invoke('agent:getConversation', conversationId),
  },

  // Chat window (Phase 5 - placeholder until implemented)
  chat: {
    popOut: (): Promise<void> => ipcRenderer.invoke('chat:popOut'),
    onPoppedIn: (callback: () => void) => {
      ipcRenderer.on('chat:poppedIn', () => callback());
      return () => ipcRenderer.removeAllListeners('chat:poppedIn');
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

declare global {
  interface Window {
    electronAPI: typeof electronAPI;
  }
}
