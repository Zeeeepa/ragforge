# Auto-Embeddings for Modified Scopes - Analysis

## 🔍 Current State

### What Works ✅
1. **Incremental Ingestion**: `IncrementalIngestionManager` marque les scopes modifiés avec `embeddingsDirty=true`
2. **Watch System**: Détecte les changements de fichiers et réingère automatiquement
3. **Embedding Generation**: Script existe pour générer les embeddings

### What's Missing ❌
**Le watch n'appelle PAS automatiquement la génération des embeddings!**

**Workflow actuel**:
```
1. Code change detected
2. FileWatcher → IncrementalIngestionManager
3. Scopes updated in Neo4j, marked embeddingsDirty=true
4. ❌ STOP - embeddings NOT generated
5. Manual: npm run embeddings:generate
```

**Workflow souhaité**:
```
1. Code change detected
2. FileWatcher → IncrementalIngestionManager
3. Scopes updated, marked embeddingsDirty=true
4. ✅ Auto-generate embeddings for dirty scopes only
5. Ready for queries with up-to-date data
```

---

## 🧪 Current Implementation

### `/scripts/watch.ts` (ligne 35-37)
```typescript
onBatchComplete: (stats) => {
  console.log(`✅ Batch complete: ${stats.created + stats.updated} scope(s) updated`);
  // ❌ No embedding generation here!
},
```

### `/scripts/generate-embeddings.ts`
Génère **TOUS** les embeddings, pas seulement les dirty:
```typescript
await runEmbeddingPipelines({
  neo4j: client,
  entity: { entity: entity.entity, pipelines: [pipeline] },
  provider,
  defaults: EMBEDDINGS_CONFIG.defaults
});
```

---

## 💡 Solution

### Option 1: Modifier watch.ts pour auto-générer (Recommandé)

**Avantages**:
- Embeddings toujours à jour
- Zéro intervention manuelle
- Workflow transparent

**Inconvénients**:
- Coût API si beaucoup de changements
- Latence supplémentaire après ingestion

**Implementation**:
```typescript
// watch.ts
import { runEmbeddingPipelines, GeminiEmbeddingProvider } from '@luciformresearch/ragforge-runtime';
import { EMBEDDINGS_CONFIG } from '../embeddings/load-config.ts';

onBatchComplete: async (stats) => {
  console.log(`✅ Batch complete: ${stats.created + stats.updated} scope(s) updated`);

  if (stats.created + stats.updated > 0) {
    console.log('🔄 Generating embeddings for modified scopes...');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('⚠️  GEMINI_API_KEY not set, skipping embeddings');
      return;
    }

    try {
      await generateEmbeddingsForDirtyScopes(rag.client, apiKey);
      console.log('✅ Embeddings generated');
    } catch (error) {
      console.error('❌ Embedding generation failed:', error);
    }
  }
},
```

### Option 2: Separate Embedding Watcher

**Avantages**:
- Séparation des concerns
- Peut batching plusieurs changements avant embedding
- Plus de contrôle sur le timing

**Inconvénients**:
- Plus complexe
- Deux processus à gérer

**Implementation**:
```typescript
// watch-embeddings.ts - separate process
setInterval(async () => {
  const dirtyCount = await countDirtyScopes();
  if (dirtyCount > 0) {
    console.log(`🔄 ${dirtyCount} scopes need embeddings...`);
    await generateEmbeddingsForDirtyScopes();
  }
}, 5000); // Check every 5s
```

### Option 3: On-Demand with Cache

**Avantages**:
- Embeddings générés seulement quand nécessaire
- Économie de coûts API

**Inconvénients**:
- Queries potentiellement sur données stale
- Complexité supplémentaire

---

## 🎯 Recommandation: Option 1 + Optimisation

**Modifier watch.ts** pour appeler l'embedding generation, MAIS:
1. **Query seulement les scopes dirty**: `MATCH (s:Scope {embeddingsDirty: true})`
2. **Batch intelligemment**: Si >50 scopes dirty, attendre plus de changements
3. **Rate limiting**: Max 1 génération par minute

### Implémentation Proposée

