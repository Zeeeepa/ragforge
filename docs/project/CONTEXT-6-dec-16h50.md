# Context Dump - 6 Dec 2024 16h50

## Session Summary

Working on fixing the RagForge agent E2E flow: create project → write code → verify RAG ingestion.

## Problems Fixed Today

### 1. Docker Volume Cleanup
- **Problem**: `docker volume prune -f` doesn't remove named volumes from docker-compose
- **Fix**: Added `docker compose down -v` in `quickstart.ts:1135` before creating new containers
- **File**: `packages/cli/src/commands/quickstart.ts`

### 2. Incremental Agent Logging
- **Problem**: Logs only written at end, lost if agent crashes
- **Fix**: Call `writeSessionToFile()` after each log entry in `AgentLogger.log()`
- **File**: `packages/core/src/runtime/agents/rag-agent.ts:168`

### 3. Tool Results Undefined in Prompts
- **Problem**: Tool results showed `Tool 1: undefined [✗ FAILED] Result: undefined`
- **Root Cause**: `GeneratedToolExecutor.executeBatch()` stored raw result instead of `ToolExecutionResult`
- **Fix**: Wrap result in `{ tool_name, success, result }` at line 428-441
- **File**: `packages/core/src/runtime/agents/rag-agent.ts`

### 4. Agent Loop Exit Logic
- **Problem**: Agent exited too early when `hasSuccessfulToolResults && hasOutput`
- **Fix**: Removed early exit - always let LLM call tools if it wants to
- **File**: `packages/core/src/runtime/llm/structured-llm-executor.ts:2073`

### 5. Verbose Logging
- **Added**: `logPrompts: this.verbose` and `logResponses: this.verbose` to executor config
- **File**: `packages/core/src/runtime/agents/rag-agent.ts:661-662`

### 6. onLLMResponse Callback
- **Added**: Callback in config to log each LLM response with reasoning
- **File**: `packages/core/src/runtime/llm/structured-llm-executor.ts:157-163`

## Current Problem: RAG Tools Don't See New Project

### Symptoms
When running E2E test:
```
Create a new TypeScript project called 'demo-app', then write a Calculator class...
```

1. Project created successfully at `/tmp/demo-app`
2. Calculator.ts written successfully
3. `ingest_code` runs successfully
4. BUT `get_schema` returns empty: `{ entities: [], ... }`

### Root Cause
In `discovery-tools.ts:137-139`:
```javascript
const handler: ToolHandlerGenerator = (_rag: any) => async (args) => {
  return buildSchemaInfo(context, includeTips);  // context captured at generation!
```

The `context` is **captured when tools are generated**, not retrieved dynamically.

When agent starts with no project loaded:
- Tools generated with empty config
- `get_schema` always returns empty
- Even after `create_project` loads new project, old tools still have old context

### Solution Needed
Make `ToolGenerationContext` dynamic:
1. Either pass a getter function `() => context`
2. Or regenerate tools when project is loaded
3. Or make handlers fetch context dynamically

### Key Files to Modify
- `packages/core/src/tools/discovery-tools.ts` - make context dynamic
- `packages/core/src/tools/query-tools.ts` - same issue
- `packages/cli/src/commands/agent.ts` - how context is passed

## Test Command
```bash
cd /tmp && rm -rf ragforge-e2e-test && mkdir ragforge-e2e-test
docker ps -aq | xargs -r docker rm -f
docker volume ls -q | grep -E "(ragforge|demo)" | xargs -r docker volume rm
cd ragforge-e2e-test && node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js agent --dev --ask "Create a new TypeScript project called 'demo-app', then write a Calculator class with add and multiply methods in src/calculator.ts, then use query_entities to verify the Calculator class was ingested in the database"
```

## Log Location
Logs are now at: `/tmp/ragforge-e2e-test/.ragforge-logs/agent-*.json`

## Files Modified (uncommitted)
- `packages/core/src/runtime/agents/rag-agent.ts`
- `packages/core/src/runtime/llm/structured-llm-executor.ts`
- `packages/cli/src/commands/quickstart.ts`
- `packages/cli/src/commands/agent.ts`

## Solution Implemented (17h15)

### Root Cause
1. `generateToolsFromConfig` captured `context` statically at tool generation time
2. When agent starts with no project, tools have empty context forever
3. Even after `create_project` loads a project, the old tools still had old context
4. Additionally, `require('js-yaml')` doesn't work in ESM modules

### Fix Applied
1. **Added `ToolGenerationContextGetter` type** in `packages/core/src/tools/types/index.ts`
   - Function type: `() => ToolGenerationContext | null`
   - Added `EMPTY_CONTEXT` constant

2. **Updated `generateToolsFromConfig`** in `packages/core/src/tools/tool-generator.ts`
   - Added `ExtendedToolGenerationOptions` with optional `contextGetter`
   - All handler generators now accept `getContext` instead of static `context`
   - Handlers call `getContext()` at execution time

3. **Updated `generateDiscoveryTools`** in `packages/core/src/tools/discovery-tools.ts`
   - Accepts optional `contextGetter` parameter
   - Passes it to `get_schema` and `describe_entity` handlers

4. **Updated `createRagAgent`** in `packages/core/src/runtime/agents/rag-agent.ts`
   - Added `contextGetter` option to `RagAgentOptions`
   - Passes it to `generateToolsFromConfig`

5. **Updated `createRagForgeAgent`** in `packages/cli/src/commands/agent.ts`
   - Added `extractToolContext()` function to parse config
   - Added `getToolContext()` getter that reads config dynamically
   - Fixed config path: `.ragforge/ragforge.config.yaml` (not in generated/)
   - Used ESM `import yaml from 'js-yaml'` instead of `require()`

### Key Insight
The config file is at `.ragforge/ragforge.config.yaml`, NOT `.ragforge/generated/ragforge.config.yaml`

### Test Result
E2E flow now works:
```
Create project → Write code → Ingest → Query entities ✅
```

The query_entities tool now correctly sees the newly loaded project's schema.
