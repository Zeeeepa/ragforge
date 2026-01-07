/**
 * Document State Machine Types
 *
 * Simplified state machine for community-docs documents.
 * Inspired by @ragforge/core's NodeStateMachine but adapted for document uploads.
 *
 * Flow:
 *   pending → parsing → parsed → linking → linked → embedding → ready
 *                  ↘      ↘         ↘          ↘          ↘
 *                   error  error     error      error      error
 *
 * @since 2025-01-04
 */

// ============================================================================
// DOCUMENT STATES
// ============================================================================

/**
 * Document states in the ingestion pipeline
 */
export type DocumentState =
  | 'pending'    // Document uploaded, awaiting parsing
  | 'parsing'    // Currently being parsed
  | 'parsed'     // Parsing complete, nodes created
  | 'linking'    // Creating relationships between nodes
  | 'linked'     // Relationships created, ready for embedding
  | 'embedding'  // Generating embeddings
  | 'ready'      // Fully processed
  | 'error';     // Failed at some stage

/**
 * Error types for the error state
 */
export type DocumentErrorType = 'parse' | 'link' | 'embed';

// ============================================================================
// STATE TRANSITIONS
// ============================================================================

/**
 * Valid state transitions
 */
export const VALID_TRANSITIONS: Record<DocumentState, DocumentState[]> = {
  pending:   ['parsing', 'error'],
  parsing:   ['parsed', 'error'],
  parsed:    ['linking', 'linked', 'error'],  // Can skip linking if no relations
  linking:   ['linked', 'error'],
  linked:    ['embedding', 'ready', 'error'], // Can skip embedding
  embedding: ['ready', 'error'],
  ready:     ['pending'],  // Reset if content changed
  error:     ['pending'],  // Retry
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(from: DocumentState, to: DocumentState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get the next expected state in the normal flow
 */
export function getNextState(current: DocumentState): DocumentState | null {
  const normalFlow: DocumentState[] = [
    'pending', 'parsing', 'parsed', 'linking', 'linked', 'embedding', 'ready'
  ];
  const idx = normalFlow.indexOf(current);
  if (idx === -1 || idx === normalFlow.length - 1) return null;
  return normalFlow[idx + 1];
}

/**
 * Check if a state is terminal (no further processing needed)
 */
export function isTerminalState(state: DocumentState): boolean {
  return state === 'ready';
}

/**
 * Check if a state is in-progress (actively being processed)
 */
export function isInProgressState(state: DocumentState): boolean {
  return state === 'parsing' || state === 'linking' || state === 'embedding';
}

// ============================================================================
// STATE INFO & OPTIONS
// ============================================================================

/**
 * Options for state transitions
 */
export interface TransitionOptions {
  /** Error type (required if transitioning to 'error') */
  errorType?: DocumentErrorType;

  /** Error message (optional, for debugging) */
  errorMessage?: string;

  /** Content hash (for tracking content changes) */
  contentHash?: string;

  /** Embedding provider (when transitioning to 'ready') */
  embeddingProvider?: string;

  /** Embedding model (when transitioning to 'ready') */
  embeddingModel?: string;
}

/**
 * Information about a document's state
 */
export interface DocumentStateInfo {
  /** Document ID (from Postgres) */
  documentId: string;

  /** Current state */
  state: DocumentState;

  /** Error type (if state is 'error') */
  errorType?: DocumentErrorType;

  /** Error message (if state is 'error') */
  errorMessage?: string;

  /** Number of retry attempts */
  retryCount: number;

  /** When the state last changed */
  stateChangedAt: Date;

  /** When parsing started */
  parseStartedAt?: Date;

  /** When parsing completed */
  parsedAt?: Date;

  /** When linking completed */
  linkedAt?: Date;

  /** When embedding completed */
  embeddedAt?: Date;

  /** Content hash for change detection */
  contentHash?: string;

  /** Number of nodes created */
  nodeCount?: number;

  /** Number of embeddings generated */
  embeddingsGenerated?: number;
}

/**
 * Batch transition entry
 */
export interface BatchTransition {
  /** Document ID */
  documentId: string;

  /** Target state */
  state: DocumentState;

  /** Transition options */
  options?: TransitionOptions;
}

/**
 * State count by type (for dashboards)
 */
export interface StateCounts {
  pending: number;
  parsing: number;
  parsed: number;
  linking: number;
  linked: number;
  embedding: number;
  ready: number;
  error: number;
}

// ============================================================================
// NODE STATE (for individual scopes/sections)
// ============================================================================

/**
 * Node states in the ingestion pipeline
 * Same as @ragforge/core for compatibility
 */
export type NodeState =
  | 'pending'    // Detected, waiting for processing
  | 'parsing'    // Currently being parsed
  | 'parsed'     // Parsing complete
  | 'linking'    // Creating relationships
  | 'linked'     // Relationships created
  | 'embedding'  // Generating embeddings
  | 'ready'      // Fully processed
  | 'skip'       // No embedding needed
  | 'error';     // Failed

/**
 * Node state info
 */
export interface NodeStateInfo {
  uuid: string;
  label: string;
  state: NodeState;
  errorType?: DocumentErrorType;
  errorMessage?: string;
  retryCount: number;
  stateChangedAt: Date;
  contentHash?: string;
}

// ============================================================================
// STATE PROPERTIES (Neo4j property names)
// ============================================================================

/**
 * Property names used for state tracking
 * Prefixed with _ to avoid conflicts with content properties
 */
export const STATE_PROPERTIES = {
  // Document-level
  docState: '_docState',
  docStateChangedAt: '_docStateChangedAt',
  docErrorType: '_docErrorType',
  docErrorMessage: '_docErrorMessage',
  docRetryCount: '_docRetryCount',
  docParseStartedAt: '_docParseStartedAt',
  docParsedAt: '_docParsedAt',
  docLinkedAt: '_docLinkedAt',
  docEmbeddedAt: '_docEmbeddedAt',
  docContentHash: '_docContentHash',

  // Node-level (same as @ragforge/core)
  state: '_state',
  stateChangedAt: '_stateChangedAt',
  errorType: '_errorType',
  errorMessage: '_errorMessage',
  retryCount: '_retryCount',
  detectedAt: '_detectedAt',
  parsedAt: '_parsedAt',
  linkedAt: '_linkedAt',
  embeddedAt: '_embeddedAt',
  contentHash: '_contentHash',
  embeddingProvider: '_embeddingProvider',
  embeddingModel: '_embeddingModel',
} as const;

export const P = STATE_PROPERTIES;
