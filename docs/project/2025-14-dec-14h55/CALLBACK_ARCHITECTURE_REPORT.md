# Callback Architecture Report

Date: 2025-12-14 14:55

## Problème Identifié

### Symptôme
L'appel `read_file` sur un fichier orphelin bloquait pendant ~10 secondes car `onBeforeToolCall` dans `mcp-server.ts` appelait `await ctx.brainProxy.startWatching()` de manière synchrone.

### Architecture Actuelle

```
┌─────────────┐     ┌─────────────┐
│ MCP Server  │────►│             │
│             │     │   Daemon    │────► BrainManager
│ onBefore... │     │             │
└─────────────┘     └─────────────┘
                          ▲
┌─────────────┐           │
│   Agent     │───────────┘
│             │
│ (pas de     │
│  onBefore)  │
└─────────────┘
```

**Constat important**: MCP et Agent utilisent TOUS DEUX le daemon via `brainProxy`:
- MCP: `ctx.brainProxy = await getDaemonBrainProxy()` (mcp-server.ts:558)
- Agent: `brainProxy = await getDaemonBrainProxy()` (agent.ts:923)

### Cause Racine
La logique d'auto-start du watcher est dans `mcp-server.ts:onBeforeToolCall` (lignes 565-596):
1. **Pas partagée**: L'agent n'a pas ce hook, donc pas d'auto-watcher
2. **Bloquante**: `await` sur `startWatching()` bloque l'exécution du tool

```typescript
// mcp-server.ts:589 - PROBLÈME
await ctx.brainProxy.startWatching(project.path); // BLOQUANT!
```

## Inventaire des Callbacks Existants

### 1. MCP Server Level (`mcp-server.ts`)

| Callback | Description | Bloquant? |
|----------|-------------|-----------|
| `onBeforeToolCall` | Hook avant chaque appel d'outil | Oui (await) |
| `onFilesModified` | Shell command a modifié des fichiers | Oui |
| `onContentExtracted` | Contenu media extrait (image/3D) | Oui |
| `onLog` | Logging | Non |

### 2. Tool Level (`file-tools.ts`, `fs-tools.ts`, `shell-tools.ts`)

| Callback | Fichier | Description |
|----------|---------|-------------|
| `onFileModified` | file-tools.ts:233 | Fichier créé/modifié/supprimé |
| `onFileAccessed` | file-tools.ts:236 | Fichier lu (pour touched-files) |
| `onFileDeleted` | fs-tools.ts:78 | Fichier/dossier supprimé |
| `onFileMoved` | fs-tools.ts:83 | Fichier déplacé |
| `onFileCopied` | fs-tools.ts:88 | Fichier copié |
| `onFilesModified` | shell-tools.ts:35 | Shell command a modifié des fichiers |
| `onFileCreated` | threed-tools.ts:197 | Asset 3D/image créé |

### 3. Brain/Ingestion Level

| Callback | Fichier | Description |
|----------|---------|-------------|
| `onProcessingStart` | touched-files-watcher.ts:70 | Début traitement batch |
| `onBatchComplete` | touched-files-watcher.ts:72 | Fin d'un batch |
| `onProcessingComplete` | touched-files-watcher.ts:74 | Fin de tout le traitement |
| `onFileIndexed` | touched-files-watcher.ts:79 | Fichier passé en état 'linked' |
| `onFileLinked` | file-processor.ts:110 | Fichier lié (relations créées) |
| `onFileChange` | file-watcher.ts:34 | Chokidar détecte un changement |
| `onBatchStart` | ingestion-queue.ts:56 | Début batch ingestion |
| `onBatchComplete` | ingestion-queue.ts:61 | Fin batch ingestion |
| `onBatchError` | ingestion-queue.ts:66 | Erreur batch ingestion |

### 4. Agent Level (`rag-agent.ts`)

| Callback | Ligne | Description |
|----------|-------|-------------|
| `onFileModified` | 412 | Notification modification fichier |
| `onFileAccessed` | 1462 | Fichier lu (interne) |
| `onFileCreated` | 1507 | Wrapper pour onFileModified('created') |
| `onFileMoved` | 1606 | Fichier déplacé |
| `onFileCopied` | 1624 | Fichier copié |

## Architecture Proposée

### Objectif
Centraliser la logique partagée (auto-watcher, touched-files tracking) dans le **daemon**, point d'entrée unique pour MCP et Agent.

### Architecture Cible

```
┌─────────────┐     ┌──────────────────────────────────┐
│ MCP Server  │────►│           Daemon                 │
│             │     │                                  │
│ (simplifié) │     │  ┌─────────────────────────┐    │
└─────────────┘     │  │ Auto-watcher logic      │    │
                    │  │ - ensureWatcherForFile()│    │────► BrainManager
┌─────────────┐     │  │ - trackFileAccess()     │    │
│   Agent     │────►│  │ - EventEmitter          │    │
│             │     │  └─────────────────────────┘    │
│ (identique) │     │                                  │
└─────────────┘     └──────────────────────────────────┘
```

**Principe**: Le daemon est le "cerveau" qui gère toute la logique intelligente. MCP et Agent sont des clients légers.

### Solution: Hooks dans le Daemon

