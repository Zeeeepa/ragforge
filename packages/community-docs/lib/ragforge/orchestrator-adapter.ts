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
} from "@luciformresearch/ragforge";
import type { Neo4jClient } from "./neo4j-client";
import type { CommunityNodeMetadata } from "./types";
import { getPipelineLogger } from "./logger";

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
  /** Keyword boost info (if boost_keywords was used) */
  keywordBoost?: {
    keyword: string;
    similarity: number;
    boost: number;
  };
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

        // Extract originalFileName for binary documents converted to markdown
        // e.g., file.pdf.md -> file.pdf, report.docx.md -> report.docx
        const filePath = node.properties.file as string | undefined;
        if (filePath && binaryDocPattern.test(filePath)) {
          // Remove the .md extension to get the original filename
          const originalFileName = filePath.replace(/\.md$/, '').split('/').pop();
          if (originalFileName) {
            node.properties.originalFileName = originalFileName;
          }
        }
      }

      logger.info(`Injected community metadata on ${graph.nodes.length} nodes`);

      // Ingest graph into Neo4j
      await this.ingestionManager!.ingestGraph(
        { nodes: graph.nodes, relationships: graph.relationships },
        { projectId, markDirty: true }
      );

      logger.info(
        `Virtual ingestion complete: ${graph.nodes.length} nodes, ${graph.relationships.length} relationships`
      );

      // Process cross-file references (links in markdown, imports in code, etc.)
      // This creates REFERENCES_DOC, REFERENCES_ASSET, CONSUMES relationships
      try {
        // Filter to only files with string content (not Buffer) for reference processing
        const stringContentFiles = prefixedFiles.filter(
          (f): f is { path: string; content: string } => typeof f.content === 'string'
        );
        const refResult = await this.ingestionManager!.processVirtualFileReferences(
          projectId,
          stringContentFiles,
          { verbose: this.verbose }
        );
        if (refResult.created > 0 || refResult.pending > 0) {
          logger.info(
            `Reference linking: ${refResult.created} created, ${refResult.pending} pending`
          );
        }
      } catch (err) {
        // Don't fail ingestion if reference linking fails
        logger.warn(`Reference linking failed: ${err instanceof Error ? err.message : err}`);
      }

      return {
        nodesCreated: graph.nodes.length,
        relationshipsCreated: graph.relationships.length,
      };
    } finally {
      // Clear metadata after ingestion
      this.currentMetadata = null;
    }
  }

  /**
   * Generate embeddings for all nodes of a document
   * Uses ragforge core EmbeddingService with batching and multi-embedding support
   *
   * @returns Number of embeddings generated
   */
  async generateEmbeddingsForDocument(documentId: string): Promise<number> {
    if (!this.embeddingService) {
      logger.warn("No embedding service configured, skipping embeddings");
      return 0;
    }

    const projectId = `doc-${documentId}`;
    logger.info(`Generating embeddings for document: ${documentId} (projectId: ${projectId})`);

    try {
      // Use ragforge core's multi-embedding generation with batching
      const result = await this.embeddingService.generateMultiEmbeddings({
        projectId,
        incrementalOnly: true,
        verbose: this.verbose,
        batchSize: 50,
      });

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

    // Map to community format
    let communityResults: CommunitySearchResult[] = result.results.map((r) => ({
      node: r.node,
      score: r.score,
      filePath: r.filePath,
    }));

    // === Post-processing ===
    let reranked = false;
    let keywordBoosted = false;
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

    // 3. Apply final limit
    if (communityResults.length > originalLimit) {
      communityResults = communityResults.slice(0, originalLimit);
    }

    // 4. Relationship exploration (if enabled)
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

    // 5. Summarization (if enabled)
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

    // 6. Format output (if requested)
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
