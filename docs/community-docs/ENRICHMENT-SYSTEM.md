# Enrichment System - Architecture & Roadmap

> Date: 7 janvier 2026
> Status: Implémenté (v1.2) - Embeddings entités/tags + recherche hybride

---

## Vue d'ensemble

Le système d'enrichissement utilise des LLMs pour extraire automatiquement des métadonnées structurées des documents ingérés.

```
Document Upload
      │
      ▼
┌─────────────────────┐
│  1. Parsing         │  ← RagForge core (Markdown, PDF, etc.)
│     → Nodes         │
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│  2. LLM Extraction  │  ← Claude batch (par node)
│     → Entities      │     - Entités avec confidence
│     → Tags          │     - Tags catégorisés
│     → Keywords      │     - Mots-clés
│     → Description   │     - Description par section
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│  3. Dedup intra-doc │  ← Code (normalizedName + type)
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│  4. Store in Neo4j  │
│     → Entity nodes  │
│     → Tag nodes     │
│     → Relations     │     - CONTAINS_ENTITY, HAS_TAG
└─────────────────────┘
      │
      ▼ (async, manuel ou cron)
┌─────────────────────┐
│  5. Resolution      │  ← LLM cross-docs
│     → Match Entity  │     - Crée CANONICAL_IS
│       to Canonical  │
│     → Merge Tags    │     - Par normalizedName + LLM sémantique ✅
└─────────────────────┘
      │
      ▼ (auto après resolution)
┌─────────────────────┐
│  6. Embeddings      │  ← Ollama (mxbai-embed-large)
│     → CanonicalEntity│     - embedding_name (1024 dims)
│     → Tag           │     - Full-text index (BM25)
│     → Hash-based    │     - Mise à jour incrémentale
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│  7. Hybrid Search   │  ← Semantic + BM25 + Boost fusion
│     → /search/entities│   - Recherche entités/tags
│     → Filters       │     - Par type, catégorie, projet
└─────────────────────┘
```

---

## État actuel (v1)

### Types d'entités extraits

| Type | Description | Propriétés |
|------|-------------|------------|
| `Person` | Personnes mentionnées | name, role, organization, aliases, confidence |
| `Organization` | Entreprises, institutions | name, orgType, industry, website, location, aliases |
| `Location` | Lieux géographiques | name, locationType (city/country/region/building) |
| `Technology` | Langages, frameworks, outils | name, aliases |
| `Concept` | Concepts abstraits, méthodologies | name, aliases |
| `Product` | Produits, services | name, aliases |
| `DateEvent` | Événements datés | name, date, eventType |

### Catégories de tags

| Catégorie | Description | Exemples |
|-----------|-------------|----------|
| `topic` | Sujet principal | "machine-learning", "authentication" |
| `technology` | Stack technique | "typescript", "react", "docker" |
| `domain` | Domaine métier | "fintech", "healthcare", "e-commerce" |
| `audience` | Public cible | "beginners", "enterprise", "developers" |
| `type` | Type de contenu | "tutorial", "api-reference", "blog" |
| `other` | Catch-all | - |

### Métadonnées document

- `llmTitle` - Titre généré/amélioré
- `llmDescription` - Résumé du document
- `suggestedCategory` - Catégorie suggérée avec slug, name, confidence, reason
- `keywords` - Mots-clés extraits
- `docType` - Classification (tutorial, reference, guide, api-docs, blog, research, other)
- `language` - Langue détectée (ISO 639-1)
- `qualityScore` - Score de qualité/complétude (0-1)

### Modèle de données Neo4j

```cypher
// Entités extraites (mentions)
(:Entity {
  uuid, name, normalizedName, entityType,
  confidence, aliases[],
  projectId, documentId, sourceNodeId,
  createdAt
})

// Entités canoniques (dédupliquées cross-docs)
(:CanonicalEntity {
  uuid, name, normalizedName, entityType,
  aliases[], projectIds[], documentIds[],
  createdAt, updatedAt
})

// Tags
(:Tag {
  uuid, name, normalizedName, category,
  projectIds[], usageCount,
  createdAt
})

// Relations
(MarkdownSection)-[:CONTAINS_ENTITY {confidence}]->(Entity)
(MarkdownSection)-[:HAS_TAG]->(Tag)
(Entity)-[:CANONICAL_IS]->(CanonicalEntity)
```

### Déduplication actuelle

| Type | Méthode | Quand |
|------|---------|-------|
| Entités intra-doc | Code (normalizedName + type) | À l'ingestion |
| Entités cross-docs | LLM (sémantique) | Via `/admin/resolve-entities` |
| CanonicalEntity duplicates | Code (normalizedName + type) | Via `/admin/resolve-entities` |
| Tags (exact match) | Code (normalizedName) | Via `/admin/resolve-entities` |
| Tags (sémantique) | LLM (groupement sémantique) | Via `/admin/resolve-entities` ✅ **NOUVEAU** |

### Embeddings et recherche hybride ✅ NOUVEAU

