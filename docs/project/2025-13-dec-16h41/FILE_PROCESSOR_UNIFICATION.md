# Plan: Unification du traitement des fichiers

## Contexte

Actuellement, deux systèmes traitent les fichiers:
- **TouchedFilesWatcher**: fichiers orphelins (hors projets)
- **IncrementalIngestionManager**: fichiers de projets

Ces systèmes partagent beaucoup de logique mais avec des différences subtiles qui compliquent la maintenance.

---

## Problème des chemins

### Situation actuelle

| Système | Identifiant fichier | Stockage Neo4j |
|---------|---------------------|----------------|
| Orphan | `absolutePath` | `absolutePath`, `file` = absolutePath |
| Project | `file` (relatif) | `file`, `path`, parfois `absolutePath` |

### Normalisations actuelles à éliminer

Les fichiers suivants font des conversions `absolute → relative` qui seraient évitées:

#### 1. `code-source-adapter.ts` (lignes 936, 1086, 1300, etc.)
```typescript
// Actuellement: conversion systématique en relatif
const relPath = path.relative(projectRoot, filePath);
// ... stockage de relPath dans les nodes
```
**Occurrences**: ~15 appels à `path.relative()` pour chaque type de fichier

#### 2. `ingestion-queue.ts` (ligne 324)
```typescript
// Actuellement: conversion avant processing
const relPaths = filesToProcess.map(f => path.relative(root, f));
```

#### 3. `incremental-ingestion.ts` (lignes 1436, 1449)
```typescript
// Actuellement: reconstruction de absolutePath depuis relatif
absolutePath: pathModule.resolve(projectPath, r.get('path')),
```

#### 4. `brain-manager.ts` (ligne 1542)
```typescript
// Migration orphan → project: conversion vers relatif
const relativePath = path.relative(projectPath, absolutePath);
// SET f.file = $relativePath
```

### Queries actuelles multi-propriétés (à simplifier)

Actuellement, les queries doivent checker plusieurs propriétés:

```cypher
-- incremental-ingestion.ts:358-362
WHERE n.file = $filePath
   OR n.path = $filePath
   OR n.source_file = $filePath
   OR n.absolutePath = $filePath

-- incremental-ingestion.ts:1109
WHERE n.path IN $relPaths
   OR n.filePath IN $relPaths
   OR n.file IN $relPaths

-- reference-extractor.ts:699
WHERE target.file = $relativePath
   OR target.path = $relativePath
```

**Avec absolutePath unique:**
```cypher
-- Simplifié
WHERE n.absolutePath = $absolutePath
```

---

### Proposition: `absolutePath` comme identifiant canonique

**Schéma unifié:**
```typescript
// Sur tous les File nodes:
{
  absolutePath: '/home/user/project/src/utils.ts',  // Clé primaire canonique
  file: 'src/utils.ts',                              // Relatif (pour affichage)
  projectId: 'my-project',
  // ...
}

// Pour orphans:
{
  absolutePath: '/home/user/random/file.ts',
  file: 'file.ts',  // Juste le nom (pas de projet)
  projectId: 'touched-files',
}
```

**Avantages:**
1. **Lookups uniformes**: Toujours chercher par `absolutePath`
2. **Références cross-project**: PENDING_IMPORT peut pointer par absolutePath
3. **Migration orphan → projet**: Juste changer `projectId`, garder `absolutePath`
4. **Pas d'ambiguïté**: Un fichier = un absolutePath unique
5. **Élimination des conversions**: Plus de `path.relative()` à l'ingestion

**Inconvénients à gérer:**
1. **Portabilité**: Si le projet est déplacé, les absolutePaths deviennent invalides
   - Solution: Stocker `projectRoot` dans Project node, recalculer si besoin
2. **Taille stockage**: Chemins plus longs (marginal avec compression Neo4j)
3. **Migration existante**: Données existantes à migrer

---

### Plan de migration des chemins

#### Étape 1: Ajouter `absolutePath` sur les nodes existants

```cypher
-- Pour chaque projet, calculer absolutePath depuis projectRoot + file
MATCH (p:Project)
WITH p
MATCH (n {projectId: p.projectId})
WHERE n.file IS NOT NULL AND n.absolutePath IS NULL
SET n.absolutePath = p.rootPath + '/' + n.file
```

#### Étape 2: Modifier les adapteurs pour stocker `absolutePath`

