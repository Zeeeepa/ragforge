# Agent Tools from Config - Exposition automatique des capacités RAG aux agents

## 🎯 Objectif

Permettre aux développeurs d'exposer facilement les capacités de leur client RAG généré comme tools pour les agents conversationnels, via la configuration.

**Problème actuel:**
- On a un système conversationnel générique avec tool calling
- On a des clients RAG générés avec des capacités riches (query, filters, semantic search, etc.)
- **Mais aucun moyen élégant de connecter les deux!**

**Solution:**
- API fluide générique pour construire des queries: `.get(entity).getRelationship(rel).filter(name).semanticSearch(index, query)`
- Configuration déclarative des tools exposés aux agents
- Génération automatique des tool definitions depuis la config

## 📊 Vision de l'API générique

### Cas d'usage concret

```typescript
// Client code RAG
const results = await client
  .get('Scope')
  .getRelationship('DEPENDS_ON')
  .filter('complexityGt5')
  .semanticSearch('code_embeddings', 'authentication logic')
  .limit(10)
  .execute();

// Client e-commerce
const products = await client
  .get('Product')
  .getRelationship('BELONGS_TO_CATEGORY')
  .filter('inStock')
  .semanticSearch('product_descriptions', 'wireless headphones')
  .limit(20)
  .execute();

// Client documentation
const docs = await client
  .get('Document')
  .getRelationship('RELATED_TO')
  .filter('recentlyUpdated')
  .semanticSearch('doc_content', 'installation guide')
  .limit(5)
  .execute();
```

### Architecture de la Query Builder API

```typescript
interface GenericQueryBuilder<T> {
  // Sélection de l'entité
  get(entityType: string): EntityQueryBuilder<T>;
}

interface EntityQueryBuilder<T> {
  // Navigation relationelle
  getRelationship(relationshipName: string, direction?: 'outgoing' | 'incoming' | 'both'): EntityQueryBuilder<T>;

  // Filtres (définis dans config)
  filter(filterName: string, params?: Record<string, any>): EntityQueryBuilder<T>;

  // Recherche sémantique
  semanticSearch(indexName: string, query: string, options?: SemanticSearchOptions): EntityQueryBuilder<T>;

  // Full-text search
  textSearch(query: string): EntityQueryBuilder<T>;

  // Limites et pagination
  limit(n: number): EntityQueryBuilder<T>;
  offset(n: number): EntityQueryBuilder<T>;

  // Exécution
  execute(): Promise<T[]>;

  // Introspection (pour agents)
  explain(): string; // Retourne une explication de la query en langage naturel
  toCypher(): string; // Retourne la Cypher générée (debug)
}

interface SemanticSearchOptions {
  minScore?: number;
  topK?: number;
  rerank?: boolean;
  rerankModel?: string;
}
```

## 🔧 Configuration des Tools pour Agents

### Structure de la config

