# LlamaIndex + RagForge - Guide d'Intégration Complet

**Date**: 2025-01-12
**Objectif**: Analyse des opportunités d'intégration de LlamaIndex dans RagForge

---

## 📋 Table des Matières

1. [Résumé Exécutif](#résumé-exécutif)
2. [Multi-Provider LLMs](#1-multi-provider-llms)
3. [Multi-Provider Embeddings](#2-multi-provider-embeddings)
4. [Tool Calling Framework](#3-tool-calling-framework)
5. [Document Loaders](#4-document-loaders)
6. [Use Cases RagForge](#5-use-cases-ragforge)
7. [Plan d'Implémentation](#6-plan-dimplémentation)

---

## Résumé Exécutif

### 🎯 Ce que LlamaIndex apporte à RagForge

| Feature | Status RagForge Actuel | Avec LlamaIndex | Impact |
|---------|------------------------|-----------------|--------|
| **LLM Provider** | 🔒 Gemini uniquement | ✅ 15+ providers | 🟢 High |
| **Embeddings** | 🔒 Gemini uniquement | ✅ 12+ providers | 🟢 High |
| **Tool Calling** | ⚠️ Ad-hoc dans prompts | ✅ FunctionTool standardisé | 🟡 Medium |
| **Document Types** | 🔒 Code (TS/Python) | ✅ PDF, Word, Notion, etc. | 🔵 Very High |
| **Agents** | ⚠️ Custom implementation | ✅ OpenAIAgent, ReActAgent | 🟡 Medium |

### ✅ Quick Wins Immédiats

1. **Multi-Provider Embeddings** (1 semaine) → Users choisissent leur provider
2. **Tool Calling** (1 semaine) → Architecture plus propre
3. **Zéro Breaking Change** → Garder Gemini par défaut

### 🚀 Vision Long Terme

- **RagForge Code** (actuel) → Optimisé codebases TypeScript/Python
- **RagForge Docs** (futur) → Documentation, PDFs, Notion, Confluence
- **RagForge Business** (futur) → Support, legal, HR documents

---

## 1. Multi-Provider LLMs

### Providers Supportés (15+)

#### ☁️ Cloud Providers

```typescript
import {
  OpenAI,        // GPT-4, GPT-3.5-turbo
  Anthropic,     // Claude 3.5 Sonnet, Opus, Haiku
  Gemini,        // Gemini 1.5 Pro/Flash ← RagForge actuel
  Groq,          // Ultra-rapide (Llama, Mixtral)
  MistralAI,     // Mistral Large/Medium/Small
  Fireworks,
  TogetherAI,
  DeepSeek,
  Perplexity
} from "llamaindex";
```

#### 🏠 Local/Open-Source

```typescript
import { Ollama } from "llamaindex";

// Modèles locaux gratuits
const ollama = new Ollama({
  model: "llama3.1:8b"    // ou mistral, gemma, codellama, etc.
});
```

### Configuration

```typescript
import { Settings, Gemini, Anthropic, Ollama } from "llamaindex";

// Option 1: Gemini (compatible avec RagForge actuel - AUCUN CHANGEMENT)
Settings.llm = new Gemini({
  apiKey: process.env.GEMINI_API_KEY,
  model: "models/gemini-1.5-pro"
});

// Option 2: Claude (si user préfère)
Settings.llm = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: "claude-3-5-sonnet-20241022"
});

// Option 3: Ollama (local, gratuit, privé)
Settings.llm = new Ollama({
  model: "llama3.1:70b",
  baseURL: "http://localhost:11434"
});
```

### Dans ragforge.config.yaml

```yaml
# Option 1: Garder Gemini (backward compatible)
llm:
  provider: gemini
  model: models/gemini-1.5-pro
  api_key: ${GEMINI_API_KEY}

# Option 2: Claude
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
  api_key: ${ANTHROPIC_API_KEY}

# Option 3: Local
llm:
  provider: ollama
  model: llama3.1:8b
  base_url: http://localhost:11434
```

**Avantages**:
- ✅ Users choisissent leur provider préféré
- ✅ Option locale gratuite (Ollama)
- ✅ Pas de vendor lock-in
- ✅ Backward compatible (Gemini par défaut)

---

## 2. Multi-Provider Embeddings

### Providers Supportés (12+)

#### ☁️ Cloud

- **OpenAI**: `text-embedding-3-small`, `text-embedding-3-large`, `ada-002`
- **Google Gemini**: `embedding-001` ← **RagForge actuel**
- **Cohere**: `embed-v3` (multilingual)
- **VoyageAI**: Spécialisé embeddings haute qualité
- **JinaAI**: Optimisé pour search
- **Azure OpenAI**
- **AWS Bedrock**
- **MistralAI**

#### 🏠 Local

- **Ollama**: `nomic-embed-text` (768d), `mxbai-embed-large` (1024d)
- **HuggingFace**: BERT, sentence-transformers, etc.

### Configuration Séparée LLM vs Embeddings

```typescript
import { Settings, Gemini, GeminiEmbedding, OpenAIEmbedding, OllamaEmbedding } from "llamaindex";

// Scénario 1: Tout en Gemini (comme RagForge actuellement)
Settings.llm = new Gemini({ model: "gemini-1.5-pro" });
Settings.embedModel = new GeminiEmbedding({ model: "embedding-001" });

// Scénario 2: Mix - Gemini LLM + OpenAI embeddings
Settings.llm = new Gemini({ model: "gemini-1.5-pro" });
Settings.embedModel = new OpenAIEmbedding({
  model: "text-embedding-3-small",
  dimensions: 1536  // Meilleure qualité que Gemini pour certains cas
});

// Scénario 3: 100% local (zéro coût, privacité totale)
Settings.llm = new Ollama({ model: "llama3.1" });
Settings.embedModel = new OllamaEmbedding({
  model: "nomic-embed-text"  // 768 dimensions, excellente qualité
});
```

### Adapter dans RagForge

```typescript
// packages/runtime/src/embeddings/llamaindex-adapter.ts

import { Settings, GeminiEmbedding, OpenAIEmbedding, OllamaEmbedding } from "llamaindex";

export class LlamaIndexEmbeddingAdapter {
  constructor(config: EmbeddingConfig) {
    Settings.embedModel = this.createProvider(config);
  }

  private createProvider(config: EmbeddingConfig) {
    switch (config.provider) {
      case 'gemini':
        return new GeminiEmbedding({
          apiKey: config.apiKey || process.env.GEMINI_API_KEY,
          model: config.model || "embedding-001"
        });

      case 'openai':
        return new OpenAIEmbedding({
          apiKey: config.apiKey || process.env.OPENAI_API_KEY,
          model: config.model || "text-embedding-3-small",
          dimensions: config.dimension || 1536
        });

      case 'ollama':
        return new OllamaEmbedding({
          model: config.model || "nomic-embed-text",
          baseURL: config.baseUrl || "http://localhost:11434"
        });

      default:
        throw new Error(`Unknown embedding provider: ${config.provider}`);
    }
  }

  async embed(text: string): Promise<number[]> {
    return await Settings.embedModel.getTextEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}
```

### Config ragforge.config.yaml

```yaml
embeddings:
  provider: gemini        # ou openai, ollama, cohere, voyage
  model: embedding-001
  dimension: 768
  # api_key: ${GEMINI_API_KEY}  # optionnel si déjà dans .env
```

### Comparaison des Providers

| Provider | Dim | Coût (1M tokens) | Qualité | Latence | Use Case |
|----------|-----|------------------|---------|---------|----------|
| **Gemini** | 768 | Gratuit (beta) | ⭐⭐⭐⭐ | 🟢 Rapide | General purpose |
| **OpenAI 3-small** | 1536 | $0.02 | ⭐⭐⭐⭐ | 🟢 Rapide | Balance coût/qualité |
| **OpenAI 3-large** | 3072 | $0.13 | ⭐⭐⭐⭐⭐ | 🟡 Moyen | Max qualité |
| **Ollama (nomic)** | 768 | $0.00 (local) | ⭐⭐⭐⭐ | 🟢 Très rapide | Privacité/gratuit |
| **Voyage** | 1024 | $0.05 | ⭐⭐⭐⭐⭐ | 🟡 Moyen | Domain-specific |
| **Cohere v3** | 1024 | $0.10 | ⭐⭐⭐⭐ | 🟢 Rapide | Multilingual |

---

## 3. Tool Calling Framework

### Problème Actuel

RagForge construit tools **manuellement dans les prompts**:
- Pas de validation de schéma
- Pas de type safety
- Difficile d'ajouter de nouveaux tools
- Code dupliqué

### Solution: FunctionTool

```typescript
import { FunctionTool, OpenAIAgent } from "llamaindex";
import { createRagClient } from "@luciformresearch/ragforge-runtime";

const rag = createRagClient(config);

// 1. Tool: Semantic Search
const searchTool = FunctionTool.from(
  async ({ query, topK }: { query: string; topK?: number }) => {
    return await rag.scope()
      .semanticSearchBySource(query, { topK: topK || 10 })
      .execute();
  },
  {
    name: "search_code",
    description: "Search code entities using semantic embeddings",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language query (e.g., 'authentication functions')"
        },
        topK: {
          type: "number",
          description: "Number of results",
          default: 10
        }
      },
      required: ["query"]
    }
  }
);

// 2. Tool: Traverse Relationships
const traverseTool = FunctionTool.from(
  async ({ entityId, relationship, depth }: {
    entityId: string;
    relationship: string;
    depth?: number;
  }) => {
    const entity = await rag.scope().findById(entityId);
    return await entity.traverse(relationship, depth || 1);
  },
  {
    name: "traverse_graph",
    description: "Traverse relationships in the code graph",
    parameters: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        relationship: {
          type: "string",
          enum: ["IMPORTS", "CALLS", "REFERENCES", "DEFINES"]
        },
        depth: { type: "number", default: 1 }
      },
      required: ["entityId", "relationship"]
    }
  }
);

// 3. Agent avec tools
const agent = new OpenAIAgent({
  llm: new Gemini({ apiKey: process.env.GEMINI_API_KEY }), // ← Gemini!
  tools: [searchTool, traverseTool],
  verbose: true
});

// 4. Usage
const response = await agent.chat({
  message: "Find all JWT authentication functions and show their dependencies"
});

console.log(response.message.content);
```

### RagForgeToolkit (Wrapper Complet)

```typescript
// packages/runtime/src/integrations/llamaindex-toolkit.ts

export class RagForgeToolkit {
  constructor(private rag: RagClient) {}

  createTools(): FunctionTool[] {
    return [
      this.createSearchTool(),
      this.createFilterTool(),
      this.createTraverseTool(),
      this.createRerankTool(),
      this.createFindByIdTool()
    ];
  }

  createAgent(systemPrompt?: string): OpenAIAgent {
    return new OpenAIAgent({
      tools: this.createTools(),
      systemPrompt: systemPrompt || this.getDefaultPrompt(),
      verbose: true
    });
  }

  private getDefaultPrompt(): string {
    return `You are a code analysis assistant with access to a Neo4j knowledge graph.

Available tools:
- search_code: Find code by semantic search
- filter_by: Filter entities by properties
- traverse_graph: Explore relationships
- rerank_results: Re-rank with LLM reasoning
- find_by_id: Get entity by ID

Use these tools to answer questions about code structure and dependencies.`;
  }
}

// Usage simple
const toolkit = new RagForgeToolkit(rag);
const agent = toolkit.createAgent();

const answer = await agent.chat({
  message: "Analyze the security of our authentication module"
});
```

**Avantages**:
- ✅ Validation automatique
- ✅ Type safety TypeScript
- ✅ Compatible tous LLM providers
- ✅ Standardisé (OpenAI/Anthropic format)
- ✅ Error handling intégré

---

## 4. Document Loaders

### Built-in Readers (Core Package)

LlamaIndex TypeScript inclut nativement:

```typescript
import {
  PDFReader,           // .pdf
  MarkdownReader,      // .md
  JSONReader,          // .json
  CSVReader,           // .csv
  DocxReader,          // .docx (Word)
  HTMLReader,          // .html
  TextFileReader,      // .txt
  ImageReader,         // .jpg, .png, .gif
  SimpleDirectoryReader // Lit tout un dossier
} from "llamaindex";

// Exemple: Lire tous les PDFs d'un dossier
const reader = new SimpleDirectoryReader();
const documents = await reader.loadData("./company-docs");

// documents = [Document, Document, ...]
// Chaque Document a: text, metadata, etc.
```

### Readers Additionnels (@llamaindex/readers)

**Installation**:
```bash
npm install @llamaindex/readers
```

**Disponibles** (confirmés dans la documentation):
- `@llamaindex/readers/pdf` - PDFs
- `@llamaindex/readers/markdown` - Markdown
- `@llamaindex/readers/json` - JSON
- `@llamaindex/readers/csv` - CSV
- `@llamaindex/readers/notion` - Notion pages
- `@llamaindex/readers/discord` - Discord messages

### LlamaParse (Service Cloud)

**LlamaParse** = Service premium pour parsing avancé:
- 📊 **Tables** → Markdown structuré
- 🖼️ **Images** → OCR extraction
- 📐 **Layouts complexes** → Préservation structure
- 🌍 **Multilingue** → Support 85+ langues

```typescript
import { LlamaParseReader } from "llamaindex";

const parser = new LlamaParseReader({
  apiKey: process.env.LLAMA_CLOUD_API_KEY,
  resultType: "markdown",  // ou "text" ou "json"
  language: "fr"
});

const docs = await parser.loadData("./complex-report.pdf");
```

**Pricing**: 1000 pages/jour gratuit, puis $0.003/page

### Readers Probables (Basé sur Python)

Ces readers existent en **Python** et devraient être disponibles en TypeScript (à vérifier):

#### 📄 Documents
- Google Docs/Sheets/Slides
- Excel (.xlsx)
- PowerPoint (.pptx)
- Obsidian notes

#### 🗣️ Communication
- Slack
- Discord ✅ (confirmé)
- Email (Gmail)
- Telegram

#### 🗄️ Databases
- MongoDB
- PostgreSQL
- MySQL
- Redis

#### 🌐 Web & Cloud
- Confluence
- GitHub repos
- GitLab repos
- Web scraping
- RSS feeds
- Google Drive
- Dropbox
- OneDrive

**Note**: Pour la liste exacte TypeScript, il faut check le repo GitHub packages/readers/

---

## 5. Use Cases RagForge

### Use Case 1: RagForge Code (Actuel) + LlamaIndex

**Amélioration immédiate** sans changer le domaine:

```yaml
# ragforge.config.yaml
name: company-codebase
domain: code

# NOUVEAU: Multi-provider embeddings
embeddings:
  provider: ollama  # Gratuit + local
  model: nomic-embed-text
  dimension: 768

# NOUVEAU: Multi-provider LLM
llm:
  provider: anthropic  # Si user préfère Claude
  model: claude-3-5-sonnet-20241022

entities:
  - name: Scope
    # ... reste identique
```

**Bénéfices**:
- ✅ Users choisissent leur provider
- ✅ Option locale gratuite
- ✅ Pas de changement aux types générés
- ✅ Agents plus puissants (FunctionTool)

### Use Case 2: RagForge Docs (Nouveau Produit)

**Nouveau framework** pour documentation d'entreprise:

```yaml
# ragforge-docs.config.yaml
name: company-knowledge-base
domain: documentation

entities:
  - name: Document
    searchable_fields:
      - { name: title, type: string }
      - { name: category, type: string }
      - { name: source, type: string }
      - { name: author, type: string }
      - { name: last_updated, type: date }
    vector_indexes:
      - name: docEmbeddings
        field: embedding
        source_field: content
        model: gemini-embedding-001
        dimension: 768

# NOUVEAU: Data sources
data_sources:
  - type: notion
    config:
      integration_token: ${NOTION_TOKEN}
      database_ids: ["abc123", "def456"]

  - type: confluence
    config:
      base_url: https://company.atlassian.net
      space_keys: ["DOCS", "WIKI"]
      username: ${CONFLUENCE_USER}
      api_token: ${CONFLUENCE_TOKEN}

  - type: pdf_directory
    config:
      path: ./company-pdfs
      recursive: true
      use_llamaparse: true  # Tables + images

  - type: markdown_directory
    config:
      path: ./docs
```

**Génération**:
```bash
ragforge generate --config ragforge-docs.config.yaml
```

**Client généré**:
```typescript
const rag = createRagClient(config);

// Recherche unifiée dans toutes les sources
const results = await rag
  .document()
  .semanticSearch("comment configurer OAuth 2.0?")
  .whereSource(['notion', 'confluence', 'pdf'])
  .whereCategory('security')
  .execute();

// results = [
//   { title: "OAuth Setup Guide", source: "notion", ... },
//   { title: "Security Confluence", source: "confluence", ... },
//   { title: "Auth Standards.pdf", source: "pdf", ... }
// ]
```

### Use Case 3: RagForge Mixed (Code + Docs)

**Combiner** code ET documentation:

```yaml
name: full-stack-knowledge
domain: mixed

entities:
  - name: CodeEntity
    # Parser TypeScript/Python

  - name: Document
    # Loaders LlamaIndex

data_sources:
  - type: code_parser
    config:
      languages: [typescript, python]
      root: ./src

  - type: notion
    config: { ... }

  - type: confluence
    config: { ... }
```

**Query qui search partout**:
```typescript
const results = await rag
  .search("how does authentication work?")  // Generic search
  .execute();

// Retourne:
// - Code: AuthService.ts, login(), validateToken()
// - Docs: "OAuth Setup Guide" (Notion), "Security Best Practices" (Confluence)
```

---

## 6. Plan d'Implémentation

### Phase 1: Multi-Provider Support (Week 1-2)

**Objectif**: Permettre aux users de choisir leur provider

**Tasks**:
- [ ] `npm install llamaindex`
- [ ] Créer `LlamaIndexEmbeddingAdapter`
- [ ] Ajouter config `embeddings.provider` dans YAML
- [ ] Backward compatible (Gemini par défaut)
- [ ] Tests avec Gemini, OpenAI, Ollama
- [ ] Documentation

**Effort**: 🟢 Low
**Impact**: 🟢 High
**Risque**: 🟢 Low

**Deliverable**: Users peuvent faire:
```yaml
embeddings:
  provider: ollama  # ou gemini, openai
  model: nomic-embed-text
```

### Phase 2: Tool Calling Framework (Week 2-3)

**Objectif**: Architecture propre pour agents

**Tasks**:
- [ ] Créer `RagForgeToolkit` class
- [ ] Convertir 5 opérations en FunctionTools:
  - semantic_search
  - filter_by
  - traverse_graph
  - rerank_results
  - find_by_id
- [ ] Créer agent example
- [ ] Tests d'intégration
- [ ] Documentation

**Effort**: 🟢 Low
**Impact**: 🟡 Medium
**Risque**: 🟢 Low

**Deliverable**:
```typescript
const toolkit = new RagForgeToolkit(rag);
const agent = toolkit.createAgent();
await agent.chat({ message: "..." });
```

### Phase 3: Document Loaders (Week 4-8)

**Objectif**: RagForge pour documents (nouveau produit)

**Tasks**:
- [ ] Design `data_sources` section dans YAML
- [ ] Intégrer SimpleDirectoryReader (PDF, Word, etc.)
- [ ] Intégrer Notion reader
- [ ] Intégrer Confluence reader
- [ ] Adapter generator pour documents
- [ ] Nouvelle entity "Document"
- [ ] Tests end-to-end
- [ ] Documentation + examples

**Effort**: 🟡 Medium
**Impact**: 🔵 Very High
**Risque**: 🟡 Medium

**Deliverable**: RagForge fonctionne pour documentation!

### Phase 4: Advanced Features (Week 9-12)

**Objectif**: Features avancées

**Tasks**:
- [ ] Multi-source query engine
- [ ] ReActAgent (multi-step reasoning)
- [ ] Workflows event-driven
- [ ] LlamaParse integration (tables, images)
- [ ] Hybrid search (code + docs)

**Effort**: 🟡 Medium
**Impact**: 🟢 High
**Risque**: 🟡 Medium

---

## Installation & Quick Start

### 1. Installation

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime

# Core
npm install llamaindex

# Providers (optionnels)
npm install @llamaindex/google      # Gemini
npm install @llamaindex/openai      # OpenAI
npm install @llamaindex/anthropic   # Claude

# Readers (optionnels)
npm install @llamaindex/readers
```

### 2. Test Multi-Provider Embeddings

```typescript
import { Settings, GeminiEmbedding, OllamaEmbedding } from "llamaindex";

// Test 1: Gemini (actuel RagForge)
Settings.embedModel = new GeminiEmbedding({
  apiKey: process.env.GEMINI_API_KEY
});

const embedding1 = await Settings.embedModel.getTextEmbedding("hello world");
console.log("Gemini embedding:", embedding1.length);  // 768

// Test 2: Ollama (local, gratuit)
Settings.embedModel = new OllamaEmbedding({
  model: "nomic-embed-text"
});

const embedding2 = await Settings.embedModel.getTextEmbedding("hello world");
console.log("Ollama embedding:", embedding2.length);  // 768
```

### 3. Test Tool Calling

```typescript
import { FunctionTool, OpenAIAgent, Gemini } from "llamaindex";

// Créer un tool simple
const sumTool = FunctionTool.from(
  ({ a, b }: { a: number; b: number }) => a + b,
  {
    name: "sum",
    description: "Add two numbers",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" }
      },
      required: ["a", "b"]
    }
  }
);

// Agent avec Gemini
const agent = new OpenAIAgent({
  llm: new Gemini({ apiKey: process.env.GEMINI_API_KEY }),
  tools: [sumTool]
});

const response = await agent.chat({
  message: "What is 5 + 7?"
});

console.log(response.message.content);  // "5 + 7 = 12"
```

### 4. Test Document Loading

```typescript
import { SimpleDirectoryReader, PDFReader } from "llamaindex";

// Lire tous les fichiers d'un dossier
const reader = new SimpleDirectoryReader();
const documents = await reader.loadData("./test-docs");

console.log(`Loaded ${documents.length} documents`);
documents.forEach(doc => {
  console.log(`- ${doc.metadata.file_name}: ${doc.text.length} chars`);
});

// Lire un PDF spécifique
const pdfReader = new PDFReader();
const pdfDocs = await pdfReader.loadData("./test.pdf");
console.log(`PDF content: ${pdfDocs[0].text}`);
```

---

## Conclusion

### Résumé des Bénéfices

| Feature | Effort | Impact | ROI |
|---------|--------|--------|-----|
| **Multi-Provider Embeddings** | 🟢 Low (1-2 sem) | 🟢 High | ⭐⭐⭐⭐⭐ |
| **Tool Calling** | 🟢 Low (1-2 sem) | 🟡 Medium | ⭐⭐⭐⭐ |
| **Document Loaders** | 🟡 Medium (4-6 sem) | 🔵 Very High | ⭐⭐⭐⭐⭐ |
| **Advanced Agents** | 🟡 Medium (3-4 sem) | 🟢 High | ⭐⭐⭐⭐ |

### Recommandation

**Start Small** (Phase 1-2):
1. Multi-provider embeddings (1-2 semaines)
2. Tool calling framework (1-2 semaines)

**Total**: 2-4 semaines, impact immédiat, zéro breaking change

**Expand Later** (Phase 3-4):
- Document loaders → **Nouveau marché** (docs, support, legal)
- Advanced features → Différenciation

### Next Steps

1. ✅ Installer LlamaIndex: `npm install llamaindex`
2. ✅ Tester multi-provider embeddings (Gemini vs Ollama)
3. ✅ POC RagForgeToolkit avec 2-3 tools
4. ✅ Décider: Phase 1-2 ou direct Phase 3?

---

**Questions? Prêt à démarrer?** 🚀