**code-source-adapter.ts:**
```typescript
// Avant
const relPath = path.relative(projectRoot, filePath);
// node.file = relPath;

// Après
// node.absolutePath = filePath;  // Garder l'absolu
// node.file = path.relative(projectRoot, filePath);  // Calculer le relatif pour affichage
```

#### Étape 3: Simplifier les queries

```typescript
// Avant
`WHERE n.file = $path OR n.path = $path OR n.absolutePath = $path`

// Après
`WHERE n.absolutePath = $absolutePath`
```

#### Étape 4: Mettre à jour les lookups

**reference-extractor.ts:**
```typescript
// Avant
const pathCondition = useAbsolutePath
  ? 'target.absolutePath = $absolutePath'
  : '(target.file = $relativePath OR target.path = $relativePath)';

// Après (toujours absolutePath)
const pathCondition = 'target.absolutePath = $absolutePath';
```

---

### Gestion de la portabilité

Si un projet est déplacé, les absolutePaths deviennent invalides. Solutions:

#### Option A: Re-ingestion complète
Simple mais coûteux (perte des embeddings).

#### Option B: Migration automatique
```typescript
async migrateProjectPath(oldRoot: string, newRoot: string): Promise<void> {
  await this.neo4jClient.run(`
    MATCH (n)
    WHERE n.absolutePath STARTS WITH $oldPrefix
    SET n.absolutePath = replace(n.absolutePath, $oldPrefix, $newPrefix)
  `, { oldPrefix: oldRoot, newPrefix: newRoot });
}
```

#### Option C: Chemin relatif + résolution à la demande
Stocker `projectRoot` + `relativePath`, calculer `absolutePath` à la lecture.
(Plus complexe, garde la complexité actuelle)

---

## FileProcessor: Module partagé

### Objectif

Unifier la logique de traitement de fichiers entre TouchedFilesWatcher et IncrementalIngestionManager.

### Interface proposée

```typescript
// packages/core/src/brain/file-processor.ts

import type { Neo4jClient } from '../runtime/client/neo4j-client.js';
import type { UniversalSourceAdapter } from '../runtime/adapters/universal-source-adapter.js';
import type { FileStateMachine, FileState } from './file-state-machine.js';
import type { EmbeddingService } from './embedding-service.js';

export interface FileInfo {
  absolutePath: string;
  uuid: string;
  hash?: string;
  state: FileState;
}

export interface ProcessResult {
  status: 'parsed' | 'skipped' | 'error';
  scopesCreated: number;
  referencesCreated: number;
  error?: string;
}

export interface BatchResult {
  processed: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface FileProcessorConfig {
  neo4jClient: Neo4jClient;
  adapter: UniversalSourceAdapter;
  stateMachine: FileStateMachine;
  projectId: string;
  projectRoot?: string;  // Si défini, calcule les chemins relatifs
  verbose?: boolean;
  concurrency?: number;  // Pour p-limit (default: 10)
}

export class FileProcessor {
  constructor(config: FileProcessorConfig);

  /**
   * Process a single file through the complete pipeline:
   * 1. Read file content
   * 2. Check hash (skip if unchanged)
   * 3. Transition: discovered → parsing
   * 4. Parse with UniversalSourceAdapter
   * 5. Transition: parsing → parsed
   * 6. Delete old scopes
   * 7. Create new scopes in Neo4j
   * 8. Transition: parsed → relations
   * 9. Extract and create references
   * 10. Transition: relations → linked
   *
   * @param file - File info with absolutePath
   * @returns Processing result
   */
  async processFile(file: FileInfo): Promise<ProcessResult>;

  /**
   * Batch process multiple files with concurrency control
   * Uses p-limit to avoid overwhelming the system
   */
  async processBatch(files: FileInfo[]): Promise<BatchResult>;

  /**
   * Check if a file needs processing (hash changed)
   */
  async needsProcessing(absolutePath: string, currentHash?: string): Promise<{
    needsProcessing: boolean;
    newHash: string;
    reason?: 'new' | 'changed' | 'error_retry';
  }>;

  /**
   * Create or update File node in Neo4j
   * Always uses absolutePath as the canonical identifier
   */
  async ensureFileNode(absolutePath: string, options?: {
    projectRoot?: string;  // Pour calculer le chemin relatif
    state?: FileState;
  }): Promise<{ uuid: string; created: boolean }>;

  /**
   * Get relative path from absolute path
   */
  getRelativePath(absolutePath: string): string;
}
```