```yaml
# ragforge.config.yaml

entities:
  - entity: Scope
    uniqueField: uuid

    # Relationships exposés aux agents
    relationships:
      - name: DEPENDS_ON
        targetEntity: Scope
        description: "Functions or classes that this scope depends on"

      - name: CALLED_BY
        targetEntity: Scope
        description: "Functions or classes that call this scope"
        direction: incoming

      - name: DEFINED_IN
        targetEntity: File
        description: "File where this scope is defined"

    # Filtres exposés aux agents
    filters:
      - name: complexityGt5
        description: "Scopes with cyclomatic complexity > 5"
        cypher: "n.cyclomaticComplexity > 5"

      - name: recentlyModified
        description: "Scopes modified in the last N days"
        parameters:
          - name: days
            type: number
            default: 7
        cypher: "n.lastModified > datetime() - duration({days: $days})"

      - name: byType
        description: "Filter by scope type (function, class, etc.)"
        parameters:
          - name: type
            type: string
            enum: [function, class, interface, type]
        cypher: "n.type = $type"

    # Indexes sémantiques exposés
    semanticIndexes:
      - name: code_embeddings
        field: code
        description: "Semantic search on code content"
        dimension: 768

      - name: docstring_embeddings
        field: docstring
        description: "Semantic search on documentation"
        dimension: 768

# Configuration des agents
agents:
  conversational:
    enabled: true

    # Tools exposés automatiquement depuis les entities
    exposedTools:
      - entity: Scope
        operations:
          - semanticSearch
          - textSearch
          - filter
          - getRelationship

        # Relationships exposés comme tools
        relationships:
          - DEPENDS_ON
          - CALLED_BY
          - DEFINED_IN

        # Filtres exposés comme tools
        filters:
          - complexityGt5
          - recentlyModified
          - byType

        # Indexes sémantiques exposés
        semanticIndexes:
          - code_embeddings
          - docstring_embeddings

      - entity: File
        operations:
          - semanticSearch
          - filter

        filters:
          - byExtension
          - recentlyModified

    # Tools custom (définis manuellement)
    customTools:
      - name: analyze_dependencies
        description: "Analyze dependency graph for a given scope"
        parameters:
          - name: scopeName
            type: string
            description: "Name of the scope to analyze"
          - name: depth
            type: number
            default: 3
            description: "Depth of dependency traversal"
        implementation: "./tools/analyze-dependencies.ts"

      - name: suggest_refactoring
        description: "Suggest refactoring opportunities"
        parameters:
          - name: targetComplexity
            type: number
            default: 10
        implementation: "./tools/suggest-refactoring.ts"
```

## 🏗️ Génération automatique des Tool Definitions

### Processus

```
1. Config parsing
   ↓
2. Introspection des entities, relationships, filters, indexes
   ↓
3. Génération des tool definitions pour LLM
   ↓
4. Génération du code d'exécution des tools
   ↓
5. Export dans le client généré
```

### Exemple de tool definition généré

```typescript
// generated-client/tools/scope-tools.ts

export const SCOPE_TOOLS: ToolDefinition[] = [
  {
    name: 'search_scopes_semantic',
    description: 'Semantic search on code content using embeddings. Returns scopes similar to the query.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query describing what to search for'
        },
        minScore: {
          type: 'number',
          description: 'Minimum similarity score (0-1)',
          default: 0.7
        },
        topK: {
          type: 'number',
          description: 'Maximum number of results',
          default: 10
        }
      },
      required: ['query']
    }
  },

  {
    name: 'filter_scopes_by_complexity',
    description: 'Filter scopes with cyclomatic complexity > 5',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of results',
          default: 20
        }
      }
    }
  },

  {
    name: 'get_scope_dependencies',
    description: 'Get all functions or classes that this scope depends on',
    parameters: {
      type: 'object',
      properties: {
        scopeName: {
          type: 'string',
          description: 'Name of the scope to analyze'
        },
        depth: {
          type: 'number',
          description: 'Depth of traversal',
          default: 1
        }
      },
      required: ['scopeName']
    }
  },

  {
    name: 'get_scope_callers',
    description: 'Get all functions or classes that call this scope',
    parameters: {
      type: 'object',
      properties: {
        scopeName: {
          type: 'string',
          description: 'Name of the scope to analyze'
        }
      },
      required: ['scopeName']
    }
  }
];
```

### Exemple de tool executor généré

```typescript
// generated-client/tools/scope-tool-executor.ts

import { RagClient } from '../client.js';

export class ScopeToolExecutor {
  constructor(private client: RagClient) {}

  async execute(toolCall: { tool_name: string; arguments: any }): Promise<any> {
    switch (toolCall.tool_name) {
      case 'search_scopes_semantic':
        return await this.searchScopesSemantic(toolCall.arguments);

      case 'filter_scopes_by_complexity':
        return await this.filterScopesByComplexity(toolCall.arguments);

      case 'get_scope_dependencies':
        return await this.getScopeDependencies(toolCall.arguments);

      case 'get_scope_callers':
        return await this.getScopeCallers(toolCall.arguments);

      default:
        throw new Error(`Unknown tool: ${toolCall.tool_name}`);
    }
  }

  private async searchScopesSemantic(args: {
    query: string;
    minScore?: number;
    topK?: number;
  }) {
    return await this.client
      .get('Scope')
      .semanticSearch('code_embeddings', args.query, {
        minScore: args.minScore || 0.7,
        topK: args.topK || 10
      })
      .execute();
  }

  private async filterScopesByComplexity(args: { limit?: number }) {
    return await this.client
      .get('Scope')
      .filter('complexityGt5')
      .limit(args.limit || 20)
      .execute();
  }

  private async getScopeDependencies(args: {
    scopeName: string;
    depth?: number;
  }) {
    return await this.client
      .get('Scope')
      .where({ name: args.scopeName })
      .getRelationship('DEPENDS_ON')
      // TODO: Support depth traversal
      .execute();
  }

  private async getScopeCallers(args: { scopeName: string }) {
    return await this.client
      .get('Scope')
      .where({ name: args.scopeName })
      .getRelationship('CALLED_BY', 'incoming')
      .execute();
  }
}
```