Le système génère des embeddings pour les entités canoniques et les tags, permettant une recherche sémantique hybride (BM25 + vecteurs).

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│  EntityEmbeddingService                                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Indexes Neo4j:                                              │
│  ├── canonicalentity_embedding_name_vector (cosine, 1024)   │
│  ├── tag_embedding_name_vector (cosine, 1024)               │
│  ├── canonicalentity_fulltext (name + aliases)              │
│  └── tag_fulltext (name + aliases)                          │
│                                                              │
│  Méthodes:                                                   │
│  ├── ensureVectorIndexes()     - Crée indexes vecteurs      │
│  ├── ensureFullTextIndexes()   - Crée indexes BM25          │
│  ├── generateEmbeddings()      - Génère tous les embeddings │
│  ├── embedSingleEntity()       - Embed une entité           │
│  ├── embedSingleTag()          - Embed un tag               │
│  ├── search()                  - Recherche hybride          │
│  └── getStats()                - Statistiques               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Recherche hybride (Boost Fusion):**

```typescript
// 1. Recherche sémantique (vecteurs)
const semanticResults = await db.vector.cosine(query, limit * 2);

// 2. Recherche BM25 (full-text Lucene)
const bm25Results = await db.fulltext.search(query, limit);

// 3. Fusion avec boost
for (const result of semanticResults) {
  const bm25Rank = bm25Results.findIndex(r => r.uuid === result.uuid);
  if (bm25Rank !== -1) {
    // Boost: ajoute 1/(k + bm25Rank) au score sémantique
    result.score += 1 / (60 + bm25Rank);
  }
}

// 4. Ajoute les meilleurs BM25-only en fin de liste
const bm25Only = bm25Results.filter(r => !semanticResults.has(r.uuid));
results.push(...bm25Only.slice(0, 3));

// 5. Re-trie par score final
results.sort((a, b) => b.score - a.score);
```

**Hash-based incremental updates:**

```typescript
// Ne régénère que si le contenu a changé
const textToEmbed = `${name} ${aliases?.join(' ') || ''} ${type || ''}`;
const newHash = crypto.createHash('md5').update(textToEmbed).digest('hex');

if (node.embeddingHash === newHash) {
  return { skipped: true }; // Déjà à jour
}

const embedding = await embedFunction(textToEmbed);
await updateNode({ embedding, embeddingHash: newHash });
```

**Endpoints API:**

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/search/entities` | Recherche hybride entités/tags |
| GET | `/entities/stats` | Stats embeddings |
| POST | `/admin/generate-entity-embeddings` | Génère tous les embeddings |

**Exemple de recherche:**

```typescript
// Requête
GET /search/entities?q=machine+learning&types=Technology,Concept&limit=20

// Réponse
{
  "results": [
    {
      "uuid": "canonical-123",
      "name": "Machine Learning",
      "type": "entity",
      "entityType": "Technology",
      "score": 0.923,
      "aliases": ["ML", "machine-learning"],
      "usageCount": 15
    },
    {
      "uuid": "tag-456",
      "name": "machine-learning",
      "type": "tag",
      "category": "technology",
      "score": 0.891,
      "usageCount": 42
    }
  ],
  "totalEntities": 1,
  "totalTags": 1
}
```

---

## Intégration Recherche + Entités (Design)

> Status: 🎨 Design en cours

### Problème

Actuellement, la recherche documentaire et la recherche d'entités/tags sont séparées :
- `/search` → retourne des documents/sections
- `/search/entities` → retourne des entités/tags isolés

**Ce qu'on veut :** Quand on cherche "machine learning", on veut des **documents**, pas juste savoir que le tag existe.

### Solution proposée : Entity/Tag Boost

Ajouter une étape de post-processing qui boost les résultats de recherche en fonction des entités/tags correspondants.

```
┌─────────────────────────────────────────────────────────────────┐
│  Recherche standard (existant)                                  │
│  ─────────────────────────────────────────────────────────────  │
│  Query: "neural networks"                                       │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │ 1. Search docs  │ → Results avec scores sémantiques         │
│  │    (semantic)   │   Doc A: 0.82, Doc B: 0.78, Doc C: 0.75   │
│  └─────────────────┘                                           │
│       │                                                         │
│       ▼ (nouveau)                                               │
│  ┌─────────────────┐                                           │
│  │ 2. Entity/Tag   │ → Trouve tags/entités matching:           │
│  │    Matching     │   - Tag "machine-learning" (0.91)         │
│  │                 │   - Tag "neural-networks" (0.95)          │
│  │                 │   - Entity "TensorFlow" (0.72)            │
│  └─────────────────┘                                           │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │ 3. Find linked  │ → Quels docs ont ces tags/entités?        │
│  │    documents    │   Doc A: has "machine-learning" ✓         │
│  │                 │   Doc B: has "TensorFlow" ✓               │
│  │                 │   Doc C: aucun match                      │
│  └─────────────────┘                                           │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │ 4. Boost scores │ → Ajuste les scores:                      │
│  │                 │   Doc A: 0.82 + 0.05 = 0.87 (+tag)        │
│  │                 │   Doc B: 0.78 + 0.03 = 0.81 (+entity)     │
│  │                 │   Doc C: 0.75 (inchangé)                  │
│  └─────────────────┘                                           │
│       │                                                         │
│       ▼                                                         │
│  Résultats finaux (re-triés):                                   │
│  1. Doc A (0.87) - tagged "machine-learning"                   │
│  2. Doc B (0.81) - mentions TensorFlow                         │
│  3. Doc C (0.75)                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Calcul du boost

**Principe clé:** Ne booster que si on "détecte" que l'utilisateur a utilisé un tag/entité existant (similarité haute).

