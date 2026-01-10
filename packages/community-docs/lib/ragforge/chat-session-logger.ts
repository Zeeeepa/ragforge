/**
 * Chat Session Logger
 *
 * Logs complete chat sessions with:
 * - System prompt
 * - User message
 * - Tool calls (name, args, results)
 * - Assistant response
 * - Metadata (timing, tokens, model)
 *
 * Logs are stored in ~/.ragforge/logs/community-docs/chat-sessions/
 * Each session gets its own directory with timestamped files.
 *
 * @since 2026-01-07
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CHAT_LOGS_DIR = path.join(
  os.homedir(),
  ".ragforge",
  "logs",
  "community-docs",
  "chat-sessions"
);

// ============================================================================
// TYPES
// ============================================================================

export interface ToolCallLog {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "completed" | "error";
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  error?: string;
}

export interface ChatSessionLog {
  conversationId: string;
  messageId?: string;
  timestamp: string;
  model: string;

  // Input
  systemPrompt: string;
  userMessage: string;
  conversationContext?: string;

  // Output
  assistantResponse: string;
  finishReason?: string;

  // Tool usage
  toolCalls: ToolCallLog[];
  totalSteps: number;

  // Metrics
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };

  // Timing
  startTime: string;
  endTime?: string;
  totalDurationMs?: number;

  // Errors
  error?: string;
  errorStack?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getTimestampForFilename(): string {
  const now = new Date();
  return now.toISOString()
    .replace(/:/g, "-")
    .replace(/\./g, "-");
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// CHAT SESSION LOGGER CLASS
// ============================================================================

export class ChatSessionLogger {
  private sessionDir: string;
  private log: Partial<ChatSessionLog>;
  private toolCalls: ToolCallLog[] = [];
  private startTime: Date;

  constructor(conversationId: string) {
    const timestamp = getTimestampForFilename();
    this.sessionDir = path.join(CHAT_LOGS_DIR, conversationId, timestamp);
    this.startTime = new Date();
    this.log = {
      conversationId,
      timestamp: formatTimestamp(),
      startTime: formatTimestamp(),
      toolCalls: [],
      totalSteps: 0,
    };
  }

  /**
   * Set the model being used
   */
  setModel(model: string): void {
    this.log.model = model;
  }

  /**
   * Set the system prompt
   */
  setSystemPrompt(prompt: string): void {
    this.log.systemPrompt = prompt;
  }

  /**
   * Set the user message
   */
  setUserMessage(message: string): void {
    this.log.userMessage = message;
  }

  /**
   * Set conversation context (previous messages)
   */
  setConversationContext(context: string): void {
    this.log.conversationContext = context;
  }

  /**
   * Log a tool call start
   */
  startToolCall(id: string, name: string, args?: Record<string, unknown>): void {
    this.toolCalls.push({
      id,
      name,
      args,
      status: "pending",
      startTime: formatTimestamp(),
    });
  }

  /**
   * Log a tool call result
   */
  completeToolCall(id: string, result: unknown): void {
    const toolCall = this.toolCalls.find((tc) => tc.id === id);
    if (toolCall) {
      toolCall.result = result;
      toolCall.status = "completed";
      toolCall.endTime = formatTimestamp();
      if (toolCall.startTime) {
        toolCall.durationMs = new Date().getTime() - new Date(toolCall.startTime).getTime();
      }
    }
  }

  /**
   * Log a tool call error
   */
  errorToolCall(id: string, error: string): void {
    const toolCall = this.toolCalls.find((tc) => tc.id === id);
    if (toolCall) {
      toolCall.status = "error";
      toolCall.error = error;
      toolCall.endTime = formatTimestamp();
    }
  }

  /**
   * Set the number of steps executed
   */
  setTotalSteps(steps: number): void {
    this.log.totalSteps = steps;
  }

  /**
   * Set the assistant's response
   */
  setAssistantResponse(response: string): void {
    this.log.assistantResponse = response;
  }

  /**
   * Set the finish reason
   */
  setFinishReason(reason: string): void {
    this.log.finishReason = reason;
  }

  /**
   * Set token usage
   */
  setUsage(usage: { inputTokens?: number; outputTokens?: number }): void {
    this.log.usage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: (usage.inputTokens || 0) + (usage.outputTokens || 0),
    };
  }

  /**
   * Set error information
   */
  setError(error: Error | string): void {
    if (error instanceof Error) {
      this.log.error = error.message;
      this.log.errorStack = error.stack;
    } else {
      this.log.error = error;
    }
  }

  /**
   * Save the session log to disk
   */
  async save(): Promise<string> {
    // Finalize timing
    this.log.endTime = formatTimestamp();
    this.log.totalDurationMs = new Date().getTime() - this.startTime.getTime();
    this.log.toolCalls = this.toolCalls;

    // Ensure directory exists
    await ensureDir(this.sessionDir);

    // Save metadata.json
    const metadata = {
      conversationId: this.log.conversationId,
      messageId: this.log.messageId,
      timestamp: this.log.timestamp,
      model: this.log.model,
      finishReason: this.log.finishReason,
      totalSteps: this.log.totalSteps,
      toolCallCount: this.toolCalls.length,
      toolsUsed: [...new Set(this.toolCalls.map((tc) => tc.name))],
      usage: this.log.usage,
      timing: {
        startTime: this.log.startTime,
        endTime: this.log.endTime,
        totalDurationMs: this.log.totalDurationMs,
      },
      error: this.log.error,
    };
    await fs.writeFile(
      path.join(this.sessionDir, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );

    // Save prompt.txt (system + user message)
    const promptContent = [
      "=== SYSTEM PROMPT ===",
      this.log.systemPrompt || "(none)",
      "",
      "=== CONVERSATION CONTEXT ===",
      this.log.conversationContext || "(none)",
      "",
      "=== USER MESSAGE ===",
      this.log.userMessage || "(none)",
    ].join("\n");
    await fs.writeFile(path.join(this.sessionDir, "prompt.txt"), promptContent);

    // Save response.txt
    await fs.writeFile(
      path.join(this.sessionDir, "response.txt"),
      this.log.assistantResponse || "(no response)"
    );

    // Save tool-calls.json (detailed tool usage)
    if (this.toolCalls.length > 0) {
      await fs.writeFile(
        path.join(this.sessionDir, "tool-calls.json"),
        JSON.stringify(this.toolCalls, null, 2)
      );
    }

    // Save full-log.json (everything)
    await fs.writeFile(
      path.join(this.sessionDir, "full-log.json"),
      JSON.stringify(this.log, null, 2)
    );

    console.log(`[ChatSessionLogger] Saved to ${this.sessionDir}`);
    return this.sessionDir;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new chat session logger
 */
export function createChatSessionLogger(conversationId: string): ChatSessionLogger {
  return new ChatSessionLogger(conversationId);
}

// ============================================================================
// EXPORTS
// ============================================================================

export const CHAT_LOGS_PATH = CHAT_LOGS_DIR;
