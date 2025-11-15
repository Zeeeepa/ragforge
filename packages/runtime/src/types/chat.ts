/**
 * Generic Chat Types
 *
 * These types are domain-agnostic and work with any RagForge configuration.
 */

/**
 * Chat session
 */
export interface ChatSession {
  sessionId: string;
  title: string;
  domain?: string;              // Optional: 'code', 'products', 'documents', etc.
  createdAt: Date;
  lastActiveAt: Date;
  metadata?: Record<string, any>;
}

/**
 * Message in a chat session
 */
export interface Message {
  messageId: string;
  sessionId: string;
  content: string;
  role: 'user' | 'agent' | 'system';
  sentBy: string;               // User ID or Agent ID
  timestamp: Date;
  tokens?: number;
  toolCalls?: ToolCall[];
  metadata?: Record<string, any>;
}

/**
 * Tool call made by an agent
 */
export interface ToolCall {
  toolName: string;
  arguments: Record<string, any>;
  result?: any;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  id: string;
  name: string;
  domain?: string;              // Optional: for organization
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
  tools: string[];              // Tool names (auto-generated from client)
  metadata?: Record<string, any>;
}

/**
 * Tool definition
 */
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, any>) => Promise<any>;
  domain?: string;
}

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: any;
}

/**
 * Context window for LLM
 */
export interface ContextWindow {
  messages: Message[];
  summaries?: any[];
  totalTokens: number;
}
