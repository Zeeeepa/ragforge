# 02 - Schema-Only Ingestion

## Objectif

Créer un mode d'ingestion rapide qui:
- Parse les fichiers (AST)
- Extrait les scopes et relations
- Stocke dans Neo4j
- S'arrête à `schema-ready` (pas d'embeddings)

## API proposée

### Nouvelle méthode: `schemaIngest`

```typescript
// packages/core/src/brain/brain-manager.ts

interface SchemaIngestOptions {
  projectName?: string;
  include?: string[];
  exclude?: string[];
  verbose?: boolean;
  // PAS d'options d'embeddings - c'est le point
}

interface SchemaIngestResult {
  projectId: string;
  filesProcessed: number;
  scopesCreated: number;
  relationshipsCreated: number;
  durationMs: number;
  watching: boolean;
}

async schemaIngest(
  dirPath: string,
  options?: SchemaIngestOptions
): Promise<SchemaIngestResult>
```

### Implémentation

```typescript
async schemaIngest(
  dirPath: string,
  options: SchemaIngestOptions = {}
): Promise<SchemaIngestResult> {
  const absolutePath = path.resolve(dirPath);
  const startTime = Date.now();

  // 1. Enregistrer le projet
  const displayName = options.projectName || path.basename(absolutePath);
  const projectId = await this.registerProject(absolutePath, 'schema', displayName);

  // 2. Migrer les orphelins existants (préserve le travail déjà fait)
  await this.migrateOrphansToProject(projectId, absolutePath);

  // 3. Créer le source config
  const sourceConfig: SourceConfig = {
    type: 'directory',
    path: absolutePath,
    include: options.include || DEFAULT_INCLUDE_PATTERNS,
    exclude: options.exclude || DEFAULT_EXCLUDE_PATTERNS,
  };

  // 4. Lock pendant l'ingestion
  const opKey = this.ingestionLock.acquire('schema-ingest', absolutePath, {
    description: `Schema ingest: ${displayName}`,
    timeoutMs: 0,  // Pas de timeout pour l'ingestion initiale
  });

  let stats: IncrementalStats;
  try {
    // 5. Ingérer (schema seulement - la clé est ici)
    const ingestionManager = new IncrementalIngestionManager(
      this.neo4jClient,
      this.fileStateMachine,
      { concurrency: 10 }
    );

    stats = await ingestionManager.ingestFromPaths(sourceConfig, {
      projectId,
      verbose: options.verbose,
      incremental: true,
      // État final sera 'schema-ready', pas besoin de flag spécial
      // car c'est le nouveau comportement par défaut
    });
  } finally {
    this.ingestionLock.release(opKey);
  }

  // 6. Démarrer le watcher (pour les changements futurs)
  await this.startSchemaWatcher(absolutePath, {
    projectId,
    includePatterns: sourceConfig.include,
    excludePatterns: sourceConfig.exclude,
    verbose: options.verbose,
  });

  return {
    projectId,
    filesProcessed: stats.processed,
    scopesCreated: stats.totalScopesCreated || 0,
    relationshipsCreated: stats.totalRelationshipsCreated || 0,
    durationMs: Date.now() - startTime,
    watching: true,
  };
}
```

## Watcher Schema-Only

Le watcher doit aussi fonctionner en mode schema-only:

```typescript
async startSchemaWatcher(
  dirPath: string,
  options: SchemaWatcherOptions
): Promise<void> {
  const absolutePath = path.resolve(dirPath);

  const ingestionManager = new IncrementalIngestionManager(
    this.neo4jClient,
    this.fileStateMachine,
    { concurrency: 10 }
  );

  // Watcher SANS callbacks d'embeddings
  const watcher = new FileWatcher(ingestionManager, sourceConfig, {
    projectId: options.projectId,
    ingestionLock: this.ingestionLock,
    // PAS de embeddingLock - pas d'embeddings
    batchInterval: 1000,

    // Callback pour notifier la queue d'embeddings (optionnel)
    afterIngestion: async (stats) => {
      if (stats.created + stats.updated > 0) {
        // Émettre événement - la queue d'embeddings peut écouter
        this.emit('files-schema-ready', {
          projectId: options.projectId,
          count: stats.created + stats.updated,
        });
      }
    },
  });

  await watcher.start();
  this.schemaWatchers.set(options.projectId, watcher);
}
```

