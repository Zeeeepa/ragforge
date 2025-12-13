# Roadmap: Touched Files (Fichiers Orphelins)

## Résumé

Permettre à l'agent de mémoriser et indexer les fichiers qu'il accède en dehors des projets connus, avec support des relations CONSUMES entre fichiers orphelins.

---

## Contexte Technique

### Comment CONSUMES fonctionne actuellement

1. **Parser (codeparsers/scope-extraction)**
   - `extractIdentifierReferences()` : Extrait les identifiants utilisés dans le code
   - `resolveImportsForScope()` : Lie chaque identifiant à son import
   - Génère des `importReferences` : `{ source: "./foo", imported: "Bar", isLocal: true }`

2. **code-source-adapter.ts**
   - `buildScopeReferences()` : Traite les refs `local_scope` (même fichier)
   - `resolveImportReferencesToScopes()` : Résout les imports cross-file via `ImportResolver`
   - Crée les relations `CONSUMES` / `INHERITS_FROM` entre scopes

3. **ImportResolver.ts**
   - Résout les imports relatifs (`./foo`, `../bar`)
   - Utilise `tsconfig.json` pour les path aliases (`@/`, `~/`)
   - **Requiert un `projectRoot`** pour fonctionner

### Problème pour les fichiers orphelins

- Pas de `projectRoot` unifié
- Pas de `tsconfig.json` commun
- Les imports peuvent pointer vers :
  - Un autre fichier orphelin (indexé ou non)
  - Un fichier dans un projet existant
  - Un fichier non indexé (externe)

---

## Architecture Proposée

### 1. Hiérarchie Directory

Nouvelle structure de nœuds pour organiser les fichiers orphelins sans project root :

```cypher
// Directory node
(:Directory {
  path: "/home/user/projects",     // Chemin absolu
  name: "projects"                  // Nom du répertoire
})

// Relations
(:File)-[:IN_DIRECTORY]->(:Directory)
(:Directory)-[:IN_DIRECTORY]->(:Directory)  // enfant → parent
```

**Avantages :**
- Filtre naturel par cwd : `MATCH (d:Directory {path: $cwd})-[:IN_DIRECTORY*0..]->(ancestor) ...`
- Pas besoin de projectId pour filtrer
- Structure arborescente cohérente

### 2. Projet Singleton "touched-files"

```typescript
projectId: "touched-files"
type: "touched-files"
path: "~/.ragforge/touched-files"  // Pour les métadonnées
```

- Un seul projet pour tous les fichiers orphelins
- Ne sert pas de "root" pour les fichiers (ils gardent leur chemin absolu)
- Sert juste à identifier les nœuds comme "orphelins"

### 3. États des fichiers orphelins

Quatre états via propriété `state` sur le nœud File :

| État | Description | Scopes | Embeddings | Searchable |
|------|-------------|--------|------------|------------|
| `mentioned` | Référencé par import mais jamais accédé | ❌ | ❌ | ❌ |
| `dirty` | Accédé directement, en attente d'ingestion | ❌ | ❌ | ❌ |
| `indexed` | Scopes créés, embeddings en attente | ✅ | ❌ | Partiel (text) |
| `embedded` | Complètement ingéré | ✅ | ✅ | ✅ (semantic) |

**Réutilisation des patterns de l'ingestion incrémentale :**
- `hash` : même système de hash pour détecter les changements de contenu
- Batch embeddings : même `EmbeddingService.generateBatch()` avec `p-limit`
- Parsing : même `UniversalSourceAdapter` / parsers existants
- Change tracking : même `ChangeTracker` si besoin

**Transitions :**
```
                    ┌──────────────┐
   import trouvé    │  mentioned   │
   ─────────────────►              │
                    └──────┬───────┘
                           │ accès direct (read/edit/write)
                           ▼
                    ┌──────────────┐
   accès direct     │    dirty     │
   ─────────────────►              │
                    └──────┬───────┘
                           │ parsing + scopes (batch watcher)
                           ▼
                    ┌──────────────┐
                    │   indexed    │
                    │              │
                    └──────┬───────┘
                           │ batch embeddings (EmbeddingService)
                           ▼
                    ┌──────────────┐
                    │   embedded   │
                    │              │
                    └──────────────┘
```

**Avantages :**
- État explicite et lisible pour les fichiers orphelins
- **Reprise après crash** : query sur `state IN ['dirty', 'indexed']`
- **Lock brain_search** : attendre que tous fichiers du cwd soient `state = 'embedded'`
- Réutilise toute la logique existante (parsers, embeddings, hash)

