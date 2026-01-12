# Optimisation de la création de relations Neo4j

## Contexte du problème

Lors de l'ingestion du repo `gemini-cli` (500 fichiers), on observe des temps de création de relations très longs:
- **16497 nodes** créés en ~1 min ✓
- **9914 relations BELONGS_TO (Scope→Project)**: ~3 min
- **9914 relations DEFINED_IN (Scope→File)**: ~2.5 min
- **Total: 55858 relationships** prenant un temps significatif

Le goulot d'étranglement est clairement la création des relations, pas des nodes.

## Pistes d'optimisation envisagées

### 1. Augmenter le batch size

**Situation actuelle**: `BATCH_SIZE = 500` dans `incremental-ingestion.ts`

**Proposition**: Augmenter à 2000-5000 pour les relations

**Avantages**:
- Moins de transactions Neo4j
- Meilleur throughput réseau
- Réduction de l'overhead transactionnel

**Inconvénients**:
- Plus de mémoire consommée
- Risque de timeout sur très gros batches

**Implémentation**:
```typescript
const NODE_BATCH_SIZE = 500;
const RELATIONSHIP_BATCH_SIZE = 2000; // Séparé pour les relations
```

---

### 2. CREATE au lieu de MERGE pour les relations

**Situation actuelle**: On utilise `MERGE` pour éviter les doublons
```cypher
UNWIND $rels AS rel
MATCH (source {uuid: rel.sourceId})
MATCH (target {uuid: rel.targetId})
MERGE (source)-[r:REL_TYPE]->(target)
```

**Proposition**: Utiliser `CREATE` si on sait que les relations n'existent pas encore
```cypher
UNWIND $rels AS rel
MATCH (source {uuid: rel.sourceId})
MATCH (target {uuid: rel.targetId})
CREATE (source)-[r:REL_TYPE]->(target)
```

**Avantages**:
- `CREATE` est 2-3x plus rapide que `MERGE`
- `MERGE` doit vérifier l'existence avant de créer

**Inconvénients**:
- Risque de doublons si on ré-ingère
- Nécessite de tracker quelles relations existent déjà

**Solution hybride**:
```typescript
// Option: Supprimer les relations existantes avant de créer
DELETE (source)-[:REL_TYPE]->(target) WHERE source.projectId = $projectId
// Puis CREATE sans MERGE
```

---

### 3. Paralléliser par type de relation

**Situation actuelle**: Les types de relations sont créés séquentiellement
```typescript
for (const [relType, rels] of Object.entries(relsByType)) {
  await this.upsertRelationships(session, relType, rels);
}
```

**Proposition**: Créer en parallèle les types de relations indépendants
```typescript
await Promise.all([
  this.upsertRelationships(session, 'BELONGS_TO', belongsToRels),
  this.upsertRelationships(session, 'DEFINED_IN', definedInRels),
  this.upsertRelationships(session, 'CONSUMES', consumesRels),
]);
```

**Avantages**:
- Utilise mieux le parallélisme de Neo4j
- Temps total = max(temps par type) au lieu de sum(temps par type)

**Inconvénients**:
- Charge mémoire plus élevée sur Neo4j
- Risque de deadlocks si mal configuré (mais peu probable avec UNWIND)

---

### 4. Vérifier et optimiser les index Neo4j

**À vérifier**: Est-ce que `uuid` est indexé sur tous les labels ?

```cypher
SHOW INDEXES
```

**Index requis**:
```cypher
CREATE INDEX scope_uuid IF NOT EXISTS FOR (n:Scope) ON (n.uuid);
CREATE INDEX file_uuid IF NOT EXISTS FOR (n:File) ON (n.uuid);
CREATE INDEX project_uuid IF NOT EXISTS FOR (n:Project) ON (n.uuid);
CREATE INDEX directory_uuid IF NOT EXISTS FOR (n:Directory) ON (n.uuid);
-- etc. pour tous les labels
```

**Impact**: Sans index, chaque `MATCH (source {uuid: rel.sourceId})` fait un scan complet → O(n) au lieu de O(log n)

---

### 5. Index composites pour les relations

**Proposition**: Créer des index composites pour les patterns fréquents

```cypher
CREATE INDEX scope_project IF NOT EXISTS FOR (n:Scope) ON (n.projectId);
CREATE INDEX file_project IF NOT EXISTS FOR (n:File) ON (n.projectId);
```

**Avantage**: Accélère les requêtes de nettoyage `WHERE projectId = $projectId`

---

### 6. Utiliser APOC pour les imports massifs

**Proposition**: Utiliser `apoc.periodic.iterate` pour les gros volumes

