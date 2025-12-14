# Plan: Extraction de références mutualisée + State Machine pour l'ingestion

## Contexte

### Problèmes actuels

1. **Extraction de références inégale**:
   - `TouchedFilesWatcher` a une logique riche pour extraire les références de tous types de fichiers
   - L'ingestion projet (via `CodeSourceAdapter.buildGraph()`) n'extrait que partiellement:
     - HTML: seulement les images
     - CSS: @import cassé (pas résolu en UUID)
     - Markdown: rien
     - Data files: détecte mais ne crée pas de relations

2. **Dirty logic limitée**:
   - Projets: `schemaDirty` + `embeddingsDirty` (booleans sur Scope seulement)
   - Orphans: state machine (mentioned → dirty → indexed → embedded)
   - Pas de visibilité sur l'état intermédiaire des fichiers
   - Difficile de reprendre après une erreur

---

## Partie 1: Module d'extraction de références partagé

### Architecture

```
packages/core/src/brain/
├── reference-extractor.ts (NOUVEAU)
│   ├── extractReferences(content, filePath, fileType)
│   ├── resolveReference(ref, basePath, projectPath)
│   ├── createReferenceRelations(neo4j, sourceNode, refs, projectId)
│   └── REFERENCE_PATTERNS (regex par type de fichier)
│
├── touched-files-watcher.ts (MODIFIÉ)
│   └── Utilise reference-extractor au lieu de sa propre logique
│
└── brain-manager.ts / incremental-ingestion.ts (MODIFIÉ)
    └── Appelle reference-extractor après le parsing
```

### Types et interfaces

```typescript
// reference-extractor.ts

export type ReferenceType =
  | 'code'           // Import de code (.ts, .js, .py, etc.)
  | 'asset'          // Image, font, audio, video
  | 'document'       // Markdown, PDF, docs
  | 'stylesheet'     // CSS, SCSS
  | 'data'           // JSON, YAML
  | 'external';      // URL externe (non résolu)

export type RelationType =
  | 'CONSUMES'         // Scope → Scope (code)
  | 'IMPORTS'          // File → File (fallback)
  | 'REFERENCES_ASSET' // * → asset file
  | 'REFERENCES_DOC'   // * → document
  | 'REFERENCES_STYLE' // * → stylesheet
  | 'REFERENCES_DATA'  // * → data file
  | 'PENDING_IMPORT';  // Non résolu (orphans)

export interface ExtractedReference {
  /** Source brute (e.g., "./utils", "../styles/main.css") */
  source: string;
  /** Symboles importés (e.g., ["foo", "bar"] ou ["*"] ou ["default"]) */
  symbols: string[];
  /** Type de référence détecté */
  type: ReferenceType;
  /** Ligne dans le fichier source */
  line?: number;
  /** Est-ce une référence locale (vs package npm) */
  isLocal: boolean;
}

export interface ResolvedReference extends ExtractedReference {
  /** Chemin absolu résolu */
  absolutePath: string;
  /** Chemin relatif au projet */
  relativePath: string;
  /** UUID du node cible (si trouvé) */
  targetUuid?: string;
  /** Type de relation à créer */
  relationType: RelationType;
}
```

### Implémentation

