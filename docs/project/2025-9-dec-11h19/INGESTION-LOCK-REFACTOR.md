# Refactor: IngestionLock avec opérations nommées

Date: 2025-12-09

## Problème actuel

Le `IngestionLock` actuel est **séquentiel** :
- Un seul holder à la fois
- Les autres attendent dans une queue
- `release()` donne le lock au suivant

### Problème de priorité

```typescript
// Scénario problématique :

// 1. Watcher acquiert le lock
const release1 = await lock.acquire('batch:50 files');

// 2. edit_file veut aussi le lock (va dans la queue)
const release2Promise = lock.acquire('edit:src/utils.ts');

// 3. Watcher termine et release
release1();  // → donne le lock à edit_file

// 4. edit_file termine et release
release2();  // → libère le lock GLOBALEMENT

// MAIS : si un autre batch watcher était en cours en parallèle,
// il perd son lock !
```

### Autre problème : opérations concurrentes

On veut que plusieurs opérations puissent être "en cours" simultanément, et que le lock ne se libère que quand **toutes** sont terminées.

```
Watcher batch #1 (50 files)     ─────────────────────────┐
                                                          │
edit_file (1 file)              ──────┐                   │
                                       │                   │
Watcher batch #2 (10 files)           └──────────────────┤
                                                          │
                                                          ▼
                                             Lock libéré ICI
                                         (quand TOUT est fini)
```

## Solution : Opérations nommées avec hash

Même pattern que `ConversationLock` :

```typescript
// Nouvelle API
const opKey1 = lock.acquire('watcher', 'batch:50 files');
const opKey2 = lock.acquire('edit', 'src/utils.ts');
const opKey3 = lock.acquire('watcher', 'batch:10 files');

// Chaque release retire UNE opération
lock.release(opKey1);  // 2 opérations restantes
lock.release(opKey2);  // 1 opération restante
lock.release(opKey3);  // 0 opérations → lock libéré
```

## Nouvelle implémentation