**Synchronisation brain_search :**
```
brain_search(query, cwd)
         │
         ▼
┌─────────────────────────────────────────┐
│ Fichiers orphelins du cwd avec          │
│ state IN ['dirty', 'indexed'] ?         │
└─────────────────────────────────────────┘
         │
    OUI  │  NON → lancer la recherche
         ▼
┌─────────────────────────────────────────┐
│ Déclencher watcher + attendre (timeout) │
│ ou forcer l'ingestion synchrone         │
└─────────────────────────────────────────┘
         │
         ▼
Tous embedded → lancer la recherche
```

**Après passage `mentioned → indexed` :**
- Reconstruire les relations CONSUMES depuis tous les fichiers qui l'importaient
- Ces fichiers ont stocké l'import non résolu, maintenant on peut créer la relation

### 4. Flow d'accès fichier

```
read_file("/home/user/script.py")
         │
         ▼
┌─────────────────────────────────┐
│ Le fichier est dans un projet ? │
└─────────────────────────────────┘
         │
    NON  │  OUI → Ne rien faire
         ▼
┌─────────────────────────────────┐
│ Nœud File existe déjà ?         │
└─────────────────────────────────┘
         │
    NON  │  OUI (mentioned) → passer en dirty
         ▼
┌─────────────────────────────────┐
│ Créer nœud File                 │
│ - absolutePath                  │
│ - name, extension               │
│ - state: "dirty"                │
│ - projectId: "touched-files"    │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Créer hiérarchie Directory      │
│ /home → /home/user → File       │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Ajouter au watcher custom       │
│ (si dans sous-répertoire du cwd)│
└─────────────────────────────────┘
```

### 5. Flow d'ingestion (résolution imports)

```
Ingestion de fileA.ts
         │
         ▼
Parser extrait imports:
  - ./fileB.ts (local)
  - lodash (externe)
         │
         ▼
Pour chaque import local:
         │
         ▼
┌─────────────────────────────────┐
│ Résoudre chemin absolu          │
│ /home/user/fileB.ts             │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ Nœud File existe ?              │
└─────────────────────────────────┘
         │
    NON  │  OUI (indexed) → créer CONSUMES
         │  OUI (dirty/mentioned) → stocker pour plus tard
         ▼
┌─────────────────────────────────┐
│ Créer nœud File "mentioned"     │
│ - state: "mentioned"            │
│ - Stocker: "importé par fileA"  │
└─────────────────────────────────┘
```

### 4. Watcher Custom pour Touched Files

**Différences avec FileWatcher existant :**
- Surveille des **fichiers individuels** (pas des globs de répertoire)
- Ne surveille que les fichiers **dans le cwd actuel** (ou sous-répertoires)
- Ingestion **batch** au prochain tour de boucle (pas immédiate)

```typescript
class TouchedFilesWatcher {
  private watchedFiles: Set<string> = new Set();
  private watcher: chokidar.FSWatcher | null = null;
  private currentCwd: string | null = null;

  // Appelé quand le cwd change
  async updateCwd(newCwd: string): Promise<void>;

  // Ajoute un fichier au watch (si dans cwd)
  async addFile(filePath: string): Promise<void>;

  // Tour de boucle : ingère les fichiers dirty
  async processDirtyFiles(): Promise<void>;
}
```

### 5. Résolution des imports pour orphelins

**Stratégie : tsconfig.json le plus proche**

```typescript
async function findNearestTsConfig(filePath: string): Promise<string | null> {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {  // jusqu'à la racine
    const tsconfig = path.join(dir, 'tsconfig.json');
    if (await fileExists(tsconfig)) {
      return tsconfig;
    }
    dir = path.dirname(dir);
  }
  return null;
}
```

**Résolution des CONSUMES :**

1. Parser le fichier orphelin normalement → obtenir `importReferences`
2. Pour chaque import relatif :
   - Résoudre le chemin absolu
   - Chercher si un nœud File/Scope existe avec ce chemin
   - Si oui → créer relation CONSUMES
   - Si non → ignorer (ou créer nœud File dirty pour plus tard)

### 6. Intégration avec brain_search

**Déclenchement du watcher :**

