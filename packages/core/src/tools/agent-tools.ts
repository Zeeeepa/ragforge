/**
 * Agent Tools for MCP
 * 
 * Tools to interact with RagAgent:
 * - call_agent: Call agent and wait for final answer
 * - extract_agent_prompt: Extract prompt at a specific iteration
 * - call_agent_steps: Call agent up to N steps and return raw response
 */

import type { GeneratedToolDefinition } from './types/index.js';
import { createRagAgent, type RagAgentOptions } from '../runtime/agents/rag-agent.js';
import { StructuredLLMExecutor } from '../runtime/llm/structured-llm-executor.js';
import type { LLMProvider } from '../runtime/reranking/llm-provider.js';
import type { ToolCallRequest, ToolExecutionResult } from '../runtime/llm/structured-llm-executor.js';
import { normalizeTimestamp, getFilenameTimestamp } from '../runtime/utils/timestamp.js';
import { GeminiAPIProvider } from '../runtime/reranking/gemini-api-provider.js';
import { createLogger } from '../runtime/utils/logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const logger = createLogger('AgentTools');

// ============================================
// Session Analysis Types
// ============================================

export interface SessionAnalysisResult {
  /** Overall quality score 0-10 */
  overall_score: number;
  /** Efficiency score 0-10 (redundancy, waste) */
  efficiency_score: number;

  /** Tool call analysis */
  tool_analysis: {
    total_calls: number;
    redundant_calls: number;
    useful_calls: number;
    wasted_time_ms: number;
    missed_opportunities: string[];
  };

  /** Reasoning quality */
  reasoning_quality: {
    clear_plan: boolean;
    exploits_results: boolean;
    adapts_strategy: boolean;
    avoids_repetition: boolean;
  };

  /** Issues detected */
  issues: Array<{
    type: 'redundancy' | 'inefficiency' | 'missed_info' | 'wrong_tool' | 'loop' | 'other';
    description: string;
    severity: 'low' | 'medium' | 'high';
    iteration?: number;
    tool_name?: string;
  }>;

  /** Suggestions for improvement */
  suggestions: string[];

  /** System prompt corrections */
  prompt_corrections: Array<{
    issue: string;
    current_behavior: string;
    suggested_addition: string;
    priority: 'low' | 'medium' | 'high';
  }>;

  /** Human-readable summary */
  summary: string;

  /** CRITICAL: The improved system prompt incorporating all corrections */
  improved_system_prompt: string;

  /** Output file paths (added by the tool) */
  _output_files?: {
    analysis_json: string;
    improved_prompt_md?: string;
  };
}

// ============================================
// Types
// ============================================

export interface AgentToolsContext {
  /** Function to create RagAgent with given options */
  createAgent: (options: RagAgentOptions) => Promise<any>;
  /** Default agent options (project, config, etc.) */
  defaultAgentOptions?: Partial<RagAgentOptions>;
  /** Current conversation ID (for enriched context) - can be a string or a getter function */
  currentConversationId?: string | (() => string | undefined);
  /** Function to set current conversation ID */
  setConversationId?: (id: string | undefined) => void;
}

interface CapturedPrompt {
  iteration: number;
  prompt: string;
  systemPrompt: string;
  enrichedContext: string | null; // Enriched context from semantic/fuzzy searches
  userTask: string;
  inputFields: any[];
  item: Record<string, any>;
  toolContext: Array<{
    tool_name: string;
    success: boolean;
    result: string;
  }>;
}

interface CapturedStep {
  iteration: number;
  prompt?: string;
  response?: string;
  toolCalls?: ToolCallRequest[];
  output?: any;
  toolContext?: Array<{
    tool_name: string;
    success: boolean;
    result: any;
  }>;
}

// ============================================
// Tool Definitions
// ============================================

