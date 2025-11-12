# RagForge Codebase Architecture Analysis

## Overview

RagForge is a sophisticated retrieval-augmented generation (RAG) framework designed specifically for code analysis and knowledge graphs. It provides type-safe, fluent APIs for querying Neo4j databases with semantic search, LLM reranking, and intelligent relationship traversal.

**Key Innovation**: Pipeline-based query execution allowing semantic search, filtering, relationship expansion, and LLM reranking to be composed flexibly and efficiently.

---

## 1. ARCHITECTURE OVERVIEW

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  CLI Layer (packages/cli)                               │
│  - Commands: init, introspect, generate, quickstart     │
│  - Config management, embeddings, schema detection      │
└────────────────────┬────────────────────────────────────┘
                     │
┌─────────────────────▼────────────────────────────────────┐
│  Core Layer (packages/core)                             │
│  - Schema introspection from Neo4j                      │
│  - Code generation: type-safe clients, mutations        │
│  - Configuration management                             │
│  - Template system for generated code                   │
└────────────────────┬────────────────────────────────────┘
                     │
┌─────────────────────▼────────────────────────────────────┐
│  Runtime Layer (packages/runtime)                       │
│  - Neo4j client abstractions                            │
│  - Query builder with pipeline operations               │
│  - Vector search with embeddings                        │
│  - LLM reranking & structured prompts                   │
│  - Source adapters (code parsing)                       │
│  - Iterative code agent                                 │
└─────────────────────────────────────────────────────────┘
```

### Package Dependencies
- **cli** → core, runtime
- **core** → runtime, codeparsers, schema introspection
- **runtime** → neo4j-driver, @google/genai, codeparsers

---

## 2. CORE COMPONENTS

### 2.1 Query Pipeline Architecture

**File**: `packages/runtime/src/query/query-builder.ts` (1911 lines)

The QueryBuilder implements a **pipeline-based execution model** that supports composable operations:

#### Pipeline Operations (Defined in `operations.ts`)

```typescript
type PipelineOperation =
  | FetchOperation      // Retrieve initial data from Neo4j
  | SemanticOperation   // Vector search by semantic similarity
  | ExpandOperation     // Follow relationships to related entities
  | FilterOperation     // Post-process by field values or relationships
  | LLMRerankOperation  // Rerank using LLM evaluation
  | ClientFilterOperation; // Client-side predicate filtering
```

#### Key Features

1. **Fluent API Design**
   - Method chaining: `.where().semantic().expand().llmRerank().execute()`
   - Returns `this` for composition
   - Easy to read and understand intent

2. **Operation Merging Optimization**
   - Consecutive filter operations are merged into preceding semantic/expand
   - Reduces database round-trips
   - Tracks merged operations in metadata

3. **Score Management**
   - Each result has a score and scoreBreakdown
   - Multiple scoring strategies (vector + semantic + LLM)
   - Configurable score merging (weighted, multiplicative, llm-override)

#### Execution Flow

```
1. executePipeline() iterates through operations
2. For each operation:
   - If 'fetch': Query Neo4j by UUID, field filters, or relationships
   - If 'semantic': Vector search with optional UUID/field filtering
   - If 'expand': Follow relationships from current results
   - If 'filter': Apply field or relationship constraints
   - If 'llmRerank': Evaluate relevance with LLM
   - If 'clientFilter': Apply JavaScript predicate
3. Track timing and input/output counts
4. Sort by score (descending) and apply limit/offset
```

#### Semantic Search Integration

```typescript
query.semantic('search text', {
  indexName: 'scopeEmbeddings',
  topK: 50,
  minScore: 0.7,
  metadataOverride: (results, metadata) => { ... }
})
```

- Integrates VectorSearch module for embeddings
- Supports multiple vector indexes per entity
- Can chain multiple semantic operations (progressive refinement)
- Automatically merges with previous results

#### Relationship Operations

```typescript
// Generic relationship traversal
query.whereRelatedBy('entityName', 'RELATIONSHIP_TYPE', 'outgoing', 'TargetType')

// Expand from results
query.expand('CONSUMES', { depth: 2, direction: 'outgoing' })
  .filter(r => r.entity.type === 'function')