```typescript
async brainSearch(query: string, options: BrainSearchOptions) {
  const cwd = options.cwd || process.cwd();

  // Relancer le watcher si des fichiers orphelins sont dans le cwd
  const orphansInCwd = await this.getOrphansInDirectory(cwd);
  if (orphansInCwd.length > 0) {
    await this.touchedFilesWatcher.updateCwd(cwd);
    await this.touchedFilesWatcher.processDirtyFiles();  // avec lock
  }

  // Recherche normale...
}
```

**Filtre par cwd dans la recherche :**

```cypher
// Recherche dans les fichiers du cwd et sous-répertoires
MATCH (f:File {projectId: 'touched-files'})
WHERE f.absolutePath STARTS WITH $cwd
RETURN f
```

Ou avec la hiérarchie Directory :

```cypher
MATCH (d:Directory {path: $cwd})<-[:IN_DIRECTORY*0..]-(f:File)
WHERE f.projectId = 'touched-files'
RETURN f
```

---

## Plan d'implémentation détaillé

### Étape 1 : Index et schéma Neo4j
**Fichiers :** `brain-manager.ts`
**Dépendances :** Aucune
**Effort :** 30 min

```typescript
// Ajouter dans initializeIndexes()
'CREATE INDEX directory_path IF NOT EXISTS FOR (d:Directory) ON (d.path)',
'CREATE INDEX file_absolutepath IF NOT EXISTS FOR (f:File) ON (f.absolutePath)',
'CREATE INDEX file_state IF NOT EXISTS FOR (f:File) ON (f.state)',
```

---

### Étape 2 : Hiérarchie Directory
**Fichiers :** `brain-manager.ts` (nouvelle section)
**Dépendances :** Étape 1
**Effort :** 1h

```typescript
/**
 * Assure que la hiérarchie de Directory existe pour un chemin
 * Crée les nœuds Directory manquants avec relations IN_DIRECTORY
 */
async ensureDirectoryHierarchy(filePath: string): Promise<void> {
  const parts = path.dirname(filePath).split(path.sep).filter(Boolean);
  let currentPath = path.sep; // Commence à la racine

  for (const part of parts) {
    const parentPath = currentPath;
    currentPath = path.join(currentPath, part);

    await this.neo4jClient.run(`
      MERGE (d:Directory {path: $path})
      ON CREATE SET d.name = $name
      WITH d
      OPTIONAL MATCH (parent:Directory {path: $parentPath})
      WHERE $parentPath <> '/'
      MERGE (d)-[:IN_DIRECTORY]->(parent)
    `, { path: currentPath, name: part, parentPath });
  }
}
```

---

### Étape 3 : Création nœud File orphelin (state: dirty)
**Fichiers :** `brain-manager.ts` (section Touched Files)
**Dépendances :** Étape 2
**Effort :** 1h

```typescript
/**
 * Crée ou met à jour un nœud File orphelin
 * - Si n'existe pas : créer avec state='dirty'
 * - Si existe en 'mentioned' : passer en 'dirty'
 * - Si existe en 'dirty'/'indexed'/'embedded' : mettre à jour lastAccessed
 */
async touchFile(filePath: string): Promise<{
  created: boolean;
  previousState: string | null;
  newState: string;
}> {
  const absolutePath = path.resolve(filePath);

  // Vérifier si dans un projet existant
  if (this.findProjectForFile(absolutePath)) {
    return { created: false, previousState: null, newState: 'in_project' };
  }

  // Assurer la hiérarchie Directory
  await this.ensureDirectoryHierarchy(absolutePath);

  // Créer/mettre à jour le nœud File
  const result = await this.neo4jClient.run(`
    MERGE (f:File {absolutePath: $absolutePath})
    ON CREATE SET
      f.uuid = randomUUID(),
      f.name = $name,
      f.extension = $extension,
      f.state = 'dirty',
      f.projectId = 'touched-files',
      f.firstAccessed = datetime(),
      f.lastAccessed = datetime(),
      f.accessCount = 1
    ON MATCH SET
      f.lastAccessed = datetime(),
      f.accessCount = COALESCE(f.accessCount, 0) + 1,
      f.state = CASE
        WHEN f.state = 'mentioned' THEN 'dirty'
        ELSE f.state
      END
    WITH f
    MATCH (dir:Directory {path: $dirPath})
    MERGE (f)-[:IN_DIRECTORY]->(dir)
    RETURN f.state as newState,
           CASE WHEN f.firstAccessed = f.lastAccessed THEN null ELSE f.state END as previousState
  `, {
    absolutePath,
    name: path.basename(absolutePath),
    extension: path.extname(absolutePath),
    dirPath: path.dirname(absolutePath)
  });

  const record = result.records[0];
  return {
    created: record.get('previousState') === null,
    previousState: record.get('previousState'),
    newState: record.get('newState')
  };
}
```

