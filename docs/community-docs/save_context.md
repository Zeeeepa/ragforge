# Rapport: Services Community-Docs pouvant migrer vers Core

## Architecture actuelle Community-Docs

### Services d'enrichissement (candidats migration)

#### 1. enrichment-service.ts (794 lignes)
**Role**: Extraction LLM d'entités, tags, descriptions depuis le contenu
- Utilise `StructuredLLMExecutor` de core
- Extrait: Person, Organization, Location, Concept, Technology, DateEvent, Product
- Extrait tags avec catégories (topic, technology, domain, audience, type)
- Génère descriptions et keywords

**Dépendances core**: StructuredLLMExecutor, ClaudeAPIProvider
**Spécifique community-docs**: Rien de spécifique, totalement générique

#### 2. entity-resolution-service.ts (1144 lignes)
**Role**: Déduplication et résolution d'entités cross-documents
- Groupe entités par type
- Utilise LLM pour identifier duplicats sémantiques
- Crée/met à jour CanonicalEntity nodes
- Lie mentions aux entités canoniques
- Fonctions utilitaires: `pickCanonicalTag()`, `pickCanonicalEntity()`

**Dépendances core**: StructuredLLMExecutor, Neo4jClient
**Spécifique community-docs**: Rien, 100% générique

#### 3. entity-embedding-service.ts (824 lignes)
**Role**: Embeddings pour Entity, CanonicalEntity, Tag nodes
- Génère embeddings pour recherche sémantique sur entités
- Recherche hybride BM25 + semantic (comme SearchService)
- Index vector pour Entity/Tag

**Dépendances core**: Utilise pattern similaire à EmbeddingService de core
**Spécifique community-docs**: Rien

#### 4. entity-types.ts (308 lignes)
**Role**: Types TypeScript pour entités extraites
- BaseEntity, PersonEntity, OrganizationEntity, etc.
- ExtractedTag, SuggestedCategory
- EnrichmentOptions, EnrichmentResult
- EntityNode, TagNode (schémas Neo4j)

**Spécifique community-docs**: Rien, types génériques

### Services d'ingestion (déjà bien intégrés avec core)

#### 5. ingestion-service.ts (353 lignes)
**Role**: Point d'entrée unifié pour ingestion
- Route vers orchestrator selon type (binary/media/text)
- Détection type par extension

**Note**: Wrapper léger autour de orchestrator-adapter, pourrait rester dans community-docs

#### 6. orchestrator-adapter.ts (1998 lignes)
**Role**: Adapte le core IngestionOrchestrator pour community-docs
- Hook `transformGraph` pour injecter metadata communautaire
- Appelle enrichment après parsing
- Gère entity resolution après ingestion

**Ce qui est générique**:
- Appel enrichment post-parse (lignes 1070-1220)
- Entity/tag storage dans Neo4j
- Entity resolution

**Ce qui est spécifique**:
- Injection metadata (documentId, categoryId, userId, etc.)

## Flux actuel d'ingestion

```
1. Fichier uploadé
2. ingestion-service.ts route selon type
3. orchestrator-adapter appelle core.IngestionOrchestrator
4. transformGraph hook injecte metadata communautaire
5. Nodes créés dans Neo4j
6. enrichmentService.enrichDocument() extrait entités/tags
7. Entités/tags stockés dans Neo4j avec liens vers nodes sources
8. entityResolutionService.resolveEntities() déduplique
9. embeddingService génère embeddings (core)
10. entityEmbeddingService génère embeddings entités/tags
```

## Proposition de migration vers Core

### Phase 1: Types et interfaces (facile)
Migrer `entity-types.ts` vers `packages/core/src/types/entity-types.ts`
- Types génériques pour toute extraction d'entités

### Phase 2: Service d'enrichissement (moyen)
Migrer `enrichment-service.ts` vers `packages/core/src/brain/enrichment-service.ts`
- Intégrer comme étape optionnelle du pipeline d'ingestion
- Option `enableEnrichment: boolean` dans config

### Phase 3: Entity Resolution (moyen)
Migrer `entity-resolution-service.ts` vers `packages/core/src/brain/entity-resolution-service.ts`
- Exécuté automatiquement après enrichment si activé

