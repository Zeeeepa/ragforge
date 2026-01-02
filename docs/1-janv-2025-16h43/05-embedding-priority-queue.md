# 05 - Embedding Priority Queue

## Objectif

Créer une queue de priorité pour la génération d'embeddings:
- Fichiers accédés par l'agent = haute priorité
- Fichiers schema-ready non-accédés = basse priorité ou jamais
- Traitement en background, ne bloque pas l'agent

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sources d'événements                         │
├─────────────────────────────────────────────────────────────────┤
│  grep_files --analyze  →  files accessed  →  priority: HIGH    │
│  read_file             →  file accessed   →  priority: HIGH    │
│  brain_search          →  results viewed  →  priority: MEDIUM  │
│  schema ingestion done →  new files       →  priority: LOW     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EmbeddingPriorityQueue                       │
├─────────────────────────────────────────────────────────────────┤
│  Priority Levels:                                               │
│    HIGH (100)   - Fichiers accédés directement                  │
│    MEDIUM (50)  - Fichiers dans résultats brain_search          │
│    LOW (10)     - Fichiers nouvellement ingérés                 │
│    NONE (0)     - Ne pas générer d'embeddings                   │
├─────────────────────────────────────────────────────────────────┤
│  Queue Structure:                                               │
│    { fileUuid, priority, source, addedAt, projectId }           │
├─────────────────────────────────────────────────────────────────┤
│  Processing:                                                    │
│    - Background worker                                          │
│    - Batch de 50 fichiers max                                   │
│    - Pause entre batches (éviter surcharge API)                 │
│    - Respecte l'ordre de priorité                               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EmbeddingService                             │
│                    (existant)                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Implémentation

### 1. EmbeddingPriorityQueue

```typescript
// packages/core/src/brain/embedding-priority-queue.ts

export enum EmbeddingPriority {
  NONE = 0,
  LOW = 10,
  MEDIUM = 50,
  HIGH = 100,
}

interface QueueItem {
  fileUuid: string;
  filePath: string;
  projectId: string;
  priority: EmbeddingPriority;
  source: 'grep-access' | 'read-access' | 'search-result' | 'schema-complete';
  addedAt: number;
}

export class EmbeddingPriorityQueue extends EventEmitter {
  private queue: QueueItem[] = [];
  private processing = false;
  private embeddingService: EmbeddingService;
  private stateMachine: FileStateMachine;

  // Configuration
  private batchSize = 50;
  private pauseBetweenBatches = 2000;  // 2 secondes
  private maxConcurrent = 5;

  constructor(
    embeddingService: EmbeddingService,
    stateMachine: FileStateMachine
  ) {
    super();
    this.embeddingService = embeddingService;
    this.stateMachine = stateMachine;
  }

  async addFile(
    filePath: string,
    options: {
      priority: EmbeddingPriority;
      source: QueueItem['source'];
      projectId?: string;
    }
  ): Promise<void> {
    // Récupérer l'UUID du fichier depuis Neo4j
    const fileInfo = await this.getFileInfo(filePath);
    if (!fileInfo) {
      console.warn(`[EmbeddingQueue] File not found in Neo4j: ${filePath}`);
      return;
    }

    // Skip si déjà embedded
    if (fileInfo.state === 'embedded') {
      return;
    }

    // Skip si déjà dans la queue avec priorité >=
    const existing = this.queue.find(i => i.fileUuid === fileInfo.uuid);
    if (existing && existing.priority >= options.priority) {
      return;
    }

    // Ajouter ou mettre à jour
    if (existing) {
      existing.priority = options.priority;
      existing.source = options.source;
    } else {
      this.queue.push({
        fileUuid: fileInfo.uuid,
        filePath,
        projectId: options.projectId || fileInfo.projectId,
        priority: options.priority,
        source: options.source,
        addedAt: Date.now(),
      });
    }

    // Trier par priorité (desc) puis par addedAt (asc)
    this.sortQueue();

    // Démarrer le traitement si pas en cours
    if (!this.processing) {
      this.startProcessing();
    }
  }

  async addFiles(
    filePaths: string[],
    options: {
      priority: EmbeddingPriority;
      source: QueueItem['source'];
      projectId?: string;
    }
  ): Promise<void> {
    await Promise.all(
      filePaths.map(path => this.addFile(path, options))
    );
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.addedAt - b.addedAt;
    });
  }

  private async startProcessing(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    this.emit('processing-started');

    while (this.queue.length > 0) {
      // Prendre un batch
      const batch = this.queue.splice(0, this.batchSize);

      this.emit('batch-started', { count: batch.length });

      try {
        // Transition vers 'embedding'
        const uuids = batch.map(i => i.fileUuid);
        await this.stateMachine.transitionBatch(uuids, 'embedding');

        // Générer les embeddings
        const result = await this.embeddingService.generateForFiles(uuids);

        // Transition vers 'embedded'
        const successUuids = result.successful.map(r => r.uuid);
        await this.stateMachine.transitionBatch(successUuids, 'embedded');

        // Gérer les erreurs
        for (const error of result.errors) {
          await this.stateMachine.transition(error.uuid, 'error', {
            errorType: 'embed',
            errorMessage: error.message,
          });
        }

        this.emit('batch-completed', {
          processed: successUuids.length,
          errors: result.errors.length,
        });
      } catch (error: any) {
        console.error('[EmbeddingQueue] Batch failed:', error.message);
        this.emit('batch-failed', { error: error.message });
      }

      // Pause entre batches (éviter rate limiting API)
      if (this.queue.length > 0) {
        await this.sleep(this.pauseBetweenBatches);
      }
    }

    this.processing = false;
    this.emit('processing-completed');
  }

  // Helpers
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async getFileInfo(filePath: string): Promise<FileInfo | null> {
    // Query Neo4j pour obtenir les infos du fichier
    // ...
  }

  // Status
  getStatus(): QueueStatus {
    return {
      processing: this.processing,
      pending: this.queue.length,
      byPriority: {
        high: this.queue.filter(i => i.priority >= EmbeddingPriority.HIGH).length,
        medium: this.queue.filter(i =>
          i.priority >= EmbeddingPriority.MEDIUM &&
          i.priority < EmbeddingPriority.HIGH
        ).length,
        low: this.queue.filter(i => i.priority < EmbeddingPriority.MEDIUM).length,
      },
    };
  }

  // Pause/Resume
  pause(): void {
    this.processing = false;
  }

  resume(): void {
    if (!this.processing && this.queue.length > 0) {
      this.startProcessing();
    }
  }
}
```