---

### Étape 4 : Query helpers pour touched files
**Fichiers :** `brain-manager.ts`
**Dépendances :** Étape 3
**Effort :** 30 min

```typescript
/**
 * Liste les fichiers orphelins dans un répertoire (récursif)
 */
async getOrphansInDirectory(dirPath: string, options?: {
  states?: ('mentioned' | 'dirty' | 'indexed' | 'embedded')[];
  recursive?: boolean;
}): Promise<Array<{ absolutePath: string; state: string; }>> {
  const states = options?.states || ['dirty', 'indexed', 'embedded'];
  const recursive = options?.recursive ?? true;

  const query = recursive
    ? `MATCH (f:File {projectId: 'touched-files'})
       WHERE f.absolutePath STARTS WITH $dirPath AND f.state IN $states
       RETURN f.absolutePath as absolutePath, f.state as state`
    : `MATCH (f:File {projectId: 'touched-files'})-[:IN_DIRECTORY]->(:Directory {path: $dirPath})
       WHERE f.state IN $states
       RETURN f.absolutePath as absolutePath, f.state as state`;

  const result = await this.neo4jClient.run(query, { dirPath, states });
  return result.records.map(r => ({
    absolutePath: r.get('absolutePath'),
    state: r.get('state')
  }));
}

/**
 * Compte les fichiers non-embedded dans un répertoire
 */
async countPendingOrphans(dirPath: string): Promise<number> {
  const result = await this.neo4jClient.run(`
    MATCH (f:File {projectId: 'touched-files'})
    WHERE f.absolutePath STARTS WITH $dirPath
      AND f.state IN ['dirty', 'indexed']
    RETURN count(f) as count
  `, { dirPath });
  return result.records[0]?.get('count')?.toNumber() || 0;
}
```

---

### Étape 5 : Hook dans file-tools
**Fichiers :** `file-tools.ts`
**Dépendances :** Étape 3
**Effort :** 45 min

```typescript
// Ajouter au FileToolsContext
interface FileToolsContext {
  // ... existant

  /** Callback quand un fichier est accédé (pour touched-files) */
  onFileAccessed?: (filePath: string, action: 'read' | 'edit' | 'write') => Promise<void>;
}

// Dans generateReadFileHandler, après lecture réussie :
if (ctx.onFileAccessed) {
  // Fire and forget - ne pas bloquer la lecture
  ctx.onFileAccessed(absolutePath, 'read').catch(err =>
    console.warn('[TouchedFiles] Failed to track file access:', err)
  );
}

// Idem pour generateEditFileHandler et generateWriteFileHandler
```

---

### Étape 6 : Connecter le hook au BrainManager
**Fichiers :** `rag-agent.ts` ou `mcp-server.ts` (là où FileToolsContext est créé)
**Dépendances :** Étapes 4, 5
**Effort :** 30 min

```typescript
// Lors de la création du contexte file-tools
const fileToolsContext: FileToolsContext = {
  // ... existant

  onFileAccessed: async (filePath, action) => {
    if (!brain) return;

    const result = await brain.touchFile(filePath);
    if (result.created || result.previousState === 'mentioned') {
      console.log(`[TouchedFiles] ${action} ${filePath} → state: ${result.newState}`);
    }
  }
};
```

---

### Étape 7 : TouchedFilesWatcher - Structure de base
**Fichiers :** Nouveau fichier `touched-files-watcher.ts`
**Dépendances :** Étape 4
**Effort :** 2h

