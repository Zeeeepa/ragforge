# Design: Machine à États Universelle pour l'Ingestion

**Date**: 30 décembre 2025
**Statut**: En cours d'implémentation

## Contexte

Le système actuel utilise des flags booléens (`embeddingsDirty`, `schemaDirty`) éparpillés dans le code pour suivre l'état des nodes. Cette approche pose plusieurs problèmes:

1. **Pas de traçabilité** - Impossible de savoir où on en est dans le pipeline
2. **Pas de reprise** - En cas de crash, on perd l'état intermédiaire
3. **Incohérent** - `FileStateMachine` existe mais cohabite avec les flags
4. **Debug difficile** - Les flags booléens ne disent pas "pourquoi"

## Objectif

Remplacer tous les flags par une machine à états persistée en Neo4j, applicable à TOUS les types de nodes (File, Scope, MarkdownSection, ImageFile, etc.).

---

## Architecture

### États du Pipeline

```
┌───────────┐     ┌───────────┐     ┌───────────┐     ┌───────────┐
│  PENDING  │────►│  PARSING  │────►│  PARSED   │────►│  LINKING  │
└───────────┘     └───────────┘     └───────────┘     └───────────┘
     │                  │                                   │
     │                  ▼                                   ▼
     │            ┌───────────┐                       ┌───────────┐
     │            │   ERROR   │◄──────────────────────│   ERROR   │
     │            │  (parse)  │                       │  (link)   │
     │            └───────────┘                       └───────────┘
     │
     │            ┌───────────┐     ┌───────────┐     ┌───────────┐
     └───────────►│  LINKED   │────►│ EMBEDDING │────►│  READY    │
                  └───────────┘     └───────────┘     └───────────┘
                        │                 │
                        ▼                 ▼
                  ┌───────────┐     ┌───────────┐
                  │   SKIP    │     │   ERROR   │
                  │ (no emb)  │     │  (embed)  │
                  └───────────┘     └───────────┘
```

### Définition des États

| État | Description | Transition suivante |
|------|-------------|---------------------|
| `pending` | Node détecté, en attente de parsing | → `parsing` |
| `parsing` | En cours de parsing | → `parsed` ou `error:parse` |
| `parsed` | Parsing terminé, en attente de linking | → `linking` |
| `linking` | Création des relations (CONSUMES, etc.) | → `linked` ou `error:link` |
| `linked` | Relations créées, prêt pour embedding | → `embedding` ou `skip` |
| `embedding` | Génération des embeddings en cours | → `ready` ou `error:embed` |
| `ready` | Entièrement traité et prêt | État final |
| `skip` | Pas d'embedding nécessaire (fichier binaire, etc.) | État final |
| `error` | Erreur avec sous-type (parse/link/embed) | → retry vers état précédent |

### Propriétés Neo4j sur chaque Node

```cypher
// Propriétés d'état (sur TOUS les nodes: Scope, File, MarkdownSection, etc.)
{
  // État principal
  _state: "pending" | "parsing" | "parsed" | "linking" | "linked" | "embedding" | "ready" | "skip" | "error",
  _stateChangedAt: datetime(),

  // Erreur (si _state = "error")
  _errorType: "parse" | "link" | "embed" | null,
  _errorMessage: string | null,
  _retryCount: integer,

  // Timestamps de progression
  _detectedAt: datetime(),
  _parsedAt: datetime() | null,
  _linkedAt: datetime() | null,
  _embeddedAt: datetime() | null,

  // Hash du contenu pour détecter les changements
  _contentHash: string,

  // Info embedding (pour détecter changement de provider/model)
  _embeddingProvider: string | null,
  _embeddingModel: string | null,
  _embeddingHash: string | null   // Hash du contenu utilisé pour l'embedding
}
```

**Note**: Préfixe `_` pour distinguer les propriétés de gestion des propriétés métier.

---

## Transitions Valides

```typescript
const VALID_TRANSITIONS: Record<NodeState, NodeState[]> = {
  'pending':   ['parsing', 'skip'],
  'parsing':   ['parsed', 'error'],
  'parsed':    ['linking'],
  'linking':   ['linked', 'error'],
  'linked':    ['embedding', 'skip'],
  'embedding': ['ready', 'error'],
  'ready':     ['pending'],  // Reset si contenu changé
  'skip':      ['pending'],  // Reset si contenu changé
  'error':     ['pending'],  // Retry
};
```

---

## API de la State Machine

### `NodeStateMachine` (classe principale)

