# Reddit Post for r/ContextEngineering

## Title (choose one):

**Option A (subtil):**
> Built a Neo4j-based RAG framework with hybrid search (BM25 + Vector + RRF fusion) - Portfolio & looking for opportunities

**Option B (plus direct):**
> New Portfolio: RAG Systems with Neo4j Knowledge Graphs, Hybrid Search, and Cross-file Dependency Extraction - Open to Work

**Option C (technique-focused):**
> Shipping: Persistent AI Memory with Neo4j + Hybrid Search (Vector + BM25 + RRF) + Code Dependency Graphs

---

## Post content:

Hey r/ContextEngineering,

I've been building developer tools around RAG and knowledge graphs for the past year, and just launched my portfolio: **[luciformresearch.com](https://luciformresearch.com)**

### What I've built

**RagForge** - An MCP server that gives Claude persistent memory through a Neo4j knowledge graph. The core idea: everything the AI reads, searches, or analyzes gets stored and becomes searchable across sessions.

Key technical bits:
- **Hybrid Search**: Combines vector similarity (Gemini/Ollama/TEI embeddings) with BM25 full-text search, fused via Reciprocal Rank Fusion (RRF). The k=60 constant from the original RRF paper works surprisingly well
- **Knowledge Graph**: Neo4j stores code scopes (functions, classes, methods), their relationships (imports, inheritance, function calls), and cross-file dependencies
- **Multi-modal ingestion**: Code (13 languages via tree-sitter WASM), documents (PDF, DOCX), web pages (headless browser rendering), images (OCR + vision)
- **Entity Extraction**: GLiNER running on GPU for named entity recognition, with domain-specific configs (legal docs, ecommerce, etc.)
- **Incremental updates**: File watchers detect changes and re-ingest only what's modified

**CodeParsers** - Tree-sitter WASM bindings with a unified API across TypeScript, Python, C, C++, C#, Go, Rust, Vue, Svelte, etc. Extracts AST scopes and builds cross-file dependency graphs.

### Architecture

```
Claude/MCP Client
       │
       ▼
   RagForge MCP Server
       │
   ┌───┴───┬───────────┐
   ▼       ▼           ▼
 Neo4j   GLiNER      TEI
 (graph) (entities)  (embeddings)
```

Everything runs locally via Docker. GPU acceleration optional but recommended for embeddings/NER.

### Why I'm posting

I'm currently looking for opportunities in the RAG/AI infrastructure space. If you're building something similar or need someone who's gone deep on knowledge graphs + retrieval systems, I'd love to chat.

The code is source-available on GitHub under @LuciformResearch. Happy to answer questions about the implementation.

---

**Links:**
- Portfolio: [luciformresearch.com](https://luciformresearch.com)
- GitHub: [github.com/LuciformResearch](https://github.com/LuciformResearch)
- npm: [@luciformresearch](https://www.npmjs.com/~luciformresearch)
- LinkedIn: [linkedin.com/in/lucie-defraiteur-8b3ab6b2](https://www.linkedin.com/in/lucie-defraiteur-8b3ab6b2/)
