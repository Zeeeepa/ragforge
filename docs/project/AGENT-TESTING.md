# Agent Testing Guide

**Last Updated**: 2025-12-05
**Location**: `.ragforge/generated/scripts/test-agent.ts`

---

## Quick Test

```bash
cd /path/to/project/.ragforge/generated

# Basic query
npx tsx scripts/test-agent.ts "What classes exist in this project?"

# With file tools enabled
npx tsx scripts/test-agent.ts "Read the main entry point file"
```

---

## Available Agent Tools (12 tools)

### RAG Tools (Query the code graph)

| Tool | Description | Example |
|------|-------------|---------|
| `get_schema` | Get graph schema | "What entities exist?" |
| `describe_entity` | Entity type details | "Describe the Scope entity" |
| `query_entities` | Query with filters | "Find all classes named Auth*" |
| `semantic_search` | Vector similarity | "Find authentication logic" |
| `explore_relationships` | Navigate graph | "What does UserService depend on?" |
| `get_entity_by_id` | Get by UUID | Internal use |
| `get_entities_by_ids` | Get multiple by UUID | Internal use |
| `glob_search` | Pattern matching | "Find files matching **/auth/*.ts" |
| `batch_analyze` | Batch operations | Analyze multiple entities |

### File Tools (Read/Write files)

| Tool | Description | Example |
|------|-------------|---------|
| `read_file` | Read file content | "Read src/index.ts" |
| `write_file` | Create/overwrite file | "Create a new utils.ts" |
| `edit_file` | Search/replace | "Add an import statement" |

---

## Test Agent Script

### Location

```
.ragforge/generated/scripts/test-agent.ts
```

### Usage

```bash
# Single query
npx tsx scripts/test-agent.ts "Your question here"

# Multi-line query (heredoc)
npx tsx scripts/test-agent.ts << 'EOF'
Edit src/calculator.ts to add a 'multiply' function.
Then use query_entities to find all scopes in calculator.ts.
Compare with before - do you see the new multiply function?
EOF
```

### With File Tools

```bash
# Enable file tools for read/write operations
npx tsx scripts/test-agent.ts "Read the file src/index.ts and explain what it does"
```

---

## Query Examples

### Schema & Discovery

```bash
# What's in the graph?
npx tsx scripts/test-agent.ts "Use get_schema to show me all entity types"

# Describe entity
npx tsx scripts/test-agent.ts "Describe the Scope entity - what fields does it have?"
```

### Querying Entities

```bash
# Find by name
npx tsx scripts/test-agent.ts "Find all scopes named 'handle*'"

# Find by file pattern
npx tsx scripts/test-agent.ts "Find all scopes in files matching **/auth/*.ts"

# Find by type
npx tsx scripts/test-agent.ts "Find all classes (type='class')"

# Complex query
npx tsx scripts/test-agent.ts "Find all exported functions with more than 3 parameters"
```

### Semantic Search

```bash
# Search by meaning
npx tsx scripts/test-agent.ts "Find code related to user authentication"

# Search and explain
npx tsx scripts/test-agent.ts "Search for error handling code and explain the patterns used"
```

### Relationships

```bash
# What does X depend on?
npx tsx scripts/test-agent.ts "What does the UserService class import?"

# What uses X?
npx tsx scripts/test-agent.ts "What other scopes reference AuthProvider?"
```

### File Operations

```bash
# Read file
npx tsx scripts/test-agent.ts "Read src/utils.ts lines 1-50"

# Edit file (with re-ingestion)
npx tsx scripts/test-agent.ts "Add a JSDoc comment to the add function in calculator.ts"

# Create file
npx tsx scripts/test-agent.ts "Create a new file src/helpers.ts with a formatDate function"
```

---

## Agent Session Logs

The agent logs all tool calls and results:

### Location

```
.ragforge/generated/agent-session-logs.json
```

### Structure