### Phase 4: Entity Embeddings (facile)
Migrer logique dans `EmbeddingService` existant
- Ajouter Entity, CanonicalEntity, Tag aux NODE_TYPE_CONFIGS
- Réutiliser infrastructure existante

### Phase 5: Hooks dans IncrementalIngestionManager
Ajouter hooks dans le core:
```typescript
interface IngestionHooks {
  afterParse?: (graph: ParsedGraph, projectId: string) => Promise<void>;
  afterEnrich?: (enrichment: EnrichmentResult, projectId: string) => Promise<void>;
  afterEmbed?: (stats: EmbeddingStats, projectId: string) => Promise<void>;
}
```

## Avantages de la migration

1. **Réutilisabilité**: Tout projet ragforge bénéficie de l'extraction d'entités
2. **Ingestion incrémentale**: Les entités seraient re-extraites seulement si contenu change
3. **Cohérence**: Un seul EmbeddingService pour tout (nodes + entités)
4. **Maintenance**: Code centralisé dans core

## Ce qui reste dans Community-Docs

1. **Metadata injection**: Hook transformGraph avec documentId, categoryId, userId
2. **API routes**: /search, /ingest, /entities spécifiques à l'app
3. **Agent tools**: Outils spécifiques au chatbot communautaire
4. **Upload handling**: Gestion multipart, ZIP, etc.

## Schéma Neo4j pour entités (à créer dans core)

```cypher
// Entity mention (lié au node source)
(:Entity {
  uuid, name, normalizedName, entityType,
  confidence, aliases[], properties{},
  projectId, embedding_name
})-[:MENTIONED_IN]->(:Scope|:MarkdownSection|:File)

// Canonical entity (deduplicated)
(:CanonicalEntity {
  uuid, name, normalizedName, entityType,
  aliases[], properties{}, projectIds[],
  mentionCount, embedding_name
})<-[:RESOLVED_TO]-(:Entity)

// Tag
(:Tag {
  uuid, name, normalizedName, category,
  projectIds[], usageCount, embedding_name
})-[:TAGS]->(:Scope|:MarkdownSection|:File)
```

## Analyse technique: FileStateMachine et intégration

### États actuels du pipeline (file-state-machine.ts)

```
mentioned → discovered → parsing → parsed → relations → linked → embedding → embedded
                                                                     ↓
                                                                   error
```

**États existants**:
- `mentioned`: Fichier référencé par un autre mais pas encore accédé
- `discovered`: Fichier détecté, prêt pour parsing
- `parsing`: En cours de parsing
- `parsed`: Parsing terminé, nodes créés
- `relations`: Construction des relations (imports, etc.)
- `linked`: Relations créées, prêt pour embeddings
- `embedding`: Génération embeddings en cours
- `embedded`: Terminé

### Hooks existants dans core

1. **`transformGraph`** (orchestrator.ts:97)
   - Appelé après parsing, avant ingestion
   - Utilisé par community-docs pour injecter metadata
   - Signature: `(graph) => Promise<graph>`

2. **`onFileLinked`** (file-processor.ts:107)
   - Appelé quand fichier passe à état `linked`
   - Pour résoudre PENDING_IMPORT → CONSUMES

3. **`onCreateMentionedFile`** (file-processor.ts:114)
   - Crée fichier "mentioned" pour imports non résolus

### Proposition: Hooks optionnels (PAS de nouveaux états)

**Important**: L'enrichissement doit rester **optionnel**. Un dev qui utilise ragforge CLI pour des agents de code n'a pas besoin d'extraire des entités "Person", "Organization", etc.

**❌ Option A rejetée**: Ajouter états `enriching`/`enriched` forcerait tous les utilisateurs à passer par ces états, même s'ils n'en ont pas besoin.

**✅ Option B retenue: Hooks dans EmbeddingCoordinator**

```typescript
// embedding-coordinator.ts
interface EnrichmentHook {
  beforeEmbed?: (projectId: string, files: FileStateInfo[]) => Promise<void>;
  afterEmbed?: (projectId: string, result: EmbedProjectResult) => Promise<void>;
}

// Dans embedProject():
if (this.hooks?.beforeEmbed) {
  await this.hooks.beforeEmbed(projectId, linkedFiles);
}
```

### Architecture proposée pour core