```typescript
import * as chokidar from 'chokidar';
import * as path from 'path';
import { BrainManager } from '../brain/brain-manager';

export class TouchedFilesWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private currentCwd: string | null = null;
  private watchedFiles: Set<string> = new Set();
  private isProcessing = false;
  private processingLock: Promise<void> | null = null;

  constructor(private brain: BrainManager) {}

  /**
   * Met à jour le cwd et reconfigure le watcher
   */
  async setCwd(cwd: string): Promise<void> {
    if (this.currentCwd === cwd) return;

    this.currentCwd = cwd;
    await this.rebuildWatcher();
  }

  /**
   * Reconstruit le watcher pour les fichiers du cwd actuel
   */
  private async rebuildWatcher(): Promise<void> {
    // Fermer l'ancien watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    if (!this.currentCwd) return;

    // Récupérer les fichiers orphelins du cwd
    const orphans = await this.brain.getOrphansInDirectory(this.currentCwd, {
      states: ['dirty', 'indexed', 'embedded']
    });

    this.watchedFiles = new Set(orphans.map(o => o.absolutePath));

    if (this.watchedFiles.size === 0) return;

    // Créer le watcher pour ces fichiers spécifiques
    this.watcher = chokidar.watch(Array.from(this.watchedFiles), {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 }
    });

    this.watcher.on('change', (filePath) => this.onFileChanged(filePath));
    this.watcher.on('unlink', (filePath) => this.onFileDeleted(filePath));
  }

  /**
   * Ajoute un fichier au watcher (appelé après touchFile)
   */
  async addFile(filePath: string): Promise<void> {
    if (!this.currentCwd) return;
    if (!filePath.startsWith(this.currentCwd)) return;

    if (!this.watchedFiles.has(filePath)) {
      this.watchedFiles.add(filePath);
      this.watcher?.add(filePath);
    }
  }

  private async onFileChanged(filePath: string): Promise<void> {
    // Marquer comme dirty pour re-ingestion
    await this.brain.neo4jClient?.run(`
      MATCH (f:File {absolutePath: $path, projectId: 'touched-files'})
      WHERE f.state IN ['indexed', 'embedded']
      SET f.state = 'dirty'
    `, { path: filePath });
  }

  private async onFileDeleted(filePath: string): Promise<void> {
    this.watchedFiles.delete(filePath);
    // Optionnel: supprimer le nœud ou le marquer comme deleted
  }

  // ... suite étape 8
}
```

---

### Étape 8 : TouchedFilesWatcher - Batch ingestion
**Fichiers :** `touched-files-watcher.ts` (suite)
**Dépendances :** Étape 7
**Effort :** 2h

```typescript
  /**
   * Traite tous les fichiers dirty/indexed du cwd
   * Retourne une Promise qui se résout quand tout est embedded
   */
  async processAll(): Promise<{ processed: number; errors: number }> {
    if (!this.currentCwd) return { processed: 0, errors: 0 };

    // Lock pour éviter les traitements parallèles
    if (this.processingLock) {
      await this.processingLock;
      return { processed: 0, errors: 0 }; // Déjà traité par un autre appel
    }

    let resolve: () => void;
    this.processingLock = new Promise(r => { resolve = r; });
    this.isProcessing = true;

    try {
      let processed = 0;
      let errors = 0;

      // Phase 1: dirty → indexed (parsing)
      const dirtyFiles = await this.brain.getOrphansInDirectory(this.currentCwd, {
        states: ['dirty']
      });

      for (const file of dirtyFiles) {
        try {
          await this.ingestFile(file.absolutePath);
          processed++;
        } catch (err) {
          console.error(`[TouchedFiles] Failed to ingest ${file.absolutePath}:`, err);
          errors++;
        }
      }

      // Phase 2: indexed → embedded (embeddings batch)
      const indexedFiles = await this.brain.getOrphansInDirectory(this.currentCwd, {
        states: ['indexed']
      });

      if (indexedFiles.length > 0) {
        await this.generateEmbeddingsBatch(indexedFiles.map(f => f.absolutePath));
      }

      return { processed, errors };

    } finally {
      this.isProcessing = false;
      resolve!();
      this.processingLock = null;
    }
  }

  /**
   * Ingère un fichier (dirty → indexed)
   */
  private async ingestFile(filePath: string): Promise<void> {
    // Utiliser le même parsing que l'ingestion incrémentale
    // UniversalSourceAdapter.parse() avec config ad-hoc
    // Puis syncGraph() pour créer les Scopes
    // Enfin: SET f.state = 'indexed'
  }

  /**
   * Génère les embeddings en batch (indexed → embedded)
   */
  private async generateEmbeddingsBatch(filePaths: string[]): Promise<void> {
    // Utiliser EmbeddingService.generateBatch() existant
    // Avec p-limit pour le parallélisme
    // Puis: SET f.state = 'embedded' pour chaque fichier
  }

  /**
   * Attend que tous les fichiers du cwd soient embedded
   */
  async waitUntilReady(timeoutMs: number = 30000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const pending = await this.brain.countPendingOrphans(this.currentCwd!);
      if (pending === 0) return true;

      // Déclencher le processing si pas déjà en cours
      if (!this.isProcessing) {
        this.processAll().catch(() => {});
      }

      // Attendre un peu avant de re-vérifier
      await new Promise(r => setTimeout(r, 500));
    }

    return false; // Timeout
  }
}
```

