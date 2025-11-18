# Agentic Tools Roadmap

**Status**: In Progress
**Goal**: Enable LLM agents to query any domain agnostically with iterative tool-calling loops

**Architecture**: Two-phase approach
- **Phase 1**: Standalone tool-calling loop (validated independently)
- **Phase 2**: Conversational agent that delegates to tool-calling loop

---

## ✅ Completed

### Generic Query Builder API
- [x] QueryPlan - Internal representation
- [x] QueryExecutor - Cypher generation & execution
- [x] GenericQueryBuilder - Fluent API (`.get().where().execute()`)
- [x] Integration with code generation
- [x] Semantic search support
- [x] Result structure flattening (properties merged with score)

### Domain-Agnostic Database Tools
- [x] Config-based tool generation (`database-tools-generator.ts`)
- [x] `query_entities` - Query with filters
- [x] `semantic_search` - Vector similarity search
- [x] `explore_relationships` - Follow graph relationships
- [x] `get_entity_by_id` - Fetch by unique identifier
- [x] Automatic unique_field detection per entity type
- [x] Test suite for individual tools (`test-database-tools.ts`)

### Agent Runtime Infrastructure
- [x] AgentRuntime with iterative tool-calling loop
- [x] Native tool calling support (Gemini)
- [x] Fallback to StructuredLLMExecutor (XML-based)
- [x] Tool execution with retry logic
- [x] Context accumulation across iterations
- [x] Meta-LLM tool (`batch_analyze` in `test-meta-llm.ts`)

### Supporting Infrastructure
- [x] Watch functionality fixed (File/Directory path vs Scope uuid)
- [x] Embeddings generation (1184 scopes indexed)
- [x] Incremental ingestion working
- [x] Model normalization to `gemini-2.0-flash`

---

## 🚧 Phase 1: Standalone Tool-Calling Loop (CURRENT FOCUS)

**Goal**: Validate the iterative tool-calling loop independently of conversational context.

**Rationale**:
- Decouple tool execution from conversation memory
- Test multi-step reasoning without conversation overhead
- Create reusable component for Phase 2

### 1.1. Create Standalone Tool Loop Test
**Status**: ✅ COMPLETED
**Priority**: 🔥 CRITICAL (blocking Phase 2)

**Purpose**: Test pure query → tools → results → loop cycle without conversation history.

**Implementation**:
- [x] Create `test-tool-loop-standalone.ts`
- [x] Implement simple wrapper around AgentRuntime that:
  - Takes a single query
  - Executes tool loop until completion
  - Returns final answer + tool execution trace
- [x] Test with multi-step queries requiring:
  - Sequential tool calls (semantic_search → get_entity_by_id)
  - Tool chaining (query → analyze → refine)
- [x] Validate iteration limits work correctly
- [x] Test error handling (tool failures, malformed args)

**Test Results** (3 test queries):

**TEST 1: Sequential Reasoning** - ✅ **PASSED**
- Query: "Find functions related to authentication and tell me which files they are defined in"
- Iterations: 2
- Tool calls: 1 (`semantic_search`)
- Duration: 5.7s
- Result: Found auth functions and listed their files

**TEST 2: Multi-step Analysis** - ⚠️ **WARNING**
- Query: "What are the most complex classes in the codebase?"
- Iterations: 1
- Tool calls: 0
- Issue: Agent asked for clarifications instead of trying tools
- Note: Prompt issue, not a loop failure

**TEST 3: Relationship Navigation** - ✅ **PASSED** 🌟
- Query: "Find the ConversationAgent class and show me what files it uses"
- Iterations: **5** (multi-step reasoning!)
- Tool calls: **4 chained**:
  1. `semantic_search` → found ConversationAgent
  2. `explore_relationships` → checked USES_LIBRARY
  3. `explore_relationships` → checked DEFINED_IN
  4. `get_entity_by_id` → got full details
- Duration: 9.3s
- Result: Agent reasoned through multiple steps successfully

