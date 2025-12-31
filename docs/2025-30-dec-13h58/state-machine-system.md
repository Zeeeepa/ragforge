# Système de Machine à États pour l'Ingestion

**Date**: 30 décembre 2025
**Version**: 1.0

## Vue d'ensemble

Le système de machine à états gère le cycle de vie de tous les nodes dans le pipeline d'ingestion. Il remplace les anciens flags booléens (`embeddingsDirty`, `schemaDirty`) par un système d'états persisté en Neo4j.

### Avantages

| Ancien système | Nouveau système |
|----------------|-----------------|
| Flags booléens éparpillés | États centralisés et typés |
| Pas de traçabilité | Timestamps à chaque étape |
| Pas de reprise après crash | États persistés en BDD |
| Debug difficile | Queries par état + erreurs détaillées |

---

## Architecture

### Diagramme des États

```
                              ┌─────────┐
                              │  ERROR  │
                              │ (parse) │
                              └────▲────┘
                                   │
┌─────────┐    ┌─────────┐    ┌────┴────┐    ┌─────────┐
│ PENDING │───►│ PARSING │───►│ PARSED  │───►│ LINKING │
└────┬────┘    └─────────┘    └─────────┘    └────┬────┘
     │                                            │
     │                                            ▼
     │                                       ┌─────────┐
     │                                       │  ERROR  │
     │                                       │ (link)  │
     │                                       └────▲────┘
     │                                            │
     │         ┌─────────┐    ┌─────────┐    ┌────┴────┐
     │         │  READY  │◄───│EMBEDDING│◄───│ LINKED  │
     │         └─────────┘    └────┬────┘    └────┬────┘
     │              ▲              │              │
     │              │              ▼              ▼
     │              │         ┌─────────┐    ┌─────────┐
     └──────────────┴─────────│  ERROR  │    │  SKIP   │
        (reset si changé)     │ (embed) │    │(no emb) │
                              └─────────┘    └─────────┘
```

### Définition des États

| État | Description | Transitions possibles |
|------|-------------|----------------------|
| `pending` | Node détecté, en attente de traitement | → `parsing`, `skip` |
| `parsing` | Parsing du contenu en cours | → `parsed`, `error` |
| `parsed` | Parsing terminé, en attente de linking | → `linking` |
| `linking` | Création des relations (CONSUMES, etc.) | → `linked`, `error` |
| `linked` | Relations créées, prêt pour embedding | → `embedding`, `skip` |
| `embedding` | Génération des embeddings en cours | → `ready`, `error` |
| `ready` | Entièrement traité | → `pending` (si contenu changé) |
| `skip` | Pas d'embedding nécessaire | → `pending` (si contenu changé) |
| `error` | Erreur avec sous-type | → `pending` (retry) |

### Types d'Erreurs

| Type | Description | Exemple |
|------|-------------|---------|
| `parse` | Erreur lors du parsing | Syntaxe invalide, fichier corrompu |
| `link` | Erreur lors du linking | Import non résolu, cycle détecté |
| `embed` | Erreur lors de l'embedding | API timeout, quota dépassé |

---

## Propriétés Neo4j

Chaque node stateful possède ces propriétés (préfixées `_` pour éviter les conflits):

```typescript
interface NodeStateProperties {
  // État principal
  _state: 'pending' | 'parsing' | 'parsed' | 'linking' | 'linked' | 'embedding' | 'ready' | 'skip' | 'error';
  _stateChangedAt: DateTime;

  // Erreur (si _state = 'error')
  _errorType: 'parse' | 'link' | 'embed' | null;
  _errorMessage: string | null;
  _retryCount: number;

  // Timestamps de progression
  _detectedAt: DateTime;
  _parsedAt: DateTime | null;
  _linkedAt: DateTime | null;
  _embeddedAt: DateTime | null;

  // Hash du contenu (pour détecter les changements)
  _contentHash: string;

  // Info embedding
  _embeddingProvider: string | null;  // 'gemini', 'ollama'
  _embeddingModel: string | null;     // 'text-embedding-004', 'nomic-embed-text'
}
```

### Types de Nodes Supportés

