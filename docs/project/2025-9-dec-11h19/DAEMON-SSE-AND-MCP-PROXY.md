# Daemon SSE Logs & MCP Proxy Migration

## Date: 2025-12-09 ~18h00

## Contexte

Migration du projet pour que toutes les opérations brain passent par le daemon HTTP.

## Travail terminé

### 1. Fix EPIPE infinite loop (FAIT)
Le daemon crashait en boucle infinie quand stdout/stderr était fermé (ex: terminal parent fermé).

**Fichier**: `packages/cli/src/commands/daemon.ts`

**Fix**:
- Ajout de `safeConsoleWrite()` qui catch les erreurs EPIPE
- Modification de `interceptConsole()` pour utiliser `safeConsoleWrite`
- Modification de `uncaughtException` handler pour ignorer les EPIPE

### 2. SSE Log Streaming (FAIT)
Endpoint pour streamer les logs du daemon en temps réel.

**Endpoint**: `GET /logs/stream?tail=N`

**Fichier**: `packages/cli/src/commands/daemon.ts`

**Implémentation**:
- Route SSE dans `setupRoutes()`
- Système de subscribers dans `DaemonLogger` avec `subscribe()` et `notifySubscribers()`
- Headers SSE: `text/event-stream`, `no-cache`, `keep-alive`
- Heartbeat toutes les 15 secondes

### 3. CLI Command `daemon logs` (FAIT)
Commande pour streamer les logs dans le terminal.

**Usage**:
```bash
ragforge daemon logs              # Stream en temps réel (Ctrl+C pour arrêter)
ragforge daemon logs --tail=100   # Affiche les 100 dernières lignes puis stream
ragforge daemon logs --no-follow  # Affiche les logs récents et quitte
```

**Fichier**: `packages/cli/src/commands/daemon.ts` + `packages/cli/src/index.ts`

**Fix buffering**: Utilisation de `http` natif Node.js au lieu de `fetch` pour éviter le buffering d'undici.

### 4. Migration projects.yaml → Neo4j (FAIT - session précédente)
- `nodeCount` maintenant calculé dynamiquement depuis Neo4j
- `updateProjectMetadataInDb()` pour persister les métadonnées
- `refreshProjectsCache()` pour charger depuis Neo4j au démarrage
- Suppression de `saveProjectsRegistry()` et `loadProjectsRegistry()`

## Travail terminé (suite)

### 5. MCP Server → Daemon Proxy (FAIT)

**Problème résolu**: Le MCP server créait sa propre instance de `BrainManager` pour certains callbacks.

**Solution implémentée**: Tous les callbacks passent maintenant par le `DaemonBrainProxy`.

**Fichiers modifiés**:
- `packages/cli/src/commands/mcp-server.ts` - Utilise `DaemonBrainProxy` au lieu de `BrainManager` direct
- `packages/cli/src/commands/daemon.ts` - Ajout de 2 nouveaux endpoints
- `packages/cli/src/commands/daemon-brain-proxy.ts` - Ajout des méthodes correspondantes

**Nouveaux endpoints daemon**:
1. `POST /brain/ingest-web-page` - Pour ingérer une page web avec contenu pré-extrait
2. `POST /brain/update-media-content` - Pour mettre à jour le contenu média (images, 3D)
3. `POST /queue-file-change` - Existait déjà, utilisé par file tools

**Architecture finale**:
```
MCP Server (Claude Code)
    │
    ├── Brain Tools → callToolViaDaemon() ✅
    ├── File Tools → onFileModified → POST /queue-file-change ✅
    ├── Web Tools → ingestWebPage → POST /brain/ingest-web-page ✅
    └── Image/3D Tools → onContentExtracted → POST /brain/update-media-content ✅

Daemon (port 6969)
    │
    └── BrainManager (singleton)
```

**Changements clés dans mcp-server.ts**:
- Import `getDaemonBrainProxy` au lieu de `BrainManager`
- Type `McpContext.brainProxy: BrainProxy | null` remplace `brainManager`
- Initialisation: `ctx.brainProxy = await getDaemonBrainProxy()`
- Auto-init utilise aussi le proxy
- `getWatcher()` remplacé par `isWatching()` (compatible proxy)

## Commandes pour reprendre

```bash
# Vérifier que le daemon tourne
ragforge daemon status

# Voir les logs en temps réel
ragforge daemon logs

# Fichier principal MCP server
code packages/cli/src/commands/mcp-server.ts

# Fichier daemon (ajouter endpoints)
code packages/cli/src/commands/daemon.ts

# Chercher les usages de BrainManager dans MCP server
grep -n "brainManager\|BrainManager" packages/cli/src/commands/mcp-server.ts
```

## Notes

- L'agent CLI utilise déjà `generateDaemonBrainToolHandlers()` pour passer par le daemon
- Le proxy `DaemonBrainProxy` existe déjà dans `daemon-brain-proxy.ts`
- Les brain tools du MCP server passent déjà par `callToolViaDaemon()`
