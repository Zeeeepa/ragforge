# Fix: brain_search doit passer par le Watcher

Date: 2025-12-09

## Problème identifié

`brain_search` et le `FileWatcher` utilisent deux logiques séparées pour le lock d'ingestion, ce qui crée une race condition.

### Flux actuel (cassé)

```
Claude Code crée un fichier (via Write tool natif, pas MCP)
       ↓
Chokidar détecte (300ms delay awaitWriteFinish)
       ↓
IngestionQueue batch timer (1s)     ← brain_search ICI ne voit PAS le lock!
       ↓
lock.acquire()                      ← Lock acquis APRÈS que brain_search a déjà retourné
       ↓
Ingestion
       ↓
lock.release()
```

### Code actuel de brain_search

```typescript
// brain-tools.ts:428-449
const ingestionLock = ctx.brain.getIngestionLock();

if (ingestionLock.isLocked()) {
  console.log('[brain_search] Waiting for ingestion lock...');
  const unlocked = await ingestionLock.waitForUnlock(30000);
  // ...
}

if (ctx.brain.hasPendingEdits()) {
  console.log('[brain_search] Waiting for pending edits to flush...');
  const flushed = await ctx.brain.waitForPendingEdits(30000);
  // ...
}
```

### Problèmes

1. **Ne passe pas par le watcher** - Vérifie seulement le lock, pas les fichiers pending dans la queue
2. **Ne démarre pas le watcher** - Si le watcher n'est pas actif, les changements externes ne sont jamais détectés
3. **Race condition** - Le batch timer de 1s peut ne pas avoir encore acquis le lock
4. **Délai chokidar** - 300ms de `awaitWriteFinish` avant même que le fichier soit ajouté à la queue

## Solution proposée

### Nouveau flux

```
brain_search appelé
       ↓
Pour chaque projet concerné:
  ├─ Watcher actif ?
  │    ├─ NON → Démarrer le watcher (avec sync initial)
  │    └─ OUI → Vérifier la queue
  │              ├─ Fichiers pending ? → Forcer flush()
  │              └─ Queue vide → OK
  ↓
Vérifier ingestionLock.isLocked()
  ├─ OUI → waitForUnlock()
  └─ NON → OK
       ↓
Exécuter la recherche
```

### Implémentation

```typescript
// brain-tools.ts - generateBrainSearchHandler

export function generateBrainSearchHandler(ctx: BrainToolsContext) {
  return async (params: {
    query: string;
    projects?: string[];
    // ...
  }): Promise<UnifiedSearchResult & { waited_for_edits?: boolean }> => {

    let waitedForSync = false;

    // 1. Déterminer les projets concernés
    const allProjects = ctx.brain.listProjects();
    const targetProjects = params.projects
      ? allProjects.filter(p => params.projects!.includes(p.id))
      : allProjects;

    // 2. Pour chaque projet, s'assurer que le watcher est actif et synced
    for (const project of targetProjects) {
      const syncResult = await ensureProjectSynced(ctx.brain, project.path);
      if (syncResult.waited) {
        waitedForSync = true;
      }
    }

    // 3. Vérifier le lock d'ingestion global (pour les ingestions en cours)
    const ingestionLock = ctx.brain.getIngestionLock();
    if (ingestionLock.isLocked()) {
      console.log('[brain_search] Waiting for ingestion lock...');
      await ingestionLock.waitForUnlock(30000);
      waitedForSync = true;
    }

    // 4. Exécuter la recherche
    const result = await ctx.brain.search(params.query, options);

    return {
      ...result,
      waited_for_edits: waitedForSync,
    };
  };
}

/**
 * S'assure qu'un projet est synchronisé avant une recherche.
 * - Démarre le watcher si pas actif
 * - Force le flush de la queue si des fichiers sont pending
 */
async function ensureProjectSynced(
  brain: BrainManager,
  projectPath: string
): Promise<{ waited: boolean; watcherStarted: boolean; flushed: boolean }> {
  let waited = false;
  let watcherStarted = false;
  let flushed = false;

  // 1. Vérifier si le watcher est actif
  if (!brain.isWatching(projectPath)) {
    console.log(`[brain_search] Starting watcher for ${projectPath}...`);

    try {
      // Démarrer avec sync initial pour détecter les changements
      // depuis la dernière ingestion
      await brain.startWatching(projectPath, {
        skipInitialSync: false,  // IMPORTANT: faire le sync initial
        verbose: false,
      });
      watcherStarted = true;
      waited = true;

      // Attendre que le sync initial soit terminé
      // Le watcher fait un flush automatique après le scan initial
      const watcher = brain.getWatcher(projectPath);
      if (watcher) {
        const queue = watcher.getQueue();
        // Attendre que la queue soit vide (sync initial terminé)
        await waitForQueueEmpty(queue, 30000);
      }
    } catch (err) {
      console.warn(`[brain_search] Failed to start watcher: ${err}`);
    }
  } else {
    // 2. Watcher actif - vérifier s'il y a des fichiers pending
    const watcher = brain.getWatcher(projectPath);
    if (watcher) {
      const queue = watcher.getQueue();
      const pendingCount = queue.getPendingCount();
      const queuedCount = queue.getQueuedCount();

      if (pendingCount > 0 || queuedCount > 0) {
        console.log(
          `[brain_search] Flushing ${pendingCount} pending + ${queuedCount} queued files...`
        );

        // Forcer le flush immédiat (pas attendre le batch timer)
        await queue.flush();
        flushed = true;
        waited = true;

        // Attendre que la queue soit complètement vide
        // (le flush peut avoir déclenché une nouvelle ingestion)
        await waitForQueueEmpty(queue, 30000);
      }

      // 3. Vérifier si une ingestion est en cours
      if (queue.isProcessing()) {
        console.log('[brain_search] Waiting for ingestion to complete...');
        await waitForQueueEmpty(queue, 30000);
        waited = true;
      }
    }
  }

  return { waited, watcherStarted, flushed };
}

/**
 * Attend que la queue soit vide et qu'aucune ingestion ne soit en cours
 */
async function waitForQueueEmpty(
  queue: IngestionQueue,
  timeout: number
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const pending = queue.getPendingCount();
    const queued = queue.getQueuedCount();
    const processing = queue.isProcessing();

    if (pending === 0 && queued === 0 && !processing) {
      return true;
    }

    // Attendre un peu avant de re-vérifier
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.warn('[brain_search] Timeout waiting for queue to empty');
  return false;
}
```