```typescript
// reference-extractor.ts

import * as path from 'path';

// Patterns par type de fichier
const PATTERNS = {
  typescript: {
    namedImport: /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,
    defaultImport: /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
    namespaceImport: /import\s*\*\s*as\s+(\w+)\s*from\s*['"]([^'"]+)['"]/g,
    dynamicImport: /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    sideEffect: /import\s+['"]([^'"]+)['"]/g,
  },
  markdown: {
    link: /\[([^\]]*)\]\(([^)]+)\)/g,
    image: /!\[([^\]]*)\]\(([^)]+)\)/g,
  },
  css: {
    import: /@import\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]\s*\)?/g,
    url: /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/g,
  },
  html: {
    script: /<script[^>]+src\s*=\s*['"]([^'"]+)['"]/gi,
    link: /<link[^>]+href\s*=\s*['"]([^'"]+)['"]/gi,
    img: /<img[^>]+src\s*=\s*['"]([^'"]+)['"]/gi,
    anchor: /<a[^>]+href\s*=\s*['"]([^'"]+)['"]/gi,
  },
  python: {
    fromImport: /from\s+(\.+\w*(?:\.\w+)*)\s+import\s+(.+)/g,
    import: /^import\s+(\w+(?:\.\w+)*)/gm,
  },
};

// Extensions par type de référence
const TYPE_BY_EXTENSION: Record<string, ReferenceType> = {
  // Code
  '.ts': 'code', '.tsx': 'code', '.js': 'code', '.jsx': 'code',
  '.py': 'code', '.vue': 'code', '.svelte': 'code',
  // Assets
  '.png': 'asset', '.jpg': 'asset', '.jpeg': 'asset', '.gif': 'asset',
  '.svg': 'asset', '.webp': 'asset', '.ico': 'asset',
  '.woff': 'asset', '.woff2': 'asset', '.ttf': 'asset', '.eot': 'asset',
  '.mp3': 'asset', '.wav': 'asset', '.ogg': 'asset',
  '.mp4': 'asset', '.webm': 'asset',
  '.glb': 'asset', '.gltf': 'asset', '.fbx': 'asset', '.obj': 'asset',
  // Documents
  '.md': 'document', '.mdx': 'document', '.pdf': 'document',
  '.doc': 'document', '.docx': 'document',
  // Stylesheets
  '.css': 'stylesheet', '.scss': 'stylesheet', '.sass': 'stylesheet', '.less': 'stylesheet',
  // Data
  '.json': 'data', '.yaml': 'data', '.yml': 'data', '.xml': 'data',
};

/**
 * Extract all references from file content
 */
export function extractReferences(
  content: string,
  filePath: string
): ExtractedReference[] {
  const ext = path.extname(filePath).toLowerCase();
  const refs: ExtractedReference[] = [];

  // TypeScript / JavaScript
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
    refs.push(...extractTypeScriptReferences(content));
  }
  // Python
  else if (ext === '.py') {
    refs.push(...extractPythonReferences(content));
  }
  // Markdown
  else if (['.md', '.mdx', '.markdown'].includes(ext)) {
    refs.push(...extractMarkdownReferences(content));
  }
  // CSS / SCSS
  else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
    refs.push(...extractCssReferences(content));
  }
  // HTML
  else if (['.html', '.htm', '.xhtml'].includes(ext)) {
    refs.push(...extractHtmlReferences(content));
  }
  // Vue / Svelte (extract from script section)
  else if (['.vue', '.svelte'].includes(ext)) {
    refs.push(...extractVueSvelteReferences(content));
  }

  return refs;
}

/**
 * Resolve a reference to an absolute path
 */
export function resolveReference(
  ref: ExtractedReference,
  sourceFilePath: string,
  projectPath: string
): ResolvedReference | null {
  if (!ref.isLocal) {
    return null; // Skip external packages
  }

  const sourceDir = path.dirname(sourceFilePath);
  let absolutePath: string;

  try {
    // Try to resolve with common extensions
    absolutePath = resolveWithExtensions(ref.source, sourceDir);
  } catch {
    return null; // Cannot resolve
  }

  const relativePath = path.relative(projectPath, absolutePath);
  const targetExt = path.extname(absolutePath).toLowerCase();
  const targetType = TYPE_BY_EXTENSION[targetExt] || 'code';

  // Determine relation type based on target
  let relationType: RelationType;
  switch (targetType) {
    case 'asset':
      relationType = 'REFERENCES_ASSET';
      break;
    case 'document':
      relationType = 'REFERENCES_DOC';
      break;
    case 'stylesheet':
      relationType = 'REFERENCES_STYLE';
      break;
    case 'data':
      relationType = 'REFERENCES_DATA';
      break;
    default:
      relationType = 'CONSUMES';
  }

  return {
    ...ref,
    absolutePath,
    relativePath,
    relationType,
  };
}

/**
 * Create reference relations in Neo4j
 */
export async function createReferenceRelations(
  neo4jClient: Neo4jClient,
  sourceNodeUuid: string,
  sourceFile: string,
  refs: ResolvedReference[],
  projectId: string
): Promise<{ created: number; pending: number }> {
  let created = 0;
  let pending = 0;

  for (const ref of refs) {
    // Try to find target node
    const targetResult = await neo4jClient.run(`
      MATCH (target)
      WHERE target.projectId = $projectId
        AND (target.file = $relativePath OR target.absolutePath = $absolutePath)
        AND (target:Scope OR target:File OR target:MarkdownDocument OR target:Stylesheet OR target:DataFile OR target:MediaFile OR target:ImageFile)
      RETURN target.uuid as uuid, labels(target) as labels
      LIMIT 1
    `, { projectId, relativePath: ref.relativePath, absolutePath: ref.absolutePath });

    if (targetResult.records.length > 0) {
      const targetUuid = targetResult.records[0].get('uuid');

      // Create the relationship
      await neo4jClient.run(`
        MATCH (source {uuid: $sourceUuid})
        MATCH (target {uuid: $targetUuid})
        MERGE (source)-[r:${ref.relationType}]->(target)
        SET r.symbols = $symbols,
            r.createdAt = datetime()
      `, { sourceUuid: sourceNodeUuid, targetUuid, symbols: ref.symbols });

      created++;
    } else {
      // Create PENDING_IMPORT for later resolution
      await neo4jClient.run(`
        MATCH (source {uuid: $sourceUuid})
        MERGE (source)-[r:PENDING_IMPORT {targetPath: $targetPath}]->(source)
        SET r.symbols = $symbols,
            r.intendedRelationType = $relationType
      `, {
        sourceUuid: sourceNodeUuid,
        targetPath: ref.relativePath,
        symbols: ref.symbols,
        relationType: ref.relationType
      });

      pending++;
    }
  }

  return { created, pending };
}
```