### 2. Intégration avec BrainManager

```typescript
// packages/core/src/brain/brain-manager.ts

class BrainManager {
  private embeddingQueue: EmbeddingPriorityQueue;

  async initialize() {
    // ... initialisation existante ...

    // Créer la queue d'embeddings
    this.embeddingQueue = new EmbeddingPriorityQueue(
      this.embeddingService,
      this.fileStateMachine
    );

    // Écouter les événements pour logging/monitoring
    this.embeddingQueue.on('batch-completed', ({ processed, errors }) => {
      console.log(`[EmbeddingQueue] Batch: ${processed} embedded, ${errors} errors`);
    });
  }

  getEmbeddingQueue(): EmbeddingPriorityQueue {
    return this.embeddingQueue;
  }
}
```

### 3. Intégration avec grep_files

```typescript
// packages/core/src/tools/fs-tools.ts

export function generateGrepFilesHandler(ctx: FsToolsContext) {
  return async (params: GrepFilesParams) => {
    // ... grep logic ...

    if (analyze) {
      // ... analysis logic ...

      // Queue les fichiers accédés pour embeddings (fire-and-forget)
      ctx.brain.getEmbeddingQueue().addFiles(matchedFilePaths, {
        priority: EmbeddingPriority.HIGH,
        source: 'grep-access',
      }).catch(() => {});  // Ignore errors, non-blocking
    }

    return result;
  };
}
```

### 4. Intégration avec read_file

```typescript
// packages/core/src/tools/fs-tools.ts

export function generateReadFileHandler(ctx: FsToolsContext) {
  return async (params: ReadFileParams) => {
    const { path: filePath } = params;

    // ... read logic ...

    // Queue le fichier pour embeddings (fire-and-forget)
    ctx.brain.getEmbeddingQueue().addFile(filePath, {
      priority: EmbeddingPriority.HIGH,
      source: 'read-access',
    }).catch(() => {});  // Ignore errors, non-blocking

    return result;
  };
}
```

