# Plan: Refactorisation du Système d'Ingestion Incrémentale

**Dernière mise à jour**: 30 décembre 2025
**Statut**: En cours

## Contexte

Le système actuel d'ingestion incrémentale souffre de plusieurs problèmes:
- 4 modes d'ingestion avec sémantiques confuses (`true`, `'both'`, `'files'`, `'content'`, `false`)
- Logique de préservation UUID/embeddings dupliquée à 3+ endroits
- Flags booléens (`embeddingsDirty`, `schemaDirty`) éparpillés, difficiles à debugger
- Approche "delete + recreate + restore" complexe et fragile
- Pas de watcher pour les fichiers orphelins (lus via `read_file` mais hors projet)

## Objectifs

1. **State Machine universelle** - Un seul système de suivi d'état pour tous les nodes
2. **Update in place** - Plus de delete/recreate, on met à jour les nodes directement
3. **Suppression des flags legacy** - Plus de `embeddingsDirty`/`schemaDirty`
4. **Support fichiers orphelins** - Watcher pour fichiers individuels hors projets

---

## Changement de Paradigme

### AVANT: Delete + Recreate + Restore

```
1. Fichier modifié
2. Capturer UUIDs + embeddings des nodes existants
3. DETACH DELETE tous les nodes du fichier
4. Re-parser le fichier
5. CREATE nouveaux nodes (avec mêmes UUIDs)
6. Restaurer les embeddings capturés
7. Marquer embeddingsDirty = true si contenu changé
8. EmbeddingService traite les nodes dirty
```

**Problèmes:**
- Logique de capture/restore dupliquée
- Risque de perte de données si crash entre delete et restore
- Complexité inutile

### APRÈS: Update in Place + State Machine

```
1. Fichier modifié
2. Parser le nouveau contenu
3. Comparer avec les nodes existants (via _contentHash)
4. MERGE/UPDATE les nodes (pas de delete)
5. Si contenu changé → _state = 'pending' (re-parse) ou 'linked' (re-embed)
6. NodeStateMachine gère les transitions
7. EmbeddingService traite les nodes avec _state = 'linked'
```

**Avantages:**
- Pas de perte de données possible
- État toujours cohérent
- Logique centralisée dans la state machine
- Plus besoin de MetadataPreserver pour les embeddings

---

## Architecture Simplifiée

