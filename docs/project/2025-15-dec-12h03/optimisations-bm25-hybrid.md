# Optimisations BM25 & Hybrid Search

## Contexte

Implementation actuelle (15 dec 2025):
- **6 full-text indexes** Lucene pour BM25 (scope, document, markdown, media, webpage, codeblock)
- **`fullTextSearch()`** - query chaque index séquentiellement
- **`rrfFusion()`** - Reciprocal Rank Fusion avec k=60
- **`hybridSearch()`** - semantic + BM25 en parallèle, puis fusion RRF
- **Activation automatique** - `semantic: true` active hybrid, `semantic: false` utilise BM25 seul

---

## Optimisations Identifiées

### 1. Paralléliser les requêtes full-text indexes

**Impact**: Élevé | **Difficulté**: Facile

Actuellement on query 6 indexes séquentiellement dans `fullTextSearch()`:

```typescript
// ACTUEL - séquentiel (~6x latence)
for (const indexName of fullTextIndexes) {
  const result = await this.neo4jClient.run(cypher, params);
  // process...
}

// OPTIMISÉ - parallèle (~1x latence)
const allQueries = fullTextIndexes.map(indexName =>
  this.neo4jClient.run(cypher, { indexName, ...params })
);
const results = await Promise.all(allQueries);
```

**Gain estimé**: 5-6x sur la latence BM25

---

### 2. ~~Propriétés arrays non indexées~~ ❌ NON NÉCESSAIRE

**Statut**: Investigué et **NON NÉCESSAIRE**

Après investigation, les propriétés `content` et `rawText` sont en fait des **strings** dans Neo4j, pas des arrays:

```cypher
-- Test effectué:
MATCH (n) WHERE n.content IS NOT NULL
RETURN labels(n)[0], substring(toString(head(collect(n.content))), 0, 100)
-- Résultat: MarkdownSection content = "# @luciformresearch/ragforge-cli..." (string)

MATCH (n) WHERE n.rawText IS NOT NULL
RETURN labels(n)[0], head(collect(n.rawText))
-- Résultat: CodeBlock rawText = "npm install..." (string)
```

Les full-text indexes peuvent donc indexer ces propriétés normalement. Aucune dénormalisation nécessaire.

---

### 3. Single query avec UNION ALL

**Impact**: Moyen | **Difficulté**: Moyenne

Au lieu de 6 queries séparées, une seule query Cypher avec UNION:

```cypher
CALL db.index.fulltext.queryNodes('scope_fulltext', $query) YIELD node, score
RETURN node, score, 'scope' as source
UNION ALL
CALL db.index.fulltext.queryNodes('document_fulltext', $query) YIELD node, score
RETURN node, score, 'document' as source
UNION ALL
...
ORDER BY score DESC
LIMIT $limit
```

**Avantage**: Une seule round-trip réseau
**Inconvénient**: Query plus complexe, moins flexible pour les filtres par type

---

### 4. Tuning du paramètre RRF k

**Impact**: Variable | **Difficulté**: Facile

Le paramètre `k=60` est la valeur standard du paper RRF original, mais peut ne pas être optimal pour la recherche de code.

**Recherche web (Dec 2025):**