```typescript
interface EntityBoostOptions {
  // Score minimum pour considérer qu'un tag/entity "match" la query
  // En dessous, on ignore complètement (défaut: 0.7)
  entityMatchThreshold?: number;

  // Poids du boost quand un match est détecté (défaut: 0.05)
  entityBoostWeight?: number;
}

// Logique de boost
function applyEntityBoost(results, matchingEntities, options) {
  const threshold = options.entityMatchThreshold ?? 0.7;
  const weight = options.entityBoostWeight ?? 0.05;

  // 1. Filtrer: garder seulement les entities/tags avec score >= threshold
  const strongMatches = matchingEntities.filter(e => e.score >= threshold);

  if (strongMatches.length === 0) {
    // Pas de match assez fort → pas de boost
    return results;
  }

  // 2. Pour chaque résultat, vérifier s'il a un des tags/entities matchés
  for (const result of results) {
    const linkedEntities = getLinkedEntities(result.node.uuid);
    const matchedStrong = strongMatches.filter(e => linkedEntities.includes(e.uuid));

    if (matchedStrong.length > 0) {
      // Boost = meilleur score parmi les matchs * poids
      const bestMatchScore = Math.max(...matchedStrong.map(e => e.score));
      result.entityBoost = bestMatchScore * weight;
      result.score += result.entityBoost;
      result.matchedEntities = matchedStrong;
    }
  }

  // 3. Re-trier par score
  return results.sort((a, b) => b.score - a.score);
}
```

**Exemple concret:**

```
Query: "authentication flow"

Recherche entity/tag:
  - Tag "authentication" → score 0.89 ✓ (>= 0.7, on garde)
  - Tag "security" → score 0.52 ✗ (< 0.7, ignoré)
  - Entity "OAuth" → score 0.71 ✓ (>= 0.7, on garde)

Résultats docs avant boost:
  - Doc A: 0.82 (a tag "authentication")
  - Doc B: 0.78 (a tag "security" seulement)
  - Doc C: 0.75 (a entity "OAuth")

Après boost (weight = 0.05):
  - Doc A: 0.82 + (0.89 * 0.05) = 0.8645  → monte
  - Doc B: 0.78 (pas de strong match)     → inchangé
  - Doc C: 0.75 + (0.71 * 0.05) = 0.7855  → monte un peu

Résultat final trié:
  1. Doc A (0.8645) - "authentication" détecté
  2. Doc C (0.7855) - "OAuth" détecté
  3. Doc B (0.78)
```

### Relations Neo4j utilisées

```cypher
// Tags → Sections
(MarkdownSection)-[:HAS_TAG]->(Tag)

// Entities → Sections
(MarkdownSection)-[:CONTAINS_ENTITY]->(Entity)

// Entities → Canonical (pour regrouper les mentions)
(Entity)-[:CANONICAL_IS]->(CanonicalEntity)

// Query pour trouver les sections liées à des tags/entités matchants
MATCH (section:MarkdownSection)-[:HAS_TAG]->(tag:Tag)
WHERE tag.uuid IN $matchingTagUuids
RETURN DISTINCT section.uuid as sectionUuid,
       collect(tag.name) as matchedTags
```

### API proposée

```typescript
// Option ajoutée à CommunitySearchOptions
interface CommunitySearchOptions {
  // ... existing options ...

  /** Boost results that have matching entities/tags */
  entityBoost?: boolean;  // défaut: true? false?

  /** Weight for entity/tag boost (0-1, défaut: 0.05) */
  entityBoostWeight?: number;

  /** Include matched entities/tags in results */
  includeMatchedEntities?: boolean;
}

// Résultat enrichi
interface CommunitySearchResult {
  node: any;
  score: number;
  filePath?: string;

  // Nouveau: entités/tags matchés pour ce résultat
  matchedEntities?: Array<{
    uuid: string;
    name: string;
    type: 'Tag' | 'Entity' | 'CanonicalEntity';
    matchScore: number;  // Score de match avec la query
  }>;

  // Nouveau: boost appliqué
  entityBoost?: number;
}
```

### Décisions prises

| Question | Décision |
|----------|----------|
| Threshold minimum | **0.7** - Ne boost que si similarité >= 0.7 |
| Formule de boost | **Additif** - `score + (matchScore * weight)` |
| Poids par défaut | **0.05** - Ajustable via option |
| Activer par défaut | **Oui** - Meilleure expérience user "out of the box" |

### Philosophie

```
┌─────────────────────────────────────────────────────────────┐
│  Pour les utilisateurs finaux                               │
│  ───────────────────────────────────────────────────────── │
│  Une barre de recherche → Meilleurs résultats possibles    │
│  Pas de config, pas d'options, ça marche.                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Pour les agents / API avancée                              │
│  ───────────────────────────────────────────────────────── │
│  Options granulaires disponibles:                           │
│  - entityBoost: false (désactiver si besoin)               │
│  - entityMatchThreshold: 0.8 (plus strict)                 │
│  - exploreDepth: 2 (graph de relations)                    │
│  - rerank: true (LLM reranking)                            │
│  - etc.                                                     │
└─────────────────────────────────────────────────────────────┘
```

### Question restante

- **Inclure les entités dans le graph explore?**
  - Le mode `exploreDepth` actuel inclut-il déjà HAS_TAG/CONTAINS_ENTITY ?
  - À vérifier dans le code core

---

### Mode Explore avec Entités/Tags

Étendre `exploreDepth` pour inclure les entités et tags dans le graphe de relations.

