# Tool Calling Agent - Self-Analysis Example

This example demonstrates **tool calling** with `StructuredLLMExecutor` using RagForge's own codebase as the knowledge base.

## What's This?

A RAG framework generated from RagForge's source code (`/ragforge/packages`), used to test and demonstrate:
- **Tool calling** in structured LLM execution
- **Agentic workflows** with code search tools
- **Self-analysis**: Using RagForge to understand RagForge

## Quick Start

### 1. Setup (First Time Only)

```bash
cd examples/tool-calling-agent
./setup.sh
```

This will:
- ✅ Check if Neo4j container is running (start it if needed)
- ✅ Verify database has data (re-ingest if empty)
- ✅ Check all dependencies are installed

### 2. Run Examples

```bash
# Basic tool calling test
npm run test:tools

# Agent with iterative tool use
npm run test:agent

# Interactive query mode
npm run query
```

## Architecture

```
┌─────────────────────────────────────┐
│  LLM (Gemini)                       │
│  + Tool Calling Support             │
└──────────┬──────────────────────────┘
           │
           │ Uses tools to search
           ↓
┌─────────────────────────────────────┐
│  RagForge Client (Generated)        │
│  • search_functions(name)           │
│  • search_by_relationship(type)     │
│  • get_file_content(path)           │
└──────────┬──────────────────────────┘
           │
           │ Queries
           ↓
┌─────────────────────────────────────┐
│  Neo4j Knowledge Graph              │
│  • 900+ scopes (functions, classes) │
│  • 4500+ relationships              │
│  • Full ragforge/packages codebase  │
└─────────────────────────────────────┘
```

## Configuration

- **Source Code**: `/ragforge/packages` (TypeScript monorepo)
- **Neo4j**: `bolt://localhost:7691` (custom port to avoid conflicts)
- **Database**: Pre-populated with RagForge codebase structure

## Environment

The `.env` file contains:
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` - Database connection
- `GEMINI_API_KEY` - Required for LLM and embeddings

**Note**: `.env` is gitignored. In dev mode, `quickstart` copies it from monorepo root automatically.

## Files Structure

```
tool-calling-agent/
├── README.md              # This file
├── setup.sh               # Setup script (idempotent)
├── .env                   # Environment (gitignored)
├── docker-compose.yml     # Neo4j container
├── ragforge.config.yaml   # Source configuration
│
├── client.ts              # Generated RAG client
├── types.ts               # Generated types
├── queries/               # Pre-built queries
├── examples/              # Usage examples
│
└── tests/                 # Tool calling tests
    ├── test-tools-basic.ts
    ├── test-tools-agent.ts
    └── test-tools-advanced.ts
```

## Development

### Re-generate Framework

If you need to regenerate after schema changes:

```bash
cd ../../  # Back to ragforge root
npm run quickstart -- --root packages --dev --force
```

### Reset Database

```bash
npm run clean-db
npm run ingest
```

## Examples

See `examples/` for ready-to-run demos:
- `01-semantic-search-source.ts` - Find similar code
- `07-llm-reranking.ts` - Smart relevance ranking
- Custom tool calling examples in `tests/`
