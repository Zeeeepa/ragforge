# Meta-LLM Tool Design

## Vision
Permettre à un agent d'utiliser `executeLLMBatch` comme un tool pour analyser/transformer les résultats d'autres tools avec le LLM.

## Use Cases

### 1. Analyze Search Results
```typescript
// Agent workflow
const functions = await search_functions("error handling");
// → 20 functions found

const analysis = await batch_analyze({
  items: functions,
  task: "For each function, analyze error handling quality and suggest improvements",
  outputSchema: {
    quality_score: { type: 'number', description: '1-10 rating' },
    issues: { type: 'string', description: 'Problems found' },
    suggestion: { type: 'string', description: 'Improvement suggestion' },
  }
});
// → 20 structured analyses
```

### 2. Refactoring Suggestions Pipeline
```typescript
// Step 1: Find complex scopes
const complexScopes = await search_scopes({
  where: { complexity: '>20' }
});

// Step 2: Batch analyze for refactoring
const suggestions = await batch_analyze({
  items: complexScopes,
  task: "Suggest specific refactoring strategies to reduce complexity",
  outputSchema: {
    strategy: { type: 'string', description: 'Main refactoring approach' },
    expected_complexity_reduction: { type: 'number' },
    breaking_changes: { type: 'boolean' },
    dependencies_affected: { type: 'array' },
  }
});

// Step 3: Filter and prioritize
const safeSuggestions = suggestions.filter(s => !s.breaking_changes);
return safeSuggestions.slice(0, 5);
```

### 3. Dependency Impact Analysis
```typescript
// Agent is asked: "What would be impacted if we refactor QueryBuilder?"
const dependents = await get_dependents("QueryBuilder");
// → 45 scopes depend on it

const impacts = await batch_analyze({
  items: dependents,
  task: "Analyze how this scope uses QueryBuilder and estimate refactoring impact",
  outputSchema: {
    usage_type: { type: 'string', description: 'How it uses QueryBuilder' },
    tight_coupling: { type: 'boolean' },
    refactor_effort: { type: 'string', enum: ['low', 'medium', 'high'] },
    risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
  }
});

// Aggregate insights
const highRisk = impacts.filter(i => i.risk_level === 'high').length;
return {
  total_affected: 45,
  high_risk_scopes: highRisk,
  recommendation: highRisk > 5 ? 'proceed cautiously' : 'safe to refactor'
};
```

### 4. Code Pattern Detection
```typescript
const allFunctions = await search_functions({ type: 'function' });

const patterns = await batch_analyze({
  items: allFunctions,
  task: "Detect if this function follows common patterns (factory, singleton, observer, etc.)",
  outputSchema: {
    pattern: { type: 'string', description: 'Detected pattern or "none"' },
    confidence: { type: 'number' },
  }
});

const patternStats = patterns.reduce((acc, p) => {
  if (p.pattern !== 'none') acc[p.pattern] = (acc[p.pattern] || 0) + 1;
  return acc;
}, {});
```

## Tool Definition

```typescript
{
  type: 'function',
  function: {
    name: 'batch_analyze',
    description: 'Use LLM to analyze/transform a batch of items with structured output. Useful for analyzing search results, generating suggestions, or extracting insights from code.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Array of items to analyze (from previous tool results)',
        },
        task: {
          type: 'string',
          description: 'What to do with each item (e.g., "suggest refactoring", "analyze complexity")',
        },
        outputSchema: {
          type: 'object',
          description: 'Schema for the structured output per item',
        },
        inputFields: {
          type: 'array',
          description: 'Which fields from items to use as input (default: all)',
          required: false,
        },
      },
      required: ['items', 'task', 'outputSchema'],
    },
  },
}
```

## Implementation

```typescript
class MetaLLMToolExecutor implements ToolExecutor {
  constructor(private llmProvider: LLMProvider) {}

  async execute(toolCall: ToolCallRequest): Promise<any> {
    if (toolCall.tool_name === 'batch_analyze') {
      const { items, task, outputSchema, inputFields } = toolCall.arguments;

      const executor = new StructuredLLMExecutor();

      const results = await executor.executeLLMBatch(items, {
        inputFields: inputFields || Object.keys(items[0] || {}),
        userTask: task,
        outputSchema,
        llmProvider: this.llmProvider,
        batchSize: 10,
      });

      return results;
    }
  }
}
```

## Benefits

1. **Composability**: Agent can build complex workflows by chaining tools
2. **Flexibility**: No need to pre-define every possible analysis type
3. **Reusability**: Leverages existing `executeLLMBatch` infrastructure
4. **Structured Insights**: Always returns structured data, easy to filter/aggregate
5. **Cost Control**: Agent decides batch size and scope

## Example Agent Conversation

**User**: "Find functions with high complexity and suggest refactoring"

**Agent thinking**:
1. Tool: `search_scopes({ complexity: '>20' })` → 12 scopes
2. Tool: `batch_analyze`:
   - items: those 12 scopes
   - task: "Analyze complexity and suggest specific refactoring"
   - schema: { complexity_drivers, suggestion, estimated_effort }
3. Process results, sort by effort
4. Return top 5 with detailed explanations

**Agent output**:
"I found 12 high-complexity scopes. Here are the top 5 refactoring opportunities:
1. `StructuredLLMExecutor.executeLLMBatch` (complexity: 45)
   - Main driver: Too many responsibilities
   - Suggestion: Extract batch processing logic into separate class
   - Effort: Medium
   ..."

## Next Steps

1. Implement `batch_analyze` tool
2. Add to `CodeSearchToolExecutor`
3. Test with real refactoring use cases
4. Consider adding:
   - `batch_compare`: Compare items pairwise
   - `batch_summarize`: Aggregate insights from batch
   - `batch_validate`: Check items against criteria