Sources: [Elastic](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion), [Milvus](https://milvus.io/docs/rrf-ranker.md), [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking), [MariaDB](https://mariadb.com/docs/server/reference/sql-structure/vectors/optimizing-hybrid-search-query-with-reciprocal-rank-fusion-rrf)

| k | Comportement |
|---|--------------|
| 5-15 | Fort accent sur les top résultats (pour 1-10 résultats) |
| 20-30 | Équilibré, bon pour code search |
| 60 | **Standard** (paper original), robuste |
| 100 | Plus de "consensus" entre les méthodes |

**Conclusion**:
- k=60 est **robuste et peu sensible aux variations** → garder comme défaut
- Pour la recherche de code où on veut les top résultats, k=20-30 pourrait être légèrement mieux
- La différence n'est pas critique, pas besoin de tuning immédiat

---

### 5. Cache des query embeddings

**Impact**: Faible | **Difficulté**: Facile

Si la même query est répétée, on régénère l'embedding à chaque fois.

```typescript
// Simple LRU cache
const queryEmbeddingCache = new Map<string, { embedding: number[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
```

**Note**: Impact faible car les queries sont rarement identiques

---

### 6. Ajuster le nombre de candidats

**Impact**: Faible | **Difficulté**: Facile

Actuellement dans `hybridSearch()`:
```typescript
const candidateLimit = Math.min(limit * 3, 150);
```

**Options**:
- Augmenter le multiplicateur (4x, 5x) pour plus de diversité
- Diminuer pour plus de vitesse
- Adapter dynamiquement selon le taux d'overlap observé

---

### 7. Optimisation Lucene query syntax

**Impact**: Moyen | **Difficulté**: Moyenne

Actuellement on utilise fuzzy matching sur chaque mot:
```typescript
const luceneQuery = words.map(w => `${w}~`).join(' ');
// "embedding provider" → "embedding~ provider~"
```

**Recherche web (Dec 2025):**

Sources: [Apache Lucene](https://lucene.apache.org/core/2_9_4/queryparsersyntax.html), [Azure AI Search](https://learn.microsoft.com/en-us/azure/search/query-lucene-syntax)

| Syntaxe | Description |
|---------|-------------|
| `word~` | Fuzzy (edit distance 1-2, défaut=2) |
| `word~1` | Fuzzy limité à 1 edit (plus précis) |
| `word*` | Prefix matching |
| `word^2` | Boost (x2 importance) |
| `"multi word"` | Phrase exacte |
| `"w1 w2"~5` | Proximity (mots à 5 positions max) |

**Options d'amélioration**:

a) **Exact + Fuzzy boosté** (recommandé):
```typescript
// Priorité à l'exact, fallback fuzzy
words.map(w => `(${w}^2 OR ${w}~1)`).join(' AND ')
// "embedding provider" → "(embedding^2 OR embedding~1) AND (provider^2 OR provider~1)"
```

b) **Fuzzy limité à 1 edit**:
```typescript
words.map(w => `${w}~1`).join(' ')
// Plus précis, moins de faux positifs
```

c) **Prefix pour noms de code**:
```typescript
// Pour les identifiants (camelCase, snake_case)
words.map(w => `${w}* OR ${w}~1`).join(' ')
```

**Conclusion**: Option (b) `~1` au lieu de `~` serait une amélioration simple et sûre

---

### 8. Index composite unique

**Impact**: Variable | **Difficulté**: Élevée

Au lieu de 6 indexes séparés, un seul index couvrant tous les types:

```cypher
CREATE FULLTEXT INDEX unified_fulltext IF NOT EXISTS
FOR (n:Scope|DocumentFile|MarkdownDocument|...)
ON EACH [n.searchableText]
```

**Avantage**: Une seule query
**Inconvénient**: Nécessite dénormalisation (voir #2), moins de contrôle granulaire

---

## Priorités Recommandées

| # | Optimisation | Impact | Effort | Priorité | Statut |
|---|--------------|--------|--------|----------|--------|
| 1 | Paralléliser queries full-text | Élevé | Facile | **P0** | ✅ DONE |
| 2 | ~~Propriétés arrays~~ | - | - | - | ❌ Non nécessaire |
| 3 | UNION ALL query | Moyen | Moyenne | P2 | ✅ DONE |
| 4 | Tuning RRF k | Variable | Facile | **P1** | 📝 Documenté (k=60 OK) |
| 5 | Cache embeddings | Faible | Facile | P3 | |
| 6 | Candidats adaptatifs | Faible | Facile | P3 | |
| 7 | Lucene syntax | Moyen | Moyenne | P2 | ✅ DONE (~1) |
| 8 | Index composite | Variable | Élevée | P3 | |

---

## Prochaines Étapes

- [x] Implémenter #1 (parallélisation) ✅ DONE
- [x] Aligner full-text indexes avec MULTI_EMBED_CONFIGS ✅ DONE
- [x] Investiguer #2 (arrays) → ❌ Non nécessaire (ce sont des strings)
- [ ] Benchmarker avant/après
- [ ] Évaluer qualité des résultats sur queries de test
- [ ] Implémenter #4 (tuning RRF k) - exposer comme paramètre configurable

---

## Changelog

### 2025-12-15

**Implémenté:**
- Parallélisation des 8 queries full-text via `Promise.all()`
- Ajout indexes manquants: `file_fulltext`, `datafile_fulltext`
- Propriétés ajoutées aux indexes existants:
  - scope: +`docstring`
  - document: +`title`
  - markdown: +`ownContent`, `content`
  - media: +`description`, `path`
  - webpage: +`metaDescription`
- Hybrid search automatique quand `semantic: true`
- BM25 seul quand `semantic: false`

**Investigué:**
- #2 (arrays) - Les propriétés `content` et `rawText` sont en fait des **strings** dans Neo4j, pas des arrays. Aucune action nécessaire.
- #4 (RRF k) - Recherche web: k=60 est robuste, pas de changement nécessaire
- #7 (Lucene) - Changé `~` → `~1` (edit distance 1, plus précis)