```typescript
const STATEFUL_NODE_LABELS = [
  'Scope',           // Fonctions, classes, méthodes
  'File',            // Fichiers source
  'MarkdownDocument',// Documents markdown
  'MarkdownSection', // Sections de markdown
  'CodeBlock',       // Blocs de code dans markdown
  'DataFile',        // JSON, YAML, XML
  'ImageFile',       // Images
  'ThreeDFile',      // Modèles 3D
  'DocumentFile',    // PDF, DOCX, XLSX
  'WebPage',         // Pages web crawlées
  'Stylesheet',      // CSS, SCSS
  'VueSFC',          // Composants Vue
  'SvelteComponent', // Composants Svelte
];
```

---

## API: NodeStateMachine

### Initialisation

```typescript
import { NodeStateMachine } from '@luciformresearch/ragforge';

const stateMachine = new NodeStateMachine(neo4jClient);
```

### Transition d'état

```typescript
// Transition simple
await stateMachine.transition(
  'uuid-123',
  'Scope',
  'parsed',
  { contentHash: 'abc123' }
);

// Transition avec erreur
await stateMachine.transition(
  'uuid-456',
  'File',
  'error',
  {
    errorType: 'parse',
    errorMessage: 'Syntax error at line 42'
  }
);

// Transition batch (plus efficace)
await stateMachine.transitionBatch([
  { uuid: 'uuid-1', label: 'Scope', state: 'ready' },
  { uuid: 'uuid-2', label: 'Scope', state: 'ready' },
  { uuid: 'uuid-3', label: 'File', state: 'ready' },
]);
```

### Requêtes par état

```typescript
// Obtenir tous les nodes en attente d'embedding
const linkedNodes = await stateMachine.getNodesByState('linked', {
  projectId: 'my-project',
  label: 'Scope',
  limit: 100
});

// Compter par état
const counts = await stateMachine.countByState('my-project');
// { pending: 5, parsing: 0, parsed: 2, linking: 0, linked: 10, embedding: 0, ready: 150, skip: 3, error: 1 }

// Statistiques détaillées
const stats = await stateMachine.getProjectStats('my-project');
// { counts, errorsByType: { parse: 0, link: 1, embed: 0 }, averageRetryCount: 1.5, oldestPending: Date }
```

### Gestion des erreurs

```typescript
// Retry tous les nodes en erreur
const retried = await stateMachine.retryErrors({
  projectId: 'my-project',
  maxRetries: 3,           // Skip si déjà 3 tentatives
  errorType: 'embed'       // Seulement les erreurs d'embedding
});

// Voir l'état d'un node spécifique
const state = await stateMachine.getNodeState('uuid-123', 'Scope');
```

### Détection de changements

```typescript
// Marquer un node comme changé (reset vers pending si hash différent)
await stateMachine.markChanged('uuid-123', 'Scope', 'new-content-hash');

// Batch mark changed
await stateMachine.markChangedBatch([
  { uuid: 'uuid-1', label: 'Scope', contentHash: 'hash-1' },
  { uuid: 'uuid-2', label: 'File', contentHash: 'hash-2' },
]);
```

---

## Intégration avec EmbeddingService

L'EmbeddingService utilise la machine à états pour:

1. **Filtrer les nodes à embedder**: Query `WHERE _state = 'linked'`
2. **Marquer comme terminé**: Transition vers `ready` après embedding

```typescript
// Configuration
const embeddingService = new EmbeddingService(neo4jClient, providerConfig);
embeddingService.setStateMachine(stateMachine);

// Génération d'embeddings (utilise automatiquement _state)
const result = await embeddingService.generateMultiEmbeddings({
  projectId: 'my-project',
  verbose: true
});
```

### Flux d'embedding

```
1. Query: MATCH (n:Scope) WHERE n._state = 'linked'
2. Pour chaque node:
   - Extraire le texte (name, content, description)
   - Générer les embeddings
   - Sauvegarder avec SET n._state = 'ready', n._embeddedAt = datetime()
```

---

## Pipeline d'Ingestion Complet

