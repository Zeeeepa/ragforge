# Specialized Search Tools - Vision & Roadmap

**Status**: Vision / Design Phase
**Goal**: Generate specialized search tools based on field types and configuration
**Priority**: HIGH (enhances agent capabilities significantly)

---

## 📋 Table of Contents

1. [Problem Statement](#problem-statement)
2. [Current State Analysis](#current-state-analysis)
3. [Proposed Architecture](#proposed-architecture)
4. [Specialized Tools Design](#specialized-tools-design)
5. [Configuration Schema](#configuration-schema)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Examples & Use Cases](#examples--use-cases)
8. [Technical Considerations](#technical-considerations)

---

## 🎯 Problem Statement

### Current Limitations

Currently, `database-tools-generator.ts` generates **4 generic tools**:
- `query_entities` - Generic WHERE filtering
- `semantic_search` - Vector similarity
- `explore_relationships` - Graph traversal
- `get_entity_by_id` - Entity retrieval

**Problems**:
1. **Generic operators** - LLM must know exact field names and operators
2. **No type-specific operations** - Can't do "before/after date" or "approximately equal"
3. **No pattern matching** - Can't do grep-like searches on text fields
4. **Poor discoverability** - Agent doesn't know which fields support which operations

### Desired Capabilities

**1. Text Pattern Search (grep-like)**
```typescript
// Find scopes with "auth" in any exposed text field
text_pattern_search({
  entity_type: 'Scope',
  field: 'name',        // or 'source', 'description'
  pattern: '.*auth.*',
  case_sensitive: false
})
```

**2. Temporal Search**
```typescript
// Find scopes modified after Jan 1, 2024
date_range_search({
  entity_type: 'Scope',
  field: 'last_modified',
  after: '2024-01-01',
  before: '2024-12-31'
})
```

**3. Numeric Range/Approximate Search**
```typescript
// Find scopes with ~100 lines of code (±10)
number_range_search({
  entity_type: 'Scope',
  field: 'line_count',
  operator: 'approximately',
  value: 100,
  tolerance: 10
})
```

---

## 🔍 Current State Analysis

### What Exists

#### 1. Configuration Schema

**File**: `packages/core/src/types/config.ts`

```typescript
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'datetime'
  | 'enum';

export interface FieldConfig {
  name: string;
  type: FieldType;
  indexed?: boolean;
  description?: string;
  values?: string[]; // For enum types
}

export interface EntityConfig {
  name: string;
  searchable_fields: FieldConfig[];
  // ...
}
```

#### 2. Supported Operators

**File**: `examples/tool-calling-agent/database-tools-generator.ts:68`

```typescript
enum: ['=', '!=', '>', '>=', '<', '<=', 'CONTAINS', 'STARTS WITH', 'ENDS WITH', 'IN']
```

These operators are passed to `GenericQueryBuilder.where()`.

#### 3. Current Tool Generation

Tools are **statically defined** in `database-tools-generator.ts` (lines 40-184):
- Hardcoded tool names
- Hardcoded schemas
- No type-based customization

### What's Missing

1. **Type-aware tool generation**
   - No automatic tools based on field types
   - No pattern matching for strings
   - No date range operators
   - No numeric approximation

2. **Field exposure configuration**
   - No way to mark fields as "exposable to tools"
   - No way to specify which operations are allowed per field
   - No validation of field capabilities

3. **Smart operator selection**
   - LLM must guess which operators work on which fields
   - No type-based operator recommendations
   - No field-specific documentation

---

## 🏗️ Proposed Architecture

### Overview

```
ragforge.config.yaml
    ↓
    declares entities with searchable_fields
    ↓
    optionally marks fields as exposed_to_tools
    ↓
database-tools-generator.ts
    ↓
    reads field types from config
    ↓
    generates specialized tools per type
    ↓
ToolRegistry
    ↓
    registers both generic + specialized tools
    ↓
AgentRuntime
    ↓
    uses tools with type-aware documentation
```

### Three-Tier Approach

#### Tier 1: Keep Generic Tools (Existing)
- `query_entities` - Still useful for complex multi-field queries
- `semantic_search` - Vector search
- `explore_relationships` - Graph traversal
- `get_entity_by_id` - Direct lookup

#### Tier 2: Add Type-Specific Tools (New)
- `text_pattern_search` - Regex/glob on string fields
- `date_range_search` - Before/after/between on datetime fields
- `number_range_search` - Numeric comparisons with approximation
- `enum_filter_search` - Filter by enum values

#### Tier 3: Smart Tool Selection (Future)
- LLM analyzes query intent
- System suggests best tool based on field types
- Auto-composition of multi-tool queries

---

## 🛠️ Specialized Tools Design

### 1. Text Pattern Search

**Purpose**: Grep-like search on text fields

**Tool Schema**:
```typescript
{
  name: 'text_pattern_search',
  description: `Search for text patterns in string fields using regex or wildcards.

Available text fields:
${textFields.map(f => `- ${f.entity}.${f.name}: ${f.description || ''}`).join('\n')}

Supports:
- Regex patterns (.*auth.*)
- Case-sensitive/insensitive matching
- Multiple pattern modes (contains, starts_with, ends_with, exact, regex)`,

  inputSchema: {
    type: 'object',
    properties: {
      entity_type: {
        type: 'string',
        enum: entityNames
      },
      field: {
        type: 'string',
        enum: textFieldNames,
        description: 'Text field to search'
      },
      pattern: {
        type: 'string',
        description: 'Pattern to match (supports regex if mode=regex)'
      },
      mode: {
        type: 'string',
        enum: ['contains', 'starts_with', 'ends_with', 'exact', 'regex'],
        default: 'contains'
      },
      case_sensitive: {
        type: 'boolean',
        default: false
      },
      limit: { type: 'number', default: 10 }
    },
    required: ['entity_type', 'field', 'pattern']
  }
}
```

**Implementation**:
```typescript
async text_pattern_search(params) {
  const { entity_type, field, pattern, mode, case_sensitive, limit } = params;

  let cypherOperator;
  let cypherValue;

  switch (mode) {
    case 'contains':
      cypherOperator = case_sensitive ? 'CONTAINS' : 'CONTAINS';
      cypherValue = case_sensitive ? pattern : pattern; // Neo4j CONTAINS is case-sensitive by default
      break;
    case 'starts_with':
      cypherOperator = 'STARTS WITH';
      cypherValue = pattern;
      break;
    case 'ends_with':
      cypherOperator = 'ENDS WITH';
      cypherValue = pattern;
      break;
    case 'exact':
      cypherOperator = '=';
      cypherValue = pattern;
      break;
    case 'regex':
      cypherOperator = '=~';  // Neo4j regex
      cypherValue = case_sensitive ? pattern : `(?i)${pattern}`;
      break;
  }

  const query = rag.get(entity_type)
    .where(field, cypherOperator, cypherValue)
    .limit(limit);

  return await query.execute();
}
```

**Cypher Example**:
```cypher
// mode=regex, pattern=".*auth.*", case_sensitive=false
MATCH (n:Scope)
WHERE n.name =~ '(?i).*auth.*'
RETURN n
LIMIT 10
```

---

### 2. Date/Time Range Search

**Purpose**: Search entities by date/time ranges with flexible precision (date, datetime, timestamp)

**Tool Schema**:
```typescript
{
  name: 'datetime_range_search',
  description: `Search entities by date/time ranges with flexible precision.

Available datetime fields:
${dateFields.map(f => `- ${f.entity}.${f.name}: ${f.description || ''}`).join('\n')}

Supports:
- Before a date/time (before)
- After a date/time (after)
- Between two dates/times (between)
- Relative dates (last_7_days, last_hour, etc.)

Date format flexibility:
- Date only: "2024-01-15" (assumes 00:00:00)
- Date + time: "2024-01-15T14:30" (assumes :00 seconds)
- Full timestamp: "2024-01-15T14:30:45Z" (precise to second)
- With timezone: "2024-01-15T14:30:45+01:00"`,

  inputSchema: {
    type: 'object',
    properties: {
      entity_type: { type: 'string', enum: entityNames },
      field: {
        type: 'string',
        enum: dateFieldNames,
        description: 'Datetime field to filter on'
      },
      mode: {
        type: 'string',
        enum: ['before', 'after', 'between', 'relative'],
        default: 'after'
      },
      // For before/after
      datetime: {
        type: 'string',
        description: 'ISO datetime string. Supports: YYYY-MM-DD, YYYY-MM-DDTHH:mm, YYYY-MM-DDTHH:mm:ssZ'
      },
      // For between
      start_datetime: {
        type: 'string',
        description: 'Start datetime (same format flexibility as datetime)'
      },
      end_datetime: {
        type: 'string',
        description: 'End datetime (same format flexibility as datetime)'
      },
      // For relative
      relative_period: {
        type: 'string',
        enum: ['last_minute', 'last_5_minutes', 'last_hour', 'last_24_hours', 'last_7_days', 'last_30_days', 'last_year']
      },
      // Precision control
      precision: {
        type: 'string',
        enum: ['second', 'minute', 'hour', 'day'],
        default: 'second',
        description: 'Precision of comparison (e.g., day ignores time component)'
      },
      limit: { type: 'number', default: 10 }
    },
    required: ['entity_type', 'field', 'mode']
  }
}
```

**Implementation**:
```typescript
async datetime_range_search(params) {
  const {
    entity_type, field, mode,
    datetime, start_datetime, end_datetime,
    relative_period, precision = 'second',
    limit
  } = params;

  let query = rag.get(entity_type);

  switch (mode) {
    case 'before':
      const beforeDate = parseDatetime(datetime, precision);
      query = query.where(field, '<', beforeDate);
      break;
    case 'after':
      const afterDate = parseDatetime(datetime, precision);
      query = query.where(field, '>', afterDate);
      break;
    case 'between':
      const startDate = parseDatetime(start_datetime, precision);
      const endDate = parseDatetime(end_datetime, precision);
      query = query
        .where(field, '>=', startDate)
        .where(field, '<=', endDate);
      break;
    case 'relative':
      const now = new Date();
      const cutoff = calculateRelativeDate(now, relative_period);
      query = query.where(field, '>', cutoff);
      break;
  }

  return await query.orderBy(field, 'DESC').limit(limit).execute();
}

/**
 * Parse datetime string with flexible precision
 * Supports:
 * - "2024-01-15" → 2024-01-15T00:00:00Z
 * - "2024-01-15T14:30" → 2024-01-15T14:30:00Z
 * - "2024-01-15T14:30:45" → 2024-01-15T14:30:45Z
 * - "2024-01-15T14:30:45+01:00" → with timezone
 */
function parseDatetime(dateStr: string, precision: string): Date {
  let date: Date;

  // Parse ISO string (handles all formats)
  if (dateStr.includes('T')) {
    date = new Date(dateStr);
  } else {
    // Date only - assume midnight UTC
    date = new Date(dateStr + 'T00:00:00Z');
  }

  // Apply precision rounding
  switch (precision) {
    case 'day':
      date.setUTCHours(0, 0, 0, 0);
      break;
    case 'hour':
      date.setUTCMinutes(0, 0, 0);
      break;
    case 'minute':
      date.setUTCSeconds(0, 0);
      break;
    case 'second':
      date.setUTCMilliseconds(0);
      break;
  }

  return date;
}

function calculateRelativeDate(now: Date, period: string): Date {
  const ms = {
    last_minute: 60 * 1000,
    last_5_minutes: 5 * 60 * 1000,
    last_hour: 60 * 60 * 1000,
    last_24_hours: 24 * 60 * 60 * 1000,
    last_7_days: 7 * 24 * 60 * 60 * 1000,
    last_30_days: 30 * 24 * 60 * 60 * 1000,
    last_year: 365 * 24 * 60 * 60 * 1000
  };
  return new Date(now.getTime() - ms[period]);
}
```

**Cypher Example**:
```cypher
// mode=between, start_date=2024-01-01, end_date=2024-12-31
MATCH (n:Scope)
WHERE n.last_modified >= datetime('2024-01-01T00:00:00Z')
  AND n.last_modified <= datetime('2024-12-31T23:59:59Z')
RETURN n
ORDER BY n.last_modified DESC
LIMIT 10
```

---

### 3. Number Range Search

**Purpose**: Numeric searches with approximation and rounding

**Tool Schema**:
```typescript
{
  name: 'number_range_search',
  description: `Search entities by numeric fields with various comparison modes.

Available numeric fields:
${numberFields.map(f => `- ${f.entity}.${f.name}: ${f.description || ''}`).join('\n')}

Supports:
- Exact match (equal)
- Greater/less than (gt, gte, lt, lte)
- Range (between)
- Approximate match (approximately)
- Rounded match (rounded_equal)`,

  inputSchema: {
    type: 'object',
    properties: {
      entity_type: { type: 'string', enum: entityNames },
      field: {
        type: 'string',
        enum: numberFieldNames,
        description: 'Numeric field to filter on'
      },
      operator: {
        type: 'string',
        enum: ['equal', 'gt', 'gte', 'lt', 'lte', 'between', 'approximately', 'rounded_equal'],
        description: 'Comparison operator'
      },
      value: {
        type: 'number',
        description: 'Value to compare (or lower bound for between)'
      },
      upper_value: {
        type: 'number',
        description: 'Upper bound (for between operator)'
      },
      tolerance: {
        type: 'number',
        description: 'Tolerance for approximately operator (default: 10% of value)',
        default: null
      },
      round_to: {
        type: 'number',
        description: 'Round to nearest N (for rounded_equal)',
        default: 10
      },
      limit: { type: 'number', default: 10 }
    },
    required: ['entity_type', 'field', 'operator', 'value']
  }
}
```

**Implementation**:
```typescript
async number_range_search(params) {
  const { entity_type, field, operator, value, upper_value, tolerance, round_to, limit } = params;

  let query = rag.get(entity_type);

  switch (operator) {
    case 'equal':
      query = query.where(field, '=', value);
      break;
    case 'gt':
      query = query.where(field, '>', value);
      break;
    case 'gte':
      query = query.where(field, '>=', value);
      break;
    case 'lt':
      query = query.where(field, '<', value);
      break;
    case 'lte':
      query = query.where(field, '<=', value);
      break;
    case 'between':
      query = query
        .where(field, '>=', value)
        .where(field, '<=', upper_value);
      break;
    case 'approximately':
      const tol = tolerance || (value * 0.1); // Default 10%
      query = query
        .where(field, '>=', value - tol)
        .where(field, '<=', value + tol);
      break;
    case 'rounded_equal':
      // In Cypher, we'd need a custom filter
      // For now, use range around rounded value
      const lower = Math.floor(value / round_to) * round_to;
      const upper = lower + round_to;
      query = query
        .where(field, '>=', lower)
        .where(field, '<', upper);
      break;
  }

  return await query.limit(limit).execute();
}
```

**Cypher Examples**:
```cypher
-- operator=approximately, value=100, tolerance=10
MATCH (n:Scope)
WHERE n.line_count >= 90 AND n.line_count <= 110
RETURN n
LIMIT 10

-- operator=rounded_equal, value=153, round_to=10
MATCH (n:Scope)
WHERE n.line_count >= 150 AND n.line_count < 160
RETURN n
LIMIT 10
```

---

### 4. Enum Filter Search (Bonus)

**Purpose**: Filter by enum values with better UX

**Tool Schema**:
```typescript
{
  name: 'enum_filter_search',
  description: `Filter entities by enum field values.

Available enum fields:
${enumFields.map(f => `- ${f.entity}.${f.name}: ${f.values.join(', ')}`).join('\n')}`,

  inputSchema: {
    type: 'object',
    properties: {
      entity_type: { type: 'string', enum: entityNames },
      field: {
        type: 'string',
        enum: enumFieldNames
      },
      values: {
        type: 'array',
        items: { type: 'string' },
        description: 'Enum values to match (OR logic)'
      },
      exclude: {
        type: 'boolean',
        default: false,
        description: 'If true, exclude these values instead'
      },
      limit: { type: 'number', default: 10 }
    },
    required: ['entity_type', 'field', 'values']
  }
}
```

**Implementation**:
```typescript
async enum_filter_search(params) {
  const { entity_type, field, values, exclude, limit } = params;

  const operator = exclude ? 'NOT IN' : 'IN';
  return await rag.get(entity_type)
    .where(field, operator, values)
    .limit(limit)
    .execute();
}
```

---

## ⚙️ Configuration Schema

### Option 1: Implicit (Automatic from searchable_fields)

**No config changes needed**. Auto-generate tools based on `searchable_fields` types.

**Pros**:
- Zero configuration overhead
- Works immediately for all existing configs
- Simple to understand

**Cons**:
- No fine-grained control
- All searchable fields get all tools
- No way to disable specific tools

**Example** (existing config):
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string          # → Auto-generates text_pattern_search
      - name: line_count
        type: number          # → Auto-generates number_range_search
      - name: last_modified
        type: datetime        # → Auto-generates date_range_search
      - name: type
        type: enum            # → Auto-generates enum_filter_search
        values: [function, class, interface]
```

### Option 2: Explicit (New exposed_tools section)

**Add new config section** to explicitly mark fields for tool exposure.

**Pros**:
- Fine-grained control
- Can enable/disable specific operations
- Can add per-field constraints (min/max, allowed patterns)
- Self-documenting

**Cons**:
- More verbose
- Requires config updates
- Learning curve

**Example** (new config):
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string
      - name: source
        type: string
      - name: line_count
        type: number
      - name: last_modified
        type: datetime
      - name: type
        type: enum
        values: [function, class, interface]

    # NEW: Explicit tool exposure
    exposed_tools:
      text_pattern:
        enabled: true
        fields:
          - name           # Allow pattern search on 'name'
          - source         # Allow pattern search on 'source'
        modes: [contains, starts_with, regex]  # Allowed modes

      date_range:
        enabled: true
        fields:
          - last_modified
        modes: [before, after, between, relative]

      number_range:
        enabled: true
        fields:
          - line_count
        operators: [equal, gt, lt, between, approximately]
        constraints:
          line_count:
            min: 0
            max: 10000

      enum_filter:
        enabled: true
        fields:
          - type
```

### Option 3: Hybrid (Smart defaults + overrides)

**Auto-generate tools from types, allow opt-out/customization**.

**Pros**:
- Best of both worlds
- Zero config for common cases
- Customization when needed

**Cons**:
- Slightly more complex logic
- Need to define smart defaults

**Example**:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string
      - name: line_count
        type: number
      - name: internal_id
        type: number
        exposed_to_tools: false  # Opt-out
      - name: last_modified
        type: datetime
        tool_modes: [after, relative]  # Restrict modes
```

**Recommendation**: **Start with Option 1 (Implicit), add Option 3 (Hybrid) later**

---

## 🗺️ Implementation Roadmap

### Phase 0: Agent Feedback System (Week 0) 🔥 **PREREQUISITE**

**Goal**: Enable agent to provide structured feedback about missing tools

**Why First**:
- Validates which tools are actually needed by observing agent behavior
- Provides actionable guidance for tool prioritization
- Improves developer experience during tool development
- Agent can explain limitations instead of just asking questions

**Implementation**:
- [ ] Extend `LLMResponse` schema with `tool_feedback` field
- [ ] Add `debug` mode to `AgentConfig`
- [ ] Inject debug instructions into system prompt when enabled
- [ ] Implement feedback parsing in `StructuredLLMExecutor`
- [ ] Add suggestion engine for common patterns (numeric, date, text)
- [ ] Test with existing queries to validate suggestions

**Files to modify**:
- `packages/runtime/src/types/chat.ts` - Add ToolFeedback interface
- `packages/runtime/src/agents/agent-runtime.ts` - Debug mode support
- `packages/runtime/src/llm/structured-llm-executor.ts` - Parse feedback

**Reference**: See `/docs/visions/exposed_tools/AGENT-TOOL-FEEDBACK-SYSTEM.md`

**Success criteria**:
- [ ] Agent provides feedback on missing capabilities
- [ ] Suggestions are specific and actionable
- [ ] Feedback guides which tools to build first
- [ ] Performance overhead <10%

---

### Phase 1: Foundation (Week 1)

**Goal**: Add specialized tools based on agent feedback from Phase 0

#### 1.1: Extend Config Types
- [ ] No changes needed (types already exist)
- [ ] Document field type → tool mapping

#### 1.2: Create Tool Generators
- [ ] `generateTextPatternTool(entity, fields)`
- [ ] `generateDateRangeTool(entity, fields)`
- [ ] `generateNumberRangeTool(entity, fields)`
- [ ] `generateEnumFilterTool(entity, fields)`

#### 1.3: Integrate with database-tools-generator.ts
- [ ] Scan `searchable_fields` by type
- [ ] Group fields by type
- [ ] Generate specialized tools
- [ ] Keep existing generic tools
- [ ] Add to tools array

**Files to modify**:
- `examples/tool-calling-agent/database-tools-generator.ts`

**Success criteria**:
- [x] Text pattern search works
- [x] Date range search works
- [x] Number range search works
- [x] Enum filter search works
- [x] All tests pass

---

### Phase 2: Enhanced Capabilities (Week 2)

**Goal**: Add advanced features and validation

#### 2.1: Advanced Pattern Matching
- [ ] Support glob patterns (`*.ts`, `auth*`)
- [ ] Support multiple patterns (OR logic)
- [ ] Add pattern validation

#### 2.2: Relative Date Calculations
- [ ] Implement `last_N_days/hours/months`
- [ ] Support custom relative periods
- [ ] Add timezone handling

#### 2.3: Numeric Statistics
- [ ] Add `percentile` operator (top 10%)
- [ ] Add `outlier` detection (> 2 std dev)
- [ ] Add `distribution` binning

#### 2.4: Smart Field Detection
- [ ] Auto-detect date fields from Neo4j schema
- [ ] Auto-detect numeric fields
- [ ] Warn on type mismatches

---

### Phase 3: Configuration Control (Week 3)

**Goal**: Add explicit configuration options

#### 3.1: Config Schema Extension
- [ ] Define `exposed_tools` schema in `config.ts`
- [ ] Add `tool_modes` per field
- [ ] Add `constraints` validation

#### 3.2: Tool Customization
- [ ] Per-field mode restrictions
- [ ] Per-field value constraints
- [ ] Per-tool enable/disable

#### 3.3: Documentation Generation
- [ ] Auto-generate tool descriptions from config
- [ ] Include field constraints in descriptions
- [ ] Generate examples for each tool

---

### Phase 4: Advanced Features (Future)

**Goal**: Smart composition and optimization

#### 4.1: Tool Composition
- [ ] Multi-tool queries (pattern + date range)
- [ ] Query plan optimization
- [ ] Result merging strategies

#### 4.2: Query Suggestions
- [ ] LLM analyzes query intent
- [ ] Suggests best tool combination
- [ ] Auto-fills common parameters

#### 4.3: Performance Optimization
- [ ] Index detection (warn if field not indexed)
- [ ] Query cost estimation
- [ ] Automatic query rewriting

---

## 📚 Examples & Use Cases

### Use Case 1: Finding Recently Modified Auth Code

**Query**: "Show me authentication-related files modified in the last week"

**Tool Calls**:
```javascript
// Step 1: Pattern search for auth
const authScopes = await text_pattern_search({
  entity_type: 'Scope',
  field: 'name',
  pattern: 'auth',
  mode: 'contains',
  case_sensitive: false
});

// Step 2: Filter by date
const recentScopes = await date_range_search({
  entity_type: 'Scope',
  field: 'last_modified',
  mode: 'relative',
  relative_period: 'last_7_days'
});

// Agent synthesizes results
```

**Better**: Single tool with multiple filters (future enhancement)

---

### Use Case 2: Finding Large Classes

**Query**: "What are the largest classes? (over 200 lines)"

**Tool Calls**:
```javascript
// Pattern search for classes
const classes = await text_pattern_search({
  entity_type: 'Scope',
  field: 'type',
  pattern: 'class',
  mode: 'exact'
});

// Numeric range for size
const largeClasses = await number_range_search({
  entity_type: 'Scope',
  field: 'line_count',
  operator: 'gt',
  value: 200,
  limit: 10
});
```

**Result**: Top 10 classes over 200 lines

---

### Use Case 3: Finding Functions with ~50 Lines

**Query**: "Find medium-sized functions (around 50 lines, give or take 10)"

**Tool Call**:
```javascript
const mediumFunctions = await number_range_search({
  entity_type: 'Scope',
  field: 'line_count',
  operator: 'approximately',
  value: 50,
  tolerance: 10  // 40-60 lines
});
```

**Result**: Functions with 40-60 lines of code

---

### Use Case 4: Old Code Audit

**Query**: "Find code that hasn't been touched since 2023"

**Tool Call**:
```javascript
const oldCode = await date_range_search({
  entity_type: 'Scope',
  field: 'last_modified',
  mode: 'before',
  date: '2024-01-01T00:00:00Z'
});
```

**Result**: All scopes modified before 2024

---

## 🔧 Technical Considerations

### 1. Performance

**Concerns**:
- Regex searches can be slow on large datasets
- Date range queries need indexed date fields
- Approximate numeric searches scan ranges

**Mitigations**:
- Warn if field is not indexed
- Limit result sets (max 50)
- Use query timeouts
- Add EXPLAIN support

### 2. Type Safety

**Concerns**:
- Config types vs Neo4j schema types
- Type coercion (string → datetime)
- Null handling

**Mitigations**:
- Validate field types at tool generation time
- Auto-detect Neo4j schema types
- Explicit null handling in tools

### 3. Documentation

**Concerns**:
- LLM needs to know which fields support which operations
- Tool descriptions can get verbose
- Field constraints must be communicated

**Mitigations**:
- Generate rich tool descriptions from config
- Include field lists in tool docs
- Add examples to descriptions

### 4. Backwards Compatibility

**Concerns**:
- Existing `query_entities` tool still needed
- Can't break existing agents
- Migration path for configs

**Mitigations**:
- Keep all existing tools (Tier 1)
- Add specialized tools (Tier 2)
- Optional config (Tier 3)
- Deprecation warnings (if needed)

---

## 🎯 Success Metrics

### Phase 1 Success
- [x] 4 specialized tools generated
- [x] Tools work with existing config (implicit detection)
- [x] Agent can use tools effectively
- [x] Test coverage >80%

### Phase 2 Success
- [ ] Advanced operators work (glob, relative dates, percentiles)
- [ ] Performance acceptable (<500ms per query)
- [ ] Documentation auto-generated

### Phase 3 Success
- [ ] Config-based customization works
- [ ] Field constraints enforced
- [ ] Migration guide published

### Phase 4 Success
- [ ] Multi-tool composition works
- [ ] Query optimization reduces latency by 30%
- [ ] LLM suggests optimal tool combinations

---

## 🚀 Next Steps

1. **Immediate** (this week):
   - [ ] Implement Phase 1.2 (tool generators)
   - [ ] Integrate with database-tools-generator.ts
   - [ ] Test with standalone tool loop

2. **Short-term** (next 2 weeks):
   - [ ] Add advanced features (Phase 2)
   - [ ] Performance testing
   - [ ] Documentation

3. **Mid-term** (1-2 months):
   - [ ] Explicit configuration (Phase 3)
   - [ ] Multi-tool composition
   - [ ] Query optimization

---

## 📝 Notes

- Start with **implicit detection** (Option 1) for quick wins
- Add **explicit config** (Option 3) when users need customization
- Keep **generic tools** for complex queries
- Focus on **developer experience** (rich docs, examples)
- Measure **LLM effectiveness** (does it use the right tools?)

---

## 📚 References

- [Database Tools Generator](../../examples/tool-calling-agent/database-tools-generator.ts)
- [Config Types](../../packages/core/src/types/config.ts)
- [Generic Query Builder](../../packages/runtime/src/query/generic-query-builder.ts)
- [Agent Runtime](../../packages/runtime/src/agents/agent-runtime.ts)
- [Agentic Tools Roadmap](./agentic/AGENTIC-TOOLS-ROADMAP.md)