### Logique interne

```typescript
async processFile(file: FileInfo): Promise<ProcessResult> {
  // 1. Transition to parsing
  await this.stateMachine.transition(file.uuid, 'parsing');

  // 2. Read file
  let content: string;
  try {
    content = await fs.readFile(file.absolutePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      await this.deleteFileAndScopes(file.absolutePath);
      return { status: 'skipped', scopesCreated: 0, referencesCreated: 0 };
    }
    throw err;
  }

  // 3. Check hash
  const newHash = this.computeHash(content);
  if (file.hash === newHash) {
    await this.stateMachine.transition(file.uuid, 'linked');
    return { status: 'skipped', scopesCreated: 0, referencesCreated: 0 };
  }

  // 4. Parse with adapter
  const relativePath = this.getRelativePath(file.absolutePath);
  const parseResult = await this.adapter.parse({
    source: {
      type: 'code',
      root: path.dirname(file.absolutePath),
      include: [path.basename(file.absolutePath)],
    },
    projectId: this.projectId,
  });

  // 5. Transition to parsed
  await this.stateMachine.transition(file.uuid, 'parsed', { contentHash: newHash });

  // 6. Delete old scopes
  await this.deleteFileScopes(file.absolutePath);

  // 7. Create new scopes
  let scopesCreated = 0;
  if (parseResult?.graph?.nodes) {
    scopesCreated = await this.createScopes(parseResult.graph, file.absolutePath);
  }

  // 8. Transition to relations
  await this.stateMachine.transition(file.uuid, 'relations');

  // 9. Extract and create references
  const refs = extractReferences(content, file.absolutePath);
  const resolvedRefs = await resolveAllReferences(refs, file.absolutePath, this.projectRoot || path.dirname(file.absolutePath));
  const refResult = await createReferenceRelations(
    this.neo4jClient,
    file.uuid,
    file.absolutePath,
    resolvedRefs,
    this.projectId,
    { createPending: true, useAbsolutePath: true }
  );

  // 10. Transition to linked
  await this.stateMachine.transition(file.uuid, 'linked');
  await this.updateFileHash(file.absolutePath, newHash);

  return {
    status: 'parsed',
    scopesCreated,
    referencesCreated: refResult.created,
  };
}
```

### Utilisation dans TouchedFilesWatcher

```typescript
// Avant (code dupliqué)
private async parseAndIngestFile(file: OrphanFile): Promise<'parsed' | 'skipped' | 'error'> {
  // ~100 lignes de code...
}

// Après (utilise FileProcessor)
private fileProcessor: FileProcessor;

constructor(config: TouchedFilesWatcherConfig) {
  // ...
  this.fileProcessor = new FileProcessor({
    neo4jClient: this.neo4jClient,
    adapter: this.adapter,
    stateMachine: this.stateMachine,
    projectId: this.projectId,
    verbose: this.verbose,
  });
}

private async processFilesForParsing(files: OrphanFile[]): Promise<BatchResult> {
  const fileInfos = files.map(f => ({
    absolutePath: f.absolutePath,
    uuid: f.uuid,
    hash: f.hash,
    state: f.state,
  }));
  return this.fileProcessor.processBatch(fileInfos);
}
```

### Utilisation dans IncrementalIngestionManager

```typescript
// Nouveau getter
get fileProcessor(): FileProcessor {
  if (!this._fileProcessor) {
    this._fileProcessor = new FileProcessor({
      neo4jClient: this.client,
      adapter: getUniversalAdapter(),
      stateMachine: this.stateMachine,
      projectId: this.currentProjectId,
      projectRoot: this.currentProjectRoot,
    });
  }
  return this._fileProcessor;
}

// Utilisation
async reprocessFiles(projectId: string, files: string[]): Promise<BatchResult> {
  const fileInfos = await this.getFileInfos(projectId, files);
  return this.fileProcessor.processBatch(fileInfos);
}
```

---

## Modules complémentaires

### ChangeDetector