```
┌─────────────────────────────────────────────────────────────────┐
│  Recherche avec exploreDepth: 1                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Résultat: MarkdownSection "Introduction to ML"                 │
│       │                                                         │
│       ├──[HAS_TAG]──────────► Tag "machine-learning"           │
│       │                           │                             │
│       │                           └──[aussi sur]──► 5 autres docs│
│       │                                                         │
│       ├──[CONTAINS_ENTITY]──► Entity "TensorFlow"              │
│       │                           │                             │
│       │                           └──[CANONICAL_IS]──► Canonical│
│       │                                                         │
│       ├──[IN_DOCUMENT]──────► MarkdownDocument                 │
│       │                                                         │
│       └──[DEFINED_IN]───────► File                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Graph retourné:**

```typescript
interface ExplorationGraph {
  nodes: Array<{
    uuid: string;
    label: string;  // "MarkdownSection", "Tag", "Entity", etc.
    name: string;
    properties: Record<string, any>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;  // "HAS_TAG", "CONTAINS_ENTITY", etc.
  }>;
}
```

**Utilisation:**
- Visualisation du "knowledge graph" autour d'un résultat
- Navigation: "Voir tous les docs avec ce tag"
- Découverte: "Quelles entités sont souvent mentionnées ensemble?"

---

## Améliorations proposées

### 1. Déduplication des tags par LLM ✅ IMPLÉMENTÉ

**Problème résolu:** Les tags sémantiquement identiques mais orthographiés différemment sont maintenant mergés via LLM + sélection algorithmique du nom canonique.

**Exemples détectés:**
- "ML" → "machine-learning"
- "JS" → "javascript"
- "k8s" → "kubernetes"
- "auth" → "authentication"
- "DB" → "database"

**Implémentation hybride LLM + Algo:**

1. **LLM** identifie les groupes sémantiquement équivalents
2. **Algorithme** choisit la forme canonique la plus descriptive

```typescript
// Fonctions de sélection algorithmique
pickCanonicalTag(variants: string[]): string
  // Préfère: plus long, sans chiffres, avec tirets, lowercase

pickCanonicalEntityName(variants): string
  // Préfère: avec titres (Dr., Prof.), plus long, proper case

pickCanonicalOrgName(variants): string
  // Préfère: nom complet, avec suffixes légaux (Inc., LLC)

pickCanonicalName(entityType, variants): string
  // Dispatch selon le type d'entité
```

**Heuristiques pour les tags:**
1. Plus long (plus descriptif) - "machine-learning" > "ML"
2. Sans chiffres/abréviations - "kubernetes" > "k8s"
3. Avec tirets (convention tags) - "machine-learning" > "machine learning"
4. Lowercase
5. Alphabétique (tie-breaker)

**Heuristiques pour les entités (Person):**
1. Avec titres (Dr., Prof., PhD) - "Dr. Amanda Askell" > "Amanda Askell"
2. Plus long (nom complet)
3. Plus de parties (prénom + nom + suffixe)
4. Usage count (forme la plus utilisée)
5. Proper case

**Heuristiques pour les organisations:**
1. Plus long (nom complet) - "Microsoft Corporation" > "Microsoft"
2. Avec suffixes légaux (Inc., LLC, Ltd.)
3. Pas tout en majuscules (sauf acronymes courts)

**Coût:** ~1 appel LLM Haiku par résolution (~300 tokens)

---

### 2. Types d'entités 100% dynamiques

**Principe clé:** Les types d'entités ne sont PAS hardcodés dans le code. Ils sont entièrement définis dans une config, et le prompt LLM est généré dynamiquement.

**Avantages:**
- Utilisateurs peuvent ajouter leurs propres types sans modifier le code
- Chaque instance peut avoir des types différents selon le domaine (legal, medical, finance...)
- Le schema Neo4j reste flexible (`entityType` = string)
- Possibilité d'UI admin pour gérer les types

**Fichier de config:** `enrichment.config.ts` (ou `.json` pour UI admin)

```typescript
export const enrichmentConfig: EnrichmentConfig = {
  entityTypes: [
    // Types standards (activables/désactivables)
    { name: 'Person', enabled: true, llmThreshold: 0.95 },
    { name: 'Organization', enabled: true },
    { name: 'Location', enabled: true },
    { name: 'Technology', enabled: true },
    { name: 'Concept', enabled: true },
    { name: 'Product', enabled: true },
    { name: 'DateEvent', enabled: true },

    // Types custom
    {
      name: 'LegalDocument',
      enabled: true,
      description: 'Legal contracts, agreements, regulations, laws',
      properties: [
        { name: 'documentNumber', type: 'string' },
        { name: 'effectiveDate', type: 'date' },
        { name: 'parties', type: 'array' },
        { name: 'jurisdiction', type: 'string' },
      ],
      examples: [
        'Contract #2024-001',
        'GDPR Article 5',
        'California Consumer Privacy Act',
      ],
    },
    {
      name: 'MedicalTerm',
      enabled: false, // Désactivé par défaut
      description: 'Medical conditions, treatments, drugs, procedures',
      properties: [
        { name: 'icdCode', type: 'string' },
        { name: 'category', type: 'string' },
      ],
      examples: ['Diabetes Type 2', 'Metformin 500mg', 'MRI scan'],
    },
    {
      name: 'FinancialInstrument',
      enabled: false,
      description: 'Stocks, bonds, derivatives, currencies',
      properties: [
        { name: 'ticker', type: 'string' },
        { name: 'exchange', type: 'string' },
        { name: 'instrumentType', type: 'string' },
      ],
      examples: ['AAPL', 'BTC-USD', 'US Treasury 10Y'],
    },
  ],
};
```

**Génération dynamique du prompt:**

```typescript
function generateEntityPrompt(config: EnrichmentConfig): string {
  const enabledTypes = config.entityTypes.filter(t => t.enabled);

  let prompt = 'Extract the following entity types:\n\n';

  for (const type of enabledTypes) {
    prompt += `**${type.name}**`;
    if (type.description) {
      prompt += `: ${type.description}`;
    }
    prompt += '\n';

    if (type.properties?.length) {
      prompt += `  Properties: ${type.properties.map(p => p.name).join(', ')}\n`;
    }

    if (type.examples?.length) {
      prompt += `  Examples: ${type.examples.join(', ')}\n`;
    }

    prompt += '\n';
  }

  return prompt;
}
```

**Génération dynamique du schema de sortie:**

```typescript
function generateEntitySchema(config: EnrichmentConfig): OutputSchema {
  const entitySchema: any = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Entity type',
        enum: config.entityTypes.filter(t => t.enabled).map(t => t.name),
      },
      name: { type: 'string', description: 'Entity name' },
      confidence: { type: 'number', min: 0, max: 1 },
      aliases: { type: 'array', items: { type: 'string' } },
    },
  };

  // Ajouter les propriétés custom de chaque type
  for (const type of config.entityTypes.filter(t => t.enabled)) {
    if (type.properties) {
      for (const prop of type.properties) {
        entitySchema.properties[prop.name] = {
          type: prop.type,
          description: `${prop.name} (for ${type.name})`,
          required: false,
        };
      }
    }
  }

  return entitySchema;
}
```

**Exemple de prompt généré pour un domaine Legal:**

```
Extract the following entity types:

