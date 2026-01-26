# Brain Search: "search service"

**Results:** 10 / 10
**Projects:** LR_CodeRag-community-docs-rzd1

**Parameters:**
semantic=true | limit=10 | explore_depth=1

---

## Results

### 1. canDoSemanticSearch(): boolean (Scope) ★ 1.07
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/lib/ragforge/orchestrator-adapter.ts:1620-1622`
📝 Check if search service can do semantic search

```typescript
canDoSemanticSearch(): boolean {
    return this.searchService?.canDoSemanticSearch() ?? false;
  }
```

### 2. interface ServiceSearchResult() (Scope) ★ 1.02
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-service.ts:99-128`
📝 A single search result
Named with "Service" prefix to avoid conflict with runtime/query SearchResult

```typescript
interface ServiceSearchResult {
  /** Node properties (embeddings stripped) */
  node: Record<string, any>;
  /** Similarity/relevance score */
  score: number;
  /** Absolute file path (if available) */
  filePath?: string;
  /** Matched range for chunked content */
  matchedRange?: {
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    chunkIndex: number;
    chunkScore: number;
    /** The actual chunk text that matched */
    chunkText?: string;
    /** Page number from parent document (for PDFs/Word docs) */
    pageNum?: number | null;
  };
... (10 more lines)
```

### 3. interface SearchServiceConfig() (Scope) ★ 1.02
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-service.ts:24-31`
📝 Configuration for SearchService

```typescript
interface SearchServiceConfig {
  /** Neo4j client instance */
  neo4jClient: Neo4jClient;
  /** Embedding service for semantic search (optional - if not provided, only text search works) */
  embeddingService?: EmbeddingService;
  /** Enable verbose logging */
  verbose?: boolean;
}
```

### 4. class SearchService() (Scope) ★ 0.89
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-service.ts:216-1121`

```typescript
export class SearchService {

Members:
  - constructor(config: SearchServiceConfig) (L221-225)
    { this.neo4jClient = config.neo4jClient; this.embeddingService = config.embeddingService; this.verbose = config.verbose ?? false; }
  - canDoSemanticSearch(): boolean (L230-232)
    { return !!this.embeddingService?.canGenerateEmbeddings(); }
  - async search(options: SearchOptions): Promise<ServiceSearchResultSet> (L237-307)
    { const limit = Math.max(0, Math.floor(options.limit ?? 20)); const offset = Math.max(0, Math.floor(options.offset ?? 0)); const embedding
  - async grep(options: GrepOptions): Promise<GrepResultSet> (L329-445)
    { const { pattern, ignoreCase = false, glob, limit = 100, contextLines = 0, filters = [], } = options; 
  - private matchGlob(filePath: string, pattern: string): boolean (L450-467)
    { // Convert glob to regex let regexPattern = pattern .replace(/\./g, '\\.') .replace(/\*\*/g, '<<<GLOBSTAR>>>') .replace(/\
  - private buildFilterClause(filters: SearchFilter[]): {
    filterClause: string;
    filterParams: Record<string, any>;
  } (L476-537)
    { if (filters.length === 0) { return { filterClause: '', filterParams: {} }; } const clauses: string[] = []; const params: Reco
  - private async vectorSearch(query: string, options: {
      embeddingType: 'name' | 'content' | 'description' | 'all';
... (34 more lines)
```

### 5. interface ServiceSearchResultSet() (Scope) ★ 0.88
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-service.ts:133-138`
📝 Search result container

```typescript
interface ServiceSearchResultSet {
  /** Array of search results */
  results: ServiceSearchResult[];
  /** Total count of results */
  totalCount: number;
}
```

### 6. async search(options: SearchOptions): Promise<ServiceSearchResultSet> (Scope) ★ 0.88
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-service.ts:237-307`
📝 Main search method

### 7. interface SearchFilter() (Scope) ★ 0.87
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-service.ts:41-48`
📝 A single search filter

### 8. interface ProcessableSearchResult() (Scope) ★ 0.87
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-post-processor.ts:27-32`
📝 Generic search result that can be processed by the post-processor.
Compatible with both BrainSearchResult and ServiceSearchResult.

### 9. interface SearchResponse() (Scope) ★ 0.87
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/scripts/test-github-ingest.ts:30-42`

### 10. interface SearchResultWithMetadata() (Scope) ★ 0.87
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/types/result.ts:117-123`
📝 Search result with metadata

---

## Dependency Graph

