/**
 * State Machine Module
 *
 * Exports for document and node state management.
 *
 * @since 2025-01-04
 */

export {
  DocumentStateMachine,
} from "./document-state-machine";

export {
  // Document state types
  type DocumentState,
  type DocumentErrorType,
  type DocumentStateInfo,
  type TransitionOptions,
  type BatchTransition,
  type StateCounts,

  // Node state types
  type NodeState,
  type NodeStateInfo,

  // State utilities
  isValidTransition,
  getNextState,
  isTerminalState,
  isInProgressState,
  VALID_TRANSITIONS,

  // State property names
  STATE_PROPERTIES,
  P,
} from "./types";