**Person**: People mentioned in the document
  Properties: name, role, organization
  Examples: John Smith, Dr. Jane Doe

**Organization**: Companies, institutions, government bodies
  Properties: name, orgType, jurisdiction
  Examples: Acme Corp, US Department of Justice

**LegalDocument**: Contracts, laws, regulations, court cases
  Properties: documentNumber, effectiveDate, parties, jurisdiction, caseNumber
  Examples: Contract #2024-001, GDPR Article 5, Smith v. Jones (2023)

**LegalConcept**: Legal terms, doctrines, principles
  Properties: name, legalDomain
  Examples: Force Majeure, Habeas Corpus, Fiduciary Duty

**Jurisdiction**: Courts, regulatory bodies, legal territories
  Properties: name, level, country
  Examples: US Supreme Court, California, European Union
```

**Stockage Neo4j (flexible):**

```cypher
// Tous les types utilisent le même label Entity
// Le type est juste une propriété string
(:Entity {
  uuid: "...",
  name: "Contract #2024-001",
  entityType: "LegalDocument",        // <- String, pas enum hardcodé
  confidence: 0.95,

  // Propriétés custom selon le type
  documentNumber: "2024-001",
  effectiveDate: "2024-01-15",
  parties: ["Acme Corp", "Beta Inc"],
  jurisdiction: "California"
})
```

---

### 3. Catégories de tags personnalisées

```typescript
export const enrichmentConfig: EnrichmentConfig = {
  tagCategories: [
    // Standards
    { name: 'topic', description: 'Main subject matter' },
    { name: 'technology', description: 'Technical stack, tools, frameworks' },
    { name: 'domain', description: 'Business domain or industry' },
    { name: 'audience', description: 'Target audience' },
    { name: 'type', description: 'Content type' },

    // Custom
    {
      name: 'compliance',
      description: 'Regulatory compliance tags',
      examples: ['gdpr', 'hipaa', 'sox', 'pci-dss'],
    },
    {
      name: 'priority',
      description: 'Priority or importance level',
      examples: ['critical', 'high', 'medium', 'low'],
    },
    {
      name: 'lifecycle',
      description: 'Document lifecycle stage',
      examples: ['draft', 'review', 'approved', 'deprecated', 'archived'],
    },
    {
      name: 'team',
      description: 'Responsible team or department',
      examples: ['engineering', 'product', 'marketing', 'legal'],
    },
  ],
};
```

---

### 4. Extracteurs hybrides (Regex + LLM)

Pour réduire les coûts LLM, utiliser des regex pour les patterns simples.

```typescript
export const enrichmentConfig: EnrichmentConfig = {
  extractors: [
    // Regex-based (gratuit, rapide)
    {
      name: 'email',
      type: 'regex',
      pattern: /[\w.-]+@[\w.-]+\.\w+/gi,
      entityType: 'Email',
      confidence: 1.0,
    },
    {
      name: 'url',
      type: 'regex',
      pattern: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,
      entityType: 'URL',
      confidence: 1.0,
    },
    {
      name: 'phone',
      type: 'regex',
      pattern: /\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
      entityType: 'Phone',
      confidence: 0.9,
    },
    {
      name: 'ipAddress',
      type: 'regex',
      pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      entityType: 'IPAddress',
      confidence: 1.0,
    },
    {
      name: 'semver',
      type: 'regex',
      pattern: /\bv?\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?\b/g,
      entityType: 'Version',
      confidence: 0.95,
    },
    {
      name: 'uuid',
      type: 'regex',
      pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      entityType: 'UUID',
      confidence: 1.0,
    },

    // LLM-based (précis, coûteux)
    {
      name: 'sentiment',
      type: 'llm',
      description: 'Analyze overall sentiment',
      outputField: 'sentiment',
      outputType: 'enum',
      enumValues: ['positive', 'neutral', 'negative', 'mixed'],
    },
    {
      name: 'actionItems',
      type: 'llm',
      description: 'Extract action items, TODOs, next steps',
      outputField: 'actionItems',
      outputType: 'array',
    },
    {
      name: 'questions',
      type: 'llm',
      description: 'Extract open questions mentioned in the content',
      outputField: 'openQuestions',
      outputType: 'array',
    },
  ],
};
```

**Exécution hybride:**

```typescript
async function extractFromNode(node: NodeToEnrich, config: EnrichmentConfig) {
  const results: ExtractionResult = {
    entities: [],
    tags: [],
    metadata: {},
  };

  // 1. Exécuter les extracteurs regex (rapide)
  for (const extractor of config.extractors.filter(e => e.type === 'regex')) {
    const matches = node.content.matchAll(extractor.pattern);
    for (const match of matches) {
      results.entities.push({
        name: match[0],
        type: extractor.entityType,
        confidence: extractor.confidence,
        extractedBy: 'regex',
      });
    }
  }

  // 2. Exécuter les extracteurs LLM (batch)
  const llmExtractors = config.extractors.filter(e => e.type === 'llm');
  if (llmExtractors.length > 0) {
    const llmResults = await executeLLMExtraction(node, llmExtractors);
    Object.assign(results.metadata, llmResults);
  }

  // 3. Exécuter l'extraction d'entités standard (LLM)
  const entityResults = await extractEntitiesLLM(node, config.entityTypes);
  results.entities.push(...entityResults);

  return results;
}
```

---

### 5. Synonymes pré-définis (sans LLM)

Base de données de synonymes connus pour éviter les appels LLM.

```typescript
export const synonyms: SynonymDatabase = {
  // Technologies
  technology: {
    'javascript': ['js', 'ecmascript', 'es6', 'es2015', 'es2020'],
    'typescript': ['ts'],
    'python': ['py', 'python3', 'python2'],
    'kubernetes': ['k8s', 'kube'],
    'postgresql': ['postgres', 'pg', 'psql'],
    'mongodb': ['mongo'],
    'elasticsearch': ['elastic', 'es'],
    'machine-learning': ['ml', 'machine learning'],
    'artificial-intelligence': ['ai', 'artificial intelligence'],
    'natural-language-processing': ['nlp'],
    'continuous-integration': ['ci'],
    'continuous-deployment': ['cd'],
    'ci-cd': ['cicd', 'ci/cd'],
  },

  // Organizations
  organization: {
    'google': ['alphabet', 'google llc', 'google inc', 'google inc.'],
    'meta': ['facebook', 'meta platforms', 'fb'],
    'amazon': ['aws', 'amazon web services', 'amazon.com'],
    'microsoft': ['msft', 'ms'],
    'apple': ['aapl', 'apple inc', 'apple inc.'],
  },

  // Locations
  location: {
    'new-york': ['nyc', 'new york city', 'ny'],
    'san-francisco': ['sf', 'san fran'],
    'los-angeles': ['la', 'l.a.'],
    'united-states': ['usa', 'us', 'u.s.', 'u.s.a.', 'america'],
    'united-kingdom': ['uk', 'u.k.', 'britain', 'great britain'],
  },
};