---

### Étape 9 : Intégration brain_search
**Fichiers :** `brain-manager.ts` (méthode search)
**Dépendances :** Étape 8
**Effort :** 1h

```typescript
// Dans la méthode search() de BrainManager

async search(query: string, options: BrainSearchOptions & { cwd?: string } = {}) {
  const { cwd, ...searchOptions } = options;

  // Si cwd fourni, s'assurer que les orphelins sont prêts
  if (cwd && this.touchedFilesWatcher) {
    this.touchedFilesWatcher.setCwd(cwd);

    const pendingCount = await this.countPendingOrphans(cwd);
    if (pendingCount > 0) {
      console.log(`[Brain] Waiting for ${pendingCount} touched files to be indexed...`);
      const ready = await this.touchedFilesWatcher.waitUntilReady(10000);
      if (!ready) {
        console.warn(`[Brain] Timeout waiting for touched files, proceeding anyway`);
      }
    }
  }

  // Recherche normale...
  return this.searchInternal(query, searchOptions);
}
```

---

### Étape 10 : Nœuds MentionedFile et PENDING_IMPORT
**Fichiers :** `brain-manager.ts`
**Dépendances :** Étape 3
**Effort :** 1h

```typescript
/**
 * Crée un nœud pour un fichier mentionné (importé mais jamais accédé)
 */
async createMentionedFile(
  absolutePath: string,
  importedBy: { filePath: string; scopeUuid?: string; symbols: string[] }
): Promise<void> {
  await this.ensureDirectoryHierarchy(absolutePath);

  await this.neo4jClient.run(`
    MERGE (f:File {absolutePath: $absolutePath})
    ON CREATE SET
      f.uuid = randomUUID(),
      f.name = $name,
      f.extension = $extension,
      f.state = 'mentioned',
      f.projectId = 'touched-files',
      f.firstMentioned = datetime()
    WITH f
    MATCH (dir:Directory {path: $dirPath})
    MERGE (f)-[:IN_DIRECTORY]->(dir)
    WITH f
    MATCH (importer:File {absolutePath: $importerPath})
    MERGE (importer)-[r:PENDING_IMPORT]->(f)
    SET r.symbols = COALESCE(r.symbols, []) + $symbols,
        r.scopeUuid = $scopeUuid
  `, {
    absolutePath,
    name: path.basename(absolutePath),
    extension: path.extname(absolutePath),
    dirPath: path.dirname(absolutePath),
    importerPath: importedBy.filePath,
    symbols: importedBy.symbols,
    scopeUuid: importedBy.scopeUuid || null
  });
}
```

---

### Étape 11 : Résolution PENDING_IMPORT → CONSUMES
**Fichiers :** `touched-files-watcher.ts` (dans ingestFile)
**Dépendances :** Étapes 8, 10
**Effort :** 2h

```typescript
/**
 * Après ingestion d'un fichier, résoudre les PENDING_IMPORT
 */
private async resolvePendingImports(filePath: string): Promise<void> {
  // Trouver tous les fichiers qui importaient ce fichier
  const result = await this.brain.neo4jClient?.run(`
    MATCH (target:File {absolutePath: $path})<-[pending:PENDING_IMPORT]-(source:File)
    RETURN source.absolutePath as sourcePath,
           pending.symbols as symbols,
           pending.scopeUuid as scopeUuid
  `, { path: filePath });

  if (!result?.records.length) return;

  for (const record of result.records) {
    const sourcePath = record.get('sourcePath');
    const symbols = record.get('symbols') || [];
    const scopeUuid = record.get('scopeUuid');

    // Créer les relations CONSUMES
    await this.brain.neo4jClient?.run(`
      MATCH (targetFile:File {absolutePath: $targetPath})
      MATCH (targetScope:Scope)-[:DEFINED_IN]->(targetFile)
      WHERE targetScope.name IN $symbols

      MATCH (sourceFile:File {absolutePath: $sourcePath})
      MATCH (sourceScope:Scope)-[:DEFINED_IN]->(sourceFile)
      WHERE sourceScope.uuid = $scopeUuid OR $scopeUuid IS NULL

      MERGE (sourceScope)-[:CONSUMES]->(targetScope)
    `, {
      targetPath: filePath,
      sourcePath,
      symbols,
      scopeUuid
    });
  }

  // Supprimer les PENDING_IMPORT résolus
  await this.brain.neo4jClient?.run(`
    MATCH (target:File {absolutePath: $path})<-[pending:PENDING_IMPORT]-()
    DELETE pending
  `, { path: filePath });
}
```