```json
{
  "sessionId": "session_1234567890",
  "question": "Your query",
  "startTime": "2025-12-05T12:00:00.000Z",
  "mode": "structured",
  "tools": ["get_schema", "query_entities", ...],
  "entries": [
    {
      "timestamp": "...",
      "type": "start",
      "data": { "question": "...", "mode": "...", "tools": [...] }
    },
    {
      "timestamp": "...",
      "type": "tool_call",
      "data": { "toolName": "query_entities", "arguments": {...} }
    },
    {
      "timestamp": "...",
      "type": "tool_result",
      "data": { "toolName": "query_entities", "result": {...}, "durationMs": 5 }
    },
    {
      "timestamp": "...",
      "type": "final_answer",
      "data": { "answer": "...", "confidence": "high" }
    }
  ],
  "toolsUsed": ["query_entities", "edit_file"],
  "totalIterations": 0,
  "finalAnswer": "...",
  "endTime": "2025-12-05T12:00:10.000Z"
}
```

---

## Debugging Tips

### 1. Check Tool Calls

Review `agent-session-logs.json` to see exactly what tools the agent called and what parameters it used.

### 2. Verbose Mode

Add logging to see what's happening:

```typescript
// In test-agent.ts, add:
console.log('Tool called:', toolName, JSON.stringify(args, null, 2));
```

### 3. Test Individual Tools

```bash
# Direct Cypher query
npx tsx -e "
import { createRagClient } from './client.js';
const rag = createRagClient();
const result = await rag.client.run('MATCH (s:Scope) WHERE s.name CONTAINS \"auth\" RETURN s.name, s.file LIMIT 5');
console.log(result.records.map(r => ({ name: r.get('s.name'), file: r.get('s.file') })));
await rag.close();
"
```

### 4. Check Embeddings

```bash
# Are embeddings generated?
npx tsx -e "
import { createRagClient } from './client.js';
const rag = createRagClient();
const result = await rag.client.run('MATCH (s:Scope) WHERE s.embedding IS NOT NULL RETURN count(s) as count');
console.log('Scopes with embeddings:', result.records[0].get('count').toNumber());
await rag.close();
"
```

---

## Common Issues

### "No results found"

1. Check if data is ingested:
   ```bash
   npx tsx scripts/ingest-from-source.ts
   ```

2. Check if embeddings exist:
   ```bash
   npx tsx scripts/generate-embeddings.ts
   ```

### "Tool not found"

Rebuild packages and reinstall:

```bash
# From ragforge root
cd /home/luciedefraiteur/LR_CodeRag/ragforge
npm run build

# Reinstall in generated
cd examples/test-project/.ragforge/generated
rm -rf node_modules package-lock.json
npm install
```

### File tool doesn't update RAG

The agent should re-ingest files after modification. Check:

1. `includeFileTools: true` in agent config
2. `onFileModified` callback is set
3. IngestionLock is working

```typescript
const agent = await createRagAgent({
  // ...
  includeFileTools: true,
  projectRoot: '/path/to/project',
  onFileModified: async (path, type) => {
    console.log(`File ${type}: ${path}`);
  },
});
```

---

## Test Scripts Reference

### test-agent.ts

Standard agent test with all tools.

### test-file-tools.ts

```bash
npx tsx packages/core/templates/scripts/test-file-tools.ts /path/to/project
```

Tests read/write/edit file operations.

### test-external-modification.ts

```bash
npx tsx scripts/test-external-modification.ts
```

Tests external file modification detection and IngestionLock coordination.

---

## Creating Custom Tests

```typescript
// custom-test.ts
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRagClient } from '../client.js';
import { createRagAgent } from '@luciformresearch/ragforge-runtime';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

async function main() {
  const rag = createRagClient();

  const agent = await createRagAgent({
    configPath: resolve(__dirname, '../ragforge.config.yaml'),
    ragClient: rag,
    apiKey: process.env.GEMINI_API_KEY!,
    includeFileTools: true,
    projectRoot: resolve(__dirname, '../../..'),
  });

  // Your custom test
  const result = await agent.chat('Your test query');
  console.log('Result:', result);

  await rag.close();
}

main().catch(console.error);
```

---

## Related Documents

- [QUICKSTART.md](./QUICKSTART.md) - Initial setup
- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - Full project context
- [CURRENT-STATE-2025-12-05.md](../visions/tool-generation/CURRENT-STATE-2025-12-05.md) - Technical details