```typescript
// scripts/watch.ts - Enhanced
import { generateEmbeddingsForDirtyScopes } from './embeddings-helper.ts';

let lastEmbeddingGeneration = 0;
const EMBEDDING_DEBOUNCE = 60000; // 1 minute

onBatchComplete: async (stats) => {
  console.log(`✅ Batch complete: ${stats.created + stats.updated} scope(s) updated`);

  const now = Date.now();
  const timeSinceLastGen = now - lastEmbeddingGeneration;

  if (stats.created + stats.updated > 0 && timeSinceLastGen > EMBEDDING_DEBOUNCE) {
    console.log('🔄 Generating embeddings for modified scopes...');

    try {
      const count = await generateEmbeddingsForDirtyScopes(rag.client);
      console.log(`✅ Generated embeddings for ${count} scope(s)`);
      lastEmbeddingGeneration = now;
    } catch (error) {
      console.error('❌ Embedding generation failed:', error);
    }
  } else if (stats.created + stats.updated > 0) {
    console.log(`⏳ Embeddings queued (debouncing: ${Math.ceil((EMBEDDING_DEBOUNCE - timeSinceLastGen) / 1000)}s)`);
  }
},
```

```typescript
// scripts/embeddings-helper.ts - NEW
import { Neo4jClient, GeminiEmbeddingProvider, runEmbeddingPipelines } from '@luciformresearch/ragforge-runtime';
import { EMBEDDINGS_CONFIG } from '../embeddings/load-config.ts';

export async function generateEmbeddingsForDirtyScopes(
  client: Neo4jClient
): Promise<number> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY required');
  }

  // Count dirty scopes
  const result = await client.run(
    'MATCH (s:Scope {embeddingsDirty: true}) RETURN count(s) as count'
  );
  const dirtyCount = result.records[0]?.get('count').toNumber() || 0;

  if (dirtyCount === 0) {
    return 0;
  }

  console.log(`   Found ${dirtyCount} scope(s) needing embeddings`);

  // Generate embeddings only for dirty scopes
  for (const entity of EMBEDDINGS_CONFIG.entities) {
    for (const pipeline of entity.pipelines) {
      const provider = new GeminiEmbeddingProvider({
        apiKey,
        model: pipeline.model,
        dimension: pipeline.dimension
      });

      // Modified runEmbeddingPipelines to only process dirty scopes
      await runEmbeddingPipelines({
        neo4j: client,
        entity: { entity: entity.entity, pipelines: [pipeline] },
        provider,
        defaults: EMBEDDINGS_CONFIG.defaults,
        onlyDirty: true // NEW parameter
      });
    }
  }

  return dirtyCount;
}
```

---

## 🔧 Changes Required

### 1. Modifier `runEmbeddingPipelines` dans runtime
Ajouter support pour `onlyDirty: true`:
```typescript
// packages/runtime/src/embedding/pipeline.ts
export async function runEmbeddingPipelines(config: {
  // ... existing params
  onlyDirty?: boolean; // NEW
}) {
  // Build query with optional filter
  const dirtyFilter = config.onlyDirty ? '{embeddingsDirty: true}' : '';
  const query = `MATCH (n:${entity} ${dirtyFilter}) RETURN n LIMIT 1000`;

  // ... rest of logic

  // After successful embedding, mark as clean
  if (config.onlyDirty) {
    await neo4j.run(
      `MATCH (n:${entity} {uuid: $uuid})
       SET n.embeddingsDirty = false`,
      { uuid }
    );
  }
}
```

### 2. Créer `embeddings-helper.ts`
Script réutilisable pour générer seulement les dirty

### 3. Modifier `watch.ts`
Ajouter callback pour auto-embedding

---

## 📊 Testing Plan

1. **Test manuel**:
   ```bash
   # Terminal 1
   npm run watch

   # Terminal 2
   # Modifier un fichier source

   # Vérifier que:
   # - Ingestion auto
   # - Embeddings auto-générés
   # - Query retourne données à jour
   ```

2. **Test performance**:
   - Modifier 10 fichiers d'un coup
   - Vérifier batching intelligent
   - Temps total < 2 minutes

3. **Test robustesse**:
   - Pas de GEMINI_API_KEY → warning, pas de crash
   - API rate limit → retry avec backoff
   - Erreur réseau → log, continue watching

---

## ⏭️ Next Steps

1. ✅ Document le problème (ce fichier)
2. ⏳ Implémenter `onlyDirty` dans `runEmbeddingPipelines`
3. ⏳ Créer `embeddings-helper.ts`
4. ⏳ Modifier `watch.ts` avec callback
5. ⏳ Tester le workflow complet
6. ⏳ Documenter dans README du projet généré

---

## 💭 Alternative: Just-In-Time Embeddings

**Idée**: Ne pas générer les embeddings automatiquement, mais au moment de la query:
```typescript
// Dans QueryBuilder.execute()
const hasEmbeddings = await checkEmbeddings();
if (!hasEmbeddings) {
  console.log('⚠️  Embeddings stale, generating...');
  await generateEmbeddingsForDirtyScopes();
}
```

**Avantages**:
- Embeddings seulement si nécessaires
- Pas de coûts inutiles

**Inconvénients**:
- Première query lente
- Complexité dans le query path