---

### Étape 12 : Création PENDING_IMPORT lors du parsing
**Fichiers :** Modification du flow d'ingestion dans `ingestFile`
**Dépendances :** Étapes 10, 11
**Effort :** 2h

```typescript
// Dans ingestFile(), après parsing et création des Scopes

private async ingestFile(filePath: string): Promise<void> {
  // 1. Parser le fichier (UniversalSourceAdapter)
  const parseResult = await this.parseFile(filePath);

  // 2. Créer les Scopes dans Neo4j
  await this.createScopes(filePath, parseResult);

  // 3. Traiter les imports locaux
  for (const imp of parseResult.imports.filter(i => i.isLocal)) {
    const resolvedPath = await this.resolveImport(imp.source, filePath);
    if (!resolvedPath) continue;

    // Vérifier si le fichier cible existe et est indexed/embedded
    const targetState = await this.getFileState(resolvedPath);

    if (targetState === 'indexed' || targetState === 'embedded') {
      // Créer directement la relation CONSUMES
      await this.createConsumesRelation(filePath, resolvedPath, imp.symbols);
    } else {
      // Créer le fichier mentionné et la relation PENDING_IMPORT
      await this.brain.createMentionedFile(resolvedPath, {
        filePath,
        symbols: imp.symbols
      });
    }
  }

  // 4. Marquer comme indexed
  await this.brain.neo4jClient?.run(`
    MATCH (f:File {absolutePath: $path})
    SET f.state = 'indexed'
  `, { path: filePath });

  // 5. Résoudre les imports en attente vers ce fichier
  await this.resolvePendingImports(filePath);
}
```

---

### Étape 13 : Résolution des imports (ImportResolver adapté)
**Fichiers :** Nouveau ou extension de `ImportResolver.ts`
**Dépendances :** Étape 12
**Effort :** 1h30

```typescript
/**
 * Trouve le tsconfig.json le plus proche pour un fichier
 */
async function findNearestTsConfig(filePath: string): Promise<string | null> {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const tsconfig = path.join(dir, 'tsconfig.json');
    try {
      await fs.access(tsconfig);
      return tsconfig;
    } catch {
      dir = path.dirname(dir);
    }
  }
  return null;
}

/**
 * Résout un import pour un fichier orphelin
 */
async function resolveOrphanImport(
  importPath: string,
  currentFile: string
): Promise<string | null> {
  // Import relatif : résolution simple
  if (importPath.startsWith('.')) {
    return resolveRelativeImport(importPath, currentFile);
  }

  // Chercher tsconfig pour les path aliases
  const tsconfig = await findNearestTsConfig(currentFile);
  if (tsconfig) {
    const resolver = new ImportResolver(path.dirname(tsconfig));
    await resolver.loadTsConfig(tsconfig);
    return resolver.resolveImport(importPath, currentFile);
  }

  // Pas de tsconfig, import non-relatif = externe
  return null;
}
```

---

### Ordre d'exécution recommandé

```
Semaine 1:
├── Étape 1: Index Neo4j (30 min)
├── Étape 2: Hiérarchie Directory (1h)
├── Étape 3: touchFile() (1h)
├── Étape 4: Query helpers (30 min)
├── Étape 5: Hook file-tools (45 min)
└── Étape 6: Connecter hook (30 min)
    → TEST: Accès fichier crée nœud dirty ✓

Semaine 2:
├── Étape 7: Watcher structure (2h)
├── Étape 8: Batch ingestion (2h)
├── Étape 9: Intégration brain_search (1h)
    → TEST: brain_search attend les fichiers ✓

Semaine 3:
├── Étape 10: MentionedFile + PENDING_IMPORT (1h)
├── Étape 11: Résolution PENDING_IMPORT (2h)
├── Étape 12: Création PENDING_IMPORT au parsing (2h)
└── Étape 13: ImportResolver adapté (1h30)
    → TEST: Relations CONSUMES entre orphelins ✓
```

---

## Questions ouvertes

1. **TTL sur les fichiers orphelins ?**
   - Nettoyer après X jours sans accès ?
   - Limite max de fichiers ?