### Intégration dans l'ingestion projet

```typescript
// Dans incremental-ingestion.ts ou brain-manager.ts

import { extractReferences, resolveReference, createReferenceRelations } from './reference-extractor.js';

// Après le parsing d'un fichier et création des nodes
async function processFileReferences(
  filePath: string,
  content: string,
  projectId: string,
  projectPath: string,
  sourceNodeUuid: string
): Promise<void> {
  // 1. Extract references
  const refs = extractReferences(content, filePath);

  // 2. Resolve to absolute paths
  const resolved = refs
    .map(ref => resolveReference(ref, filePath, projectPath))
    .filter((r): r is ResolvedReference => r !== null);

  // 3. Create relations
  const stats = await createReferenceRelations(
    this.neo4jClient,
    sourceNodeUuid,
    path.relative(projectPath, filePath),
    resolved,
    projectId
  );

  if (stats.created > 0 || stats.pending > 0) {
    console.log(`[References] ${filePath}: ${stats.created} resolved, ${stats.pending} pending`);
  }
}
```

### Migration de TouchedFilesWatcher

```typescript
// Dans touched-files-watcher.ts

// AVANT: logique dupliquée dans extractImportsFromContent()
// APRÈS: utilise le module partagé

import { extractReferences, resolveReference, createReferenceRelations } from './reference-extractor.js';

// Remplacer extractImportsFromContent() par un appel à extractReferences()
// Remplacer createConsumesRelation() par createReferenceRelations()
```

---

## Partie 2: State Machine pour l'ingestion

### États du cycle de vie d'un fichier

