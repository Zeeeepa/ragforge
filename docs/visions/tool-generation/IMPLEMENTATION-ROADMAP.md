# Tool Generation Implementation Roadmap

**Quick reference for implementing the config-driven tool generation system.**

Full details: [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)

---

## Overview

Implement systematic tool generation from `ragforge.config.yaml`:
- Auto-generate database query tools during `ragforge generate`
- Expose complete entity schema (fields, unique IDs, relationships)
- Support computed fields (line_count, modified_at, etc.)
- Separate generic (auto-generated) from custom (user-coded) tools

**Goal**: Agents know exactly what data exists and how to query it.

---

## Implementation Phases

### [Phase 1: Core Tool Generation](./TOOL-GENERATION-ARCHITECTURE.md#L1375) (Week 1-2)

**Goal**: Basic `generateToolsFromConfig()` function working

**Tasks**:
- Create `packages/core/src/tools/tool-generator.ts`
- Implement `generateToolsFromConfig(config)` function
- Extract searchable_fields, unique_field, relationships from config
- Generate enhanced tool descriptions:
  - **query_entities**: All searchable fields + types + descriptions + unique fields
  - **semantic_search**: Vector indexes + unique fields
  - **explore_relationships**: Relationship mappings (source → target) + directions + unique IDs
  - **get_entity_by_id**: Unique fields for all entities
- Generate tool handlers using RagClient
- Unit tests for tool generation
- Integration test with ToolRegistry

**Deliverable**: Runtime function `generateToolsFromConfig()` that creates tools with complete schema exposure

**Key Files**:
- New: `packages/core/src/tools/tool-generator.ts`
- Reference: `examples/tool-calling-agent/database-tools-generator.ts` (current manual implementation)

---

### [Phase 2: ragforge generate Integration](./TOOL-GENERATION-ARCHITECTURE.md#L1398) (Week 2-3)

**Goal**: Auto-generate tools alongside client code during `ragforge generate`

**Tasks**:
- Add `tools` to `GeneratedCode` interface in code-generator.ts
- Create template files:
  - `templates/tools/database-tools.ts.template` (auto-generated, regenerated)
  - `templates/tools/custom-tools.ts.template` (user-editable, preserved)
  - `templates/tools/index.ts.template` (combines both)
- Modify `CodeGenerator.generate()` to call `generateDatabaseTools()`
- Update CLI to include tools in output directory structure
- Test generation with example config

**Deliverable**: `ragforge generate` creates `generated-client/tools/` directory

**Output Structure**:
```
generated-client/
├─ tools/
│  ├─ database-tools.ts      (auto-generated, DO NOT EDIT)
│  ├─ custom-tools.ts        (user-editable, preserved)
│  └─ index.ts               (setupToolRegistry function)
```

**Key Files**:
- Modify: `packages/core/src/generator/code-generator.ts`
- New: `packages/core/templates/tools/*.template`

---

### [Phase 3: Computed Fields](./TOOL-GENERATION-ARCHITECTURE.md#L1412) (Week 3-4)

**Goal**: Support computed fields in config (line_count, modified_at, change_count, etc.)

**Tasks**:
- Extend config schema to include `computed_fields`
- Implement runtime computation strategies:
  - Simple expressions: `endLine - startLine`
  - Cypher queries: `OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change) RETURN c.timestamp`
- Include computed fields in tool descriptions
- Generate proper TypeScript types (readonly for computed fields)
- Test ORDER BY with computed fields
- Documentation for computed fields

**Config Example**:
```yaml
entities:
  - name: Scope
    computed_fields:
      - name: line_count
        type: number
        expression: "endLine - startLine"

      - name: modified_at
        type: timestamp
        cypher: |
          OPTIONAL MATCH (n)-[:HAS_CHANGE]->(c:Change)
          WITH n, c ORDER BY c.timestamp DESC LIMIT 1
          RETURN c.timestamp AS modified_at
```

**Deliverable**: Computed fields working end-to-end (config → tools → queries)

**Key Files**:
- Modify: `packages/core/src/types/config.ts` (add computed_fields schema)
- Modify: `packages/core/src/tools/tool-generator.ts` (handle computed fields)