```typescript
// packages/core/src/brain/change-detector.ts

export class ChangeDetector {
  constructor(private neo4jClient: Neo4jClient);

  /**
   * Check if file content has changed based on hash
   */
  async hasChanged(absolutePath: string): Promise<{
    changed: boolean;
    newHash: string;
    oldHash?: string;
    reason: 'new' | 'modified' | 'unchanged';
  }>;

  /**
   * Batch check multiple files
   */
  async detectChanges(absolutePaths: string[]): Promise<Map<string, ChangeResult>>;

  /**
   * Get stored hash for a file
   */
  async getStoredHash(absolutePath: string): Promise<string | null>;

  /**
   * Update stored hash
   */
  async updateHash(absolutePath: string, hash: string): Promise<void>;
}
```

### EmbeddingCoordinator

```typescript
// packages/core/src/brain/embedding-coordinator.ts

export class EmbeddingCoordinator {
  constructor(
    private embeddingService: EmbeddingService,
    private stateMachine: FileStateMachine,
    private embeddingLock: IngestionLock
  );

  /**
   * Generate embeddings for all files in 'linked' state
   * Handles: lock acquisition, state transitions, batch processing
   */
  async embedProject(projectId: string, options?: {
    verbose?: boolean;
    incrementalOnly?: boolean;
  }): Promise<{
    filesProcessed: number;
    embeddingsGenerated: number;
    errors: number;
  }>;

  /**
   * Check if embeddings are needed for a project
   */
  async needsEmbedding(projectId: string): Promise<{
    needed: boolean;
    fileCount: number;
  }>;
}
```

---

## Plan de migration

### Phase 1: Ajouter `absolutePath` partout ✅ COMPLETED

**Changements effectués:**

1. **Indexes Neo4j** (`brain-manager.ts`):
   - `scope_absolutepath`, `markdown_absolutepath`, `section_absolutepath`
   - `datafile_absolutepath`, `mediafile_absolutepath`, `imagefile_absolutepath`
   - `stylesheet_absolutepath`, `webpage_absolutepath`

2. **code-source-adapter.ts** - Ajout `absolutePath: filePath` sur tous les types de nodes:
   - PackageJson, Scope, WebDocument, File, Stylesheet
   - VueSFC, SvelteComponent, MarkdownDocument, MarkdownSection, CodeBlock
   - GenericFile, DataFile, MediaFile, DocumentFile

3. **incremental-ingestion.ts** - Queries mises à jour:
   - `deleteNodesForFile()` - Ajout `n.absolutePath = $filePath`
   - `deleteNodesForFiles()` - Ajout `n.absolutePath IN $filePaths`
   - `processChangedFiles()` - Ajout `n.absolutePath IN $relPaths`

4. **reference-extractor.ts** - Queries mises à jour:
   - `createReferenceRelations()` - Ajout `scope.absolutePath = $absolutePath`

5. **brain-manager.ts** - Suppression du `REMOVE n.absolutePath` dans migration orphan→project

### Phase 2: Créer FileProcessor ✅ COMPLETED

**Changements effectués:**

1. **Nouveau module `file-processor.ts`** (~450 lignes):
   - `FileProcessor` class avec pipeline complet
   - `createNodesBatch()` - UNWIND pour création batch de nodes
   - `createRelationshipsBatch()` - UNWIND pour création batch de relations
   - `processBatch()` - traitement parallèle avec p-limit
   - Intégration avec FileStateMachine pour tracking d'état
   - Factory functions: `createOrphanFileProcessor()`, `createProjectFileProcessor()`

2. **Refactoring `touched-files-watcher.ts`** (~470 lignes vs ~720 avant):
   - Délègue le processing à FileProcessor via `processFilesForParsing()`
   - Suppression de `parseAndIngestFile()`, `createScopes()`, `processFileImports()`
   - Garde la logique d'orchestration (processAll, processDirectory)
   - Garde la logique d'embedding (utilise EmbeddingService)

3. **Export depuis `brain/index.ts`**:
   - FileProcessor, createOrphanFileProcessor, createProjectFileProcessor
   - Types: FileInfo, ProcessResult, BatchResult, FileProcessorConfig

**Gains de performance estimés** (pour 100 fichiers):
- Node creation: ~50s → ~2s (25x plus rapide)
- Relationship creation: ~25s → ~1s (25x plus rapide)
- Total pipeline: ~90s → ~13s (7x plus rapide)

### Phase 3: Intégrer dans IncrementalIngestionManager ✅ COMPLETED

**Changements effectués:**