```
┌──────────────────────────────────────────────────────────────────┐
│                        FLUX D'INGESTION                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. DÉTECTION                                                    │
│     └─► Fichier créé/modifié                                     │
│         └─► Node créé avec _state = 'pending'                    │
│                                                                  │
│  2. PARSING                                                      │
│     └─► _state = 'parsing'                                       │
│         └─► Parser le contenu (AST, sections, etc.)              │
│             └─► Succès: _state = 'parsed'                        │
│             └─► Échec: _state = 'error', _errorType = 'parse'    │
│                                                                  │
│  3. LINKING                                                      │
│     └─► _state = 'linking'                                       │
│         └─► Créer les relations (CONSUMES, INHERITS, etc.)       │
│             └─► Succès: _state = 'linked'                        │
│             └─► Échec: _state = 'error', _errorType = 'link'     │
│                                                                  │
│  4. EMBEDDING                                                    │
│     └─► _state = 'embedding'                                     │
│         └─► Générer embedding_name, embedding_content, etc.      │
│             └─► Succès: _state = 'ready'                         │
│             └─► Échec: _state = 'error', _errorType = 'embed'    │
│             └─► Skip (binaire): _state = 'skip'                  │
│                                                                  │
│  5. RE-INGESTION (si fichier modifié)                           │
│     └─► Comparer _contentHash avec nouveau hash                  │
│         └─► Si différent: _state = 'pending' (recommence)        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Queries Cypher Utiles

### Voir la progression d'un projet

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

### Trouver les nodes en erreur

```cypher
MATCH (n {projectId: $projectId})
WHERE n._state = 'error'
RETURN labels(n)[0] AS type,
       n._errorType AS errorType,
       n._errorMessage AS message,
       n._retryCount AS retries,
       n.name AS name,
       n.file AS file
ORDER BY n._retryCount DESC
LIMIT 50
```

### Nodes bloqués (en cours depuis trop longtemps)

```cypher
MATCH (n {projectId: $projectId})
WHERE n._state IN ['parsing', 'linking', 'embedding']
  AND n._stateChangedAt < datetime() - duration('PT5M')  // > 5 minutes
RETURN n.uuid, labels(n)[0] AS type, n._state AS state,
       n._stateChangedAt AS stuckSince
```

### Reset manuel vers pending

```cypher
MATCH (n {projectId: $projectId})
WHERE n._state = 'error' AND n._retryCount < 3
SET n._state = 'pending',
    n._stateChangedAt = datetime(),
    n._errorType = null,
    n._errorMessage = null
RETURN count(n) AS reset
```

### Statistiques d'embedding par provider

```cypher
MATCH (n {projectId: $projectId})
WHERE n._state = 'ready'
RETURN n._embeddingProvider AS provider,
       n._embeddingModel AS model,
       count(n) AS count
ORDER BY count DESC
```

---

## Migration depuis l'ancien système

Pour migrer des nodes existants (avec `embeddingsDirty`) vers le nouveau système:

```cypher
// Nodes avec embeddings existants → ready
MATCH (n)
WHERE n.embeddingsDirty IS NOT NULL
  AND n._state IS NULL
  AND n.embedding_content IS NOT NULL
SET n._state = 'ready',
    n._stateChangedAt = datetime(),
    n._embeddedAt = datetime()
RETURN count(n) AS migratedToReady;

// Nodes dirty → linked (prêts pour embedding)
MATCH (n)
WHERE n.embeddingsDirty = true
  AND n._state IS NULL
SET n._state = 'linked',
    n._stateChangedAt = datetime(),
    n._linkedAt = datetime()
RETURN count(n) AS migratedToLinked;

// Autres nodes → pending
MATCH (n)
WHERE n.embeddingsDirty IS NOT NULL
  AND n._state IS NULL
SET n._state = 'pending',
    n._stateChangedAt = datetime(),
    n._detectedAt = datetime()
RETURN count(n) AS migratedToPending;
```

---

## Fichiers Clés

| Fichier | Description |
|---------|-------------|
| `packages/core/src/ingestion/state-types.ts` | Types, constantes, utilitaires |
| `packages/core/src/ingestion/node-state-machine.ts` | Classe NodeStateMachine |
| `packages/core/src/brain/embedding-service.ts` | Intégration avec embeddings |
| `packages/core/src/brain/brain-manager.ts` | Accès via `brain.stateMachine` |

---

## Bonnes Pratiques

1. **Toujours utiliser la state machine** pour les transitions, jamais de SET direct sur `_state`
2. **Batch les transitions** quand possible pour la performance
3. **Monitorer les erreurs** régulièrement avec `getProjectStats()`
4. **Limiter les retries** (max 3 par défaut) pour éviter les boucles infinies
5. **Utiliser `_contentHash`** pour détecter les vrais changements