**Details**: [Computed Fields Solution](./TOOL-GENERATION-ARCHITECTURE.md#L848)

---

### [Phase 4: Specialized Tools](./TOOL-GENERATION-ARCHITECTURE.md#L1425) (Week 4-5)

**Goal**: Auto-generate specialized query tools based on field types

**Tasks**:
- Detect timestamp fields → generate `query_entities_by_date_range`
- Detect numeric fields → generate `query_entities_by_number_range`
- Detect string fields → generate `query_entities_by_pattern` (regex/glob)
- Conditional generation based on field types in config
- Tool description quality improvements
- Examples using specialized tools

**Generated Tools**:
- `query_entities_by_date_range` - For modified_at, created_at
- `query_entities_by_number_range` - For line_count, change_count, complexity scores
- `query_entities_by_pattern` - Regex/glob/fuzzy matching on string fields

**Deliverable**: 3+ specialized tools auto-generated based on config schema

**Details**: [Specialized Tools](./TOOL-GENERATION-ARCHITECTURE.md#L336)

---

### [Phase 5: Advanced Features](./TOOL-GENERATION-ARCHITECTURE.md#L1438) (Week 6+)

**Goal**: Advanced tools for full-text, analytics, aggregations, change tracking

**Tasks**:

**Change Tracking Tools** (leverages existing ChangeTracker):
- `get_entity_change_history` - View modification history with diffs
- `find_recently_modified_entities` - Find recent changes
- `get_most_modified_entities` - Identify code churn hot spots
- `get_change_statistics` - Aggregate change metrics
- `compare_entity_versions` - Diff between timestamps

**Other Advanced Tools**:
- Full-text search tool (when `full_text_index` in config)
- Aggregation tools (`aggregate_entities` - COUNT/AVG/SUM/GROUP BY)
- Graph analytics (PageRank, community detection - when Neo4j GDS available)
- Multi-entity join tool (complex cross-entity queries)
- Performance optimization (query planning, caching)
- Telemetry for auto-materialization of computed fields

**Deliverable**: Advanced tool suite with change tracking

**Details**:
- [Change Tracking Tools](./TOOL-GENERATION-ARCHITECTURE.md#L1268)
- [Full-Text Search](./TOOL-GENERATION-ARCHITECTURE.md#L1070)
- [Graph Analytics](./TOOL-GENERATION-ARCHITECTURE.md#L1114)
- [Aggregations](./TOOL-GENERATION-ARCHITECTURE.md#L416)

---

### [Phase 6: Documentation & Examples](./TOOL-GENERATION-ARCHITECTURE.md#L1457) (Ongoing)

**Goal**: Comprehensive documentation and examples

**Tasks**:
- API documentation for `generateToolsFromConfig()`
- Guide: "Writing Custom Tools"
- Guide: "Computed Fields Best Practices"
- Example: Code RAG with all tool types
- Example: Product catalog RAG with custom tools
- Migration guide from manual to generated tools
- Video/tutorial on tool generation workflow

**Deliverable**: Complete documentation suite

---

## Key Architectural Decisions

| Decision | Rationale | Reference |
|----------|-----------|-----------|
| **Separate generic and custom tools** | Clear boundaries, preserves custom code across regeneration | [Generic vs Custom](./TOOL-GENERATION-ARCHITECTURE.md#L591) |
| **Runtime `generateToolsFromConfig()`** | Enables dynamic tool creation, testing, flexibility | [Core Proposal](./TOOL-GENERATION-ARCHITECTURE.md#L140) |
| **Integrate with `ragforge generate`** | Zero manual setup, tools always in sync with schema | [Integration](./TOOL-GENERATION-ARCHITECTURE.md#L455) |
| **Computed fields in config** | Config as single source of truth for schema | [Computed Fields](./TOOL-GENERATION-ARCHITECTURE.md#L848) |
| **Runtime computation by default** | Simpler, no migration, always accurate | [Implementation Strategies](./TOOL-GENERATION-ARCHITECTURE.md#L921) |
| **Expose complete schema in tools** | Agents need to know fields, unique IDs, relationships | [Enhanced Descriptions](./TOOL-GENERATION-ARCHITECTURE.md#L197) |
| **Change tracking via computed fields** | Leverage existing ChangeTracker, no manual updates | [Change Tracking](./TOOL-GENERATION-ARCHITECTURE.md#L1268) |

---

## Expected Outcomes

### For Agents
- ✅ Know exactly what fields exist on each entity
- ✅ Know unique identifiers for all entity types
- ✅ Know available relationships (with source → target mappings)
- ✅ Can query by any searchable field (including computed)
- ✅ Can track code changes and evolution
- ✅ Get specialized tools automatically based on field types

### For Developers
- ✅ Zero boilerplate - tools auto-generated
- ✅ Type-safe tools matching config
- ✅ Easy to add custom tools alongside generated ones
- ✅ Config-driven schema means single source of truth
- ✅ Tools stay in sync with database schema

### For RagForge
- ✅ Consistent tool generation across all projects
- ✅ Better agent performance out-of-the-box
- ✅ Easier onboarding (one config generates everything)
- ✅ Extensible system for future tool types

---

## Quick Start (After Implementation)

```bash
# 1. Define entities in config
vim ragforge.config.yaml

# 2. Generate client + tools
ragforge generate

# 3. Use in agent
import { setupToolRegistry } from './generated-client/tools/index.js';
const toolRegistry = setupToolRegistry(rag);

# 4. Add custom tools (optional)
vim generated-client/tools/custom-tools.ts
```

---

## Status Tracking

- [ ] Phase 1: Core Tool Generation
- [ ] Phase 2: ragforge generate Integration
- [ ] Phase 3: Computed Fields
- [ ] Phase 4: Specialized Tools
- [ ] Phase 5: Advanced Features
- [ ] Phase 6: Documentation & Examples

**Current Status**: PROPOSAL (awaiting approval)

---

**Full Technical Details**: [TOOL-GENERATION-ARCHITECTURE.md](./TOOL-GENERATION-ARCHITECTURE.md)
