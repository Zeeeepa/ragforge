/**
 * Research Agent - A focused agent for information gathering and report generation
 *
 * Unlike RagAgent which has 70+ tools for general coding tasks, ResearchAgent
 * is optimized for research workflows:
 * - Reading files (code, images, PDFs, documents)
 * - Semantic search in the knowledge base
 * - Exploring file systems
 * - Ingesting new content when needed
 * - Producing comprehensive markdown reports
 *
 * Includes full conversation memory with:
 * - Automatic L1/L2 summarization
 * - Semantic search across conversation history
 * - Enriched context from codebase
 */

import { StructuredLLMExecutor, BaseToolExecutor, type ToolCallRequest, type ProgressiveOutputConfig } from '../llm/structured-llm-executor.js';
import { GeminiAPIProvider } from '../reranking/gemini-api-provider.js';
import { type ToolDefinition } from '../llm/native-tool-calling/index.js';
import {
  generateFileTools,
  type FileToolsContext,
} from '../../tools/file-tools.js';
import {
  generateFsTools,
  type FsToolsContext,
} from '../../tools/fs-tools.js';
import {
  generateBrainSearchTool,
  generateBrainSearchHandler,
  generateIngestDirectoryTool,
  generateIngestDirectoryHandler,
  type BrainToolsContext,
} from '../../tools/brain-tools.js';
import type { GeneratedToolDefinition } from '../../tools/types/index.js';
import type { ConversationStorage } from '../conversation/storage.js';
import type { ConversationSummarizer, ConversationTurn } from '../conversation/summarizer.js';
import type { Summary } from '../conversation/types.js';
import type { BrainManager } from '../../brain/brain-manager.js';
import type { GeminiEmbeddingProvider } from '../embedding/embedding-provider.js';

// ============================================
// Types
// ============================================

export interface ResearchAgentOptions {
  /** Gemini API key (defaults to GEMINI_API_KEY env var) */
  apiKey?: string;

  /** Model to use (default: gemini-2.0-flash) */
  model?: string;

  /** Temperature for LLM (default: 0.2 - slightly more creative for research) */
  temperature?: number;

  /** Max iterations for tool loop within each research round (default: 10) */
  maxIterations?: number;

  /** Max research rounds - continues until confident or this limit (default: 5) */
  maxResearchRounds?: number;

  /** Project root for file operations (string or getter for dynamic resolution) */
  projectRoot?: string | (() => string | null);

  /** Current working directory */
  cwd?: string;

  /** BrainManager instance for brain_search and ingest_directory */
  brainManager?: BrainManager;

  /** ConversationStorage for persistence and memory */
  conversationStorage?: ConversationStorage;

  /** ConversationSummarizer for auto-summarization */
  conversationSummarizer?: ConversationSummarizer;

  /** EmbeddingProvider for message embeddings */
  embeddingProvider?: GeminiEmbeddingProvider;

  /** Active conversation ID for context retrieval */
  conversationId?: string;

  /** Enable verbose logging */
  verbose?: boolean;

  /** Include web tools (fetch_web_page) for web research */
  includeWebTools?: boolean;

  // Callbacks for UI integration
  /** Called when a tool is about to be executed */
  onToolCall?: (toolName: string, args: Record<string, any>) => void;

  /** Called when a tool completes */
  onToolResult?: (
    toolName: string,
    result: any,
    success: boolean,
    durationMs: number
  ) => void;

  /** Called when the agent is thinking/reasoning */
  onThinking?: (reasoning: string) => void;

  /** Called when the report is updated (for streaming incremental updates) */
  onReportUpdate?: (report: string, confidence: 'high' | 'medium' | 'low', missingInfo: string[]) => void;
}

export interface ResearchResult {
  /** The markdown report produced by the agent */
  report: string;

  /** Confidence level in the findings */
  confidence: 'high' | 'medium' | 'low';

  /** List of sources referenced (file paths, URLs, etc.) */
  sourcesUsed: string[];

  /** List of tools that were called */
  toolsUsed: string[];

  /** Number of iterations used */
  iterations: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  timestamp?: string;
}

export interface ChatResponse {
  message: string;
  reasoning?: string;
  toolsUsed: string[];
  sourcesUsed: string[];
}

// ============================================
// System Prompt
// ============================================