```
                    ┌─────────────┐
                    │  DISCOVERED │  Fichier détecté par watcher
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   PARSING   │  En cours de parsing
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   PARSED    │  Nodes créés, en attente relations
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  RELATIONS  │  Relations en cours de création
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   LINKED    │  Relations créées, en attente embeddings
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  EMBEDDING  │  Embeddings en cours de génération
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  EMBEDDED   │  Complètement traité
                    └──────┴──────┘

    Transitions d'erreur:
    - Tout état peut revenir à DISCOVERED si le fichier change
    - PARSING → ERROR_PARSE si échec de parsing
    - RELATIONS → ERROR_RELATIONS si échec de résolution
    - EMBEDDING → ERROR_EMBED si échec API
```

### Schema Neo4j

```typescript
// Sur les nodes File (ou un nouveau node FileState)

interface FileState {
  /** État actuel dans le cycle de vie */
  state: 'discovered' | 'parsing' | 'parsed' | 'relations' | 'linked' | 'embedding' | 'embedded' | 'error';

  /** Sous-état d'erreur si state === 'error' */
  errorType?: 'parse' | 'relations' | 'embed';

  /** Message d'erreur */
  errorMessage?: string;

  /** Timestamp de la dernière transition */
  stateUpdatedAt: string;

  /** Hash du contenu au moment du parsing */
  parsedContentHash?: string;

  /** Hash du contenu au moment de l'embedding */
  embeddedContentHash?: string;

  /** Nombre de tentatives (pour retry logic) */
  retryCount?: number;
}
```

### Implémentation

