# Brain Search: "ingestGraph IncrementalIngestionManager"

**Results:** 20 / 20
**Projects:** LR_CodeRag-community-docs-rzd1

**Parameters:**
semantic=true | limit=20 | explore_depth=2

---

## Results

### 1. class IncrementalIngestionManager() (Scope) ★ 1.25
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:91-2606`

```typescript
export class IncrementalIngestionManager {

Members:
  - constructor(client: Neo4jClient) (L98-105)
    jClient) { this.changeTracker = new ChangeTracker(client); // Register all parsers to populate nodeTypeMap if (!areParsersRegistered()) {
  - stateMachine(): FileStateMachine (L111-116)
    hine { if (!this._stateMachine) { this._stateMachine = new FileStateMachine(this.client); } return this._stateMachine; }
  - stateMigration(): FileStateMigration (L122-127)
    tion { if (!this._stateMigration) { this._stateMigration = new FileStateMigration(this.client); } return this._stateMigration; }
  - setTransformGraph(transform: (graph: { nodes: any[]; relationships: any[]; metadata: any }) => Promise<{ nodes: any[]; relationships: any[]; metadata: any }>): void (L133-135)
    { this._transformGraph = transform; }
  - getFileProcessor(projectId: string, projectRoot: string, options: {
      verbose?: boolean;
      concurrency?: number;
    }?): FileProcessor (L145-167)
    ): FileProcessor { const cacheKey = `${projectId}:${projectRoot}`; if (!this._fileProcessors.has(cacheKey)) { this._fileProcessors.set(
  - async reprocessFilesWithStateMachine(projectId: string, projectRoot: string, files: FileInfo[], options: {
      verbose?: boolean;
      concurrency?: number;
    }?): Promise<FileProcessorBatchResult> (L182-193)
... (110 more lines)
```

### 2. class BrainManager() (Scope) ★ 0.94
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/brain-manager.ts:466-5760`
📝 Singleton manager for the agent's brain

```typescript
export class BrainManager {

Members:
  - private constructor(config: BrainConfig) (L491-502)
    { this.config = config; this.projectRegistry = new ProjectRegistry({ memoryPolicy: { maxLoadedProjects: 5, idleUnloadTim
  - static async getInstance(config: Partial<BrainConfig>?): Promise<BrainManager> (L507-522)
    { // Test: comment inside scope body if (!BrainManager.instance) { const mergedConfig = { ...DEFAULT_BRAIN_CONFIG, ...co
  - static resetInstance(): void (L528-536)
    { if (BrainManager.instance) { // Close Neo4j connection if open if (BrainManager.instance.neo4jClient) { BrainManager.instanc
  - async initialize(): Promise<void> (L541-599)
    { if (this.initialized) return; console.log('[Brain] Initializing...'); // 0. Register all parsers (content extraction, embedding field 
  - private async initializeOrchestrator(): Promise<void> (L604-741)
    { if (!this.neo4jClient) { console.warn('[Brain] Cannot initialize orchestrator: Neo4j client not connected'); return; } // I
  - getOrCreateUnifiedProcessor(projectId: string, projectRoot: string?): UnifiedProcessor | null (L747-780)
    { // Check if already exists const existing = this._unifiedProcessors.get(projectId); if (existing) { return existing; } //
  - getOrCreateProcessingLoop(projectId: string, projectRoot: string?): ProcessingLoop | null (L785-815)
    { // Check if already exists const existing = this._processingLoops.get(projectId); if (existing) { return existing; } // G
  - orchestrator(): IngestionOrchestrator | null (L821-823)
    null { return this._orchestrator; }
  - stateMachine(): NodeStateMachine | null (L829-831)
... (342 more lines)
```

### 3. async ingestIncremental(graph: ParsedGraph, options: IngestionOptions): Promi... (Scope) ★ 0.91
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:797-1052`
📝 Incremental ingestion - only updates changed content nodes

Strategy:
1. Fetch existing hashes from DB (ALL content node types)
2. Filter nodes: only keep changed/new ones
3. Delete orphaned nodes ...

```typescript
async ingestIncremental(
    graph: ParsedGraph,
    options: IngestionOptions = {}
  ): Promise<IncrementalStats> {
    const { projectId, dryRun, verbose = false, trackChanges, cleanupRelationships = true } = options;
    const { nodes, relationships } = graph;

    if (verbose) {
      console.log('🔍 Analyzing changes...');
      if (projectId) {
        console.log(`   Project: ${projectId}`);
      }
    }

    // Add projectId to all nodes if specified
    if (projectId) {
      for (const node of nodes) {
        node.properties.projectId = projectId;
      }
    }
... (236 more lines)
```

### 4. getIngestionManager(): IncrementalIngestionManager (Scope) ★ 0.89
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/brain-manager.ts:4510-4515`
📝 Get ingestion manager

```typescript
getIngestionManager(): IncrementalIngestionManager {
    if (!this.ingestionManager) {
      throw new Error('Ingestion manager not initialized. Call initialize() first.');
    }
    return this.ingestionManager;
  }
```

### 5. async ingestGraph(graph: {
      nodes: ParsedNode[];
      relationships: Pa... (Scope) ★ 0.87
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1554-1569`
📝 Ingest a pre-parsed graph into Neo4j
Public wrapper around the private ingestNodes method

@param graph - Parsed nodes and relationships
@param options - Ingestion options

```typescript
async ingestGraph(
    graph: {
      nodes: ParsedNode[];
      relationships: ParsedRelationship[];
    },
    options: { projectId?: string; markDirty?: boolean; onProgress?: ProgressCallback } = {}
  ): Promise<{ nodesCreated: number; relationshipsCreated: number }> {
    const { markDirty = true, onProgress } = options;

    await this.ingestNodes(graph.nodes, graph.relationships, markDirty, onProgress);

    return {
      nodesCreated: graph.nodes.length,
      relationshipsCreated: graph.relationships.length,
    };
  }
```

### 6. isProcessing(): boolean (Scope) ★ 0.87
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/ingestion-queue.ts:224-226`
📝 Check if ingestion is currently in progress

### 7. interface WatchConfig() (Scope) ★ 0.87
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/types/config.ts:445-457`
📝 Configuration for file watching and automatic incremental ingestion

### 8. private async ingestNodes(nodes: ParsedNode[], relationships: ParsedRelations... (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:616-780`
📝 Ingest nodes and relationships into Neo4j
Uses UNWIND batching for optimal performance

SIMPLIFIED: No more capture/restore of embeddings.
- SET n += props preserves properties not in props (like e...

### 9. async ingestFromPaths(config: SourceConfig, options: IngestionOptions & { inc... (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1067-1412`
📝 Ingest files from source configuration

OPTIMIZED: Pre-parsing hash check skips unchanged files entirely

@param config - Source configuration (code, documents, etc.)
@param options - Ingestion opt...

### 10. type_alias NodeState() (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/ingestion/state-types.ts:11-21`
📝 Node states in the ingestion pipeline

### 11. interface IngestionStats() (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/ingestion/types.ts:98-131`
📝 Statistics returned from ingestion operations

### 12. /** (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1-39`

### 13. interface IngestionQueueConfig() (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/ingestion-queue.ts:17-83`

### 14. interface ExplorationGraph() (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/search-post-processor.ts:107-110`
📝 Result of relationship exploration

### 15. private async createRelationshipsBatch(relationships: ParsedRelationship[]): ... (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/brain/file-processor.ts:1068-1105`
📝 Create or update relationships in batch using MERGE
Uses MERGE to avoid duplicate relationships during incremental ingestion

### 16. async ingest(options: IngestOptions): Promise<IngestResult> (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/lib/ragforge/ingestion-service.ts:139-325`
📝 Ingest files with automatic type detection and routing

### 17. interface IngestionStatus() (Scope) ★ 0.86
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/tools/ingestion-lock.ts:46-57`
📝 Current lock status

### 18. let globalIngestionLock: IngestionLock | null (Scope) ★ 0.85
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/tools/ingestion-lock.ts:339-339`
📝 Singleton instance for global ingestion lock coordination

### 19. interface IngestFile() (Scope) ★ 0.85
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/lib/ragforge/ingestion-service.ts:34-39`
📝 Input file for ingestion

### 20. interface OrchestratorStatus() (Scope) ★ 0.85
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/ingestion/types.ts:344-367`
📝 Status of the ingestion orchestrator

---

## Dependency Graph

```
IncrementalIngestionManager (class) ★1.2 @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:91-2606
├── [CONSUMES]
│       ├── deleteNodesForFiles (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:550-567
│       │   ├── [CONSUMED_BY]
│       │   │       └── ingestFromPaths (method) ★0.9 @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1067-1412
│       │   ├── [USES_LIBRARY]
│       │   │       └── path (ExternalLibrary)
│       │   └── [CONSUMES]
│       │           ├── STATE_PROPERTIES (variable) @ lib/ragforge/state/types.ts:225-251
│       │           ├── adapter (variable) @ lib/ragforge/parsers.ts:66
│       │           ├── ResolvedReference (interface) @ packages/ragforge-core/src/brain/reference-extractor.ts:56-63
│       │           ├── BatchResult (interface) @ packages/ragforge-core/src/brain/file-processor.ts:76-91
│       │           ├── FileState (type_alias) @ packages/ragforge-core/src/brain/file-state-machine.ts:37-47
│       │           ├── get (method) @ packages/ragforge-core/src/tools/web-tools.ts:122-125
│       │           ├── toNumber (function) @ tests/audit-database.ts:13-17
│       │           ├── FileInfo (interface) @ packages/ragforge-core/src/brain/file-processor.ts:44-57
│       │           ├── run (method) @ lib/ragforge/neo4j-client.ts:45-56
│       │           ├── RelationType (type_alias) @ packages/ragforge-core/src/brain/reference-extractor.ts:26-35
│       │           ├── parsers (variable) @ packages/ragforge-core/packages/codeparsers/src/parallel/parser-worker.ts:34
│       │           └── FileStateInfo (interface) @ packages/ragforge-core/src/brain/file-state-machine.ts:57-69
│       ├── FileStateMachine (class) @ packages/ragforge-core/src/brain/file-state-machine.ts:129-601
│       │   ├── [CONSUMED_BY]
│       │   │       ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/adapters/file-watcher.ts:1-19
│       │   │       ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1-39
│       │   │       ├── file_scope_01 (module) @ packages/ragforge-core/src/brain/brain-manager.ts:1-78
│       │   │       ├── BrainManager (class) ★0.9 @ packages/ragforge-core/src/brain/brain-manager.ts:466-5760
│       │   │       ├── initialize (method) @ packages/ragforge-core/src/brain/brain-manager.ts:536-594
│       │   │       ├── startWatching (method) @ packages/ragforge-core/src/brain/brain-manager.ts:4830-4960
│       │   │       ├── file_scope_01 (module) @ packages/ragforge-core/src/brain/embedding-coordinator.ts:1-27
│       │   │       ├── EmbeddingCoordinatorConfig (interface) @ packages/ragforge-core/src/brain/embedding-coordinator.ts:47-60
│       │   │       ├── FileProcessor (class) @ packages/ragforge-core/src/brain/file-processor.ts:160-1598
│       │   │       ├── FileProcessorConfig (interface) @ packages/ragforge-core/src/brain/file-processor.ts:100-154
│       │   │       ├── constructor (method) @ packages/ragforge-core/src/brain/file-processor.ts:172-194
│       │   │       ├── file_scope_01 (module) @ packages/ragforge-core/src/brain/file-processor.ts:1-50
│       │   │       ├── file_scope_01 (module) @ packages/ragforge-core/src/brain/index.ts:1-186
│       │   │       └── TouchedFilesWatcher (class) @ packages/ragforge-core/src/brain/touched-files-watcher.ts:116-510
│       │   └── [CONSUMES]
│       │           ├── error (function) @ tests/test-entity-extraction.ts:49-51
│       │           ├── getProgress (method) @ packages/ragforge-core/src/brain/file-state-machine.ts:584-590
│       │           ├── Entity (type_alias) @ lib/ragforge/entity-types.ts:106-113
│       │           ├── resetStuckFiles (method) @ packages/ragforge-core/src/brain/file-state-machine.ts:354-369
│       │           ├── markDiscoveredBatch (method) @ packages/ragforge-core/src/brain/file-state-machine.ts:469-544
│       │           ├── embed (method) @ lib/ragforge/embedding-service.ts:59-77
│       │           ├── reset (method) @ packages/ragforge-core/src/runtime/reranking/rate-limiter.ts:91-93
│       │           ├── getRetryableFiles (method) @ packages/ragforge-core/src/brain/file-state-machine.ts:322-349
│       │           ├── cleanup (function) @ agents/lucie_agent/tools.py:360-365
│       │           └── getFilesInState (method) @ packages/ragforge-core/src/brain/file-state-machine.ts:211-245
│       ├── countDirtyEntityNodes (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1517-1529
│       ├── getFilesNeedingEmbedding (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:2585-2587
│       │   └── [CONSUMES]
│       │           └── stateMachine (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:111-116
│       ├── stateMigration (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:122-127
│       │   ├── [CONSUMED_BY]
│       │   │       └── initializeStateMachine (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:2418-2439
│       │   └── [INHERITS_FROM]
│       │           └── FileStateMigration (class) @ packages/ragforge-core/src/brain/file-state-machine.ts:606-731
│       ├── deleteOutgoingRelationships (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:576-604
│       │   └── [CONSUMED_BY]
│       │           └── ingestIncremental (method) ★0.9 @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:797-1052
│       ├── constructor (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:98-105
│       │   ├── [INHERITS_FROM]
│       │   │       └── Neo4jClient (class) @ packages/ragforge-core/src/runtime/client/neo4j-client.ts:10-217
│       │   └── [CONSUMES]
│       │           ├── ChangeTracker (class) @ packages/ragforge-core/src/runtime/adapters/change-tracker.ts:29-428
│       │           ├── registerAllParsers (function) @ packages/ragforge-core/src/ingestion/parsers/index.ts:57-66
│       │           └── areParsersRegistered (function) @ packages/ragforge-core/src/ingestion/parsers/index.ts:71-73
│       ├── ParsedNode (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:120-129
│       │   └── [CONSUMED_BY]
│       │           ├── ChangeQueueConfig (interface) @ packages/ragforge-core/src/ingestion/types.ts:312-321
│       │           ├── crawl (method) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:126-228
│       │           ├── normalizeUrl (method) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:233-245
│       │           ├── pagesToGraph (method) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:272-361
│       │           ├── WebAdapter (class) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:68-362
│       │           ├── CrawledPage (interface) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:38-47
│       │           ├── parse (method) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:72-104
│       │           ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:1-37
│       │           ├── validate (method) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:109-121
│       │           ├── createWebAdapter (function) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:367-369
│       │           ├── matchesPatterns (method) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:250-267
│       │           ├── CrawlOptions (interface) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:49-57
│       │           └── file_scope_01 (module) @ packages/ragforge-core/src/runtime/adapters/index.ts:1-34
│       ├── getExistingHashes (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:236-274
│       ├── ProgressCallback (type_alias) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:54-59
│       ├── ingestGraph (method) ★0.9 @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1554-1569
│       │   ├── [IMPLEMENTS]
│       │   │       └── ParsedRelationship (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:134-163
│       │   ├── [CONSUMES]
│       │   │       └── ingestNodes (method) ★0.9 @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:616-780
│       │   └── [CONSUMED_BY]
│       │           ├── reingest (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:219-342
│       │           ├── IngestionOrchestrator (class) @ packages/ragforge-core/src/ingestion/orchestrator.ts:141-529
│       │           ├── processEntityExtraction (method) @ packages/ragforge-core/src/brain/brain-manager.ts:4525-4617
│       │           ├── initializeOrchestrator (method) @ packages/ragforge-core/src/brain/brain-manager.ts:599-736
│       │           ├── ingestVirtual (method) @ lib/ragforge/orchestrator-adapter.ts:699-828
│       │           ├── ingestBinaryDocument (method) @ lib/ragforge/orchestrator-adapter.ts:1268-1388
│       │           ├── ingestFiles (method) @ lib/ragforge/orchestrator-adapter.ts:887-1249
│       │           ├── ingestMedia (method) @ lib/ragforge/orchestrator-adapter.ts:1417-1552
│       │           ├── CommunityOrchestratorAdapter (class) @ lib/ragforge/orchestrator-adapter.ts:373-2424
│       │           └── initialize (method) @ lib/ragforge/orchestrator-adapter.ts:401-632
│       ├── IncrementalStats (interface) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:40-45
│       │   └── [CONSUMED_BY]
│       │           ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/adapters/ingestion-queue.ts:1-16
│       │           ├── IngestionQueue (class) @ packages/ragforge-core/src/runtime/adapters/ingestion-queue.ts:85-447
│       │           └── IngestionQueueConfig (interface) @ packages/ragforge-core/src/runtime/adapters/ingestion-queue.ts:17-83
│       ├── ParsedGraph (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:168-192
│       │   └── [CONSUMED_BY]
│       │           ├── discoverFiles (method) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:588-618
│       │           └── exportXml (method) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:3548-3554
│       ├── IngestionOptions (interface) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:61-76
│       ├── reIngestFile (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1802-2031
│       │   ├── [CONSUMES]
│       │   │       ├── log (function) @ tests/test-entity-extraction.ts:37-43
│       │   │       └── deleteNodes (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:497-509
│       │   ├── [IMPLEMENTS]
│       │   │       └── SourceConfig (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:54-115
│       │   └── [USES_LIBRARY]
│       │           └── fs/promises (ExternalLibrary)
│       └── reIngestFiles (method) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1581-1787
│           └── [CONSUMED_BY]
│                   └── flushAgentEditQueue (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5109-5208
└── [CONSUMED_BY]
        ├── isEmbedding (method) @ packages/ragforge-core/src/brain/embedding-coordinator.ts:365-370
        │   ├── [CONSUMES]
        │   │       ├── isLocked (method) @ packages/ragforge-core/src/tools/ingestion-lock.ts:121-123
        │   │       ├── Batch (interface) @ packages/ragforge-core/src/runtime/llm/structured-llm-executor.ts:389-392
        │   │       ├── processing (method) @ packages/ragforge-core/src/brain/touched-files-watcher.ts:190-192
        │   │       └── release (method) @ packages/ragforge-core/src/tools/ingestion-lock.ts:205-238
        │   └── [HAS_PARENT]
        │           └── EmbeddingCoordinator (class) @ packages/ragforge-core/src/brain/embedding-coordinator.ts:79-458
        ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/projects/project-registry.ts:1-22
        │   └── [CONSUMES]
        │           ├── config (variable) @ middleware.ts:52-54
        │           ├── FileWatcher (class) @ packages/ragforge-core/src/runtime/adapters/file-watcher.ts:50-427
        │           ├── AgentLogger (class) @ packages/ragforge-core/src/runtime/agents/rag-agent.ts:62-311
        │           ├── RagForgeConfig (interface) @ packages/ragforge-core/src/types/config.ts:5-29
        │           ├── IngestionLock (class) @ packages/ragforge-core/src/tools/ingestion-lock.ts:97-334
        │           ├── unload (method) @ packages/ragforge-core/src/runtime/projects/project-registry.ts:174-208
        │           └── splitPath (function) @ packages/ragforge-core/src/utils/path-utils.ts:25-27
        ├── LoadedProject (interface) @ packages/ragforge-core/src/runtime/projects/project-registry.ts:33-69
        │   └── [CONSUMED_BY]
        │           ├── getIngestionManager (method) ★0.9 @ packages/ragforge-core/src/brain/brain-manager.ts:4510-4515
        │           ├── connectNeo4j (method) @ packages/ragforge-core/src/brain/brain-manager.ts:1620-1683
        │           ├── ProjectRegistry (class) @ packages/ragforge-core/src/runtime/projects/project-registry.ts:111-357
        │           ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/projects/index.ts:1-17
        │           ├── setAgentSettings (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5509-5516
        │           ├── setActivePersona (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5371-5397
        │           ├── deletePersona (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5431-5457
        │           ├── getPersona (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5358-5366
        │           ├── enhancePersonaDescription (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5583-5675
        │           ├── getAgentSettings (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5499-5503
        │           ├── waitForPendingEdits (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5251-5296
        │           ├── shutdown (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5305-5324
        │           ├── dispose (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5719-5733
        │           ├── getActivePersona (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5341-5353
        │           ├── addPersona (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5402-5426
        │           └── createEnhancedPersona (method) @ packages/ragforge-core/src/brain/brain-manager.ts:5685-5714
        ├── unwatchOrphanFile (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:370-372
        │   ├── [CONSUMES]
        │   │       ├── UniversalSourceAdapter (class) @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:58-143
        │   │       ├── PreserverConfig (interface) @ packages/ragforge-core/src/ingestion/metadata-preserver.ts:39-51
        │   │       ├── metadata (variable) @ app/layout.tsx:16-22
        │   │       └── orchestrator (method) @ packages/ragforge-core/src/brain/brain-manager.ts:816-818
        │   └── [INHERITS_FROM]
        │           └── unwatch (method) @ packages/ragforge-core/src/ingestion/orphan-watcher.ts:111-125
        ├── initialize (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:189-205
        │   └── [CONSUMES]
        │           ├── isInitialized (method) @ packages/ragforge-core/src/brain/brain-manager.ts:4485-4487
        │           ├── add (method) @ packages/ragforge-core/src/ingestion/change-queue.ts:39-69
        │           └── onFileChange (method) @ packages/ragforge-core/src/ingestion/orphan-watcher.ts:130-132
        ├── createOrchestrator (function) @ packages/ragforge-core/src/ingestion/orchestrator.ts:534-539
        │   ├── [IMPLEMENTS]
        │   │       ├── OrchestratorConfig (interface) @ packages/ragforge-core/src/ingestion/orchestrator.ts:115-130
        │   │       └── OrchestratorDependencies (interface) @ packages/ragforge-core/src/ingestion/orchestrator.ts:37-110
        │   └── [CONSUMED_BY]
        │           ├── file_scope_01 (module) @ packages/ragforge-core/src/ingestion/index.ts:1-217
        │           └── file_scope_01 (module) @ packages/ragforge-core/src/index.ts:1-430
        ├── queueChanges (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:348-350
        │   ├── [CONSUMES]
        │   │       └── addBatch (method) @ packages/ragforge-core/src/ingestion/change-queue.ts:74-78
        │   └── [IMPLEMENTS]
        │           └── FileChange (interface) @ packages/ragforge-core/src/ingestion/types.ts:23-32
        ├── getStatus (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:396-412
        │   ├── [CONSUMES]
        │   │       ├── isActive (method) @ packages/ragforge-core/src/ingestion/processing-loop.ts:331-333
        │   │       └── getStats (method) @ lib/ragforge/entity-embedding-service.ts:798-822
        │   └── [IMPLEMENTS]
        │           └── OrchestratorStatus (interface) @ packages/ragforge-core/src/ingestion/types.ts:344-367
        ├── getRelativePath (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:479-495
        ├── findCommonRoot (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:500-528
        ├── processBatch (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:445-474
        │   ├── [CONSUMES]
        │   │       ├── isProcessing (method) ★0.9 @ packages/ragforge-core/src/runtime/adapters/ingestion-queue.ts:224-226
        │   │       └── ORPHAN_PROJECT_ID (variable) @ packages/ragforge-core/src/ingestion/types.ts:266
        │   └── [CONSUMED_BY]
        │           └── constructor (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:153-183
        ├── constructor (method) @ packages/ragforge-core/src/brain/embedding-coordinator.ts:87-94
        │   └── [CONSUMES]
        │           └── stateMachine (method) @ packages/ragforge-core/src/brain/brain-manager.ts:824-826
WatchConfig (interface) ★0.9 @ packages/ragforge-core/src/types/config.ts:445-457
NodeState (type_alias) ★0.9 @ packages/ragforge-core/src/ingestion/state-types.ts:11-21
└── [CONSUMED_BY]
        ├── file_scope_01 (module) @ packages/ragforge-core/src/ingestion/unified-processor.ts:1-48
        │   ├── [CONSUMES]
        │   │       ├── MetadataPreserver (class) @ packages/ragforge-core/src/ingestion/metadata-preserver.ts:53-438
        │   │       ├── ParserOptionsConfig (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:274-307
        │   │       ├── VirtualFile (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:18-42
        │   │       ├── resolvePendingImports (function) @ packages/ragforge-core/src/brain/reference-extractor.ts:1446-1511
        │   │       ├── UnifiedProcessor (class) @ packages/ragforge-core/src/ingestion/unified-processor.ts:117-2445
        │   │       ├── ErrorType (type_alias) @ packages/ragforge-core/src/brain/file-state-machine.ts:49
        │   │       └── createEntityExtractionTransform (function) @ packages/ragforge-core/src/ingestion/entity-extraction/transform.ts:173-291
        │   └── [USES_LIBRARY]
        │           ├── crypto (ExternalLibrary)
        │           ├── p-limit (ExternalLibrary)
        │           └── neo4j-driver (ExternalLibrary)
        ├── file_scope_01 (module) @ packages/ragforge-core/src/ingestion/parser-types.ts:1-21
        │   └── [CONSUMES]
        │           ├── FIELD_MAPPING (variable) @ packages/ragforge-core/src/utils/node-schema.ts:597-787
        │           ├── StateErrorType (type_alias) @ packages/ragforge-core/src/ingestion/state-types.ts:26
        │           └── clear (method) @ packages/ragforge-core/src/ingestion/change-queue.ts:177-180
        └── SystemProps (interface) @ packages/ragforge-core/src/ingestion/parser-types.ts:22-58
IngestionStats (interface) @ packages/ragforge-core/src/ingestion/types.ts:98-131
└── [CONSUMED_BY]
        └── migrateChildProjectToParent (method) @ packages/ragforge-core/src/brain/brain-manager.ts:2006-2091
            ├── [CONSUMED_BY]
            │       └── registerProject (method) @ packages/ragforge-core/src/brain/brain-manager.ts:1709-1775
            └── [CONSUMES]
                    ├── UnifiedProcessorConfig (interface) @ packages/ragforge-core/src/ingestion/unified-processor.ts:49-83
                    ├── delete (method) @ packages/ragforge-core/src/runtime/mutations/mutation-builder.ts:174-181
                    ├── EmbeddingProviderConfig (interface) @ packages/ragforge-core/src/types/config.ts:485-500
                    ├── EntityExtractionConfig (interface) @ packages/ragforge-core/src/ingestion/entity-extraction/types.ts:106-130
                    ├── LoopStats (interface) @ packages/ragforge-core/src/ingestion/processing-loop.ts:37-60
                    └── timestamp (variable) @ lib/ragforge/api/server.ts:288
ExplorationGraph (interface) @ packages/ragforge-core/src/brain/search-post-processor.ts:107-110
ingest (method) @ lib/ragforge/ingestion-service.ts:139-325
```

---

## Node Types Summary

| Type | Count |
|------|-------|
| Scope | 20 |
