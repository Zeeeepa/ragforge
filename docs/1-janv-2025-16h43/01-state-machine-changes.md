# 01 - State Machine Changes

## État actuel

**Fichier:** `packages/core/src/brain/file-state-machine.ts`

```typescript
export type FileState =
  | 'discovered'  // Détecté, en attente de parsing
  | 'parsing'     // En cours de parsing
  | 'parsed'      // Nodes créés, en attente de relations
  | 'relations'   // Création des relations cross-file
  | 'linked'      // Relations créées, prêt pour embeddings
  | 'embedding'   // Génération des embeddings en cours
  | 'embedded'    // Complètement traité
  | 'error'       // Échec à une étape
  | 'mentioned';  // Référencé mais pas encore accédé
```

**Transitions actuelles:**
```
discovered → parsing → parsed → relations → linked → embedding → embedded
     ↓                                ↓               ↓
   error                           error           error
```

## Nouvel état: `schema-ready`

### Définition

```typescript
export type FileState =
  | 'discovered'    // Détecté, en attente de parsing
  | 'parsing'       // En cours de parsing
  | 'parsed'        // Nodes créés, en attente de relations
  | 'relations'     // Création des relations cross-file
  | 'linked'        // Relations créées (transitoire)
  | 'schema-ready'  // NOUVEAU: Schema complet, pas d'embeddings
  | 'embedding'     // Génération des embeddings en cours
  | 'embedded'      // Complètement traité
  | 'error'
  | 'mentioned';
```

### Nouvelles transitions

```
                SCHEMA-ONLY PATH (auto, rapide)
                ================================
discovered → parsing → parsed → relations → linked → schema-ready (STOP)
                                                            │
                                                            │ (on-demand)
                                                            ▼
                                   EMBEDDING PATH (on-demand, lent)
                                   ================================
                                               embedding → embedded
```

### Règles de transition

```typescript
const VALID_TRANSITIONS: Record<FileState, FileState[]> = {
  discovered:    ['parsing', 'skip'],
  parsing:       ['parsed', 'error'],
  parsed:        ['relations'],
  relations:     ['linked', 'error'],
  linked:        ['schema-ready'],              // MODIFIÉ: linked → schema-ready
  'schema-ready': ['embedding', 'discovered'],  // NOUVEAU: peut passer à embedding ou reset
  embedding:     ['embedded', 'error'],
  embedded:      ['discovered'],                // Reset si contenu changé
  skip:          ['discovered'],
  error:         ['discovered'],                // Retry
  mentioned:     ['discovered'],                // Accédé directement
};
```

## Modifications requises

### 1. `file-state-machine.ts`

```typescript
// Ajouter le type
export type FileState =
  // ... existants ...
  | 'schema-ready'  // Nouveau

// Mettre à jour VALID_TRANSITIONS
linked: ['schema-ready'],  // Au lieu de ['embedding', 'skip']
'schema-ready': ['embedding', 'discovered'],

// Ajouter helper
async getSchemaReadyFiles(projectId: string): Promise<FileStateInfo[]> {
  return this.getFilesInState(projectId, 'schema-ready');
}

async queueForEmbedding(fileUuids: string[]): Promise<void> {
  // Marquer des fichiers schema-ready pour embedding
  await this.transitionBatch(fileUuids, 'embedding');
}
```

### 2. `state-types.ts`

```typescript
// Ajouter au NodeState universel
export type NodeState =
  // ... existants ...
  | 'schema-ready';  // Nouveau terminal state
```

### 3. `file-processor.ts`

```typescript
// Changer la transition finale
// AVANT:
await this.stateMachine.transitionBatch(fileUuids, 'linked');

// APRÈS:
await this.stateMachine.transitionBatch(fileUuids, 'schema-ready');
```

### 4. `brain-manager.ts` - `startWatching`

```typescript
// SUPPRIMER le callback afterIngestion qui génère des embeddings
afterIngestion: async (stats) => {
  // NE PLUS générer automatiquement les embeddings
  // Les embeddings seront générés on-demand via la queue de priorité

  // Émettre un événement pour notifier que des fichiers sont prêts
  if (stats.created + stats.updated > 0) {
    this.emit('schema-ready', {
      projectId,
      filesCount: stats.created + stats.updated,
    });
  }
},
```

### 5. `embedding-coordinator.ts`

```typescript
// Modifier pour chercher 'schema-ready' au lieu de 'linked'
async embedProject(projectId: string): Promise<EmbedProjectResult> {
  // Chercher fichiers en schema-ready
  const readyFiles = await this.stateMachine.getFilesInState(projectId, 'schema-ready');

  // Transition vers embedding
  await this.stateMachine.transitionBatch(uuids, 'embedding');

  // Générer embeddings...

  // Transition vers embedded
  await this.stateMachine.transitionBatch(uuids, 'embedded');
}
```

## Sémantique des états

| État | Signification | Dependency Trees | brain_search |
|------|---------------|------------------|--------------|
| `discovered` | Détecté, pas encore parsé | ❌ | ❌ |
| `parsing` | En cours de parsing | ❌ | ❌ |
| `parsed` | AST extrait, nodes créés | ❌ | ❌ |
| `relations` | Relations en cours | ❌ | ❌ |
| `linked` | Relations créées (transitoire) | ⚠️ | ❌ |
| `schema-ready` | **TERMINAL** - Schema complet | ✅ | ❌ |
| `embedding` | Génération embeddings | ✅ | ❌ |
| `embedded` | **TERMINAL** - Tout complet | ✅ | ✅ |

## Questions de design

### Q1: Faut-il garder `linked` comme état intermédiaire?

**Option A:** Supprimer `linked`, aller directement de `relations` à `schema-ready`
- Pro: Plus simple
- Con: Perd la granularité

**Option B:** Garder `linked` comme état transitoire très court
- Pro: Compatibilité avec code existant
- Con: Un état de plus

**Recommandation:** Option B - garder `linked` comme micro-état transitoire pour faciliter la migration.

### Q2: Comment gérer le reset après changement de contenu?

```
schema-ready + contenu changé → discovered (re-parse seulement)
embedded + contenu changé → discovered (re-parse + possiblement re-embed)
```

Le fichier retourne à `discovered` et repasse par le pipeline. S'il était `embedded` avant, on pourrait vouloir le re-embed automatiquement - à définir via une queue de priorité.

### Q3: Comment savoir si un fichier a besoin d'embeddings?

Options:
1. Flag explicite `needsEmbedding: boolean`
2. Présence dans une queue d'embeddings
3. Accès via grep/read déclenche l'ajout à la queue

**Recommandation:** Option 3 - les fichiers accédés sont automatiquement ajoutés à la queue d'embeddings.