```typescript
// file-state-machine.ts (NOUVEAU)

export type FileState =
  | 'discovered'
  | 'parsing'
  | 'parsed'
  | 'relations'
  | 'linked'
  | 'embedding'
  | 'embedded'
  | 'error';

export type ErrorType = 'parse' | 'relations' | 'embed';

export interface StateTransition {
  from: FileState | FileState[];
  to: FileState;
  action: string;
}

// Transitions valides
const VALID_TRANSITIONS: StateTransition[] = [
  { from: ['discovered', 'error'], to: 'parsing', action: 'startParsing' },
  { from: 'parsing', to: 'parsed', action: 'finishParsing' },
  { from: 'parsing', to: 'error', action: 'failParsing' },
  { from: 'parsed', to: 'relations', action: 'startRelations' },
  { from: 'relations', to: 'linked', action: 'finishRelations' },
  { from: 'relations', to: 'error', action: 'failRelations' },
  { from: 'linked', to: 'embedding', action: 'startEmbedding' },
  { from: 'embedding', to: 'embedded', action: 'finishEmbedding' },
  { from: 'embedding', to: 'error', action: 'failEmbedding' },
  // Reset on file change
  { from: ['parsed', 'relations', 'linked', 'embedding', 'embedded', 'error'], to: 'discovered', action: 'fileChanged' },
];

export class FileStateMachine {
  constructor(private neo4jClient: Neo4jClient) {}

  /**
   * Transition a file to a new state
   */
  async transition(
    fileUuid: string,
    newState: FileState,
    options?: {
      errorType?: ErrorType;
      errorMessage?: string;
      contentHash?: string;
    }
  ): Promise<boolean> {
    const result = await this.neo4jClient.run(`
      MATCH (f:File {uuid: $uuid})
      SET f.state = $newState,
          f.stateUpdatedAt = datetime(),
          f.errorType = $errorType,
          f.errorMessage = $errorMessage,
          f.parsedContentHash = CASE WHEN $newState = 'parsed' THEN $contentHash ELSE f.parsedContentHash END,
          f.embeddedContentHash = CASE WHEN $newState = 'embedded' THEN $contentHash ELSE f.embeddedContentHash END,
          f.retryCount = CASE WHEN $newState = 'error' THEN coalesce(f.retryCount, 0) + 1 ELSE f.retryCount END
      RETURN f.state as state
    `, {
      uuid: fileUuid,
      newState,
      errorType: options?.errorType || null,
      errorMessage: options?.errorMessage || null,
      contentHash: options?.contentHash || null,
    });

    return result.records.length > 0;
  }

  /**
   * Get files in a specific state
   */
  async getFilesInState(
    projectId: string,
    state: FileState | FileState[]
  ): Promise<Array<{ uuid: string; file: string; state: FileState }>> {
    const states = Array.isArray(state) ? state : [state];

    const result = await this.neo4jClient.run(`
      MATCH (f:File {projectId: $projectId})
      WHERE f.state IN $states
      RETURN f.uuid as uuid, f.file as file, f.state as state
      ORDER BY f.stateUpdatedAt ASC
    `, { projectId, states });

    return result.records.map(r => ({
      uuid: r.get('uuid'),
      file: r.get('file'),
      state: r.get('state'),
    }));
  }

  /**
   * Get state statistics for a project
   */
  async getStateStats(projectId: string): Promise<Record<FileState, number>> {
    const result = await this.neo4jClient.run(`
      MATCH (f:File {projectId: $projectId})
      RETURN f.state as state, count(f) as count
    `, { projectId });

    const stats: Record<string, number> = {
      discovered: 0,
      parsing: 0,
      parsed: 0,
      relations: 0,
      linked: 0,
      embedding: 0,
      embedded: 0,
      error: 0,
    };

    for (const record of result.records) {
      const state = record.get('state') || 'discovered';
      stats[state] = record.get('count').toNumber();
    }

    return stats as Record<FileState, number>;
  }

  /**
   * Get files that need retry (in error state with retryCount < maxRetries)
   */
  async getRetryableFiles(
    projectId: string,
    maxRetries: number = 3
  ): Promise<Array<{ uuid: string; file: string; errorType: ErrorType; retryCount: number }>> {
    const result = await this.neo4jClient.run(`
      MATCH (f:File {projectId: $projectId, state: 'error'})
      WHERE coalesce(f.retryCount, 0) < $maxRetries
      RETURN f.uuid as uuid, f.file as file, f.errorType as errorType, f.retryCount as retryCount
      ORDER BY f.retryCount ASC, f.stateUpdatedAt ASC
    `, { projectId, maxRetries });

    return result.records.map(r => ({
      uuid: r.get('uuid'),
      file: r.get('file'),
      errorType: r.get('errorType'),
      retryCount: r.get('retryCount')?.toNumber() || 0,
    }));
  }

  /**
   * Reset files that have been stuck in a processing state too long
   */
  async resetStuckFiles(
    projectId: string,
    stuckThresholdMs: number = 5 * 60 * 1000 // 5 minutes
  ): Promise<number> {
    const result = await this.neo4jClient.run(`
      MATCH (f:File {projectId: $projectId})
      WHERE f.state IN ['parsing', 'relations', 'embedding']
        AND f.stateUpdatedAt < datetime() - duration({milliseconds: $threshold})
      SET f.state = 'discovered',
          f.stateUpdatedAt = datetime(),
          f.errorMessage = 'Reset: stuck in processing state'
      RETURN count(f) as count
    `, { projectId, threshold: stuckThresholdMs });

    return result.records[0]?.get('count')?.toNumber() || 0;
  }
}
```

### Intégration dans le pipeline d'ingestion

