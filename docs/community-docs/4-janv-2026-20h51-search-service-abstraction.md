# Abstraction du SearchService pour Community Docs

**Date:** 4 janvier 2026, 20h51
**Contexte:** Besoin d'exposer `brain_search` via l'API community-docs

## Problème

Actuellement, la recherche sémantique est implémentée dans `BrainManager` (packages/core/src/brain/brain-manager.ts) et exposée via le tool MCP `brain_search`.

Community-docs a besoin des mêmes capacités de recherche mais :
1. Utilise un Neo4j séparé (port 7688 vs 7687)
2. A des filtres spécifiques (categorySlug, userId, documentId, isPublic)
3. Doit être accessible via API HTTP, pas MCP

## Solution : Extraction d'un SearchService réutilisable

### Architecture proposée

```
packages/core/src/brain/
├── brain-manager.ts          # Garde la gestion projets, ingestion, etc.
├── search-service.ts         # NOUVEAU: Logique de recherche extraite
└── index.ts                  # Exporte SearchService

packages/community-docs/lib/ragforge/
├── orchestrator-adapter.ts   # Utilise SearchService avec filtres community
└── api/server.ts             # Expose /search via SearchService
```

### SearchService - Interface

```typescript
// packages/core/src/brain/search-service.ts

export interface SearchServiceConfig {
  neo4jClient: Neo4jClient;
  embeddingService?: EmbeddingService;
}

export interface SearchOptions {
  // Options de base
  query: string;
  limit?: number;
  offset?: number;
  minScore?: number;

  // Type de recherche
  semantic?: boolean;
  hybrid?: boolean;
  embeddingType?: 'name' | 'content' | 'description' | 'all';
  fuzzyDistance?: 0 | 1 | 2;
  rrfK?: number;

  // Filtres génériques (Cypher WHERE clauses)
  filters?: SearchFilter[];

  // Post-traitement
  glob?: string;
}

export interface SearchFilter {
  property: string;           // e.g., "categorySlug", "projectId"
  operator: 'eq' | 'in' | 'startsWith' | 'contains' | 'notIn';
  value: string | string[] | boolean | number;
}

export interface SearchResult {
  node: Record<string, any>;
  score: number;
  filePath?: string;
  matchedRange?: { startLine: number; endLine: number; };
  rrfDetails?: Record<string, any>;
}

export class SearchService {
  constructor(config: SearchServiceConfig);

  async search(options: SearchOptions): Promise<{
    results: SearchResult[];
    totalCount: number;
  }>;

  // Méthodes internes (extraites de BrainManager)
  private async vectorSearch(...): Promise<SearchResult[]>;
  private async hybridSearch(...): Promise<SearchResult[]>;
  private async fullTextSearch(...): Promise<SearchResult[]>;
}
```

### Utilisation dans BrainManager

```typescript
// packages/core/src/brain/brain-manager.ts

export class BrainManager {
  private searchService: SearchService;

  async initialize() {
    // ... existing code ...

    this.searchService = new SearchService({
      neo4jClient: this.neo4jClient,
      embeddingService: this.embeddingService,
    });
  }

  async search(query: string, options: BrainSearchOptions): Promise<UnifiedSearchResult> {
    // Convertir BrainSearchOptions vers SearchOptions
    const searchOptions: SearchOptions = {
      query,
      limit: options.limit,
      semantic: options.semantic,
      hybrid: options.hybrid,
      // ...
      filters: this.buildProjectFilters(options),
    };

    const result = await this.searchService.search(searchOptions);

    // Enrichir avec infos projets
    return this.enrichSearchResults(result);
  }

  private buildProjectFilters(options: BrainSearchOptions): SearchFilter[] {
    const filters: SearchFilter[] = [];

    if (options.projects?.length) {
      filters.push({ property: 'projectId', operator: 'in', value: options.projects });
    }

    if (options.nodeTypes?.length) {
      filters.push({ property: 'type', operator: 'in', value: options.nodeTypes });
    }

    // etc.
    return filters;
  }
}
```

### Utilisation dans CommunityOrchestratorAdapter

