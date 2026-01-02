# 03 - Daemon Auto-Discovery

## Objectif

Quand LucieCode démarre, le daemon doit automatiquement:
1. Scanner le répertoire courant pour trouver les `package.json`
2. Enregistrer chaque `package.json` comme un projet
3. Lancer l'ingestion schema-only en background pour chaque projet

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         LucieCode                                │
│                    (./LucieCode dans /project)                   │
└──────────────────────────────────────────────────────────────────┘
                               │
                               │ Connexion au daemon
                               │ avec cwd: /project
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                          Daemon                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  AutoDiscoveryService                                      │  │
│  │  ─────────────────────                                     │  │
│  │  • Reçoit le cwd du client                                 │  │
│  │  • Scan récursif pour package.json                         │  │
│  │  • Filtre node_modules, .git, etc.                         │  │
│  │  • Queue chaque projet pour schema ingestion               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                               │                                  │
│                               ▼                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  SchemaIngestionQueue                                      │  │
│  │  ─────────────────────                                     │  │
│  │  • FIFO queue de projets à ingérer                         │  │
│  │  • Traitement en background                                │  │
│  │  • Un projet à la fois (évite surcharge)                   │  │
│  │  • Notifie quand terminé                                   │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Implémentation

### 1. Hook de connexion client

```typescript
// packages/cli/src/commands/daemon.ts

async handleClientConnect(clientId: string, cwd: string) {
  // Notifier l'AutoDiscoveryService
  await this.autoDiscovery.onClientConnect(cwd);
}
```

### 2. AutoDiscoveryService

```typescript
// packages/core/src/daemon/auto-discovery.ts

export class AutoDiscoveryService {
  private brain: BrainManager;
  private ingestionQueue: SchemaIngestionQueue;
  private discoveredProjects = new Map<string, ProjectInfo>();

  constructor(brain: BrainManager) {
    this.brain = brain;
    this.ingestionQueue = new SchemaIngestionQueue(brain);
  }

  async onClientConnect(cwd: string): Promise<void> {
    // 1. Scanner pour package.json
    const packageJsonPaths = await this.findPackageJsonFiles(cwd);

    // 2. Pour chaque package.json trouvé
    for (const pkgPath of packageJsonPaths) {
      const projectRoot = path.dirname(pkgPath);

      // Skip si déjà découvert
      if (this.discoveredProjects.has(projectRoot)) {
        continue;
      }

      // 3. Lire le package.json pour le nom
      const pkg = await this.readPackageJson(pkgPath);
      const projectName = pkg.name || path.basename(projectRoot);

      // 4. Enregistrer le projet
      const projectInfo: ProjectInfo = {
        path: projectRoot,
        name: projectName,
        discoveredAt: Date.now(),
        status: 'pending',
      };
      this.discoveredProjects.set(projectRoot, projectInfo);

      // 5. Ajouter à la queue d'ingestion
      await this.ingestionQueue.add(projectInfo);
    }
  }

  private async findPackageJsonFiles(rootDir: string): Promise<string[]> {
    const { glob } = await import('glob');

    const files = await glob('**/package.json', {
      cwd: rootDir,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/coverage/**',
      ],
      absolute: true,
    });

    return files;
  }

  private async readPackageJson(pkgPath: string): Promise<{ name?: string }> {
    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  // Obtenir le statut de tous les projets découverts
  getDiscoveredProjects(): ProjectInfo[] {
    return Array.from(this.discoveredProjects.values());
  }

  // Vérifier si un path est dans un projet découvert
  getProjectForPath(filePath: string): ProjectInfo | null {
    for (const [projectRoot, info] of this.discoveredProjects) {
      if (filePath.startsWith(projectRoot)) {
        return info;
      }
    }
    return null;
  }
}
```

### 3. SchemaIngestionQueue

