# Tool Generation Architecture Vision

**Date**: 2025-11-18
**Status**: PROPOSAL
**Priority**: HIGH
**Context**: Agent tool calling system needs systematic tool generation from config

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Core Proposal: generateToolsFromConfig](#core-proposal-generatetoolsfromconfig)
4. [Integration with ragforge generate](#integration-with-ragforge-generate)
5. [Generic vs Custom Tools](#generic-vs-custom-tools)
6. [Computed Fields Solution](#computed-fields-solution)
7. [Advanced Tool Types](#advanced-tool-types)
8. [Implementation Roadmap](#implementation-roadmap)
9. [API Reference](#api-reference)
10. [Examples](#examples)

---

## Executive Summary

### The Vision

Create a **systematic, config-driven tool generation system** that:

1. **Automatically generates database query tools** from `ragforge.config.yaml` during `ragforge generate`
2. **Exposes complete entity schema** in tool descriptions:
   - All searchable fields with types and descriptions
   - Unique identifiers for each entity type
   - Available relationships with directions and entity mappings
   - Vector indexes and what fields they cover
3. **Supports computed/derived fields** defined in config (e.g., `line_count = endLine - startLine`)
4. **Separates concerns**:
   - **Generic tools**: Auto-generated from config (query_entities, semantic_search, etc.)
   - **Custom tools**: Client-specific logic coded in generated client (line_count calculator from source, domain logic, etc.)
5. **Provides runtime function** `generateToolsFromConfig(config)` for dynamic tool creation

### Key Benefits

- **Better Agent Performance**: Agents know exactly what fields exist, what unique identifiers to use, what relationships are available, and what operations are possible
- **Complete Schema Awareness**: Tools expose searchable fields, unique identifiers, relationships (with directions and entity mappings), and vector indexes
- **Zero Boilerplate**: Tools auto-generated, no manual coding needed
- **Type Safety**: Generated tools match config schema
- **Extensibility**: Easy to add custom tools alongside generated ones
- **Consistency**: Same tool generation logic for all RagForge projects

---

## Current State Analysis

### What Works

**File**: `ragforge/examples/tool-calling-agent/database-tools-generator.ts`

Current implementation generates 4 tools:
- `query_entities`: Flexible WHERE/ORDER BY queries
- `semantic_search`: Vector similarity search
- `explore_relationships`: Graph traversal
- `get_entity_by_id`: Direct entity lookup

**Strengths**:
- ✅ Reads config to get entity names
- ✅ Dynamic enums based on config (entity types, relationships)
- ✅ Proper JSON Schema for tool parameters
- ✅ Clean separation of tool definitions and handlers

### Critical Gaps

#### 1. Searchable Fields Not Exposed

**Current tool description** (lines 43-50):
```typescript
description: `Query entities from the database with flexible conditions.

Available entities: ${entityNames.join(', ')}

Each entity has different unique fields:
${entityMetadata.map((e: any) => `- ${e.name}: ${e.unique_field}`).join('\n')}

Returns matching entities with their properties.`
```

**What's missing**:
- No detailed list of `searchable_fields` per entity with types and descriptions
- Unique fields listed but not integrated with field documentation
- Relationships listed but no information about entity type mappings or directions
- No mention of `order_by` capability
- Agent doesn't know what fields exist on Scope, File, etc.

**Impact**:
```
User: "What are the most complex classes?"
Agent: "I need clarification - what field should I use to measure complexity?"
```

Agent is **correct** to ask because it doesn't know about `line_count`, `startLine`, `endLine`, etc.

#### 2. No Computed Fields Support

**Config defines searchable_fields**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string
      - name: file
        type: string
      - name: source
        type: string
```

**But NOT**:
- `line_count` (computed from `endLine - startLine`)
- `complexity_score` (computed from metrics)
- `age_days` (computed from `created_at`)

These exist in Neo4j context queries but aren't exposed as searchable/orderable fields.

#### 3. Manual Integration

Currently:
- Tools manually coded in `database-tools-generator.ts`
- Not integrated with `ragforge generate` command
- Duplicates entity metadata extraction logic
- No generated client exports for tools

#### 4. No Specialized Query Tools

Agent has only 4 generic tools. Missing:
- Date range queries (`created_after`, `modified_before`)
- Numeric range queries (`line_count_between`)
- Pattern matching queries (`name_matches_regex`)
- Aggregation queries (`count_by_type`, `average_complexity`)
- Full-text search (if using Neo4j full-text indexes)

---

## Core Proposal: generateToolsFromConfig

### Function Signature

```typescript
/**
 * Generate database query tools from RagForge config
 *
 * @param config - RagForge configuration (parsed YAML or loaded config object)
 * @param options - Customization options
 * @returns Tool definitions and handlers ready for ToolRegistry
 */
export function generateToolsFromConfig(
  config: RagForgeConfig,
  options?: ToolGenerationOptions
): GeneratedTools;

interface ToolGenerationOptions {
  /** Include semantic search tools (requires vector_indexes in config) */
  includeSemanticSearch?: boolean; // default: true

  /** Include relationship traversal tools */
  includeRelationships?: boolean; // default: true

  /** Include specialized query tools (date ranges, numeric ranges, etc.) */
  includeSpecializedTools?: boolean; // default: true

  /** Include aggregation tools (count, sum, avg, etc.) */
  includeAggregations?: boolean; // default: false

  /** Custom tool templates (for extending/overriding defaults) */
  customTemplates?: ToolTemplate[];

  /** Expose raw Cypher execution (DANGER: use only in trusted environments) */
  allowRawCypher?: boolean; // default: false
}

interface GeneratedTools {
  /** Tool definitions with inputSchema for ToolRegistry */
  tools: ToolDefinition[];

  /** Handler functions for each tool */
  handlers: Record<string, ToolHandler>;

  /** Metadata about what was generated */
  metadata: {
    entityCount: number;
    toolCount: number;
    searchableFieldsCount: number;
    computedFieldsCount: number;
  };
}
```

### Core Tools Generated

#### 1. query_entities (Enhanced)

**Current vs Enhanced**:

```typescript
// CURRENT
description: `Query entities from the database with flexible conditions.
Available entities: Scope, File, Directory`

// ENHANCED
description: `Query entities from the database with flexible conditions.

Available entities: Scope, File, Directory

Entity unique identifiers:
- Scope: uuid (string)
- File: path (string)
- Directory: path (string)

Searchable/Orderable fields per entity:
- Scope:
  * uuid (string) - Unique identifier [UNIQUE FIELD]
  * name (string) - Scope identifier
  * file (string) - Source file path
  * type (string) - Scope type (class, function, etc.)
  * source (string) - Full source code
  * startLine (number) - Start line in file
  * endLine (number) - End line in file
  * line_count (computed: number) - Lines of code (endLine - startLine)
  * modified_at (computed: timestamp) - Last modification time (from change tracking)
  * change_count (computed: number) - Number of modifications
  * age_days (computed: number) - Days since last modification

- File:
  * path (string) - File path [UNIQUE FIELD]
  * extension (string) - File extension
  * size (number) - File size in bytes
  * modified_at (computed: timestamp) - Last modification time (from change tracking)
  * change_count (computed: number) - Number of modifications

- Directory:
  * path (string) - Directory path [UNIQUE FIELD]
  * name (string) - Directory name

Operators: =, !=, >, >=, <, <=, CONTAINS, STARTS WITH, ENDS WITH, IN

You can ORDER BY any searchable field (ASC or DESC).`
```

**Key improvements**:
- Lists all searchable fields per entity with types and descriptions
- **Clearly identifies unique fields** for each entity type
- Clearly identifies computed fields
- Mentions ORDER BY capability
- Documents available operators

#### 2. semantic_search (Enhanced)

**Enhanced description with unique fields**:

```typescript
description: `Semantic search using vector similarity.

Available vector indexes:
- Scope.source_embeddings (field: source) - Search by code content
- Scope.name_embeddings (field: name) - Search by scope names

Entity unique identifiers (for results):
- Scope: uuid (string)

Results include:
- Unique identifier (for fetching full entity later)
- Match score
- Snippet from matched field

Best for natural language queries about entity content.`
```

**Key improvements**:
- Documents which vector indexes exist
- Shows what field each index covers
- **Specifies unique identifier returned in results**
- Explains result structure

#### 3. explore_relationships (Enhanced)

**Enhanced description with relationship mappings**:

```typescript
description: `Follow relationships between entities.

Available relationships (with directions and entity types):

- CONTAINS:
  * File --[CONTAINS]--> Scope (outgoing from File)
  * Directory --[CONTAINS]--> File (outgoing from Directory)
  * Scope --[CONTAINS]--> Scope (nested scopes)

- DEPENDS_ON:
  * Scope --[DEPENDS_ON]--> Scope (code dependencies)
  * Scope --[DEPENDS_ON]--> ExternalLibrary (external deps)

- IMPORTS:
  * File --[IMPORTS]--> File (file imports)

- CALLS:
  * Scope --[CALLS]--> Scope (function calls)

Entity unique identifiers:
- Scope: uuid
- File: path
- Directory: path
- ExternalLibrary: name

Navigate the graph to find connected entities.
Use 'outgoing' for forward direction, 'incoming' for reverse, 'both' for bidirectional.`
```

**Key improvements**:
- **Lists all relationships with source → target entity types**
- Shows available directions for each relationship
- **Documents unique identifiers for all entity types involved**
- Explains how to use directions

#### 4. get_entity_by_id (Enhanced)

**Enhanced description**:

```typescript
description: `Get full entity details by unique identifier.

Entity unique identifiers:
- Scope: uuid (string) - UUID assigned during ingestion
- File: path (string) - Absolute file path
- Directory: path (string) - Absolute directory path
- ExternalLibrary: name (string) - Library name (e.g., "react", "lodash")

Use this when you have a unique identifier from another query result.
Returns complete entity with all properties.`
```

**Key improvements**:
- **Documents unique field for EVERY entity type**
- Provides examples of identifier formats
- Explains when to use this tool

#### 5. Specialized Tools (New)

**Generated based on field types in config**:

```typescript
// For entities with timestamp fields
{
  name: 'query_entities_by_date_range',
  description: `Query entities created/modified within a date range.

  Available date fields:
  - Scope: modified_at (computed from change tracking)
  - File: modified_at (computed from change tracking)

  Use this to find recently changed code or track development activity.`,

  inputSchema: {
    entity_type: 'Scope',
    date_field: 'modified_at',
    after: '7 days ago',        // ISO 8601 or relative like '7 days ago'
    before: 'now',
    limit: 10
  }
}

// For entities with numeric fields
{
  name: 'query_entities_by_number_range',
  description: `Query entities with numeric fields in a range.

  Available numeric fields:
  - Scope: startLine, endLine, line_count (computed)
  - File: size`,

  inputSchema: {
    entity_type: 'Scope',
    field: 'line_count',
    min: 100,                   // Minimum value (inclusive)
    max: 500,                   // Maximum value (inclusive)
    order_by: 'DESC',           // Order by the same field
    limit: 20
  }
}

// For entities with string fields
{
  name: 'query_entities_by_pattern',
  description: `Query entities matching regex or glob patterns.

  Pattern types:
  - regex: Full regex support
  - glob: Shell-style wildcards (*, ?, [])
  - fuzzy: Levenshtein distance matching`,

  inputSchema: {
    entity_type: 'Scope',
    field: 'name',
    pattern: '.*Service$',      // Regex pattern
    pattern_type: 'regex',      // regex | glob | fuzzy
    limit: 10
  }
}
```

#### 3. Aggregation Tools (Optional)

**Generated when `includeAggregations: true`**:

```typescript
{
  name: 'aggregate_entities',
  description: `Aggregate statistics across entities.

  Available aggregations:
  - COUNT: Count matching entities
  - AVG: Average of numeric field
  - SUM: Sum of numeric field
  - MIN/MAX: Min/max of numeric field
  - GROUP_BY: Group by field and count`,

  inputSchema: {
    entity_type: 'Scope',
    aggregation: 'AVG',
    field: 'line_count',
    conditions: [...],          // Optional WHERE conditions
    group_by: 'type'            // Optional grouping
  }
}

// Example result:
{
  aggregation: 'AVG',
  field: 'line_count',
  value: 42.5,
  count: 120,
  groups: [
    { type: 'class', avg: 85.3, count: 30 },
    { type: 'function', avg: 12.1, count: 90 }
  ]
}
```

---

## Integration with ragforge generate

### Current Code Generation Flow

**File**: `ragforge/packages/core/src/generator/code-generator.ts`

Currently generates:
- Query builders per entity
- Main client class
- Type definitions
- Example scripts
- Documentation

**Proposal**: Add tool generation to this flow.

### Enhanced Generation Flow

```
ragforge generate
  ├─ Load config (ragforge.config.yaml)
  ├─ Introspect Neo4j schema
  ├─ Generate query builders (existing)
  ├─ Generate main client (existing)
  ├─ Generate types (existing)
  ├─ 🆕 Generate database tools
  │   ├─ tools/database-tools.ts        ← Generated tools
  │   ├─ tools/custom-tools.ts          ← Template for custom tools
  │   └─ tools/index.ts                 ← Tool registry setup
  ├─ Generate examples (existing)
  └─ Generate documentation (existing)
```

### Generated Structure

```
generated-client/
├─ queries/
│  ├─ scope.ts
│  ├─ file.ts
│  └─ ...
├─ tools/                           ← NEW
│  ├─ database-tools.ts             ← Auto-generated from config
│  │   // DO NOT EDIT - Regenerated on `ragforge generate`
│  │   export const databaseTools = [...];
│  │   export const databaseHandlers = {...};
│  │
│  ├─ custom-tools.ts               ← User-editable custom tools
│  │   // Add your custom tools here
│  │   // These are preserved across regeneration
│  │   export const customTools = [...];
│  │   export const customHandlers = {...};
│  │
│  └─ index.ts                      ← Combines all tools
│      import { databaseTools, databaseHandlers } from './database-tools.js';
│      import { customTools, customHandlers } from './custom-tools.js';
│
│      export function setupToolRegistry(rag: RagClient): ToolRegistry {
│        const registry = new ToolRegistry();
│
│        // Register database tools
│        for (const tool of databaseTools) {
│          registry.register({
│            ...tool,
│            execute: databaseHandlers[tool.name]
│          });
│        }
│
│        // Register custom tools
│        for (const tool of customTools) {
│          registry.register({
│            ...tool,
│            execute: customHandlers[tool.name]
│          });
│        }
│
│        return registry;
│      }
│
├─ client.ts
├─ types.ts
└─ index.ts
```

### Code Generator Changes

**Add to `GeneratedCode` interface**:

```typescript
export interface GeneratedCode {
  // ... existing properties ...

  tools?: {
    databaseTools: string;      // Generated database tools
    customToolsTemplate: string; // Template for custom tools
    toolsIndex: string;         // Tool registry setup
  };
}
```

**Add to `CodeGenerator` class**:

```typescript
export class CodeGenerator {
  // ... existing methods ...

  /**
   * Generate database tools from config
   */
  static generateDatabaseTools(
    config: RagForgeConfig,
    schema: GraphSchema
  ): string {
    const template = loadTemplate('tools/database-tools.ts.template');

    // Extract searchable fields (including computed)
    const entityFields = config.entities.map(entity => {
      const searchableFields = [
        ...(entity.searchable_fields || []),
        ...(entity.computed_fields || [])
      ];

      return {
        name: entity.name,
        uniqueField: entity.unique_field || 'uuid',
        searchableFields,
        vectorIndexes: entity.vector_indexes || [],
        relationships: entity.relationships || []
      };
    });

    // Generate tool descriptions with field documentation
    const toolDescriptions = this.generateToolDescriptions(entityFields);

    // Generate tool schemas with proper types
    const toolSchemas = this.generateToolSchemas(entityFields);

    // Generate handlers
    const toolHandlers = this.generateToolHandlers(entityFields);

    return template
      .replace('{{TOOL_DESCRIPTIONS}}', toolDescriptions)
      .replace('{{TOOL_SCHEMAS}}', toolSchemas)
      .replace('{{TOOL_HANDLERS}}', toolHandlers);
  }

  /**
   * Generate tool descriptions with searchable fields
   */
  private static generateToolDescriptions(
    entityFields: EntityFieldInfo[]
  ): string {
    const fieldDocs = entityFields.map(entity => {
      const fields = entity.searchableFields.map(field => {
        const computedTag = field.computed ? ' (computed)' : '';
        return `  * ${field.name}${computedTag} (${field.type}) - ${field.description || ''}`;
      }).join('\n');

      return `- ${entity.name}:\n${fields}`;
    }).join('\n\n');

    return `Query entities from the database with flexible conditions.

Available entities: ${entityFields.map(e => e.name).join(', ')}

Searchable/Orderable fields per entity:
${fieldDocs}

Operators: =, !=, >, >=, <, <=, CONTAINS, STARTS WITH, ENDS WITH, IN

You can ORDER BY any searchable field (ASC or DESC).`;
  }
}
```

---

## Generic vs Custom Tools

### Architecture Principle

**Clear separation between what's config-driven and what's client-specific.**

### Generic Tools (Auto-Generated)

**Source**: `ragforge.config.yaml` → Auto-generated during `ragforge generate`

**Characteristics**:
- ✅ Generated from config schema
- ✅ Regenerated on every `ragforge generate`
- ✅ Consistent across all RagForge projects
- ✅ Type-safe based on config
- ❌ Cannot be customized (overridden by config changes)

**Examples**:
```typescript
// All in generated-client/tools/database-tools.ts
- query_entities              // WHERE/ORDER BY queries
- semantic_search             // Vector search
- explore_relationships       // Graph traversal
- get_entity_by_id            // Direct lookup
- query_entities_by_date_range // Date filters (if timestamps in config)
- query_entities_by_number_range // Numeric filters (if numbers in config)
- query_entities_by_pattern   // Regex/glob matching
- aggregate_entities          // COUNT/AVG/SUM (if enabled)
```

**When a field is added to config**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: complexity_score  # NEW FIELD
        type: number
```

**After `ragforge generate`**:
- `query_entities` description auto-updates to include `complexity_score`
- `query_entities_by_number_range` automatically supports filtering by `complexity_score`
- Agent immediately knows about the new field

### Custom Tools (User-Coded)

**Source**: `generated-client/tools/custom-tools.ts` → User writes code

**Characteristics**:
- ✅ User-written business logic
- ✅ Preserved across `ragforge generate` runs
- ✅ Can use generated client for queries
- ✅ Domain-specific operations
- ✅ Can combine multiple queries

**Examples**:

#### Example 1: Line Count Calculator (Source-Based)

```typescript
// generated-client/tools/custom-tools.ts

import type { RagClient } from '../client.js';
import type { Tool, ToolHandler } from '@luciformresearch/ragforge-runtime';

/**
 * Custom tool: Calculate exact line count from source code
 * (More accurate than endLine - startLine which includes comments/whitespace)
 */
export const customTools: Tool[] = [
  {
    name: 'calculate_actual_line_count',
    description: `Calculate actual lines of code (excluding comments and whitespace).

    Returns more accurate complexity metrics than simple line count.`,
    inputSchema: {
      type: 'object',
      properties: {
        scope_name: {
          type: 'string',
          description: 'Name of the scope (class/function)'
        }
      },
      required: ['scope_name']
    }
  }
];

export function createCustomHandlers(rag: RagClient): Record<string, ToolHandler> {
  return {
    async calculate_actual_line_count(params: any) {
      const { scope_name } = params;

      // Use generated client to fetch scope
      const scopes = await rag.get('Scope')
        .where('name', '=', scope_name)
        .limit(1)
        .execute();

      if (scopes.length === 0) {
        return { error: `Scope not found: ${scope_name}` };
      }

      const scope = scopes[0];
      const source = scope.source;

      // Custom logic: Count non-empty, non-comment lines
      const lines = source.split('\n');
      const codeLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 &&
               !trimmed.startsWith('//') &&
               !trimmed.startsWith('/*') &&
               !trimmed.startsWith('*');
      });

      return {
        scope_name,
        simple_line_count: scope.endLine - scope.startLine,
        actual_line_count: codeLines.length,
        comment_ratio: ((lines.length - codeLines.length) / lines.length * 100).toFixed(1) + '%'
      };
    }
  };
}
```

#### Example 2: Complexity Analysis (Multi-Query)

```typescript
{
  name: 'analyze_scope_complexity',
  description: `Comprehensive complexity analysis combining multiple metrics.

  Returns: line count, cyclomatic complexity, dependency count, etc.`,
  inputSchema: {
    type: 'object',
    properties: {
      scope_name: { type: 'string' }
    },
    required: ['scope_name']
  }
}

// Handler
async analyze_scope_complexity(params: any) {
  const { scope_name } = params;

  // 1. Get scope
  const scope = await rag.get('Scope')
    .where('name', '=', scope_name)
    .limit(1)
    .execute();

  if (!scope[0]) return { error: 'Not found' };

  // 2. Get dependencies
  const dependencies = await rag.get('Scope')
    .where('name', '=', scope_name)
    .getRelationship('DEPENDS_ON', 'outgoing', 'Scope')
    .execute();

  // 3. Get dependents
  const dependents = await rag.get('Scope')
    .where('name', '=', scope_name)
    .getRelationship('DEPENDS_ON', 'incoming', 'Scope')
    .execute();

  // 4. Calculate metrics
  return {
    scope_name,
    file: scope[0].file,
    line_count: scope[0].endLine - scope[0].startLine,
    dependency_count: dependencies.length,
    dependent_count: dependents.length,
    coupling_score: dependencies.length + dependents.length,
    complexity_category: /* ... custom logic ... */
  };
}
```

#### Example 3: Domain-Specific Queries

```typescript
// For a product catalog RAG system:
{
  name: 'find_products_in_price_range_with_discount',
  description: `Find products with special pricing rules.

  Custom business logic for promotional pricing.`,
  // ... implementation uses generated client
}

// For a document RAG system:
{
  name: 'find_related_documents_by_topic_hierarchy',
  description: `Navigate topic taxonomy to find related documents.

  Uses custom topic hierarchy logic.`,
  // ... implementation
}
```

### When to Use Which

| Scenario | Generic Tool | Custom Tool |
|----------|--------------|-------------|
| Query by field in config | ✅ `query_entities` | ❌ |
| Date/number range queries | ✅ Auto-generated specialized tools | ❌ |
| Semantic search | ✅ `semantic_search` | ❌ |
| Calculate from source code | ❌ | ✅ Custom logic needed |
| Multi-step business logic | ❌ | ✅ Combine queries |
| Domain-specific rules | ❌ | ✅ Business logic |
| Aggregations (simple) | ✅ `aggregate_entities` | ❌ |
| Aggregations (complex) | ❌ | ✅ Custom calculations |

---

## Computed Fields Solution

### Problem Statement

**Scenario**: Agent asked "What are the most complex classes?"

**Current state**:
- `startLine` and `endLine` exist in Neo4j (from ingestion)
- But NOT in `searchable_fields` in config
- Agent can't query or order by line count

**What we need**:
- `line_count` as a **computed field** in the config
- Automatically exposed in tool descriptions
- Queryable and orderable just like regular fields

### Config Schema Extension

**Add `computed_fields` to entity config**:

```yaml
entities:
  - name: Scope
    unique_field: uuid

    searchable_fields:
      - name: name
        type: string
      - name: file
        type: string
      - name: type
        type: string
      - name: startLine
        type: number
      - name: endLine
        type: number

    # NEW: Computed fields
    computed_fields:
      - name: line_count
        type: number
        description: "Lines of code in this scope"
        expression: "endLine - startLine"
        # OR for complex logic:
        # cypher: "RETURN n.endLine - n.startLine AS line_count"

      - name: modified_at
        type: timestamp
        description: "Last modification timestamp (from change tracking)"
        cypher: |
          OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change)
          WITH n, c
          ORDER BY c.timestamp DESC
          LIMIT 1
          RETURN c.timestamp AS modified_at
        # Uses existing Change tracking system
        # Returns null if never modified

      - name: change_count
        type: number
        description: "Number of times this scope was modified"
        cypher: |
          OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change)
          RETURN count(c) AS change_count

      - name: age_days
        type: number
        description: "Days since scope was last modified"
        cypher: |
          OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change)
          WITH n, c
          ORDER BY c.timestamp DESC
          LIMIT 1
          RETURN duration.between(c.timestamp, datetime()).days AS age_days

      - name: is_large
        type: boolean
        description: "Whether scope has >100 lines"
        expression: "line_count > 100"
        # Can reference other computed fields
```

### Implementation Strategies

#### Strategy 1: Runtime Computation (Simple)

**When**: `query_entities` with `order_by: { field: 'line_count' }`

**How**: Modify generated Cypher to include computation:

```typescript
// Before (current)
const cypher = `
  MATCH (n:Scope)
  WHERE n.name CONTAINS 'Service'
  RETURN n
  ORDER BY n.name ASC
  LIMIT 10
`;

// After (with computed field)
const cypher = `
  MATCH (n:Scope)
  WHERE n.name CONTAINS 'Service'
  WITH n, (n.endLine - n.startLine) AS line_count
  RETURN n, line_count
  ORDER BY line_count DESC
  LIMIT 10
`;
```

**Pros**:
- ✅ No schema changes
- ✅ Always up-to-date
- ✅ Simple to implement

**Cons**:
- ❌ Computed on every query (performance)
- ❌ Can't create indexes on computed fields

#### Strategy 2: Materialized Fields (Advanced)

**When**: Computed field used frequently or needs indexing

**How**: Store computed value in Neo4j as property:

```typescript
// During ingestion or migration
MATCH (n:Scope)
SET n.line_count = n.endLine - n.startLine
```

**Config indicates materialized**:
```yaml
computed_fields:
  - name: line_count
    type: number
    expression: "endLine - startLine"
    materialized: true  # Store as property
    index: true         # Create index for fast ORDER BY
```

**Pros**:
- ✅ Fast queries (no runtime computation)
- ✅ Can create indexes
- ✅ Supports complex aggregations

**Cons**:
- ❌ Must update on data changes
- ❌ More storage space
- ❌ Requires migration scripts

#### Strategy 3: Hybrid (Recommended)

**Config**:
```yaml
computed_fields:
  - name: line_count
    type: number
    expression: "endLine - startLine"
    materialized: auto  # Auto-materialize if used in ORDER BY often
```

**How**:
1. Initially compute at runtime
2. Track query patterns (telemetry)
3. If `ORDER BY line_count` used frequently → auto-materialize
4. Provide CLI command: `ragforge materialize-field Scope.line_count`

### Tool Description Integration

**With computed fields in config**:

```typescript
description: `Query entities from the database.

Available entities: Scope, File

Searchable fields:
- Scope:
  * name (string) - Scope identifier
  * file (string) - Source file path
  * startLine (number) - Start line
  * endLine (number) - End line
  * line_count (computed: number) - Lines of code (endLine - startLine) 🔢
  * age_days (computed: number) - Days since created 🔢

🔢 = Computed field (calculated from other fields)

All fields (including computed) are queryable and orderable.`
```

### Type System

**Generated types include computed fields**:

```typescript
// generated-client/types.ts

export interface Scope {
  // Regular fields
  uuid: string;
  name: string;
  file: string;
  startLine: number;
  endLine: number;

  // Computed fields (marked as such)
  readonly line_count: number;  // readonly = computed
  readonly age_days: number;
}

// Schema metadata
export const ScopeSchema = {
  entity: 'Scope',
  fields: [
    { name: 'name', type: 'string', computed: false },
    { name: 'line_count', type: 'number', computed: true, expression: 'endLine - startLine' }
  ]
};
```

---

## Advanced Tool Types

### Beyond Basic Queries

Here are additional tool types that could be auto-generated based on config.

### 1. Full-Text Search Tools

**When**: Entity has `full_text_index` in config

**Config**:
```yaml
entities:
  - name: Scope
    full_text_index:
      name: scope_fulltext
      fields: [name, source]
      analyzer: english  # Tokenization, stemming
```

**Generated Tool**:
```typescript
{
  name: 'fulltext_search_scope',
  description: `Full-text search across Scope entities.

  Uses Neo4j full-text index for fuzzy matching, stemming, etc.
  Better than CONTAINS for natural language queries.`,

  inputSchema: {
    entity_type: 'Scope',
    query: 'authentication service',
    fields: ['name', 'source'],  // Which fields to search
    fuzzy: true,                 // Allow typos
    min_score: 0.5
  }
}

// Handler uses Neo4j full-text index
CALL db.index.fulltext.queryNodes('scope_fulltext', 'authentication~')
YIELD node, score
```

### 2. Graph Analytics Tools

**When**: Config has `analytics: true`

**Generated Tools**:
```typescript
// PageRank for importance
{
  name: 'find_important_scopes',
  description: `Find most important scopes using PageRank algorithm.

  Analyzes DEPENDS_ON relationships to find central/influential code.`,
  inputSchema: { limit: 10 }
}

// Community detection
{
  name: 'find_scope_clusters',
  description: `Group scopes into modules/clusters based on dependencies.

  Uses Louvain algorithm for community detection.`,
  inputSchema: { min_cluster_size: 5 }
}

// Shortest path
{
  name: 'find_dependency_path',
  description: `Find shortest dependency path between two scopes.`,
  inputSchema: {
    from_scope: 'AuthService',
    to_scope: 'DatabaseClient'
  }
}
```

**Uses Neo4j GDS (Graph Data Science)**:
```cypher
CALL gds.pageRank.stream('dependency_graph')
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).name AS scope, score
ORDER BY score DESC
```

### 3. Temporal Query Tools

**When**: Entities have `created_at`, `updated_at` or custom timestamp fields

**Generated Tools**:
```typescript
{
  name: 'find_recently_changed_scopes',
  description: `Find scopes modified recently.

  Useful for tracking code churn and recent development.`,

  inputSchema: {
    since: '7 days ago',  // Natural language OR ISO timestamp
    entity_type: 'Scope',
    order_by: 'updated_at DESC'
  }
}

{
  name: 'analyze_code_churn',
  description: `Analyze how often scopes change over time.

  Returns change frequency metrics.`,

  inputSchema: {
    scope_name: 'AuthService',
    time_window: '30 days'
  }

  // Returns: { changes_count, avg_time_between_changes, last_changed }
}
```

### 4. Geospatial Tools (for non-code RAG)

**When**: Config has `geospatial_fields`

**Example for stores/locations RAG**:
```yaml
entities:
  - name: Store
    searchable_fields:
      - name: location
        type: point  # Neo4j Point type
```

**Generated Tool**:
```typescript
{
  name: 'find_stores_near_location',
  description: `Find stores within distance of coordinates.`,
  inputSchema: {
    latitude: 37.7749,
    longitude: -122.4194,
    radius_km: 10,
    limit: 20
  }
}

// Uses Neo4j spatial functions
MATCH (s:Store)
WHERE point.distance(s.location, point({latitude: $lat, longitude: $lon})) < $radius * 1000
```

### 5. Multi-Entity Join Tools

**When**: Relationships exist between entities

**Generated Tool**:
```typescript
{
  name: 'join_entities',
  description: `Join multiple entity types via relationships.

  Example: Find all Scopes in Files modified in last week.`,

  inputSchema: {
    entities: [
      { type: 'File', conditions: [{field: 'modified_at', operator: '>', value: '7d ago'}] },
      { type: 'Scope', relationship: 'CONTAINS', direction: 'incoming' }
    ],
    limit: 20
  }
}

// Generates complex multi-hop Cypher
MATCH (f:File)-[:CONTAINS]->(s:Scope)
WHERE f.modified_at > datetime() - duration('P7D')
RETURN s
```

### 6. Recommendation Tools

**When**: Config has `recommendations: true`

**Generated Tool**:
```typescript
{
  name: 'recommend_similar_scopes',
  description: `Find scopes similar to given scope.

  Uses vector similarity + graph structure.`,

  inputSchema: {
    scope_name: 'AuthService',
    similarity_type: 'semantic',  // semantic | structural | hybrid
    limit: 10
  }
}

// Hybrid: Combines vector search + relationship overlap
```

### 7. Change Tracking Tools

**When**: Change tracking system is enabled (ChangeTracker in use)

**Context**: RagForge already has a comprehensive change tracking system that:
- Tracks modifications to any entity (Scope, File, etc.)
- Stores unified diffs with line counts
- Creates HAS_CHANGE relationships to Change nodes
- Records timestamps for each modification

**Generated Tools**:

```typescript
{
  name: 'get_entity_change_history',
  description: `Get modification history for a specific entity.

  Returns chronological list of changes with:
  - Timestamp of each change
  - Change type (created/updated/deleted)
  - Unified diff showing what changed
  - Lines added/removed

  Useful for understanding code evolution and tracking modifications.`,

  inputSchema: {
    entity_type: 'Scope',
    entity_uuid: 'abc123...',
    limit: 10
  }
}

{
  name: 'find_recently_modified_entities',
  description: `Find entities modified within a time window.

  Leverages change tracking to find recently active code.
  Useful for:
  - Identifying areas of active development
  - Finding recently changed code for review
  - Tracking development velocity`,

  inputSchema: {
    entity_type: 'Scope',
    since: '7 days ago',  // or ISO timestamp
    limit: 20
  }
}

{
  name: 'get_most_modified_entities',
  description: `Find entities with highest change frequency (code churn).

  High churn may indicate:
  - Complex/unstable code
  - Hot spots needing refactoring
  - Areas under active development`,

  inputSchema: {
    entity_type: 'Scope',
    limit: 10
  }
}

{
  name: 'get_change_statistics',
  description: `Get aggregated statistics about code changes.

  Returns:
  - Total changes by type (created/updated/deleted)
  - Changes per entity type
  - Total lines added/removed
  - Change frequency over time`,

  inputSchema: {
    entity_type: 'Scope',  // optional: filter by entity type
    time_window: '30 days'  // optional: time range
  }
}

{
  name: 'compare_entity_versions',
  description: `Compare two versions of an entity with diff visualization.

  Shows what changed between two timestamps or change records.`,

  inputSchema: {
    entity_uuid: 'abc123...',
    from_timestamp: '2025-01-01',
    to_timestamp: '2025-01-15'
  }
}
```

**Why These Matter for Code RAG**:
- Agents can answer "What changed recently?"
- Identify unstable/frequently modified code
- Track development patterns and velocity
- Provide context about code evolution
- Help with code review and debugging (what changed when?)

**Implementation Note**: These tools leverage the existing `ChangeTracker` class in `ragforge/packages/runtime/src/adapters/change-tracker.ts` - no new infrastructure needed, just expose the capabilities to agents.

---

## Implementation Roadmap

### Phase 1: Core Tool Generation (Week 1-2)

**Goal**: Basic `generateToolsFromConfig()` working

- [ ] Create `packages/core/src/tools/tool-generator.ts`
- [ ] Implement `generateToolsFromConfig(config)` function
- [ ] Extract searchable_fields, unique_field, relationships from config
- [ ] Generate enhanced `query_entities` description with:
  - [ ] All searchable fields with types and descriptions
  - [ ] Unique identifiers for each entity type
  - [ ] Available operators
- [ ] Generate enhanced `semantic_search` description with vector indexes and unique fields
- [ ] Generate enhanced `explore_relationships` description with:
  - [ ] Relationship mappings (source → target entity types)
  - [ ] Available directions
  - [ ] Unique identifiers for all entities
- [ ] Generate enhanced `get_entity_by_id` description with unique fields for all entities
- [ ] Generate tool handlers
- [ ] Unit tests for tool generation
- [ ] Integration test with ToolRegistry

**Deliverable**: Runtime function that generates tools with complete schema exposure

### Phase 2: ragforge generate Integration (Week 2-3)

**Goal**: Auto-generate tools during code generation

- [ ] Add `tools` to `GeneratedCode` interface
- [ ] Create `templates/tools/database-tools.ts.template`
- [ ] Create `templates/tools/custom-tools.ts.template`
- [ ] Create `templates/tools/index.ts.template`
- [ ] Modify `CodeGenerator.generate()` to call `generateDatabaseTools()`
- [ ] Test generation with example config
- [ ] Update CLI to include tools in output

**Deliverable**: `ragforge generate` creates `generated-client/tools/`

### Phase 3: Computed Fields (Week 3-4)

**Goal**: Support computed fields in config

- [ ] Extend config schema to include `computed_fields`
- [ ] Implement runtime computation strategy (WITH clause in Cypher)
- [ ] Include computed fields in tool descriptions
- [ ] Generate proper TypeScript types (readonly computed fields)
- [ ] Test ORDER BY with computed fields
- [ ] Documentation for computed fields

**Deliverable**: Computed fields working end-to-end

### Phase 4: Specialized Tools (Week 4-5)

**Goal**: Generate specialized query tools

- [ ] Detect timestamp fields → generate `query_by_date_range`
- [ ] Detect numeric fields → generate `query_by_number_range`
- [ ] Detect string fields → generate `query_by_pattern`
- [ ] Conditional generation based on field types
- [ ] Tool description quality improvements
- [ ] Examples using specialized tools

**Deliverable**: 3+ specialized tools auto-generated

### Phase 5: Advanced Features (Week 6+)

**Goal**: Full-text, analytics, aggregations, change tracking

- [ ] Change tracking tools (leverage existing ChangeTracker):
  - [ ] `get_entity_change_history` - View modification history with diffs
  - [ ] `find_recently_modified_entities` - Find recent changes
  - [ ] `get_most_modified_entities` - Identify code churn hot spots
  - [ ] `get_change_statistics` - Aggregate change metrics
  - [ ] `compare_entity_versions` - Diff between timestamps
- [ ] Full-text search tool (when full_text_index in config)
- [ ] Aggregation tools (`aggregate_entities`)
- [ ] Graph analytics integration (PageRank, community detection)
- [ ] Multi-entity join tool
- [ ] Performance optimization (query planning)
- [ ] Telemetry for auto-materialization

**Deliverable**: Advanced tool suite with change tracking

### Phase 6: Documentation & Examples (Ongoing)

- [ ] API documentation for `generateToolsFromConfig()`
- [ ] Guide: "Writing Custom Tools"
- [ ] Guide: "Computed Fields Best Practices"
- [ ] Example: Code RAG with all tool types
- [ ] Example: Product catalog RAG with custom tools
- [ ] Migration guide from manual to generated tools

---

## API Reference

### generateToolsFromConfig

```typescript
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';
import { readFileSync } from 'fs';
import yaml from 'yaml';

// Load config
const configContent = readFileSync('ragforge.config.yaml', 'utf-8');
const config = yaml.parse(configContent);

// Generate tools
const { tools, handlers, metadata } = generateToolsFromConfig(config, {
  includeSemanticSearch: true,
  includeRelationships: true,
  includeSpecializedTools: true,
  includeAggregations: false
});

console.log(`Generated ${metadata.toolCount} tools`);
console.log(`Covering ${metadata.searchableFieldsCount} searchable fields`);

// Register tools
const registry = new ToolRegistry();
for (const tool of tools) {
  registry.register({
    ...tool,
    execute: handlers[tool.name]
  });
}
```

### setupToolRegistry (Generated)

```typescript
// generated-client/tools/index.ts (auto-generated)
import { setupToolRegistry } from './generated-client/tools/index.js';
import { createRagClient } from './generated-client/client.js';

const rag = createRagClient();
const toolRegistry = setupToolRegistry(rag);

// Now use with AgentRuntime
const runtime = new AgentRuntime(agentConfig, llmProvider, toolRegistry, sessionManager);
```

### Custom Tool Template

```typescript
// generated-client/tools/custom-tools.ts (user-editable)
import type { RagClient } from '../client.js';
import type { Tool } from '@luciformresearch/ragforge-runtime';

export const customTools: Tool[] = [
  {
    name: 'my_custom_tool',
    description: 'Custom business logic',
    inputSchema: {
      type: 'object',
      properties: {
        param1: { type: 'string' }
      },
      required: ['param1']
    }
  }
];

export function createCustomHandlers(rag: RagClient) {
  return {
    async my_custom_tool(params: any) {
      // Use rag client
      const results = await rag.get('Scope')
        .where('name', '=', params.param1)
        .execute();

      // Custom logic
      return { /* ... */ };
    }
  };
}
```

---

## Examples

### Example 1: Basic Tool Generation

**Config**:
```yaml
entities:
  - name: Scope
    unique_field: uuid
    searchable_fields:
      - name: name
        type: string
      - name: type
        type: string
      - name: file
        type: string
```

**Generated Tool Description**:
```
Query entities from the database with flexible conditions.

Available entities: Scope

Searchable/Orderable fields per entity:
- Scope:
  * name (string) - Scope identifier
  * type (string) - Scope type
  * file (string) - Source file path

Operators: =, !=, >, >=, <, <=, CONTAINS, STARTS WITH, ENDS WITH, IN

You can ORDER BY any searchable field (ASC or DESC).
```

**Agent can now**:
```
User: "Find all classes in auth.ts"
Agent: Uses query_entities with:
  {
    entity_type: 'Scope',
    conditions: [
      { field: 'type', operator: '=', value: 'class' },
      { field: 'file', operator: 'CONTAINS', value: 'auth.ts' }
    ]
  }
```

### Example 2: With Computed Fields

**Config**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string
      - name: startLine
        type: number
      - name: endLine
        type: number

    computed_fields:
      - name: line_count
        type: number
        description: "Lines of code"
        expression: "endLine - startLine"
```

**Agent can now**:
```
User: "What are the 10 largest classes?"
Agent: Uses query_entities with:
  {
    entity_type: 'Scope',
    conditions: [
      { field: 'type', operator: '=', value: 'class' }
    ],
    order_by: { field: 'line_count', direction: 'DESC' },
    limit: 10
  }
```

### Example 3: Custom + Generated Tools

**Generated tools**:
- `query_entities` (knows about line_count)
- `semantic_search`

**Custom tool** (in `custom-tools.ts`):
```typescript
{
  name: 'find_complex_and_coupled_scopes',
  description: `Find scopes that are both large and highly coupled.

  Combines line count with dependency analysis.`,

  async handler(params) {
    // 1. Find large scopes
    const large = await rag.get('Scope')
      .where('line_count', '>', 100)  // Uses computed field!
      .execute();

    // 2. For each, count dependencies
    const results = [];
    for (const scope of large) {
      const deps = await rag.get('Scope')
        .where('uuid', '=', scope.uuid)
        .getRelationship('DEPENDS_ON', 'outgoing', 'Scope')
        .execute();

      if (deps.length > 5) {
        results.push({
          ...scope,
          dependency_count: deps.length,
          complexity_score: scope.line_count * deps.length
        });
      }
    }

    return results.sort((a, b) => b.complexity_score - a.complexity_score);
  }
}
```

**Agent usage**:
```
User: "Find the most complex and tightly coupled parts of the codebase"
Agent: Uses find_complex_and_coupled_scopes (knows it exists from tool registry)
```

### Example 4: Change Tracking with modified_at

**Config with change tracking computed fields**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string
      - name: type
        type: string
      - name: startLine
        type: number
      - name: endLine
        type: number

    computed_fields:
      - name: line_count
        type: number
        expression: "endLine - startLine"

      - name: modified_at
        type: timestamp
        description: "Last modification timestamp"
        cypher: |
          OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change)
          WITH n, c ORDER BY c.timestamp DESC LIMIT 1
          RETURN c.timestamp AS modified_at

      - name: change_count
        type: number
        description: "Number of modifications"
        cypher: |
          OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change)
          RETURN count(c) AS change_count
```

**Generated tools know about temporal fields**:
- `query_entities` (with modified_at, change_count in description)
- `query_entities_by_date_range` (auto-generated for timestamp fields)
- `query_entities_by_number_range` (for change_count)
- `get_entity_change_history` (change tracking tool)
- `find_recently_modified_entities` (change tracking tool)

**Agent queries**:

```typescript
// Query 1: "What code changed in the last week?"
Agent uses query_entities_by_date_range:
{
  entity_type: 'Scope',
  date_field: 'modified_at',
  after: '7 days ago',
  limit: 20
}

// Query 2: "Find the most frequently modified classes"
Agent uses query_entities with:
{
  entity_type: 'Scope',
  conditions: [
    { field: 'type', operator: '=', value: 'class' }
  ],
  order_by: { field: 'change_count', direction: 'DESC' },
  limit: 10
}

// Query 3: "Show me the change history for AuthService"
Agent uses get_entity_change_history:
{
  entity_type: 'Scope',
  entity_uuid: 'abc123...',  // from previous query
  limit: 5
}
// Returns: Array of changes with diffs, timestamps, lines added/removed

// Query 4: "What are the most unstable parts of the codebase?"
// (unstable = frequently modified + large)
Agent uses query_entities:
{
  entity_type: 'Scope',
  conditions: [
    { field: 'change_count', operator: '>', value: 5 },
    { field: 'line_count', operator: '>', value: 100 }
  ],
  order_by: { field: 'change_count', direction: 'DESC' },
  limit: 10
}
```

**Why this matters**:
- `modified_at` and `change_count` are **automatically calculated** from existing HAS_CHANGE relationships
- No manual tracking needed - the ChangeTracker system handles everything
- Agents can now answer temporal questions about code evolution
- Combines change tracking with other metrics (size, complexity, coupling)

---

## Summary

### What This Enables

1. **Zero-config tool generation**: Run `ragforge generate` → tools auto-created
2. **Self-documenting tools**: Agents know exactly what fields exist, unique identifiers for each entity, available relationships with directions, and what's queryable
3. **Complete schema exposure**: Searchable fields, unique fields, relationships (with entity type mappings), and vector indexes all documented in tool descriptions
4. **Computed fields**: Config-driven derived values (line_count, modified_at, change_count, age, etc.)
5. **Change tracking integration**: Leverage existing ChangeTracker to expose modification history, code churn, and temporal queries
6. **Extensibility**: Easy to add custom tools alongside generated ones
7. **Consistency**: All RagForge projects get same high-quality tools
8. **Type safety**: Generated tools match config schema
9. **Specialized queries**: Date ranges, number ranges, patterns auto-generated based on field types
10. **Temporal awareness**: Agents can answer "what changed recently?" using modified_at computed from HAS_CHANGE relationships

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Separate generic and custom tools | Clear boundaries, preserves custom code across regeneration |
| Runtime `generateToolsFromConfig()` | Enables dynamic tool creation, testing, and flexibility |
| Integrate with `ragforge generate` | Zero manual setup, tools always in sync with schema |
| Computed fields in config | Config as single source of truth for schema |
| Runtime computation by default | Simpler, no migration needed, always accurate |
| Optional materialization | Performance when needed, with explicit opt-in |
| Tool descriptions include field docs | Agents need to know what's available to use tools effectively |

### Next Steps

1. ✅ Approve architectural direction
2. 🔄 Start Phase 1 implementation (`generateToolsFromConfig()`)
3. 🔄 Test with current agent feedback system
4. 🔄 Iterate based on real usage patterns
5. 🔄 Expand to specialized tools and advanced features

---

**End of Vision Document**