export function generateAgentTools(): GeneratedToolDefinition[] {
  return [
    {
      name: 'call_agent',
      description: 'Call the RagAgent with a question and wait for the final answer. The agent will use tools as needed and return a complete response.',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question or request to ask the agent',
          },
          max_iterations: {
            type: 'number',
            description: 'Maximum number of iterations (default: 10)',
            default: 10,
          },
        },
        required: ['question'],
      },
    },
    {
      name: 'extract_agent_prompt',
      description: 'Extract the prompt and/or response at a specific iteration. Returns the prompt and/or raw response. Use iteration=0 for the first prompt, iteration=1 for the second, etc. Can extract specific line ranges from prompt/response.',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question or request to ask the agent',
          },
          iteration: {
            type: 'number',
            description: 'Iteration number (0 = first prompt, 1 = second prompt, etc.)',
            default: 0,
          },
          max_iterations: {
            type: 'number',
            description: 'Maximum number of iterations to simulate (default: 10)',
            default: 10,
          },
          return_prompt: {
            type: 'boolean',
            description: 'Whether to return the prompt (default: true)',
            default: true,
          },
          return_response: {
            type: 'boolean',
            description: 'Whether to return the raw response (default: true)',
            default: true,
          },
          prompt_start_line: {
            type: 'number',
            description: 'Start line number for prompt extraction (1-indexed, optional)',
          },
          prompt_end_line: {
            type: 'number',
            description: 'End line number for prompt extraction (1-indexed, optional)',
          },
          response_start_line: {
            type: 'number',
            description: 'Start line number for response extraction (1-indexed, optional)',
          },
          response_end_line: {
            type: 'number',
            description: 'End line number for response extraction (1-indexed, optional)',
          },
        },
        required: ['question', 'iteration'],
      },
    },
    {
      name: 'call_agent_steps',
      description: 'Call the agent up to a specific number of steps and return the raw response at that step, even if no final answer has been formulated yet.',
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question or request to ask the agent',
          },
          max_steps: {
            type: 'number',
            description: 'Maximum number of steps to execute (default: 1)',
            default: 1,
          },
        },
        required: ['question', 'max_steps'],
      },
    },
    {
      name: 'create_conversation',
      description: 'Create a new conversation in the conversation storage. Returns the conversation ID that can be used with switch_conversation or extract_agent_prompt.',
      inputSchema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Title for the conversation',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for the conversation',
          },
        },
        required: ['title'],
      },
    },
    {
      name: 'switch_conversation',
      description: 'Switch the agent to use a specific conversation ID. This enables enriched context (semantic/fuzzy searches) in prompts. Use this before calling extract_agent_prompt or call_agent to enable context engineering.',
      inputSchema: {
        type: 'object',
        properties: {
          conversation_id: {
            type: 'string',
            description: 'The conversation ID to switch to',
          },
        },
        required: ['conversation_id'],
      },
    },
    {
      name: 'analyze_agent_session',
      description: `Analyze an agent session log file and provide detailed feedback on the agent's behavior.

Evaluates:
- Overall quality and efficiency scores (0-10)
- Tool call analysis (redundancy, usefulness, wasted time)
- Reasoning quality (clear plan, exploits results, adapts strategy)
- Issues detected with severity levels
- Suggestions for improvement
- **System prompt corrections** to prevent detected issues

Use this to debug and improve agent behavior by analyzing session logs from ~/.ragforge/logs/agent-sessions/

If no session_log_path is provided, automatically finds and analyzes the most recent session.`,
      inputSchema: {
        type: 'object',
        properties: {
          session_log_path: {
            type: 'string',
            description: 'Path to the session folder or JSON file. If not provided, uses the most recent session from ~/.ragforge/logs/agent-sessions/',
          },
          focus_areas: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional areas to focus analysis on: "redundancy", "efficiency", "tool_choice", "reasoning", "prompt_corrections"',
          },
          max_iterations: {
            type: 'number',
            description: 'Maximum number of iterations to include in analysis (default: 5). Use lower values to limit context size.',
          },
        },
        required: [],
      },
    },
  ];
}

// ============================================
// Tool Handlers
// ============================================

/**
 * Create handlers for agent tools
 */
