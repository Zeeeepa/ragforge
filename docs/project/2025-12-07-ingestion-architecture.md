# Architecture d'Ingestion - État Actuel (2025-12-07)

## Problème

L'architecture d'ingestion est fragmentée en **3 chemins différents** qui font des choses similaires mais de manière incohérente. Le change tracking (diffs) n'est pas unifié.

---

## 1. Couche Parsing (✅ OK - Déjà unifié)

```
UniversalSourceAdapter
    └── CodeSourceAdapter (adapter: 'auto')
            └── Détection automatique par extension :
                ├── .ts/.tsx/.js/.jsx  → TypeScript Parser  → Scope nodes
                ├── .py                → Python Parser      → Scope nodes
                ├── .vue               → Vue Parser         → VueSFC nodes
                ├── .svelte            → Svelte Parser      → SvelteComponent nodes
                ├── .html              → HTML Parser        → MarkupDocument nodes
                ├── .css/.scss         → CSS Parser         → Stylesheet nodes
                ├── .pdf/.docx/.xlsx   → Document Parser    → DocumentFile nodes
                ├── .json/.yaml        → Data Parser        → DataFile nodes
                ├── .png/.jpg/.gif     → Media Parser       → MediaFile (ImageFile) nodes
                ├── .glb/.gltf/.obj    → Media Parser       → MediaFile (ThreeDFile) nodes
                └── .md                → Markdown Parser    → MarkdownDocument nodes
```

**Fichiers concernés :**
- `packages/core/src/runtime/adapters/universal-source-adapter.ts`
- `packages/core/src/runtime/adapters/code-source-adapter.ts`

---

## 2. Couche Ingestion (❌ PROBLÉMATIQUE)

### 2.1. IncrementalIngestionManager (le plus complet)

**Fichier :** `packages/core/src/runtime/adapters/incremental-ingestion.ts`

**Fonctionnalités :**
- ✅ Détection incrémentale via hash de contenu
- ✅ Change tracking avec `ChangeTracker` (génère des diffs)
- ✅ Suppression des nœuds orphelins
- ✅ Marquage `embeddingsDirty` pour régénération
- ✅ Méthode `reIngestFile()` pour fichier unique
- ✅ Méthode `deleteNodesForFiles()` pour suppressions

**Limitation :**
- ❌ Utilise `CodeSourceAdapter` ou `TikaSourceAdapter` directement
- ❌ N'utilise PAS `UniversalSourceAdapter`

**Utilisé par :**
- `FileWatcher` + `IngestionQueue` (via callback)

---

### 2.2. BrainManager.quickIngest() (bypass)

**Fichier :** `packages/core/src/brain/brain-manager.ts` (lignes ~880-1120)

**Ce qu'il fait :**
- Parse avec `UniversalSourceAdapter` ✅
- Insert directement dans Neo4j avec UNWIND batching
- Gère l'incrémental via mtime des fichiers

**Problèmes :**
- ❌ N'utilise PAS `IncrementalIngestionManager`
- ❌ Pas de change tracking (pas de diffs)
- ❌ Code d'insertion Neo4j dupliqué

---

### 2.3. BrainManager.flushAgentEditQueue() (bypass)

**Fichier :** `packages/core/src/brain/brain-manager.ts` (lignes ~1665-1835)

**Ce qu'il fait :**
- Queue les édits de l'agent (write_file, edit_file)
- Parse avec `UniversalSourceAdapter`
- Insert directement dans Neo4j

**Problèmes :**
- ❌ N'utilise PAS `IncrementalIngestionManager`
- ❌ Pas de change tracking (pas de diffs)
- ❌ Code d'insertion Neo4j dupliqué (3ème fois!)

---

### 2.4. FileWatcher + IngestionQueue (correct)

**Fichiers :**
- `packages/core/src/runtime/adapters/file-watcher.ts`
- `packages/core/src/runtime/adapters/ingestion-queue.ts`

**Ce qu'il fait :**
- Surveille les changements de fichiers (chokidar)
- Batch les changements (1s par défaut)
- Utilise `IncrementalIngestionManager` ✅
- Supporte `trackChanges` option ✅

**Limitation :**
- Limité aux types supportés par `CodeSourceAdapter`

---

## 3. Tableau Récapitulatif

| Composant | Adapter utilisé | Change Tracking | Incrémental | Problème |
|-----------|-----------------|-----------------|-------------|----------|
| `IncrementalIngestionManager` | CodeSourceAdapter | ✅ Oui | ✅ Oui | Pas UniversalSourceAdapter |
| `BrainManager.quickIngest()` | UniversalSourceAdapter | ❌ Non | ✅ (mtime) | Bypass, pas de diffs |
| `BrainManager.flushAgentEditQueue()` | UniversalSourceAdapter | ❌ Non | ❌ Non | Bypass, pas de diffs |
| `FileWatcher` + `IngestionQueue` | via IncrementalIngestionManager | ✅ Oui | ✅ Oui | OK mais limité |

---

## 4. Architecture Cible