**Success criteria**:
- ✅ Loop executes multiple iterations when needed (tested up to 5)
- ✅ Tools are called with correct arguments (native tool calling works)
- ✅ Context accumulates properly across iterations
- ✅ Final answer synthesizes all tool results
- ✅ Works with native tool calling (Gemini)
- ✅ Error handling works (tools fail gracefully)
- ⚠️ Prompt quality affects agent behavior (expected)

---

### 1.2. Optimize Tool Loop Performance
**Status**: Not started
**Priority**: MEDIUM
**Depends on**: 1.1

**Optimizations**:
- [ ] Parallel tool execution (when tools are independent)
- [ ] Tool result caching (avoid redundant queries)
- [ ] Streaming responses (show progress to user)
- [ ] Smart iteration limit (based on query complexity)

---

## 📋 Phase 2: Conversational Agent Integration (PLANNED)

**Goal**: Integrate validated tool loop into conversational agent with memory.

**Architecture**:
```
ConversationAgent (manages memory, history, summaries)
    ↓
    delegates to
    ↓
AgentRuntime (executes tool loop)
    ↓
    uses
    ↓
Database Tools (query_entities, semantic_search, etc.)
```

### 2.1. Agent Delegation Pattern
**Status**: Not started
**Priority**: HIGH
**Depends on**: Phase 1 completion

**Implementation**:
- [ ] Modify ConversationAgent to:
  - Accept AgentRuntime as parameter
  - Delegate user queries to AgentRuntime
  - Store tool execution results in conversation history
  - Include tool traces in summaries
- [ ] Test integration:
  - Conversation context + tool loop
  - Summaries include tool usage
  - RAG retrieves relevant tool executions
- [ ] Update `test-conversation-agent.ts` to use tools

---

### 2.2. Tool-Aware Memory System
**Status**: Not started
**Priority**: MEDIUM
**Depends on**: 2.1

**Features**:
- [ ] Summarize tool executions (not just final answer)
- [ ] RAG on tool execution patterns
- [ ] Reference previous tool results in new queries
- [ ] Detect when to reuse vs re-query

---

## 🔧 Optional Enhancements (Lower Priority)

### E.1. Add Reranking to SemanticSearchOptions
**Status**: Not started
**Priority**: LOW (nice-to-have)

**Problem**: `SemanticSearchOptions` missing `rerank` and `rerankModel` fields

**Implementation**:
```typescript
// packages/runtime/src/types/query.ts
export interface SemanticSearchOptions {
  topK?: number;
  vectorIndex?: string;
  threshold?: number;
  minScore?: number;
  rerank?: boolean;           // ← ADD
  rerankModel?: string;       // ← ADD
  metadataOverride?: (results: any[], metadata: any) => any;
}
```

**Files to update**:
- [ ] `packages/runtime/src/types/query.ts`
- [ ] Test reranking end-to-end

---

### E.2. Create `analyze_with_llm` Tool
**Status**: Not started (but `batch_analyze` exists in `test-meta-llm.ts`)
**Priority**: LOW

**Note**: Similar functionality already exists via `batch_analyze` meta-tool.
Consider promoting `batch_analyze` to database-tools-generator instead of creating new tool.

---

## 🎯 Advanced Patterns (Future)

**Ideas for after Phase 2**:
- **Iterative refinement**: Agent queries → analyzes → reranks → queries again based on insights
- **Multi-hop reasoning**: Follow relationships → analyze intermediate nodes → continue traversal
- **Comparative analysis**: Query multiple entity types → analyze differences → synthesize insights
- **Tool learning**: Agent learns which tools work best for which queries

---

## 🎯 Success Criteria

### Phase 1: Standalone Tool Loop ⚡ (Current Sprint)
- [x] Generic query API works for all entity types
- [x] Default model normalized to `gemini-2.0-flash`
- [x] AgentRuntime with iterative loop implemented
- [x] Database tools generated from config
- [x] Individual tool tests passing
- [ ] **Standalone tool loop test created and passing** ← NEXT
- [ ] Multi-step queries work correctly
- [ ] Both native and fallback tool calling validated