```
packages/core/src/
├── brain/
│   ├── enrichment/
│   │   ├── index.ts
│   │   ├── enrichment-service.ts      # Extraction LLM entités/tags
│   │   ├── entity-resolution.ts       # Déduplication cross-docs
│   │   └── entity-types.ts            # Types TypeScript
│   │
│   ├── file-state-machine.ts          # + états enriching/enriched
│   ├── embedding-service.ts           # + NODE_TYPE_CONFIGS pour Entity/Tag
│   └── embedding-coordinator.ts       # + hooks beforeEmbed/afterEmbed
```

### Configuration dans BrainManager (optionnel, désactivé par défaut)

```typescript
interface BrainManagerConfig {
  // Existant
  projectId: string;
  neo4jClient: Neo4jClient;

  // Nouveau - OPTIONNEL, désactivé par défaut
  enrichment?: {
    enabled: false,  // DEFAULT: false - pas d'enrichissement pour CLI/agents code
    entityTypes?: EntityType[];  // Quels types extraire si activé
    extractTags?: boolean;
    llmProvider?: 'claude' | 'gemini';
    resolveAcrossProjects?: boolean;
  };
}

// Usage CLI (défaut): pas d'enrichissement
const brain = new BrainManager({ projectId: 'my-code' });

// Usage community-docs: enrichissement activé
const brain = new BrainManager({
  projectId: 'docs',
  enrichment: {
    enabled: true,
    entityTypes: ['Person', 'Organization', 'Technology'],
    extractTags: true,
  }
});
```

### Impact sur ingestion incrémentale (si enrichment activé)

Quand `enrichment.enabled: true`, le hook `beforeEmbed` serait appelé:
- **Incrémental**: Seulement si contenu changé (hash différent via FileStateMachine)
- **Parallélisable**: Plusieurs fichiers peuvent être enrichis en batch
- **Non-bloquant pour CLI**: Si désactivé, le pipeline reste identique à aujourd'hui

**Flow avec enrichment activé**:
```
linked → [beforeEmbed hook: enrichDocument()] → embedding → embedded
```

**Flow CLI (défaut, sans enrichment)**:
```
linked → embedding → embedded  (inchangé)
```

### Intégration Entity dans EmbeddingService

```typescript
// embedding-service.ts - NODE_TYPE_CONFIGS
const NODE_TYPE_CONFIGS = {
  Scope: { ... },
  MarkdownSection: { ... },
  // Nouveaux types
  Entity: {
    nameFields: ['name', 'normalizedName'],
    contentFields: ['properties'],
    descriptionFields: ['description'],
    embeddingDimensions: { name: 768, content: 768, description: 768 },
  },
  CanonicalEntity: {
    nameFields: ['name', 'aliases'],
    contentFields: ['properties'],
    descriptionFields: ['description'],
    embeddingDimensions: { name: 768, content: 768, description: 768 },
  },
  Tag: {
    nameFields: ['name', 'normalizedName'],
    contentFields: [],  // Tags n'ont pas de contenu
    descriptionFields: [],
    embeddingDimensions: { name: 768 },
  },
};
```

## Prochaines étapes suggérées

### Phase 1: Préparation (1-2 jours)
1. Créer `packages/core/src/brain/enrichment/entity-types.ts` avec types
2. Créer interfaces dans `packages/core/src/brain/enrichment/index.ts`

### Phase 2: Services enrichissement (3-4 jours)
3. Migrer `enrichment-service.ts` vers core
4. Adapter pour être configurable (entity types, LLM provider)
5. Migrer `entity-resolution-service.ts`

### Phase 3: Machine d'états (1-2 jours)
6. Ajouter états `enriching`/`enriched` à FileStateMachine
7. Ajouter hooks `beforeEmbed` dans EmbeddingCoordinator

### Phase 4: Embeddings entités (1 jour)
8. Ajouter NODE_TYPE_CONFIGS pour Entity/CanonicalEntity/Tag
9. Créer index vectors pour ces types

### Phase 5: Tests et migration community-docs (2-3 jours)
10. Tests unitaires pour enrichment
11. Mettre à jour community-docs pour utiliser core
12. Retirer code dupliqué de community-docs

## Estimation effort total: ~10 jours de développement