export function generateAgentToolHandlers(
  ctx: AgentToolsContext
): Record<string, (args: any) => Promise<any>> {
  return {
    call_agent: async (args: { question: string; max_iterations?: number }) => {
      const { question, max_iterations = 10 } = args;

      // Create agent with default options
      const agentOptions: RagAgentOptions = {
        ...ctx.defaultAgentOptions,
        maxIterations: max_iterations,
      } as RagAgentOptions;

      const agent = await ctx.createAgent(agentOptions);

      // Call agent and wait for final answer
      const result = await agent.ask(question);

      return {
        answer: result.answer,
        confidence: result.confidence,
        toolsUsed: result.toolsUsed || [],
        iterations: result.iterations,
      };
    },

    extract_agent_prompt: async (args: {
      question: string;
      iteration: number;
      max_iterations?: number;
      return_prompt?: boolean;
      return_response?: boolean;
      prompt_start_line?: number;
      prompt_end_line?: number;
      response_start_line?: number;
      response_end_line?: number;
    }) => {
      const {
        question,
        iteration,
        max_iterations = 10,
        return_prompt = true,
        return_response = true,
        prompt_start_line,
        prompt_end_line,
        response_start_line,
        response_end_line,
      } = args;

      if (iteration < 0) {
        throw new Error('iteration must be >= 0');
      }

      // Create agent with default options
      const agentOptions: RagAgentOptions = {
        ...ctx.defaultAgentOptions,
        maxIterations: max_iterations,
      } as RagAgentOptions;

      const agent = await ctx.createAgent(agentOptions);

      // Access agent internals
      const executor = (agent as any).executor as StructuredLLMExecutor;
      const llmProvider = (agent as any).llmProvider as LLMProvider;
      
      // Create tool executor wrapper that actually executes tools
      const originalHandlers = (agent as any).boundHandlers;
      const toolExecutor = {
        execute: async (toolCall: ToolCallRequest) => {
          const handler = originalHandlers[toolCall.tool_name];
          if (!handler) {
            throw new Error(`Unknown tool: ${toolCall.tool_name}`);
          }
          return await handler(toolCall.arguments);
        },
        executeBatch: async (toolCalls: ToolCallRequest[]) => {
          const results = await Promise.all(
            toolCalls.map(async (tc) => {
              try {
                const handler = originalHandlers[tc.tool_name];
                if (!handler) {
                  return {
                    tool_name: tc.tool_name,
                    success: false,
                    error: `Unknown tool: ${tc.tool_name}`,
                  };
                }
                const result = await handler(tc.arguments);
                return {
                  tool_name: tc.tool_name,
                  success: true,
                  result,
                };
              } catch (error: any) {
                return {
                  tool_name: tc.tool_name,
                  success: false,
                  error: error.message,
                };
              }
            })
          );
          return results;
        },
      };

      const outputSchema = {
        answer: {
          type: 'string',
          description: 'Your answer',
          required: true,
        },
        confidence: {
          type: 'string',
          description: 'Confidence level',
          required: false,
        },
      };

      // Build enriched context (like ask() does)
      // This includes semantic/fuzzy searches if conversationStorage is available
      // Use current conversation ID from context (set via switch_conversation)
      // Read dynamically in case it's a getter
      let enrichedContextString: string | null = null;
      const conversationStorage = (agent as any).conversationStorage;
      const conversationId: string | undefined = typeof ctx.currentConversationId === 'function' 
        ? ctx.currentConversationId() 
        : ctx.currentConversationId;
      
      console.log(`[extract_agent_prompt] Checking conditions:`, {
        hasConversationId: !!conversationId,
        hasConversationStorage: !!conversationStorage,
        conversationId: conversationId || 'N/A'
      });
      
      if (conversationStorage && conversationId) {
        try {
          // Resolve projectRoot (can be string or function)
          const projectRootValue = typeof (agent as any).projectRoot === 'function'
            ? (agent as any).projectRoot() || process.cwd()
            : (agent as any).projectRoot || process.cwd();

          // Resolve cwd (use projectRoot if cwd not set, or process.cwd() as fallback)
          const cwdValue = (agent as any).cwd || projectRootValue || process.cwd();

          // Build enriched context with current conversation
          // Note: buildEnrichedContext now fetches locks from brainManager internally and waits for them
          const enrichedContext = await conversationStorage.buildEnrichedContext(
            conversationId,
            question,
            {
              cwd: cwdValue,
              projectRoot: projectRootValue
            }
          );

          // Debug: log enriched context structure
          console.log(`[extract_agent_prompt] Enriched context:`, {
            lastUserQueries: enrichedContext.lastUserQueries.length,
            recentTurns: enrichedContext.recentTurns.length,
            codeSemanticResults: enrichedContext.codeSemanticResults?.length || 0,
            semanticResults: enrichedContext.semanticResults.length,
            level1Summaries: enrichedContext.level1SummariesNotSummarized.length,
            projectRoot: projectRootValue,
            cwd: cwdValue
          });

          // Pass cwd and projectRoot for path normalization
          enrichedContextString = conversationStorage.formatContextForAgent(enrichedContext, {
            cwd: cwdValue,
            projectRoot: projectRootValue
          });
          
          // Debug: log formatted context
          console.log(`[extract_agent_prompt] Formatted context length: ${enrichedContextString?.length || 0} chars`);
          if (enrichedContextString && enrichedContextString.length > 0) {
            console.log(`[extract_agent_prompt] Formatted context preview:`, enrichedContextString.substring(0, 500));
          }
        } catch (error: any) {
          // Ignore errors - enriched context is optional
          // But log for debugging
          console.warn(`[extract_agent_prompt] Failed to build enriched context: ${error.message}`);
        }
      }

      // Build system prompt (with enriched context if available, like ask() does)
      const baseSystemPrompt = (agent as any).buildSystemPrompt();
      const systemPrompt = enrichedContextString
        ? `${baseSystemPrompt}\n\n${enrichedContextString}`
        : baseSystemPrompt;
      
      const currentPersona = (agent as any).getCurrentPersona();
      const inputFields = [
        { name: 'question', prompt: 'The user question' },
        ...(currentPersona ? [{ name: 'persona', prompt: 'Your personality' }] : []),
      ];
      const item: Record<string, string> = { question };
      if (currentPersona) {
        item.persona = currentPersona;
      }

      // Execute iterations up to the requested one, capturing prompts
      let toolContext: ToolExecutionResult[] = [];
      const capturedPrompts: CapturedPrompt[] = [];

      for (let i = 0; i <= iteration && i < max_iterations; i++) {
        // Build prompt using executor's private method
        const prompt = (executor as any).buildSinglePrompt(
          {
            input: item,
            inputFields,
            systemPrompt,
            userTask: 'Answer the question using the available tools if needed.',
            outputSchema,
            tools: (agent as any).getToolDefinitions(),
            toolContext,
          },
          toolContext
        );

        // Capture prompt BEFORE calling LLM
        // The 'prompt' variable contains the FULL prompt that would be sent to LLM
        // It includes: systemPrompt (with enriched context), tool descriptions, user task, input, tool results, output format
        capturedPrompts.push({
          iteration: i,
          prompt, // FULL prompt that would be sent to LLM (this is what we want!)
          systemPrompt: baseSystemPrompt, // Base system prompt (without enriched context) - for reference
          enrichedContext: enrichedContextString || null, // Enriched context (semantic/fuzzy searches) - separate field for clarity
          userTask: 'Answer the question using the available tools if needed.',
          inputFields,
          item: { ...item },
          toolContext: toolContext.map(tc => ({
            tool_name: tc.tool_name,
            success: tc.success,
            result: typeof tc.result === 'object' ? JSON.stringify(tc.result).substring(0, 200) : String(tc.result).substring(0, 200),
          })),
        });

        // If this is the requested iteration, call LLM but DON'T execute tools
        if (i === iteration) {
          // Helper function to extract lines from text
          const extractLines = (text: string, startLine?: number, endLine?: number): string => {
            if (startLine === undefined && endLine === undefined) {
              return text;
            }
            const lines = text.split('\n');
            const start = startLine !== undefined ? Math.max(0, startLine - 1) : 0;
            const end = endLine !== undefined ? Math.min(lines.length, endLine) : lines.length;
            return lines.slice(start, end).join('\n');
          };

          // Create output directory for files
          const { getFilenameTimestamp } = await import('../runtime/utils/timestamp.js');
          const timestamp = getFilenameTimestamp();
          const debugDir = path.join(os.homedir(), '.ragforge', 'debug', `extract_${timestamp}`);
          await fs.mkdir(debugDir, { recursive: true });

          // Build result object with file paths
          const result: any = {
            iteration: i,
            output_dir: debugDir,
            files: {},
          };

          // Write prompt to file if requested
          if (return_prompt) {
            const fullPrompt = capturedPrompts[i].prompt;
            const promptContent = extractLines(fullPrompt, prompt_start_line, prompt_end_line);

            // Write full prompt
            const promptFile = path.join(debugDir, 'prompt.txt');
            await fs.writeFile(promptFile, promptContent, 'utf-8');
            result.files.prompt = promptFile;
            result.prompt_lines = fullPrompt.split('\n').length;

            // Write enriched context separately if present
            const enrichedCtx = capturedPrompts[i].enrichedContext;
            if (enrichedCtx) {
              const contextFile = path.join(debugDir, 'enriched_context.txt');
              await fs.writeFile(contextFile, enrichedCtx, 'utf-8');
              result.files.enriched_context = contextFile;
            }

            // Write metadata
            const metadata = {
              iteration: i,
              userTask: capturedPrompts[i].userTask,
              inputFields: capturedPrompts[i].inputFields,
              item: capturedPrompts[i].item,
              toolContext: capturedPrompts[i].toolContext,
              prompt_lines: fullPrompt.split('\n').length,
              enriched_context_chars: capturedPrompts[i].enrichedContext?.length || 0,
            };
            const metadataFile = path.join(debugDir, 'metadata.json');
            await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2), 'utf-8');
            result.files.metadata = metadataFile;
          }

          // Call LLM to get the response (but we won't execute tools)
          if (return_response) {
            const requestId = `extract-agent-prompt-iter${iteration}-response-${Date.now()}`;
            const response = await llmProvider.generateContent(prompt, requestId);

            // Parse response to extract tool calls (for information, but we won't execute them)
            const parsed = (executor as any).parseSingleResponse(response, outputSchema, 'xml');
            const toolCalls = (parsed as any).tool_calls as ToolCallRequest[] | undefined;
            const validToolCalls = (executor as any).filterValidToolCalls(toolCalls);

            // Write raw response to file
            const fullResponse = response;
            const responseContent = extractLines(fullResponse, response_start_line, response_end_line);
            const responseFile = path.join(debugDir, 'response.txt');
            await fs.writeFile(responseFile, responseContent, 'utf-8');
            result.files.response = responseFile;
            result.response_lines = fullResponse.split('\n').length;

            // Write parsed response and tool calls
            const parsedFile = path.join(debugDir, 'parsed_response.json');
            await fs.writeFile(parsedFile, JSON.stringify({
              parsed,
              wouldCallTools: validToolCalls.map((tc: ToolCallRequest) => ({
                tool_name: tc.tool_name,
                arguments: tc.arguments,
              })),
            }, null, 2), 'utf-8');
            result.files.parsed_response = parsedFile;
            result.would_call_tools_count = validToolCalls.length;
          }

          console.log(`[extract_agent_prompt] Results written to: ${debugDir}`);
          return result;
        }

        // For iterations BEFORE the requested one, execute tools to populate toolContext
        // Call LLM to get tool calls
        const requestId = `extract-agent-prompt-iter${iteration}-${Date.now()}`;
        const response = await llmProvider.generateContent(prompt, requestId);
        
        // Parse response
        const parsed = (executor as any).parseSingleResponse(response, outputSchema, 'xml');
        
        // Extract tool calls
        const toolCalls = (parsed as any).tool_calls as ToolCallRequest[] | undefined;
        const validToolCalls = (executor as any).filterValidToolCalls(toolCalls);

        // Execute tools if any (this populates toolContext for next iteration)
        if (validToolCalls.length > 0) {
          const toolResults = await (executor as any).executeToolCalls(validToolCalls, toolExecutor);
          toolContext.push(...toolResults);
        } else {
          // No more tool calls - we've reached the end
          // Return the last captured prompt
          break;
        }
      }

      // If we didn't reach the requested iteration, return the last one we captured
      if (capturedPrompts.length > 0) {
        return capturedPrompts[capturedPrompts.length - 1];
      }

      throw new Error(`Iteration ${iteration} not reached (max: ${capturedPrompts.length - 1})`);
    },

    call_agent_steps: async (args: {
      question: string;
      max_steps: number;
    }) => {
      const { question, max_steps } = args;

      if (max_steps < 1) {
        throw new Error('max_steps must be >= 1');
      }

      // Create agent with default options
      const agentOptions: RagAgentOptions = {
        ...ctx.defaultAgentOptions,
        maxIterations: max_steps,
      } as RagAgentOptions;

      const agent = await ctx.createAgent(agentOptions);

      // Access agent internals
      const executor = (agent as any).executor as StructuredLLMExecutor;
      const llmProvider = (agent as any).llmProvider as LLMProvider;
      
      // Create tool executor wrapper using the agent's handlers
      // We'll use the executor's executeToolCalls method which accepts any tool executor
      const toolExecutor = {
        execute: async (toolCall: ToolCallRequest) => {
          const handler = (agent as any).boundHandlers[toolCall.tool_name];
          if (!handler) {
            throw new Error(`Unknown tool: ${toolCall.tool_name}`);
          }
          return await handler(toolCall.arguments);
        },
        executeBatch: async (toolCalls: ToolCallRequest[]) => {
          const results = await Promise.all(
            toolCalls.map(async (tc) => {
              try {
                const handler = (agent as any).boundHandlers[tc.tool_name];
                if (!handler) {
                  return {
                    tool_name: tc.tool_name,
                    success: false,
                    error: `Unknown tool: ${tc.tool_name}`,
                  };
                }
                const result = await handler(tc.arguments);
                return {
                  tool_name: tc.tool_name,
                  success: true,
                  result,
                };
              } catch (error: any) {
                return {
                  tool_name: tc.tool_name,
                  success: false,
                  error: error.message,
                };
              }
            })
          );
          return results;
        },
      };

      const outputSchema = {
        answer: {
          type: 'string',
          description: 'Your answer',
          required: true,
        },
        confidence: {
          type: 'string',
          description: 'Confidence level',
          required: false,
        },
      };

      // Build system prompt
      const systemPrompt = (agent as any).buildSystemPrompt();
      const currentPersona = (agent as any).getCurrentPersona();
      const inputFields = [
        { name: 'question', prompt: 'The user question' },
        ...(currentPersona ? [{ name: 'persona', prompt: 'Your personality' }] : []),
      ];
      const item: Record<string, string> = { question };
      if (currentPersona) {
        item.persona = currentPersona;
      }

      // Execute up to max_steps
      let toolContext: ToolExecutionResult[] = [];
      const capturedSteps: CapturedStep[] = [];

      for (let iteration = 1; iteration <= max_steps; iteration++) {
        // Build prompt
        const prompt = (executor as any).buildSinglePrompt(
          {
            input: item,
            inputFields,
            systemPrompt,
            userTask: 'Answer the question using the available tools if needed.',
            outputSchema,
            tools: (agent as any).getToolDefinitions(),
            toolContext,
          },
          toolContext
        );

        // Call LLM
        const requestId = `call-agent-steps-${max_steps}-${Date.now()}`;
        const response = await llmProvider.generateContent(prompt, requestId);

        // Parse response
        const parsed = (executor as any).parseSingleResponse(response, outputSchema, 'xml');

        // Extract tool calls
        const toolCalls = (parsed as any).tool_calls as ToolCallRequest[] | undefined;
        const validToolCalls = (executor as any).filterValidToolCalls(toolCalls);

        // Capture step
        capturedSteps.push({
          iteration,
          prompt,
          response,
          toolCalls: validToolCalls,
          output: parsed,
          toolContext: toolContext.map(tc => ({
            tool_name: tc.tool_name,
            success: tc.success,
            result: tc.result,
          })),
        });

        // Execute tools if any
        if (validToolCalls.length > 0) {
          const toolResults = await (executor as any).executeToolCalls(validToolCalls, toolExecutor);
          toolContext.push(...toolResults);
        } else {
          // No more tool calls - return the response
          break;
        }
      }

      // Return the last step
      const lastStep = capturedSteps[capturedSteps.length - 1];
      return lastStep;
    },

    create_conversation: async (args: { title: string; tags?: string[] }) => {
      const { title, tags = [] } = args;

      // Create agent to access conversationStorage
      const agentOptions: RagAgentOptions = {
        ...ctx.defaultAgentOptions,
      } as RagAgentOptions;

      const agent = await ctx.createAgent(agentOptions);
      const conversationStorage = (agent as any).conversationStorage;

      if (!conversationStorage) {
        throw new Error('ConversationStorage not available. Agent must be created with conversationStorage enabled.');
      }

      // Generate conversation ID
      const { v4: uuidv4 } = await import('uuid');
      const conversationId = uuidv4();

      // Create conversation in storage
      const now = normalizeTimestamp(new Date());
      await conversationStorage.createConversation({
        uuid: conversationId,
        title,
        tags,
        created_at: now,
        updated_at: now,
        message_count: 0,
        total_chars: 0,
        status: 'active',
      });

      // Optionally set as current conversation
      if (ctx.setConversationId) {
        ctx.setConversationId(conversationId);
      }

      return {
        conversationId,
        title,
        tags,
        message: 'Conversation created successfully. Use switch_conversation to activate it, or use this ID with extract_agent_prompt.',
      };
    },

    switch_conversation: async (args: { conversation_id: string }) => {
      const { conversation_id } = args;

      // Create agent to access conversationStorage
      const agentOptions: RagAgentOptions = {
        ...ctx.defaultAgentOptions,
      } as RagAgentOptions;

      const agent = await ctx.createAgent(agentOptions);
      const conversationStorage = (agent as any).conversationStorage;

      if (!conversationStorage) {
        throw new Error('ConversationStorage not available. Agent must be created with conversationStorage enabled.');
      }

      // Verify conversation exists
      const metadata = await conversationStorage.getConversationMetadata(conversation_id);
      if (!metadata) {
        throw new Error(`Conversation ${conversation_id} not found. Use create_conversation first.`);
      }

      // Set as current conversation
      if (ctx.setConversationId) {
        ctx.setConversationId(conversation_id);
      }

      return {
        conversationId: conversation_id,
        title: metadata.title,
        tags: metadata.tags,
        messageCount: metadata.message_count,
        message: 'Conversation switched successfully. Future calls to extract_agent_prompt or call_agent will use enriched context from this conversation.',
      };
    },

    analyze_agent_session: async (args: {
      session_log_path?: string;
      focus_areas?: string[];
      max_iterations?: number;
    }): Promise<SessionAnalysisResult> => {
      const { focus_areas = [], max_iterations = 5 } = args;
      let { session_log_path } = args;

      const sessionsDir = path.join(os.homedir(), '.ragforge', 'logs', 'agent-sessions');

      // If no path provided, find the most recent session directory
      if (!session_log_path) {
        logger.info('No session_log_path provided, finding most recent session...');
        try {
          const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
          const sessionDirs = entries
            .filter(e => e.isDirectory() && e.name.startsWith('session-'))
            .map(e => ({ name: e.name, path: path.join(sessionsDir, e.name) }))
            .sort((a, b) => b.name.localeCompare(a.name)); // Sort descending by name (timestamp)

          if (sessionDirs.length === 0) {
            throw new Error(`No session directories found in ${sessionsDir}`);
          }

          session_log_path = sessionDirs[0].path;
          logger.info(`Using most recent session: ${session_log_path}`);
        } catch (error: any) {
          throw new Error(`Failed to find session directories: ${error.message}`);
        }
      }

      logger.info('analyze_agent_session called', { session_log_path, focus_areas, max_iterations });

      // Resolve path (handle ~ for home directory)
      let resolvedPath = session_log_path.startsWith('~')
        ? path.join(os.homedir(), session_log_path.slice(1))
        : session_log_path;

      // If it's a .json file, check if corresponding directory exists and use that instead
      if (resolvedPath.endsWith('.json')) {
        const dirPath = resolvedPath.replace(/\.json$/, '');
        try {
          const dirStats = await fs.stat(dirPath);
          if (dirStats.isDirectory()) {
            logger.info(`Redirecting from JSON to directory: ${dirPath}`);
            resolvedPath = dirPath;
          }
        } catch {
          // Directory doesn't exist, continue with JSON file
        }
      }

      // Check if it's a directory (session folder) or a JSON file
      const stats = await fs.stat(resolvedPath);
      const isDirectory = stats.isDirectory();

      let sessionData: any = {};
      let rawPromptsAndResponses: string[] = [];

      if (isDirectory) {
        // Read from session folder - get raw prompts and responses
        // OPTIMIZATION: Send ALL responses but only the LAST prompt
        // This provides enough context for analysis while reducing input size
        const promptsDir = path.join(resolvedPath, 'prompts');

        try {
          const files = await fs.readdir(promptsDir);

          // Parse and sort files by iteration and round
          const parsedFiles = files.map(f => {
            const match = f.match(/(prompt|response)-iter(\d+)-round(\d+)\.txt/);
            if (!match) return null;
            return {
              filename: f,
              type: match[1] as 'prompt' | 'response',
              iter: parseInt(match[2]),
              round: parseInt(match[3])
            };
          }).filter(Boolean) as Array<{ filename: string; type: 'prompt' | 'response'; iter: number; round: number }>;

          // Sort by iteration, then round, then type (prompt before response)
          parsedFiles.sort((a, b) => {
            if (a.iter !== b.iter) return a.iter - b.iter;
            if (a.round !== b.round) return a.round - b.round;
            return a.type === 'prompt' ? -1 : 1;
          });

          // Filter to max_iterations
          const filteredFiles = parsedFiles.filter(f => f.iter <= max_iterations);

          // Find the last prompt file
          const lastPromptFile = filteredFiles.filter(f => f.type === 'prompt').pop();

          // Collect: all responses + only last prompt
          for (const file of filteredFiles) {
            // Skip prompts except the last one
            if (file.type === 'prompt' && file !== lastPromptFile) {
              continue;
            }

            const content = await fs.readFile(path.join(promptsDir, file.filename), 'utf-8');
            const fileType = file.type.toUpperCase();
            const isLastPrompt = file === lastPromptFile;
            const header = `\n${'='.repeat(60)}\n${fileType} - Iteration ${file.iter}, Round ${file.round}${isLastPrompt ? ' (LAST PROMPT - CURRENT STATE)' : ''}\n${'='.repeat(60)}\n`;
            rawPromptsAndResponses.push(header + content);
          }

          // Also try to read the session JSON for metadata
          const jsonPath = resolvedPath + '.json';
          try {
            const jsonContent = await fs.readFile(jsonPath, 'utf-8');
            sessionData = JSON.parse(jsonContent);
          } catch {
            // JSON file might not exist, that's ok
          }
        } catch (error: any) {
          throw new Error(`Failed to read session folder: ${error.message}`);
        }
      } else {
        // Read from JSON file (legacy mode)
        try {
          const content = await fs.readFile(resolvedPath, 'utf-8');
          sessionData = JSON.parse(content);
        } catch (error: any) {
          throw new Error(`Failed to read session log: ${error.message}`);
        }
      }

      // Create LLM provider and executor
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error('GEMINI_API_KEY environment variable is required for session analysis');
      }

      const llmProvider = new GeminiAPIProvider({
        apiKey: geminiApiKey,
        model: 'gemini-2.0-flash',
        maxOutputTokens: 20000, // Allow long responses for detailed analysis + improved prompt
      });

      const executor = new StructuredLLMExecutor();

      // Build analysis prompt with session data
      const sessionSummary = buildSessionSummary(sessionData);
      const focusInstructions = focus_areas.length > 0
        ? `\n\nFocus your analysis particularly on these areas: ${focus_areas.join(', ')}`
        : '';

      const systemPrompt = `You are an expert in **prompt engineering** and **AI agent behavior analysis**. You have deep expertise in:
- Crafting effective system prompts that guide LLM behavior
- Analyzing agent traces to identify inefficiencies and anti-patterns
- Optimizing tool-calling agents for better performance
- Writing clear, actionable instructions that prevent common agent mistakes

Your job is to analyze agent session logs and provide detailed, actionable feedback with a focus on **improving the system prompt**.

You will be given a session log containing:
- The original question/task
- Each iteration with tool calls and results
- Timing information
- The final report/answer

Analyze the session thoroughly and provide:
1. **Scores** (0-10): overall quality and efficiency
2. **Tool Analysis**: identify redundant calls, useful calls, wasted time, missed opportunities
3. **Reasoning Quality**: evaluate if the agent had a clear plan, exploited results well, adapted strategy
4. **Issues**: list specific problems with severity levels
5. **Suggestions**: concrete improvements for the agent
6. **Prompt Corrections**: For each issue, provide a specific correction

7. **MOST IMPORTANT - Improved System Prompt**: Write a COMPLETE, IMPROVED system prompt that incorporates ALL the corrections. This should be:
   - A full, ready-to-use system prompt (not fragments)
   - Long and detailed (several paragraphs)
   - Include specific instructions to prevent each detected issue
   - Include examples of good vs bad behavior where relevant
   - Be written in a clear, directive style that LLMs respond well to
   - This is the PRIMARY deliverable of your analysis${focusInstructions}`;

      // Build the session content to analyze
      let sessionContent: string;
      if (rawPromptsAndResponses.length > 0) {
        // Use raw prompts and responses (more detailed)
        sessionContent = `=== SESSION ANALYSIS ===

QUESTION: ${sessionData.question || 'Unknown'}
CONFIG: max_iterations=${sessionData.config?.maxIterations ?? 'N/A'}, summarize_tool_context=${sessionData.config?.summarizeToolContext ?? 'N/A'}

=== RAW PROMPTS AND RESPONSES ===
${rawPromptsAndResponses.join('\n')}

=== FINAL RESULT ===
Report length: ${sessionData.result?.report?.length ?? 0} chars
Confidence: ${sessionData.result?.confidence ?? 'N/A'}
Tools used: ${sessionData.result?.toolsUsed?.join(', ') ?? 'N/A'}
Iterations: ${sessionData.result?.iterations ?? 'N/A'}`;
      } else {
        // Fallback to JSON summary
        sessionContent = sessionSummary;
      }

      const userTask = `Analyze this agent session and provide detailed feedback:

${sessionContent}`;

      // Define output schema matching SessionAnalysisResult
      const outputSchema = {
        overall_score: {
          type: 'number' as const,
          description: 'Overall quality score 0-10',
          required: true,
        },
        efficiency_score: {
          type: 'number' as const,
          description: 'Efficiency score 0-10 (higher = less waste)',
          required: true,
        },
        tool_analysis: {
          type: 'object' as const,
          description: 'Analysis of tool calls',
          required: true,
          properties: {
            total_calls: { type: 'number' as const, description: 'Total number of tool calls' },
            redundant_calls: { type: 'number' as const, description: 'Number of redundant/duplicate calls' },
            useful_calls: { type: 'number' as const, description: 'Number of useful calls that contributed to the answer' },
            wasted_time_ms: { type: 'number' as const, description: 'Estimated wasted time in milliseconds' },
            missed_opportunities: {
              type: 'array' as const,
              items: { type: 'string' as const, description: 'A missed opportunity' },
              description: 'Tools or approaches the agent should have used but didn\'t',
            },
          },
        },
        reasoning_quality: {
          type: 'object' as const,
          description: 'Quality of agent reasoning',
          required: true,
          properties: {
            clear_plan: { type: 'boolean' as const, description: 'Did the agent have a clear plan?' },
            exploits_results: { type: 'boolean' as const, description: 'Did the agent use tool results effectively?' },
            adapts_strategy: { type: 'boolean' as const, description: 'Did the agent adapt when needed?' },
            avoids_repetition: { type: 'boolean' as const, description: 'Did the agent avoid repeating actions?' },
          },
        },
        issues: {
          type: 'array' as const,
          description: 'List of issues detected',
          required: true,
          items: {
            type: 'object' as const,
            description: 'An issue detected in the session',
            properties: {
              type: {
                type: 'string' as const,
                enum: ['redundancy', 'inefficiency', 'missed_info', 'wrong_tool', 'loop', 'other'],
                description: 'Type of issue',
              },
              description: { type: 'string' as const, description: 'Detailed description of the issue' },
              severity: {
                type: 'string' as const,
                enum: ['low', 'medium', 'high'],
                description: 'Severity level',
              },
              iteration: { type: 'number' as const, description: 'Iteration where the issue occurred (optional)' },
              tool_name: { type: 'string' as const, description: 'Tool involved (optional)' },
            },
          },
        },
        suggestions: {
          type: 'array' as const,
          items: { type: 'string' as const, description: 'A suggestion for improvement' },
          description: 'Concrete suggestions for improvement',
          required: true,
        },
        prompt_corrections: {
          type: 'array' as const,
          description: 'System prompt corrections to prevent detected issues',
          required: true,
          items: {
            type: 'object' as const,
            description: 'A system prompt correction',
            properties: {
              issue: { type: 'string' as const, description: 'The issue this correction addresses' },
              current_behavior: { type: 'string' as const, description: 'What the agent currently does wrong' },
              suggested_addition: {
                type: 'string' as const,
                description: 'Exact text to add to the system prompt (be specific and actionable)',
              },
              priority: {
                type: 'string' as const,
                enum: ['low', 'medium', 'high'],
                description: 'Priority of this correction',
              },
            },
          },
        },
        summary: {
          type: 'string' as const,
          description: 'Human-readable summary of the analysis',
          required: true,
        },
        improved_system_prompt: {
          type: 'string' as const,
          description: 'COMPLETE improved system prompt incorporating all corrections. This should be a full, ready-to-use prompt with detailed instructions to prevent all detected issues.',
          required: true,
        },
      };

      // Execute analysis with structured output
      const requestId = `analyze-session-${Date.now()}`;

      logger.info('Calling executeSingle for session analysis', { requestId });

      const result = await executor.executeSingle<SessionAnalysisResult>({
        input: { session_data: sessionSummary },
        inputFields: [{ name: 'session_data', prompt: 'The session log data to analyze' }],
        systemPrompt,
        userTask,
        outputSchema,
        llmProvider,
        requestId,
        caller: 'agent-tools.analyze_agent_session',
        outputFormat: 'xml',
      });

      logger.info('Session analysis complete', {
        overall_score: result.overall_score,
        efficiency_score: result.efficiency_score,
        issues_count: result.issues?.length ?? 0,
        prompt_corrections_count: result.prompt_corrections?.length ?? 0,
      });

      // Save analysis result to file for later reference
      const outputDir = path.join(os.homedir(), '.ragforge', 'logs', 'session-analyses');
      await fs.mkdir(outputDir, { recursive: true });

      const timestamp = getFilenameTimestamp();
      const outputPath = path.join(outputDir, `analysis-${timestamp}.json`);
      await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');

      // Also save the improved_system_prompt as a separate .md file for easy reading
      if (result.improved_system_prompt) {
        const promptPath = path.join(outputDir, `improved-prompt-${timestamp}.md`);
        await fs.writeFile(promptPath, `# Improved System Prompt\n\nGenerated: ${timestamp}\n\n---\n\n${result.improved_system_prompt}`, 'utf-8');
      }

      logger.info('Analysis saved to files', { outputPath });

      // Add output paths to result
      return {
        ...result,
        _output_files: {
          analysis_json: outputPath,
          improved_prompt_md: result.improved_system_prompt ? path.join(outputDir, `improved-prompt-${timestamp}.md`) : undefined,
        },
      };
    },
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build a human-readable summary of a session log for analysis
 */