```typescript
// packages/core/src/daemon/schema-ingestion-queue.ts

interface QueueItem {
  project: ProjectInfo;
  priority: number;  // Plus haut = plus prioritaire
  addedAt: number;
}

export class SchemaIngestionQueue {
  private brain: BrainManager;
  private queue: QueueItem[] = [];
  private processing = false;
  private currentProject: ProjectInfo | null = null;

  constructor(brain: BrainManager) {
    this.brain = brain;
  }

  async add(project: ProjectInfo, priority = 0): Promise<void> {
    this.queue.push({
      project,
      priority,
      addedAt: Date.now(),
    });

    // Trier par priorité (desc) puis par addedAt (asc)
    this.queue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.addedAt - b.addedAt;
    });

    // Démarrer le traitement si pas déjà en cours
    if (!this.processing) {
      this.processQueue();
    }
  }

  // Augmenter la priorité d'un projet (quand accédé par l'agent)
  async prioritize(projectPath: string): Promise<void> {
    const item = this.queue.find(i => i.project.path === projectPath);
    if (item) {
      item.priority = 100;  // Haute priorité
      // Re-trier
      this.queue.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.addedAt - b.addedAt;
      });
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.currentProject = item.project;
      item.project.status = 'ingesting';

      try {
        // Ingérer le projet (schema-only)
        const result = await this.brain.schemaIngest(item.project.path, {
          projectName: item.project.name,
        });

        item.project.status = 'ready';
        item.project.projectId = result.projectId;
        item.project.stats = result;

        console.log(`[AutoDiscovery] Project "${item.project.name}" ingested in ${result.durationMs}ms`);
      } catch (error: any) {
        item.project.status = 'error';
        item.project.error = error.message;
        console.error(`[AutoDiscovery] Failed to ingest "${item.project.name}":`, error.message);
      }

      this.currentProject = null;
    }

    this.processing = false;
  }

  // Statut de la queue
  getStatus(): QueueStatus {
    return {
      processing: this.processing,
      currentProject: this.currentProject,
      pending: this.queue.length,
      queue: this.queue.map(i => ({
        name: i.project.name,
        priority: i.priority,
      })),
    };
  }
}
```

## Intégration avec le Daemon

### Modification du daemon existant

```typescript
// packages/cli/src/commands/daemon.ts

class RagForgeDaemon {
  private autoDiscovery: AutoDiscoveryService;

  async start() {
    // ... initialisation existante ...

    // Créer le service d'auto-discovery
    this.autoDiscovery = new AutoDiscoveryService(this.brain);

    // ... reste du démarrage ...
  }

  // Quand un client se connecte
  async handleConnection(socket: WebSocket, request: IncomingMessage) {
    // Extraire le cwd du client (passé en query param ou header)
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const cwd = url.searchParams.get('cwd') || process.cwd();

    // Notifier l'auto-discovery
    await this.autoDiscovery.onClientConnect(cwd);

    // ... gestion de la connexion ...
  }
}
```

### Modification du client CLI

```typescript
// packages/cli/src/commands/daemon-client.ts

async connect() {
  // Passer le cwd au daemon
  const cwd = process.cwd();
  const url = `ws://localhost:${port}?cwd=${encodeURIComponent(cwd)}`;

  this.socket = new WebSocket(url);
  // ...
}
```

## Questions de design

### Q1: Faut-il ingérer TOUS les package.json trouvés?

Options:
- **A) Oui, tous** - Simplicité, tout est prêt
- **B) Non, seulement le root et ses enfants directs** - Évite les dépendances
- **C) Configurable via `.ragforge.json`** - Flexibilité

**Recommandation:** Option B avec possibilité de configurer.

### Q2: Que faire pour les monorepos?

Un monorepo peut avoir:
```
/project
  package.json          (root)
  packages/
    core/
      package.json      (package 1)
    cli/
      package.json      (package 2)
```

Options:
- Créer un projet par package.json
- Créer un projet unique pour le monorepo
- Détecter le monorepo et créer des sous-projets liés

**Recommandation:** Un projet par package.json, avec relation parent possible.

### Q3: Comment gérer les gros monorepos (>100 packages)?

Options:
- Limiter à N projets max
- Ingérer seulement les projets accédés
- Mode "lazy" - créer Project node mais ne pas ingérer

**Recommandation:** Mode lazy + priorisation quand accédé.

### Q4: Faut-il persister la liste des projets découverts?

Options:
- Non, re-scanner à chaque connexion
- Oui, dans un cache local
- Oui, dans Neo4j

**Recommandation:** Dans Neo4j comme nodes `Project` avec `status: 'discovered'`.

## Étapes d'implémentation

1. **Créer `AutoDiscoveryService`** - Scan et découverte
2. **Créer `SchemaIngestionQueue`** - Queue de traitement
3. **Modifier daemon** - Hook de connexion client
4. **Modifier client CLI** - Passer le cwd
5. **Ajouter endpoint status** - `/discovery/status`
6. **Tests** - Vérifier la découverte et l'ingestion