```typescript
// daemon.ts - Ajouter des hooks sur les appels de tools

class RagForgeDaemon {
  private eventEmitter = new EventEmitter();

  // Hook appelé AVANT chaque tool (fire-and-forget)
  private async onBeforeToolCall(toolName: string, args: any): Promise<void> {
    // Auto-watcher pour les tools qui accèdent à des fichiers
    const filePath = args?.path || args?.file_path;
    if (filePath && typeof filePath === 'string') {
      this.ensureWatcherForFile(filePath); // fire-and-forget
    }
  }

  // Hook appelé APRÈS chaque tool
  private async onAfterToolCall(toolName: string, args: any, result: any): Promise<void> {
    this.eventEmitter.emit('tool:completed', { toolName, args, result });
  }

  /**
   * Ensure watcher is running for a file's project (fire-and-forget)
   */
  private ensureWatcherForFile(filePath: string): void {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath);

    const project = this.brain?.findProjectForFile(absolutePath);
    if (project && !this.brain?.isWatching(project.path)) {
      this.brain.startWatching(project.path)
        .then(() => {
          this.logger.info(`Auto-started watcher for ${project.id}`);
          this.eventEmitter.emit('watcher:started', project.path);
        })
        .catch(err => {
          this.logger.debug(`Auto-watcher failed: ${err.message}`);
        });
    }
  }

  // Dans le handler /tool/:toolName
  async handleToolCall(toolName: string, args: any) {
    // Hook before (fire-and-forget, pas de await)
    this.onBeforeToolCall(toolName, args);

    // Execute tool
    const result = await this.toolHandlers[toolName](args);

    // Hook after (fire-and-forget)
    this.onAfterToolCall(toolName, args, result);

    return result;
  }
}
```

### Simplification de mcp-server.ts

```typescript
// mcp-server.ts - onBeforeToolCall SUPPRIMÉ ou minimal

const onBeforeToolCall = async (toolName: string, args: any) => {
  // Seulement l'auto-init du proxy si nécessaire
  if (!ctx.brainProxy) {
    ctx.brainProxy = await getDaemonBrainProxy();
  }
  // Plus de logique auto-watcher ici!
  // Le daemon s'en charge automatiquement
};
```

### Event System dans le Daemon

```typescript
// Types d'events émis par le daemon
interface DaemonEvents {
  'tool:started': { toolName: string; args: any };
  'tool:completed': { toolName: string; args: any; result: any; durationMs: number };
  'tool:error': { toolName: string; args: any; error: Error };
  'watcher:started': string;  // projectPath
  'watcher:stopped': string;
  'file:accessed': string;    // filePath
  'file:modified': { path: string; changeType: string };
  'ingestion:started': { projectId: string; fileCount: number };
  'ingestion:completed': { projectId: string; stats: any };
}

// Les clients peuvent s'abonner via WebSocket ou SSE (future feature)
```

## Avantages de cette Architecture

1. **Centralisation**: Toute la logique intelligente dans le daemon
2. **Cohérence**: MCP et Agent ont exactement le même comportement
3. **Non-bloquant**: Hooks fire-and-forget, pas de await
4. **Découplage**: Events pour notification, clients légers
5. **Extensibilité**: Ajouter des behaviors sans toucher aux clients
6. **Single Source of Truth**: Un seul daemon = un seul état

## Plan d'Implémentation

### Phase 1: Fix Immédiat
- [ ] Modifier `mcp-server.ts`: supprimer la logique auto-watcher de `onBeforeToolCall`
- [ ] Ajouter `ensureWatcherForFile()` dans `daemon.ts` (fire-and-forget)
- [ ] Appeler `ensureWatcherForFile()` dans le handler `/tool/:toolName` du daemon
- [ ] Rebuild et tester

### Phase 2: Event System dans le Daemon
- [ ] Ajouter `EventEmitter` au daemon
- [ ] Émettre des events pour: `tool:completed`, `watcher:started`, `file:modified`
- [ ] Optionnel: endpoint WebSocket/SSE pour que les clients s'abonnent aux events

### Phase 3: Simplification des Clients
- [ ] Supprimer `onBeforeToolCall` de `mcp-server.ts` (ou le réduire au minimum)
- [ ] Auditer les callbacks dans l'agent pour voir lesquels peuvent être supprimés
- [ ] Documenter l'API des events du daemon

## Fichiers Impactés

| Fichier | Changement |
|---------|------------|
| `packages/cli/src/commands/daemon.ts` | + ensureWatcherForFile(), + EventEmitter, + hooks before/after tool |
| `packages/cli/src/commands/mcp-server.ts` | - logique auto-watcher dans onBeforeToolCall |
| `packages/cli/src/commands/agent.ts` | Aucun changement immédiat (bénéficie automatiquement) |

## Questions Ouvertes

1. **WebSocket/SSE pour les events?** Permettrait aux clients de réagir aux events du daemon en temps réel
2. **Granularité des events?** File-level vs batch-level vs project-level
3. **Callbacks existants**: Les garder pour rétrocompatibilité ou migrer vers events?

## Historique des Décisions

| Date | Décision | Raison |
|------|----------|--------|
| 2025-12-14 | Daemon = point central de la logique | MCP et Agent utilisent tous deux le daemon via brainProxy |
| 2025-12-14 | Fire-and-forget pour auto-watcher | Éviter de bloquer les tools |
| 2025-12-14 | Events plutôt que callbacks | Découplage, extensibilité, testabilité |