## Comparaison avec `quickIngest` actuel

| Aspect | `quickIngest` (actuel) | `schemaIngest` (nouveau) |
|--------|------------------------|--------------------------|
| État final | `embedded` | `schema-ready` |
| Embeddings | Oui (automatique) | Non |
| Durée typique | 30s - 2min | 5-15s |
| brain_search sémantique | Oui | Non (jusqu'à embedding) |
| extract_hierarchy | Oui | Oui |
| Watcher embeddings | Oui | Non |

## Modifications dans `file-processor.ts`

Le changement clé est que `linked` transite maintenant vers `schema-ready`:

```typescript
// packages/core/src/brain/file-processor.ts

async processBatch(
  files: FileInfo[],
  options: ProcessBatchOptions = {}
): Promise<BatchResult> {
  // ... parsing existant ...

  // Création des relations
  await this.createRelationships(parsedGraphs);

  // Transition finale - TOUJOURS vers schema-ready maintenant
  await this.stateMachine.transitionBatch(fileUuids, 'schema-ready');

  return result;
}
```

## Que devient `quickIngest`?

Deux options:

### Option A: Garder les deux méthodes

```typescript
// schemaIngest - rapide, pas d'embeddings
await brain.schemaIngest('/path/to/project');

// quickIngest - complet, avec embeddings (renommé fullIngest?)
await brain.quickIngest('/path/to/project');
```

### Option B: Une seule méthode avec option

```typescript
// Par défaut: schema-only
await brain.ingest('/path/to/project');

// Avec embeddings (pour cas spéciaux)
await brain.ingest('/path/to/project', { generateEmbeddings: true });
```

**Recommandation:** Option B - plus simple, un seul point d'entrée.

## Tool MCP

Modifier `ingest_directory` pour être schema-only par défaut:

```typescript
// packages/core/src/tools/brain-tools.ts

export function generateIngestDirectoryHandler(ctx: BrainToolsContext) {
  return async (params: {
    path: string;
    project_name?: string;
    include?: string[];
    exclude?: string[];
    generate_embeddings?: boolean;  // Nouveau, default false
  }) => {
    const result = await ctx.brain.schemaIngest(params.path, {
      projectName: params.project_name,
      include: params.include,
      exclude: params.exclude,
    });

    // Si embeddings demandés explicitement
    if (params.generate_embeddings) {
      await ctx.brain.embedProject(result.projectId);
    }

    return {
      success: true,
      project_id: result.projectId,
      files_processed: result.filesProcessed,
      scopes_created: result.scopesCreated,
      relationships_created: result.relationshipsCreated,
      duration_ms: result.durationMs,
      embeddings_generated: params.generate_embeddings || false,
      message: params.generate_embeddings
        ? `Ingested with embeddings in ${result.durationMs}ms`
        : `Schema ingested in ${result.durationMs}ms. Embeddings on-demand.`,
    };
  };
}
```

## Étapes d'implémentation

1. **Modifier `FileStateMachine`** - Ajouter `schema-ready`, modifier transitions
2. **Modifier `FileProcessor`** - Transition finale vers `schema-ready`
3. **Créer `schemaIngest`** dans `BrainManager`
4. **Créer `startSchemaWatcher`** dans `BrainManager`
5. **Supprimer auto-embed** dans `startWatching` callback
6. **Modifier tool `ingest_directory`** - schema-only par défaut
7. **Tests** - Vérifier que les fichiers s'arrêtent bien en `schema-ready`