```cypher
CALL apoc.periodic.iterate(
  'UNWIND $rels AS rel RETURN rel',
  'MATCH (source:Scope {uuid: rel.sourceId})
   MATCH (target:Project {uuid: rel.targetId})
   CREATE (source)-[:BELONGS_TO]->(target)',
  {batchSize: 5000, parallel: true, params: {rels: $rels}}
)
```

**Avantages**:
- Gestion automatique du batching
- Parallélisation native
- Meilleure gestion mémoire

**Inconvénients**:
- Dépendance à APOC (déjà installé)
- Syntaxe plus complexe

---

### 7. Précalculer les IDs dans le code

**Situation actuelle**: On envoie des objets complets à Neo4j
```typescript
const rels = relationships.map(r => ({
  sourceId: r.source,
  targetId: r.target,
  properties: r.properties
}));
```

**Proposition**: Envoyer des structures minimales
```typescript
const rels = relationships.map(r => [r.source, r.target]);
// Cypher: UNWIND $rels AS rel MATCH (s {uuid: rel[0]}) MATCH (t {uuid: rel[1]}) CREATE (s)-[:REL]->(t)
```

**Impact**: Réduit la taille des données transférées

---

### 8. Désactiver temporairement les contraintes

**Proposition**: Désactiver les triggers/constraints pendant l'import massif

```cypher
// Avant import
:auto USING PERIODIC COMMIT 10000

// Ou via configuration Neo4j
dbms.tx_state.max_off_heap_memory=2G
```

**Note**: Risqué, à tester en environnement isolé

---

## Priorités recommandées

1. **Vérifier les index** (impact immédiat, risque zéro)
2. **Augmenter batch size pour relations** (facile à implémenter)
3. **Paralléliser par type** (moyen effort, bon gain)
4. **CREATE au lieu de MERGE** (si on peut garantir l'unicité)
5. **APOC periodic.iterate** (si les autres ne suffisent pas)

## Résultats de l'investigation (2026-01-11)

### Découverte majeure: AUCUN index sur `uuid` !

En vérifiant les index existants via `SHOW INDEXES`, on a découvert que:
- Beaucoup d'index VECTOR pour les embeddings ✓
- Beaucoup d'index FULLTEXT pour la recherche ✓
- **ZÉRO index sur `uuid`** ❌

C'est la cause principale de la lenteur! Chaque `MATCH (n {uuid: ...})` faisait un **scan complet de la base**.

### Index créés

```cypher
CREATE INDEX scope_uuid IF NOT EXISTS FOR (n:Scope) ON (n.uuid);
CREATE INDEX file_uuid IF NOT EXISTS FOR (n:File) ON (n.uuid);
CREATE INDEX project_uuid IF NOT EXISTS FOR (n:Project) ON (n.uuid);
CREATE INDEX directory_uuid IF NOT EXISTS FOR (n:Directory) ON (n.uuid);
CREATE INDEX markdowndocument_uuid IF NOT EXISTS FOR (n:MarkdownDocument) ON (n.uuid);
CREATE INDEX markdownsection_uuid IF NOT EXISTS FOR (n:MarkdownSection) ON (n.uuid);
CREATE INDEX codeblock_uuid IF NOT EXISTS FOR (n:CodeBlock) ON (n.uuid);
CREATE INDEX externallibrary_uuid IF NOT EXISTS FOR (n:ExternalLibrary) ON (n.uuid);
```

**Tous les 8 index sont maintenant ONLINE.**

### Fix permanent ajouté

Les index uuid ont été ajoutés dans `neo4j-client.ts:ensureIndexes()` pour qu'ils soient créés automatiquement au démarrage du serveur:

```typescript
// UUID indexes - CRITICAL for relationship creation performance
"CREATE INDEX IF NOT EXISTS scope_uuid FOR (n:Scope) ON (n.uuid)",
"CREATE INDEX IF NOT EXISTS file_uuid FOR (n:File) ON (n.uuid)",
"CREATE INDEX IF NOT EXISTS project_uuid FOR (n:Project) ON (n.uuid)",
// ... etc pour tous les types de nodes
```

### Impact attendu

Avec les index:
- Lookup par uuid: O(log n) au lieu de O(n)
- Pour 16497 nodes, ça passe de ~16000 comparaisons à ~14 comparaisons par lookup
- Gain potentiel: **100x à 1000x plus rapide** pour la création de relations

## Prochaines étapes

- [x] Vérifier les index existants avec `SHOW INDEXES`
- [x] Créer les index manquants sur `uuid`
- [ ] Re-tester l'ingestion de gemini-cli avec les nouveaux index
- [ ] Mesurer le temps avec différentes tailles de batch (si toujours lent)
- [ ] Tester la parallélisation par type de relation (si toujours lent)
- [ ] Profiler avec `EXPLAIN` les requêtes de création (si toujours lent)