## 🔄 Intégration avec ConversationAgent

### Utilisation dans un agent

```typescript
import { ConversationAgent } from '@luciformresearch/ragforge-runtime';
import { createRagClient } from './generated-client/client.js';
import { SCOPE_TOOLS } from './generated-client/tools/scope-tools.js';
import { ScopeToolExecutor } from './generated-client/tools/scope-tool-executor.js';

const ragClient = createRagClient();
const toolExecutor = new ScopeToolExecutor(ragClient);

const agent = new ConversationAgent({
  neo4j: ragClient.client,
  llmProvider,
  tools: SCOPE_TOOLS,
  toolExecutor: {
    execute: (toolCall) => toolExecutor.execute(toolCall)
  },
  config: {
    enableSummarization: true,
    summarizeEveryNChars: 10000
  }
});

await agent.initialize();

const conversation = await agent.createConversation({
  title: 'Code analysis session'
});

// L'agent peut maintenant utiliser les tools automatiquement!
const response = await conversation.sendMessage(
  "Find all functions with high complexity that handle authentication"
);
```

## 📋 Plan d'implémentation

### Phase 1: Generic Query Builder API (Core)

**Fichiers à créer:**
- `/packages/runtime/src/query/generic-query-builder.ts` - API fluide
- `/packages/runtime/src/query/query-plan.ts` - Représentation interne de la query
- `/packages/runtime/src/query/query-executor.ts` - Exécution Cypher

**Fonctionnalités:**
1. `.get(entity)` - Sélection entité
2. `.getRelationship(name, direction)` - Navigation
3. `.filter(name, params)` - Filtres custom
4. `.semanticSearch(index, query, options)` - Recherche sémantique
5. `.execute()` - Exécution
6. `.explain()` - Explication pour LLM

### Phase 2: Configuration des Tools (Core)

**Fichiers à créer:**
- `/packages/core/src/config/agent-tools-config.ts` - Types config
- `/packages/core/src/config/tools-validator.ts` - Validation config

**Dans ragforge.config.yaml:**
1. Section `agents.conversational.exposedTools`
2. Définition des filters exposés
3. Définition des relationships exposés
4. Définition des semantic indexes

### Phase 3: Génération automatique (Generator)

**Fichiers à créer:**
- `/packages/core/src/generator/tools-generator.ts` - Génération des tools
- `/packages/core/templates/tools/` - Templates pour generated code

**Génère:**
1. `generated-client/tools/[entity]-tools.ts` - Tool definitions
2. `generated-client/tools/[entity]-tool-executor.ts` - Executors
3. `generated-client/tools/index.ts` - Export tout

### Phase 4: Template de projet avec agent

**Fichiers template à créer:**
- `/packages/core/templates/scripts/create-agent.ts` - Créer un agent
- `/packages/core/templates/examples/agent-example.ts` - Exemple d'utilisation

**Fonctionnalités:**
- Script pour créer rapidement un agent avec tools
- Exemple d'utilisation complète
- Documentation auto-générée des tools disponibles

### Phase 5: Introspection et documentation

**Fichiers à créer:**
- `/packages/runtime/src/introspection/tools-introspector.ts` - Liste tools disponibles
- `/packages/core/src/generator/tools-docs-generator.ts` - Docs Markdown

**Fonctionnalités:**
1. `client.listAvailableTools()` - Liste programmatique
2. Génération de docs Markdown des tools
3. Schema JSON des tools pour IDE autocomplete