```typescript
// Dans incremental-ingestion.ts

import { FileStateMachine } from './file-state-machine.js';

class IncrementalIngestionManager {
  private stateMachine: FileStateMachine;

  async processFile(filePath: string, projectId: string): Promise<void> {
    const fileUuid = await this.getOrCreateFileUuid(filePath, projectId);
    const contentHash = await this.computeHash(filePath);

    try {
      // 1. Start parsing
      await this.stateMachine.transition(fileUuid, 'parsing');

      const parseResult = await this.parseFile(filePath);

      // 2. Parsing complete
      await this.stateMachine.transition(fileUuid, 'parsed', { contentHash });
      await this.createNodes(parseResult, projectId);

      // 3. Start creating relations
      await this.stateMachine.transition(fileUuid, 'relations');

      await this.processFileReferences(filePath, parseResult.content, projectId);

      // 4. Relations complete
      await this.stateMachine.transition(fileUuid, 'linked');

      // 5. Start embedding (si pas en batch)
      if (!this.batchEmbedding) {
        await this.stateMachine.transition(fileUuid, 'embedding');
        await this.generateEmbeddings(fileUuid);
        await this.stateMachine.transition(fileUuid, 'embedded', { contentHash });
      }

    } catch (error) {
      const errorType = this.classifyError(error);
      await this.stateMachine.transition(fileUuid, 'error', {
        errorType,
        errorMessage: error.message,
      });
      throw error;
    }
  }

  /**
   * Resume processing for files that didn't complete
   */
  async resumeIncomplete(projectId: string): Promise<void> {
    // Reset stuck files
    const stuck = await this.stateMachine.resetStuckFiles(projectId);
    if (stuck > 0) {
      console.log(`[Ingestion] Reset ${stuck} stuck files`);
    }

    // Process files by state
    const states = await this.stateMachine.getStateStats(projectId);

    // Files that need parsing
    const toParse = await this.stateMachine.getFilesInState(projectId, 'discovered');
    for (const file of toParse) {
      await this.processFile(file.file, projectId);
    }

    // Files that need relations
    const toLink = await this.stateMachine.getFilesInState(projectId, 'parsed');
    for (const file of toLink) {
      await this.processRelationsOnly(file.uuid, projectId);
    }

    // Files that need embedding
    const toEmbed = await this.stateMachine.getFilesInState(projectId, 'linked');
    await this.batchGenerateEmbeddings(toEmbed.map(f => f.uuid));

    // Retry errors
    const retryable = await this.stateMachine.getRetryableFiles(projectId);
    for (const file of retryable) {
      console.log(`[Ingestion] Retrying ${file.file} (attempt ${file.retryCount + 1})`);
      await this.processFile(file.file, projectId);
    }
  }
}
```

### UI/CLI pour visualiser les états

```typescript
// Nouvelle commande ou extension de list_brain_projects

async function showIngestionStatus(projectId: string): Promise<void> {
  const stats = await stateMachine.getStateStats(projectId);

  console.log(`\nIngestion Status for ${projectId}:`);
  console.log(`  ✓ Embedded:   ${stats.embedded}`);
  console.log(`  → Embedding:  ${stats.embedding}`);
  console.log(`  ○ Linked:     ${stats.linked}`);
  console.log(`  ○ Relations:  ${stats.relations}`);
  console.log(`  ○ Parsed:     ${stats.parsed}`);
  console.log(`  ○ Parsing:    ${stats.parsing}`);
  console.log(`  ○ Discovered: ${stats.discovered}`);
  console.log(`  ✗ Errors:     ${stats.error}`);

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const complete = stats.embedded;
  console.log(`\nProgress: ${complete}/${total} (${Math.round(100 * complete / total)}%)`);
}
```

---

## Partie 3: Migration des données existantes

### Script de migration

```typescript
// migrate-to-state-machine.ts

async function migrateExistingFiles(projectId: string): Promise<void> {
  const neo4j = getNeo4jClient();

  // 1. Files avec embeddings → 'embedded'
  await neo4j.run(`
    MATCH (f:File {projectId: $projectId})
    WHERE f.state IS NULL
      AND EXISTS {
        MATCH (s:Scope)-[:DEFINED_IN]->(f)
        WHERE s.embedding_content IS NOT NULL
      }
    SET f.state = 'embedded',
        f.stateUpdatedAt = datetime()
  `, { projectId });

  // 2. Files avec Scopes mais sans embeddings → 'linked'
  await neo4j.run(`
    MATCH (f:File {projectId: $projectId})
    WHERE f.state IS NULL
      AND EXISTS { MATCH (s:Scope)-[:DEFINED_IN]->(f) }
    SET f.state = 'linked',
        f.stateUpdatedAt = datetime()
  `, { projectId });

  // 3. Files sans Scopes → 'discovered'
  await neo4j.run(`
    MATCH (f:File {projectId: $projectId})
    WHERE f.state IS NULL
    SET f.state = 'discovered',
        f.stateUpdatedAt = datetime()
  `, { projectId });

  // 4. Migrer embeddingsDirty vers state
  await neo4j.run(`
    MATCH (f:File {projectId: $projectId})
    WHERE f.state = 'embedded'
      AND EXISTS {
        MATCH (s:Scope)-[:DEFINED_IN]->(f)
        WHERE s.embeddingsDirty = true
      }
    SET f.state = 'linked'
  `, { projectId });

  // 5. Migrer schemaDirty vers state
  await neo4j.run(`
    MATCH (f:File {projectId: $projectId})
    WHERE f.state IN ['linked', 'embedded']
      AND EXISTS {
        MATCH (n)-[:DEFINED_IN]->(f)
        WHERE n.schemaDirty = true
      }
    SET f.state = 'discovered'
  `, { projectId });
}
```

