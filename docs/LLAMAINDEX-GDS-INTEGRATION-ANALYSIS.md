# LlamaIndex & Neo4j GDS Integration Analysis for RagForge

**Date**: 2025-01-12
**Author**: Analysis based on RagForge architecture exploration and LlamaIndex/Neo4j GDS research

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [RagForge Current Architecture](#ragforge-current-architecture)
3. [LlamaIndex Integration Opportunities](#llamaindex-integration-opportunities)
4. [Neo4j Graph Data Science Plugin](#neo4j-graph-data-science-plugin)
5. [Concrete Integration Proposals](#concrete-integration-proposals)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Installation Guide](#installation-guide)

---

## Executive Summary

### TL;DR

**LlamaIndex** peut apporter à RagForge:
- 🛠️ **Tool calling framework** standardisé et éprouvé
- 🤖 **Agent orchestration** avec OpenAIAgent, ReActAgent
- 📚 **Query engines** sophistiqués pour RAG multi-sources
- 🔌 **Ecosystem** d'intégrations (150+ data connectors)

**Neo4j GDS** peut enrichir RagForge avec:
- 📊 **Graph analytics** avancés (PageRank, centrality, community detection)
- 🧠 **Graph embeddings** (FastRP, GraphSAGE, Node2Vec)
- 🔗 **Link prediction** pour suggestions intelligentes
- 🎯 **Code importance scoring** basé sur la structure du graphe

### Recommendation Strategy

**Phase 1** (Quick Wins): Intégration minimale de LlamaIndex pour tool calling
**Phase 2** (Graph Intelligence): Neo4j GDS pour analytics avancés
**Phase 3** (Full Integration): Agent orchestration + Graph ML pipelines

---

## RagForge Current Architecture

### Core Components Analysis

Basé sur l'exploration du code (`packages/runtime/src/`):

```
RagForge Architecture
├── QueryBuilder (1911 lignes)
│   ├── Pipeline-based composition
│   ├── 6 operation types: filter, semantic, traverse, rerank, llm, modify
│   └── Type-safe fluent API
│
├── VectorSearch
│   ├── Provider: Google Gemini (embeddings)
│   ├── Storage: Neo4j vector indexes
│   └── Cosine similarity search
│
├── Neo4jClient
│   ├── Direct Cypher queries
│   ├── Transaction management
│   └── Relationship traversal
│
├── LLMReranker
│   ├── Batch scoring with structured outputs
│   ├── Provider: Google Gemini
│   └── Template-based prompts
│
└── CodeSourceAdapter (1100 lignes)
    ├── TypeScript/Python parsing
    ├── Scope extraction
    └── Intelligent chunking
```

### Current Limitations Identified

1. **Tool Calling**: Pas de framework standardisé
   - Les agents construisent des outils ad-hoc
   - Pas de validation de schéma automatique
   - Difficile d'ajouter de nouveaux outils

2. **LLM Provider Lock-in**: Gemini uniquement
   - Pas d'abstraction pour OpenAI/Anthropic/local models
   - Code embeddings dupliqué entre providers

3. **Graph Analytics**: Capacités limitées
   - Pas de centrality analysis
   - Pas de community detection
   - Pas de graph embeddings natifs

4. **Agent Orchestration**: Implémentation custom
   - Pattern réinventé vs utiliser un framework éprouvé
   - Pas de workflows complexes

---

## LlamaIndex Integration Opportunities

### What is LlamaIndex.TS?

LlamaIndex est un framework pour construire des applications LLM avec "context engineering":
- **Data connectors**: 150+ sources (APIs, files, SQL, Neo4j, etc.)
- **Indexes & Retrievers**: Structure et accès aux données
- **Agents**: Autonomous reasoning + tool execution
- **Query Engines**: RAG sophistiqué multi-sources
- **Workflows**: Event-driven multi-step processes

**TypeScript-First**: Support Node.js, Deno, Bun, Cloudflare Workers

### 1. Tool Calling Framework

#### Current RagForge Approach

```typescript
// packages/runtime/src/llm/llm-reranker.ts
// Tools construits manuellement dans les prompts
const toolSchema = {
  name: "search_code",
  description: "Search for code entities",
  parameters: { /* manual schema */ }
};
```

#### With LlamaIndex

```typescript
import { FunctionTool, OpenAIAgent } from "llamaindex";

// Définition type-safe avec validation automatique
const searchCodeTool = FunctionTool.from(
  async ({ query, filters }: { query: string; filters: Record<string, any> }) => {
    const rag = createRagClient(config);
    return await rag.scope()
      .semanticSearchBySource(query, { topK: 10 })
      .applyFilters(filters)
      .execute();
  },
  {
    name: "search_code",
    description: "Search code entities in Neo4j graph with semantic + structural filters",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Semantic search query (e.g., 'authentication functions')"
        },
        filters: {
          type: "object",
          description: "Structural filters (type, file, etc.)"
        }
      },
      required: ["query"]
    }
  }
);

// Outils RagForge transformés en FunctionTools
const traverseRelationshipsTool = FunctionTool.from(
  async ({ entityId, relationshipType, depth }: {
    entityId: string;
    relationshipType: string;
    depth: number;
  }) => {
    const rag = createRagClient(config);
    const entity = await rag.scope().findById(entityId);
    return await entity.traverse(relationshipType, depth);
  },
  {
    name: "traverse_relationships",
    description: "Traverse graph relationships from an entity",
    parameters: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        relationshipType: { type: "string" },
        depth: { type: "number", default: 1 }
      },
      required: ["entityId", "relationshipType"]
    }
  }
);

// Agent avec tools RagForge
const agent = new OpenAIAgent({
  tools: [searchCodeTool, traverseRelationshipsTool],
  verbose: true
});

const response = await agent.chat({
  message: "Find all functions that use JWT authentication and show me their dependencies"
});
```

**Benefits**:
- ✅ Validation automatique des paramètres
- ✅ Type safety bout-en-bout
- ✅ Error handling standardisé
- ✅ Compatible avec OpenAI, Anthropic, local models
- ✅ Logging et observability intégrés

### 2. Agent Types & Orchestration

LlamaIndex fournit plusieurs types d'agents:

#### OpenAIAgent
```typescript
import { OpenAIAgent } from "llamaindex";

const agent = new OpenAIAgent({
  tools: [/* RagForge tools */],
  systemPrompt: "You are a code analysis assistant with access to a Neo4j knowledge graph",
  llm: new OpenAI({ model: "gpt-4-turbo" })
});
```

#### ReActAgent (Reasoning + Acting)
```typescript
import { ReActAgent } from "llamaindex";

const agent = ReActAgent.from({
  tools: [searchCodeTool, traverseRelationshipsTool],
  llm: new OpenAI(),
  verbose: true
});

// Multi-step reasoning
const result = await agent.chat({
  message: "Analyze the security of our authentication module"
});
```

**Use Case pour RagForge**:
- Code review automatique avec multi-step analysis
- Architecture discovery avec exploration itérative
- Refactoring suggestions avec dépendances

### 3. Query Engines pour RAG Hybride

LlamaIndex permet de combiner plusieurs sources:

```typescript
import { VectorStoreIndex, RouterQueryEngine } from "llamaindex";

// Query engine pour Neo4j (via RagForge)
const neo4jQueryEngine = {
  query: async (query: string) => {
    const rag = createRagClient(config);
    return await rag.scope()
      .semanticSearchBySource(query, { topK: 5 })
      .execute();
  }
};

// Query engine pour documentation
const docsQueryEngine = await VectorStoreIndex
  .fromDocuments(documents)
  .asQueryEngine();

// Router qui choisit la meilleure source
const router = new RouterQueryEngine({
  queryEngines: {
    code: neo4jQueryEngine,
    documentation: docsQueryEngine
  },
  selector: {
    type: "llm",
    llm: new OpenAI()
  }
});

// Question multi-sources
const answer = await router.query(
  "How does the authentication module work and where is it documented?"
);
```

**Benefits pour RagForge**:
- Combiner code Neo4j + documentation externe
- Router automatique vers la meilleure source
- Contexte enrichi pour les réponses

### 4. Workflows pour Pipelines Complexes

```typescript
import { Workflow, StartEvent, StopEvent } from "llamaindex/workflows";

class CodeAnalysisWorkflow extends Workflow {
  @step()
  async searchCode(ctx: Context, ev: StartEvent) {
    // 1. Search initial avec RagForge
    const results = await rag.scope()
      .semanticSearchBySource(ev.data.query)
      .execute();

    return new AnalyzeEvent({ results });
  }

  @step()
  async analyzeGraph(ctx: Context, ev: AnalyzeEvent) {
    // 2. Analyse graphe avec Neo4j GDS
    const importance = await computePageRank(ev.data.results);
    return new RankEvent({ importance });
  }

  @step()
  async generateReport(ctx: Context, ev: RankEvent) {
    // 3. Génération rapport avec LLM
    const report = await llm.chat(ev.data.importance);
    return new StopEvent({ result: report });
  }
}

const workflow = new CodeAnalysisWorkflow();
const result = await workflow.run({ query: "authentication" });
```

---

## Neo4j Graph Data Science Plugin

### Overview

Le plugin Neo4j GDS ajoute **70+ algorithmes** de graph analytics:
- Centrality (PageRank, Betweenness, Eigenvector, ...)
- Community Detection (Louvain, Leiden, Label Propagation, ...)
- Pathfinding (Dijkstra, A*, Yen's K-Shortest Paths, ...)
- Similarity (Node Similarity, KNN, ...)
- Node Embeddings (FastRP, GraphSAGE, Node2Vec)
- Link Prediction (Adamic Adar, Common Neighbors, ...)

### Installation

#### Option 1: Docker (Recommended pour Dev)

```bash
# Télécharger le plugin
cd /home/luciedefraiteur/Téléchargements
unzip neo4j-graph-data-science-2.23.0.zip

# Copier dans Docker volume ou bind mount
# Dans docker-compose.yml de RagForge:
services:
  neo4j:
    image: neo4j:5.26
    volumes:
      - ./plugins:/plugins
      - ./data:/data
    environment:
      - NEO4J_dbms_security_procedures_unrestricted=gds.*
      - NEO4J_dbms_security_procedures_allowlist=gds.*

# Copier le JAR
cp neo4j-graph-data-science-2.23.0.jar ./plugins/

# Restart Neo4j
docker-compose restart neo4j
```

#### Option 2: Neo4j Desktop

1. Ouvrir Neo4j Desktop
2. Sélectionner votre projet
3. Cliquer sur "Add Plugin"
4. Sélectionner "Graph Data Science"
5. Install

#### Vérification

```cypher
// Vérifier que GDS est chargé
CALL gds.version()

// Lister tous les algorithmes disponibles
CALL gds.list()
```

### Use Cases pour RagForge

#### 1. Code Importance Scoring (PageRank)

**Problem**: Quels sont les fichiers/fonctions les plus importants dans le codebase?

```cypher
// Créer une projection du graphe
CALL gds.graph.project(
  'code-graph',
  'Scope',
  'IMPORTS'
)

// Calculer PageRank
CALL gds.pageRank.stream('code-graph')
YIELD nodeId, score
WITH gds.util.asNode(nodeId) AS node, score
RETURN node.name AS name, node.filePath AS file, score
ORDER BY score DESC
LIMIT 20
```

**Integration avec RagForge**:

```typescript
// packages/runtime/src/analytics/importance-scorer.ts
export class ImportanceScorer {
  constructor(private client: Neo4jClient) {}

  async computeCodeImportance(entityType: string = 'Scope'): Promise<ImportanceResult[]> {
    // 1. Créer la projection
    await this.client.run(`
      CALL gds.graph.project(
        'code-importance',
        '${entityType}',
        ['IMPORTS', 'CALLS', 'REFERENCES']
      )
    `);

    // 2. PageRank
    const result = await this.client.run(`
      CALL gds.pageRank.stream('code-importance')
      YIELD nodeId, score
      WITH gds.util.asNode(nodeId) AS node, score
      RETURN
        node.uuid AS entityId,
        node.name AS name,
        node.filePath AS file,
        score
      ORDER BY score DESC
    `);

    // 3. Cleanup
    await this.client.run(`CALL gds.graph.drop('code-importance')`);

    return result.records.map(r => ({
      entityId: r.get('entityId'),
      name: r.get('name'),
      file: r.get('file'),
      importanceScore: r.get('score')
    }));
  }
}

// Usage dans query builder
const topImportantFunctions = await rag
  .scope()
  .whereType('function')
  .orderByImportance() // ← Nouveau modifier utilisant GDS PageRank
  .limit(20)
  .execute();
```

#### 2. Community Detection (Louvain)

**Problem**: Identifier les modules cohésifs dans le code

```cypher
// Détecter les communautés
CALL gds.graph.project('code-modules', 'Scope', 'IMPORTS')

CALL gds.louvain.stream('code-modules')
YIELD nodeId, communityId
WITH gds.util.asNode(nodeId) AS node, communityId
RETURN
  communityId,
  collect(node.name) AS members,
  count(*) AS size
ORDER BY size DESC
```

**Integration RagForge**:

```typescript
export class ModuleDetector {
  async detectModules(): Promise<Module[]> {
    await this.client.run(`
      CALL gds.graph.project('code-modules', 'Scope', 'IMPORTS')
    `);

    const result = await this.client.run(`
      CALL gds.louvain.stream('code-modules')
      YIELD nodeId, communityId
      WITH gds.util.asNode(nodeId) AS node, communityId
      RETURN
        communityId,
        collect({
          id: node.uuid,
          name: node.name,
          file: node.filePath
        }) AS members
    `);

    await this.client.run(`CALL gds.graph.drop('code-modules')`);

    return result.records.map(r => ({
      moduleId: r.get('communityId'),
      members: r.get('members')
    }));
  }
}

// Query avec modules
const modulesWithAuth = await rag
  .scope()
  .semanticSearchBySource('authentication')
  .groupByModule() // ← Utilise Louvain pour grouper par module détecté
  .execute();
```

#### 3. Graph Embeddings (FastRP)

**Problem**: Embeddings structurels pour similarité basée sur le graphe

```cypher
// Créer des embeddings FastRP
CALL gds.graph.project('code-embeddings', 'Scope', 'IMPORTS')

CALL gds.fastRP.mutate('code-embeddings', {
  embeddingDimension: 256,
  mutateProperty: 'structuralEmbedding'
})

// Écrire dans le graphe
CALL gds.fastRP.write('code-embeddings', {
  embeddingDimension: 256,
  writeProperty: 'structuralEmbedding'
})
```

**Integration avec RagForge**:

```typescript
export class HybridEmbeddings {
  /**
   * Combine semantic embeddings (Gemini) + structural embeddings (FastRP)
   */
  async generateHybridEmbeddings(entityId: string): Promise<number[]> {
    // 1. Semantic embedding (existant)
    const semanticEmb = await this.vectorSearch.generateEmbedding(content);

    // 2. Structural embedding (GDS FastRP)
    const result = await this.client.run(`
      MATCH (s:Scope {uuid: $entityId})
      RETURN s.structuralEmbedding AS structEmb
    `, { entityId });

    const structEmb = result.records[0].get('structEmb');

    // 3. Combiner (weighted average ou concat)
    return this.combine(semanticEmb, structEmb, {
      semanticWeight: 0.7,
      structuralWeight: 0.3
    });
  }
}

// Recherche hybride
const similar = await rag
  .scope()
  .findSimilar(entityId, {
    useHybridEmbeddings: true, // ← Semantic + Structural
    topK: 10
  })
  .execute();
```

#### 4. Link Prediction

**Problem**: Suggérer des dépendances manquantes ou refactorings

```cypher
// Prédire des liens potentiels
CALL gds.graph.project('code-links', 'Scope', 'IMPORTS')

CALL gds.linkPrediction.adamicAdar.stream('code-links', {
  topN: 50
})
YIELD node1, node2, score
WITH gds.util.asNode(node1) AS source, gds.util.asNode(node2) AS target, score
WHERE NOT exists((source)-[:IMPORTS]->(target))
RETURN
  source.name AS from,
  target.name AS to,
  score AS likelihood
ORDER BY score DESC
```

**Integration RagForge**:

```typescript
export class RefactoringAssistant {
  async suggestMissingImports(): Promise<Suggestion[]> {
    const result = await this.client.run(`
      CALL gds.graph.project('code-links', 'Scope', 'IMPORTS')
      CALL gds.linkPrediction.adamicAdar.stream('code-links', {topN: 50})
      YIELD node1, node2, score
      WITH gds.util.asNode(node1) AS source, gds.util.asNode(node2) AS target, score
      WHERE NOT exists((source)-[:IMPORTS]->(target))
      RETURN source, target, score
      ORDER BY score DESC
    `);

    return result.records.map(r => ({
      from: r.get('source').properties,
      to: r.get('target').properties,
      confidence: r.get('score'),
      reason: 'Common neighbors suggest high coupling'
    }));
  }
}
```

#### 5. Betweenness Centrality

**Problem**: Identifier les "bottlenecks" architecturaux

```cypher
CALL gds.betweenness.stream('code-graph')
YIELD nodeId, score
WITH gds.util.asNode(nodeId) AS node, score
WHERE score > 0
RETURN node.name, score
ORDER BY score DESC
LIMIT 20
```

**Use Case**:
- Modules qui font le pont entre différentes parties du système
- Risque élevé si ces modules échouent
- Candidats pour split/refactoring

---

## Concrete Integration Proposals

### Proposal 1: LlamaIndex Tool Calling Layer (Minimal Integration)

**Effort**: 🟢 Low (1-2 semaines)
**Impact**: 🟡 Medium
**Risk**: 🟢 Low

#### Architecture

```
┌─────────────────────────────────────────┐
│         RagForge Client API             │
│     (existing query builders)           │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│      LlamaIndex Tool Wrapper            │
│  (FunctionTool.from(...))               │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│    LlamaIndex Agent (OpenAIAgent)       │
│  - Tool orchestration                   │
│  - Multi-step reasoning                 │
└─────────────────────────────────────────┘
```

#### Implementation

**File**: `packages/runtime/src/integrations/llamaindex-adapter.ts`

```typescript
import { FunctionTool, OpenAIAgent, Settings } from "llamaindex";
import { createRagClient } from "../client";
import type { RagClient } from "../types";

export class RagForgeToolkit {
  private rag: RagClient;

  constructor(config: RagConfig) {
    this.rag = createRagClient(config);
  }

  /**
   * Convertir toutes les opérations RagForge en FunctionTools
   */
  createTools(): FunctionTool[] {
    return [
      this.createSemanticSearchTool(),
      this.createFilterTool(),
      this.createTraverseTool(),
      this.createRerankTool()
    ];
  }

  private createSemanticSearchTool(): FunctionTool {
    return FunctionTool.from(
      async ({ query, topK }: { query: string; topK?: number }) => {
        const results = await this.rag
          .scope()
          .semanticSearchBySource(query, { topK: topK || 10 })
          .execute();

        return JSON.stringify(results, null, 2);
      },
      {
        name: "semantic_search",
        description: "Search code entities semantically using embeddings",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural language query (e.g., 'authentication logic')"
            },
            topK: {
              type: "number",
              description: "Number of results to return",
              default: 10
            }
          },
          required: ["query"]
        }
      }
    );
  }

  private createTraverseTool(): FunctionTool {
    return FunctionTool.from(
      async ({ entityId, relationship, depth }: {
        entityId: string;
        relationship: string;
        depth?: number;
      }) => {
        const entity = await this.rag.scope().findById(entityId);
        const results = await entity.traverse(relationship, depth || 1);
        return JSON.stringify(results, null, 2);
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
  }

  /**
   * Créer un agent avec accès aux tools RagForge
   */
  createAgent(systemPrompt?: string): OpenAIAgent {
    const tools = this.createTools();

    return new OpenAIAgent({
      tools,
      systemPrompt: systemPrompt || `
You are a code analysis assistant with access to a Neo4j knowledge graph of a codebase.

Available tools:
- semantic_search: Find code by natural language query
- traverse_graph: Explore relationships between entities
- filter_by_type: Filter entities by type (function, class, variable)
- rerank_results: Re-rank results using LLM reasoning

Use these tools to answer questions about code structure, dependencies, and functionality.
      `.trim(),
      verbose: true
    });
  }
}

// Usage
const toolkit = new RagForgeToolkit(ragConfig);
const agent = toolkit.createAgent();

const response = await agent.chat({
  message: "Find all authentication-related functions and their dependencies"
});
```

**Benefits**:
- ✅ Zéro changement au code RagForge existant
- ✅ Drop-in replacement pour les agents custom
- ✅ Accès à l'écosystème LlamaIndex
- ✅ Support multi-LLM (OpenAI, Anthropic, local)

### Proposal 2: Neo4j GDS Analytics Module

**Effort**: 🟡 Medium (2-3 semaines)
**Impact**: 🟢 High
**Risk**: 🟢 Low

#### Architecture

```
┌─────────────────────────────────────────┐
│         RagForge Query Builder          │
└────────────────┬────────────────────────┘
                 │
                 ├─────────────────────┐
                 │                     │
                 ▼                     ▼
┌─────────────────────────┐  ┌──────────────────────┐
│   Vector Search         │  │  GDS Analytics       │
│   (semantic)            │  │  (structural)        │
│  - Embeddings           │  │  - PageRank          │
│  - Cosine similarity    │  │  - Community         │
└─────────────────────────┘  │  - Centrality        │
                              │  - Link prediction   │
                              └──────────────────────┘
```

#### Implementation

**File**: `packages/runtime/src/analytics/gds-client.ts`

```typescript
import type { Neo4jClient } from '../client/neo4j-client';

export interface GDSConfig {
  autoCleanup?: boolean; // Drop projections after use
  defaultEmbeddingDimension?: number;
}

export class GDSClient {
  constructor(
    private neo4j: Neo4jClient,
    private config: GDSConfig = {}
  ) {}

  /**
   * Vérifier que GDS est installé
   */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.neo4j.run('CALL gds.version()');
      return result.records.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * PageRank pour code importance
   */
  async computeImportance(options: {
    nodeLabels?: string[];
    relationshipTypes?: string[];
    damping?: number;
  } = {}): Promise<ImportanceResult[]> {
    const graphName = `importance-${Date.now()}`;

    try {
      // Projection
      await this.neo4j.run(`
        CALL gds.graph.project(
          $graphName,
          $nodeLabels,
          $relationshipTypes
        )
      `, {
        graphName,
        nodeLabels: options.nodeLabels || ['Scope'],
        relationshipTypes: options.relationshipTypes || ['IMPORTS', 'CALLS']
      });

      // PageRank
      const result = await this.neo4j.run(`
        CALL gds.pageRank.stream($graphName, {
          dampingFactor: $damping
        })
        YIELD nodeId, score
        WITH gds.util.asNode(nodeId) AS node, score
        RETURN
          node.uuid AS id,
          node.name AS name,
          node.filePath AS file,
          score
        ORDER BY score DESC
      `, {
        graphName,
        damping: options.damping || 0.85
      });

      return result.records.map(r => ({
        entityId: r.get('id'),
        name: r.get('name'),
        file: r.get('file'),
        score: r.get('score')
      }));
    } finally {
      if (this.config.autoCleanup) {
        await this.dropGraph(graphName);
      }
    }
  }

  /**
   * Community detection (Louvain)
   */
  async detectCommunities(options: {
    nodeLabels?: string[];
    relationshipTypes?: string[];
  } = {}): Promise<Community[]> {
    const graphName = `communities-${Date.now()}`;

    try {
      await this.neo4j.run(`
        CALL gds.graph.project(
          $graphName,
          $nodeLabels,
          $relationshipTypes
        )
      `, {
        graphName,
        nodeLabels: options.nodeLabels || ['Scope'],
        relationshipTypes: options.relationshipTypes || ['IMPORTS']
      });

      const result = await this.neo4j.run(`
        CALL gds.louvain.stream($graphName)
        YIELD nodeId, communityId
        WITH gds.util.asNode(nodeId) AS node, communityId
        RETURN
          communityId,
          collect({
            id: node.uuid,
            name: node.name,
            file: node.filePath
          }) AS members
      `, { graphName });

      return result.records.map(r => ({
        communityId: r.get('communityId').toNumber(),
        members: r.get('members')
      }));
    } finally {
      if (this.config.autoCleanup) {
        await this.dropGraph(graphName);
      }
    }
  }

  /**
   * Generate structural embeddings (FastRP)
   */
  async generateStructuralEmbeddings(options: {
    dimension?: number;
    iterations?: number;
    writeProperty?: string;
  } = {}): Promise<void> {
    const graphName = `embeddings-${Date.now()}`;
    const dimension = options.dimension || this.config.defaultEmbeddingDimension || 256;

    try {
      await this.neo4j.run(`
        CALL gds.graph.project($graphName, 'Scope', ['IMPORTS', 'CALLS'])
      `, { graphName });

      await this.neo4j.run(`
        CALL gds.fastRP.write($graphName, {
          embeddingDimension: $dimension,
          iterations: $iterations,
          writeProperty: $writeProperty
        })
      `, {
        graphName,
        dimension,
        iterations: options.iterations || 20,
        writeProperty: options.writeProperty || 'structuralEmbedding'
      });
    } finally {
      if (this.config.autoCleanup) {
        await this.dropGraph(graphName);
      }
    }
  }

  /**
   * Link prediction (Adamic Adar)
   */
  async predictLinks(options: {
    topN?: number;
  } = {}): Promise<LinkPrediction[]> {
    const graphName = `links-${Date.now()}`;

    try {
      await this.neo4j.run(`
        CALL gds.graph.project($graphName, 'Scope', 'IMPORTS')
      `, { graphName });

      const result = await this.neo4j.run(`
        CALL gds.linkPrediction.adamicAdar.stream($graphName, {
          topN: $topN
        })
        YIELD node1, node2, score
        WITH gds.util.asNode(node1) AS source, gds.util.asNode(node2) AS target, score
        WHERE NOT exists((source)-[:IMPORTS]->(target))
        RETURN
          source.uuid AS fromId,
          source.name AS fromName,
          target.uuid AS toId,
          target.name AS toName,
          score
        ORDER BY score DESC
      `, {
        graphName,
        topN: options.topN || 50
      });

      return result.records.map(r => ({
        from: { id: r.get('fromId'), name: r.get('fromName') },
        to: { id: r.get('toId'), name: r.get('toName') },
        score: r.get('score')
      }));
    } finally {
      if (this.config.autoCleanup) {
        await this.dropGraph(graphName);
      }
    }
  }

  /**
   * Betweenness centrality (find architectural bottlenecks)
   */
  async findBottlenecks(): Promise<ImportanceResult[]> {
    const graphName = `bottlenecks-${Date.now()}`;

    try {
      await this.neo4j.run(`
        CALL gds.graph.project($graphName, 'Scope', ['IMPORTS', 'CALLS'])
      `, { graphName });

      const result = await this.neo4j.run(`
        CALL gds.betweenness.stream($graphName)
        YIELD nodeId, score
        WITH gds.util.asNode(nodeId) AS node, score
        WHERE score > 0
        RETURN
          node.uuid AS id,
          node.name AS name,
          node.filePath AS file,
          score
        ORDER BY score DESC
      `, { graphName });

      return result.records.map(r => ({
        entityId: r.get('id'),
        name: r.get('name'),
        file: r.get('file'),
        score: r.get('score')
      }));
    } finally {
      if (this.config.autoCleanup) {
        await this.dropGraph(graphName);
      }
    }
  }

  private async dropGraph(graphName: string): Promise<void> {
    try {
      await this.neo4j.run('CALL gds.graph.drop($graphName)', { graphName });
    } catch {
      // Ignore si déjà supprimé
    }
  }
}

// Types
export interface ImportanceResult {
  entityId: string;
  name: string;
  file: string;
  score: number;
}

export interface Community {
  communityId: number;
  members: Array<{
    id: string;
    name: string;
    file: string;
  }>;
}

export interface LinkPrediction {
  from: { id: string; name: string };
  to: { id: string; name: string };
  score: number;
}
```

**Integration avec QueryBuilder**:

```typescript
// packages/runtime/src/query/query-builder.ts

// Ajouter nouveau modifier
export class QueryBuilder<T> {
  // ... existing code ...

  /**
   * Trier par importance structurelle (PageRank)
   */
  orderByImportance(): QueryBuilder<T> {
    return this.addOperation({
      type: 'gds_importance',
      config: {}
    });
  }

  /**
   * Grouper par communauté détectée
   */
  groupByCommunity(): QueryBuilder<T> {
    return this.addOperation({
      type: 'gds_community',
      config: {}
    });
  }

  /**
   * Trouver entités similaires structurellement
   */
  findStructurallySimilar(entityId: string, topK: number = 10): QueryBuilder<T> {
    return this.addOperation({
      type: 'gds_similarity',
      config: { entityId, topK }
    });
  }
}
```

**Usage**:

```typescript
// 1. Code importance
const critical = await rag
  .scope()
  .whereType('function')
  .orderByImportance() // ← PageRank
  .limit(20)
  .execute();

// 2. Module detection
const modules = await rag
  .scope()
  .groupByCommunity() // ← Louvain
  .execute();

// 3. Structural similarity
const similar = await rag
  .scope()
  .findStructurallySimilar('func-uuid-123', 10) // ← FastRP embeddings
  .execute();

// 4. Direct GDS access
const gds = new GDSClient(neo4jClient, { autoCleanup: true });

const importance = await gds.computeImportance();
const communities = await gds.detectCommunities();
const missingLinks = await gds.predictLinks({ topN: 50 });
const bottlenecks = await gds.findBottlenecks();
```

### Proposal 3: Hybrid Embeddings (Semantic + Structural)

**Effort**: 🟡 Medium (2 semaines)
**Impact**: 🟢 High
**Risk**: 🟡 Medium

#### Concept

Combiner:
- **Semantic embeddings** (Gemini/OpenAI) → capture meaning, comments, names
- **Structural embeddings** (FastRP/Node2Vec) → capture graph position, dependencies

#### Implementation

```typescript
// packages/runtime/src/embeddings/hybrid-embeddings.ts

export class HybridEmbeddingGenerator {
  constructor(
    private vectorSearch: VectorSearch,
    private gds: GDSClient
  ) {}

  async generateHybridEmbeddings(options: {
    semanticWeight?: number;
    structuralWeight?: number;
    structuralDimension?: number;
  } = {}): Promise<void> {
    const semWeight = options.semanticWeight ?? 0.7;
    const strWeight = options.structuralWeight ?? 0.3;

    // 1. Générer structural embeddings avec GDS
    await this.gds.generateStructuralEmbeddings({
      dimension: options.structuralDimension || 256,
      writeProperty: 'structuralEmbedding'
    });

    // 2. Pour chaque entité, combiner les embeddings
    const entities = await this.neo4j.run(`
      MATCH (s:Scope)
      WHERE s.content IS NOT NULL
      RETURN s.uuid AS id, s.content AS content, s.structuralEmbedding AS strEmb
    `);

    for (const record of entities.records) {
      const id = record.get('id');
      const content = record.get('content');
      const strEmb = record.get('strEmb');

      // Semantic embedding
      const semEmb = await this.vectorSearch.generateEmbedding(content);

      // Combine
      const hybridEmb = this.combine(semEmb, strEmb, semWeight, strWeight);

      // Write back
      await this.neo4j.run(`
        MATCH (s:Scope {uuid: $id})
        SET s.hybridEmbedding = $embedding
      `, { id, embedding: hybridEmb });
    }
  }

  private combine(
    semantic: number[],
    structural: number[],
    semWeight: number,
    strWeight: number
  ): number[] {
    // Weighted average
    return semantic.map((val, i) =>
      semWeight * val + strWeight * (structural[i] || 0)
    );
  }
}

// Usage
const hybrid = new HybridEmbeddingGenerator(vectorSearch, gds);

await hybrid.generateHybridEmbeddings({
  semanticWeight: 0.7,   // 70% meaning
  structuralWeight: 0.3  // 30% graph structure
});

// Search avec hybrid
const results = await rag
  .scope()
  .hybridSearch('authentication logic', {
    useSemanticEmbedding: true,
    useStructuralEmbedding: true,
    topK: 10
  })
  .execute();
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Intégration minimale de LlamaIndex pour tool calling

**Tasks**:
- [ ] Installer LlamaIndex.TS: `npm install llamaindex`
- [ ] Créer `RagForgeToolkit` class
- [ ] Convertir 5 opérations en FunctionTools:
  - semantic_search
  - filter_by_type
  - traverse_relationships
  - rerank_results
  - find_by_id
- [ ] Créer agent example avec OpenAIAgent
- [ ] Tests d'intégration
- [ ] Documentation

**Deliverables**:
- `packages/runtime/src/integrations/llamaindex-adapter.ts`
- `examples/llamaindex-agent/basic-agent.ts`
- `docs/llamaindex-integration.md`

### Phase 2: GDS Analytics (Week 3-5)

**Goal**: Ajouter capacités d'analyse graphe

**Tasks**:
- [ ] Installer Neo4j GDS plugin (voir Installation Guide)
- [ ] Créer `GDSClient` class
- [ ] Implémenter 5 algorithmes:
  - PageRank (importance)
  - Louvain (communities)
  - Betweenness (bottlenecks)
  - FastRP (structural embeddings)
  - Link Prediction
- [ ] Intégrer dans QueryBuilder
- [ ] Tests
- [ ] Documentation

**Deliverables**:
- `packages/runtime/src/analytics/gds-client.ts`
- `packages/runtime/src/query/gds-operations.ts`
- `docs/gds-integration.md`

### Phase 3: Hybrid Embeddings (Week 6-7)

**Goal**: Combiner semantic + structural embeddings

**Tasks**:
- [ ] Créer `HybridEmbeddingGenerator`
- [ ] Implémenter weighted combination
- [ ] Ajouter `hybridSearch` au QueryBuilder
- [ ] A/B testing semantic vs hybrid
- [ ] Performance benchmarks
- [ ] Documentation

**Deliverables**:
- `packages/runtime/src/embeddings/hybrid-embeddings.ts`
- `benchmarks/hybrid-vs-semantic.md`

### Phase 4: Advanced Agents (Week 8-10)

**Goal**: Agents sophistiqués avec workflows

**Tasks**:
- [ ] Créer workflow pour code review
- [ ] Créer workflow pour architecture analysis
- [ ] Intégrer GDS dans agent reasoning
- [ ] Multi-agent orchestration
- [ ] Examples avancés

**Deliverables**:
- `examples/agents/code-review-agent.ts`
- `examples/agents/architecture-agent.ts`
- `examples/workflows/multi-step-analysis.ts`

---

## Installation Guide

### Installing LlamaIndex.TS

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/packages/runtime

npm install llamaindex

# Peer dependencies
npm install openai @anthropic-ai/sdk  # Si besoin
```

### Installing Neo4j GDS Plugin

#### Method 1: Docker (Development)

Mettre à jour le `docker-compose.yml` de RagForge:

```yaml
# ragforge/docker-compose.yml ou dans quickstart template
services:
  neo4j:
    image: neo4j:5.26
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - ./neo4j-data:/data
      - ./neo4j-plugins:/plugins  # ← Mount point
      - ./neo4j-logs:/logs
    environment:
      NEO4J_AUTH: neo4j/password
      NEO4J_ACCEPT_LICENSE_AGREEMENT: "yes"
      # ← Enable GDS
      NEO4J_dbms_security_procedures_unrestricted: "gds.*"
      NEO4J_dbms_security_procedures_allowlist: "gds.*"
```

Copier le plugin:

```bash
# Créer le dossier plugins
mkdir -p /home/luciedefraiteur/LR_CodeRag/ragforge/neo4j-plugins

# Extraire le ZIP
cd /home/luciedefraiteur/Téléchargements
unzip neo4j-graph-data-science-2.23.0.zip

# Copier le JAR
cp neo4j-graph-data-science-2.23.0.jar \
   /home/luciedefraiteur/LR_CodeRag/ragforge/neo4j-plugins/

# Restart
docker-compose restart neo4j
```

Vérifier:

```bash
# Dans Neo4j Browser (http://localhost:7474)
CALL gds.version()
CALL gds.list()
```

#### Method 2: Neo4j Desktop

1. Open Neo4j Desktop
2. Select your database
3. Go to "Plugins" tab
4. Click "Install" on Graph Data Science
5. Restart database

#### Method 3: Manual (Production)

```bash
# Télécharger depuis https://neo4j.com/download-center/
wget https://graphdatascience.ninja/neo4j-graph-data-science-2.23.0.jar

# Copier dans plugins/
cp neo4j-graph-data-science-2.23.0.jar /var/lib/neo4j/plugins/

# Éditer neo4j.conf
echo "dbms.security.procedures.unrestricted=gds.*" >> /etc/neo4j/neo4j.conf
echo "dbms.security.procedures.allowlist=gds.*" >> /etc/neo4j/neo4j.conf

# Restart
systemctl restart neo4j
```

### Quick Test

```typescript
// test-gds.ts
import { createRagClient } from '@luciformresearch/ragforge-runtime';

const rag = createRagClient({
  neo4j: {
    uri: 'bolt://localhost:7687',
    username: 'neo4j',
    password: 'password'
  }
});

// Test GDS availability
const result = await rag.neo4jClient.run('CALL gds.version()');
console.log('GDS Version:', result.records[0].get('gdsVersion'));

// Test PageRank
await rag.neo4jClient.run(`
  CALL gds.graph.project('test', 'Scope', 'IMPORTS')
`);

const pagerank = await rag.neo4jClient.run(`
  CALL gds.pageRank.stream('test')
  YIELD nodeId, score
  RETURN score
  LIMIT 5
`);

console.log('PageRank working:', pagerank.records.length > 0);

await rag.neo4jClient.run('CALL gds.graph.drop("test")');
```

---

## Conclusion

### Summary of Opportunities

| Integration | Effort | Impact | Priority |
|------------|--------|--------|----------|
| **LlamaIndex Tool Calling** | Low | Medium | 🔥 High |
| **GDS PageRank** | Low | High | 🔥 High |
| **GDS Community Detection** | Medium | High | 🟡 Medium |
| **Hybrid Embeddings** | Medium | High | 🟡 Medium |
| **LlamaIndex Query Engines** | Medium | Medium | 🟢 Low |
| **GDS Link Prediction** | Low | Medium | 🟡 Medium |
| **Multi-Agent Workflows** | High | High | 🟢 Low (future) |

### Recommended Starting Point

**Week 1-2**:
1. Install LlamaIndex + create basic FunctionTool wrappers
2. Install Neo4j GDS + test PageRank on existing data

**Quick Win Example**:

```typescript
import { RagForgeToolkit } from '@luciformresearch/ragforge-runtime/integrations';
import { GDSClient } from '@luciformresearch/ragforge-runtime/analytics';

// Instant agent with RagForge tools
const toolkit = new RagForgeToolkit(config);
const agent = toolkit.createAgent();

const answer = await agent.chat({
  message: "What are the 5 most important functions in this codebase?"
});

// Enhanced with GDS
const gds = new GDSClient(neo4jClient);
const importance = await gds.computeImportance({ topN: 5 });
console.log('Critical functions:', importance);
```

### Next Steps

1. **Decision**: Choisir Phase 1 (LlamaIndex) ou Phase 2 (GDS) en premier
2. **POC**: Créer un proof of concept dans `examples/`
3. **Documentation**: Mettre à jour les docs avec les nouvelles capacités
4. **Tests**: Ajouter des tests d'intégration
5. **Iteration**: Collecter feedback et itérer

---

**Questions? Ideas?** Let's discuss the integration strategy! 🚀
