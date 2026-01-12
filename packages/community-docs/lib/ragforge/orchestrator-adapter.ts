/**
 * Orchestrator Adapter for Community Docs
 *
 * Uses the EXACT same IngestionOrchestrator from @ragforge/core
 * with a transformGraph hook to inject community metadata.
 *
 * This ensures we get the FULL parsing pipeline:
 * - AST analysis, chunking, import resolution
 * - Metadata preservation (embeddings, UUIDs)
 * - Incremental ingestion
 *
 * @since 2025-01-04
 */

import {
  IngestionOrchestrator,
  IncrementalIngestionManager,
  UniversalSourceAdapter,
  Neo4jClient as CoreNeo4jClient,
  EmbeddingService,
  SearchService,
  // Vector index utility
  ensureVectorIndexes,
  // Post-processing functions
  applyKeywordBoost,
  exploreRelationships,
  summarizeSearchResults,
  rerankSearchResults,
  // Markdown formatter
  formatAsMarkdown,
  // Parsers for binary files
  documentParser,
  mediaParser,
  type OrchestratorDependencies,
  type FileChange,
  type IngestionStats,
  type VirtualFile,
  type EmbeddingProviderConfig,
  type SearchFilter,
  type ServiceSearchResult,
  type ServiceSearchResultSet,
  // Post-processing types
  type ExplorationGraph,
  type SummaryResult,
  // Formatter types
  type BrainSearchOutput,
  type FormatOptions,
  // Document parse options
  type DocumentParseOptions,
  type MediaParseOptions,
} from "@luciformresearch/ragforge";
import type { Neo4jClient } from "./neo4j-client";
import type { CommunityNodeMetadata } from "./types";
import { getPipelineLogger } from "./logger";
import type { EntityEmbeddingService, EntitySearchResult } from "./entity-embedding-service";
import { createEnrichmentService, type EnrichmentService, type DocumentContext } from "./enrichment-service";
import { EntityResolutionService, type EntityResolutionOptions } from "./entity-resolution-service";
import type { Entity, ExtractedTag } from "./entity-types";
import type { NodeToEnrich } from "./enrichment-service";

const logger = getPipelineLogger();

/**
 * Graph type from orchestrator
 */
type ParsedGraph = {
  nodes: Array<{ labels: string[]; id: string; properties: Record<string, any> }>;
  relationships: Array<{ type: string; from: string; to: string; properties?: Record<string, any> }>;
  metadata: { filesProcessed: number; nodesGenerated: number };
};

/**
 * Options for the community orchestrator
 */
export interface CommunityOrchestratorOptions {
  /** Neo4j client (port 7688) */
  neo4j: Neo4jClient;
  /** Embedding provider config (uses ragforge core EmbeddingService) */
  embeddingConfig?: EmbeddingProviderConfig;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Ingestion options with community metadata (disk files)
 */
export interface CommunityIngestionOptions {
  /** Files to ingest (as FileChange array) */
  files: Array<{
    path: string;
    changeType?: "created" | "updated" | "deleted";
  }>;
  /** Community metadata to inject on all nodes */
  metadata: CommunityNodeMetadata;
  /** Project ID (derived from documentId) */
  projectId?: string;
  /** Generate embeddings after ingestion */
  generateEmbeddings?: boolean;
}

/**
 * Search options for community-docs
 */
export interface CommunitySearchOptions {
  /** Search query */
  query: string;
  /** Filter by category slug */
  categorySlug?: string;
  /** Filter by user ID */
  userId?: string;
  /** Filter by document ID */
  documentId?: string;
  /** Filter by public status */
  isPublic?: boolean;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Use semantic search (default: true) */
  semantic?: boolean;
  /** Use hybrid search (default: true when semantic is true) */
  hybrid?: boolean;
  /** Embedding type to use */
  embeddingType?: "name" | "content" | "description" | "all";
  /** Maximum results */
  limit?: number;
  /** Minimum score threshold */
  minScore?: number;

  // === Post-processing options (from @ragforge/core) ===

  /** Keywords to boost results for (fuzzy Levenshtein matching) */
  boostKeywords?: string[];
  /** Boost weight per keyword match (default: 0.15) */
  boostWeight?: number;

  /** Explore relationships depth (1-3, 0 = disabled) */
  exploreDepth?: number;

  /** Summarize results with LLM */
  summarize?: boolean;
  /** Additional context for summarization */
  summarizeContext?: string;

  /** Rerank results with LLM */
  rerank?: boolean;

  // === Entity/Tag boost (enabled by default) ===

  /** Boost results that have matching entities/tags (default: true) */
  entityBoost?: boolean;
  /** Minimum entity/tag match score to apply boost (default: 0.7) */
  entityMatchThreshold?: number;
  /** Boost weight for entity/tag matches (default: 0.05) */
  entityBoostWeight?: number;
  /** Include matched entities/tags in results (default: false) */
  includeMatchedEntities?: boolean;

  // === Output formatting ===

  /** Output format: "json" (default), "markdown" (human-readable), "compact" */
  format?: "json" | "markdown" | "compact";
  /** Include source code in markdown output (default: true for first 5 results) */
  includeSource?: boolean;
  /** Maximum results to include source for (default: 5) */
  maxSourceResults?: number;
}

/**
 * Community search result
 */
export interface CommunitySearchResult {
  /** Node properties */
  node: Record<string, any>;
  /** Similarity score */
  score: number;
  /** File path (if available) */
  filePath?: string;
  /** Matched range info (when a chunk matched instead of the full node) */
  matchedRange?: {
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    chunkIndex: number;
    chunkScore: number;
    /** Page number from parent document (for PDFs/Word docs) */
    pageNum?: number | null;
  };
  /** Snippet of the matched content (chunk text or truncated content) */
  snippet?: string;
  /** Keyword boost info (if boost_keywords was used) */
  keywordBoost?: {
    keyword: string;
    similarity: number;
    boost: number;
  };
  /** Entity/tag boost applied (if entityBoost was used) */
  entityBoostApplied?: number;
  /** Matched entities/tags (if includeMatchedEntities: true) */
  matchedEntities?: Array<{
    uuid: string;
    name: string;
    type: 'Tag' | 'CanonicalEntity';
    matchScore: number;
  }>;
}

/**
 * Extended search result with post-processing data
 */
export interface CommunitySearchResultSet {
  results: CommunitySearchResult[];
  totalCount: number;
  /** Whether reranking was applied */
  reranked?: boolean;
  /** Whether keyword boosting was applied */
  keywordBoosted?: boolean;
  /** Whether entity/tag boosting was applied */
  entityBoosted?: boolean;
  /** Matching entities/tags found (if entityBoost was used) */
  matchingEntities?: Array<{
    uuid: string;
    name: string;
    type: 'Tag' | 'CanonicalEntity';
    score: number;
  }>;
  /** Whether relationships were explored */
  relationshipsExplored?: boolean;
  /** Whether results were summarized */
  summarized?: boolean;
  /** Relationship graph (if exploreDepth > 0) */
  graph?: ExplorationGraph;
  /** LLM summary (if summarize: true) */
  summary?: SummaryResult;
  /** Formatted output (if format is "markdown" or "compact") */
  formattedOutput?: string;
}

/**
 * Virtual file ingestion options (in-memory, no disk I/O)
 * Use this for scalable deployments where files come from databases/S3
 */
/**
 * Progress callback for long-running operations
 * @param phase - Current phase (parsing, nodes, relationships, etc.)
 * @param current - Current progress count
 * @param total - Total expected count
 * @param message - Optional human-readable message
 */
export type ProgressCallback = (phase: string, current: number, total: number, message?: string) => void;

export interface CommunityVirtualIngestionOptions {
  /** Virtual files with content in memory */
  virtualFiles: Array<{
    /** Virtual path (e.g., "src/api.ts") - will be prefixed automatically */
    path: string;
    /** File content as string or Buffer */
    content: string | Buffer;
  }>;
  /** Community metadata to inject on all nodes */
  metadata: CommunityNodeMetadata;
  /**
   * Source identifier for path prefixing.
   * Examples:
   * - GitHub: "github.com/owner/repo"
   * - Gist: "gist/abc123"
   * - Upload: "upload"
   *
   * Final path format: /virtual/{documentId}/{sourceIdentifier}/{filePath}
   */
  sourceIdentifier?: string;
  /** Project ID (derived from documentId) */
  projectId?: string;
  /** Generate embeddings after ingestion */
  generateEmbeddings?: boolean;
  /** Progress callback for SSE/real-time updates */
  onProgress?: ProgressCallback;
}

/**
 * Unified file ingestion options (handles all file types: text, binary docs, media)
 */
export interface UnifiedIngestionOptions {
  /** Files to ingest (buffer-based, no disk I/O) */
  files: Array<{
    /** File name (e.g., "paper.pdf", "image.png", "code.ts") */
    fileName: string;
    /** File content as Buffer */
    buffer: Buffer;
  }>;
  /** Community metadata to inject on all nodes */
  metadata: CommunityNodeMetadata;
  /** Document ID (used for projectId = `doc-${documentId}`) */
  documentId: string;
  /** Enable Vision-based parsing for PDFs and image analysis (default: false) */
  enableVision?: boolean;
  /** Vision analyzer function for image descriptions (required if enableVision is true for images) */
  visionAnalyzer?: (imageBuffer: Buffer, prompt?: string) => Promise<string>;
  /** 3D render function for model rendering (required if enableVision is true for 3D files) */
  render3D?: (modelPath: string) => Promise<Array<{ view: string; buffer: Buffer }>>;
  /** Section title detection mode for documents (default: 'detect') */
  sectionTitles?: 'none' | 'detect' | 'llm';
  /** Generate titles for sections without one using LLM (default: true) */
  generateTitles?: boolean;
  /** Generate embeddings after ingestion (default: true) */
  generateEmbeddings?: boolean;
  /** Extract entities and tags from document content and media descriptions (default: false) */
  extractEntities?: boolean;
  /** EnrichmentService instance for entity extraction (required if extractEntities is true) */
  enrichmentService?: import('./enrichment-service').EnrichmentService;
  /** EntityResolutionService instance for deduplication (optional, uses default if extractEntities is true) */
  entityResolutionService?: import('./entity-resolution-service').EntityResolutionService;
}

/**
 * Unified ingestion result
 */
export interface UnifiedIngestionResult {
  /** Total nodes created */
  nodesCreated: number;
  /** Total relationships created */
  relationshipsCreated: number;
  /** Number of embeddings generated */
  embeddingsGenerated: number;
  /** Stats by file type */
  stats: {
    textFiles: number;
    binaryDocs: number;
    mediaFiles: number;
    skipped: number;
    textNodes: number;
    binaryNodes: number;
    mediaNodes: number;
  };
  /** Entity extraction stats (if extractEntities was enabled) */
  entityStats?: {
    /** Number of entities extracted */
    entitiesExtracted: number;
    /** Number of tags extracted */
    tagsExtracted: number;
    /** Number of canonical entities created/updated */
    canonicalEntitiesCreated: number;
    /** Number of entity relationships created */
    entityRelationshipsCreated: number;
  };
  /** Warnings from parsing */
  warnings?: string[];
}

/**
 * Community Orchestrator Adapter
 *
 * Wraps IngestionOrchestrator with community-specific transformGraph hook
 */
export class CommunityOrchestratorAdapter {
  private orchestrator: IngestionOrchestrator | null = null;
  private sourceAdapter: UniversalSourceAdapter;
  private ingestionManager: IncrementalIngestionManager | null = null;
  private neo4j: Neo4jClient;
  private embeddingConfig: EmbeddingProviderConfig | null;
  private embeddingService: EmbeddingService | null = null;
  private searchService: SearchService | null = null;
  private coreClient: CoreNeo4jClient | null = null;
  private verbose: boolean;