```typescript
// packages/core/src/tools/ingestion-lock.ts

import * as crypto from 'crypto';

/**
 * Types d'opérations avec leurs priorités
 * Plus le nombre est bas, plus la priorité est haute
 */
export const OPERATION_PRIORITIES = {
  'initial-ingest': 1,    // Ingestion initiale d'un projet
  'watcher-batch': 2,     // Batch du file watcher
  'mcp-edit': 3,          // Edit via MCP tools
  'manual-ingest': 4,     // Ingestion manuelle
} as const;

export type OperationType = keyof typeof OPERATION_PRIORITIES;

/**
 * Opération en cours
 */
export interface PendingOperation {
  /** Clé unique (type:hash) */
  key: string;
  /** Type d'opération */
  type: OperationType;
  /** Hash du contenu/identifiant */
  contentHash: string;
  /** Description pour les logs */
  description: string;
  /** Timestamp de début */
  startedAt: Date;
  /** Timeout handle */
  timeoutHandle?: NodeJS.Timeout;
}

/**
 * Génère un hash court pour identifier une opération
 */
function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 12);
}

export interface IngestionLockOptions {
  /** Timeout par défaut en ms (0 = pas de timeout). Default: 30000 */
  defaultTimeout?: number;
  /** Callback quand le statut change */
  onStatusChange?: (status: IngestionStatus) => void;
}

export interface IngestionStatus {
  /** Lock actif (au moins une opération en cours) */
  isLocked: boolean;
  /** Nombre d'opérations en cours */
  operationCount: number;
  /** Liste des opérations */
  operations: Array<{
    type: OperationType;
    description: string;
    elapsedMs: number;
  }>;
}

/**
 * Lock avec opérations nommées
 *
 * Le lock est actif tant qu'il y a AU MOINS UNE opération en cours.
 * Chaque opération est identifiée par un type + hash du contenu.
 */
export class IngestionLock {
  private operations: Map<string, PendingOperation> = new Map();
  private waiters: Array<{ resolve: () => void }> = [];
  private options: Required<IngestionLockOptions>;

  constructor(options: IngestionLockOptions = {}) {
    this.options = {
      defaultTimeout: options.defaultTimeout ?? 30000,
      onStatusChange: options.onStatusChange ?? (() => {}),
    };
  }

  /**
   * Vérifie si le lock est actif (au moins une opération en cours)
   */
  isLocked(): boolean {
    return this.operations.size > 0;
  }

  /**
   * Récupère le statut actuel
   */
  getStatus(): IngestionStatus {
    const now = Date.now();
    const operations = Array.from(this.operations.values()).map(op => ({
      type: op.type,
      description: op.description,
      elapsedMs: now - op.startedAt.getTime(),
    }));

    return {
      isLocked: this.operations.size > 0,
      operationCount: this.operations.size,
      operations,
    };
  }

  /**
   * Acquiert le lock pour une opération.
   *
   * @param type - Type d'opération (pour priorité et logging)
   * @param identifier - Identifiant unique (fichier, "batch:N files", etc.)
   * @param options - Options (timeout, description)
   * @returns Clé de l'opération (à passer à release())
   */
  acquire(
    type: OperationType,
    identifier: string,
    options?: {
      description?: string;
      timeoutMs?: number;
    }
  ): string {
    const contentHash = hashContent(identifier);
    const key = `${type}:${contentHash}`;

    // Vérifier si déjà en cours (évite les doublons)
    if (this.operations.has(key)) {
      console.warn(`[IngestionLock] Operation already in progress: ${key}`);
      return key;
    }

    const operation: PendingOperation = {
      key,
      type,
      contentHash,
      description: options?.description || identifier,
      startedAt: new Date(),
    };

    // Timeout de sécurité
    const timeout = options?.timeoutMs ?? this.options.defaultTimeout;
    if (timeout > 0) {
      operation.timeoutHandle = setTimeout(() => {
        console.warn(`[IngestionLock] Timeout for ${key}, force releasing`);
        this.release(key);
      }, timeout);
    }

    this.operations.set(key, operation);
    this.notifyStatusChange();

    console.log(
      `[IngestionLock] Acquired: ${operation.description} ` +
      `(${this.operations.size} active)`
    );

    return key;
  }

  /**
   * Libère une opération spécifique.
   * Le lock global est libéré quand TOUTES les opérations sont terminées.
   *
   * @param key - Clé retournée par acquire()
   */
  release(key: string): void {
    const operation = this.operations.get(key);

    if (!operation) {
      console.warn(`[IngestionLock] Unknown operation: ${key}`);
      return;
    }

    // Clear timeout
    if (operation.timeoutHandle) {
      clearTimeout(operation.timeoutHandle);
    }

    const elapsed = Date.now() - operation.startedAt.getTime();
    this.operations.delete(key);

    console.log(
      `[IngestionLock] Released: ${operation.description} ` +
      `(${elapsed}ms, ${this.operations.size} remaining)`
    );

    this.notifyStatusChange();

    // Si plus d'opérations, réveiller les waiters
    if (this.operations.size === 0) {
      console.log('[IngestionLock] All operations complete, releasing waiters');
      for (const waiter of this.waiters) {
        waiter.resolve();
      }
      this.waiters = [];
    }
  }

  /**
   * Attend que toutes les opérations soient terminées.
   *
   * @param timeoutMs - Timeout max (default: 30000)
   * @returns true si libéré, false si timeout
   */
  async waitForUnlock(timeoutMs: number = 30000): Promise<boolean> {
    if (this.operations.size === 0) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const waiter = { resolve: () => resolve(true) };
      this.waiters.push(waiter);

      // Timeout
      const timeout = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) {
          this.waiters.splice(idx, 1);
        }
        resolve(false);
      }, timeoutMs);

      // Cleanup timeout si résolu avant
      const originalResolve = waiter.resolve;
      waiter.resolve = () => {
        clearTimeout(timeout);
        originalResolve();
      };
    });
  }

  /**
   * Vérifie si une opération spécifique est en cours
   */
  hasOperation(type: OperationType, identifier: string): boolean {
    const contentHash = hashContent(identifier);
    const key = `${type}:${contentHash}`;
    return this.operations.has(key);
  }

  /**
   * Liste les opérations d'un type donné
   */
  getOperationsByType(type: OperationType): PendingOperation[] {
    return Array.from(this.operations.values()).filter(op => op.type === type);
  }

  /**
   * Description lisible pour les logs/debug
   */
  getDescription(): string {
    if (this.operations.size === 0) {
      return 'No active operations';
    }

    const lines = Array.from(this.operations.values()).map(op => {
      const elapsed = Date.now() - op.startedAt.getTime();
      return `  - [${op.type}] ${op.description} (${elapsed}ms)`;
    });

    return `${this.operations.size} active operations:\n${lines.join('\n')}`;
  }

  private notifyStatusChange(): void {
    this.options.onStatusChange(this.getStatus());
  }
}
```