2. **Granularité du watch**
   - Watch tout le cwd récursivement ?
   - Ou seulement les fichiers explicitement accédés ?

3. **Priorité d'ingestion**
   - Fichiers récemment accédés d'abord ?
   - Fichiers dans le cwd actuel d'abord ?

4. **Gestion des conflits**
   - Fichier orphelin qui devient partie d'un projet ?
   - Migration des nœuds et relations ?

---

## Estimation de complexité

| Phase | Effort | Risque |
|-------|--------|--------|
| 1. Infrastructure | Moyen | Faible |
| 2. Hook file tools | Faible | Faible |
| 3. Watcher custom | Élevé | Moyen |
| 4. Relations CONSUMES | Élevé | Élevé |
| 5. Levenshtein bonus | Moyen | Faible |

**Total estimé : 3-5 jours de développement**

---

## Schéma Neo4j final

```cypher
// Index
CREATE INDEX directory_path IF NOT EXISTS FOR (d:Directory) ON (d.path);
CREATE INDEX file_absolutepath IF NOT EXISTS FOR (f:File) ON (f.absolutePath);
CREATE INDEX file_state IF NOT EXISTS FOR (f:File) ON (f.state);

// File node pour touched-files
(:File {
  uuid: "...",
  absolutePath: "/home/user/scripts/helper.ts",
  name: "helper.ts",
  extension: ".ts",
  projectId: "touched-files",

  // État du fichier orphelin
  state: "embedded",  // "mentioned" | "dirty" | "indexed" | "embedded"

  // Disponible dès state = "indexed"
  lineCount: 45,
  hash: "abc123...",

  // Disponible si state = "embedded"
  embedding_name: [...],
  embedding_content: [...]
})

// Relation pour tracker les imports non résolus
// Quand fileA importe fileB mais fileB n'est pas encore "indexed"
(:File {absolutePath: "fileA.ts"})-[:PENDING_IMPORT {
  importPath: "./fileB",           // Le chemin d'import original
  importedSymbols: ["foo", "bar"], // Les symboles importés
  importerScopeUuid: "..."         // Le scope qui fait l'import (optionnel)
}]->(:File {absolutePath: "fileB.ts", state: "mentioned"})

// Quand fileB passe en "indexed", on peut :
// 1. Supprimer la relation PENDING_IMPORT
// 2. Créer les vraies relations CONSUMES entre scopes
```

### Exemple complet

```cypher
// Hiérarchie Directory
(:Directory {path: "/home/user", name: "user"})
  <-[:IN_DIRECTORY]-(:Directory {path: "/home/user/scripts", name: "scripts"})

// Fichier indexé avec scopes
(:Directory {path: "/home/user/scripts"})
  <-[:IN_DIRECTORY]-(:File {
      absolutePath: "/home/user/scripts/helper.ts",
      name: "helper.ts",
      state: "indexed",
      projectId: "touched-files",
      lineCount: 45
    })
      <-[:DEFINED_IN]-(:Scope {
        name: "processData",
        type: "function"
      })
        -[:CONSUMES]->(:Scope {name: "fetchApi"})

// Fichier juste mentionné (importé mais jamais accédé)
(:Directory {path: "/home/user/scripts"})
  <-[:IN_DIRECTORY]-(:File {
      absolutePath: "/home/user/scripts/utils.ts",
      name: "utils.ts",
      state: "mentioned",
      projectId: "touched-files"
      // Pas de lineCount, pas de scopes
    })

// Relation d'import en attente
(:File {absolutePath: ".../helper.ts"})
  -[:PENDING_IMPORT {importPath: "./utils", importedSymbols: ["formatDate"]}]->
  (:File {absolutePath: ".../utils.ts", state: "mentioned"})
```

### Query : Reconstruire CONSUMES après ingestion

```cypher
// Quand utils.ts passe de "mentioned" à "indexed"
// Trouver tous les fichiers qui l'importaient et recréer les relations

MATCH (target:File {absolutePath: $newlyIndexedPath, state: "indexed"})
MATCH (source:File)-[pending:PENDING_IMPORT]->(target)
MATCH (sourceScope:Scope)-[:DEFINED_IN]->(source)
MATCH (targetScope:Scope)-[:DEFINED_IN]->(target)
WHERE targetScope.name IN pending.importedSymbols

// Créer la relation CONSUMES
MERGE (sourceScope)-[:CONSUMES]->(targetScope)

// Supprimer la relation PENDING_IMPORT
DELETE pending
```
