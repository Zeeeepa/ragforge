# Brain Daemon Design

## Date: 2025-12-08

## Problématique

Actuellement, chaque invocation de `test-tool` crée une nouvelle instance de `BrainManager`, exécute le tool, puis shutdown. Cela pose plusieurs problèmes:

1. **Les file watchers ne persistent pas** - Un watcher démarré par `create_project` ou `ingest_directory --watch=true` est tué dès que la commande se termine
2. **Pas de persistance en mémoire** - Impossible de tester le flux complet (créer projet → ajouter fichiers → vérifier auto-ingestion)
3. **Latence** - Chaque commande doit réinitialiser le BrainManager (~2s)

Pour le **MCP server**, ce n'est pas un problème car le serveur reste en vie. Mais pour le **développement d'agents** avec `test-tool`, on a besoin d'un daemon persistent.

## Solution: Brain Daemon

Un processus daemon qui maintient le BrainManager en vie avec auto-shutdown après inactivité.

### Architecture

```
┌─────────────────┐     Unix Socket     ┌──────────────────────┐
│   test-tool     │ ←───────────────────→ │   Brain Daemon       │
│   (client)      │    JSON-RPC          │   (BrainManager)     │
└─────────────────┘                      │   - File Watchers    │
                                         │   - Neo4j Connection │
                                         │   - Auto-shutdown    │
                                         └──────────────────────┘
```

### Composants

1. **Socket Unix**: `~/.ragforge/brain-daemon.sock`
2. **PID file**: `~/.ragforge/brain-daemon.pid`
3. **Protocole**: JSON-RPC 2.0 simple

### Comportement

1. **test-tool** tente de se connecter au socket
2. Si connexion échoue → spawn le daemon en background
3. Daemon reçoit les requêtes JSON-RPC et les exécute via BrainManager
4. Chaque requête reset le timer d'inactivité (5 min par défaut)
5. Après 5 min sans activité → daemon se shutdown proprement

### API JSON-RPC

```typescript
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "callTool",
  "params": {
    "tool": "write_file",
    "args": { "path": "...", "content": "..." }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { ... }
}

// Special methods
- "ping" → check if alive
- "shutdown" → graceful shutdown
- "getStatus" → daemon status, active watchers, etc.
```

## Points d'entrée dans le code

### Fichiers à créer

1. **`packages/cli/src/commands/daemon.ts`**
   - Commande `ragforge daemon start|stop|status`
   - Serveur socket Unix
   - Gestion du BrainManager
   - Timer d'auto-shutdown

2. **`packages/core/src/brain/daemon-client.ts`**
   - Client pour se connecter au daemon
   - Méthodes: `connect()`, `callTool()`, `shutdown()`, `isRunning()`

### Fichiers à modifier

1. **`packages/cli/src/commands/test-tool.ts`**
   - Utiliser `DaemonClient` au lieu de créer BrainManager directement
   - Spawn daemon si pas running

2. **`packages/core/src/tools/brain-tools.ts`**
   - `cleanup_brain` doit aussi arrêter le daemon
   - Ajouter méthode `generateCleanupBrainHandler` → envoyer shutdown au daemon

### Code existant pertinent

- **`BrainManager`** (`packages/core/src/brain/brain-manager.ts`)
  - Singleton pattern déjà en place: `BrainManager.getInstance()`
  - Méthodes de gestion des watchers: `startWatching()`, `stopWatching()`, `getWatchedProjects()`
  - Shutdown propre: `shutdown()`

- **`test-tool.ts`** (`packages/cli/src/commands/test-tool.ts`)
  - Actuellement crée BrainManager à chaque appel
  - Appelle `shutdown()` à la fin

## Travail déjà fait dans cette session

### 1. File Tools Brain-Aware
Ajoutés dans `brain-tools.ts`:
- `read_file`, `write_file`, `create_file`, `edit_file`, `delete_path`
- Auto-ingestion via `triggerReIngestion()` après modification
- Fonction helper `findProjectForFile()` pour trouver le projet d'un fichier

### 2. Watcher Management Tools
- `list_watchers` - Liste les watchers actifs
- `start_watcher` - Démarre un watcher sur un projet
- `stop_watcher` - Arrête un watcher

### 3. create_project avec file watcher
- `create_project` démarre maintenant automatiquement un file watcher après ingestion
- Retourne `watching: true` dans le résultat

### 4. quickIngest avec option watch
- Corrigé pour réellement démarrer le watcher quand `watch: true`
- Retourne `watching: boolean` dans `QuickIngestResult`

## Prochaines étapes

1. [ ] Créer `daemon.ts` avec serveur socket
2. [ ] Créer `daemon-client.ts`
3. [ ] Modifier `test-tool.ts` pour utiliser le client
4. [ ] Modifier `cleanup_brain` pour shutdown daemon
5. [ ] Tester le flux complet

## Configuration suggérée

```yaml
# Dans ~/.ragforge/config.yaml
daemon:
  socket_path: ~/.ragforge/brain-daemon.sock
  pid_file: ~/.ragforge/brain-daemon.pid
  idle_timeout: 300  # 5 minutes en secondes
  auto_start: true   # Démarrer auto si pas running
```

## Commandes CLI prévues

```bash
# Gestion manuelle du daemon
ragforge daemon start    # Démarre en foreground (pour debug)
ragforge daemon start -d # Démarre en background (detached)
ragforge daemon stop     # Arrête le daemon
ragforge daemon status   # Affiche l'état

# test-tool utilise automatiquement le daemon
ragforge test-tool write_file --path=... --content=...
```

## Notes techniques

- Utiliser `net.createServer()` pour le socket Unix
- `child_process.spawn()` avec `detached: true` pour le mode background
- Fichier PID pour vérifier si daemon running
- Graceful shutdown: attendre que les watchers flush leurs queues