```typescript
class NodeStateMachine {
  constructor(neo4jClient: Neo4jClient) {}

  // Transition d'état
  async transition(
    nodeUuid: string,
    nodeLabel: string,  // "Scope", "File", "MarkdownSection", etc.
    newState: NodeState,
    options?: {
      errorType?: ErrorType;
      errorMessage?: string;
      contentHash?: string;
      embeddingProvider?: string;
      embeddingModel?: string;
    }
  ): Promise<boolean>;

  // Batch transition (pour efficacité)
  async transitionBatch(
    transitions: Array<{
      uuid: string;
      label: string;
      state: NodeState;
      options?: TransitionOptions;
    }>
  ): Promise<number>;

  // Query par état
  async getNodesByState(
    state: NodeState,
    options?: {
      label?: string;        // Filtrer par type de node
      projectId?: string;    // Filtrer par projet
      limit?: number;
      errorType?: ErrorType; // Si state = 'error'
    }
  ): Promise<NodeStateInfo[]>;

  // Compter par état (pour dashboard/monitoring)
  async countByState(
    projectId?: string
  ): Promise<Record<NodeState, number>>;

  // Reset nodes en erreur pour retry
  async retryErrors(
    options?: {
      errorType?: ErrorType;
      maxRetries?: number;
      projectId?: string;
    }
  ): Promise<number>;

  // Reset un node si son contenu a changé
  async markChanged(
    nodeUuid: string,
    newContentHash: string
  ): Promise<boolean>;

  // Batch mark changed
  async markChangedBatch(
    changes: Array<{ uuid: string; contentHash: string }>
  ): Promise<number>;
}
```

---

## Intégration avec l'Orchestrator

L'orchestrator utilisera la state machine à chaque étape:

```typescript
class IngestionOrchestrator {
  async reingest(changes: FileChange[]): Promise<IngestionStats> {
    // 1. Marquer tous les nodes comme "pending" (reset si changé)
    for (const change of changes) {
      await this.stateMachine.markChanged(change.path, newHash);
    }

    // 2. Parsing
    const pendingNodes = await this.stateMachine.getNodesByState('pending');
    for (const node of pendingNodes) {
      await this.stateMachine.transition(node.uuid, node.label, 'parsing');
      try {
        await this.parseNode(node);
        await this.stateMachine.transition(node.uuid, node.label, 'parsed');
      } catch (error) {
        await this.stateMachine.transition(node.uuid, node.label, 'error', {
          errorType: 'parse',
          errorMessage: error.message
        });
      }
    }

    // 3. Linking
    const parsedNodes = await this.stateMachine.getNodesByState('parsed');
    // ...

    // 4. Embedding
    const linkedNodes = await this.stateMachine.getNodesByState('linked');
    // ...
  }
}
```

---

## Queries Utiles

### Trouver les nodes bloqués (en erreur)

```cypher
MATCH (n)
WHERE n._state = 'error'
RETURN labels(n)[0] AS type, n._errorType AS errorType,
       count(n) AS count, collect(n.uuid)[0..5] AS samples
ORDER BY count DESC
```

### Progress d'un projet

```cypher
MATCH (n {projectId: $projectId})
WHERE n._state IS NOT NULL
RETURN n._state AS state, count(n) AS count
ORDER BY
  CASE n._state
    WHEN 'pending' THEN 1
    WHEN 'parsing' THEN 2
    WHEN 'parsed' THEN 3
    WHEN 'linking' THEN 4
    WHEN 'linked' THEN 5
    WHEN 'embedding' THEN 6
    WHEN 'ready' THEN 7
    WHEN 'skip' THEN 8
    WHEN 'error' THEN 9
  END
```

### Nodes prêts pour embedding

```cypher
MATCH (n {projectId: $projectId})
WHERE n._state = 'linked'
RETURN n.uuid, labels(n)[0] AS type, n.name
LIMIT 100
```

### Retry des erreurs de parsing

```cypher
MATCH (n)
WHERE n._state = 'error'
  AND n._errorType = 'parse'
  AND n._retryCount < 3
SET n._state = 'pending',
    n._stateChangedAt = datetime()
RETURN count(n) AS retriedCount
```

---

## Migration

### Phase 1: Ajouter les propriétés d'état

```cypher
// Migrer les nodes existants vers le nouveau système
// Les nodes avec embeddingsDirty=true → state='linked'
// Les nodes avec embeddings existants → state='ready'
// Les autres → state='pending'

MATCH (n:Scope)
SET n._state = CASE
  WHEN n.embedding_content IS NOT NULL THEN 'ready'
  WHEN n.embeddingsDirty = true THEN 'linked'
  ELSE 'pending'
END,
n._stateChangedAt = datetime(),
n._detectedAt = coalesce(n.createdAt, datetime()),
n._contentHash = coalesce(n.contentHash, '')
RETURN count(n) AS migrated
```

### Phase 2: Supprimer les anciens flags

Une fois la migration validée, supprimer:
- `embeddingsDirty`
- `schemaDirty`

---

## Fichiers à créer/modifier

### Nouveaux fichiers

| Fichier | Description |
|---------|-------------|
| `packages/core/src/ingestion/node-state-machine.ts` | Classe principale |
| `packages/core/src/ingestion/state-types.ts` | Types et constantes |

### Fichiers à modifier

| Fichier | Changements |
|---------|-------------|
| `orchestrator.ts` | Utiliser la state machine |
| `metadata-preserver.ts` | Capturer/restaurer `_state` |
| `embedding-service.ts` | Remplacer `embeddingsDirty` par `_state='linked'` |
| `incremental-ingestion.ts` | Transitions d'état après parsing |
| `brain-tools.ts` | Exposer état dans `get_brain_status` |

---

## Tests

1. **Transition valide** - Vérifier que seules les transitions valides sont acceptées
2. **Persistence** - Vérifier que l'état survit à un redémarrage
3. **Batch** - Vérifier les performances des opérations batch
4. **Recovery** - Simuler un crash et vérifier la reprise
5. **Migration** - Vérifier que les anciens nodes sont correctement migrés
