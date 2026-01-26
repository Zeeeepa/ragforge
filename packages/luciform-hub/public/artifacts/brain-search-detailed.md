# Brain Search: "UniversalSourceAdapter parse virtual files delegation"

**Results:** 10 / 10
**Projects:** LR_CodeRag-community-docs-rzd1

**Parameters:**
semantic=true | limit=10 | explore_depth=1

---

## Results

### 1. class UniversalSourceAdapter() (Scope) ★ 1.00
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:58-143`
📝 Universal Source Adapter

Parses any supported source type into Neo4j graph structure.
Dispatches to appropriate sub-adapter based on source type.

```typescript
export class UniversalSourceAdapter extends SourceAdapter {

Members:
  - constructor() (L67-73)
    { super(); this.codeAdapter = new CodeSourceAdapter('auto'); this.databaseAdapter = new DatabaseAdapter(); this.webAdapter = new WebAd
  - async parse(options: ParseOptions): Promise<ParseResult> (L78-103)
    { const sourceType = options.source.type; // Normalize legacy types const normalizedType = (sourceType === 'code' || sourceType === 'docu
  - private async parseFiles(options: ParseOptions): Promise<ParseResult> (L108-114)
    { const normalizedConfig = normalizeFileSourceConfig(options.source); return this.codeAdapter.parse({ ...options, source: normaliz
  - async validate(config: SourceConfig): Promise<ValidationResult> (L119-142)
    { const sourceType = config.type; const normalizedType = (sourceType === 'code' || sourceType === 'document') ? 'files' : sourceTy
```

### 2. class CodeSourceAdapter() (Scope) ★ 0.95
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:162-3627`
📝 Adapter for parsing code sources (TypeScript, Python, HTML/Vue, etc.)

```typescript
export class CodeSourceAdapter extends SourceAdapter {

Members:
  - constructor(adapterName: 'typescript' | 'python' | 'html' | 'auto') (L177-182)
    { super(); this.adapterName = adapterName; this.registry = this.initializeRegistry(); this.uuidCache = new Map(); }
  - private async computeFileMetadata(filePath: string): Promise<{
    rawContentHash?: string;
    mtime?: string;
  }> (L188-204)
    { try { const [fileContent, stat] = await Promise.all([ fs.readFile(filePath), fs.stat(filePath) ]); return { 
  - private async getHtmlParser(): Promise<HTMLDocumentParser> (L209-215)
    { if (!this.htmlParser) { this.htmlParser = new HTMLDocumentParser(); await this.htmlParser.initialize(); } return this.htmlPa
  - private async getCssParser(): Promise<CSSParser> (L220-226)
    { if (!this.cssParser) { this.cssParser = new CSSParser(); await this.cssParser.initialize(); } return this.cssParser; }
  - private async getScssParser(): Promise<SCSSParser> (L231-237)
    { if (!this.scssParser) { this.scssParser = new SCSSParser(); await this.scssParser.initialize(); } return this.scssParser; 
  - private async getVueParser(): Promise<VueParser> (L242-248)
    { if (!this.vueParser) { this.vueParser = new VueParser(); await this.vueParser.initialize(); } return this.vueParser; }
  - private async getSvelteParser(): Promise<SvelteParser> (L253-259)
    { if (!this.svelteParser) { this.svelteParser = new SvelteParser(); await this.svelteParser.initialize(); } return this.svelte
... (104 more lines)
```

### 3. const UniversalFileAdapter (Scope) ★ 0.92
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:153-153`

```typescript
UniversalFileAdapter = UniversalSourceAdapter
```

### 4. function initializeParsers(): void (Scope) ★ 0.91
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/lib/ragforge/parsers.ts:83-89`
📝 Initialize parsers (creates UniversalSourceAdapter)

```typescript
function initializeParsers(): void {
  if (initialized) return;
  initialized = true;

  getAdapter();
  logger.info("[CommunityParsers] Initialized with UniversalSourceAdapter");
}
```

### 5. function createUniversalSourceAdapter(): UniversalSourceAdapter (Scope) ★ 0.90
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:148-150`
📝 Create a universal source adapter instance

```typescript
function createUniversalSourceAdapter(): UniversalSourceAdapter {
  return new UniversalSourceAdapter();
}
```

### 6. const createUniversalFileAdapter (Scope) ★ 0.89
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:154-154`

### 7. let universalAdapter: UniversalSourceAdapter | null (Scope) ★ 0.89
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:79-79`

### 8. let adapter: UniversalSourceAdapter | null (Scope) ★ 0.88
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/lib/ragforge/parsers.ts:66-66`

### 9. function getAdapter(): UniversalSourceAdapter (Scope) ★ 0.88
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/lib/ragforge/parsers.ts:69-74`

### 10. interface ParseUploadResult() (Scope) ★ 0.88
📍 `/home/luciedefraiteur/LR_CodeRag/community-docs/lib/ragforge/upload-adapter.ts:51-60`

---

## Dependency Graph

```
UniversalSourceAdapter (class) ★1.0 @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:58-143
├── [CONSUMES]
│       ├── APIAdapter (class) @ packages/ragforge-core/src/runtime/adapters/api-adapter.ts:38-65
│       ├── DatabaseAdapter (class) @ packages/ragforge-core/src/runtime/adapters/database-adapter.ts:88-114
│       ├── SourceConfig (interface) @ packages/ragforge-core/src/types/config.ts:340-426
│       │   └── [CONSUMED_BY]
│       │           ├── UniversalFileAdapter (variable) ★0.9 @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:153
│       │           ├── createUniversalSourceAdapter (function) ★0.9 @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:148-150
│       │           └── createUniversalFileAdapter (variable) ★0.9 @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:154
│       ├── parse (method) @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:78-103
│       ├── parseFiles (method) @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:108-114
│       ├── ValidationResult (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:312-321
│       ├── adapter (variable) ★0.9 @ lib/ragforge/parsers.ts:66
│       │   ├── [CONSUMED_BY]
│       │   │       ├── universalAdapter (variable) ★0.9 @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:79
│       │   │       ├── parseFile (method) @ lib/ragforge/upload-adapter.ts:199-223
│       │   │       ├── resolveImportReferences (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:445-591
│       │   │       ├── generateUuid (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:802-824
│       │   │       ├── resolveDecoratorRelations (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:627-678
│       │   │       ├── calculateStats (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:860-880
│       │   │       ├── enrichParsedFiles (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:886-952
│       │   │       ├── getSignatureHash (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:830-845
│       │   │       ├── resolveContainsRelation (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:596-622
│       │   │       ├── resolveUnknownReferences (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:326-440
│       │   │       ├── findConsumers (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:971-985
│       │   │       ├── getScopeByUuid (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:957-959
│       │   │       ├── generateInverseRelationships (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:761-796
│       │   │       ├── findDependencies (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:990-1004
│       │   │       ├── getRelativePath (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:850-855
│       │   │       ├── detectRelationshipType (method) @ packages/ragforge-core/packages/codeparsers/src/relationship-resolution/RelationshipResolver.ts:683-756
│       │   │       ├── getAdapter (function) ★0.9 @ lib/ragforge/parsers.ts:69-74
│       │   │       └── ParseUploadResult (interface) ★0.9 @ lib/ragforge/upload-adapter.ts:51-60
│       │   ├── [CONSUMES]
│       │   │       ├── ParsedRelationship (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:134-163
│       │   │       ├── get (method) @ packages/ragforge-core/src/tools/web-tools.ts:122-125
│       │   │       ├── ParsedNode (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:120-129
│       │   │       ├── semantic (method) @ packages/ragforge-core/src/runtime/query/query-builder.ts:238-254
│       │   │       └── ParseResult (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:217-226
│       │   └── [USES_LIBRARY]
│       │           └── @luciformresearch/ragforge (ExternalLibrary)
│       ├── ParseOptions (interface) @ packages/ragforge-core/src/runtime/adapters/types.ts:231-262
│       ├── CodeSourceAdapter (class) ★1.0 @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:162-3627
│       │   ├── [CONSUMED_BY]
│       │   │       ├── main (function) @ scripts/test-virtual-files.ts:11-130
│       │   │       ├── constructor (method) @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:67-73
│       │   │       ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:1-36
│       │   │       └── file_scope_01 (module) @ scripts/test-virtual-files.ts:1-10
│       │   └── [CONSUMES]
│       │           ├── getSvelteParser (method) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:253-259
│       │           ├── buildGlobalUUIDMapping (method) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:3230-3251
│       │           ├── buildScopeRelationshipsWithResolver (method) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:3260-3376
│       │           ├── buildGraph (method) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:1014-2861
│       │           ├── CSSParser (class) @ packages/ragforge-core/packages/codeparsers/src/css/CSSParser.ts:29-504
│       │           ├── isDocumentFile (function) @ packages/ragforge-core/src/runtime/adapters/document-file-parser.ts:125-128
│       │           ├── getLocalTimestamp (function) @ packages/ragforge-core/src/runtime/utils/timestamp.ts:6-21
│       │           ├── isMarkdownFile (method) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:358-361
│       │           ├── TypeScriptLanguageParser (class) @ packages/ragforge-core/packages/codeparsers/src/typescript/TypeScriptLanguageParser.ts:25-164
│       │           ├── getPathDepth (function) @ packages/ragforge-core/src/utils/path-utils.ts:61-63
│       │           ├── areParsersRegistered (function) @ packages/ragforge-core/src/ingestion/parsers/index.ts:71-73
│       │           ├── CodeSourceConfig (interface) @ packages/ragforge-core/src/runtime/adapters/code-source-adapter.ts:121-140
│       │           └── SvelteParseResult (interface) @ packages/ragforge-core/packages/codeparsers/src/svelte/types.ts:221-230
│       ├── validate (method) @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:119-142
│       ├── normalizeFileSourceConfig (function) @ packages/ragforge-core/src/runtime/adapters/universal-source-adapter.ts:37-50
│       ├── WebAdapter (class) @ packages/ragforge-core/src/runtime/adapters/web-adapter.ts:68-362
└── [CONSUMED_BY]
        ├── FileProcessor (class) @ packages/ragforge-core/src/brain/file-processor.ts:135-1522
        ├── getAdapter (function) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:84-89
        ├── file_scope_01 (module) @ packages/ragforge-core/src/runtime/adapters/incremental-ingestion.ts:1-39
        ├── registerProjectWatcher (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:378-384
        ├── getRelativePath (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:479-495
        ├── IngestionOrchestrator (class) @ packages/ragforge-core/src/ingestion/orchestrator.ts:141-529
        ├── unregisterProjectWatcher (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:389-391
        ├── processBatch (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:445-474
        ├── stop (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:431-435
        ├── reingest (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:219-342
        ├── findCommonRoot (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:500-528
        ├── unwatchOrphanFile (method) @ packages/ragforge-core/src/ingestion/orchestrator.ts:370-372
        └── initializeParsers (function) ★0.9 @ lib/ragforge/parsers.ts:83-89
            ├── [CONSUMES]
            │       ├── initialized (variable) @ lib/ragforge/parsers.ts:67
            │       └── info (method) @ lib/ragforge/logger.ts:212-214
            └── [CONSUMED_BY]
                    ├── parseFile (function) @ lib/ragforge/parsers.ts:160-248
                    └── file_scope_01 (module) @ lib/ragforge/index.ts:1-135
```

---

## Node Types Summary

| Type | Count |
|------|-------|
| Scope | 10 |