### Phase 2: Conversational Integration 💬
- [ ] ConversationAgent delegates to AgentRuntime
- [ ] Tool executions stored in conversation history
- [ ] Summaries include tool usage patterns
- [ ] RAG retrieves relevant past tool executions
- [ ] End-to-end conversation + tools test passing

### Phase 3: Advanced Capabilities 🚀 (Future)
- [ ] Parallel tool execution optimization
- [ ] Tool result caching
- [ ] Streaming responses
- [ ] Multi-hop reasoning patterns
- [ ] Works for non-code domains (demonstrated with different config)
- [ ] Tool learning (agent improves over time)

---

## 🐛 Known Issues & Tech Debt

### Tool Loop
- [ ] No validation of tool loop with complex multi-step queries yet
- [ ] Error recovery strategy needs testing (what happens when tool fails mid-loop?)
- [ ] Iteration limit tuning (10 may be too high/low depending on query)

### Reranking (Lower Priority)
- Not exposed in SemanticSearchOptions yet (optional enhancement)
- Not tested since StructuredLLMExecutor refactor

### Integration Points
- [ ] ConversationAgent doesn't use AgentRuntime yet
- [ ] Tool execution traces not stored in conversation memory
- [ ] No test for conversation + tools integration

---

## 📚 Related Documents

- **Core Implementation**:
  - `/packages/runtime/src/agents/agent-runtime.ts` - Tool loop implementation
  - `/examples/tool-calling-agent/database-tools-generator.ts` - Tool generation
  - `/packages/runtime/src/llm/structured-llm-executor.ts` - LLM executor

- **Tests**:
  - `/examples/tool-calling-agent/test-database-tools.ts` - Individual tool tests
  - `/examples/tool-calling-agent/test-tool-loop-standalone.ts` - **Standalone loop test (Phase 1)**
  - `/examples/tool-calling-agent/test-meta-llm.ts` - Meta-LLM pattern example
  - `/examples/tool-calling-agent/test-conversation-agent.ts` - Conversation memory test

- **Design Docs**:
  - `/docs/AGENT-TOOLS-FROM-CONFIG.md` - Original design for generic query API
  - `/docs/visions/CONVERSATIONAL-AGENT-MEMORY-V2.md` - Agent memory architecture
  - `/docs/AGENT-LOOP-PATTERN.md` - Tool loop pattern documentation
  - `/docs/visions/exposed_tools/SPECIALIZED-SEARCH-TOOLS-ROADMAP.md` - **Specialized search tools vision**

---

## 🔄 Next Actions (Prioritized)

1. ✅ ~~Normalize models~~ → COMPLETED
2. ✅ ~~Implement AgentRuntime~~ → COMPLETED
3. ✅ ~~Generate database tools~~ → COMPLETED
4. ✅ ~~Create `test-tool-loop-standalone.ts`~~ → COMPLETED (Phase 1.1)
5. ✅ ~~Test multi-step queries~~ → VALIDATED (5 iterations, 4 tool chains!)
6. 🔥 **Implement Agent Tool Feedback System** → NEXT (Phase 0 - PREREQUISITE)
   - Enable debug mode for agents
   - Agent provides feedback on missing/helpful tools
   - Structured suggestions for tool improvements
   - See `/docs/visions/exposed_tools/AGENT-TOOL-FEEDBACK-SYSTEM.md`
7. **Add Specialized Search Tools** → After feedback validation
   - Text pattern search (grep-like)
   - Datetime range search (with hour/minute/second precision)
   - Number range search (approximate, rounded)
   - See `/docs/visions/exposed_tools/SPECIALIZED-SEARCH-TOOLS-ROADMAP.md`
8. **Phase 2: Integrate with ConversationAgent** → After specialized tools
9. (Optional) Add reranking to SemanticSearchOptions
10. (Optional) Promote `batch_analyze` to core database tools