function buildSessionSummary(sessionData: any): string {
  const lines: string[] = [];

  // Header
  lines.push('=== SESSION LOG ANALYSIS ===\n');

  // Question
  if (sessionData.question) {
    lines.push(`QUESTION: ${sessionData.question}\n`);
  }

  // Config
  if (sessionData.config) {
    lines.push(`CONFIG: max_iterations=${sessionData.config.maxIterations}, summarize_tool_context=${sessionData.config.summarizeToolContext}\n`);
  }

  // Iterations
  if (sessionData.iterations && Array.isArray(sessionData.iterations)) {
    lines.push(`\n=== ITERATIONS (${sessionData.iterations.length} total) ===\n`);

    for (const iter of sessionData.iterations) {
      lines.push(`\n--- Iteration ${iter.iteration} ---`);

      if (iter.tool_calls && Array.isArray(iter.tool_calls)) {
        lines.push(`Tool calls: ${iter.tool_calls.length}`);

        for (const tc of iter.tool_calls) {
          const duration = tc.duration_ms ? ` (${tc.duration_ms}ms)` : '';
          const success = tc.success ? '✓' : '✗';
          lines.push(`  ${success} ${tc.tool_name}${duration}`);

          // Arguments summary
          if (tc.arguments) {
            const argsStr = JSON.stringify(tc.arguments);
            lines.push(`    Args: ${argsStr.substring(0, 200)}${argsStr.length > 200 ? '...' : ''}`);
          }

          // Result summary
          if (tc.result) {
            const resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
            lines.push(`    Result: ${resultStr.substring(0, 300)}${resultStr.length > 300 ? '...' : ''}`);
          }

          if (tc.error) {
            lines.push(`    Error: ${tc.error}`);
          }
        }
      }

      if (iter.reasoning) {
        lines.push(`  Reasoning: ${iter.reasoning.substring(0, 200)}...`);
      }
    }
  }

  // Final result
  if (sessionData.result) {
    lines.push('\n=== FINAL RESULT ===');
    lines.push(`Report length: ${sessionData.result.report?.length ?? 0} chars`);
    lines.push(`Confidence: ${sessionData.result.confidence ?? 'N/A'}`);
    lines.push(`Tools used: ${sessionData.result.toolsUsed?.join(', ') ?? 'N/A'}`);
    lines.push(`Iterations: ${sessionData.result.iterations ?? 'N/A'}`);

    if (sessionData.result.report) {
      lines.push(`\nReport preview:\n${sessionData.result.report.substring(0, 500)}...`);
    }
  }

  // Timing
  if (sessionData.timing) {
    lines.push('\n=== TIMING ===');
    lines.push(`Total duration: ${sessionData.timing.total_ms ?? 'N/A'}ms`);
  }

  return lines.join('\n');
}
