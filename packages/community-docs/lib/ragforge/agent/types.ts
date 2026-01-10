/**
 * Types pour le système de sessions de chat
 * Adapté de lr_chat avec storage Neo4j
 */

// ============================================================================
// Session Types
// ============================================================================

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage?: string;
  isActive: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  metadata?: {
    toolCalls?: ToolCallInfo[];
    finishReason?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
    };
  };
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

// ============================================================================
// Session Memory (for full state)
// ============================================================================

export interface SessionMemory {
  sessionId: string;
  messages: ChatMessage[];
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateSessionRequest {
  title?: string;
}

export interface CreateSessionResponse {
  success: boolean;
  session?: ChatSession;
  error?: string;
}

export interface ListSessionsResponse {
  success: boolean;
  sessions: ChatSession[];
  total: number;
}

export interface GetSessionResponse {
  success: boolean;
  session?: ChatSession;
  messages?: ChatMessage[];
  error?: string;
}

export interface UpdateSessionRequest {
  title?: string;
}

export interface DeleteSessionResponse {
  success: boolean;
  deleted?: string;
  error?: string;
}

// ============================================================================
// Chat Request/Response Types
// ============================================================================

export interface ChatRequest {
  sessionId?: string;
  message: string;
  attachments?: Attachment[];
  options?: {
    stream?: boolean;
    maxSteps?: number;
  };
}

export interface Attachment {
  type: "file" | "url";
  content: string;
  filename?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// SSE Event Types
// ============================================================================

export type SSEEventType =
  | "start"
  | "text-delta"
  | "tool-call"
  | "tool-result"
  | "finish"
  | "error";

export interface SSEEvent {
  type: SSEEventType;
  sessionId?: string;
  content?: string;
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  error?: string;
}
