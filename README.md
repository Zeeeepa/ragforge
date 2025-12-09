# RagForge

**Universal RAG Agent with Persistent Local Brain**

> Transform any codebase, documents, or web content into a searchable knowledge graph with AI-powered tools.

### License – Luciform Research Source License (LRSL) v1.1

**© 2025 Luciform Research. All rights reserved except as granted below.**

- **Free to use for:** Research, education, personal projects, freelance/small-scale (≤ €100k/month revenue)
- **Commercial use above threshold** requires separate agreement
- **Contact:** [legal@luciformresearch.com](mailto:legal@luciformresearch.com)
- **Full text:** [LICENSE](./LICENSE)

---

## What is RagForge?

RagForge is an **AI agent framework** with a **local persistent brain** (`~/.ragforge`):

- **Daemon architecture** - Wakes on demand, shuts down cleanly
- **File watching** - Incremental ingestion on file changes
- **Diff-aware updates** - Only re-parse what changed
- **Multi-project support** - Work on multiple codebases simultaneously
- **Optimized for scale** - Handles very large projects efficiently

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT BRAIN (~/.ragforge)              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Neo4j + Embeddings               │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │Project A │ │Quick     │ │Web Pages │            │   │
│  │  │(code)    │ │Ingest    │ │(docs)    │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │                     ↓                               │   │
│  │         Unified Semantic Search                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  FILE WATCHER → Incremental Ingestion → Graph Update       │
└─────────────────────────────────────────────────────────────┘
```

---

## Ingestion Capabilities

### Code
| Language | Parser |
|----------|--------|
| TypeScript, TSX | Full AST with scope extraction |
| JavaScript, JSX | Full AST parsing |
| Python | AST with class/function extraction |
| Vue, Svelte | SFC parsing with script extraction |
| HTML, CSS, SCSS | Structure extraction |
| Other languages | Regex-based fallback parser |

### Documents
| Format | Method |
|--------|--------|
| PDF | Tika + Gemini Vision fallback |
| DOCX | Native parsing |
| XLSX | Sheet/cell extraction |
| Markdown | Section/heading parsing |
| JSON, YAML | Structure extraction |
| CSV | Row/column parsing |

### 3D & Media
| Format | Features |
|--------|----------|
| glTF, GLB | Metadata + multi-view rendering |
| OBJ | Geometry extraction |
| Images (PNG, JPG...) | OCR + Vision + Embeddings |

### Web
| Feature | Description |
|---------|-------------|
| Web crawling | Recursive depth with link following |
| JS rendering | Playwright for dynamic pages |
| Grounding | Web search for real-time info |
| LRU cache | Last 6 pages for quick re-access |

---

## Search & Understanding

| Feature | Description |
|---------|-------------|
| **Semantic Search** | Ultra-fast vector embeddings via Gemini |
| **Fuzzy Search** | Levenshtein matching without ingestion |
| **Smart Grep** | Regex search across all files |
| **Signature filtering** | Filter by function signature, docstring, type |
| **Custom Cypher** | Direct graph queries |
| **Consistency locks** | Search blocked during ingestion for coherence |

---

## Agentic Capabilities

Compatible with local models and cloud APIs:

| Feature | Description |
|---------|-------------|
| **Structured queries** | Prompts applied to responses |
| **Batch processing** | Efficient bulk operations |
| **File editing** | Read/write/edit with auto-ingest |
| **Shell execution** | Whitelisted commands |
| **Recursive sub-agents** | Spawn agents for complex tasks |
| **MCP exposure** | Full tool access for advanced models |

---

## Media Generation

| Tool | Description |
|------|-------------|
| `generate_image` | Text-to-image via Gemini |
| `edit_image` | AI-powered image editing |
| `generate_multiview_images` | 4 coherent views for 3D |
| `generate_3d_from_text` | Full text-to-3D pipeline |
| `generate_3d_from_image` | Image-to-3D via Trellis |
| `render_3d_asset` | Multi-view 3D rendering |
| `analyze_3d_model` | Vision analysis of 3D assets |

---

## Quick Start

### 1. Install

```bash
npm install -g @luciformresearch/ragforge-cli
```

### 2. Setup credentials

```bash
# ~/.ragforge/.env (global) or project/.ragforge/.env
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
GEMINI_API_KEY=your-gemini-key        # For embeddings & image gen
REPLICATE_API_TOKEN=your-token        # For 3D generation (optional)
```

### 3. Talk to the agent

```bash
# Ask a question about your codebase
ragforge agent --ask "What functions handle authentication?"

# Create a new project
ragforge agent --ask "Create a TypeScript project called my-api"

# Ingest and search web content
ragforge agent --ask "Fetch the React docs and explain hooks"

# Generate media
ragforge agent --ask "Generate a 3D model of a rubber duck"
```

---

## MCP Server

RagForge exposes all tools via **Model Context Protocol** for use with Claude, GPT, and other MCP-compatible clients:

```json
{
  "mcpServers": {
    "ragforge": {
      "command": "ragforge",
      "args": ["mcp"]
    }
  }
}
```

Available tools via MCP:
- `brain_search`, `ingest_directory`, `ingest_web_page`
- `read_file`, `write_file`, `edit_file`, `delete_path`
- `run_command`, `git_status`, `git_diff`
- `generate_image`, `generate_3d_from_text`, `render_3d_asset`
- `fetch_web_page`, `search_web`
- `exclude_project`, `include_project` (filter brain search)

---

## Project Structure

```
ragforge/
├── packages/
│   ├── core/              # Main package
│   │   ├── src/
│   │   │   ├── brain/           # BrainManager, knowledge persistence
│   │   │   ├── runtime/
│   │   │   │   ├── adapters/    # File parsers (code, docs, media, web)
│   │   │   │   ├── agents/      # RAG agent implementation
│   │   │   │   ├── projects/    # ProjectRegistry, multi-project
│   │   │   │   └── ingestion/   # Incremental ingestion, file watcher
│   │   │   └── tools/           # Agent tools (file, image, 3D, web, brain)
│   │   └── defaults/            # Default YAML configs
│   │
│   └── cli/               # CLI commands (agent, mcp, ingest)
│
├── docs/project/          # Design docs and session notes
└── examples/              # Example projects
```

---

## Roadmap

- [x] Persistent brain with Neo4j
- [x] Universal file ingestion
- [x] Semantic search with embeddings
- [x] Web crawling & grounding
- [x] Image & 3D generation
- [x] MCP server integration
- [x] Project exclusion from search
- [ ] API crawler (Swagger/OpenAPI)
- [ ] Database crawler (schema extraction)
- [ ] Terminal UI with Ink (React)
- [ ] Collaborative multi-agent workflows

---

## Development

```bash
# Clone and install
git clone https://github.com/LuciformResearch/ragforge
cd ragforge
npm install

# Build all packages
npm run build

# Run tests
npm test
```

---

## Links

- [GitHub Repository](https://github.com/LuciformResearch/ragforge)
- [npm Packages](https://www.npmjs.com/search?q=%40luciformresearch%2Fragforge)

---

**#RAGForge #LuciformResearch #RAG #LLM #Agentic #DevTools #AIEngineering #Neo4j #MCP**
