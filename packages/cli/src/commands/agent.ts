/**
 * Agent wrapper for TUI
 *
 * Simplified agent creation that wraps the core RagAgent
 * for use with the TUI interface. Project tools are now handled
 * via the daemon/brain approach.
 */

import path from 'path';
import process from 'process';
import { promises as fs } from 'fs';
import {
  createRagAgent,
  createClient,
  ConfigLoader,
  getFilenameTimestamp,
  Neo4jClient,
  ProjectRegistry,
  type RagAgentOptions,
  type ToolGenerationContext,
  type RagForgeConfig,
  type AgentLogger,
  type LoadedProject,
} from '@luciformresearch/ragforge';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import { generateDaemonBrainToolHandlers } from './daemon-client.js';
import { getDaemonBrainProxy } from './daemon-brain-proxy.js';

// ============================================
// Types
// ============================================

export interface AgentOptions {
  /** Project path (default: current directory) */
  project?: string;

  /** Single question to ask (non-interactive mode) */
  ask?: string;

  /** Config file path */
  config?: string;

  /** Model to use */
  model?: string;

  /** Verbose output */
  verbose?: boolean;

  /** Development mode */
  dev?: boolean;

  /** Agent persona for conversational responses */
  persona?: string;

  /** Callback when a tool is about to be called (real-time updates for TUI) */
  onToolCall?: (toolName: string, args: Record<string, any>) => void;

  /** Callback when a tool returns a result (real-time updates for TUI) */
  onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
}

/**
 * Mutable context shared between all tools
 */
export interface AgentProjectContext {
  /** Currently loaded project path (null if no project loaded) */
  currentProjectPath: string | null;

  /** Path to .ragforge/generated folder */
  generatedPath: string | null;

  /** Active RagClient connection */
  ragClient: ReturnType<typeof createClient> | null;

  /** Whether a project is currently loaded */
  isProjectLoaded: boolean;

  /** Dev mode flag */
  dev: boolean;

  /** Root directory for CLI */
  rootDir: string;

  /** API keys for embeddings and media generation */
  geminiKey?: string;
  replicateToken?: string;

  /** Neo4j client for direct queries */
  neo4jClient?: Neo4jClient;

  /** Agent logger for structured logging */
  logger?: AgentLogger;

  /** Project registry for multi-project support */
  registry: ProjectRegistry;
}

/**
 * Create a RagForge agent with brain tools via daemon
 */
export async function createRagForgeAgent(options: AgentOptions) {
  const initialProjectPath = options.project || process.cwd();
  const dev = options.dev || false;
  const verbose = options.verbose || false;
  const rootDir = ensureEnvLoaded(import.meta.url);

  // Get API keys
  const geminiKey = getEnv(['GEMINI_API_KEY'], true) || process.env.GEMINI_API_KEY;
  const replicateToken = getEnv(['REPLICATE_API_TOKEN'], true) || process.env.REPLICATE_API_TOKEN;

  // Create project registry for multi-project support
  const registry = new ProjectRegistry({
    memoryPolicy: {
      maxLoadedProjects: 3,
      idleUnloadTimeout: 5 * 60 * 1000,
    },
  });

  // Create mutable context
  const ctx: AgentProjectContext = {
    currentProjectPath: null,
    generatedPath: null,
    ragClient: null,
    isProjectLoaded: false,
    dev,
    rootDir,
    geminiKey,
    replicateToken,
    registry,
  };

  // Get API key
  const apiKey = geminiKey;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY required. Set in .env or environment.');
  }

  // Minimal config for standalone mode
  const standaloneConfig = {
    name: 'ragforge-agent',
    version: '1.0.0',
    entities: [],
    neo4j: {
      uri: '${NEO4J_URI}',
      username: '${NEO4J_USERNAME}',
      password: '${NEO4J_PASSWORD}',
    },
  };

  // Setup logging directory
  const logsDir = path.join(initialProjectPath, '.ragforge-logs');
  await fs.mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `agent-${getFilenameTimestamp()}.json`);

  // Get brain proxy
  let brainProxy: Awaited<ReturnType<typeof getDaemonBrainProxy>> | null = null;
  try {
    brainProxy = await getDaemonBrainProxy();
  } catch (error: any) {
    if (verbose) {
      console.log(`   ⚠️  Brain proxy not available: ${error.message}`);
    }
  }

  // Create agent with brain tools via daemon
  const agent = await createRagAgent({
    config: standaloneConfig,
    ragClient: createDummyRagClient(ctx),
    apiKey,
    model: options.model || 'gemini-2.0-flash',
    verbose,
    logPath,

    // File tools with dynamic projectRoot
    includeFileTools: true,
    projectRoot: () => ctx.currentProjectPath || initialProjectPath,

    // Auto-update brain when files are modified
    onFileModified: brainProxy
      ? async (filePath: string, changeType: 'created' | 'updated' | 'deleted'): Promise<void> => {
          if (!brainProxy) return;
          const absoluteFilePath = path.resolve(filePath);
          brainProxy.queueFileChange(absoluteFilePath, changeType);
        }
      : undefined,

    // Brain tools via daemon
    includeBrainTools: true,
    customBrainHandlers: generateDaemonBrainToolHandlers(),

    // Locks for enriched context
    getLocks: async () => {
      try {
        const proxy = await getDaemonBrainProxy();
        return await proxy.getLocks();
      } catch {
        return {
          embeddingLock: { isLocked: () => true },
          ingestionLock: { isLocked: () => true }
        };
      }
    },

    // Agent persona
    persona: options.persona,

    // Real-time callbacks for TUI
    onToolCall: options.onToolCall,
    onToolResult: options.onToolResult,
  });

  return {
    agent,
    context: ctx,
    hasProject: ctx.isProjectLoaded,
    projectPath: ctx.currentProjectPath || initialProjectPath,
    generatedPath: ctx.generatedPath,
    logPath,
  };
}

/**
 * Create a dummy RagClient that uses the mutable context
 */
function createDummyRagClient(ctx: AgentProjectContext) {
  return {
    close: async () => {
      if (ctx.ragClient) {
        await ctx.ragClient.close();
      }
    },
    get: (entityType: string) => {
      if (!ctx.ragClient) {
        throw new Error('No project loaded. Use brain tools instead.');
      }
      return ctx.ragClient.get(entityType);
    },
    raw: (cypher: string, params?: Record<string, any>) => {
      if (!ctx.ragClient) {
        throw new Error('No project loaded. Use brain tools instead.');
      }
      return ctx.ragClient.raw(cypher, params);
    },
  };
}

// ============================================
// CLI exports (for backward compatibility)
// ============================================

export function printAgentHelp(): void {
  console.log(`Note: The 'agent' command is deprecated. Use 'ragforge tui' instead.`);
}

export function parseAgentOptions(args: string[]): AgentOptions {
  const options: AgentOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--project':
        options.project = args[++i];
        break;
      case '--ask':
        options.ask = args[++i];
        break;
      case '--config':
        options.config = args[++i];
        break;
      case '--model':
        options.model = args[++i];
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--dev':
        options.dev = true;
        break;
      case '--persona':
        options.persona = args[++i];
        break;
      case '-h':
      case '--help':
        printAgentHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

export async function runAgent(options: AgentOptions): Promise<void> {
  console.log('Note: The agent command is deprecated. Use "ragforge tui" instead.');

  const { agent, logPath } = await createRagForgeAgent(options);

  if (options.ask) {
    const result = await agent.ask(options.ask);
    console.log(result.answer);
  } else {
    console.log('Use --ask "question" or run "ragforge tui" for interactive mode.');
  }
}
