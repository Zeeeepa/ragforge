# Architecture des Locks Séparés

## Problème Résolu

Avant cette modification, un seul `IngestionLock` protégeait à la fois :
- L'ingestion des fichiers (modification des nœuds Neo4j)
- La génération d'embeddings

Cela signifiait que **toutes** les requêtes (même non-sémantiques) devaient attendre la fin de la génération d'embeddings, ce qui pouvait prendre plusieurs minutes.

## Solution : Deux Locks Séparés

### 1. **IngestionLock** 🔒
- Protège uniquement l'ingestion (modification des nœuds)
- Toutes les requêtes attendent ce lock (cohérence des données)
- Libéré rapidement après l'ingestion

### 2. **EmbeddingLock** 🧠
- Protège uniquement la génération d'embeddings
- Seules les requêtes **sémantiques** attendent ce lock
- Les requêtes non-sémantiques peuvent procéder pendant la génération

## Comportement par Type de Requête

### Requêtes Non-Sémantiques (`semantic=false`)
- ✅ Attendent seulement `IngestionLock`
- ✅ Peuvent s'exécuter pendant la génération d'embeddings
- ✅ Réponse rapide même si embeddings en cours de génération

### Requêtes Sémantiques (`semantic=true`)
- ✅ Attendent `IngestionLock` (cohérence des données)
- ✅ Attendent `EmbeddingLock` (embeddings nécessaires)
- ✅ Garantissent que les embeddings sont à jour avant la recherche

### Requêtes Cypher (`run_cypher`)
- ✅ Attendent seulement `IngestionLock`
- ✅ Peuvent s'exécuter pendant la génération d'embeddings
- ✅ Utile pour les requêtes de debug/inspection

## Implémentation

### IngestionQueue
```typescript
// Acquiert embeddingLock avant génération d'embeddings
const embeddingOpKey = this.config.embeddingLock?.acquire('watcher-batch', ...);
try {
  await this.config.afterIngestion(stats); // Génération d'embeddings
} finally {
  this.config.embeddingLock?.release(embeddingOpKey);
}
```

### brain_search
```typescript
// Toujours attendre ingestionLock
await ingestionLock.waitForUnlock();

// Seulement si semantic=true
if (params.semantic) {
  await embeddingLock.waitForUnlock();
}
```

### runCypher
```typescript
// Seulement ingestionLock (pas embeddingLock)
await ingestionLock.waitForUnlock();
```

## Avantages

1. **Performance** : Requêtes non-sémantiques beaucoup plus rapides
2. **Parallélisation** : Génération d'embeddings n'bloque pas les requêtes non-sémantiques
3. **Cohérence** : Les requêtes sémantiques garantissent toujours des embeddings à jour
4. **Flexibilité** : Permet des requêtes de debug pendant la génération d'embeddings

## Exemple de Scénario

**Avant** :
- Modification de fichier → Ingestion (2s) → Génération embeddings (75s)
- Requête Cypher doit attendre 77s total

**Après** :
- Modification de fichier → Ingestion (2s) → Génération embeddings (75s en arrière-plan)
- Requête Cypher peut s'exécuter après 2s seulement
- Requête sémantique attend toujours 77s (garantit embeddings à jour)