const RESEARCH_SYSTEM_PROMPT = `You are a **Research Assistant** focused on gathering information and producing comprehensive reports.

## Response Guidelines

**Answer directly when you can:**
- Greetings and casual conversation → respond naturally without tools
- Questions you can answer from general knowledge → answer directly
- Clarifying questions → ask without using tools
- Simple explanations → explain without searching

**Use tools when needed:**
- Questions about specific files/code → use read_file, brain_search
- Finding files or patterns → use glob_files, grep_files
- Understanding code structure → use list_directory, brain_search

## Your Capabilities

### read_file - Your primary tool
Use \`read_file\` to read ANY file type:
- **Code files**: TypeScript, JavaScript, Python, etc.
- **Images**: PNG, JPG, GIF, WebP - you'll see a visual description
- **Documents**: PDF, DOCX, XLSX - text will be extracted
- **3D Models**: GLB, GLTF - you'll see renders and descriptions

**IMPORTANT**: When you read a file with \`read_file\`, it is automatically indexed in the knowledge base for future semantic searches. This means:
- Reading important files makes them searchable later
- You don't need to run \`ingest_directory\` for individual files

### brain_search - Semantic search
Search across all previously indexed content. Use this first to find relevant files before reading them.

### ingest_directory - Bulk indexing
**Use sparingly and carefully!** Only use \`ingest_directory\` when:
- User explicitly asks to index a project/directory
- You need to search across many files at once AND you're certain the directory is a reasonable project folder

**NEVER ingest**: home directories (~), root (/), Downloads, Desktop, or any large generic folder. Always verify the path looks like a specific project (e.g., has package.json, src/, etc.) before ingesting.

For individual files, just use \`read_file\` - it will index them automatically.

### Exploration tools
- \`list_directory\`: See what's in a folder
- \`glob_files\`: Find files by pattern (e.g., "**/*.ts")
- \`grep_files\`: Search file contents with regex
- \`search_files\`: Fuzzy text search

## Research Workflow
1. **Search first**: Use \`brain_search\` to find relevant indexed content
2. **Explore if needed**: Use \`list_directory\`/\`glob_files\` to discover files
3. **Read files**: Use \`read_file\` to examine specific files (this also indexes them)
4. **Synthesize**: Combine findings into a coherent answer

## Guidelines
- Be thorough but focused - gather all relevant information
- Always cite your sources (file paths, specific code sections)
- For images, PDFs, and 3D models, describe what you observe in detail
- When uncertain, say so - don't make up information
- Prefer \`read_file\` over \`ingest_directory\` for individual files

## Output Format
When you have gathered enough information, produce a clear markdown response:
- Use headers to organize information
- Include code blocks with syntax highlighting
- List sources at the end
- Be concise but comprehensive

## Working Directory
{CWD_PLACEHOLDER}`;

// ============================================
// Tool Executor
// ============================================

class ResearchToolExecutor extends BaseToolExecutor {
  public sourcesUsed: Set<string> = new Set();
  public toolsUsed: string[] = [];
  public toolCallDetails: Array<{
    tool_name: string;
    arguments: Record<string, any>;
    result: any;
    success: boolean;
    duration_ms: number;
  }> = [];

  private onToolCall?: (toolName: string, args: Record<string, any>) => void;
  private onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;

  constructor(
    private handlers: Record<string, (args: Record<string, any>) => Promise<any>>,
    callbacks?: {
      onToolCall?: (toolName: string, args: Record<string, any>) => void;
      onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
    }
  ) {
    super();
    this.onToolCall = callbacks?.onToolCall;
    this.onToolResult = callbacks?.onToolResult;
  }

  async execute(request: ToolCallRequest): Promise<any> {
    const { tool_name, arguments: args } = request;
    const startTime = Date.now();

    // Notify callback
    if (this.onToolCall) {
      this.onToolCall(tool_name, args);
    }

    // Track tool usage
    this.toolsUsed.push(tool_name);

    // Track sources for certain tools
    if (tool_name === 'read_file' && args.path) {
      this.sourcesUsed.add(args.path);
    } else if (tool_name === 'brain_search' && args.query) {
      this.sourcesUsed.add(`[search: ${args.query}]`);
    }

    const handler = this.handlers[tool_name];
    if (!handler) {
      const error = `Unknown tool: ${tool_name}`;
      const durationMs = Date.now() - startTime;

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result: error,
        success: false,
        duration_ms: durationMs,
      });