  // Entity/Tag embedding service (for entity boost in search)
  private entityEmbeddingService: EntityEmbeddingService | null = null;

  // Current metadata for transformGraph hook
  private currentMetadata: CommunityNodeMetadata | null = null;

  constructor(options: CommunityOrchestratorOptions) {
    this.neo4j = options.neo4j;
    this.embeddingConfig = options.embeddingConfig ?? null;
    this.verbose = options.verbose ?? false;
    this.sourceAdapter = new UniversalSourceAdapter();
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    if (this.orchestrator) return;

    // Create a CoreNeo4jClient for IncrementalIngestionManager and EmbeddingService
    // Uses same env vars as community-docs Neo4jClient
    this.coreClient = new CoreNeo4jClient({
      uri: process.env.NEO4J_URI || "bolt://localhost:7688",
      username: process.env.NEO4J_USER || "neo4j",
      password: process.env.NEO4J_PASSWORD || "communitydocs",
    });

    // Get driver from coreClient to avoid type conflicts between neo4j-driver versions
    const driver = this.coreClient.getDriver();

    // Create EmbeddingService from ragforge core (with batching, multi-embedding support)
    if (this.embeddingConfig) {
      this.embeddingService = new EmbeddingService(this.coreClient, this.embeddingConfig);
      const providerType = "type" in this.embeddingConfig ? this.embeddingConfig.type : "unknown";
      logger.info(`[CommunityOrchestrator] EmbeddingService initialized (${providerType})`);
    }

    // Create SearchService from ragforge core (for semantic/hybrid search)
    this.searchService = new SearchService({
      neo4jClient: this.coreClient,
      embeddingService: this.embeddingService ?? undefined,
      verbose: this.verbose,
    });
    logger.info("[CommunityOrchestrator] SearchService initialized");

    // Ensure vector indexes exist (1024 dimensions for Ollama mxbai-embed-large)
    const indexResult = await ensureVectorIndexes(this.coreClient, {
      dimension: 1024,
      verbose: this.verbose,
    });
    logger.info(
      `[CommunityOrchestrator] Vector indexes: ${indexResult.created} created, ${indexResult.skipped} existed`
    );

    // Create IncrementalIngestionManager with CoreNeo4jClient
    this.ingestionManager = new IncrementalIngestionManager(this.coreClient);

    // Create orchestrator dependencies with transformGraph hook
    const deps: OrchestratorDependencies = {
      driver,

      // Parse files using UniversalSourceAdapter
      parseFiles: async (options) => {
        const result = await this.sourceAdapter.parse({
          source: {
            type: "files",
            root: options.root,
            include: options.include,
          },
          projectId: options.projectId,
          existingUUIDMapping: options.existingUUIDMapping,
        });

        return {
          nodes: result.graph.nodes,
          relationships: result.graph.relationships,
          metadata: {
            filesProcessed: result.graph.metadata.filesProcessed,
            nodesGenerated: result.graph.metadata.nodesGenerated,
          },
        };
      },

      // Ingest graph using IncrementalIngestionManager
      ingestGraph: async (graph, options) => {
        await this.ingestionManager!.ingestGraph(
          { nodes: graph.nodes, relationships: graph.relationships },
          { projectId: options.projectId, markDirty: true }
        );
      },

      // Delete nodes for files
      deleteNodesForFiles: async (files, _projectId) => {
        return this.ingestionManager!.deleteNodesForFiles(files);
      },

      // Generate embeddings (optional)
      // Note: We handle embeddings separately via generateEmbeddingsForDocument()
      // which uses ragforge core's EmbeddingService with batching
      generateEmbeddings: this.embeddingService
        ? async (_projectId) => {
            // Return 0 here, embeddings are handled separately after ingestion
            return 0;
          }
        : undefined,

      // Transform graph to inject community metadata
      transformGraph: (graph) => {
        if (!this.currentMetadata) {
          return graph;
        }

        const metadata = this.currentMetadata;
        const projectId = `doc-${metadata.documentId}`;
        logger.info(`Injecting community metadata on ${graph.nodes.length} nodes`);

        // Inject metadata on all nodes
        for (const node of graph.nodes) {
          // IMPORTANT: projectId is required for EmbeddingService to find nodes
          node.properties.projectId = projectId;
          // Document identity
          node.properties.documentId = metadata.documentId;
          node.properties.documentTitle = metadata.documentTitle;

          // User info
          node.properties.userId = metadata.userId;
          if (metadata.userUsername) {
            node.properties.userUsername = metadata.userUsername;
          }

          // Category info
          node.properties.categoryId = metadata.categoryId;
          node.properties.categorySlug = metadata.categorySlug;
          if (metadata.categoryName) {
            node.properties.categoryName = metadata.categoryName;
          }

          // Permissions
          if (metadata.isPublic !== undefined) {
            node.properties.isPublic = metadata.isPublic;
          }

          // Tags
          if (metadata.tags && metadata.tags.length > 0) {
            node.properties.tags = metadata.tags;
          }

          // Mark as community content
          node.properties.sourceType = "community-upload";

          // Extract sourceFormat from frontMatter if present (for PDF/DOCX parsed via vision)
          const frontMatter = node.properties.frontMatter as string | undefined;
          if (frontMatter && typeof frontMatter === 'string') {
            // Parse YAML frontmatter to extract sourceFormat
            const sourceFormatMatch = frontMatter.match(/sourceFormat:\s*["']?(\w+)["']?/);
            if (sourceFormatMatch) {
              node.properties.sourceFormat = sourceFormatMatch[1];
            }
            const parsedFromMatch = frontMatter.match(/parsedFrom:\s*["']?([\w-]+)["']?/);
            if (parsedFromMatch) {
              node.properties.parsedFrom = parsedFromMatch[1];
            }
          }
        }

        return graph;
      },
    };

    // Create orchestrator
    this.orchestrator = new IngestionOrchestrator(deps, {
      verbose: this.verbose,
      batchIntervalMs: 500,
      maxBatchSize: 50,
    });

    await this.orchestrator.initialize();
    logger.info("[CommunityOrchestrator] Initialized with transformGraph hook");
  }

  /**
   * Set the EntityEmbeddingService for entity/tag boost in search
   * This is initialized separately in server.ts
   */
  setEntityEmbeddingService(service: EntityEmbeddingService): void {
    this.entityEmbeddingService = service;
    logger.info("[CommunityOrchestrator] EntityEmbeddingService set for entity boost");
  }

  /**
   * Ingest files with community metadata
   */
  async ingest(options: CommunityIngestionOptions): Promise<IngestionStats> {
    await this.initialize();

    const {
      files,
      metadata,
      projectId = `doc-${metadata.documentId}`,
      generateEmbeddings = false,
    } = options;

    // Set current metadata for transformGraph hook
    this.currentMetadata = metadata;

    try {
      // Convert to FileChange array
      const changes: FileChange[] = files.map((f) => ({
        path: f.path,
        changeType: f.changeType || "created",
        projectId,
      }));

      logger.info(`Ingesting ${files.length} files for document: ${metadata.documentId}`);

      // Use orchestrator's reingest method
      const stats = await this.orchestrator!.reingest(changes, {
        projectId,
        generateEmbeddings,
        verbose: this.verbose,
      });

      logger.info(
        `Ingestion complete: ${stats.nodesCreated} nodes, ${stats.created} created, ${stats.updated} updated`
      );

      return stats;
    } finally {
      // Clear metadata after ingestion
      this.currentMetadata = null;
    }
  }

  /**
   * Ingest virtual files (in-memory) with community metadata.
   * No disk I/O - ideal for scalable/serverless deployments.
   *
   * @example
   * await adapter.ingestVirtual({
   *   virtualFiles: [
   *     { path: "/docs/api.ts", content: fileBuffer }
   *   ],
   *   metadata: { documentId: "123", ... }
   * });
   */
  async ingestVirtual(
    options: CommunityVirtualIngestionOptions
  ): Promise<{ nodesCreated: number; relationshipsCreated: number }> {
    await this.initialize();

    const {
      virtualFiles,
      metadata,
      sourceIdentifier = "upload",
      projectId = `doc-${metadata.documentId}`,
      onProgress,
    } = options;

    // Build virtual root prefix: /virtual/{documentId}/{sourceIdentifier}
    const virtualRoot = `/virtual/${metadata.documentId}/${sourceIdentifier}`;

    // Set current metadata for transformGraph hook
    this.currentMetadata = metadata;

    try {
      logger.info(
        `Ingesting ${virtualFiles.length} virtual files for document: ${metadata.documentId}`
      );
      logger.info(`Virtual root: ${virtualRoot}`);

      // Report parsing start
      onProgress?.("parsing", 0, virtualFiles.length, "Parsing files...");

      // Prefix all file paths with virtual root
      const prefixedFiles = virtualFiles.map((f) => {
        // Normalize path: remove leading slash if present
        const normalizedPath = f.path.startsWith("/") ? f.path.slice(1) : f.path;
        return {
          path: `${virtualRoot}/${normalizedPath}`,
          content: f.content,
        };
      });

      // Parse virtual files directly (no disk I/O)
      const result = await this.sourceAdapter.parse({
        source: {
          type: "virtual",
          virtualFiles: prefixedFiles,
        },
        projectId,
      });

      // Report parsing complete
      onProgress?.("parsing", virtualFiles.length, virtualFiles.length, `Parsed ${result.graph.nodes.length} nodes`);

      // Apply transformGraph hook to inject community metadata
      let graph = {
        nodes: result.graph.nodes,
        relationships: result.graph.relationships,
        metadata: {
          filesProcessed: result.graph.metadata.filesProcessed,
          nodesGenerated: result.graph.metadata.nodesGenerated,
        },
      };

      // Inject community metadata on all nodes
      // Pattern to detect binary documents converted to markdown (e.g., file.pdf.md, file.docx.md)
      const binaryDocPattern = /\.(pdf|docx|doc|xlsx|xls|odt|rtf)\.md$/i;

      for (const node of graph.nodes) {
        // IMPORTANT: projectId is required for EmbeddingService to find nodes
        node.properties.projectId = projectId;
        node.properties.documentId = metadata.documentId;
        node.properties.documentTitle = metadata.documentTitle;
        node.properties.userId = metadata.userId;
        if (metadata.userUsername) {
          node.properties.userUsername = metadata.userUsername;
        }
        node.properties.categoryId = metadata.categoryId;
        node.properties.categorySlug = metadata.categorySlug;
        if (metadata.categoryName) {
          node.properties.categoryName = metadata.categoryName;
        }
        if (metadata.isPublic !== undefined) {
          node.properties.isPublic = metadata.isPublic;
        }
        if (metadata.tags && metadata.tags.length > 0) {
          node.properties.tags = metadata.tags;
        }
        node.properties.sourceType = "community-upload";

        // Extract originalFileName and sourceFormat for binary documents converted to markdown
        // e.g., file.pdf.md -> file.pdf (originalFileName), pdf (sourceFormat)
        const filePath = node.properties.file as string | undefined;
        if (filePath && binaryDocPattern.test(filePath)) {
          // Remove the .md extension to get the original filename
          const originalFileName = filePath.replace(/\.md$/, '').split('/').pop();
          if (originalFileName) {
            node.properties.originalFileName = originalFileName;
            // Extract format from extension: file.pdf -> pdf, report.docx -> docx
            const formatMatch = originalFileName.match(/\.(\w+)$/);
            if (formatMatch) {
              node.properties.sourceFormat = formatMatch[1].toLowerCase();
            }
          }
        }
      }

      logger.info(`Injected community metadata on ${graph.nodes.length} nodes`);

      // Report nodes phase starting
      onProgress?.("nodes", 0, graph.nodes.length, "Creating nodes in Neo4j...");

      // Ingest graph into Neo4j with progress callback
      await this.ingestionManager!.ingestGraph(
        { nodes: graph.nodes, relationships: graph.relationships },
        { projectId, markDirty: true, onProgress }
      );

      logger.info(
        `Virtual ingestion complete: ${graph.nodes.length} nodes, ${graph.relationships.length} relationships`
      );

      // NOTE: Reference linking (REFERENCES, LINKS_TO, REFERENCES_IMAGE) is already done
      // during parsing in code-source-adapter.ts. No post-processing needed!

      return {
        nodesCreated: graph.nodes.length,
        relationshipsCreated: graph.relationships.length,
      };
    } finally {
      // Clear metadata after ingestion
      this.currentMetadata = null;
    }
  }

  // ==========================================================================
  // File Type Detection Helpers
  // ==========================================================================

  private static readonly BINARY_DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.odt', '.rtf']);
  private static readonly IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);
  private static readonly THREED_EXTENSIONS = new Set(['.glb', '.gltf', '.obj', '.fbx', '.stl', '.3ds']);
  private static readonly TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyi',
    '.md', '.mdx', '.markdown',
    '.json', '.yaml', '.yml', '.toml',
    '.html', '.htm', '.css', '.scss', '.less',
    '.vue', '.svelte',
    '.java', '.kt', '.scala',
    '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
    '.rb', '.php', '.swift', '.m',
    '.sql', '.graphql', '.prisma',
    '.sh', '.bash', '.zsh', '.fish',
    '.xml', '.csv', '.txt', '.env', '.gitignore',
  ]);

  private isBinaryDocument(ext: string): boolean {
    return CommunityOrchestratorAdapter.BINARY_DOC_EXTENSIONS.has(ext.toLowerCase());
  }

  private isMediaFile(ext: string): boolean {
    const extLower = ext.toLowerCase();
    return CommunityOrchestratorAdapter.IMAGE_EXTENSIONS.has(extLower) ||
           CommunityOrchestratorAdapter.THREED_EXTENSIONS.has(extLower);
  }

  private is3DModel(ext: string): boolean {
    return CommunityOrchestratorAdapter.THREED_EXTENSIONS.has(ext.toLowerCase());
  }

  private isTextFile(ext: string): boolean {
    return CommunityOrchestratorAdapter.TEXT_EXTENSIONS.has(ext.toLowerCase());
  }

  // ==========================================================================
  // Unified File Ingestion
  // ==========================================================================

  /**
   * Unified file ingestion - handles all file types in a single batch operation.
   *
   * This method:
   * 1. Classifies files by type (binary document, media, text)
   * 2. Parses each file with the appropriate parser
   * 3. Collects all nodes/relationships
   * 4. Performs a SINGLE ingestGraph operation
   * 5. Generates embeddings in batch at the end
   *
   * Use this for all ingestion operations to ensure consistent behavior
   * and optimal performance (single DB write, batch embedding generation).
   */
  async ingestFiles(options: UnifiedIngestionOptions): Promise<UnifiedIngestionResult> {
    await this.initialize();

    const {
      files,
      metadata,
      documentId,
      enableVision = false,
      visionAnalyzer,
      render3D,
      sectionTitles = 'detect',
      generateTitles = true,
      generateEmbeddings = true,
      extractEntities = false,
      enrichmentService,
      entityResolutionService,
    } = options;

    const projectId = `doc-${documentId}`;
    const virtualRoot = `/virtual/${documentId}/upload`;

    // Stats tracking
    const stats = {
      textFiles: 0,
      binaryDocs: 0,
      mediaFiles: 0,
      skipped: 0,
      textNodes: 0,
      binaryNodes: 0,
      mediaNodes: 0,
    };
    const allWarnings: string[] = [];

    // Collected nodes and relationships from all parsers
    const allNodes: Array<{ labels: string[]; id: string; properties: Record<string, any> }> = [];
    const allRelationships: Array<{ type: string; from: string; to: string; properties?: Record<string, any> }> = [];

    // Virtual files for text content (will be parsed together)
    const virtualTextFiles: Array<{ path: string; content: string }> = [];

    logger.info(`[UnifiedIngestion] Processing ${files.length} files for document: ${documentId}`);

    // Process each file
    for (const { fileName, buffer } of files) {
      const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '');

      // 1. Binary documents (PDF, DOCX, etc.)
      if (this.isBinaryDocument(ext)) {
        try {
          logger.info(`[UnifiedIngestion] Parsing binary document: ${fileName}`);

          // Create title generator if needed
          let titleGenerator: ((sections: Array<{ index: number; content: string }>) => Promise<Array<{ index: number; title: string }>>) | undefined;
          if (generateTitles) {
            titleGenerator = this.createDefaultTitleGenerator();
          }

          const parseResult = await documentParser.parse({
            filePath: fileName,
            binaryContent: buffer,
            projectId,
            options: {
              enableVision,
              sectionTitles,
              generateTitles,
              titleGenerator,
            },
          });

          // Collect nodes and relationships
          for (const node of parseResult.nodes) {
            allNodes.push({
              labels: node.labels,
              id: node.id,
              properties: node.properties,
            });
          }
          for (const rel of parseResult.relationships) {
            allRelationships.push({
              type: rel.type,
              from: rel.from,
              to: rel.to,
              properties: rel.properties || {},
            });
          }

          stats.binaryDocs++;
          stats.binaryNodes += parseResult.nodes.length;
          if (parseResult.warnings) {
            allWarnings.push(...parseResult.warnings);
          }
          logger.info(`[UnifiedIngestion] Binary parsed: ${fileName} -> ${parseResult.nodes.length} nodes`);
        } catch (err: any) {
          logger.warn(`[UnifiedIngestion] Binary failed ${fileName}: ${err.message}`);
          stats.skipped++;
        }
        continue;
      }

      // 2. Media files (images, 3D models)
      if (this.isMediaFile(ext)) {
        try {
          logger.info(`[UnifiedIngestion] Parsing media file: ${fileName}`);

          // Write to temp file for media parser
          const fs = await import('fs');
          const path = await import('path');
          const os = await import('os');
          const tempPath = path.join(os.tmpdir(), `ragforge-media-${Date.now()}-${path.basename(fileName)}`);
          fs.writeFileSync(tempPath, buffer);

          try {
            // Build parse options for core media parser
            const mediaParseOptions: MediaParseOptions = {
              enableVision,
              visionAnalyzer,
              render3D,
            };

            const parseResult = await mediaParser.parse({
              filePath: tempPath,
              projectId,
              options: mediaParseOptions as unknown as Record<string, unknown>,
            });

            // Update file paths to use original path instead of temp
            for (const node of parseResult.nodes) {
              if (node.properties.file === tempPath) {
                node.properties.file = fileName;
              }
              if (node.properties.sourcePath === tempPath) {
                node.properties.sourcePath = fileName;
              }
              allNodes.push({
                labels: node.labels,
                id: node.id,
                properties: node.properties,
              });
            }
            for (const rel of parseResult.relationships) {
              allRelationships.push({
                type: rel.type,
                from: rel.from,
                to: rel.to,
                properties: rel.properties || {},
              });
            }

            stats.mediaFiles++;
            stats.mediaNodes += parseResult.nodes.length;
            if (parseResult.warnings) {
              allWarnings.push(...parseResult.warnings);
            }

            // Check if vision description was generated
            const hasDescription = parseResult.nodes.some(n => n.properties.description);
            logger.info(`[UnifiedIngestion] Media parsed: ${fileName} -> ${parseResult.nodes.length} nodes${hasDescription ? ' (with vision description)' : ''}`);
          } finally {
            // Clean up temp file
            try { fs.unlinkSync(tempPath); } catch {}
          }
        } catch (err: any) {
          logger.warn(`[UnifiedIngestion] Media failed ${fileName}: ${err.message}`);
          stats.skipped++;
        }
        continue;
      }

      // 3. Text files - collect for batch parsing
      if (this.isTextFile(ext) || ext === '') {
        try {
          const content = buffer.toString('utf-8');
          virtualTextFiles.push({
            path: `${virtualRoot}/${fileName}`,
            content,
          });
          stats.textFiles++;
        } catch (err: any) {
          logger.warn(`[UnifiedIngestion] Failed to read ${fileName}: ${err.message}`);
          stats.skipped++;
        }
        continue;
      }

      // Unknown file type
      logger.info(`[UnifiedIngestion] Skipping unsupported file: ${fileName}`);
      stats.skipped++;
    }

    // Parse all text files together in one batch
    if (virtualTextFiles.length > 0) {
      logger.info(`[UnifiedIngestion] Parsing ${virtualTextFiles.length} text files`);

      const parseResult = await this.sourceAdapter.parse({
        source: {
          type: 'virtual',
          virtualFiles: virtualTextFiles,
        },
        projectId,
      });

      for (const node of parseResult.graph.nodes) {
        allNodes.push({
          labels: node.labels,
          id: node.id,
          properties: node.properties,
        });
      }
      for (const rel of parseResult.graph.relationships) {
        allRelationships.push({
          type: rel.type,
          from: rel.from,
          to: rel.to,
          properties: rel.properties || {},
        });
      }
      stats.textNodes = parseResult.graph.nodes.length;
      logger.info(`[UnifiedIngestion] Text parsed: ${virtualTextFiles.length} files -> ${parseResult.graph.nodes.length} nodes`);
    }

    // Inject community metadata on ALL nodes
    logger.info(`[UnifiedIngestion] Injecting metadata on ${allNodes.length} nodes`);
    for (const node of allNodes) {
      node.properties.projectId = projectId;
      node.properties.documentId = metadata.documentId;
      node.properties.documentTitle = metadata.documentTitle;
      node.properties.userId = metadata.userId;
      if (metadata.userUsername) {
        node.properties.userUsername = metadata.userUsername;
      }
      node.properties.categoryId = metadata.categoryId;
      node.properties.categorySlug = metadata.categorySlug;
      if (metadata.categoryName) {
        node.properties.categoryName = metadata.categoryName;
      }
      if (metadata.isPublic !== undefined) {
        node.properties.isPublic = metadata.isPublic;
      }
      if (metadata.tags && metadata.tags.length > 0) {
        node.properties.tags = metadata.tags;
      }
      node.properties.sourceType = 'community-upload';
    }

    // Single batch ingest into Neo4j
    if (allNodes.length > 0) {
      logger.info(`[UnifiedIngestion] Ingesting ${allNodes.length} nodes, ${allRelationships.length} relationships`);
      await this.ingestionManager!.ingestGraph(
        { nodes: allNodes, relationships: allRelationships },
        { projectId, markDirty: true }
      );
    }

    // Process cross-file references for text files
    if (virtualTextFiles.length > 0) {
      try {
        const refResult = await this.ingestionManager!.processVirtualFileReferences(
          projectId,
          virtualTextFiles,
          { verbose: this.verbose }
        );
        if (refResult.created > 0 || refResult.pending > 0) {
          logger.info(`[UnifiedIngestion] Reference linking: ${refResult.created} created, ${refResult.pending} pending`);
        }
      } catch (err) {
        logger.warn(`[UnifiedIngestion] Reference linking failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Entity extraction for non-code content
    let entityStats: UnifiedIngestionResult['entityStats'] | undefined;
    if (extractEntities && enrichmentService && allNodes.length > 0) {
      try {
        logger.info(`[UnifiedIngestion] Extracting entities and tags...`);

        // Collect nodes with enrichable content
        // - MarkdownSection nodes (document sections)
        // - MediaFile/ImageFile/ThreeDFile nodes with descriptions
        const nodesToEnrich: NodeToEnrich[] = [];

        for (const node of allNodes) {
          const labels = node.labels;
          const props = node.properties;

          // Document sections have content
          if (labels.includes('MarkdownSection') && props.content) {
            nodesToEnrich.push({
              uuid: props.uuid || node.id,
              nodeType: 'MarkdownSection',
              name: props.title as string || 'Untitled Section',
              content: props.content as string,
              filePath: props.sourcePath as string | undefined,
            });
          }
          // Media files use their vision description as content
          else if (
            (labels.includes('MediaFile') || labels.includes('ImageFile') || labels.includes('ThreeDFile')) &&
            props.description
          ) {
            const fullPath = props.file as string | undefined;
            const fileName = fullPath ? fullPath.split('/').pop() : undefined;
            nodesToEnrich.push({
              uuid: props.uuid || node.id,
              nodeType: labels[0], // ImageFile, ThreeDFile, or MediaFile
              name: fileName || 'Media File',
              content: props.description as string,
              filePath: fullPath, // Full filename for entity extraction
            });
          }
        }

        if (nodesToEnrich.length > 0) {
          logger.info(`[UnifiedIngestion] Enriching ${nodesToEnrich.length} nodes (sections + media descriptions)`);

          // Build document context for enrichment
          const docContext: DocumentContext = {
            documentId,
            projectId,
            nodes: nodesToEnrich,
          };

          // Extract entities and tags
          const enrichResult = await enrichmentService.enrichDocument(docContext);

          logger.info(`[UnifiedIngestion] Extracted ${enrichResult.entities.length} entities, ${enrichResult.tags.length} tags`);

          // Store entities and tags in Neo4j, linked to source nodes
          let entitiesCreated = 0;
          let tagsCreated = 0;
          let entityRelsCreated = 0;

          if (enrichResult.nodeEnrichments) {
            for (const nodeEnrich of enrichResult.nodeEnrichments) {
              // Create Entity nodes linked to source
              if (nodeEnrich.entities && nodeEnrich.entities.length > 0) {
                for (const entity of nodeEnrich.entities) {
                  await this.neo4j.run(`
                    CREATE (e:Entity {
                      uuid: randomUUID(),
                      name: $name,
                      normalizedName: toLower($name),
                      entityType: $type,
                      confidence: $confidence,
                      aliases: $aliases,
                      projectId: $projectId,
                      documentId: $documentId,
                      sourceNodeId: $sourceNodeId,
                      createdAt: datetime()
                    })
                    WITH e
                    MATCH (source {uuid: $sourceNodeId})
                    CREATE (source)-[:CONTAINS_ENTITY {confidence: $confidence}]->(e)
                  `, {
                    name: entity.name,
                    type: entity.type,
                    confidence: entity.confidence,
                    aliases: entity.aliases || [],
                    projectId,
                    documentId,
                    sourceNodeId: nodeEnrich.nodeId,
                  });
                  entitiesCreated++;
                  entityRelsCreated++;
                }
              }

              // Create Tag nodes linked to source
              if (nodeEnrich.tags && nodeEnrich.tags.length > 0) {
                for (const tag of nodeEnrich.tags) {
                  // Compute normalizedName in JS to match the constraint key
                  const normalizedName = tag.name.toLowerCase().replace(/\s+/g, '-');
                  await this.neo4j.run(`
                    MERGE (t:Tag {normalizedName: $normalizedName})
                    ON CREATE SET t.uuid = randomUUID(), t.name = $name, t.category = $category,
                                  t.createdAt = datetime()
                    ON MATCH SET t.name = CASE WHEN t.name IS NULL THEN $name ELSE t.name END
                    SET t.projectIds = CASE
                      WHEN $projectId IN coalesce(t.projectIds, []) THEN t.projectIds
                      ELSE coalesce(t.projectIds, []) + $projectId
                    END,
                    t.usageCount = coalesce(t.usageCount, 0) + 1
                    WITH t
                    MATCH (source {uuid: $sourceNodeId})
                    MERGE (source)-[:HAS_TAG]->(t)
                  `, {
                    name: tag.name,
                    normalizedName,
                    category: tag.category || 'other',
                    projectId,
                    sourceNodeId: nodeEnrich.nodeId,
                  });
                  tagsCreated++;
                }
              }
            }
          }

          logger.info(`[UnifiedIngestion] Created ${entitiesCreated} Entity nodes, ${tagsCreated} Tag nodes`);

          // Resolve/deduplicate entities and tags
          let canonicalCreated = 0;
          if (entitiesCreated > 0 || tagsCreated > 0) {
            const resolver = entityResolutionService || new EntityResolutionService(
              this.neo4j,
              process.env.ANTHROPIC_API_KEY || ''
            );

            // Resolve entities (merge duplicates into CanonicalEntity nodes)
            if (entitiesCreated > 0) {
              const entityResolution = await resolver.resolveEntities();
              canonicalCreated = entityResolution.created.length + entityResolution.merged.length;
              logger.info(`[UnifiedIngestion] Entity resolution: ${entityResolution.created.length} created, ${entityResolution.merged.length} merged`);
            }

            // Resolve tags (merge duplicates)
            if (tagsCreated > 0) {
              const tagResolution = await resolver.resolveTags();
              logger.info(`[UnifiedIngestion] Tag resolution: ${tagResolution.normalized} normalized, ${tagResolution.merged} merged`);
            }
          }

          entityStats = {
            entitiesExtracted: enrichResult.entities.length,
            tagsExtracted: enrichResult.tags.length,
            canonicalEntitiesCreated: canonicalCreated,
            entityRelationshipsCreated: entityRelsCreated,
          };
        } else {
          logger.info(`[UnifiedIngestion] No enrichable content found (no sections or media descriptions)`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`[UnifiedIngestion] Entity extraction failed: ${errMsg}`);
        allWarnings.push(`Entity extraction failed: ${errMsg}`);
      }
    }

    // Generate embeddings in batch
    let embeddingsGenerated = 0;
    if (generateEmbeddings && allNodes.length > 0) {
      embeddingsGenerated = await this.generateEmbeddingsForDocument(documentId);
    }

    const entityLogPart = entityStats ? `, ${entityStats.entitiesExtracted} entities, ${entityStats.tagsExtracted} tags` : '';
    logger.info(`[UnifiedIngestion] Complete: ${allNodes.length} nodes, ${allRelationships.length} rels, ${embeddingsGenerated} embeddings${entityLogPart}`);

    return {
      nodesCreated: allNodes.length,
      relationshipsCreated: allRelationships.length,
      embeddingsGenerated,
      stats,
      entityStats,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }

  /**
   * Ingest a binary document (PDF, DOCX, etc.) using the new DocumentParser.
   *
   * This method uses the refactored DocumentParser from core which creates:
   * - File node with the original path (e.g., "paper.pdf")
   * - MarkdownDocument node with sourceFormat and parsedWith metadata
   * - MarkdownSection nodes for each detected section
   *
   * @example
   * await adapter.ingestBinaryDocument({
   *   filePath: "paper.pdf",
   *   binaryContent: pdfBuffer,
   *   metadata: { documentId: "123", ... },
   *   enableVision: true,
   *   visionAnalyzer: async (buf, prompt) => { ... },
   * });
   */
  async ingestBinaryDocument(options: {
    /** Original file path (e.g., "paper.pdf") */
    filePath: string;
    /** Binary content of the file */
    binaryContent: Buffer;
    /** Community metadata to inject on all nodes */
    metadata: CommunityNodeMetadata;
    /** Project ID (derived from documentId if not provided) */
    projectId?: string;
    /** Enable Vision-based parsing for better quality (default: false) */
    enableVision?: boolean;
    /** Vision analyzer function (required if enableVision is true) */
    visionAnalyzer?: (imageBuffer: Buffer, prompt?: string) => Promise<string>;
    /** Section title detection mode (default: 'detect') */
    sectionTitles?: 'none' | 'detect' | 'llm';
    /** Maximum pages to process */
    maxPages?: number;
    /** Generate titles for sections without one using LLM (default: true for community-docs) */
    generateTitles?: boolean;
    /** Custom title generator function (uses default LLM-based one if not provided) */
    titleGenerator?: (sections: Array<{ index: number; content: string }>) => Promise<Array<{ index: number; title: string }>>;
  }): Promise<{ nodesCreated: number; relationshipsCreated: number; warnings?: string[] }> {
    await this.initialize();

    const {
      filePath,
      binaryContent,
      metadata,
      projectId = `doc-${metadata.documentId}`,
      enableVision = false,
      visionAnalyzer,
      sectionTitles = 'detect',
      maxPages,
      generateTitles = true, // Default to true for community-docs
      titleGenerator,
    } = options;

    logger.info(`Ingesting binary document: ${filePath} (${binaryContent.length} bytes), generateTitles: ${generateTitles}`);

    try {
      // Create default title generator using LLM if enabled and not provided
      let effectiveTitleGenerator = titleGenerator;
      if (generateTitles && !titleGenerator) {
        logger.info(`Creating default title generator for ${filePath}`);
        effectiveTitleGenerator = this.createDefaultTitleGenerator();
      }

      // Parse document using the new DocumentParser
      const parseOptions: DocumentParseOptions = {
        enableVision,
        visionAnalyzer,
        sectionTitles,
        maxPages,
        generateTitles,
        titleGenerator: effectiveTitleGenerator,
      };

      const parseResult = await documentParser.parse({
        filePath,
        binaryContent,
        projectId,
        options: parseOptions as Record<string, unknown>,
      });

      logger.info(`Parsed ${filePath}: ${parseResult.nodes.length} nodes, ${parseResult.relationships.length} relationships`);

      // Inject community metadata on all nodes
      for (const node of parseResult.nodes) {
        node.properties.projectId = projectId;
        node.properties.documentId = metadata.documentId;
        node.properties.documentTitle = metadata.documentTitle;
        node.properties.userId = metadata.userId;
        if (metadata.userUsername) {
          node.properties.userUsername = metadata.userUsername;
        }
        node.properties.categoryId = metadata.categoryId;
        node.properties.categorySlug = metadata.categorySlug;
        if (metadata.categoryName) {
          node.properties.categoryName = metadata.categoryName;
        }
        if (metadata.isPublic !== undefined) {
          node.properties.isPublic = metadata.isPublic;
        }
        if (metadata.tags && metadata.tags.length > 0) {
          node.properties.tags = metadata.tags;
        }
        node.properties.sourceType = "community-upload";
      }

      // Convert ParserNode to ingestion format
      const graphNodes = parseResult.nodes.map((n) => ({
        labels: n.labels,
        id: n.id,
        properties: n.properties,
      }));

      const graphRelationships = parseResult.relationships.map((r) => ({
        type: r.type,
        from: r.from,
        to: r.to,
        properties: r.properties || {},
      }));

      // Ingest graph into Neo4j
      await this.ingestionManager!.ingestGraph(
        { nodes: graphNodes, relationships: graphRelationships },
        { projectId, markDirty: true }
      );

      logger.info(`Binary document ingested: ${graphNodes.length} nodes, ${graphRelationships.length} relationships`);

      return {
        nodesCreated: graphNodes.length,
        relationshipsCreated: graphRelationships.length,
        warnings: parseResult.warnings,
      };
    } catch (err) {
      logger.error(`Failed to ingest binary document ${filePath}: ${err}`);
      throw err;
    }
  }

  /**
   * Create a default title generator using EnrichmentService.
   * Delegates to EnrichmentService.generateSectionTitles for centralized LLM calls.
   */
  private createDefaultTitleGenerator(): (sections: Array<{ index: number; content: string }>) => Promise<Array<{ index: number; title: string }>> {
    return async (sections) => {
      if (sections.length === 0) return [];

      // Check for API key
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        logger.warn(`[TitleGenerator] ANTHROPIC_API_KEY not set, skipping title generation`);
        return [];
      }

      try {
        // Use EnrichmentService for centralized LLM calls
        const enrichmentService = createEnrichmentService();
        return await enrichmentService.generateSectionTitles(sections);
      } catch (error) {
        logger.warn(`[TitleGenerator] Failed to generate titles: ${error}`);
        return [];
      }
    };
  }

  /**
   * Ingest a media file (image, 3D model) using the MediaParser.
   *
   * This method uses the MediaParser from core which creates:
   * - ImageFile or ThreeDFile node with optional Vision analysis
   * - File node for the source file
   *
   * @example
   * await adapter.ingestMedia({
   *   filePath: "image.png",
   *   binaryContent: imageBuffer,
   *   metadata: { documentId: "123", ... },
   *   enableVision: true,
   *   visionAnalyzer: async (buf, prompt) => { ... },
   * });
   */
  async ingestMedia(options: {
    /** Original file path (e.g., "image.png", "model.glb") */
    filePath: string;
    /** Binary content of the file */
    binaryContent: Buffer;
    /** Community metadata to inject on all nodes */
    metadata: CommunityNodeMetadata;
    /** Project ID (derived from documentId if not provided) */
    projectId?: string;
    /** Enable Vision-based analysis (default: false) */
    enableVision?: boolean;
    /** Vision analyzer function (required if enableVision is true) */
    visionAnalyzer?: (imageBuffer: Buffer, prompt?: string) => Promise<string>;
    /** 3D render function (required for 3D models if enableVision is true) */
    render3D?: (modelPath: string) => Promise<{ view: string; buffer: Buffer }[]>;
  }): Promise<{ nodesCreated: number; relationshipsCreated: number; warnings?: string[] }> {
    await this.initialize();

    const {
      filePath,
      binaryContent,
      metadata,
      projectId = `doc-${metadata.documentId}`,
      enableVision = false,
      visionAnalyzer,
      render3D,
    } = options;

    logger.info(`Ingesting media file: ${filePath} (${binaryContent.length} bytes)`);

    try {
      // For media files, we need to write to a temp file for the parser
      // (the parser reads the file directly for dimensions/GLTF metadata)
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      const tempDir = os.tmpdir();
      const tempPath = path.join(tempDir, `ragforge-media-${Date.now()}-${path.basename(filePath)}`);

      // Write buffer to temp file
      fs.writeFileSync(tempPath, binaryContent);

      try {
        // Parse media using the MediaParser
        const parseOptions: MediaParseOptions = {
          enableVision,
          visionAnalyzer,
          render3D,
        };

        const parseResult = await mediaParser.parse({
          filePath: tempPath, // Use temp path for parsing
          projectId,
          options: parseOptions as Record<string, unknown>,
        });

        logger.info(`Parsed ${filePath}: ${parseResult.nodes.length} nodes, ${parseResult.relationships.length} relationships`);

        // Update file paths in nodes to use original path instead of temp path
        for (const node of parseResult.nodes) {
          if (node.properties.file === tempPath) {
            node.properties.file = filePath;
          }
          if (node.properties.sourcePath === tempPath) {
            node.properties.sourcePath = filePath;
          }
          if (node.properties.absolutePath === tempPath) {
            node.properties.absolutePath = filePath;
          }
          if (node.properties.path === tempPath) {
            node.properties.path = filePath;
          }

          // Inject community metadata
          node.properties.projectId = projectId;
          node.properties.documentId = metadata.documentId;
          node.properties.documentTitle = metadata.documentTitle;
          node.properties.userId = metadata.userId;
          if (metadata.userUsername) {
            node.properties.userUsername = metadata.userUsername;
          }
          node.properties.categoryId = metadata.categoryId;
          node.properties.categorySlug = metadata.categorySlug;
          if (metadata.categoryName) {
            node.properties.categoryName = metadata.categoryName;
          }
          if (metadata.isPublic !== undefined) {
            node.properties.isPublic = metadata.isPublic;
          }
          if (metadata.tags && metadata.tags.length > 0) {
            node.properties.tags = metadata.tags;
          }
          node.properties.sourceType = "community-upload";
        }

        // Convert ParserNode to ingestion format
        const graphNodes = parseResult.nodes.map((n) => ({
          labels: n.labels,
          id: n.id,
          properties: n.properties,
        }));

        const graphRelationships = parseResult.relationships.map((r) => ({
          type: r.type,
          from: r.from,
          to: r.to,
          properties: r.properties || {},
        }));

        // Ingest graph into Neo4j
        await this.ingestionManager!.ingestGraph(
          { nodes: graphNodes, relationships: graphRelationships },
          { projectId, markDirty: true }
        );

        logger.info(`Media file ingested: ${graphNodes.length} nodes, ${graphRelationships.length} relationships`);

        return {
          nodesCreated: graphNodes.length,
          relationshipsCreated: graphRelationships.length,
          warnings: parseResult.warnings,
        };
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (err) {
      logger.error(`Failed to ingest media file ${filePath}: ${err}`);
      throw err;
    }
  }

  /**
   * Generate embeddings for all nodes of a document
   * Uses ragforge core EmbeddingService with batching and multi-embedding support
   *
   * @param documentId - The document ID to generate embeddings for
   * @param onProgress - Optional callback for progress updates (current, total)
   * @returns Number of embeddings generated
   */
  async generateEmbeddingsForDocument(
    documentId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<number> {
    if (!this.embeddingService) {
      logger.warn("No embedding service configured, skipping embeddings");
      return 0;
    }

    const projectId = `doc-${documentId}`;
    logger.info(`Generating embeddings for document: ${documentId} (projectId: ${projectId})`);

    try {
      // Count nodes that need embeddings (for progress reporting)
      // Note: This is an estimate - actual count may differ due to incremental processing
      if (onProgress) {
        const countResult = await this.neo4j.run(
          `MATCH (n {projectId: $projectId})
           WHERE n.embeddingsDirty = true OR n.nameEmbedding IS NULL
           RETURN count(n) as total`,
          { projectId }
        );
        const estimatedTotal = countResult.records[0]?.get("total")?.toNumber() ?? 0;
        onProgress(0, estimatedTotal);
      }

      // Use ragforge core's multi-embedding generation with batching
      const result = await this.embeddingService.generateMultiEmbeddings({
        projectId,
        incrementalOnly: true,
        verbose: this.verbose,
        batchSize: 50,
      });

      // Report completion
      if (onProgress) {
        onProgress(result.totalEmbedded, result.totalEmbedded);
      }

      logger.info(
        `Generated embeddings for document ${documentId}: ` +
          `${result.totalEmbedded} total (name: ${result.embeddedByType.name}, ` +
          `content: ${result.embeddedByType.content}, description: ${result.embeddedByType.description}), ` +
          `${result.skippedCount} cached, ${result.durationMs}ms`
      );

      return result.totalEmbedded;
    } catch (err) {
      logger.error(`Failed to generate embeddings for document ${documentId}: ${err}`);
      return 0;
    }
  }

  /**
   * Check if embedding service is available
   */
  hasEmbeddingService(): boolean {
    return this.embeddingService !== null && this.embeddingService.canGenerateEmbeddings();
  }

  /**
   * Check if search service can do semantic search
   */
  canDoSemanticSearch(): boolean {
    return this.searchService?.canDoSemanticSearch() ?? false;
  }

  /**
   * Search across community documents
   *
   * Uses SearchService from ragforge core with community-specific filters.
   * Supports post-processing: reranking, keyword boosting, relationship exploration, summarization.
   *
   * @example
   * const results = await adapter.search({
   *   query: "authentication",
   *   categorySlug: "tutorials",
   *   semantic: true,
   *   limit: 20,
   *   boostKeywords: ["login", "auth"],
   *   exploreDepth: 1,
   * });
   */
  async search(options: CommunitySearchOptions): Promise<CommunitySearchResultSet> {
    await this.initialize();

    if (!this.searchService) {
      throw new Error("SearchService not initialized");
    }

    // Build community-specific filters
    const filters: SearchFilter[] = [];

    if (options.categorySlug) {
      filters.push({ property: "categorySlug", operator: "eq", value: options.categorySlug });
    }
    if (options.userId) {
      filters.push({ property: "userId", operator: "eq", value: options.userId });
    }
    if (options.documentId) {
      filters.push({ property: "documentId", operator: "eq", value: options.documentId });
    }
    if (options.isPublic !== undefined) {
      filters.push({ property: "isPublic", operator: "eq", value: options.isPublic });
    }
    // Note: tags filter would need special handling for array containment
    // For now, we skip it - could be added later with a custom Cypher clause

    const semantic = options.semantic ?? true;
    const hybrid = options.hybrid ?? semantic;
    const originalLimit = options.limit ?? 20;

    // Fetch more candidates if post-processing needs them
    const needsMoreCandidates = options.rerank || (options.boostKeywords && options.boostKeywords.length > 0);
    const searchLimit = needsMoreCandidates ? Math.max(originalLimit, 100) : originalLimit;

    logger.info(
      `[CommunityOrchestrator] Search: "${options.query.substring(0, 50)}..." ` +
        `(semantic: ${semantic}, hybrid: ${hybrid}, filters: ${filters.length})`
    );

    const result = await this.searchService.search({
      query: options.query,
      semantic,
      hybrid,
      embeddingType: options.embeddingType ?? "all",
      limit: searchLimit,
      minScore: options.minScore ?? 0.3,
      filters,
    });

    // Map to community format with snippets
    let communityResults: CommunitySearchResult[] = result.results.map((r) => {
      const content = (r.node.content || r.node.source || r.node.description || r.node.text || "") as string;

      // Generate snippet: prefer chunkText, fallback to truncated content
      let snippet: string | undefined;
      if (r.matchedRange?.chunkText) {
        // Use the actual chunk text that matched
        snippet = r.matchedRange.chunkText;
        if (snippet.length > 800) {
          snippet = snippet.substring(0, 800) + "...";
        }
      } else if (content.length > 500) {
        // Truncate long content
        snippet = content.substring(0, 500) + "...";
      } else {
        snippet = content;
      }

      return {
        node: r.node,
        score: r.score,
        filePath: r.filePath,
        matchedRange: r.matchedRange ? {
          startLine: r.matchedRange.startLine,
          endLine: r.matchedRange.endLine,
          startChar: r.matchedRange.startChar,
          endChar: r.matchedRange.endChar,
          chunkIndex: r.matchedRange.chunkIndex,
          chunkScore: r.matchedRange.chunkScore,
          pageNum: r.matchedRange.pageNum,
        } : undefined,
        snippet,
      };
    });

    // === Post-processing ===
    let reranked = false;
    let keywordBoosted = false;
    let entityBoosted = false;
    let matchingEntities: Array<{ uuid: string; name: string; type: 'Tag' | 'CanonicalEntity'; score: number }> | undefined;
    let relationshipsExplored = false;
    let summarized = false;
    let graph: ExplorationGraph | undefined;
    let summary: SummaryResult | undefined;

    // 1. Reranking (if enabled)
    if (options.rerank && communityResults.length > 0) {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey) {
        try {
          logger.info(`[CommunityOrchestrator] Applying LLM reranking to ${communityResults.length} results`);
          const rerankResult = await rerankSearchResults(communityResults, {
            query: options.query,
            apiKey: geminiKey,
          });
          if (rerankResult.evaluationCount > 0) {
            communityResults = rerankResult.results;
            reranked = true;
            logger.info(`[CommunityOrchestrator] Reranking complete: ${rerankResult.evaluationCount} evaluations`);
          }
        } catch (err: any) {
          logger.warn(`[CommunityOrchestrator] Reranking failed: ${err.message}`);
        }
      } else {
        logger.warn("[CommunityOrchestrator] Reranking requested but GEMINI_API_KEY not set");
      }
    }

    // 2. Keyword boosting (if enabled)
    if (options.boostKeywords && options.boostKeywords.length > 0 && communityResults.length > 0) {
      logger.info(`[CommunityOrchestrator] Applying keyword boost: ${options.boostKeywords.join(", ")}`);
      const boostedResults = await applyKeywordBoost(communityResults, {
        keywords: options.boostKeywords,
        boostWeight: options.boostWeight,
      });
      communityResults = boostedResults.map((b) => ({
        ...b.result,
        keywordBoost: b.keywordBoost,
      }));
      keywordBoosted = true;
      logger.info(`[CommunityOrchestrator] Keyword boost complete`);
    }

    // 3. Entity/Tag boosting (enabled by default)
    const entityBoostEnabled = options.entityBoost !== false; // default: true
    if (entityBoostEnabled && this.entityEmbeddingService && communityResults.length > 0) {
      const threshold = options.entityMatchThreshold ?? 0.7;
      const boostWeight = options.entityBoostWeight ?? 0.05;

      try {
        // 3a. Search for matching entities/tags
        const entityResults = await this.entityEmbeddingService.search({
          query: options.query,
          semantic: true,
          hybrid: true,
          limit: 10,
          minScore: threshold, // Only get strong matches
        });

        if (entityResults.length > 0) {
          // Store matching entities for response
          matchingEntities = entityResults.map(e => ({
            uuid: e.uuid,
            name: e.name,
            type: e.nodeType as 'Tag' | 'CanonicalEntity',
            score: e.score,  // For matchingEntities in response
          }));

          // Also create version with matchScore for result.matchedEntities
          const matchedEntitiesForResults = entityResults.map(e => ({
            uuid: e.uuid,
            name: e.name,
            type: e.nodeType as 'Tag' | 'CanonicalEntity',
            matchScore: e.score,
          }));

          logger.info(`[CommunityOrchestrator] Found ${entityResults.length} matching entities/tags (threshold: ${threshold})`);

          // 3b. Get UUIDs of nodes linked to these entities/tags
          const entityUuids = entityResults.filter(e => e.nodeType === 'CanonicalEntity').map(e => e.uuid);
          const tagUuids = entityResults.filter(e => e.nodeType === 'Tag').map(e => e.uuid);

          // Query Neo4j to find which result nodes have these entities/tags
          const linkedNodesQuery = `
            // Find sections with matching tags
            OPTIONAL MATCH (section)-[:HAS_TAG]->(tag:Tag)
            WHERE tag.uuid IN $tagUuids
            WITH collect(DISTINCT section.uuid) as tagLinkedSections, $tagUuids as tagUuids

            // Find sections with matching entities (via canonical)
            OPTIONAL MATCH (section)-[:CONTAINS_ENTITY]->(entity:Entity)-[:CANONICAL_IS]->(canonical:CanonicalEntity)
            WHERE canonical.uuid IN $entityUuids
            WITH tagLinkedSections, collect(DISTINCT section.uuid) as entityLinkedSections

            // Return all linked section UUIDs
            RETURN tagLinkedSections + entityLinkedSections as linkedUuids
          `;

          const linkedResult = await this.neo4j.run(linkedNodesQuery, { tagUuids, entityUuids });
          const linkedUuids = new Set<string>(
            linkedResult.records[0]?.get('linkedUuids')?.filter((u: any) => u != null) || []
          );

          if (linkedUuids.size > 0) {
            // 3c. Apply boost to results that have matching entities/tags
            let boostedCount = 0;
            for (const result of communityResults) {
              const nodeUuid = result.node.uuid;
              if (linkedUuids.has(nodeUuid)) {
                // Find best matching entity/tag for this result
                const bestMatch = entityResults.reduce((best, e) => e.score > best.score ? e : best, entityResults[0]);
                const boost = bestMatch.score * boostWeight;
                result.score += boost;
                result.entityBoostApplied = boost;

                // Include matched entities if requested
                if (options.includeMatchedEntities) {
                  result.matchedEntities = matchedEntitiesForResults;
                }
                boostedCount++;
              }
            }

            if (boostedCount > 0) {
              // Re-sort by score
              communityResults.sort((a, b) => b.score - a.score);
              entityBoosted = true;
              logger.info(`[CommunityOrchestrator] Entity boost applied to ${boostedCount} results`);
            }
          }
        }
      } catch (err: any) {
        logger.warn(`[CommunityOrchestrator] Entity boost failed: ${err.message}`);
      }
    }

    // 4. Apply final limit
    if (communityResults.length > originalLimit) {
      communityResults = communityResults.slice(0, originalLimit);
    }

    // 5. Relationship exploration (if enabled)
    if (options.exploreDepth && options.exploreDepth > 0 && communityResults.length > 0 && this.coreClient) {
      logger.info(`[CommunityOrchestrator] Exploring relationships (depth: ${options.exploreDepth})`);
      graph = await exploreRelationships(communityResults, {
        neo4jClient: this.coreClient,
        depth: options.exploreDepth,
      });
      if (graph && graph.nodes.length > 0) {
        relationshipsExplored = true;
        logger.info(`[CommunityOrchestrator] Found ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      }
    }

    // 6. Summarization (if enabled)
    if (options.summarize && communityResults.length > 0) {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey) {
        try {
          logger.info(`[CommunityOrchestrator] Summarizing ${communityResults.length} results`);
          summary = await summarizeSearchResults(communityResults, {
            query: options.query,
            context: options.summarizeContext,
            apiKey: geminiKey,
          });
          summarized = true;
          logger.info(`[CommunityOrchestrator] Summary: ${summary.snippets.length} snippets, ${summary.findings.length} chars`);
        } catch (err: any) {
          logger.warn(`[CommunityOrchestrator] Summarization failed: ${err.message}`);
        }
      } else {
        logger.warn("[CommunityOrchestrator] Summarization requested but GEMINI_API_KEY not set");
      }
    }

    logger.info(`[CommunityOrchestrator] Search returned ${communityResults.length} results`);

    // 7. Format output (if requested)
    let formattedOutput: string | undefined;
    if (options.format === "markdown" || options.format === "compact") {
      // Convert to BrainSearchOutput format for the formatter
      const brainSearchOutput: BrainSearchOutput = {
        results: communityResults.map((r) => ({
          node: r.node,
          score: r.score,
          projectId: `doc-${r.node.documentId || "unknown"}`,
          projectPath: r.node.absolutePath || r.filePath || "",
          filePath: r.node.absolutePath || r.filePath || r.node.file || "",
        })),
        totalCount: result.totalCount,
        searchedProjects: [], // community-docs doesn't use projects the same way
        graph,
        summary,
      };

      if (options.format === "markdown") {
        const formatOptions: FormatOptions = {
          includeSource: options.includeSource ?? true,
          maxSourceResults: options.maxSourceResults ?? 5,
          includeGraph: !!graph,
        };
        formattedOutput = formatAsMarkdown(brainSearchOutput, options.query, formatOptions);
        logger.info(`[CommunityOrchestrator] Formatted as markdown (${formattedOutput.length} chars)`);
      }
      // Note: compact format would need formatAsCompact, but we focus on markdown for now
    }

    return {
      results: communityResults,
      totalCount: result.totalCount,
      reranked: reranked || undefined,
      keywordBoosted: keywordBoosted || undefined,
      entityBoosted: entityBoosted || undefined,
      matchingEntities: matchingEntities,
      relationshipsExplored: relationshipsExplored || undefined,
      summarized: summarized || undefined,
      graph,
      summary,
      formattedOutput,
    };
  }

