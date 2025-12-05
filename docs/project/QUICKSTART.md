# RagForge Quickstart

**Last Updated**: 2025-12-05
**Time to Complete**: 5-10 minutes

---

## Prerequisites

- Node.js >= 18
- Docker (for Neo4j)
- Gemini API key

---

## Option A: Create New Project (Recommended)

### 1. Create Project with RagForge

```bash
# Using global CLI
npx @luciformresearch/ragforge-cli create my-project

# Or with local development version
cd /home/luciedefraiteur/LR_CodeRag/ragforge
npm run build
node packages/cli/dist/esm/index.js create my-project --path ~/projects --dev
```

This creates:
```
my-project/
├── package.json
├── tsconfig.json
├── src/index.ts
└── .ragforge/
    ├── ragforge.config.yaml
    ├── docker-compose.yml
    ├── .env
    └── generated/
        ├── client.ts
        ├── package.json
        └── scripts/
```

### 2. Start Neo4j

```bash
cd my-project/.ragforge
docker-compose up -d
```

### 3. Configure API Keys

```bash
# Edit .ragforge/.env
GEMINI_API_KEY=your_api_key_here
```

### 4. Ingest Your Code

```bash
cd my-project/.ragforge/generated
npm install
npx tsx scripts/ingest-from-source.ts
```

### 5. Generate Embeddings

```bash
npx tsx scripts/generate-embeddings.ts
```

### 6. Test the Agent

```bash
npx tsx scripts/test-agent.ts "What functions are in this project?"
```

---

## Option B: Add RagForge to Existing Project

### 1. Initialize RagForge

```bash
cd /path/to/your/project

# Using global CLI
npx @luciformresearch/ragforge-cli quickstart

# Or with local dev version
node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js quickstart --dev
```

### 2. Follow Prompts

The CLI will:
1. Create `.ragforge/` directory
2. Generate `ragforge.config.yaml`
3. Create `docker-compose.yml` for Neo4j
4. Generate client code

### 3. Start Neo4j & Ingest

```bash
cd .ragforge
docker-compose up -d

cd generated
npm install
npx tsx scripts/ingest-from-source.ts
npx tsx scripts/generate-embeddings.ts
```

---

## Configuration

### ragforge.config.yaml

```yaml
# Neo4j connection
neo4j:
  uri: bolt://localhost:7687
  username: neo4j
  password: password123
  database: neo4j

# Source code to analyze
source:
  type: code
  adapter: typescript
  root: ..                    # Parent directory
  include:
    - "src/**/*.ts"
    - "src/**/*.tsx"
  exclude:
    - "**/node_modules/**"
    - "**/dist/**"
    - "**/*.test.ts"

# Entities to extract
entities:
  - name: Scope
    primaryKey: uuid
    searchable_fields:
      - name
      - signature
      - file

# Embeddings configuration
embeddings:
  provider: gemini
  model: text-embedding-004
  dimensions: 768
  entities:
    Scope:
      fields: [signature, name]
```

---

## Build & Run Commands

### Development Mode (Local RagForge)

```bash
# 1. Build ragforge packages
cd /home/luciedefraiteur/LR_CodeRag/ragforge
npm run build

# 2. Use --dev flag to use local file: dependencies
node packages/cli/dist/esm/index.js create test-app --dev

# 3. Or create alias
alias ragforge-dev="node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js"
ragforge-dev quickstart --dev
```

### Production Mode (NPM Packages)

```bash
# Uses published npm packages
npx @luciformresearch/ragforge-cli create my-app
npx @luciformresearch/ragforge-cli quickstart
```

---

## Common Scripts

All scripts are in `.ragforge/generated/scripts/`:

| Script | Description |
|--------|-------------|
| `ingest-from-source.ts` | Parse code and create Neo4j nodes |
| `generate-embeddings.ts` | Generate vector embeddings for semantic search |
| `create-vector-indexes.ts` | Create Neo4j vector indexes |
| `test-agent.ts` | Test the RAG agent with a query |

```bash
# Full re-ingest
npx tsx scripts/ingest-from-source.ts

# Only generate missing embeddings
npx tsx scripts/generate-embeddings.ts --only-dirty

# Test agent
npx tsx scripts/test-agent.ts "Find all authentication classes"
```

---

## Environment Variables

### .env file

```bash
# Neo4j
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=password123
NEO4J_DATABASE=neo4j

# Embeddings (Gemini)
GEMINI_API_KEY=your_gemini_api_key

# Agent LLM (optional, for different providers)
GOOGLE_API_KEY=your_google_api_key
```

---

## Verify Installation

### Check Neo4j Connection

```bash
cd .ragforge/generated
npx tsx -e "
import { createRagClient } from './client.js';
const rag = createRagClient();
const result = await rag.client.run('RETURN 1 as n');
console.log('Connected!', result.records[0].get('n'));
await rag.close();
"
```

### Check Ingested Data

```bash
npx tsx -e "
import { createRagClient } from './client.js';
const rag = createRagClient();
const result = await rag.client.run('MATCH (s:Scope) RETURN count(s) as count');
console.log('Scopes:', result.records[0].get('count').toNumber());
await rag.close();
"
```

---

## Troubleshooting

### "Cannot find module" Errors

```bash
cd .ragforge/generated
rm -rf node_modules package-lock.json
npm install
```

### Neo4j Connection Refused

```bash
# Check if container is running
docker ps

# Start if not running
cd .ragforge
docker-compose up -d

# Check logs
docker-compose logs neo4j
```

### Embeddings Not Working

1. Check API key in `.env`
2. Ensure vector indexes exist:
   ```bash
   npx tsx scripts/create-vector-indexes.ts
   ```
3. Regenerate embeddings:
   ```bash
   npx tsx scripts/generate-embeddings.ts
   ```

---

## Next Steps

1. [AGENT-TESTING.md](./AGENT-TESTING.md) - Test and debug the agent
2. [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - Full project documentation
3. [CODEPARSERS.md](./CODEPARSERS.md) - Parser documentation

---

## Example Projects

### langchainjs-analysis

Complete example analyzing LangChain.js:

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/examples/langchainjs-analysis
cat ragforge.config.yaml

cd generated
npm install
npx tsx scripts/test-agent.ts "How does BaseChain work?"
```

### test-project

Simple test project for development:

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/examples/test-project
cd .ragforge/generated
npx tsx scripts/test-agent.ts "List all functions"
```
