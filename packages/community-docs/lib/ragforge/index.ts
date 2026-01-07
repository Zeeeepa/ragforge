/**
 * RagForge Integration for Community Docs
 *
 * @since 2025-01-03
 */

// Neo4j Client
export { Neo4jClient, getNeo4jClient, closeNeo4jClient } from "./neo4j-client";
export type { Neo4jClientConfig } from "./neo4j-client";

// Embedding Service
export { OllamaEmbeddingService } from "./embedding-service";
export type { OllamaEmbeddingConfig, EmbeddingResponse } from "./embedding-service";

// Types
export type {
  CommunityNodeMetadata,
  SearchFilters,
  SearchResult,
  IngestionResult,
  DocumentChunk,
} from "./types";

// API Server
export { CommunityAPIServer, startCommunityAPI } from "./api/server";

// API Client (for Next.js routes)
export { RagForgeAPIClient, getRagForgeClient, buildNodeMetadata } from "./api-client";

// Parsers (from @ragforge/core)
export {
  initializeParsers,
  isParsersInitialized,
  parseFile,
  canParse,
  getParserName,
  getSupportedExtensions,
} from "./parsers";

// State Machine
export {
  DocumentStateMachine,
  type DocumentState,
  type DocumentStateInfo,
  type NodeState,
  type NodeStateInfo,
  type StateCounts,
  isValidTransition,
  getNextState,
  isTerminalState,
  isInProgressState,
  STATE_PROPERTIES,
  P,
} from "./state";

// Logger
export {
  Logger,
  createAPILogger,
  createPipelineLogger,
  getAPILogger,
  getPipelineLogger,
  LOG_FILES,
  type LogLevel,
  type LoggerOptions,
} from "./logger";

// Upload Adapter (wraps UniversalSourceAdapter from @ragforge/core)
export {
  CommunityUploadAdapter,
  getUploadAdapter,
  resetUploadAdapter,
} from "./upload-adapter";
export type {
  UploadedFile,
  ParseUploadOptions,
  ParseUploadResult,
} from "./upload-adapter";

// Orchestrator Adapter (uses IngestionOrchestrator with transformGraph hook)
export {
  CommunityOrchestratorAdapter,
  getCommunityOrchestrator,
  resetCommunityOrchestrator,
} from "./orchestrator-adapter";
export type {
  CommunityOrchestratorOptions,
  CommunityIngestionOptions,
  CommunityVirtualIngestionOptions,
  CommunitySearchOptions,
  CommunitySearchResult,
  CommunitySearchResultSet,
} from "./orchestrator-adapter";

// Re-export post-processing types from @ragforge/core (for convenience)
export type {
  ExplorationGraph,
  GraphNode,
  GraphEdge,
  SummaryResult,
} from "@luciformresearch/ragforge";

// Entity Types
export type {
  Entity,
  EntityType,
  PersonEntity,
  OrganizationEntity,
  LocationEntity,
  ConceptEntity,
  TechnologyEntity,
  DateEventEntity,
  ProductEntity,
  ExtractedTag,
  SuggestedCategory,
  DocumentEnrichment,
  NodeEnrichment,
  EnrichmentResult,
  EnrichmentOptions,
  EntityMatch,
  ResolutionResult,
  EntityNode,
  TagNode,
} from "./entity-types";
export { DEFAULT_ENRICHMENT_OPTIONS } from "./entity-types";

// Enrichment Service (LLM-based entity/tag extraction)
export {
  EnrichmentService,
  createEnrichmentService,
  type NodeToEnrich,
  type DocumentContext,
} from "./enrichment-service";

// Entity Resolution Service (cross-document deduplication)
export {
  EntityResolutionService,
  createEntityResolutionService,
  DEFAULT_RESOLUTION_OPTIONS,
  type EntityResolutionOptions,
} from "./entity-resolution-service";

// Entity Embedding Service (embeddings for Entity/Tag nodes + hybrid search)
export {
  EntityEmbeddingService,
  type EntityEmbeddingConfig,
  type EntityEmbeddingResult,
  type EntitySearchOptions,
  type EntitySearchResult,
} from "./entity-embedding-service";