## 🎨 Exemples d'utilisation

### Exemple 1: Agent de recherche de code

```typescript
const agent = new ConversationAgent({
  neo4j,
  llmProvider,
  tools: SCOPE_TOOLS,
  toolExecutor: new ScopeToolExecutor(ragClient)
});

await conversation.sendMessage(
  "Find authentication-related functions with complexity > 10"
);

// L'agent va:
// 1. Utiliser semantic_search avec query "authentication"
// 2. Filter avec complexityGt5
// 3. Analyser les résultats
// 4. Répondre avec une liste structurée
```

### Exemple 2: Agent de refactoring

```typescript
await conversation.sendMessage(
  "What are the most complex functions that depend on UserService?"
);

// L'agent va:
// 1. Chercher "UserService" avec textSearch
// 2. getRelationship('CALLED_BY') pour les callers
// 3. filter('complexityGt5') sur les résultats
// 4. Suggérer des refactorings
```

### Exemple 3: Agent e-commerce

```yaml
# Config pour e-commerce
entities:
  - entity: Product
    filters:
      - name: inStock
        cypher: "n.stock > 0"
      - name: onSale
        cypher: "n.salePrice IS NOT NULL"
    semanticIndexes:
      - name: product_descriptions
        field: description
```

```typescript
await conversation.sendMessage(
  "Show me wireless headphones under $100 that are in stock"
);

// L'agent va:
// 1. semanticSearch('product_descriptions', 'wireless headphones')
// 2. filter('inStock')
// 3. Filter price < 100
// 4. Présenter les résultats
```

## 🚀 Avantages

### Pour les développeurs

✅ **Configuration déclarative** - Pas besoin d'écrire du code tool calling
✅ **Type-safe** - Génération automatique de TypeScript
✅ **Réutilisable** - Même config pour tous les agents
✅ **Documenté** - Docs auto-générées des tools

### Pour les agents

✅ **Tools riches** - Accès à toutes les capacités RAG
✅ **Contexte clair** - Descriptions précises de chaque tool
✅ **Flexibilité** - Combinaison de tools pour requêtes complexes
✅ **Performance** - Cypher optimisé généré automatiquement

### Pour les utilisateurs

✅ **Natural language** - Queries en langage naturel
✅ **Précis** - Résultats pertinents via semantic search + filtres
✅ **Rapide** - Pas besoin d'apprendre la syntax de query
✅ **Contexte** - L'agent se souvient des conversations précédentes

## 🔮 Extensions futures

### Multi-hop reasoning
```typescript
// L'agent peut chaîner plusieurs tools
"Find functions that call authentication logic AND are called by API endpoints"
→ semantic_search("authentication")
→ get_callers()
→ filter by relationship to APIEndpoint
```

### Aggregations
```yaml
filters:
  - name: groupByComplexity
    description: "Group scopes by complexity buckets"
    aggregation: true
    cypher: "GROUP BY CASE WHEN n.complexity < 5 THEN 'low' ..."
```

### Custom combinaisons
```yaml
compositions:
  - name: critical_code
    description: "High complexity + frequently called"
    steps:
      - filter: complexityGt5
      - relationship: CALLED_BY
      - count: "> 10"
```

## 📝 Questions ouvertes

1. **Permissions** - Comment gérer les permissions sur les tools? Certains tools ne devraient être accessibles qu'à certains users?

2. **Rate limiting** - Faut-il limiter le nombre d'appels de tools par conversation?

3. **Cost tracking** - Comment tracker le coût des requêtes (LLM calls + DB queries)?

4. **Caching** - Cache des résultats de tools fréquemment appelés?

5. **Streaming** - Support du streaming pour les résultats volumineux?

6. **Multi-entity queries** - Comment supporter "Find Products related to Users who bought X"?

## 🎯 Prochaines étapes

1. **Valider le design** avec cas d'usage concrets
2. **Implémenter Phase 1** (Generic Query Builder)
3. **Tester** avec le client code RAG existant
4. **Itérer** sur l'API selon feedback
5. **Documenter** patterns d'utilisation
6. **Généraliser** à d'autres domaines (e-commerce, docs, etc.)