### 5. Intégration avec schema ingestion

```typescript
// packages/core/src/brain/brain-manager.ts

async schemaIngest(dirPath: string, options?: SchemaIngestOptions) {
  // ... ingestion logic ...

  // Émettre événement pour la queue (basse priorité)
  this.emit('schema-ready', {
    projectId,
    filePaths: processedFilePaths,
  });
}

// Listener pour ajouter à la queue en basse priorité
this.on('schema-ready', ({ projectId, filePaths }) => {
  // Option: ne PAS ajouter automatiquement
  // Seulement quand accédé
});
```

## Configuration

```typescript
interface EmbeddingQueueConfig {
  // Taille des batches
  batchSize: number;  // default: 50

  // Pause entre batches (ms)
  pauseBetweenBatches: number;  // default: 2000

  // Activer/désactiver la queue automatique
  enabled: boolean;  // default: true

  // Ajouter automatiquement les fichiers schema-ready?
  autoQueueSchemaReady: boolean;  // default: false

  // Priorité par défaut pour différentes sources
  priorities: {
    grepAccess: EmbeddingPriority;    // default: HIGH
    readAccess: EmbeddingPriority;    // default: HIGH
    searchResult: EmbeddingPriority;  // default: MEDIUM
    schemaComplete: EmbeddingPriority; // default: NONE (pas auto)
  };
}
```

## Persistance de la queue

Options:
1. **En mémoire seulement** - Perdue au restart
2. **Dans Neo4j** - Persiste via flag `queuedForEmbedding`
3. **Dans un fichier local** - Simple mais séparé

**Recommandation:** Option 2 - utiliser un flag Neo4j:

```typescript
// Marquer un fichier comme "queued for embedding"
await neo4j.run(`
  MATCH (f:File {uuid: $uuid})
  SET f.embeddingQueued = true,
      f.embeddingPriority = $priority,
      f.embeddingSource = $source
`);

// Au démarrage, restaurer la queue
async restoreQueue(): Promise<void> {
  const result = await neo4j.run(`
    MATCH (f:File)
    WHERE f.embeddingQueued = true AND f.state = 'schema-ready'
    RETURN f.uuid, f.path, f.projectId, f.embeddingPriority, f.embeddingSource
    ORDER BY f.embeddingPriority DESC
  `);

  for (const record of result.records) {
    this.queue.push({
      fileUuid: record.get('uuid'),
      filePath: record.get('path'),
      // ...
    });
  }
}
```

## Métriques et monitoring

```typescript
interface QueueMetrics {
  totalProcessed: number;
  totalErrors: number;
  averageBatchDuration: number;
  currentQueueSize: number;
  bySource: Record<string, number>;
}

// Exposer via tool MCP
export function generateEmbeddingQueueStatusHandler(ctx: BrainToolsContext) {
  return async () => {
    const queue = ctx.brain.getEmbeddingQueue();
    return {
      status: queue.getStatus(),
      metrics: queue.getMetrics(),
    };
  };
}
```

## Étapes d'implémentation

1. **Créer `EmbeddingPriorityQueue`** - Core queue logic
2. **Intégrer dans `BrainManager`** - Création et lifecycle
3. **Modifier `grep_files`** - Queue fichiers accédés
4. **Modifier `read_file`** - Queue fichiers lus
5. **Ajouter persistance Neo4j** - Flag `embeddingQueued`
6. **Ajouter tool status MCP** - Monitoring
7. **Tests** - Queue ordering, processing, errors

## Questions

### Q1: Faut-il un rate limiter pour l'API Gemini?

Oui, le batch size et la pause entre batches servent de rate limiting implicite. Mais on pourrait ajouter un rate limiter explicite si nécessaire.

### Q2: Que faire si la queue devient très grande?

Options:
- Limiter la taille max de la queue
- Prioriser plus agressivement (drop low priority)
- Alerter l'utilisateur

### Q3: Faut-il exposer des contrôles utilisateur?

Oui, via tools MCP:
- `embedding_queue_status` - Voir le statut
- `embedding_queue_pause` - Mettre en pause
- `embedding_queue_resume` - Reprendre
- `embedding_queue_clear` - Vider la queue
