# Points de Stress et Optimisation du Watcher

## Points de Stress Identifiés

### 1. **Rate Limiting Gemini API** ⚠️ CRITIQUE
- **Problème** : Retries de 60-70 secondes lors du rate limiting
- **Impact** : Génération d'embeddings peut prendre plusieurs minutes
- **Solution actuelle** : Backoff exponentiel avec jitter (0-10s)
- **Améliorations possibles** :
  - Prévoir les limites de quota et ralentir proactivement
  - Batch size adaptatif selon les limites
  - Cache plus agressif pour éviter les régénérations inutiles

### 2. **Génération d'embeddings en batch** ⚠️ MOYEN
- **Problème** : 2669 embeddings en 75 secondes (avec retries)
- **Impact** : Lock d'ingestion bloqué pendant la génération
- **Solution actuelle** : Batch processing avec concurrency limitée (pLimit(5))
- **Améliorations possibles** :
  - Parallélisation accrue si rate limits le permettent
  - Génération asynchrone en arrière-plan sans bloquer les recherches

### 3. **Lock d'ingestion bloquant les requêtes Cypher** ⚠️ MOYEN
- **Problème** : Les requêtes Cypher attendent le lock d'ingestion
- **Impact** : Timeout de 95 secondes observé lors de la génération d'embeddings
- **Solution actuelle** : Lock avec timeout et force release
- **Améliorations possibles** :
  - Séparer le lock d'ingestion du lock d'embeddings
  - Permettre les requêtes en lecture pendant la génération d'embeddings

### 4. **Timeout arbitraire de 3 secondes pour watcher ready** ⚠️ MINEUR
- **Problème** : Attente forcée même si le watcher est fonctionnel
- **Impact** : Délai inutile au démarrage
- **Solution actuelle** : Timeout de 3s avec résolution si pas de ready event
- **Amélioration proposée** : Voir section ci-dessous

## Optimisation du Watcher Ready

### Problème Actuel

Le code attend soit :
1. L'événement `ready` de chokidar (peut prendre plusieurs secondes)
2. Un timeout de 3 secondes (arbitraire)

### Analyse

**Chokidar fonctionne immédiatement** après création, même sans l'événement `ready`. L'événement `ready` indique seulement que le scan initial est terminé, mais le watcher peut déjà détecter les changements avant.

### Solution Proposée

**Option 1 : Considérer le watcher comme ready immédiatement** (RECOMMANDÉ)
- Le watcher est fonctionnel dès qu'il est créé et que les listeners sont attachés
- L'événement `ready` est optionnel (pour logging uniquement)
- Avantage : Pas d'attente, démarrage instantané
- Inconvénient : Pas de comptage initial des fichiers (mais pas critique)

**Option 2 : Vérification proactive de la fonctionnalité**
- Tester si le watcher peut détecter un changement (créer un fichier temporaire)
- Considérer ready si le test réussit
- Avantage : Confirmation que le watcher fonctionne
- Inconvénient : Plus complexe, peut être lent

**Option 3 : État "ready" basé sur la première détection**
- Considérer le watcher comme ready dès la première détection de changement
- Avantage : Confirmation que le watcher fonctionne réellement
- Inconvénient : Peut prendre du temps si aucun changement

### Recommandation : Option 1

Le watcher chokidar est fonctionnel immédiatement après création. L'événement `ready` est utile pour :
- Logging (nombre de fichiers surveillés)
- Statistiques initiales

Mais il n'est **pas nécessaire** pour que le watcher fonctionne. On peut :
1. Créer le watcher
2. Attacher les listeners
3. Considérer comme ready immédiatement
4. Écouter l'événement `ready` en arrière-plan pour le logging uniquement

### Implémentation

```typescript
// Créer le watcher
this.watcher = chokidar.watch(patterns, { ... });

// Attacher les listeners
this.watcher.on('ready', () => {
  // Logging uniquement, pas de résolution de promise
  const fileCount = this.watcher!.getWatched()...
  console.log(`[FileWatcher] Initial scan complete: ${fileCount} files`);
});

// Considérer comme ready immédiatement
// Le watcher fonctionne déjà, même sans l'événement ready
```

## Autres Optimisations Possibles

### 1. Génération d'embeddings asynchrone
- Ne pas bloquer le lock d'ingestion pendant la génération
- Permettre les recherches pendant la génération (avec données partiellement à jour)

### 2. Cache plus intelligent
- Éviter de régénérer les embeddings si le contenu n'a pas changé
- Utiliser les hash pour détecter les changements réels

### 3. Batch size adaptatif
- Ajuster la taille des batches selon les rate limits
- Réduire automatiquement si rate limit détecté

### 4. Priorisation des embeddings
- Générer d'abord les embeddings pour les fichiers récemment modifiés
- Générer les autres en arrière-plan