---

## Fichiers à modifier/créer

### Nouveaux fichiers

1. `packages/core/src/brain/reference-extractor.ts`
   - Extraction de références mutualisée
   - ~300 lignes

2. `packages/core/src/brain/file-state-machine.ts`
   - Gestion des états de fichiers
   - ~200 lignes

3. `packages/core/src/brain/migrations/migrate-to-state-machine.ts`
   - Script de migration
   - ~50 lignes

### Fichiers à modifier

1. `packages/core/src/brain/touched-files-watcher.ts`
   - Remplacer `extractImportsFromContent()` par `extractReferences()`
   - Remplacer `createConsumesRelation()` par `createReferenceRelations()`
   - Utiliser `FileStateMachine` au lieu des états ad-hoc
   - ~-200 lignes (suppression de code dupliqué)

2. `packages/core/src/runtime/adapters/incremental-ingestion.ts`
   - Ajouter appel à `processFileReferences()` après parsing
   - Intégrer `FileStateMachine` pour le tracking
   - ~+50 lignes

3. `packages/core/src/brain/brain-manager.ts`
   - Exposer méthodes pour query les états
   - Ajouter `resumeIncomplete()` pour reprendre après erreur
   - ~+30 lignes

4. `packages/core/src/tools/debug-tools.ts`
   - Ajouter tool pour voir les statistiques d'état
   - ~+50 lignes

---

## Estimation

| Composant | Lignes | Complexité |
|-----------|--------|------------|
| reference-extractor.ts | ~300 | Moyenne |
| file-state-machine.ts | ~200 | Faible |
| Migration script | ~50 | Faible |
| Intégration touched-files | ~-200 | Moyenne |
| Intégration incremental | ~+80 | Moyenne |
| Debug tools | ~+50 | Faible |

**Total net**: ~+280 lignes de nouveau code

---

## Ordre d'implémentation recommandé

1. **Étape 1**: `reference-extractor.ts` - Module partagé
2. **Étape 2**: Intégrer dans `touched-files-watcher.ts` (refactoring)
3. **Étape 3**: Intégrer dans `incremental-ingestion.ts`
4. **Étape 4**: `file-state-machine.ts` - Nouveau module
5. **Étape 5**: Migration script pour données existantes
6. **Étape 6**: Intégrer state machine dans les deux systèmes
7. **Étape 7**: Debug tools et UI

---

## Tests à prévoir

1. **Reference extraction**:
   - Extraction TS/JS avec tous types d'imports
   - Extraction Markdown links et images
   - Extraction CSS @import et url()
   - Extraction HTML script/link/img/a
   - Résolution de chemins relatifs
   - Création de relations dans Neo4j

2. **State machine**:
   - Transitions valides
   - Transitions invalides (rejetées)
   - Reset de fichiers stuck
   - Retry de fichiers en erreur
   - Stats par projet

3. **Migration**:
   - Données existantes migrées correctement
   - embeddingsDirty → state conversion
   - schemaDirty → state conversion