```
                    ┌─────────────────────────────────────┐
                    │        UniversalSourceAdapter       │
                    │   (parse TOUS les types de fichiers)│
                    └───────────────┬─────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │     IncrementalIngestionManager     │
                    │  - Détection changements (hash)     │
                    │  - Change tracking (diffs)  ✅      │
                    │  - Delete orphaned nodes            │
                    │  - Mark embeddingsDirty             │
                    └───────────────┬─────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐         ┌─────────────────┐         ┌───────────────┐
│ BrainManager  │         │   FileWatcher   │         │ Agent Tools   │
│ .quickIngest()│         │ + IngestionQueue│         │ (write/edit)  │
└───────────────┘         └─────────────────┘         └───────────────┘
```

---

## 5. Refactoring Complété ✅ (2025-12-07)

### Phase 1 : Unifier l'adapter ✅

- `IncrementalIngestionManager` utilise maintenant `UniversalSourceAdapter` via `getAdapter()`
- Singleton adapter pour réutilisation

### Phase 2 : Refactorer BrainManager.quickIngest() ✅

- Supprimé le code manuel d'insertion Neo4j (~150 lignes)
- Utilise `ingestionManager.ingestFromPaths()` avec `projectId` et `trackChanges: true`
- Change tracking automatique avec diffs

### Phase 3 : Refactorer BrainManager.flushAgentEditQueue() ✅

- Supprimé le code manuel d'insertion Neo4j (~100 lignes)
- Nouvelle méthode `IncrementalIngestionManager.reIngestFiles()` pour batch processing
- Utilise `trackChanges: true` par défaut

### Phase 4 : Support projectId ✅

- `IngestionOptions` type avec `projectId`, `trackChanges`, `verbose`, etc.
- `ingestFromPaths()` et `reIngestFiles()` supportent `projectId`
- Filtrage par `projectId` dans les requêtes Neo4j

---

## 6. Fichiers Modifiés ✅

| Fichier | Changements |
|---------|-------------|
| `incremental-ingestion.ts` | + `IngestionOptions` type, + `reIngestFiles()`, + support `projectId` |
| `brain-manager.ts` | Refactoré `quickIngest()` et `flushAgentEditQueue()` |
| `adapters/index.ts` | Supprimé export de `document/` (Tika), ajouté `document-file-parser.ts` |
| `quickstart.ts` (CLI) | Remplacé `TikaSourceAdapter` par `UniversalSourceAdapter` |

### Fichiers Supprimés ✅

| Fichier | Raison |
|---------|--------|
| `document/tika-source-adapter.ts` | Remplacé par `document-file-parser.ts` (web-compatible) |
| `document/tika-parser.ts` | Idem |
| `document/tika-server.d.ts` | Idem |
| `document/index.ts` | Plus nécessaire |
| `document/chunker.ts` | Plus utilisé |

---

## 7. Dépendances Existantes

### ChangeTracker (déjà générique)

```typescript
// Fonctionne avec n'importe quel type d'entité
async trackEntityChange(
  entityType: string,      // 'Scope', 'DocumentFile', 'MediaFile', etc.
  entityUuid: string,
  entityLabel: string,
  oldContent: string | null,
  newContent: string,
  oldHash: string | null,
  newHash: string,
  changeType: 'created' | 'updated' | 'deleted',
  metadata: Record<string, any>
)
```

### EmbeddingService (déjà multi-type)

```typescript
// Supporte déjà tous les types
const DEFAULT_EMBED_CONFIGS = [
  { nodeType: 'Scope', textFields: ['source'], ... },
  { nodeType: 'File', textFields: ['content'], ... },
  { nodeType: 'MarkdownDocument', textFields: ['content'], ... },
  { nodeType: 'DataFile', textFields: ['content'], ... },
  { nodeType: 'WebPage', textFields: ['textContent'], ... },
  { nodeType: 'MediaFile', textFields: ['description', 'ocrText'], ... },
  { nodeType: 'ThreeDFile', textFields: ['description'], ... },
  { nodeType: 'DocumentFile', textFields: ['content', 'ocrText'], ... },
];
```

---

## 8. Notes

- Le `ChangeTracker` crée des nœuds `Change` avec relation `HAS_CHANGE`
- Les diffs sont stockés au format unified diff
- Le hash de contenu permet la détection incrémentale
- L'`IngestionLock` bloque les requêtes RAG pendant l'ingestion

---

## 9. Multi-Embeddings par Noeud

### Problème

Actuellement, un seul embedding par noeud basé sur le contenu.
L'agent ne peut pas différencier :
- Recherche par **nom/signature** : "trouve les fonctions d'auth"
- Recherche par **contenu** : "trouve le code qui parse du JSON"

### Solution : Embeddings Multiples

Chaque noeud peut avoir **plusieurs vecteurs d'embedding** :