## Modifications requises dans BrainManager

### Nouvelles méthodes nécessaires

```typescript
// brain-manager.ts

class BrainManager {
  private watchers: Map<string, FileWatcher> = new Map();

  /**
   * Récupère le watcher pour un projet (par path)
   */
  getWatcher(projectPath: string): FileWatcher | null {
    return this.watchers.get(projectPath) || null;
  }

  /**
   * Vérifie si un projet est surveillé
   */
  isWatching(projectPath: string): boolean {
    const watcher = this.watchers.get(projectPath);
    return watcher?.isWatching() ?? false;
  }

  /**
   * Démarre un watcher pour un projet
   */
  async startWatching(projectPath: string, options?: {
    skipInitialSync?: boolean;
    verbose?: boolean;
  }): Promise<void> {
    // ... implémentation existante ...

    // Stocker le watcher
    this.watchers.set(projectPath, watcher);
  }
}
```

## Cas d'usage

### 1. Premier brain_search sur un projet jamais surveillé

```
brain_search({ query: "auth", projects: ["my-project"] })
       ↓
Watcher pas actif pour my-project
       ↓
Démarrer watcher avec sync initial
       ↓
Watcher scanne le filesystem
       ↓
Compare avec le hash en DB
       ↓
Ingère les fichiers modifiés
       ↓
Exécute la recherche (données à jour)
```

### 2. brain_search après modification externe

```
Utilisateur modifie un fichier dans VSCode
       ↓
brain_search({ query: "fonction modifiée" })
       ↓
Watcher actif, mais fichier dans la queue (batch timer)
       ↓
Force flush() de la queue
       ↓
Attend la fin de l'ingestion
       ↓
Exécute la recherche (fichier modifié indexé)
```

### 3. brain_search pendant une ingestion

```
Watcher détecte 50 fichiers modifiés
       ↓
Ingestion en cours (lock acquis)
       ↓
brain_search({ query: "test" })
       ↓
Queue vide, mais lock actif
       ↓
waitForUnlock()
       ↓
Exécute la recherche (après ingestion)
```

## Tests

```typescript
describe('brain_search watcher integration', () => {
  it('should start watcher if not active', async () => {
    // Créer un fichier sans watcher actif
    await fs.writeFile('test-project/new-file.ts', 'export const x = 1;');

    // brain_search devrait démarrer le watcher et sync
    const result = await brainSearch({ query: 'export const x' });

    expect(result.waited_for_edits).toBe(true);
    expect(result.results).toContainEqual(
      expect.objectContaining({ file: 'new-file.ts' })
    );
  });

  it('should flush pending queue before search', async () => {
    // Démarrer le watcher
    await brain.startWatching('test-project');

    // Modifier un fichier (watcher va le détecter)
    await fs.writeFile('test-project/file.ts', 'export const y = 2;');

    // Attendre que chokidar détecte (mais pas le batch timer)
    await sleep(400);

    // brain_search devrait forcer le flush
    const result = await brainSearch({ query: 'export const y' });

    expect(result.waited_for_edits).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('should wait for ongoing ingestion', async () => {
    // Simuler une ingestion longue
    const queue = watcher.getQueue();
    queue.addFiles(manyFiles);

    // Lancer brain_search pendant l'ingestion
    const searchPromise = brainSearch({ query: 'test' });

    // La recherche devrait attendre
    expect(queue.isProcessing()).toBe(true);

    const result = await searchPromise;
    expect(result.waited_for_edits).toBe(true);
  });
});
```

## Résumé des changements

| Fichier | Modification |
|---------|--------------|
| `brain-tools.ts` | Ajouter `ensureProjectSynced()` avant la recherche |
| `brain-manager.ts` | Ajouter `getWatcher()`, stocker les watchers dans une Map |
| `ingestion-queue.ts` | (aucune modification, `flush()` et `isProcessing()` existent déjà) |

## Ordre d'implémentation

1. **BrainManager** - Ajouter `getWatcher()` et stocker les watchers
2. **brain_search handler** - Ajouter la logique `ensureProjectSynced()`
3. **Tests** - Valider les 3 cas d'usage