// Utilisation avant d'appeler le LLM
function preResolveSynonyms(entities: Entity[]): Entity[] {
  return entities.map(entity => {
    const category = entity.type.toLowerCase();
    const synonymMap = synonyms[category];

    if (synonymMap) {
      const normalized = entity.name.toLowerCase();

      // Chercher si c'est un synonyme connu
      for (const [canonical, aliases] of Object.entries(synonymMap)) {
        if (aliases.includes(normalized) || normalized === canonical) {
          return {
            ...entity,
            canonicalName: canonical,
            resolvedBy: 'synonym-database',
          };
        }
      }
    }

    return entity;
  });
}
```

---

### 6. Configuration complète

**Interface TypeScript:**

```typescript
interface EnrichmentConfig {
  // Feature flags
  features: {
    extractEntities: boolean;
    extractTags: boolean;
    generateDescriptions: boolean;
    suggestCategory: boolean;
    detectLanguage: boolean;
    calculateQuality: boolean;
    extractSentiment: boolean;
    extractActionItems: boolean;
  };

  // Entity configuration
  entityTypes: EntityTypeConfig[];

  // Tag configuration
  tagCategories: TagCategoryConfig[];

  // Custom extractors
  extractors: ExtractorConfig[];

  // Synonym database
  synonyms: SynonymDatabase;

  // Resolution settings
  resolution: {
    // Entities
    entityLLMThreshold: number;        // Default: 0.8
    neverMergeTypes: string[];         // Types to never auto-merge
    alwaysMergeTypes: string[];        // Types to always merge by name

    // Tags
    tagResolutionMode: 'simple' | 'llm'; // 'simple' = normalizedName only
    tagLLMThreshold: number;           // Default: 0.85
  };

  // Processing limits
  limits: {
    maxEntitiesPerNode: number;        // Default: 20
    maxTagsPerNode: number;            // Default: 10
    minEntityConfidence: number;       // Default: 0.6
    maxNodesPerDocument: number;       // Default: 50
    maxContentLength: number;          // Default: 4000 chars
  };