      if (this.onToolResult) {
        this.onToolResult(tool_name, error, false, durationMs);
      }
      throw new Error(error);
    }

    try {
      const result = await handler(args);
      const durationMs = Date.now() - startTime;

      // Track files from search results
      if (tool_name === 'brain_search' && result?.results) {
        for (const r of result.results) {
          if (r.filePath) this.sourcesUsed.add(r.filePath);
        }
      }

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result,
        success: true,
        duration_ms: durationMs,
      });

      if (this.onToolResult) {
        this.onToolResult(tool_name, result, true, durationMs);
      }

      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error.message || String(error);

      this.toolCallDetails.push({
        tool_name,
        arguments: args,
        result: errorMsg,
        success: false,
        duration_ms: durationMs,
      });

      if (this.onToolResult) {
        this.onToolResult(tool_name, errorMsg, false, durationMs);
      }
      throw error;
    }
  }
}

// ============================================
// Research Agent
// ============================================

export class ResearchAgent {
  private executor: StructuredLLMExecutor;
  private llmProvider: GeminiAPIProvider;
  private tools: GeneratedToolDefinition[];
  private handlers: Record<string, (args: Record<string, any>) => Promise<any>>;
  private maxIterations: number;
  private maxResearchRounds: number;
  private verbose: boolean;

  // Conversation memory
  private conversationStorage?: ConversationStorage;
  private conversationSummarizer?: ConversationSummarizer;
  private embeddingProvider?: GeminiEmbeddingProvider;
  private conversationId?: string;
  private brainManager?: BrainManager;
  private projectRoot?: string | (() => string | null);
  private cwd?: string;

  // Callbacks
  private onToolCall?: (toolName: string, args: Record<string, any>) => void;
  private onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
  private onThinking?: (reasoning: string) => void;
  private onReportUpdate?: (report: string, confidence: 'high' | 'medium' | 'low', missingInfo: string[]) => void;

  constructor(
    executor: StructuredLLMExecutor,
    llmProvider: GeminiAPIProvider,
    tools: GeneratedToolDefinition[],
    handlers: Record<string, (args: Record<string, any>) => Promise<any>>,
    options: {
      maxIterations?: number;
      maxResearchRounds?: number;
      verbose?: boolean;
      conversationStorage?: ConversationStorage;
      conversationSummarizer?: ConversationSummarizer;
      embeddingProvider?: GeminiEmbeddingProvider;
      conversationId?: string;
      brainManager?: BrainManager;
      projectRoot?: string | (() => string | null);
      cwd?: string;
      onToolCall?: (toolName: string, args: Record<string, any>) => void;
      onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
      onThinking?: (reasoning: string) => void;
      onReportUpdate?: (report: string, confidence: 'high' | 'medium' | 'low', missingInfo: string[]) => void;
    }
  ) {
    this.executor = executor;
    this.llmProvider = llmProvider;
    this.tools = tools;
    this.handlers = handlers;
    this.maxIterations = options.maxIterations ?? 10;
    this.maxResearchRounds = options.maxResearchRounds ?? 5;
    this.verbose = options.verbose ?? false;

    // Memory
    this.conversationStorage = options.conversationStorage;
    this.conversationSummarizer = options.conversationSummarizer;
    this.embeddingProvider = options.embeddingProvider;
    this.conversationId = options.conversationId;
    this.brainManager = options.brainManager;
    this.projectRoot = options.projectRoot;
    this.cwd = options.cwd;

    // Configure conversationStorage with dependencies
    if (this.conversationStorage) {
      if (this.brainManager) {
        this.conversationStorage.setBrainManager(this.brainManager);
      }
      if (this.conversationSummarizer) {
        this.conversationStorage.setSummarizer(this.conversationSummarizer);
      }
      if (this.embeddingProvider) {
        this.conversationStorage.setEmbeddingProvider(this.embeddingProvider);
      }
      // Set LLM for fuzzy search
      this.conversationStorage.setLLMExecutor(this.executor, this.llmProvider);
    }

    // Callbacks
    this.onToolCall = options.onToolCall;
    this.onToolResult = options.onToolResult;
    this.onThinking = options.onThinking;
    this.onReportUpdate = options.onReportUpdate;
  }