```typescript
// packages/community-docs/lib/ragforge/orchestrator-adapter.ts

export class CommunityOrchestratorAdapter {
  private searchService: SearchService;

  async initialize() {
    // ... existing code ...

    this.searchService = new SearchService({
      neo4jClient: this.coreClient,  // Utilise le client core (port 7688)
      embeddingService: this.embeddingService,
    });
  }

  async search(query: string, options: CommunitySearchOptions): Promise<CommunitySearchResult> {
    const filters: SearchFilter[] = [];

    // Filtres community-specific
    if (options.categorySlug) {
      filters.push({ property: 'categorySlug', operator: 'eq', value: options.categorySlug });
    }
    if (options.userId) {
      filters.push({ property: 'userId', operator: 'eq', value: options.userId });
    }
    if (options.documentId) {
      filters.push({ property: 'documentId', operator: 'eq', value: options.documentId });
    }
    if (options.isPublic !== undefined) {
      filters.push({ property: 'isPublic', operator: 'eq', value: options.isPublic });
    }

    return this.searchService.search({
      query,
      semantic: options.semantic ?? true,
      hybrid: options.hybrid ?? true,
      limit: options.limit ?? 20,
      minScore: options.minScore ?? 0.3,
      filters,
    });
  }
}
```

### Nouvel endpoint API /search

```typescript
// packages/community-docs/lib/ragforge/api/server.ts

this.server.post<{
  Body: {
    query: string;
    filters?: {
      categorySlug?: string;
      userId?: string;
      documentId?: string;
      isPublic?: boolean;
      tags?: string[];
    };
    options?: {
      semantic?: boolean;
      hybrid?: boolean;
      limit?: number;
      minScore?: number;
      embeddingType?: 'name' | 'content' | 'description' | 'all';
    };
  };
}>("/search", async (request, reply) => {
  const { query, filters = {}, options = {} } = request.body;

  const results = await this.orchestrator.search(query, {
    ...filters,
    ...options,
  });

  return {
    success: true,
    query,
    results: results.results.map(r => ({
      documentId: r.node.documentId,
      documentTitle: r.node.documentTitle,
      content: r.node.content || r.node.source,
      score: r.score,
      type: r.node.type,
      file: r.node.file,
      metadata: {
        categorySlug: r.node.categorySlug,
        userId: r.node.userId,
        tags: r.node.tags,
      },
    })),
    totalCount: results.totalCount,
  };
});
```

## Plan d'implémentation

### Étape 1: Créer SearchService (packages/core)
1. Créer `packages/core/src/brain/search-service.ts`
2. Extraire `vectorSearch`, `hybridSearch`, `fullTextSearch` de BrainManager
3. Définir l'interface `SearchFilter` pour les filtres génériques
4. Exporter depuis `packages/core/src/brain/index.ts`

### Étape 2: Refactorer BrainManager
1. Importer et instancier SearchService
2. Modifier `search()` pour déléguer à SearchService
3. Garder la logique spécifique projets (locks, sync, enrichissement)

### Étape 3: Intégrer dans CommunityOrchestratorAdapter
1. Importer SearchService depuis @ragforge/core
2. Ajouter méthode `search()` avec filtres community
3. Exposer via l'API /search

### Étape 4: Tests
1. Vérifier que brain_search fonctionne toujours (régression)
2. Tester /search community avec différents filtres
3. Tester recherche sémantique + hybrid

## Considérations

### Index Neo4j
Les deux bases Neo4j (7687 et 7688) doivent avoir les mêmes index :
- Vector index sur `embedding_content`, `embedding_name`, `embedding_description`
- Full-text index pour BM25

Le script `neo4j-client.ts` de community-docs doit créer ces index.

### Locks
- BrainManager gère les locks (ingestion, embedding) au niveau projet
- SearchService ne gère pas les locks - c'est la responsabilité de l'appelant
- Pour community-docs, pas besoin de locks complexes (pas de file watchers)

### Performance
- SearchService est stateless (pas de cache interne)
- Le cache d'embeddings est dans EmbeddingService
- Les index Neo4j assurent la performance