  // LLM settings
  llm: {
    provider: 'claude' | 'openai' | 'gemini';
    model: string;
    temperature: number;
    maxRetries: number;
    timeout: number;
  };
}

interface EntityTypeConfig {
  name: string;
  enabled: boolean;
  description?: string;
  properties?: PropertyConfig[];
  examples?: string[];
  llmThreshold?: number;      // Override global threshold
  neverMerge?: boolean;       // Never auto-merge this type
}

interface TagCategoryConfig {
  name: string;
  description?: string;
  examples?: string[];
  required?: boolean;         // Must have at least one tag of this category
}

interface ExtractorConfig {
  name: string;
  type: 'regex' | 'llm';
  enabled: boolean;

  // For regex
  pattern?: RegExp;
  entityType?: string;
  confidence?: number;

  // For LLM
  description?: string;
  outputField?: string;
  outputType?: 'string' | 'number' | 'boolean' | 'array' | 'enum';
  enumValues?: string[];
}
```

**Fichier de config par défaut:** `enrichment.config.default.ts`

```typescript
export const defaultEnrichmentConfig: EnrichmentConfig = {
  features: {
    extractEntities: true,
    extractTags: true,
    generateDescriptions: true,
    suggestCategory: true,
    detectLanguage: true,
    calculateQuality: true,
    extractSentiment: false,
    extractActionItems: false,
  },

  entityTypes: [
    { name: 'Person', enabled: true, llmThreshold: 0.95 },
    { name: 'Organization', enabled: true },
    { name: 'Location', enabled: true },
    { name: 'Technology', enabled: true },
    { name: 'Concept', enabled: true },
    { name: 'Product', enabled: true },
    { name: 'DateEvent', enabled: true },
  ],

  tagCategories: [
    { name: 'topic', description: 'Main subject matter' },
    { name: 'technology', description: 'Technical stack' },
    { name: 'domain', description: 'Business domain' },
    { name: 'audience', description: 'Target audience' },
    { name: 'type', description: 'Content type' },
    { name: 'other', description: 'Miscellaneous' },
  ],

  extractors: [],
  synonyms: {},

  resolution: {
    entityLLMThreshold: 0.8,
    neverMergeTypes: [],
    alwaysMergeTypes: [],
    tagResolutionMode: 'simple',
    tagLLMThreshold: 0.85,
  },

  limits: {
    maxEntitiesPerNode: 20,
    maxTagsPerNode: 10,
    minEntityConfidence: 0.6,
    maxNodesPerDocument: 50,
    maxContentLength: 4000,
  },

  llm: {
    provider: 'claude',
    model: 'claude-3-5-haiku-20241022',
    temperature: 0.3,
    maxRetries: 3,
    timeout: 60000,
  },
};
```

---

### 7. Stockage et gestion de la config

**Options de stockage:**

| Option | Avantages | Inconvénients |
|--------|-----------|---------------|
| Fichier `.ts` | Type-safe, IDE autocomplete | Redéploiement requis |
| Fichier `.json` | Modifiable sans rebuild | Pas de type-safety |
| Base de données (PostgreSQL) | UI admin possible, multi-tenant | Plus complexe |
| Neo4j | Tout au même endroit | Mélange data/config |

**Recommandation:** PostgreSQL pour la config (déjà utilisé pour users/docs)

**Schema Prisma:**

```prisma
model EnrichmentConfig {
  id            String   @id @default(cuid())
  name          String   @default("default")
  isActive      Boolean  @default(true)

  // JSON fields for flexibility
  entityTypes   Json     // EntityTypeConfig[]
  tagCategories Json     // TagCategoryConfig[]
  extractors    Json     // ExtractorConfig[]
  synonyms      Json     // SynonymDatabase
  resolution    Json     // ResolutionConfig
  limits        Json     // LimitsConfig
  llm           Json     // LLMConfig

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  createdBy     User     @relation(fields: [createdById], references: [id])
  createdById   String
}

// Pour le multi-tenant (si plusieurs orgs)
model OrganizationConfig {
  id             String           @id @default(cuid())
  organizationId String           @unique
  configId       String
  config         EnrichmentConfig @relation(fields: [configId], references: [id])
}
```

**API pour gérer la config:**

```typescript
// GET /api/admin/enrichment-config
// Returns current active config

// PUT /api/admin/enrichment-config
// Update config (validates schema)

// POST /api/admin/enrichment-config/entity-types
// Add a new entity type

// DELETE /api/admin/enrichment-config/entity-types/:name
// Remove an entity type

// POST /api/admin/enrichment-config/validate
// Validate a config without saving
```

**UI Admin (exemple):**

```
┌─────────────────────────────────────────────────────────────┐
│  Enrichment Configuration                            [Save] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Entity Types                                    [+ Add]    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✓ Person      │ People mentioned          │ [Edit]  │   │
│  │ ✓ Organization│ Companies, institutions   │ [Edit]  │   │
│  │ ✓ Location    │ Geographic locations      │ [Edit]  │   │
│  │ ✓ Technology  │ Languages, frameworks     │ [Edit]  │   │
│  │ ○ LegalDoc    │ Contracts, regulations    │ [Edit]  │   │
│  │ ○ MedicalTerm │ Conditions, treatments    │ [Edit]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Tag Categories                                  [+ Add]    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ topic │ technology │ domain │ audience │ + custom  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Resolution Settings                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Entity LLM Threshold: [0.8____]                     │   │
│  │ Tag Resolution Mode:  ○ Simple  ● LLM              │   │
│  │ Never Merge Types:    [Person_________] [+ Add]    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  LLM Settings                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Provider: [Claude ▼]  Model: [claude-3-5-haiku ▼]  │   │
│  │ Temperature: [0.3____]  Max Retries: [3___]        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Chargement de la config au runtime:**