```
┌─────────────────────────────────────────────────────────────────┐
│                     Sources de Changements                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ ProjectWatcher│    │ OrphanWatcher│    │  ManualTrigger  │  │
│  │ (chokidar)    │    │ (chokidar)   │    │  (tools/API)    │  │
│  └──────┬───────┘    └──────┬───────┘    └────────┬─────────┘  │
│         │                    │                     │            │
│         └────────────────────┼─────────────────────┘            │
│                              ▼                                   │
│                    ┌─────────────────┐                          │
│                    │  ChangeQueue    │                          │
│                    │  (batching)     │                          │
│                    └────────┬────────┘                          │
│                             ▼                                   │
│         ┌───────────────────────────────────────┐               │
│         │       NodeStateMachine                │               │
│         │                                       │               │
│         │  pending → parsing → parsed →         │               │
│         │  linking → linked → embedding → ready │               │
│         │                                       │               │
│         │  Gère: états, timestamps, erreurs,    │               │
│         │        retries, content hashes        │               │
│         └───────────────────┬───────────────────┘               │
│                             ▼                                   │
│         ┌───────────────────────────────────────┐               │
│         │         EmbeddingService              │               │
│         │  Query: WHERE _state = 'linked'       │               │
│         │  After: SET _state = 'ready'          │               │
│         └───────────────────────────────────────┘               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Composants

### 1. NodeStateMachine ✅ FAIT

Gère le cycle de vie de tous les nodes. Voir `docs/state-machine-system.md`.

```typescript
class NodeStateMachine {
  transition(uuid, label, newState, options?)
  transitionBatch(transitions[])
  getNodesByState(state, options?)
  countByState(projectId?)
  retryErrors(options?)
  markChanged(uuid, label, newContentHash)
}
```

**États**: `pending` → `parsing` → `parsed` → `linking` → `linked` → `embedding` → `ready`

### 2. EmbeddingService ✅ MIGRÉ

Utilise maintenant `_state` au lieu de `embeddingsDirty`:
- Query: `WHERE _state = 'linked'`
- Après embedding: `SET _state = 'ready'`

### 3. ChangeQueue ✅ FAIT

Batching des changements de fichiers.

```typescript
class ChangeQueue {
  add(change: FileChange)
  flush(): FileChange[]
  onFlush(handler)
}
```

### 4. OrphanWatcher ✅ FAIT

Watch des fichiers individuels hors projets.

```typescript
class OrphanWatcher {
  watch(filePath)
  unwatch(filePath)
  getWatchedFiles()
}
```

### 5. ~~MetadataPreserver~~ ⚠️ SIMPLIFIÉ

Avec l'approche "update in place", on n'a plus besoin de capturer/restaurer les embeddings.
Le composant existe mais devient optionnel (pour cas edge de migration uniquement).

---

## Migration des Flags Legacy

### Occurrences à supprimer (~36)

| Fichier | Occurrences | Action |
|---------|-------------|--------|
| `incremental-ingestion.ts` | 12 | Remplacer par `_state` |
| `brain-manager.ts` | 10 | Remplacer par `_state` |
| `embedding-coordinator.ts` | 3 | Remplacer par `_state` |
| `file-processor.ts` | 1 | Remplacer par `_state` |
| `file-state-machine.ts` | 3 | Fusionner avec NodeStateMachine |
| `pipeline.ts` | 3 | Remplacer par `_state` |
| `query-builder.ts` | 1 | Remplacer par `_state` |
| `brain-tools.ts` | 2 | Remplacer par `_state` |
| `schema-version.ts` | 1 | Supprimer de la liste |

### Script de migration

```cypher
// 1. Nodes avec embeddings → ready
MATCH (n)
WHERE n.embeddingsDirty IS NOT NULL
  AND n._state IS NULL
  AND (n.embedding_content IS NOT NULL OR n.embedding_name IS NOT NULL)
SET n._state = 'ready',
    n._stateChangedAt = datetime(),
    n._embeddedAt = datetime()
RETURN count(n) AS migratedToReady;

// 2. Nodes dirty sans embeddings → linked
MATCH (n)
WHERE n.embeddingsDirty = true
  AND n._state IS NULL
  AND n.embedding_content IS NULL
SET n._state = 'linked',
    n._stateChangedAt = datetime()
RETURN count(n) AS migratedToLinked;

// 3. Autres → pending
MATCH (n)
WHERE n.embeddingsDirty IS NOT NULL
  AND n._state IS NULL
SET n._state = 'pending',
    n._stateChangedAt = datetime()
RETURN count(n) AS migratedToPending;

// 4. Supprimer les anciens flags
MATCH (n)
WHERE n.embeddingsDirty IS NOT NULL
REMOVE n.embeddingsDirty, n.schemaDirty
RETURN count(n) AS cleaned;
```

---

## Flux de Ré-ingestion Simplifié

```
1. Détection changement
   ├─ ProjectWatcher (chokidar sur dossier projet)
   ├─ OrphanWatcher (chokidar sur fichiers individuels)
   └─ ManualTrigger (mark_file_dirty, edit_file, etc.)
                │
                ▼
2. ChangeQueue.add(change)
   └─ Batching (1 seconde par défaut)
                │
                ▼
3. Pour chaque fichier modifié:
   │
   ├─ 3.1 Parser le nouveau contenu
   │       → Extraire scopes, sections, etc.
   │       → Calculer contentHash
   │
   ├─ 3.2 Comparer avec nodes existants
   │       → MATCH (n) WHERE n.file = $file
   │       → Comparer _contentHash
   │
   ├─ 3.3 Update in place
   │       → MERGE les nodes (pas de delete)
   │       → Si hash changé: _state = 'linked'
   │       → Si nouveau: _state = 'pending' puis transitions
   │
   └─ 3.4 State Machine gère le reste
          → pending → parsing → parsed → linking → linked
                │
                ▼
4. EmbeddingService.generateMultiEmbeddings()
   └─ Query: WHERE _state = 'linked'
   └─ Après: SET _state = 'ready'