```
canDoSemanticSearch (method) ★1.1 @ lib/ragforge/orchestrator-adapter.ts:1620-1622
├── [HAS_PARENT]
│       └── CommunityOrchestratorAdapter (class) @ lib/ragforge/orchestrator-adapter.ts:359-2056
│           └── [CONSUMED_BY]
│                   ├── ServiceSearchResult (interface) ★1.0 @ packages/ragforge-core/src/brain/search-service.ts:99-128
│                   ├── SearchServiceConfig (interface) ★1.0 @ packages/ragforge-core/src/brain/search-service.ts:24-31
│                   ├── ServiceSearchResultSet (interface) ★0.9 @ packages/ragforge-core/src/brain/search-service.ts:133-138
│                   ├── search (method) ★0.9 @ packages/ragforge-core/src/brain/search-service.ts:237-307
│                   └── SearchFilter (interface) ★0.9 @ packages/ragforge-core/src/brain/search-service.ts:41-48
├── [CONSUMES]
│       ├── createEntityExtractionTransform (function) @ packages/ragforge-core/src/ingestion/entity-extraction/transform.ts:173-291
│       ├── GrepResult (interface) @ packages/ragforge-core/src/brain/search-service.ts:181-190
│       ├── processing (method) @ packages/ragforge-core/src/brain/touched-files-watcher.ts:190-192
│       │   └── [CONSUMED_BY]
│       │           └── ProcessableSearchResult (interface) ★0.9 @ packages/ragforge-core/src/brain/search-post-processor.ts:27-32
│       ├── FileChange (interface) @ packages/ragforge-core/src/ingestion/types.ts:23-32
│       ├── mediaParser (variable) @ packages/ragforge-core/src/ingestion/parsers/media-parser.ts:405
│       ├── parse (method) @ lib/ragforge/upload-adapter.ts:82-194
│       ├── VirtualFile (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:18-42
│       ├── EmbeddingService (class) @ packages/ragforge-core/src/brain/embedding-service.ts:720-1756
│       ├── EntityExtractionConfig (interface) @ packages/ragforge-core/src/ingestion/entity-extraction/types.ts:106-130
│       ├── rerankSearchResults (function) @ packages/ragforge-core/src/brain/search-post-processor.ts:653-761
│       ├── EntityExtractionClient (class) @ packages/ragforge-core/src/ingestion/entity-extraction/client.ts:49-645
│       ├── OrchestratorDependencies (interface) @ packages/ragforge-core/src/ingestion/orchestrator.ts:37-110
│       ├── ExplorationGraph (interface) @ packages/ragforge-core/src/brain/search-post-processor.ts:107-110
│       └── SearchService (class) ★0.9 @ packages/ragforge-core/src/brain/search-service.ts:216-1121
│           ├── [CONSUMES]
│           │       ├── chunkText (function) @ packages/ragforge-core/src/runtime/embedding/text-chunker.ts:68-108
│           │       ├── fullTextSearch (method) @ packages/ragforge-core/src/brain/search-service.ts:863-934
│           │       ├── hybridSearch (method) @ packages/ragforge-core/src/brain/search-service.ts:943-1054
│           │       ├── vectorSearch (method) @ packages/ragforge-core/src/brain/search-service.ts:543-770
│           │       ├── run (method) @ lib/ragforge/neo4j-client.ts:45-56
│           │       ├── matchGlob (method) @ packages/ragforge-core/src/brain/search-service.ts:439-456
│           │       ├── debug (method) @ lib/ragforge/logger.ts:205-207
│           │       ├── grep (method) @ packages/ragforge-core/src/brain/search-service.ts:318-434
│           │       ├── filter (method) @ packages/ragforge-core/src/runtime/query/generic-query-builder.ts:106-109
│           │       ├── semantic (method) @ packages/ragforge-core/src/runtime/query/query-builder.ts:238-254
│           │       └── warn (function) @ tests/test-entity-extraction.ts:53-55
│           └── [CONSUMED_BY]
│                   ├── search (method) @ lib/ragforge/orchestrator-adapter.ts:1640-1951
│                   ├── file_scope_01 (module) @ packages/ragforge-core/src/brain/search-service.ts:1-23
│                   ├── file_scope_01 (module) @ packages/ragforge-core/src/brain/index.ts:1-169
│                   ├── search (method) @ packages/ragforge-core/src/brain/brain-manager.ts:4052-4179
│                   ├── connectNeo4j (method) @ packages/ragforge-core/src/brain/brain-manager.ts:1620-1683
│                   ├── BrainManager (class) @ packages/ragforge-core/src/brain/brain-manager.ts:463-5737
│                   ├── file_scope_01 (module) @ packages/ragforge-core/src/brain/brain-manager.ts:1-77
│                   ├── getCommunityOrchestrator (function) @ lib/ragforge/orchestrator-adapter.ts:2063-2070
│                   ├── hasEmbeddingService (method) @ lib/ragforge/orchestrator-adapter.ts:1613-1615
│                   ├── orchestratorAdapter (variable) @ lib/ragforge/orchestrator-adapter.ts:2061
│                   ├── grep (method) @ lib/ragforge/orchestrator-adapter.ts:1970-2026
│                   ├── deleteDocument (method) @ lib/ragforge/orchestrator-adapter.ts:2031-2045
│                   ├── stop (method) @ lib/ragforge/orchestrator-adapter.ts:2050-2055
│                   └── resetCommunityOrchestrator (function) @ lib/ragforge/orchestrator-adapter.ts:2072-2077
└── [CONSUMED_BY]
        ├── setupRoutes (method) @ lib/ragforge/api/server.ts:513-1611
        └── CommunityAPIServer (class) @ lib/ragforge/api/server.ts:306-1630
SearchResponse (interface) ★0.9 @ scripts/test-github-ingest.ts:30-42
└── [CONSUMES]
        └── error (function) @ tests/test-entity-extraction.ts:49-51
SearchResultWithMetadata (interface) ★0.9 @ packages/ragforge-core/src/runtime/types/result.ts:117-123
└── [CONSUMED_BY]
        ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/query/query-builder.ts:1-39
        └── QueryBuilder (class) @ packages/ragforge-core/src/runtime/query/query-builder.ts:40-2242
```

---

## Node Types Summary

| Type | Count |
|------|-------|
| Scope | 10 |
