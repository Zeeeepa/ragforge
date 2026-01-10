/**
 * Agent Module - Main exports
 *
 * Provides a Vercel AI SDK-based chat agent with:
 * - Knowledge base search tools
 * - Document ingestion tools
 * - Web fetching tools
 * - Streaming responses
 */

// Tools
export {
  createAgentTools,
  type ToolContext,
  type AgentToolName,
  AGENT_TOOL_NAMES,
} from "./tools";

// System Prompt
export {
  AGENT_SYSTEM_PROMPT,
  buildSystemPrompt,
} from "./system-prompt";