```

---

## Phases d'Implémentation

### Phase 1: Composants de base ✅ FAIT
- [x] `state-types.ts` - Types et constantes
- [x] `node-state-machine.ts` - Classe principale
- [x] `change-queue.ts` - Batching
- [x] `orphan-watcher.ts` - Watch fichiers orphelins
- [x] `types.ts` - Types partagés

### Phase 2: Intégration EmbeddingService ✅ FAIT
- [x] Remplacer `embeddingsDirty` par `_state = 'linked'`
- [x] Transition vers `ready` après embedding
- [x] Supprimer toutes références `embeddingsDirty` dans embedding-service.ts

### Phase 3: Migration et Nettoyage 🔄 EN COURS
- [ ] Script de migration des nodes existants
- [ ] Remplacer `embeddingsDirty` dans `incremental-ingestion.ts`
- [ ] Remplacer `embeddingsDirty` dans `brain-manager.ts`
- [ ] Fusionner `file-state-machine.ts` avec `node-state-machine.ts`
- [ ] Supprimer les flags des autres fichiers

### Phase 4: Simplification du flux
- [ ] Implémenter "update in place" au lieu de "delete + recreate"
- [ ] Supprimer la logique de capture/restore d'embeddings
- [ ] Simplifier `reIngestFiles` → utilise state machine
- [ ] Supprimer les modes d'ingestion confus (`'both'`, `'files'`, `'content'`)

### Phase 5: Fichiers orphelins
- [ ] Intégrer OrphanWatcher dans le daemon
- [ ] `read_file` tool → déclenche watch automatique
- [ ] Persistance des fichiers watchés en Neo4j
- [ ] Cleanup automatique (7 jours sans accès)

---

## Règles d'Implémentation

### Règle 1: Pas de slice/trim sur le contenu pour les embeddings

```typescript
// ❌ MAUVAIS
const text = content.slice(0, maxLength);

// ✅ BON - Chunking sémantique
if (needsChunking(content, threshold)) {
  const chunks = chunkText(content, { chunkSize, overlap });
  for (const chunk of chunks) {
    await embedAndStore(chunk);
  }
}
```

### Règle 2: Toujours utiliser la state machine

```typescript
// ❌ MAUVAIS
await neo4j.run('MATCH (n) SET n.embeddingsDirty = true');

// ✅ BON
await stateMachine.transition(uuid, 'Scope', 'linked');
```

### Règle 3: UUID déterministes

Les UUIDs doivent être générés de manière déterministe (hash du chemin + signature) pour permettre le MERGE sans conflit.

---

## Configuration Fichiers Orphelins

| Paramètre | Valeur | Raison |
|-----------|--------|--------|
| **Rétention** | 7 jours | Cleanup auto après 7 jours sans accès |
| **Limite watch** | 100 fichiers | Évite surcharge mémoire |
| **Persistance** | Neo4j | Cohérent avec le reste du système |

---

## Types de Fichiers Supportés

| Catégorie | Extensions | Parser | Node Type |
|-----------|------------|--------|-----------|
| **Code** | .ts, .tsx, .js, .jsx, .py, .vue, .svelte | CodeSourceAdapter | Scope |
| **Markdown** | .md, .mdx | MarkdownParser | MarkdownDocument, MarkdownSection |
| **Documents** | .pdf, .docx, .xlsx | DocumentFileParser | DocumentFile |
| **Images** | .png, .jpg, .gif, .webp | MediaFileParser | ImageFile |
| **3D** | .glb, .gltf | MediaFileParser | ThreeDFile |
| **Data** | .json, .yaml, .xml | DataFileParser | DataFile |
| **Web** | .html, .css, .scss | HTMLParser/CSSParser | WebDocument, Stylesheet |

---

## Fichiers Clés

| Fichier | Rôle |
|---------|------|
| `ingestion/state-types.ts` | Types et constantes de la state machine |
| `ingestion/node-state-machine.ts` | Gestion des transitions d'état |
| `ingestion/change-queue.ts` | Batching des changements |
| `ingestion/orphan-watcher.ts` | Watch fichiers hors projets |
| `brain/embedding-service.ts` | Génération des embeddings |
| `brain/brain-manager.ts` | Orchestration générale |
| `runtime/adapters/incremental-ingestion.ts` | Parsing et ingestion |