```typescript
class EnrichmentService {
  private config: EnrichmentConfig;

  async loadConfig(): Promise<void> {
    // 1. Essayer de charger depuis la DB
    const dbConfig = await prisma.enrichmentConfig.findFirst({
      where: { isActive: true },
    });

    if (dbConfig) {
      this.config = this.parseDbConfig(dbConfig);
      return;
    }

    // 2. Fallback sur le fichier local
    try {
      const fileConfig = await import('./enrichment.config.js');
      this.config = fileConfig.default;
      return;
    } catch {
      // 3. Utiliser la config par défaut
      this.config = defaultEnrichmentConfig;
    }
  }

  // Recharger la config sans redémarrer le service
  async reloadConfig(): Promise<void> {
    await this.loadConfig();
    logger.info('EnrichmentConfig', 'Configuration reloaded');
  }
}
```

---

## Roadmap

### Phase 1: Core ✅
- [x] Extraction d'entités LLM (7 types hardcodés)
- [x] Extraction de tags (6 catégories)
- [x] Dédup intra-document (code)
- [x] Résolution cross-docs (LLM)
- [x] Merge CanonicalEntity
- [x] Merge Tags (normalizedName)
- [x] Endpoint `/admin/resolve-entities`

### Phase 2: Dedup améliorée ✅
- [x] Déduplication tags par LLM
- [x] Sélection algorithmique du nom canonique
- [x] Heuristiques par type d'entité (Person, Organization, Tag)

### Phase 2.5: Embeddings entités/tags ✅ NOUVEAU
- [x] EntityEmbeddingService avec recherche hybride
- [x] Vector indexes Neo4j (cosine, 1024 dims)
- [x] Full-text indexes (BM25 Lucene)
- [x] Boost fusion (semantic + BM25)
- [x] Hash-based incremental updates
- [x] Endpoint `/search/entities`
- [x] Endpoint `/entities/stats`
- [x] Endpoint `/admin/generate-entity-embeddings`
- [x] Auto-génération après résolution

### Phase 3: Config dynamique
- [ ] Interface `EnrichmentConfig` TypeScript
- [ ] Types d'entités dynamiques (plus hardcodés)
- [ ] Catégories de tags configurables
- [ ] Génération dynamique des prompts LLM
- [ ] Fichier `enrichment.config.default.ts`
- [ ] Chargement config au runtime

### Phase 4: Synonymes
- [ ] Base de synonymes pré-définis
- [ ] Synonymes custom par utilisateur
- [ ] Threshold configurable par type

### Phase 5: Extracteurs hybrides
- [ ] Extracteurs regex (emails, URLs, versions...)
- [ ] Extracteurs LLM custom
- [ ] Pipeline d'extraction configurable
- [ ] Ordre d'exécution (regex avant LLM)

### Phase 6: Stockage config
- [ ] Schema Prisma `EnrichmentConfig`
- [ ] API CRUD pour la config
- [ ] Validation de config
- [ ] Versioning des configs

### Phase 7: UI Admin
- [ ] Page de configuration enrichissement
- [ ] Éditeur de types d'entités
- [ ] Éditeur de catégories de tags
- [ ] Gestion des synonymes
- [ ] Visualisation des entités/relations (graph)
- [ ] Stats et métriques d'extraction

### Phase 8: Avancé
- [ ] Multi-tenant (config par organisation)
- [ ] Webhooks sur création/merge
- [ ] API de suggestion (autocomplete)
- [ ] Export/import config JSON
- [ ] Templates de config par domaine (legal, medical, finance...)

---

## Coûts estimés

| Opération | Modèle | Tokens/doc | Coût/1000 docs |
|-----------|--------|------------|----------------|
| Extraction entités | Haiku | ~2000 | ~$0.50 |
| Extraction tags | Haiku | ~1000 | ~$0.25 |
| Synthèse document | Haiku | ~1500 | ~$0.35 |
| Résolution entités | Haiku | ~500/type | ~$0.80 |
| Résolution tags (LLM) | Haiku | ~300 | ~$0.08 |
| **Total** | | | **~$2.00/1000 docs** |

*Note: Coûts basés sur Claude 3.5 Haiku ($0.25/1M input, $1.25/1M output)*

---

## Fichiers implémentés

```
packages/community-docs/lib/ragforge/
├── enrichment-service.ts        # Service principal d'enrichissement
├── entity-types.ts              # Types et schemas d'entités
├── entity-resolution-service.ts # Résolution cross-docs (LLM)
├── entity-embedding-service.ts  # Embeddings + recherche hybride ✅ NOUVEAU
└── api/server.ts                # Endpoints API
```

## Endpoints API

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/ingest/upload?enableEnrichment=true` | Upload + enrichissement |
| POST | `/admin/resolve-entities` | Résolution cross-docs (+ génère embeddings) |
| POST | `/admin/generate-entity-embeddings` | Génère tous les embeddings entités/tags |
| GET | `/search/entities` | Recherche hybride entités/tags |
| GET | `/entities/stats` | Statistiques embeddings |
| GET | `/health` | Status du service |