```

---

### 2.2 Vector Search Module

**File**: `packages/runtime/src/vector/vector-search.ts`

#### Architecture

```typescript
class VectorSearch {
  private neo4jClient: Neo4jClient;
  private genAIClients: Map<string, GoogleGenAI>;
  
  // Index registry for managing embeddings configs
  private static indexRegistry: Map<string, IndexConfig>;
}
```

#### Key Capabilities

1. **Embedding Generation**
   - Uses Google Gemini API: `embedContent()`
   - Supports custom dimensions
   - Client pooling for efficiency
   - Environment variable injection (GEMINI_API_KEY)

2. **Vector Search Query**
   ```typescript
   CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
   YIELD node, score
   WHERE score >= $minScore
   [AND node.uuid IN $filterUuids]
   [AND field filter conditions...]
   OPTIONAL MATCH (node)-[:CONSUMES]->(dep)
   RETURN elementId(node), score, node, collect(DISTINCT dep.name) AS consumes
   ```

3. **Filtering During Search**
   - UUID filtering: Restrict to existing results
   - Field filtering: WHERE clauses applied before LIMIT
   - Context enrichment: Automatic CONSUMES relationship inclusion

4. **Configuration Management**
   ```typescript
   VectorSearch.registerIndex('scopeEmbeddings', {
     model: 'gemini-embedding-001',
     dimension: 768,
     apiKey: 'optional-override'
   });
   ```

#### Current Limitations & Integration Points

- **Single embedding per index**: Could support multiple embeddings per field
- **Hard-coded CONSUMES relationship**: Could be parameterized
- **No batch generation**: Could support bulk embedding regeneration
- **Limited error recovery**: Could implement retry logic for API timeouts

---

### 2.3 Neo4j Query Structure

**File**: `packages/runtime/src/client/neo4j-client.ts`

#### Query Types Supported

1. **Field Filtering** (WHERE clause)
   ```typescript
   // Simple equality
   where({ type: 'function', file: 'index.ts' })
   
   // Operators
   where({ 
     lines: { gte: 100 }, 
     name: { contains: 'handle' },
     complexity: { gt: 5 }
   })
   
   // Regex patterns
   wherePattern('source', /async\s+function/)
   
   // IN operator (batch queries)
   whereIn('uuid', ['uuid1', 'uuid2', ...])
   ```

2. **Relationship Traversal**
   ```cypher
   // Direct relationship query
   MATCH (target:Scope {name: $targetScopeName})
   MATCH (n:Scope)-[:CONSUMES]->(target)
   WHERE n.uuid IN $uuids
   ```

   ```cypher
   // Relationship expansion
   MATCH (n:Scope {uuid: $uuid})
   OPTIONAL MATCH (n)-[:CONSUMES*1..2]->(related)
   WITH n, collect(DISTINCT related) AS relatedList
   RETURN n, relatedList
   ```

3. **Vector Search Integration**
   ```cypher
   CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
   YIELD node, score
   WHERE score >= $minScore
   RETURN node, score
   ORDER BY score DESC
   LIMIT $topK
   ```

4. **Enrichment Clauses** (Config-driven)
   ```cypher
   OPTIONAL MATCH (n)-[:CONSUMES]->(consumes_dep)
   WITH n, collect(DISTINCT consumes_dep.name) AS consumes
   RETURN n, consumes
   ```

#### Parameter Safety

- All parameters use Neo4j parameterized queries
- Integer conversion for topK values: `neo4j.int(topKValue)`
- Proper type coercion for Neo4j types

#### Transaction Support

```typescript
// Read transaction
await client.readTransaction(async (tx) => {
  return await tx.run(cypher, params);
});

