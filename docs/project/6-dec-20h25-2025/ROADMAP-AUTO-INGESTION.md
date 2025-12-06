# Roadmap: Auto-Ingestion & Web Project Generation

**Date:** 6 décembre 2025, 20h25
**Auteur:** Lucie + Claude

---

## Contexte

L'agent RagForge peut maintenant exécuter des tâches multi-étapes (create → write → ingest).
Cependant, il y a des problèmes :

1. **L'agent doit appeler `ingest_code` manuellement** après chaque modification
2. **`create_project` ne fait pas l'ingestion initiale des fichiers générés**
3. **L'incremental ingestion existe mais n'est pas câblé automatiquement**

### Ce qu'on veut

> L'agent crée un projet web complet (HTML/CSS/JS/TS) et le graph se met à jour automatiquement à chaque fichier modifié.

---

## Architecture Actuelle

```
┌─────────────────────────────────────────────────────────────┐
│  Agent demande: "Create webapp, write index.html, ingest"   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  create_project │ →  │   write_file    │ →  │   ingest_code   │
│  (no ingestion) │    │  (no sync)      │    │  (manual call)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Hooks existants (non utilisés)

```typescript
// Dans FileToolsContext - EXISTE DÉJÀ
onFileModified?: (filePath: string, changeType: 'created'|'updated'|'deleted') => Promise<void>;

// Dans IncrementalIngestionManager - EXISTE DÉJÀ
async reIngestFile(filePath: string, sourceConfig: SourceCodeConfig): Promise<IncrementalStats>

// Dans IngestionLock - EXISTE DÉJÀ
async acquire(filePath: string): Promise<() => void>  // Bloque les RAG queries
```

---

## Problèmes Identifiés

### 1. `create_project` ne fait pas l'ingestion initiale

**Actuellement:**
```
create_project → crée src/index.ts, package.json, etc.
                → lance quickstart (Neo4j + ingestion)
                → MAIS l'agent ne sait pas que c'est fait
```

**Problème:** Le quickstart fait l'ingestion, mais :
- Pas d'embeddings générés (GEMINI_API_KEY pas passé au sous-process)
- L'agent appelle encore `ingest_code` inutilement

### 2. `write_file` ne déclenche pas l'auto-ingestion

**Actuellement:**
```typescript
// agent.ts ligne ~690
onFileModified: async (filePath, changeType) => {
  // VIDE ou pas câblé correctement
}
```

**Ce qui devrait se passer:**
```typescript
onFileModified: async (filePath, changeType) => {
  const manager = new IncrementalIngestionManager(ctx.ragClient);
  await manager.reIngestFile(filePath, sourceConfig);
}
```

### 3. L'agent appelle `ingest_code` manuellement

Avec l'auto-ingestion, `ingest_code` deviendrait optionnel (pour force refresh ou batch).

---

## Roadmap

### Phase 1: Auto-ingestion après write_file/edit_file

**Objectif:** Chaque modification de fichier met à jour le graph automatiquement.

**Fichiers à modifier:**

1. **`packages/cli/src/commands/agent.ts`**
   - Câbler `onFileModified` dans `createIngestHandler`
   - Créer `IncrementalIngestionManager` au démarrage
   - Appeler `reIngestFile()` après chaque modification

2. **`packages/core/src/tools/file-tools.ts`**
   - S'assurer que `onFileModified` est bien appelé après write/edit
   - Retourner `rag_synced: true` avec les stats d'ingestion

**Code cible:**
```typescript
// Dans createRagForgeAgent()
const ingestionManager = new IncrementalIngestionManager(ctx.ragClient);

const fileToolsCtx: FileToolsContext = {
  projectRoot: () => ctx.currentProjectPath,
  onFileModified: async (filePath, changeType) => {
    if (!ctx.isProjectLoaded) return;

    const stats = await ingestionManager.reIngestFile(filePath, {
      root: ctx.currentProjectPath,
      adapter: 'typescript', // ou auto-detect
    });

    if (verbose) {
      console.log(`   📊 Auto-ingested: +${stats.created} ~${stats.updated}`);
    }
  },
};
```

### Phase 2: create_project fait l'ingestion + embeddings

**Objectif:** Après `create_project`, le graph est prêt avec embeddings.

**Changements:**

1. **Passer `GEMINI_API_KEY` au quickstart subprocess**
2. **Activer `--embeddings` par défaut dans quickstart**
3. **Retourner les stats d'ingestion dans la réponse de `create_project`**

**Réponse enrichie:**
```typescript
{
  success: true,
  projectPath: "/tmp/myapp",
  ingestion: {
    files: 3,
    scopes: 5,
    embeddings: true
  }
}
```

### Phase 3: Rendre ingest_code optionnel

**Objectif:** L'agent n'a plus besoin d'appeler `ingest_code` après chaque fichier.

**Changements:**

1. **Modifier la description de `ingest_code`:**
   ```
   "Re-ingest all code (useful for batch updates or fixing sync issues).
   NOTE: Individual file changes are auto-ingested by write_file/edit_file."
   ```

2. **Ajouter option `force: true` pour full re-ingestion**

3. **Supprimer `ingest_code` des exemples de prompts**

### Phase 4: Projet Web Complet

**Objectif:** L'agent crée un projet web fonctionnel avec HTML/CSS/JS.

**Nouveau template `web` pour create_project:**
```
mywebapp/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── .ragforge/
```

**Test case:**
```
"Create a web project called portfolio with:
 - index.html with a hero section
 - style.css with modern styling
 - app.js with smooth scroll"
