# Agent Tool Feedback System

**Status**: Design Phase (Prerequisite for Specialized Tools)
**Goal**: Enable agents to provide structured feedback about missing or helpful tools
**Priority**: 🔥 CRITICAL (must implement before specialized tools)

---

## 📋 Table of Contents

1. [Problem Statement](#problem-statement)
2. [Design Goals](#design-goals)
3. [Architecture](#architecture)
4. [Response Schema Extension](#response-schema-extension)
5. [Debug Mode Configuration](#debug-mode-configuration)
6. [Implementation Plan](#implementation-plan)
7. [Examples](#examples)

---

## 🎯 Problem Statement

### Current Behavior

When an agent encounters a query it can't fully answer with available tools:

**Test Case** (from `test-tool-loop-standalone.ts`):
```
Query: "What are the most complex classes in the codebase? (Based on lines of code)"

Agent response:
"I can't directly determine complexity based on lines of code. However, I can search
for scopes and order them to find the largest ones, which might correlate with
complexity. What entity type should I search for? Also, what field represents
the lines of code for a scope?"
```

**Problems**:
1. ❌ Agent asks clarifying questions instead of trying available tools
2. ❌ No structured feedback about what's missing
3. ❌ Developer doesn't know which tools would help
4. ❌ No actionable insights for improving the system

### Desired Behavior

**With Tool Feedback System**:
```
Query: "What are the most complex classes in the codebase? (Based on lines of code)"

Agent response:
"Based on available data, the largest classes are:
1. ConversationAgent (245 lines)
2. StructuredLLMExecutor (198 lines)
3. AgentRuntime (156 lines)

[DEBUG MODE ACTIVE]
Tool Feedback:
✅ Used: query_entities (type='class')
⚠️  Limitation: Cannot sort by line count (field not exposed)
💡 Suggested tools that would improve this answer:
   - number_range_search: Would allow filtering/sorting by numeric fields like line_count
   - Better if 'line_count' or similar field was added to searchable_fields config

How current answer was constructed:
- Queried all classes
- Manually calculated lines from startLine/endLine properties
- Limited to available fields (name, file, type)
```

**Benefits**:
1. ✅ Agent provides best possible answer with current tools
2. ✅ Structured feedback on limitations
3. ✅ Actionable suggestions for tool improvements
4. ✅ Developer can prioritize which tools to build
5. ✅ Agent shows its reasoning process

---

## 🎯 Design Goals

### Core Principles

1. **Non-Breaking**: Feedback is opt-in via debug mode
2. **Structured**: Machine-readable format (JSON)
3. **Actionable**: Clear suggestions for improvements
4. **Honest**: Agent acknowledges limitations
5. **Educational**: Shows reasoning process

### Feedback Types

**1. Tool Usage Report**
- Which tools were used
- Which tools were considered but not used (and why)
- Tool execution success/failure

**2. Limitation Analysis**
- What the agent couldn't do
- Why it couldn't do it (missing field, missing operator, missing tool)
- Impact on answer quality

**3. Tool Suggestions**
- Specific tools that would improve the answer
- How they would improve it
- Priority (critical, high, medium, low)

**4. Alternative Approaches**
- Other ways to answer the query
- Trade-offs of each approach
- Why chosen approach was selected

---

## 🏗️ Architecture

### Extended Response Schema

**Current** (from `agent-runtime.ts`):
```typescript
interface LLMResponse {
  reasoning: string;
  tool_calls?: ToolCallRequest[];
  answer?: string;
}
```

**Extended** (with feedback):
```typescript
interface LLMResponse {
  reasoning: string;
  tool_calls?: ToolCallRequest[];
  answer?: string;

  // NEW: Tool feedback (only when debug mode enabled)
  tool_feedback?: ToolFeedback;
}

interface ToolFeedback {
  // Tools actually used
  tools_used: {
    name: string;
    purpose: string;
    success: boolean;
    result_quality?: 'excellent' | 'good' | 'partial' | 'failed';
  }[];

  // Tools considered but not used
  tools_considered: {
    name: string;
    reason_not_used: string;
  }[];

  // Limitations encountered
  limitations: {
    description: string;
    impact: 'critical' | 'high' | 'medium' | 'low';
    missing_capability?: 'tool' | 'field' | 'operator' | 'relationship';
  }[];

  // Suggested improvements
  suggestions: {
    type: 'new_tool' | 'expose_field' | 'add_relationship' | 'improve_existing';
    priority: 'critical' | 'high' | 'medium' | 'low';
    description: string;
    tool_spec?: {
      name: string;
      purpose: string;
      parameters: string[];
    };
    config_change?: {
      entity: string;
      change: string;
      example: string;
    };
  }[];

  // Alternative approaches
  alternatives?: {
    approach: string;
    pros: string[];
    cons: string[];
    requires?: string[]; // What would be needed
  }[];

  // Answer quality self-assessment
  answer_quality: {
    completeness: number; // 0-100%
    confidence: number;   // 0-100%
    notes?: string;
  };
}
```

### Agent Configuration Extension

**File**: `packages/runtime/src/types/chat.ts`

```typescript
export interface AgentConfig {
  id: string;
  name: string;
  domain?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt: string;
  tools: string[];
  metadata?: Record<string, any>;

  // NEW: Debug options
  debug?: {
    enabled: boolean;

    // Tool feedback options
    tool_feedback: {
      enabled: boolean;
      include_reasoning: boolean;    // Show why tools were chosen
      include_limitations: boolean;  // Show what couldn't be done
      include_suggestions: boolean;  // Suggest improvements
      include_alternatives: boolean; // Show other approaches
    };

    // Verbose logging
    verbose_logging?: boolean;

    // Performance tracking
    track_performance?: boolean;
  };
}
```

### System Prompt Extension

**When debug mode enabled**, inject additional instructions:

```typescript
const debugInstructions = `
## DEBUG MODE ACTIVE

In addition to answering the user's query, provide structured feedback about your tool usage:

1. **Tools Used**: List each tool you called and why
2. **Limitations**: Explain what you couldn't do and why
3. **Suggestions**: Recommend specific tools/features that would improve your answer
4. **Quality Assessment**: Rate your answer's completeness and confidence

Format your feedback as a structured object with these fields:
- tools_used: [{name, purpose, success, result_quality}]
- limitations: [{description, impact, missing_capability}]
- suggestions: [{type, priority, description, tool_spec?, config_change?}]
- answer_quality: {completeness: 0-100, confidence: 0-100}

Be specific and actionable. For example:
❌ "I need better search tools"
✅ "A number_range_search tool would allow filtering by line_count with operators like 'gt', 'lt', 'between'"

Always provide the best answer possible with current tools, then add feedback.
`;
```

---

## ⚙️ Debug Mode Configuration

### Option 1: Agent-Level Config

```typescript
const agentConfig: AgentConfig = {
  id: 'code-analyzer',
  name: 'Code Analysis Agent',
  systemPrompt: '...',
  tools: ['query_entities', 'semantic_search'],

  debug: {
    enabled: true,
    tool_feedback: {
      enabled: true,
      include_reasoning: true,
      include_limitations: true,
      include_suggestions: true,
      include_alternatives: false  // Optional
    }
  }
};
```

### Option 2: Per-Query Override

```typescript
const result = await agent.processMessage(sessionId, userMessage, {
  debug: true  // Enable debug for this query only
});
```

### Option 3: Environment Variable

```bash
RAGFORGE_AGENT_DEBUG=true npm run test
```

**Recommended**: Support all three, with precedence: per-query > agent-level > env var

---

## 🗺️ Implementation Plan

### Phase 1: Schema & Configuration (Week 1)

#### 1.1: Extend Type Definitions
- [ ] Add `ToolFeedback` interface to `types/chat.ts`
- [ ] Add `debug` field to `AgentConfig`
- [ ] Add `tool_feedback` to `LLMResponse`

**Files to modify**:
- `packages/runtime/src/types/chat.ts`

#### 1.2: Update Agent Runtime
- [ ] Detect debug mode (from config/query/env)
- [ ] Inject debug instructions into system prompt
- [ ] Parse feedback from LLM response
- [ ] Include feedback in agent message

**Files to modify**:
- `packages/runtime/src/agents/agent-runtime.ts`

#### 1.3: Update Response Parser
- [ ] Extend XML/JSON parser to handle `tool_feedback` field
- [ ] Validate feedback structure
- [ ] Handle missing/malformed feedback gracefully

**Files to modify**:
- `packages/runtime/src/llm/structured-llm-executor.ts`

---

### Phase 2: Feedback Generation (Week 2)

#### 2.1: Tool Usage Tracking
- [ ] Track which tools were called
- [ ] Track tool execution success/failure
- [ ] Estimate result quality based on returned data

**Implementation**:
```typescript
class ToolUsageTracker {
  private usedTools: Map<string, ToolUsageInfo> = new Map();

  trackToolCall(toolName: string, args: any) {
    // Track when tool is called
  }

  trackToolResult(toolName: string, result: any, success: boolean) {
    // Track result quality
  }

  generateReport(): ToolFeedback['tools_used'] {
    // Summarize tool usage
  }
}
```

#### 2.2: Limitation Detection
- [ ] Detect when tools fail
- [ ] Detect when requested fields don't exist
- [ ] Detect when operators aren't supported
- [ ] Categorize limitation severity

#### 2.3: Suggestion Engine
- [ ] Analyze query to infer needed capabilities
- [ ] Map capabilities to potential tools
- [ ] Generate specific tool specs
- [ ] Prioritize suggestions by impact

**Example**:
```typescript
function analyzeMissingCapabilities(query: string, toolResults: any[]): Suggestion[] {
  const suggestions = [];

  // Detect numeric comparisons
  if (query.match(/larger|smaller|more than|less than|between/i)) {
    const numericFields = detectNumericFields(toolResults);
    if (numericFields.length > 0) {
      suggestions.push({
        type: 'new_tool',
        priority: 'high',
        description: 'Add number_range_search for numeric comparisons',
        tool_spec: {
          name: 'number_range_search',
          purpose: 'Filter by numeric ranges with operators like gt, lt, between',
          parameters: ['entity_type', 'field', 'operator', 'value']
        }
      });
    }
  }

  // Detect date/time queries
  if (query.match(/recent|last week|after|before|between.*and/i)) {
    suggestions.push({
      type: 'new_tool',
      priority: 'high',
      description: 'Add datetime_range_search for temporal filtering',
      tool_spec: {
        name: 'datetime_range_search',
        purpose: 'Filter by date ranges with flexible precision',
        parameters: ['entity_type', 'field', 'mode', 'datetime']
      }
    });
  }

  // Detect pattern matching
  if (query.match(/contains|starts with|ends with|matches|like/i)) {
    suggestions.push({
      type: 'new_tool',
      priority: 'medium',
      description: 'Add text_pattern_search for regex/glob matching',
      tool_spec: {
        name: 'text_pattern_search',
        purpose: 'Search text fields with patterns (contains, regex, glob)',
        parameters: ['entity_type', 'field', 'pattern', 'mode']
      }
    });
  }

  return suggestions;
}
```

---

### Phase 3: Integration & Testing (Week 3)

#### 3.1: Update Test Suite
- [ ] Add debug mode to `test-tool-loop-standalone.ts`
- [ ] Validate feedback structure
- [ ] Test all feedback types
- [ ] Test with various query patterns

**Example test**:
```typescript
test('Agent provides feedback on missing tools', async () => {
  const agent = new AgentRuntime(
    { ...agentConfig, debug: { enabled: true, tool_feedback: { enabled: true } } },
    llmProvider,
    toolRegistry,
    sessionManager
  );

  const response = await agent.processMessage(sessionId, {
    content: "Find classes with more than 200 lines"
  });

  expect(response.tool_feedback).toBeDefined();
  expect(response.tool_feedback.suggestions).toContainEqual(
    expect.objectContaining({
      type: 'new_tool',
      tool_spec: expect.objectContaining({
        name: 'number_range_search'
      })
    })
  );
});
```

#### 3.2: Documentation
- [ ] Document debug mode usage
- [ ] Add examples to README
- [ ] Create troubleshooting guide

#### 3.3: Performance Testing
- [ ] Measure overhead of feedback generation
- [ ] Ensure <10% latency increase
- [ ] Optimize if needed

---

## 📚 Examples

### Example 1: Missing Numeric Tool

**Query**: "What are the largest classes (over 200 lines)?"

**Agent Response** (with debug):
```json
{
  "answer": "I found 15 classes in the codebase. Here are some:\n1. ConversationAgent (runtime/src/conversation/agent.ts)\n2. StructuredLLMExecutor (runtime/src/llm/structured-llm-executor.ts)\n3. AgentRuntime (runtime/src/agents/agent-runtime.ts)\n\nNote: I cannot filter by line count with current tools.",

  "tool_feedback": {
    "tools_used": [
      {
        "name": "query_entities",
        "purpose": "Find all classes",
        "success": true,
        "result_quality": "partial"
      }
    ],

    "limitations": [
      {
        "description": "Cannot filter or sort by line count",
        "impact": "high",
        "missing_capability": "operator"
      },
      {
        "description": "line_count field exists but no numeric comparison operators available",
        "impact": "high",
        "missing_capability": "tool"
      }
    ],

    "suggestions": [
      {
        "type": "new_tool",
        "priority": "high",
        "description": "Add number_range_search tool for numeric filtering",
        "tool_spec": {
          "name": "number_range_search",
          "purpose": "Filter entities by numeric fields with operators: =, >, <, between, approximately",
          "parameters": ["entity_type", "field", "operator", "value", "tolerance?"]
        }
      }
    ],

    "answer_quality": {
      "completeness": 40,
      "confidence": 80,
      "notes": "Can list classes but cannot filter by size. Answer would be 100% complete with number_range_search tool."
    }
  }
}
```

---

### Example 2: Missing Date Tool

**Query**: "Show me code modified in the last week"

**Agent Response** (with debug):
```json
{
  "answer": "I cannot determine modification dates with the available tools. The Scope entity may have a last_modified field, but I don't have tools to filter by date ranges.",

  "tool_feedback": {
    "tools_used": [],

    "tools_considered": [
      {
        "name": "query_entities",
        "reason_not_used": "No date comparison operators available. Can only use =, !=, CONTAINS, etc."
      },
      {
        "name": "semantic_search",
        "reason_not_used": "Vector search is not suitable for temporal filtering"
      }
    ],

    "limitations": [
      {
        "description": "No temporal filtering capabilities",
        "impact": "critical",
        "missing_capability": "tool"
      }
    ],

    "suggestions": [
      {
        "type": "new_tool",
        "priority": "critical",
        "description": "Add datetime_range_search for temporal queries",
        "tool_spec": {
          "name": "datetime_range_search",
          "purpose": "Filter entities by date/time with modes: before, after, between, relative",
          "parameters": ["entity_type", "field", "mode", "datetime?", "relative_period?", "precision?"]
        }
      },
      {
        "type": "expose_field",
        "priority": "high",
        "description": "Ensure last_modified field is in searchable_fields",
        "config_change": {
          "entity": "Scope",
          "change": "Add last_modified to searchable_fields",
          "example": "searchable_fields:\n  - name: last_modified\n    type: datetime"
        }
      }
    ],

    "alternatives": [
      {
        "approach": "Use semantic search with 'recent' keyword",
        "pros": ["Works with current tools"],
        "cons": ["Unreliable", "May return old code mentioning 'recent'"],
        "requires": []
      }
    ],

    "answer_quality": {
      "completeness": 0,
      "confidence": 0,
      "notes": "Cannot answer this query type with current tools. Needs datetime_range_search."
    }
  }
}
```

---

### Example 3: Successful Query with Suggestions

**Query**: "Find authentication functions"

**Agent Response** (with debug):
```json
{
  "answer": "I found 3 authentication-related functions:\n1. authenticateUser (auth/login.ts)\n2. validateToken (auth/middleware.ts)\n3. refreshAuthToken (auth/refresh.ts)",

  "tool_feedback": {
    "tools_used": [
      {
        "name": "semantic_search",
        "purpose": "Find auth-related code via vector similarity",
        "success": true,
        "result_quality": "excellent"
      }
    ],

    "limitations": [],

    "suggestions": [
      {
        "type": "new_tool",
        "priority": "low",
        "description": "text_pattern_search could provide complementary results",
        "tool_spec": {
          "name": "text_pattern_search",
          "purpose": "Pattern matching on text fields (contains, regex, starts_with)",
          "parameters": ["entity_type", "field", "pattern", "mode", "case_sensitive?"]
        }
      }
    ],

    "answer_quality": {
      "completeness": 95,
      "confidence": 90,
      "notes": "Semantic search worked well. text_pattern_search could catch edge cases where naming doesn't match semantics."
    }
  }
}
```

---

## 🎯 Success Criteria

### Phase 1: Schema & Configuration
- [x] `ToolFeedback` interface defined
- [x] Debug mode configuration works
- [x] Feedback parsing works
- [x] Backward compatible (no breaking changes)

### Phase 2: Feedback Generation
- [ ] Agent provides accurate tool usage reports
- [ ] Limitations are correctly identified
- [ ] Suggestions are specific and actionable
- [ ] Suggestion engine detects common patterns

### Phase 3: Integration
- [ ] Test coverage >80%
- [ ] Performance overhead <10%
- [ ] Documentation complete
- [ ] Real-world validation with developers

---

## 🚀 Next Steps

1. **Immediate** (this week):
   - [ ] Implement Phase 1 (schema & config)
   - [ ] Update `agent-runtime.ts` to inject debug instructions
   - [ ] Test basic feedback parsing

2. **Short-term** (next week):
   - [ ] Implement suggestion engine
   - [ ] Add to `test-tool-loop-standalone.ts`
   - [ ] Validate with multiple query types

3. **Before implementing specialized tools**:
   - [ ] Validate feedback system works
   - [ ] Use feedback to prioritize which tools to build first
   - [ ] Refine tool specs based on real agent suggestions

---

## 📝 Notes

- **Prerequisite for specialized tools**: This system helps us validate which tools are actually needed
- **Developer experience**: Makes debugging agent behavior much easier
- **Self-improvement**: Agent feedback guides system evolution
- **Non-intrusive**: Opt-in via debug mode, zero impact when disabled
- **Machine-readable**: Structured format enables automated tooling

---

## 📚 References

- [Agent Runtime](../../packages/runtime/src/agents/agent-runtime.ts)
- [Specialized Tools Roadmap](./SPECIALIZED-SEARCH-TOOLS-ROADMAP.md)
- [Agentic Tools Roadmap](../roadmaps/agentic/AGENTIC-TOOLS-ROADMAP.md)
- [Standalone Tool Test](../../examples/tool-calling-agent/test-tool-loop-standalone.ts)