// Write transaction
await client.transaction(async (tx) => {
  return await tx.executeWrite(cypher, params);
});
```

---

### 2.4 Type-Safe API Generation

**File**: `packages/core/src/generator/code-generator.ts`

#### Generated Artifacts

The code generator produces:

1. **Query Builders** (one per entity)
   ```typescript
   export class ScopeQueries extends QueryBuilder<Scope> {
     constructor(client: Neo4jClient, context?: EntityContext) {
       super(client, 'Scope', undefined, context);
     }
   }
   ```

2. **Mutation Builders** (CRUD operations)
   ```typescript
   export class ScopeMutations extends MutationBuilder<Scope> {
     constructor(client: Neo4jClient) {
       super(client, {
         name: 'Scope',
         uniqueField: 'uuid',
         displayNameField: 'name'
       });
     }
   }
   ```

3. **Entity Types** (TypeScript interfaces)
   ```typescript
   export interface Scope {
     uuid: string;
     name: string;
     type: 'function' | 'class' | 'method' | ...;
     file: string;
     source: string;
     signature: string;
     [key: string]: any;
   }
   ```

4. **EntityContext** (Metadata for runtime)
   ```typescript
   export const scopeContext: EntityContext = {
     name: 'Scope',
     uniqueField: 'uuid',
     displayNameField: 'name',
     fields: [
       { name: 'uuid', type: 'string', indexed: true },
       { name: 'name', type: 'string' },
       { name: 'type', type: 'string' },
       // ...
     ],
     relationships: [
       { type: 'CONSUMES', target: 'Scope', direction: 'outgoing', enrich: true },
       { type: 'HAS_PARENT', target: 'Scope', direction: 'outgoing' },
       // ...
     ]
   };
   ```

5. **Client Factory**
   ```typescript
   export function createRagClient(config: RuntimeConfig) {
     return {
       scope: () => new ScopeQueries(client),
       file: () => new FileQueries(client),
       mutations: {
         scope: () => new ScopeMutations(client),
         file: () => new FileMutations(client)
       }
     };
   }
   ```

#### Configuration-Driven Generation

The generator reads from `ragforge.config.yaml`:

```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: text
      - name: source
        type: text
        vector_index: scopeEmbeddingsSource
      - name: signature
        type: text
    vector_indexes:
      - name: scopeEmbeddings
        model: gemini-embedding-001
        dimension: 768
    relationships:
      - type: CONSUMES
        target: Scope
        direction: outgoing
        enrich: true  # Include in results
```

---

## 3. AGENT & TOOL INTEGRATION

### 3.1 Iterative Code Agent

**File**: `packages/runtime/src/agent/iterative-code-agent.ts` (534 lines)

#### Architecture

```
User Question
    ↓
[Iteration 1-N Loop]
    ├→ generateQueryCode() [LLM generates Cypher/QueryBuilder code]
    ├→ executeCode() [Runs generated TypeScript with tsx]
    ├→ analyzeResults() [LLM evaluates if we have enough context]
    ├→ Decision: complete, expand, refine, or search?
    └→ Accumulate context (deduplicated by UUID)
    ↓
synthesizeAnswer() [LLM provides final answer]
    ↓
AgentResult (answer, context[], steps[], totalTime)
```

#### Key Capabilities

1. **XML-Structured Prompts**
   ```xml
   <response>
     <reasoning>Strategy explanation...</reasoning>
     <code>
       const results = await rag.scope()
         .semantic('query', { topK: 50 })
         .execute();
     </code>
   </response>
   ```

2. **Progressive Context Building**
   - First iteration: broad semantic search (topK: 50-100)
   - Subsequent: refine/expand based on previous results
   - Stores reasoning for context in next iteration

3. **Code Summarization**
   - Long code automatically summarized with LLM (300+ chars)
   - Summary oriented toward user question AND search intent
   - Keeps within context window limits

4. **Quality Assessment**
   ```typescript
   quality: 'excellent' | 'good' | 'insufficient' | 'irrelevant'
   nextAction: 'search' | 'expand' | 'refine' | 'complete'
   ```

5. **Execution Model**
   - Writes generated code to temp TypeScript file
   - Executes with `npx tsx`
   - Parses JSON output from console.log
   - Cleanup: removes temp files

#### Tool Calling Pattern (Current Implementation)

The agent doesn't use formal "tool calling" but rather:
- **Generates executable code** (TypeScript QueryBuilder calls)
- **Executes directly** via tsx process
- **Gets results back** as JSON
- **Analyzes and adapts** based on results

This is more like **code-as-interface** rather than strict tool calling.

#### Integration Points with External Tools

```typescript
interface AgentConfig {
  llm: LLMClient;              // Any LLM provider
  ragClientPath: string;       // Generated client module
  workDir: string;             // Temp file directory
  maxIterations?: number;      // Default: 5
  verbose?: boolean;
  frameworkDocs: string;       // Injected documentation
}
```

The agent is **LLM-agnostic** - accepts any `LLMClient { generate(prompt) }`.

---

## 4. LLM INTEGRATION

### 4.1 LLM Reranking

**File**: `packages/runtime/src/reranking/llm-reranker.ts`

#### Architecture

```typescript
class LLMReranker {
  // Configure default provider once
  static setDefaultProvider(provider: LLMProvider)
  
