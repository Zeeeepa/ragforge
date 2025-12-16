# Plan: Fix "Failed to initialize daemon" quand le daemon tourne

## Problème

L'erreur "Failed to initialize daemon" apparaît parfois alors que le daemon est déjà en cours d'exécution.

## Cause racine

Dans `ensureDaemonRunning()` (`daemon-client.ts`):

```typescript
1. isDaemonRunning() → fetch /health avec timeout 2s
   → Si le daemon est lent (BrainManager init, Neo4j) → retourne FALSE

2. isPortInUse(6969) → TRUE (daemon écoute)

3. Boucle d'attente: isDaemonRunning() pendant 30s max
   → Si le daemon ne devient jamais "healthy" → TIMEOUT → FALSE
```

**Scénarios problématiques:**

1. **Health check timeout trop court (2s)**
   - Le daemon est occupé (ingestion en cours, Neo4j lent)
   - Le fetch timeout avant que le daemon réponde

2. **Daemon en état "listening but not healthy"**
   - Le serveur HTTP écoute mais le BrainManager n'est pas prêt
   - `/health` retourne une erreur ou ne répond pas

3. **Race condition au démarrage**
   - Plusieurs clients MCP appellent `ensureDaemonRunning` simultanément
   - Le lock file protège contre les starts parallèles
   - Mais si tout le monde timeout sur le health check...

## Solution proposée

### 1. Augmenter le timeout du health check

```typescript
// daemon-client.ts

// Avant
const response = await fetch(url, {
  signal: AbortSignal.timeout(2000),  // 2s
});

// Après
const response = await fetch(url, {
  signal: AbortSignal.timeout(5000),  // 5s
});
```

### 2. Améliorer le endpoint /health du daemon

```typescript
// daemon.ts - endpoint /health

// Avant: retourne OK dès que le serveur écoute
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Après: retourne l'état réel
app.get('/health', (req, res) => {
  if (!brainManager) {
    res.status(503).json({ status: 'starting', message: 'BrainManager initializing' });
    return;
  }
  if (!brainManager.isReady()) {
    res.status(503).json({ status: 'starting', message: 'Neo4j connecting' });
    return;
  }
  res.json({ status: 'ready', uptime: process.uptime() });
});
```

### 3. Différencier "listening" de "ready" dans le client

```typescript
// daemon-client.ts

interface HealthResponse {
  status: 'ready' | 'starting';
  message?: string;
}

async function isDaemonRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // 503 = starting, mais le daemon tourne
      if (response.status === 503) {
        await logToFile('debug', 'Daemon starting but not ready yet');
        return false; // On va réessayer
      }
      return false;
    }

    const data: HealthResponse = await response.json();
    return data.status === 'ready';
  } catch (error) {
    return false;
  }
}

// Nouvelle fonction pour vérifier si le daemon est au moins démarré
async function isDaemonStarted(): Promise<boolean> {
  try {
    const response = await fetch(`${DAEMON_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    // Peu importe le status code, s'il répond c'est qu'il tourne
    return true;
  } catch {
    return false;
  }
}
```

### 4. Améliorer la logique d'attente

```typescript
// daemon-client.ts - ensureDaemonRunning()

// Au lieu de juste attendre isDaemonRunning()
// On peut être plus intelligent:

while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
  await new Promise(resolve => setTimeout(resolve, STARTUP_CHECK_INTERVAL_MS));

  // Le daemon répond-il du tout?
  const started = await isDaemonStarted();
  if (!started) {
    // Daemon pas encore démarré, continuer d'attendre
    continue;
  }

  // Le daemon est-il prêt?
  const ready = await isDaemonRunning();
  if (ready) {
    return true;
  }

  // Le daemon répond mais n'est pas prêt
  // C'est normal pendant l'init, on continue d'attendre
  await logToFile('debug', 'Daemon started but not ready, waiting...');
}
```

### 5. Retry avec exponential backoff

```typescript
// Plus robuste que des intervalles fixes

const INITIAL_DELAY = 500;
const MAX_DELAY = 5000;

let delay = INITIAL_DELAY;
while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
  await new Promise(resolve => setTimeout(resolve, delay));

  if (await isDaemonRunning()) {
    return true;
  }

  // Exponential backoff avec cap
  delay = Math.min(delay * 1.5, MAX_DELAY);
}
```

## Fichiers à modifier

1. **`packages/cli/src/commands/daemon-client.ts`**
   - Augmenter timeout health check (2s → 5s)
   - Ajouter `isDaemonStarted()` function
   - Améliorer logique d'attente
   - Optionnel: exponential backoff

2. **`packages/cli/src/commands/daemon.ts`**
   - Améliorer endpoint `/health` pour retourner l'état réel
   - Ajouter `isReady()` au BrainDaemon

## Constantes à ajuster

```typescript
// daemon-client.ts
const HEALTH_CHECK_TIMEOUT_MS = 5000;  // était 2000
const STARTUP_TIMEOUT_MS = 45000;      // était 30000 (optionnel)
const STARTUP_CHECK_INTERVAL_MS = 500; // ok
```

## Étapes d'implémentation

1. [ ] Modifier timeout health check (2s → 5s) dans `daemon-client.ts`
2. [ ] Ajouter méthode `isReady()` au `BrainDaemon` dans `daemon.ts`
3. [ ] Améliorer endpoint `/health` pour retourner status détaillé
4. [ ] Ajouter fonction `isDaemonStarted()` dans `daemon-client.ts`
5. [ ] Améliorer logique d'attente dans `ensureDaemonRunning()`
6. [ ] Tester avec daemon lent (simuler delay dans init)

## Tests de validation

```bash
# 1. Arrêter le daemon
ragforge daemon stop

# 2. Lancer deux terminaux qui appellent le daemon en même temps
# Terminal 1:
ragforge test-tool brain_search --query "test"

# Terminal 2 (immédiatement après):
ragforge test-tool brain_search --query "test2"

# Les deux devraient réussir sans "failed to initialize"
```

## Logs utiles pour debug

```bash
# Logs du client
cat ~/.ragforge/logs/daemon-client.log | tail -100

# Logs du daemon
cat ~/.ragforge/logs/daemon.log | tail -100
```