  /**
   * Delete all nodes for a document
   */
  async deleteDocument(documentId: string): Promise<number> {
    await this.initialize();
    const projectId = `doc-${documentId}`;

    // Delete using the ingestion manager
    const result = await this.neo4j.run(
      `MATCH (n {documentId: $documentId}) DETACH DELETE n RETURN count(n) as count`,
      { documentId }
    );

    const count = result.records[0]?.get("count")?.toNumber() ?? 0;
    logger.info(`Deleted ${count} nodes for document: ${documentId}`);

    return count;
  }

  /**
   * Stop the orchestrator
   */
  async stop(): Promise<void> {
    if (this.orchestrator) {
      await this.orchestrator.stop();
      this.orchestrator = null;
    }
  }
}

/**
 * Singleton instance
 */
let orchestratorAdapter: CommunityOrchestratorAdapter | null = null;

export function getCommunityOrchestrator(
  options: CommunityOrchestratorOptions
): CommunityOrchestratorAdapter {
  if (!orchestratorAdapter) {
    orchestratorAdapter = new CommunityOrchestratorAdapter(options);
  }
  return orchestratorAdapter;
}

export function resetCommunityOrchestrator(): void {
  if (orchestratorAdapter) {
    orchestratorAdapter.stop();
    orchestratorAdapter = null;
  }
}