  // Create instance with options
  constructor(
    provider: LLMProvider,
    options?: LLMRerankOptions,
    entityContext?: EntityContext
  )
  
  // Main entry point
  async rerank(input: RerankInput): Promise<LLMRerankResult>
}
```

#### Reranking Options

```typescript
interface LLMRerankOptions {
  batchSize?: number;           // Scopes per request (default: 10)
  parallel?: number;            // Max concurrent requests (default: 5)
  minScore?: number;            // Minimum relevance (0.0-1.0)
  topK?: number;                // Max results to return
  withSuggestions?: boolean;    // Request query improvements
  scoreMerging?: 'weighted' | 'multiplicative' | 'llm-override';
  weights?: { vector: number; llm: number }; // For weighted merging
  debugPrompt?: boolean;        // Log generated prompts
  mockup?: boolean;             // Skip LLM, return mock results
  agentIntention?: string;      // Context from orchestrating agent
  metadataOverride?: (results, metadata) => any;
}
```

#### Supported Providers

1. **Vertex AI Provider** (`vertex-ai-provider.ts`)
   - Google Cloud Vertex AI
   - Streaming support
   - Project/location configuration

2. **Gemini API Provider** (`gemini-api-provider.ts`)
   - Direct Gemini API access
   - Model configuration
   - Rate limiting built-in

#### LLM Provider Interface

```typescript
interface LLMProvider {
  generateContent(prompt: string): Promise<string>;
  // Optional streaming for large batches
  streamContent?(prompt: string): AsyncIterator<string>;
}
```

#### Reranking Process

1. **Batch Results**
   - Groups results into configurable batch size (default: 10)
   - Parallel execution up to max concurrent (default: 5)

2. **Generate Prompt**
   - Context: entity type, schema, field definitions
   - Results: code snippet, relevance to question
   - Request: score (0-1) + reasoning

3. **Parse Response**
   - XML structure for reliability
   - Extract evaluations (scopeId, score, reasoning)
   - Extract query feedback if requested

4. **Score Merging**
   ```typescript
   // Weighted (default)
   finalScore = vectorScore * 0.3 + llmScore * 0.7
   
   // Multiplicative
   finalScore = vectorScore * llmScore
   
   // LLM override
   finalScore = llmScore
   ```

5. **Ranking & Limiting**
   - Sort by merged score (descending)
   - Apply minScore threshold
   - Limit to topK if specified

---

### 4.2 Query Feedback & Suggestions

The LLM reranker can provide improvement suggestions:

```typescript
interface QuerySuggestion {
  type: 'add_filter' | 'change_semantic' | 'expand_relationships' | 'other';
  description: string;
  exampleCode?: string;
}

interface QueryFeedback {
  quality: 'excellent' | 'good' | 'insufficient' | 'poor';
  suggestions: QuerySuggestion[];
}
```

This enables **self-improving queries** where the agent or user can apply suggestions.

---

## 5. DATA INGESTION

### 5.1 Code Source Adapter

**File**: `packages/runtime/src/adapters/code-source-adapter.ts` (1100 lines)

#### Parsing Pipeline

```
Source Code Files
    ↓ (globby pattern matching)
File Discovery
    ↓ (ParserRegistry)
Language-Specific Parsing
    ├→ TypeScriptLanguageParser
    ├→ PythonLanguageParser
    └→ Extracted: scopes, imports, references, signatures
    ↓