  /**
   * Convert tools to ToolDefinition format (OpenAI function calling format)
   */
  private getToolDefinitions(): ToolDefinition[] {
    return this.tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Resolve project root
   */
  private getProjectRoot(): string | null {
    if (typeof this.projectRoot === 'function') {
      return this.projectRoot();
    }
    return this.projectRoot || this.cwd || null;
  }

  /**
   * Build CWD info including indexed projects information
   */
  private async buildCwdInfo(): Promise<string> {
    if (!this.cwd) {
      return 'No specific working directory set.';
    }

    let info = `You are working in: \`${this.cwd}\`\n\n`;
    info += `All your file operations and searches should be focused on this directory. `;
    info += `When using \`brain_search\`, results will be automatically filtered to files within this directory.\n\n`;

    // Get indexed projects info if brainManager is available
    if (this.brainManager) {
      try {
        const projects = this.brainManager.listProjects();
        const normalizedCwd = this.cwd.endsWith('/') ? this.cwd.slice(0, -1) : this.cwd;

        // Find projects that are in or contain the cwd
        const relevantProjects = projects.filter(p => {
          const normalizedPath = p.path.endsWith('/') ? p.path.slice(0, -1) : p.path;
          // Project is inside cwd OR cwd is inside project
          return normalizedPath.startsWith(normalizedCwd) || normalizedCwd.startsWith(normalizedPath);
        });

        if (relevantProjects.length > 0) {
          info += `### Indexed Content\n`;
          info += `The following projects are indexed and searchable via \`brain_search\`:\n`;
          for (const p of relevantProjects) {
            const relPath = p.path.startsWith(normalizedCwd)
              ? p.path.slice(normalizedCwd.length + 1) || '.'
              : p.path;
            info += `- **${p.id}** (${p.type || 'project'}): \`${relPath}\` - ${p.nodeCount || 0} nodes\n`;
          }
          info += `\n**Use \`brain_search\` first** for questions about this codebase - it's faster than grep.\n`;
        } else {
          info += `### No Indexed Content\n`;
          info += `This directory is **not indexed** in the knowledge base. `;
          info += `Use \`glob_files\` and \`grep_files\` to search, or \`ingest_directory\` to index it first.\n`;
        }
      } catch (err) {
        // Silently ignore errors getting project info
      }
    }

    return info;
  }

  /**
   * Get recent context from conversation (no semantic search, fast)
   * Returns recent turns WITH tool calls and L1 summaries
   */
  private async getRecentContext(): Promise<{
    recentTurns: ConversationTurn[];
    recentL1Summaries: Summary[];
  }> {
    if (!this.conversationStorage || !this.conversationId) {
      return { recentTurns: [], recentL1Summaries: [] };
    }

    try {
      return await this.conversationStorage.getRecentContextForAgent(this.conversationId, {
        turnsMaxChars: 5000,  // 5% of context
        l1MaxChars: 10000,    // 10% of context
        turnsLimit: 10,
        l1Limit: 5
      });
    } catch {
      return { recentTurns: [], recentL1Summaries: [] };
    }
  }

  /**
   * Decide what context is needed using a fast LLM call
   */
  private async decideContextNeeds(
    question: string,
    recentContext: { recentTurns: ConversationTurn[]; recentL1Summaries: Summary[] }
  ): Promise<{
    needsCodeSearch: boolean;
    needsDeepHistory: boolean;
    canAnswerDirectly: boolean;
  }> {
    // Format recent turns with tool calls for the decision prompt
    const turnsText = recentContext.recentTurns.length > 0
      ? recentContext.recentTurns.map(turn => {
          let text = `User: ${turn.userMessage.substring(0, 300)}`;
          if (turn.toolResults.length > 0) {
            text += `\nTools used: ${turn.toolResults.map(t => `${t.toolName}(${t.success ? '✓' : '✗'})`).join(', ')}`;
          }
          text += `\nAssistant: ${turn.assistantMessage.substring(0, 300)}`;
          return text;
        }).join('\n---\n')
      : '(no previous messages)';

    // Add L1 summaries if available
    const l1Text = recentContext.recentL1Summaries.length > 0
      ? `\n\nOlder conversation summaries:\n${recentContext.recentL1Summaries.map(s => `- ${s.content.conversation_summary.substring(0, 200)}`).join('\n')}`
      : '';

    const decisionPrompt = `You are a routing assistant. Analyze the user's message and decide what context is needed.

Recent conversation (with tool calls):
${turnsText}${l1Text}

User's new message: "${question}"

Decide:
1. needs_code_search: Does this require searching the codebase? (files, functions, code structure)
2. needs_deep_history: Does this reference something from earlier in the conversation that's not in recent messages?
3. can_answer_directly: Can you answer this without any tools? (greetings, general questions, clarifications, questions about what was already found/searched)

Examples:
- "hello" → can_answer_directly: true
- "what does the auth function do?" → needs_code_search: true
- "like you said earlier about the database" → needs_deep_history: true
- "thanks!" → can_answer_directly: true
- "find all API endpoints" → needs_code_search: true
- "what did you find?" → can_answer_directly: true (if tool results are in recent context)
- "summarize what we discussed" → can_answer_directly: true (if L1 summaries available)`;

    try {
      const result = await this.executor.executeSingle<{
        needs_code_search: boolean;
        needs_deep_history: boolean;
        can_answer_directly: boolean;
      }>({
        input: { question },
        inputFields: [{ name: 'question', prompt: 'The question to analyze' }],
        systemPrompt: decisionPrompt,
        userTask: 'Analyze the message and decide what context is needed.',
        outputSchema: {
          needs_code_search: {
            type: 'boolean' as const,
            description: 'True if the question requires searching the codebase'
          },
          needs_deep_history: {
            type: 'boolean' as const,
            description: 'True if the question references earlier conversation history'
          },
          can_answer_directly: {
            type: 'boolean' as const,
            description: 'True if this can be answered without any tools (greetings, simple questions)'
          }
        },
        maxIterations: 1, // No tools, just decision
        llmProvider: this.llmProvider,
        logPrompts: false,
        logResponses: false,
      });

      return {
        needsCodeSearch: result.needs_code_search ?? false,
        needsDeepHistory: result.needs_deep_history ?? false,
        canAnswerDirectly: result.can_answer_directly ?? false,
      };
    } catch (error) {
      // On error, be conservative and do full context
      if (this.verbose) {
        console.warn(`[ResearchAgent] Context decision failed, using full context`);
      }
      return {
        needsCodeSearch: true,
        needsDeepHistory: false,
        canAnswerDirectly: false,
      };
    }
  }

  /**
   * Build enriched context from conversation history and codebase
   * Now uses intelligent decision to avoid unnecessary searches
   */
  private async buildEnrichedContext(
    question: string,
    contextNeeds: { needsCodeSearch: boolean; needsDeepHistory: boolean }
  ): Promise<string | null> {
    if (!this.conversationStorage || !this.conversationId) {
      return null;
    }

    // If no context needed, return null
    if (!contextNeeds.needsCodeSearch && !contextNeeds.needsDeepHistory) {
      return null;
    }

    try {
      const enrichedContext = await this.conversationStorage.buildEnrichedContext(
        this.conversationId,
        question,
        {
          cwd: this.cwd,
          projectRoot: this.getProjectRoot() || undefined,
          // Pass flags to control what gets searched
          skipCodeSearch: !contextNeeds.needsCodeSearch,
          skipHistorySearch: !contextNeeds.needsDeepHistory,
        }
      );

      return this.conversationStorage.formatContextForAgent(enrichedContext);
    } catch (error: any) {
      if (this.verbose) {
        console.warn(`[ResearchAgent] Failed to build enriched context: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Store message in conversation history
   */
  private async storeMessage(
    role: 'user' | 'assistant',
    content: string,
    options?: {
      reasoning?: string;
      toolCalls?: Array<{
        tool_name: string;
        arguments: Record<string, any>;
        result: any;
        success: boolean;
        duration_ms: number;
      }>;
    }
  ): Promise<void> {
    if (!this.conversationStorage || !this.conversationId) {
      return;
    }

    try {
      // Store the message
      const messageUuid = await this.conversationStorage.storeMessage({
        conversation_id: this.conversationId,
        role,
        content,
        reasoning: options?.reasoning,
        timestamp: new Date(),
      });

      // Store tool calls if any
      if (options?.toolCalls && options.toolCalls.length > 0) {
        for (let i = 0; i < options.toolCalls.length; i++) {
          const tc = options.toolCalls[i];
          await this.conversationStorage.storeToolCall(messageUuid, {
            tool_name: tc.tool_name,
            arguments: JSON.stringify(tc.arguments),
            success: tc.success,
            duration_ms: tc.duration_ms,
            result: tc.result,
            iteration: i,
          });
        }
      }

      // Generate embedding for the message if provider available
      if (this.embeddingProvider && role === 'assistant') {
        try {
          const embedding = await this.embeddingProvider.embedSingle(content);
          await this.conversationStorage.updateMessageEmbedding(messageUuid, embedding);
        } catch (err) {
          // Non-critical, continue without embedding
        }
      }
    } catch (error: any) {
      if (this.verbose) {
        console.warn(`[ResearchAgent] Failed to store message: ${error.message}`);
      }
    }
  }

  /**
   * Trigger auto-summarization if thresholds are met
   */
  private async triggerAutoSummarization(): Promise<void> {
    if (!this.conversationStorage || !this.conversationId) {
      return;
    }

    try {
      const projectRoot = this.getProjectRoot() || undefined;

      // Try L1 summary
      const l1Summary = await this.conversationStorage.generateL1SummaryIfNeeded(
        this.conversationId,
        { projectRoot }
      );

      if (l1Summary && this.verbose) {
        console.log(`[ResearchAgent] Generated L1 summary: ${l1Summary.uuid}`);
      }

      // Try L2 summary (summarizes L1 summaries)
      const l2Summary = await this.conversationStorage.generateL2SummaryIfNeeded(
        this.conversationId,
        { projectRoot }
      );

      if (l2Summary && this.verbose) {
        console.log(`[ResearchAgent] Generated L2 summary: ${l2Summary.uuid}`);
      }
    } catch (error: any) {
      if (this.verbose) {
        console.warn(`[ResearchAgent] Auto-summarization failed: ${error.message}`);
      }
    }
  }

  /**
   * Perform research on a question
   */
  async research(question: string, history?: ChatMessage[]): Promise<ResearchResult> {
    if (this.verbose) {
      console.log(`\n[ResearchAgent] Research: "${question}"`);
    }

    // Step 1: Get recent context (fast, no search) - includes tool calls and L1 summaries
    const recentContext = await this.getRecentContext();

    // Step 2: Decide what context is needed (fast LLM call)
    const contextNeeds = await this.decideContextNeeds(question, recentContext);

    if (this.verbose) {
      console.log(`[ResearchAgent] Context decision:`, contextNeeds);
      console.log(`[ResearchAgent] Recent context: ${recentContext.recentTurns.length} turns, ${recentContext.recentL1Summaries.length} L1 summaries`);
    }

    // Step 3: Build enriched context only if needed
    const enrichedContext = await this.buildEnrichedContext(question, contextNeeds);

    // Store user message
    await this.storeMessage('user', question);

    // Create tool executor with callbacks
    const toolExecutor = new ResearchToolExecutor(this.handlers, {
      onToolCall: this.onToolCall,
      onToolResult: this.onToolResult,
    });

    // Build system prompt with CWD info
    const cwdInfo = await this.buildCwdInfo();
    let systemPrompt = RESEARCH_SYSTEM_PROMPT.replace('{CWD_PLACEHOLDER}', cwdInfo);

    // Add recent conversation context with tool calls (always included, fast)
    if (recentContext.recentTurns.length > 0) {
      let contextText = '## Recent Conversation\n';
      for (const turn of recentContext.recentTurns) {
        contextText += `**User:** ${turn.userMessage}\n`;
        if (turn.toolResults.length > 0) {
          contextText += `**Tools used:** ${turn.toolResults.map(t =>
            `${t.toolName}(${t.success ? 'success' : 'failed'})`
          ).join(', ')}\n`;
        }
        contextText += `**Assistant:** ${turn.assistantMessage}\n\n`;
      }
      systemPrompt = `${systemPrompt}\n\n${contextText}`;
    }

    // Add L1 summaries if available
    if (recentContext.recentL1Summaries.length > 0) {
      let summaryText = '## Earlier Conversation Summaries\n';
      for (const summary of recentContext.recentL1Summaries) {
        summaryText += `- ${summary.content.conversation_summary}\n`;
        if (summary.content.actions_summary) {
          summaryText += `  Actions: ${summary.content.actions_summary}\n`;
        }
      }
      systemPrompt = `${systemPrompt}\n\n${summaryText}`;
    }

    // Add enriched context if we fetched it (deeper semantic search results)
    if (enrichedContext) {
      systemPrompt = `${systemPrompt}\n\n${enrichedContext}`;
    }

    // Build history context if provided (legacy fallback)
    if (!enrichedContext && recentContext.recentTurns.length === 0 && history && history.length > 0) {
      const historyContext = history
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');
      systemPrompt = `${systemPrompt}\n\n## Previous Conversation\n${historyContext}`;
    }

    // Add hint if can answer directly
    if (contextNeeds.canAnswerDirectly) {
      systemPrompt = `${systemPrompt}\n\n**Note:** This appears to be a simple message that you can likely answer directly without using tools.`;
    }

    // Output schema fields - simple key-value for executeSingle
    const outputSchema = {
      report: {
        type: 'string' as const,
        description: 'The markdown report with findings',
      },
      confidence: {
        type: 'string' as const,
        enum: ['high', 'medium', 'low'],
        description: 'Confidence in the completeness of findings',
      },
    };

    let actualIterations = 0;

    // Build progressive output config if callback is provided
    const progressiveOutput: ProgressiveOutputConfig<{ report: string; confidence: string }> | undefined =
      this.onReportUpdate
        ? {
            completionField: 'confidence',
            completionValues: ['high'],
            onProgress: (output, iteration, isComplete) => {
              if (output.report && this.onReportUpdate) {
                this.onReportUpdate(
                  output.report,
                  (output.confidence as 'high' | 'medium' | 'low') || 'low',
                  [] // No missing info tracking yet
                );
              }
            },
          }
        : undefined;

    try {
      const result = await this.executor.executeSingle<{ report: string; confidence: string }>({
        input: { question },
        inputFields: [{ name: 'question', prompt: 'The research question to investigate' }],
        systemPrompt,
        userTask: 'Research the question thoroughly and produce a markdown report.',
        outputSchema,
        tools: this.getToolDefinitions(),
        maxIterations: this.maxIterations,
        toolExecutor,
        llmProvider: this.llmProvider,
        logPrompts: this.verbose,
        logResponses: this.verbose,
        progressiveOutput,
        onLLMResponse: (response) => {
          actualIterations = response.iteration;
          if (this.verbose) {
            console.log(`   [Iteration ${response.iteration}]`);
          }
          // Notify thinking callback if reasoning is present
          if (response.reasoning && this.onThinking) {
            this.onThinking(response.reasoning);
          }
        },
      });

      const report = result.report || 'No report generated';
      const confidence = (result.confidence as 'high' | 'medium' | 'low') || 'low';

      // Store assistant response with tool calls
      await this.storeMessage('assistant', report, {
        toolCalls: toolExecutor.toolCallDetails.length > 0 ? toolExecutor.toolCallDetails : undefined,
      });

      // Trigger auto-summarization
      await this.triggerAutoSummarization();

      return {
        report,
        confidence,
        sourcesUsed: Array.from(toolExecutor.sourcesUsed),
        toolsUsed: toolExecutor.toolsUsed,
        iterations: actualIterations,
      };
    } catch (error: any) {
      if (this.verbose) {
        console.error(`   [Error] Research failed: ${error.message}`);
      }

      const errorReport = `Research failed: ${error.message}`;

      // Store error response
      await this.storeMessage('assistant', errorReport);

      return {
        report: errorReport,
        confidence: 'low',
        sourcesUsed: Array.from(toolExecutor.sourcesUsed),
        toolsUsed: toolExecutor.toolsUsed,
        iterations: actualIterations,
      };
    }
  }

  /**
   * Simple chat method for conversational interaction
   */
  async chat(message: string, history?: ChatMessage[]): Promise<ChatResponse> {
    const result = await this.research(message, history);
    return {
      message: result.report,
      toolsUsed: result.toolsUsed,
      sourcesUsed: result.sourcesUsed,
    };
  }

  /**
   * Set active conversation ID
   */
  setConversationId(conversationId: string): void {
    this.conversationId = conversationId;
  }

  /**
   * Get active conversation ID
   */
  getConversationId(): string | undefined {
    return this.conversationId;
  }

  /**
   * Set callbacks (useful when callbacks need to be updated after construction)
   */
  setCallbacks(callbacks: {
    onToolCall?: (toolName: string, args: Record<string, any>) => void;
    onToolResult?: (toolName: string, result: any, success: boolean, durationMs: number) => void;
    onThinking?: (reasoning: string) => void;
  }): void {
    if (callbacks.onToolCall) this.onToolCall = callbacks.onToolCall;
    if (callbacks.onToolResult) this.onToolResult = callbacks.onToolResult;
    if (callbacks.onThinking) this.onThinking = callbacks.onThinking;
  }

  /**
   * Get list of available tools
   */
  getTools(): string[] {
    return this.tools.map((t) => t.name);
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a ResearchAgent with appropriate tools
 */
export async function createResearchAgent(options: ResearchAgentOptions): Promise<ResearchAgent> {
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY or pass apiKey option.');
  }

  const model = options.model || 'gemini-2.0-flash';
  const temperature = options.temperature ?? 0.2;

  // Create LLM providers
  const llmProvider = new GeminiAPIProvider({
    apiKey,
    model,
    temperature,
  });

  const executor = new StructuredLLMExecutor();

  const tools: GeneratedToolDefinition[] = [];
  const handlers: Record<string, (args: Record<string, any>) => Promise<any>> = {};

  // 1. File tools (read_file only - research is read-only)
  const fileCtx: FileToolsContext = {
    projectRoot: options.projectRoot || options.cwd || process.cwd,
  };
  const fileTools = generateFileTools(fileCtx);

  // Only include read_file for research (read-only)
  const readFileTool = fileTools.tools.find((t) => t.name === 'read_file');
  if (readFileTool) {
    tools.push(readFileTool);
    handlers['read_file'] = fileTools.handlers['read_file'];
  }

  // 2. FS tools (exploration only)
  const fsCtx: FsToolsContext = {
    projectRoot: options.projectRoot || options.cwd || process.cwd,
  };
  const fsTools = generateFsTools(fsCtx);

  // Include exploration tools
  for (const toolName of ['list_directory', 'glob_files', 'grep_files', 'search_files', 'file_exists', 'get_file_info']) {
    const tool = fsTools.tools.find((t) => t.name === toolName);
    if (tool) {
      tools.push(tool);
      handlers[toolName] = fsTools.handlers[toolName];
    }
  }

  // 3. Brain tools (if brainManager provided)
  if (options.brainManager) {
    const brainCtx: BrainToolsContext = {
      brain: options.brainManager,
    };

    // brain_search - wrapped to force glob filter on cwd
    const brainSearchTool = generateBrainSearchTool();
    tools.push(brainSearchTool);
    const brainSearchHandler = generateBrainSearchHandler(brainCtx);

    // Wrap handler to auto-add glob filter for cwd
    const cwd = options.cwd;
    handlers['brain_search'] = async (args) => {
      // If cwd is set and no glob is specified, add a glob filter
      if (cwd && !args.glob) {
        // Normalize: ensure cwd ends without slash, then add /**/*
        const normalizedCwd = cwd.endsWith('/') ? cwd.slice(0, -1) : cwd;
        args.glob = `${normalizedCwd}/**/*`;
      }
      return brainSearchHandler(args as any);
    };

    // ingest_directory
    const ingestTool = generateIngestDirectoryTool();
    tools.push(ingestTool);
    const ingestHandler = generateIngestDirectoryHandler(brainCtx);
    handlers['ingest_directory'] = (args) => ingestHandler(args as any);
  }

  // 4. Web tools (optional)
  if (options.includeWebTools) {
    // TODO: Add fetch_web_page tool
    // const webTools = createWebToolHandlers({ geminiApiKey: apiKey });
    // tools.push(fetchWebPageToolDefinition);
    // handlers['fetch_web_page'] = webTools['fetch_web_page'];
  }

  return new ResearchAgent(executor, llmProvider, tools, handlers, {
    maxIterations: options.maxIterations ?? 15,
    verbose: options.verbose ?? false,
    conversationStorage: options.conversationStorage,
    conversationSummarizer: options.conversationSummarizer,
    embeddingProvider: options.embeddingProvider,
    conversationId: options.conversationId,
    brainManager: options.brainManager,
    projectRoot: options.projectRoot,
    cwd: options.cwd,
    onToolCall: options.onToolCall,
    onToolResult: options.onToolResult,
    onThinking: options.onThinking,
    onReportUpdate: options.onReportUpdate,
  });
}