## Migration de l'ancien code

### Avant (acquire retourne une fonction release)

```typescript
// Ancien code
const release = await lock.acquire('src/utils.ts');
try {
  await doWork();
} finally {
  release();
}
```

### Après (acquire retourne une clé)

```typescript
// Nouveau code
const opKey = lock.acquire('mcp-edit', 'src/utils.ts');
try {
  await doWork();
} finally {
  lock.release(opKey);
}
```

## Utilisation dans le code

### File Watcher (ingestion-queue.ts)

```typescript
// Avant
const release = lock ? await lock.acquire(`batch:${totalFiles} files`) : null;
// ...
if (release) release();

// Après
const opKey = lock?.acquire('watcher-batch', `batch:${totalFiles}`, {
  description: `Watcher batch: ${totalFiles} files`,
  timeoutMs: 120000,  // 2 minutes pour les gros batches
});
// ...
if (opKey) lock.release(opKey);
```

### MCP Edit Tool (brain-tools.ts)

```typescript
// triggerReIngestion
const opKey = brain.getIngestionLock().acquire('mcp-edit', absolutePath, {
  description: `MCP edit: ${path.basename(absolutePath)}`,
});
try {
  await brain.queueFileChange(absolutePath, changeType);
} finally {
  brain.getIngestionLock().release(opKey);
}
```

### Initial Ingestion (brain-manager.ts)

```typescript
const opKey = this.ingestionLock.acquire('initial-ingest', projectPath, {
  description: `Initial ingest: ${projectName}`,
  timeoutMs: 0,  // Pas de timeout pour l'ingestion initiale
});
try {
  await this.ingestProject(projectPath);
} finally {
  this.ingestionLock.release(opKey);
}
```

## Logs attendus

```
[IngestionLock] Acquired: Watcher batch: 50 files (1 active)
[IngestionLock] Acquired: MCP edit: utils.ts (2 active)
[IngestionLock] Released: MCP edit: utils.ts (523ms, 1 remaining)
[IngestionLock] Acquired: Watcher batch: 10 files (2 active)
[IngestionLock] Released: Watcher batch: 50 files (3201ms, 1 remaining)
[IngestionLock] Released: Watcher batch: 10 files (1502ms, 0 remaining)
[IngestionLock] All operations complete, releasing waiters
```

## Tests

```typescript
describe('IngestionLock with named operations', () => {
  it('should stay locked until all operations complete', async () => {
    const lock = new IngestionLock();

    const key1 = lock.acquire('watcher-batch', 'batch:50');
    const key2 = lock.acquire('mcp-edit', 'file.ts');

    expect(lock.isLocked()).toBe(true);
    expect(lock.getStatus().operationCount).toBe(2);

    lock.release(key1);
    expect(lock.isLocked()).toBe(true);  // Encore une opération

    lock.release(key2);
    expect(lock.isLocked()).toBe(false);  // Toutes terminées
  });

  it('should not create duplicate operations', () => {
    const lock = new IngestionLock();

    const key1 = lock.acquire('mcp-edit', 'file.ts');
    const key2 = lock.acquire('mcp-edit', 'file.ts');  // Même opération

    expect(key1).toBe(key2);
    expect(lock.getStatus().operationCount).toBe(1);
  });

  it('should wake waiters when all operations complete', async () => {
    const lock = new IngestionLock();

    const key = lock.acquire('watcher-batch', 'batch:10');

    const waitPromise = lock.waitForUnlock(5000);

    // Release après un délai
    setTimeout(() => lock.release(key), 100);

    const result = await waitPromise;
    expect(result).toBe(true);
  });
});
```

## Résumé

| Aspect | Ancien | Nouveau |
|--------|--------|---------|
| Identifiant | Aucun (juste filePath pour logs) | Clé unique `type:hash` |
| Concurrence | Séquentiel (queue) | Parallèle (Map) |
| Release | Libère tout | Libère UNE opération |
| Lock global | Toujours actif si holder | Actif si >= 1 opération |
| Doublons | Possible | Évités (même clé = même op) |
| Debug | `currentFile` | Liste complète avec durées |