Build Global UUID Mapping
    ├→ Deterministic UUIDs (file + name + signature hash)
    ├→ Stable across ingestions (supports incremental updates)
    └→ Avoids UUID collisions for same-name scopes
    ↓
Create Relationship Graph
    ├→ Scope → Scope (CONSUMES, INHERITS_FROM)
    ├→ Scope → File (DEFINED_IN)
    ├→ Scope → Project (BELONGS_TO)
    └→ Cross-file imports resolved
    ↓
Neo4j Graph Nodes & Relationships
```

#### Key Features

1. **Entity Types Generated**
   - Project: root metadata
   - File: source files
   - Directory: file system structure
   - Scope: functions, classes, methods, variables
   - ExternalLibrary: third-party imports

2. **Relationship Types**
   - CONSUMES: dependency on another scope
   - INHERITS_FROM: class inheritance
   - IMPLEMENTS: interface implementation
   - HAS_PARENT: nested scope (method in class)
   - BELONGS_TO: ownership chain
   - DEFINED_IN: location in file
   - IN_DIRECTORY: file system hierarchy
   - USES_LIBRARY: external dependency

3. **Scope Metadata Extracted**
   - Type: function, class, method, interface, constant, variable
   - Signature: function signature with types
   - Source code (full body)
   - Line numbers (startLine, endLine)
   - Parameters with types
   - Return type (if applicable)
   - Modifiers: public, private, static, async, etc.
   - Heritage clauses: extends, implements
   - Generic parameters
   - Decorators
   - Docstrings/comments

4. **Language-Specific Metadata** (Phase 3)
   - TypeScript: generics, decorators, heritage clauses
   - Python: decorators, docstrings, class inheritance
   - Complexity metrics
   - Abstract/interface flags

5. **Import Resolution**
   - Reads tsconfig.json for path mappings
   - Resolves relative imports to absolute paths
   - Follows re-exports to find actual definitions
   - Tracks both local and external imports

#### UUID Generation

```typescript
// Deterministic: same scope = same UUID across runs
const deterministicInput = `${filePath}:${scope.name}:${scope.type}:${scope.startLine}`;
const uuid = UniqueIDHelper.GenerateDeterministicUUID(deterministicInput);