```

---

## Ordre d'Implémentation

| # | Tâche | Complexité | Status |
|---|-------|------------|--------|
| 1 | Câbler `onFileModified` → `reIngestFile` | Medium | 🔲 TODO |
| 2 | Tester auto-ingestion avec write_file | Low | 🔲 TODO |
| 3 | Passer GEMINI_API_KEY à quickstart | Low | ✅ DONE |
| 4 | Passer REPLICATE_API_TOKEN à quickstart | Low | ✅ DONE |
| 5 | Activer embeddings dans create_project | Low | ✅ DONE (déjà true par défaut) |
| 6 | Unifier patterns via YAML defaults | Medium | ✅ DONE |
| 7 | Modifier description de ingest_code | Low | 🔲 TODO |
| 8 | Ajouter template `web` à create_project | Medium | 🔲 TODO |
| 9 | Test E2E: projet web complet | High | 🔲 TODO |

### Changements effectués (6 dec 2025 ~21h)

**Fichiers modifiés:**
- `packages/cli/src/commands/quickstart.ts` - Priorité aux options passées pour geminiKey/replicateToken
- `packages/cli/src/commands/create.ts` - Ajout geminiKey/replicateToken à CreateOptions et passage à quickstart
- `packages/cli/src/commands/agent.ts` - Ajout geminiKey/replicateToken au contexte et passage à createProjectHandler

### Changements effectués (6 dec 2025 ~21h20)

**Unification des patterns d'ingestion via YAML defaults**

Le problème: `quickstart.ts` avait des patterns hardcodés (`src/**/*.ts`, etc.) qui ne correspondaient pas au template YAML `code-typescript.yaml` qui inclut HTML/CSS/Vue/Svelte etc.

**Solution:**
1. Supprimé les patterns hardcodés de `quickstart.ts` - maintenant `createMinimalConfig()` ne spécifie pas de patterns `include`
2. Le merger (`packages/core/src/config/merger.ts`) applique les defaults de `code-typescript.yaml`
3. Rendu `include` optionnel dans `SourceConfig` (`packages/core/src/types/config.ts`)
4. Corrigé les références TypeScript dans `code-generator.ts` pour gérer `include` optionnel

**Résultat:** Le config généré inclut maintenant automatiquement:
- `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx`, `**/*.mjs`, `**/*.mts`
- `**/*.html`, `**/*.htm`, `**/*.vue`, `**/*.svelte`, `**/*.astro`
- `**/*.css`, `**/*.scss`, `**/*.sass`, `**/*.less`
- `**/package.json`

**Fichiers modifiés:**
- `packages/cli/src/commands/quickstart.ts` - Suppression des patterns hardcodés, suppression de `isMonorepo()`
- `packages/core/src/types/config.ts` - `include` rendu optionnel
- `packages/core/src/generator/code-generator.ts` - Gestion du cas `include` undefined

---

## Métriques de Succès

1. **Auto-ingestion:** `write_file` retourne `rag_synced: true` avec stats
2. **create_project:** Retourne stats d'ingestion + embeddings
3. **Agent fluide:** Plus besoin d'appeler `ingest_code` après chaque fichier
4. **Projet web:** Agent peut créer HTML/CSS/JS en une seule requête

---

## Notes Techniques

### IncrementalIngestionManager

```typescript
// Méthodes clés
reIngestFile(filePath, config)  // Un seul fichier
ingestFromPaths(config, opts)   // Batch avec détection de changements
getDirtyScopes()                // Scopes qui ont besoin d'embeddings
markEmbeddingsClean(uuids)      // Après génération d'embeddings
```

### IngestionLock

```typescript
// Bloque les RAG queries pendant l'ingestion
const release = await lock.acquire(filePath);
try {
  await manager.reIngestFile(filePath, config);
} finally {
  release();
}
```

### Hash-based Change Detection

```typescript
// IncrementalIngestionManager compare les hashes
existing.hash !== newNode.hash → UPDATE
!existing                      → CREATE
existing && !newNode           → DELETE
existing.hash === newNode.hash → UNCHANGED
```

---

## Prochaine Session

Commencer par **Phase 1**: Câbler `onFileModified` pour déclencher l'auto-ingestion.