| Node Type | `embedding_name` | `embedding_content` | `embedding_description` |
|-----------|------------------|---------------------|-------------------------|
| **File** | `path`, `name` | `content` | - |
| **Scope** | `name`, `signature` | `source` | JSDoc/docstring |
| **DocumentFile** | `path`, `name` | `content` | metadata.title |
| **DataFile** | `path`, `name` | `content` | - |
| **ImageFile** | `path`, `name` | `ocrText` | `description` |
| **ThreeDFile** | `path`, `name` | - | `description` |
| **WebPage** | `url`, `title` | `textContent` | meta description |
| **MarkdownDocument** | `path`, `name` | `content` | h1 title |

### Schéma Neo4j

```cypher
// Chaque noeud a plusieurs propriétés embedding
(n:Scope {
  uuid: "...",
  name: "authenticate",
  signature: "async function authenticate(token: string): Promise<User>",
  source: "...",

  // Embeddings multiples
  embedding_name: [0.1, 0.2, ...],      // embedding de "authenticate"
  embedding_content: [0.3, 0.4, ...],   // embedding du source code
  embedding_description: [0.5, 0.6, ...] // embedding du JSDoc
})
```

### API de Recherche

```typescript
// L'agent peut spécifier quel embedding utiliser
brain_search({
  query: "authentication functions",
  embedding_type: "name"  // cherche dans embedding_name
})

brain_search({
  query: "JWT token validation",
  embedding_type: "content"  // cherche dans embedding_content
})

// Ou recherche combinée (défaut)
brain_search({
  query: "auth",
  embedding_type: "all"  // cherche dans tous, merge les résultats
})
```

### Configuration EmbeddingService

```typescript
const EMBEDDING_CONFIGS: EmbedNodeTypeConfig[] = [
  {
    nodeType: 'Scope',
    embeddings: [
      { name: 'embedding_name', fields: ['name', 'signature'] },
      { name: 'embedding_content', fields: ['source'] },
      { name: 'embedding_description', fields: ['description'] },
    ]
  },
  {
    nodeType: 'File',
    embeddings: [
      { name: 'embedding_name', fields: ['path'] },
      { name: 'embedding_content', fields: ['content'] },
    ]
  },
  // ... autres types
];
```

### Avantages

1. **Recherche précise** : l'agent peut cibler nom vs contenu
2. **Meilleur ranking** : les scores ne sont pas dilués par des champs non pertinents
3. **Flexibilité** : l'agent choisit la stratégie selon la question
4. **Combinable** : recherche "all" pour les cas généraux

---

## 10. Multi-Embeddings - Implémentation ✅ (2025-12-07)

### Fichiers Modifiés

| Fichier | Changements |
|---------|-------------|
| `embedding-service.ts` | + `MultiEmbedNodeTypeConfig`, `EmbeddingFieldConfig`, `EmbeddingType` types |
|                        | + `MULTI_EMBED_CONFIGS` (remplace `DEFAULT_EMBED_CONFIGS` pour multi) |
|                        | + `generateMultiEmbeddings()` méthode |
|                        | + `embedNodeTypeMulti()` private method |
|                        | + `getQueryEmbedding()` pour vector search |
| `brain-manager.ts` | + `embeddingType` option dans `BrainSearchOptions` |
|                    | + `vectorSearch()` private method avec cosine similarity |
|                    | + `cosineSimilarity()` fallback (sans GDS) |
| `brain-tools.ts` | + `embedding_type` paramètre dans `brain_search` tool |
| `brain/index.ts` | + exports des nouveaux types |

### Propriétés Neo4j par Type de Noeud

| Node Type | `embedding_name` | `embedding_content` | `embedding_description` |
|-----------|------------------|---------------------|-------------------------|
| **Scope** | signature, name | source | docstring |
| **File** | path | source | - |
| **MarkdownDocument** | title, path | rawText | title |
| **DataFile** | path | rawContent | - |
| **WebPage** | title, url | textContent | metaDescription |
| **MediaFile** | path | ocrText | description |
| **ThreeDFile** | path | - | description |
| **DocumentFile** | title, file | textContent | title |

### Utilisation

```typescript
// Recherche par nom de fichier / signature
brain_search({
  query: "authenticate",
  semantic: true,
  embedding_type: "name"  // cherche dans embedding_name
})

// Recherche par contenu de code
brain_search({
  query: "JWT token validation",
  semantic: true,
  embedding_type: "content"  // cherche dans embedding_content
})

// Recherche par documentation
brain_search({
  query: "user authentication flow",
  semantic: true,
  embedding_type: "description"  // cherche dans embedding_description
})

// Recherche combinée (défaut)
brain_search({
  query: "auth",
  semantic: true,
  embedding_type: "all"  // cherche dans tous, merge les résultats
})
```

### Vector Search Implementation

1. **Avec Neo4j GDS** (si disponible):
   - Utilise `gds.similarity.cosine()` pour calcul optimisé

2. **Fallback** (sans GDS):
   - Récupère tous les noeuds avec embeddings
   - Calcule cosine similarity en JavaScript
   - Filtre résultats > 0.5 similarité

### Backward Compatibility

- Le champ `embedding` legacy est toujours supporté
- `embedding_type: "all"` inclut aussi l'ancien champ `embedding`
- Les anciens embeddings continuent de fonctionner