// Caching: avoids recalculation
fileCache.set(`${scope.name}:${scope.type}:${signatureHash}`, uuid);
```

#### Incremental Update Support

- Tracks scope hashes for change detection
- UUID stability enables entity identity preservation
- Not yet fully implemented (marked as TODO)

---

## 6. LIMITATIONS & INTEGRATION OPPORTUNITIES

### 6.1 Limitations

1. **Tool Calling**
   - No formal OpenAI tool_calling protocol support
   - Agent generates code instead of structured tool calls
   - Could integrate with Claude tool use or OpenAI function calling

2. **Embedding Management**
   - Single embedding per vector index
   - No batch regeneration pipeline
   - Manual triggers for embedding updates
   - No incremental embedding updates

3. **Multi-Turn Conversation**
   - Agent is stateless per query
   - No conversation memory/context
   - Each query restarts from scratch

4. **Relationship Constraints**
   - Hard-coded CONSUMES in vector search
   - Could be parameterized from config
   - Limited relationship context in semantic search

5. **Error Handling**
   - LLM API failures don't retry
   - Vector search timeouts not handled
   - Neo4j connection issues not gracefully degraded

6. **Performance**
   - No query caching
   - N+1 problems in some expansion scenarios
   - Batch operations not optimized for large datasets

7. **Schema Evolution**
   - Manual regeneration required after schema changes
   - No schema versioning
   - Breaking changes in generated code possible

### 6.2 Integration Points for External Libraries

#### 1. **Tool Calling Frameworks**
   - **Anthropic SDK**: Direct tool_use integration
   - **OpenAI Functions**: For GPT models
   - **LangChain**: Tool definitions and routing
   - **Llama Index**: Agent orchestration
   
   **Approach**: Wrap QueryBuilder operations as callable tools with schema

#### 2. **LLM Frameworks**
   - **LangChain**: Agent executors, memory, callbacks
   - **Llama Index**: Query engines, response synthesis
   - **Semantic Kernel**: Plugins, SK functions
   - **Ray Serve**: Scalable agent deployment
   
   **Approach**: Adapt LLMProvider interface to support multiple backends

#### 3. **Vector Store Integrations**
   - **Pinecone**: Managed vector DB
   - **Weaviate**: Vector search platform
   - **Milvus**: Open-source vector DB
   - **Qdrant**: Vector DB with filtering
   
   **Approach**: Abstract VectorSearch behind plugin interface

#### 4. **Knowledge Graph Tools**
   - **GraphQL APIs**: For complex traversals
   - **APOC Library**: Advanced Neo4j procedures
   - **Knowledge Graph Construction**: Automated extraction
   
   **Approach**: Generate APOC-based queries for complex operations

#### 5. **Structured Output**
   - **Pydantic Models**: Schema validation
   - **JSON Schema**: Formal schema definition
   - **Instructor**: Structured outputs from any LLM
   
   **Approach**: Generate JSON schemas for all entities, use for validation

#### 6. **Observability**
   - **Langsmith**: LLM debugging & tracing
   - **Arize**: LLM monitoring
   - **Weights & Biases**: Experiment tracking
   - **OpenTelemetry**: Distributed tracing
   
   **Approach**: Instrument QueryBuilder with telemetry hooks

#### 7. **Caching & Storage**
   - **Redis**: Query result caching
   - **DuckDB**: Local embedding cache
   - **SQLite**: Conversation history
   
   **Approach**: Add CacheProvider interface to QueryBuilder

#### 8. **Authentication & Secrets**
   - **Vault**: Secret management
   - **AWS Secrets Manager**: Cloud secrets
   - **1Password**: Credential storage
   
   **Approach**: Parameterize all credentials via environment/config

---

## 7. TYPE SAFETY & CODE GENERATION PATTERNS

### 7.1 Generated Entity Interfaces

```typescript
// Automatically generated based on Neo4j schema
export interface Scope {
  // Required fields (from database schema)
  uuid: string;
  name: string;
  type: ScopeType;
  file: string;
  startLine: number;
  endLine: number;
  
  // Optional enriched fields
  signature?: string;
  source?: string;
  hash?: string;
  consumes?: string[];  // From enrichment
  [key: string]: any;   // Other properties
}

export type ScopeType = 'function' | 'class' | 'method' | 
  'interface' | 'type' | 'constant' | 'variable' | ...;
```

### 7.2 EntityContext for Runtime Metadata

```typescript
export interface EntityContext {
  name: string;                    // Entity label
  uniqueField: string;             // UUID field
  displayNameField: string;        // Display field
  fields: EntityField[];           // All fields with metadata
  relationships: RelationshipConfig[]; // Relationships
}

export interface EntityField {
  name: string;
  type: string;
  indexed: boolean;
  description?: string;
  vectorIndex?: string;            // If searchable
}

export interface RelationshipConfig {
  type: string;                    // Relationship type
  target: string;                  // Target entity label
  direction: 'outgoing' | 'incoming' | 'both';
  enrich: boolean;                 // Include in results?
  enrich_field?: string;           // Field name for enrichment
}
```

### 7.3 Query Builder Type Safety

```typescript
// Generic over entity type T
class QueryBuilder<T = any> {
  where(filter: Record<string, FilterValue<any>>): this
  semantic(query: string, options: SemanticSearchOptions): this
  expand(relType: string, options: ExpandOptions): this
  executeFlat(): Promise<T[]>
  execute(): Promise<SearchResult<T>[]>
  executeWithMetadata(): Promise<SearchResultWithMetadata<T>>
}

// Usage
const results = await rag.scope<Scope>()
  .where({ type: 'function' })
  .semantic('parse tree')
  .execute();

// Type-safe iteration
results.forEach(r => {
  console.log(r.entity.name);      // ✓ type-safe
  console.log(r.score);             // ✓ always present
});
```

---

## 8. CONFIGURATION & CUSTOMIZATION

### 8.1 ragforge.config.yaml Structure

```yaml
name: my-project
version: 1.0.0

