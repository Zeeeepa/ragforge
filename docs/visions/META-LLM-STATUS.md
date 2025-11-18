# Meta-LLM Tool - Status

## ✅ Implemented

### Core Functionality
- `batch_analyze` tool that allows agents to use `executeLLMBatch` as a tool
- Integrated into `CodeSearchToolExecutor` in tool-calling-agent example
- Schema validation and JSON parsing for outputSchema parameter

### Architecture
```typescript
// Agent workflow enabled by meta-LLM:
1. search_functions("validation") → 15 functions
2. batch_analyze(
     items=<functions>,
     task="suggest refactoring",
     outputSchema={suggestion, priority}
   ) → 15 structured suggestions
3. Filter/aggregate → return top 3
```

### Implementation Files
- `/ragforge/examples/tool-calling-agent/test-tools-basic.ts` - Extended with `batch_analyze`
- `/ragforge/examples/tool-calling-agent/test-meta-llm.ts` - Dedicated test (WIP)
- `/ragforge/docs/visions/META-LLM-TOOL-DESIGN.md` - Full design doc

## 🔄 In Progress

### Prompt Engineering
Current challenge: Getting the agent to actually USE batch_analyze in multi-step workflows.

The tool works technically, but needs better prompting to encourage:
1. Multi-step thinking (search THEN analyze)
2. Understanding when batch_analyze adds value vs just returning results

### Alternative Approaches to Test
1. **Simpler demo**: Pre-populate results, just test batch_analyze directly
2. **Forced tool calling**: Use tool_choice to force specific tools
3. **Per-item mode with clearer instructions**: Guide the agent through steps

## 🎯 Value Proposition

This is a game-changer for building towards autonomous refactoring:

**Without meta-LLM:**
```
Agent: search_functions("complex")
→ Gets list of functions
→ Returns list to user
→ User manually analyzes each
```

**With meta-LLM:**
```
Agent: search_functions("complex")
→ Gets list of functions
→ batch_analyze(functions, "suggest refactoring", {...})
→ Gets structured suggestions for EACH
→ Filters by priority
→ Returns actionable recommendations
```

## 🚀 Next Steps

1. **Better Demo**: Create a workflow that clearly shows the power
   - Start with pre-loaded search results
   - Call batch_analyze directly
   - Show structured transformation

2. **Real Use Case**: Integrate into refactoring pipeline
   - Phase 1: Search complex scopes
   - Phase 2: batch_analyze each for suggestions
   - Phase 3: Store suggestions in Neo4j
   - Phase 4: Prioritize and execute

3. **Additional Meta-Tools**:
   - `batch_compare`: Compare items pairwise
   - `batch_validate`: Check items against criteria
   - `batch_summarize`: Aggregate insights from batch

## 💡 Why This Matters for Refactoring Vision

The refactoring vision requires:
1. **Analyzing many scopes** ✅ (we can search/filter)
2. **Generating suggestions for each** ✅ (batch_analyze does this!)
3. **Storing structured results** 🔄 (next step)
4. **Propagating context** 🔄 (diff memory + relationships)

Meta-LLM tool is the bridge between "finding code" and "reasoning about code at scale".

Instead of:
- Tool per use case (suggest_refactoring, analyze_complexity, etc.)

We have:
- One meta-tool that adapts to any task via prompts

This is compositional AI at work.