1. **Nouveau champ `_fileProcessors: Map<string, FileProcessor>`** - Cache par projet
2. **Nouvelle méthode `getFileProcessor(projectId, projectRoot, options)`**:
   - Retourne un FileProcessor configuré pour le projet
   - Cache les instances pour réutilisation
3. **Nouvelle méthode `reprocessFilesWithStateMachine(projectId, projectRoot, files, options)`**:
   - API simplifiée pour reprocesser des fichiers avec state machine
   - Délègue à `FileProcessor.processBatch()`
4. **Nouvelle méthode `getFilesNeedingReprocessing(projectId)`**:
   - Récupère les fichiers en état 'discovered' pour un projet
   - Retourne des `FileInfo[]` prêts pour FileProcessor

**Exemple d'utilisation:**
```typescript
const manager = new IncrementalIngestionManager(neo4jClient);

// Récupérer les fichiers à reprocesser
const files = await manager.getFilesNeedingReprocessing('my-project');

// Reprocesser avec state machine + batch optimizations
const result = await manager.reprocessFilesWithStateMachine(
  'my-project',
  '/path/to/project',
  files,
  { verbose: true }
);

console.log(`Processed: ${result.processed}, Skipped: ${result.skipped}`);
```

### Phase 4: Modules complémentaires ✅ COMPLETED

**Changements effectués:**

1. **Nouveau module `change-detector.ts`** (~410 lignes):
   - `ChangeDetector` class pour centraliser la détection de changements
   - `hasChanged(absolutePath)` - vérification single file
   - `detectChanges(absolutePaths)` - batch avec optimisation
   - `getStoredHash(absolutePath)` - récupération hash depuis Neo4j
   - `getStoredHashesBatch(absolutePaths)` - batch query optimisé
   - `updateHash()` / `updateHashesBatch()` - mise à jour des hashes
   - `hasAnyChanged()` - early exit à premier changement
   - Support projectId optionnel pour filtrage

2. **Nouveau module `embedding-coordinator.ts`** (~480 lignes):
   - `EmbeddingCoordinator` class pour coordonner embeddings avec state machine
   - `embedProject(projectId, options)` - génère embeddings pour un projet
   - `embedFiles(projectId, fileUuids, options)` - embeddings pour fichiers spécifiques
   - `needsEmbedding(projectId)` - vérifie si embeddings nécessaires
   - `waitForCompletion()` - attend fin des opérations en cours
   - `isEmbedding()` / `getStatus()` - statut du lock
   - `retryFailed(projectId, maxRetries)` - retry des erreurs d'embedding
   - `getProgress(projectId)` - pourcentage de progression
   - Intégration avec `IngestionLock` pour blocking RAG queries

3. **Refactoring `touched-files-watcher.ts`**:
   - Ajout `embeddingLock?: IngestionLock` dans config
   - Lazy getter `embeddingCoordinator`
   - `processFilesForEmbedding()` délègue maintenant à EmbeddingCoordinator

4. **Export depuis `brain/index.ts`**:
   - ChangeDetector, type ChangeResult, BatchChangeResult, ChangeDetectorConfig
   - EmbeddingCoordinator, createEmbeddingCoordinator
   - Types: EmbedProjectResult, EmbeddingCoordinatorConfig, EmbedProjectOptions

---

## Ce qui NE doit PAS être unifié

1. **Watching**: TouchedFilesWatcher ne surveille pas les fichiers, FileWatcher si
2. **Découverte initiale**: Projets scannent un répertoire, orphans sont ajoutés un par un
3. **Graph complet vs simple**: IncrementalIngestion utilise tout le graph de l'adapter avec relations complexes

---

## Estimation

- Phase 1 (absolutePath): ✅ ~2h (migration + queries)
- Phase 2 (FileProcessor): ✅ ~4h (extraction + refactoring)
- Phase 3 (intégration): ✅ ~1h
- Phase 4 (modules complémentaires): ✅ ~3h

**Complété**: Phases 1-4 (~10h) ✅ TOUT TERMINÉ

---

## Prochaines étapes suggérées

1. **Nettoyage locks/wait logic**: Vérifier que IngestionLock est utilisé de manière cohérente partout
2. **Tests d'intégration**: Ajouter tests pour les nouveaux modules
3. **Migration child→parent projects**: Implémenter la migration intelligente (voir plan séparé)