neo4j:
  uri: bolt://localhost:7687
  username: neo4j
  password: ${NEO4J_PASSWORD}
  database: neo4j

entities:
  - name: Scope
    searchable_fields:
      - name: source
        type: text
        vector_index: scopeEmbeddingsSource
    vector_indexes:
      - name: scopeEmbeddingsSource
        model: gemini-embedding-001
        dimension: 768
    relationships:
      - type: CONSUMES
        target: Scope
        direction: outgoing
        enrich: true
        enrich_field: consumes

embeddings:
  provider: gemini
  model: gemini-embedding-001
  batch_size: 100

reranking:
  provider: vertex-ai
  model: gemini-pro

summarization_strategies:
  code-analysis:
    system_prompt: "Summarize this code..."
    output_schema:
      root: summary
      fields:
        - name: summary
          type: string

source:
  type: code
  adapter: typescript
  root: ./src
  include:
    - '**/*.ts'
  exclude:
    - '**/*.test.ts'
```

### 8.2 Runtime Configuration

```typescript
interface RuntimeConfig {
  neo4j: Neo4jConfig;
  // Query execution
  enrichment?: RelationshipConfig[];
  // Optional LLM configuration
  llm?: {
    provider: string;
    model: string;
    apiKey?: string;
  };
  // Optional vector config
  vectorDefaults?: {
    topK?: number;
    minScore?: number;
  };
}
```

---

## 9. MUTATION & WRITE OPERATIONS

### 9.1 Mutation Builder

**File**: `packages/runtime/src/mutations/mutation-builder.ts`

#### Supported Operations

```typescript
class MutationBuilder<T> {
  // Create single entity
  async create(data: Partial<T>): Promise<T>
  
  // Batch create
  async createMany(items: Partial<T>[]): Promise<T[]>
  
  // Update by ID
  async update(id: string, updates: Partial<T>): Promise<T>
  
  // Update many
  async updateMany(updates: Array<{id: string; data: Partial<T>}>): Promise<T[]>
  
  // Delete by ID
  async delete(id: string): Promise<boolean>
  
  // Delete many
  async deleteMany(ids: string[]): Promise<number>
  
  // Relationship operations
  async addRelationship(entityId: string, config: AddRelationshipConfig): Promise<void>
  async removeRelationship(entityId: string, config: RemoveRelationshipConfig): Promise<void>
}
```

#### Cypher Generation

```typescript
// Create
CREATE (n:Entity { ...properties })
RETURN n

// Update
MATCH (n:Entity { uniqueField: $id })
SET n += $updates
RETURN n

// Delete
MATCH (n:Entity { uniqueField: $id })
DELETE n
RETURN true

// Add relationship
MATCH (source:SourceType { uniqueField: $sourceId })
MATCH (target:TargetType { uniqueField: $targetId })
CREATE (source)-[r:RelType $props]->(target)
RETURN r
```

---

## 10. SUMMARY: ARCHITECTURE STRENGTHS

### ✓ Strengths

1. **Type Safety**: Full TypeScript generation from schema
2. **Composable Operations**: Pipeline-based query builder
3. **Flexible Search**: Semantic + structural + LLM reranking
4. **Code-Native**: Purpose-built for code analysis
5. **Intelligent Parsing**: Extracts language-specific metadata
6. **Deterministic IDs**: Stable UUIDs for incremental updates
7. **Production Ready**: Error handling, transactions, pooling
8. **Extensible**: Plugin interfaces for LLM, vector stores, reranking
9. **Well-Documented**: Generated documentation and examples
10. **Agent-Ready**: Iterative agent for progressive context building

### ⚠ Considerations

1. **Neo4j-Specific**: Not portable to other graph DBs
2. **Agent Code Generation**: Requires code execution (security implications)
3. **LLM Dependency**: Quality depends heavily on LLM choice
4. **No Multi-Turn State**: Each agent query is independent
5. **Limited Relationship Context**: Vector search doesn't leverage full graph

### 🎯 Best For

- Code analysis and understanding
- Documentation generation
- Architecture exploration
- Technical debt analysis
- Refactoring support
- Integration with agent frameworks

