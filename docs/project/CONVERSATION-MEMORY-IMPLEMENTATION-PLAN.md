# Plan d'Implémentation : Système de Mémoire Conversationnelle Multi-Niveaux

Date: 2025-12-10

## Vue d'Ensemble

Ce document découpe l'implémentation en étapes exactes, en respectant scrupuleusement la documentation établie dans :
- `CONVERSATION-MEMORY-ARCHITECTURE.md`
- `EMBEDDING-GENERATION.md`
- `CONVERSATION-SUMMARIZATION.md`
- `CONVERSATION-MEMORY-ROADMAP.md`

## Architecture Cible (Rappel)

```
L0 (Turns) → L1 (Short Term) → L2 (Long Term)
```

**Important** : Pas de L3 - la hiérarchie s'arrête à L2.

### Configuration des Seuils (Basée sur Pourcentage)

**Contexte Maximum** : 100 000 caractères (configurable)
- **L1 Threshold** : 10% du contexte max = 10 000 caractères de conversation brute
- **L2 Threshold** : 10% du contexte max = 10 000 caractères de résumés L1
- **Last User Query History** : 5% du contexte max = 5 000 caractères pour dernières requêtes utilisateur

**Répartition du Contexte** :
- **5%** : Last User Query History (dernières requêtes utilisateur uniquement)
- **10%** : Recent Turns (contenu brut récent avec assistant + tools)
- **10%** : Code Semantic Search (recherche sémantique sur code du projet, si sous-répertoire et lock embeddings disponible)
- **Reste** : Semantic Search Results (turns + résumés pertinents) + L1 Summaries Not Summarized

**Code Semantic Search** :
- **Condition** : Uniquement si on est dans un sous-répertoire du projet (pas à la racine)
- **Condition** : Uniquement si le lock d'embeddings d'ingestion est disponible (pas en cours de génération)
- **Filtre** : Uniquement code (Scope nodes, exclure MarkdownSection, WebPage, etc.)
- **Limite initiale** : 100 résultats de recherche sémantique
- **Limite finale** : 10% du contexte max (10k chars) en prenant les résultats avec scores les plus élevés
- **Rationale** : Contexte code pertinent directement dans la conversation, surtout pour sous-dossiers spécifiques

**Rationale** :
- Gemini Flash 2.0 supporte 1M tokens (~4M caractères), donc 100k caractères est très raisonnable (~2.5% de la capacité)
- Coût très faible : Gemini Flash 2.0 est économique même pour de gros contextes
- Système de pourcentage plus flexible et adaptatif
- Permet d'ajuster facilement selon besoins (ex: 5% pour conversations courtes, 15% pour longues)
- **Last User Query History** : Garde trace des dernières intentions/questions utilisateur pour contexte immédiat

### Niveaux de Résumé

- **L0 (Turns)** : Contenu brut (user + assistant + tool calls + tool results)
  - Stockage : Nœud `Message` avec `embedding` (3072 dimensions)
  - Trigger : Stockage immédiat après chaque réponse
  - Embedding : Généré à partir de `userMessage + assistantMessage + toolResults`

- **L1 (Short Term)** : Résumé de plusieurs turns
  - Stockage : Nœud `Summary` avec `level: 1` et `embedding` (3072 dimensions)
  - Trigger : Quand conversation brute atteint 10% du contexte max (par défaut: 10k chars sur 100k max)
  - Embedding : Généré à partir de `summary + filesMentioned + keyFindings`

- **L2 (Long Term)** : Résumé de plusieurs résumés L1
  - Stockage : Nœud `Summary` avec `level: 2` et `embedding` (3072 dimensions)
  - Trigger : Quand résumés L1 atteignent 10% du contexte max (par défaut: 10k chars sur 100k max)
  - Embedding : Généré à partir de `summary + filesMentioned + keyFindings`

## Étapes d'Implémentation

### ÉTAPE 1 : Préparer les Types et Interfaces

**Fichier** : `packages/core/src/runtime/conversation/types.ts`

**Actions** :
1. Vérifier que les types suivants existent et correspondent à la doc :
   - `ConversationTurn` (avec `userMessage`, `assistantMessage`, `toolResults`, `timestamp`, `charCount`)
   - `ConversationSummary` (avec `summary`, `filesMentioned`, `keyFindings`, `toolsUsed`, `topics`, `level`, `charCount`)
   - `Summary` (interface pour stockage Neo4j avec `level`, `content.conversation_summary`, `content.actions_summary`, `char_range_start`, `char_range_end`, `summary_char_count`, `created_at`, `embedding`, `parent_summaries`)

2. Ajouter types manquants si nécessaire :
   - `ConversationSession` (avec `sessionId`, `startTime`, `lastActivity`, `cwd`, `projectPath`)
   - Types pour recherche sémantique : `SearchResult` avec `type: 'turn' | 'summary'`, `turn?`, `summary?`, `score`

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 54-156, 162-240

---

### ÉTAPE 2 : Étendre ConversationStorage - Méthodes de Base

**Fichier** : `packages/core/src/runtime/conversation/storage.ts`

**Actions** :

#### 2.1 Ajouter méthode `storeTurn()` avec embedding L0

**Signature** :
```typescript
async storeTurn(
  sessionId: string,
  turn: ConversationTurn,
  toolCalls: ToolCall[]
): Promise<void>
```

**Implémentation** :
1. Calculer `charCount` du turn : `userMessage.length + assistantMessage.length + toolResults.reduce(...)`
2. Stocker le turn dans Neo4j comme nœud `Message` (ou `ConversationTurn` selon schéma)
3. Stocker les `toolCalls` avec relation `HAS_TOOL_CALL`
4. Générer embedding L0 :
   - Appeler `generateTurnEmbeddingText(turn)` (voir doc EMBEDDING-GENERATION.md ligne 74-96)
   - Utiliser `GeminiEmbeddingProvider.embedSingle()` (3072 dimensions)
   - Stocker dans propriété `embedding` du nœud
5. Mettre à jour `total_chars` de la conversation

**Référence doc** : `EMBEDDING-GENERATION.md` lignes 70-102, `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 334-338

#### 2.2 Ajouter méthode `generateTurnEmbeddingText()`

**Signature** :
```typescript
private generateTurnEmbeddingText(turn: ConversationTurn): string
```

**Implémentation** : Exactement comme dans `EMBEDDING-GENERATION.md` lignes 74-96

#### 2.3 Ajouter méthode `getRecentTurns()`

**Signature** :
```typescript
async getRecentTurns(
  sessionId: string,
  options: { maxChars?: number; limit?: number }
): Promise<ConversationTurn[]>
```

**Implémentation** : Requête Cypher pour récupérer tours récents non résumés, triés par timestamp DESC, limités par `maxChars` et `limit`

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 244-254, 348-351

#### 2.4 Ajouter méthode `getLastUserQueries()`

**Signature** :
```typescript
async getLastUserQueries(
  sessionId: string,
  options: { maxChars?: number; limit?: number }
): Promise<Array<{
  userMessage: string;
  timestamp: Date | string;
  turnIndex: number;
}>>
```

**Implémentation** :
1. Requête Cypher pour récupérer uniquement les messages utilisateur (role='user')
2. Trier par timestamp DESC
3. Limiter par `maxChars` (par défaut: 5% du contexte max = 5k chars)
4. Retourner array avec `userMessage`, `timestamp`, `turnIndex`

**Rationale** : Garde trace des dernières intentions/questions utilisateur pour contexte immédiat, séparé du contexte enrichi complet

**Référence doc** : Nouvelle fonctionnalité, pas dans doc originale mais logique pour contexte utilisateur

#### 2.4 Ajouter méthode `getRawHistoryCharCount()`

**Signature** :
```typescript
async getRawHistoryCharCount(sessionId: string): Promise<number>
```

**Implémentation** : Requête Cypher pour calculer somme des `charCount` des turns non résumés (non liés à un résumé L1)

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 287-297, 353

---

### ÉTAPE 3 : Implémenter Résumés L1 Basés sur Caractères

**Fichier** : `packages/core/src/runtime/conversation/storage.ts`

**Actions** :

#### 3.1 Ajouter méthode `shouldCreateL1Summary()`

**Signature** :
```typescript
async shouldCreateL1Summary(sessionId: string): Promise<{
  shouldCreate: boolean;
  charRangeStart: number;
  charRangeEnd: number;
  turnsToSummarize: ConversationTurn[];
  currentCharCount: number;
  threshold: number;
}>
```

**Implémentation** :
1. Calculer `threshold` via `this.getL1Threshold()` (10% du contexte max)
2. Récupérer tous les turns non résumés (non liés à un résumé L1)
3. Calculer `charCount` cumulé depuis le dernier résumé L1 (ou depuis le début)
4. **Validation** : Vérifier que `charCount > 0` (éviter division par zéro)
5. Si `charCount >= threshold`, déterminer quels turns résumer (jusqu'à atteindre threshold)
6. Retourner `charRangeStart` et `charRangeEnd` (positions caractères dans conversation brute)
7. **Gestion erreur** : Si erreur Neo4j, retourner `shouldCreate: false` avec log

**Points de validation** :
- Vérifier que session existe
- Vérifier que threshold > 0
- Gérer cas où aucun turn non résumé

**Référence doc** : `CONVERSATION-SUMMARIZATION.md` lignes 59-63, `CONVERSATION-MEMORY-ROADMAP.md` lignes 9-10

#### 3.2 Modifier `storeSummary()` pour accepter résumés L1

**Vérifier** : La méthode `storeSummary()` existe déjà et accepte `Summary` avec `level`, `char_range_start`, `char_range_end`, `summary_char_count`

**Si nécessaire** : Adapter pour stocker aussi `filesMentioned`, `keyFindings`, `toolsUsed`, `topics` (en JSON array string)

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 196-220, 340-345

#### 3.3 Ajouter méthode `storeSummaryWithEmbedding()`

**Signature** :
```typescript
async storeSummaryWithEmbedding(
  summary: Summary,
  filesMentioned: string[],
  keyFindings: string[],
  toolsUsed: string[],
  topics: string[]
): Promise<void>
```

**Implémentation** :
1. Stocker le résumé via `storeSummary()`
2. Générer embedding L1 :
   - Appeler `generateSummaryEmbeddingText(summary, filesMentioned, keyFindings)` (voir doc EMBEDDING-GENERATION.md ligne 109-126)
   - Utiliser `GeminiEmbeddingProvider.embedSingle()` (3072 dimensions)
   - Stocker dans propriété `embedding` du nœud `Summary`
3. Créer relations `SUMMARIZES` vers les turns résumés (si level 1)
4. Créer relations `MENTIONS_FILE` vers les fichiers mentionnés (si fichiers existent dans brain)

**Référence doc** : `EMBEDDING-GENERATION.md` lignes 104-132, 566-795

#### 3.4 Ajouter méthode `generateSummaryEmbeddingText()`

**Signature** :
```typescript
private generateSummaryEmbeddingText(
  summary: Summary,
  filesMentioned: string[],
  keyFindings: string[]
): string
```

**Implémentation** : Exactement comme dans `EMBEDDING-GENERATION.md` lignes 109-126

---

### ÉTAPE 4 : Implémenter Résumés L2 Basés sur Caractères

**Fichier** : `packages/core/src/runtime/conversation/storage.ts`

**Actions** :

#### 4.1 Ajouter méthode `shouldCreateL2Summary()`

**Signature** :
```typescript
async shouldCreateL2Summary(sessionId: string): Promise<{
  shouldCreate: boolean;
  summariesToSummarize: Summary[];
  charRangeStart: number;
  charRangeEnd: number;
  currentCharCount: number;
  threshold: number;
}>
```

**Implémentation** :
1. Calculer `threshold` via `this.getL2Threshold()` (10% du contexte max)
2. Récupérer tous les résumés L1 non résumés (non liés à un résumé L2)
3. Calculer `summary_char_count` cumulé depuis le dernier résumé L2 (ou depuis le début)
4. **Validation** : Vérifier que `summary_char_count > 0` et qu'il y a au moins 2 résumés L1
5. Si `summary_char_count >= threshold`, déterminer quels résumés L1 résumer
6. Retourner `charRangeStart` et `charRangeEnd` (positions caractères dans conversation brute originale)
7. **Gestion erreur** : Si erreur Neo4j, retourner `shouldCreate: false` avec log

**Points de validation** :
- Vérifier que session existe
- Vérifier qu'il y a au moins 2 résumés L1 à résumer (sinon pas de sens)
- Gérer cas où aucun résumé L1 non résumé

**Référence doc** : `CONVERSATION-SUMMARIZATION.md` lignes 65-69, `CONVERSATION-MEMORY-ROADMAP.md` lignes 22-25

#### 4.2 Ajouter méthode `getLevel1SummariesNotSummarized()`

**Signature** :
```typescript
async getLevel1SummariesNotSummarized(
  sessionId: string,
  options: { limit?: number }
): Promise<Summary[]>
```

**Implémentation** : Requête Cypher pour récupérer résumés L1 non résumés en L2, triés par `created_at` DESC

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 299-311, 355-359

#### 4.3 Adapter `storeSummaryWithEmbedding()` pour L2

**Modification** : La méthode doit aussi gérer les résumés L2 :
- Créer relations `SUMMARIZES` vers les résumés L1 résumés (si level 2)
- Utiliser `generateL2SummaryEmbeddingText()` pour embedding (même logique que L1)

**Référence doc** : `EMBEDDING-GENERATION.md` lignes 134-163

---

### ÉTAPE 5 : Implémenter Recherche Sémantique Multi-Niveaux et Code Semantic Search

**Fichier** : `packages/core/src/runtime/conversation/storage.ts`

**Actions** :

#### 5.1 Ajouter méthode `searchConversationHistory()`

**Signature** :
```typescript
async searchConversationHistory(
  sessionId: string,
  query: string,
  options: {
    semantic?: boolean;
    maxResults?: number;
    includeTurns?: boolean;
    levels?: number[];
  }
): Promise<Array<{
  type: 'turn' | 'summary';
  turn?: ConversationTurn;
  summary?: Summary;
  score: number;
}>>
```

**Implémentation** :
1. Si `semantic === true` :
   - Générer embedding de la requête via `GeminiEmbeddingProvider.embedSingle(query)`
   - Requête Cypher UNION pour rechercher dans :
     - L0 (Turns) : Si `includeTurns === true` et `levels.includes(0)`
     - L1 (Summaries level 1) : Si `levels.includes(1)`
     - L2 (Summaries level 2) : Si `levels.includes(2)`
   - Utiliser `vector.similarity.cosine()` (Neo4j 5.15+) ou `gds.similarity.cosine()` (fallback)
   - Filtrer par `minScore` (par défaut 0.7)
   - Trier par score DESC et limiter à `maxResults`
2. Retourner résultats avec `type`, `turn` ou `summary`, et `score`

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 256-285, 361-376, `EMBEDDING-GENERATION.md` lignes 797-856

#### 5.3 Ajouter méthode `searchCodeSemantic()`

**Signature** :
```typescript
async searchCodeSemantic(
  query: string,
  options: {
    cwd: string;                    // Current working directory
    projectRoot: string;            // Racine du projet (pour filtrer sous-répertoire)
    initialLimit?: number;          // Default: 100 résultats initiaux
    maxChars?: number;              // Default: 10% du contexte max = 10k chars
    minScore?: number;              // Default: 0.3
  }
): Promise<Array<{
  scopeId: string;
  name: string;
  file: string;
  startLine: number;               // CRITIQUE : Ligne de début pour édition directe
  endLine: number;                 // CRITIQUE : Ligne de fin pour édition directe
  content: string;
  score: number;
  charCount: number;
}>>
```

**Implémentation** :
1. **Vérifier conditions** :
   - Vérifier que `cwd` est un sous-répertoire de `projectRoot` (pas égal à `projectRoot`)
   - Vérifier que le lock d'embeddings d'ingestion est disponible (passé en paramètre)
2. **Générer embedding de la requête** via `generateQueryEmbedding(query)`
3. **Recherche sémantique** :
   - Utiliser `brain_search` ou requête Cypher directe sur `Scope` nodes uniquement
   - Filtrer par `file` qui commence par le chemin relatif depuis `projectRoot` vers `cwd`
   - Exclure explicitement `MarkdownSection`, `WebPage`, `DocumentFile`, etc. (uniquement `Scope`)
   - Limite initiale : `initialLimit` (100 résultats)
   - Filtrer par `minScore` (0.3 par défaut)
4. **Trier par score DESC** et calculer `charCount` pour chaque résultat
5. **Appliquer limite de caractères** :
   - Prendre les résultats avec scores les plus élevés
   - Cumuler `charCount` jusqu'à atteindre `maxChars` (10k chars)
   - Retourner seulement les résultats qui rentrent dans la limite
6. **Retourner** array avec `scopeId`, `name`, `file`, `startLine`, `endLine`, `content` (tronqué si nécessaire), `score`, `charCount`

**Exemple de requête Cypher** :
```cypher
MATCH (s:Scope)
WHERE s.embedding IS NOT NULL
  AND s.file STARTS WITH $relativePath  // Filtrer sous-répertoire
  AND s.startLine IS NOT NULL           // CRITIQUE : Lignes requises pour édition
  AND s.endLine IS NOT NULL             // CRITIQUE : Lignes requises pour édition
WITH s, vector.similarity.cosine(s.embedding, $queryEmbedding) AS score
WHERE score >= $minScore
RETURN 
  s.uuid AS scopeId, 
  s.name AS name, 
  s.file AS file, 
  s.startLine AS startLine,      // CRITIQUE pour édition directe
  s.endLine AS endLine,          // CRITIQUE pour édition directe
  s.source AS content, 
  score
ORDER BY score DESC
LIMIT $initialLimit
```

**Rationale** :
- Contexte code pertinent directement dans la conversation
- Uniquement si embeddings disponibles (lock libre)
- Uniquement pour sous-répertoires (évite trop de résultats à la racine)
- Limite intelligente : 100 résultats initiaux, puis filtre par chars (10%) en gardant meilleurs scores
- **startLine/endLine** : Permet édition directe sans recherche supplémentaire (l'agent peut utiliser `edit_file` avec lignes précises)

**Référence doc** : Nouvelle fonctionnalité, utilise `brain_search` existant mais avec filtres spécifiques

#### 5.2 Ajouter méthode helper `generateQueryEmbedding()`

**Signature** :
```typescript
private async generateQueryEmbedding(query: string): Promise<number[]>
```

**Implémentation** : Utiliser `GeminiEmbeddingProvider.embedSingle(query)`

**Référence doc** : `EMBEDDING-GENERATION.md` lignes 195-203

#### 5.3 Ajouter méthode `searchCodeSemantic()`

**Signature** :
```typescript
async searchCodeSemantic(
  query: string,
  options: {
    cwd: string;                    // Current working directory
    projectRoot: string;            // Racine du projet (pour filtrer sous-répertoire)
    initialLimit?: number;          // Default: 100 résultats initiaux
    maxChars?: number;              // Default: 10% du contexte max = 10k chars
    minScore?: number;              // Default: 0.3
  }
): Promise<Array<{
  scopeId: string;
  name: string;
  file: string;
  startLine: number;               // CRITIQUE : Ligne de début pour édition directe
  endLine: number;                 // CRITIQUE : Ligne de fin pour édition directe
  content: string;
  score: number;
  charCount: number;
}>>
```

**Implémentation** :
1. **Vérifier conditions** :
   - Vérifier que `cwd` est un sous-répertoire de `projectRoot` (pas égal à `projectRoot`)
   - Vérifier que le lock d'embeddings d'ingestion est disponible (passé en paramètre)
2. **Générer embedding de la requête** via `generateQueryEmbedding(query)`
3. **Recherche sémantique** :
   - Utiliser `brain_search` ou requête Cypher directe sur `Scope` nodes uniquement
   - Filtrer par `file` qui commence par le chemin relatif depuis `projectRoot` vers `cwd`
   - Exclure explicitement `MarkdownSection`, `WebPage`, `DocumentFile`, etc. (uniquement `Scope`)
   - Limite initiale : `initialLimit` (100 résultats)
   - Filtrer par `minScore` (0.3 par défaut)
4. **Trier par score DESC** et calculer `charCount` pour chaque résultat
5. **Appliquer limite de caractères** :
   - Prendre les résultats avec scores les plus élevés
   - Cumuler `charCount` jusqu'à atteindre `maxChars` (10k chars)
   - Retourner seulement les résultats qui rentrent dans la limite
6. **Retourner** array avec `scopeId`, `name`, `file`, `startLine`, `endLine`, `content` (tronqué si nécessaire), `score`, `charCount`

**Exemple de requête Cypher** :
```cypher
MATCH (s:Scope)
WHERE s.embedding IS NOT NULL
  AND s.file STARTS WITH $relativePath  // Filtrer sous-répertoire
  AND s.startLine IS NOT NULL           // CRITIQUE : Lignes requises pour édition
  AND s.endLine IS NOT NULL             // CRITIQUE : Lignes requises pour édition
WITH s, vector.similarity.cosine(s.embedding, $queryEmbedding) AS score
WHERE score >= $minScore
RETURN 
  s.uuid AS scopeId, 
  s.name AS name, 
  s.file AS file, 
  s.startLine AS startLine,      // CRITIQUE pour édition directe
  s.endLine AS endLine,          // CRITIQUE pour édition directe
  s.source AS content, 
  score
ORDER BY score DESC
LIMIT $initialLimit
```

**Rationale** :
- Contexte code pertinent directement dans la conversation
- Uniquement si embeddings disponibles (lock libre)
- Uniquement pour sous-répertoires (évite trop de résultats à la racine)
- Limite intelligente : 100 résultats initiaux, puis filtre par chars (10%) en gardant meilleurs scores
- **startLine/endLine** : Permet édition directe sans recherche supplémentaire (l'agent peut utiliser `edit_file` avec lignes précises)

**Référence doc** : Nouvelle fonctionnalité, utilise `brain_search` existant mais avec filtres spécifiques

---

### ÉTAPE 6 : Construire Contexte Enrichi

**Fichier** : `packages/core/src/runtime/conversation/storage.ts` ou nouveau fichier `context-builder.ts`

**Actions** :

#### 6.1 Ajouter méthode `buildEnrichedContext()`

**Signature** :
```typescript
async buildEnrichedContext(
  sessionId: string,
  userMessage: string,
  options?: {
    recentMaxChars?: number;
    recentLimit?: number;
    lastUserQueriesMaxChars?: number;  // Default: 5% du contexte max = 5k chars
    codeSearchMaxChars?: number;       // Default: 10% du contexte max = 10k chars
    codeSearchInitialLimit?: number;   // Default: 100 résultats
    semanticMaxResults?: number;
    semanticMinScore?: number;
    level1SummariesLimit?: number;
    cwd?: string;                      // Current working directory pour détecter sous-répertoire
    embeddingLock?: any;               // Lock d'embeddings d'ingestion pour vérifier disponibilité
  }
): Promise<{
  lastUserQueries: Array<{
    userMessage: string;
    timestamp: Date | string;
    turnIndex: number;
  }>;
  recentTurns: ConversationTurn[];
  codeSemanticResults?: Array<{
    scopeId: string;
    name: string;
    file: string;
    startLine: number;               // CRITIQUE : Ligne de début pour édition directe
    endLine: number;                 // CRITIQUE : Ligne de fin pour édition directe
    content: string;
    score: number;
    charCount: number;
  }>;
  semanticResults: Array<{
    type: 'turn' | 'summary';
    turn?: ConversationTurn;
    summary?: Summary;
    score: number;
    confidence?: number;              // Nouveau : Niveau de confiance selon source
  }>;
  level1SummariesNotSummarized: Summary[];
}>
```

**Implémentation** :
1. Récupérer dernières requêtes utilisateur via `getLastUserQueries()` avec `maxChars` (par défaut: 5% = 5k chars)
2. Récupérer tours récents via `getRecentTurns()` avec `maxChars` et `limit`
3. **Lancer recherches sémantiques en parallèle** avec `Promise.all()` :
   - **Recherche sémantique conversation** : `searchConversationHistory()` avec `semantic: true`, `includeTurns: true`, `levels: [0, 1, 2]`
   - **Code Semantic Search** (si conditions remplies) :
     - Vérifier que `cwd` est fourni et est un sous-répertoire (pas racine du projet)
     - Vérifier que `embeddingLock` est fourni et disponible (`!embeddingLock.isLocked()`)
     - Si conditions OK : `searchCodeSemantic()` avec `userMessage`, `initialLimit: 100`, `maxChars: 10%`
     - Sinon : `Promise.resolve([])` (array vide)
     - Filtrer uniquement sur `Scope` nodes (code), exclure `MarkdownSection`, `WebPage`, etc.
   - Les deux recherches sont indépendantes et peuvent s'exécuter simultanément pour optimiser les performances
4. Récupérer résumés L1 non résumés via `getLevel1SummariesNotSummarized()`
5. Retourner objet avec les cinq composants (codeSemanticResults optionnel)

**Exemple de code** :
```typescript
const [semanticResults, codeSemanticResults] = await Promise.all([
  searchConversationHistory(sessionId, userMessage, {
    semantic: true,
    includeTurns: true,
    levels: [0, 1, 2],
    maxResults: options.semanticMaxResults,
    minScore: options.semanticMinScore
  }),
  (async () => {
    if (!options.cwd || !options.embeddingLock) return [];
    const isSubdirectory = path.relative(options.projectRoot || '', options.cwd) !== '.';
    if (!isSubdirectory || options.embeddingLock.isLocked()) return [];
    return searchCodeSemantic(userMessage, {
      cwd: options.cwd,
      projectRoot: options.projectRoot || '',
      initialLimit: options.codeSearchInitialLimit || 100,
      maxChars: options.codeSearchMaxChars || this.getCodeSearchMaxChars(),
      minScore: options.semanticMinScore || 0.3,
      embeddingLockAvailable: !options.embeddingLock.isLocked()
    });
  })()
]);
```

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 81-112 (étendu avec codeSemanticResults)

#### 6.2 Ajouter méthode `formatContextForAgent()`

**Signature** :
```typescript
formatContextForAgent(enrichedContext: {
  lastUserQueries: Array<{
    userMessage: string;
    timestamp: Date | string;
    turnIndex: number;
  }>;
  recentTurns: ConversationTurn[];
  codeSemanticResults?: Array<{
    scopeId: string;
    name: string;
    file: string;
    startLine: number;               // CRITIQUE : Ligne de début pour édition directe
    endLine: number;                 // CRITIQUE : Ligne de fin pour édition directe
    content: string;
    score: number;
    charCount: number;
  }>;
  semanticResults: Array<{
    type: 'turn' | 'summary';
    turn?: ConversationTurn;
    summary?: Summary;
    score: number;
    confidence?: number;              // Nouveau : Niveau de confiance selon source
  }>;
  level1SummariesNotSummarized: Summary[];
}): string
```

**Organisation par Confidence** :
Les résultats sont organisés par niveau de confiance pour permettre à l'agent de prioriser les sources les plus fiables :
- **L0 (Turns)** : `confidence = 1.0` (contenu brut, source la plus fiable)
- **L1 (Summaries level 1)** : `confidence = 0.7` (résumés récents, bonne fiabilité)
- **L2 (Summaries level 2)** : `confidence = 0.5` (résumés consolidés, fiabilité moyenne)
- **Code Semantic Search** : `confidence = 0.5` (code du projet, fiabilité moyenne)

**Implémentation** : Formater avec structure suivante, organisée par confidence décroissante :
```typescript
const context = `
## Last User Queries (Recent Intentions)
${enrichedContext.lastUserQueries.map((q, i) => `
[Query ${i + 1} - Turn ${q.turnIndex}]
${q.userMessage}
`).join('\n')}

${enrichedContext.codeSemanticResults && enrichedContext.codeSemanticResults.length > 0 ? `
## Relevant Code Context (Semantic Search)
${enrichedContext.codeSemanticResults.map((code, i) => `
[${code.file}:${code.startLine}-${code.endLine}] ${code.name} (Relevance: ${(code.score * 100).toFixed(0)}%)
${code.content.substring(0, 500)}${code.content.length > 500 ? '...' : ''}
`).join('\n')}
` : ''}

## Recent Conversation (Raw)
${enrichedContext.recentTurns.map(turn => `
User: ${turn.userMessage}
Assistant: ${turn.assistantMessage}
Tools: ${turn.toolResults.map(t => t.toolName).join(', ')}
`).join('\n')}

## Relevant Past Context (Semantic Search - Turns)
${enrichedContext.semanticResults
  .filter(r => r.type === 'turn' && r.turn)
  .map(result => `
[Turn ${result.turn.turnIndex} - Relevance: ${(result.score * 100).toFixed(0)}%]
User: ${result.turn.userMessage}
Assistant: ${result.turn.assistantMessage}
Tools: ${result.turn.toolResults.map(t => t.toolName).join(', ')}
`).join('\n')}

## Relevant Past Context (Semantic Search - Summaries)
${enrichedContext.semanticResults
  .filter(r => r.type === 'summary' && r.summary)
  .map(result => `
[Level ${result.summary.level} Summary - Relevance: ${(result.score * 100).toFixed(0)}%]
${result.summary.content.conversation_summary}
${result.summary.content.actions_summary}

Key findings: ${result.summary.keyFindings?.join(', ') || 'N/A'}
Files mentioned: ${result.summary.filesMentioned?.join(', ') || 'N/A'}
`).join('\n')}

## Recent Level 1 Summaries (Not Yet Summarized to Level 2)
${enrichedContext.level1SummariesNotSummarized.map(summary => `
[Level 1 Summary]
${summary.content.conversation_summary}
${summary.content.actions_summary}

Key findings: ${summary.keyFindings?.join(', ') || 'N/A'}
Files mentioned: ${summary.filesMentioned?.join(', ') || 'N/A'}
Tools used: ${summary.toolsUsed?.join(', ') || 'N/A'}
`).join('\n')}
`;
```

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 114-156 (étendu avec Code Semantic Search)

---

### ÉTAPE 7 : Intégrer dans ConversationSummarizer

**Fichier** : `packages/cli/src/tui/hooks/conversation-summarizer.ts`

**Actions** :

#### 7.1 Modifier `summarizeTurns()` pour retourner format Summary

**Modification** : Adapter le retour pour correspondre à l'interface `Summary` avec :
- `content.conversation_summary` et `content.actions_summary` (au lieu de juste `summary`)
- `char_range_start` et `char_range_end`
- `summary_char_count`
- `filesMentioned`, `keyFindings`, `toolsUsed`, `topics`

**Référence doc** : `CONVERSATION-SUMMARIZATION.md` lignes 42-55, `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 196-220

#### 7.2 Ajouter méthode `summarizeSummaries()` pour L2

**Signature** :
```typescript
async summarizeSummaries(summaries: Summary[]): Promise<Summary>
```

**Implémentation** : Utiliser LLM pour résumer plusieurs résumés L1 en un résumé L2, avec même structure que L1

**Référence doc** : `CONVERSATION-SUMMARIZATION.md` lignes 65-69, `CONVERSATION-MEMORY-ROADMAP.md` lignes 22-25

---

### ÉTAPE 8 : Intégrer dans useAgent.ts

**Fichier** : `packages/cli/src/tui/hooks/useAgent.ts`

**Actions** :

#### 8.1 Après chaque réponse de l'agent

**Modification** :
1. Stocker le turn immédiatement (synchrone) via `conversationStorage.storeTurn()`
2. Lancer résumé L1 en parallèle (asynchrone, non-bloquant) :
   ```typescript
   conversationStorage.shouldCreateL1Summary(sessionId).then(async (should) => {
     if (should.shouldCreate) {
       const summary = await summarizer.summarizeTurns(should.turnsToSummarize);
       await conversationStorage.storeSummaryWithEmbedding(summary, ...);
     }
   });
   ```
3. Vérifier si historique brut dépasse seuil et déclencher résumé L2 si nécessaire

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 53-79, `CONVERSATION-MEMORY-ROADMAP.md` lignes 28-45

#### 8.2 Avant chaque appel agent

**Modification** :
1. Construire contexte enrichi via `conversationStorage.buildEnrichedContext()`
2. Formater contexte via `conversationStorage.formatContextForAgent()`
3. Passer contexte enrichi à l'agent

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 81-112

---

### ÉTAPE 9 : Intégrer dans RAG Agent

**Fichier** : `packages/core/src/runtime/agents/rag-agent.ts`

**Actions** :

#### 9.1 Modifier `ask()` pour accepter contexte enrichi

**Modification** :
1. Accepter paramètre optionnel `enrichedContext` (ou le construire si non fourni)
2. Intégrer le contexte enrichi dans le system prompt ou dans l'historique

**Référence doc** : `CONVERSATION-MEMORY-ROADMAP.md` lignes 143-177

#### 9.2 Adapter `buildHistoryContext()` pour utiliser contexte enrichi

**Modification** : Si contexte enrichi fourni, l'utiliser au lieu de construire depuis historique brut

---

### ÉTAPE 10 : Gestion des Sessions par CWD

**Fichier** : `packages/core/src/runtime/conversation/storage.ts`

**Actions** :

#### 10.1 Ajouter méthode `createSession()`

**Signature** :
```typescript
async createSession(cwd: string, projectPath?: string): Promise<string>
```

**Implémentation** :
1. Normaliser CWD (résoudre symlinks, chemins relatifs)
2. Créer nœud `ConversationSession` avec `sessionId` (UUID), `startTime`, `lastActivity`, `cwd`, `projectPath`
3. Retourner `sessionId`

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 163-170, 318

#### 10.2 Ajouter méthode `getSessionsByCwd()`

**Signature** :
```typescript
async getSessionsByCwd(cwd: string): Promise<Array<{
  sessionId: string;
  startTime: Date;
  lastActivity: Date;
  turnCount: number;
  lastMessage?: string;
}>>
```

**Implémentation** : Requête Cypher pour trouver sessions avec CWD normalisé

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 319-325

#### 10.3 Ajouter méthode `loadSession()`

**Signature** :
```typescript
async loadSession(sessionId: string): Promise<{
  sessionId: string;
  cwd: string;
  projectPath?: string;
  turns: ConversationTurn[];
}>
```

**Implémentation** : Charger session complète avec tous ses turns

**Référence doc** : `CONVERSATION-MEMORY-ARCHITECTURE.md` lignes 326-331

---

### ÉTAPE 11 : Relations avec Fichiers Mentionnés

**Fichier** : `packages/core/src/runtime/conversation/storage.ts`

**Actions** :

#### 11.1 Ajouter méthode `findFileNode()`

**Signature** :
```typescript
private async findFileNode(
  filePath: string,
  projectRoot?: string
): Promise<{ uuid: string; path: string } | null>
```

**Implémentation** : Exactement comme dans `EMBEDDING-GENERATION.md` lignes 602-636

#### 11.2 Modifier `storeSummaryWithEmbedding()` pour créer relations

**Modification** : Après stockage du résumé, créer relations `MENTIONS_FILE` vers fichiers mentionnés (si fichiers existent dans brain)

**Référence doc** : `EMBEDDING-GENERATION.md` lignes 639-668

---

### ÉTAPE 12 : Initialisation et Configuration

**Fichier** : `packages/core/src/runtime/conversation/storage.ts`

**Actions** :

#### 12.1 Ajouter constructeur avec GeminiEmbeddingProvider

**Modification** :
```typescript
constructor(
  private neo4j: Neo4jClient,
  private embeddingProvider: GeminiEmbeddingProvider,
  private config?: {
    maxContextChars?: number;           // Default: 100000 (contexte max)
    l1ThresholdPercent?: number;        // Default: 10 (10% du max = 10k chars)
    l2ThresholdPercent?: number;        // Default: 10 (10% du max = 10k chars)
    lastUserQueriesPercent?: number;    // Default: 5 (5% du max = 5k chars)
    codeSearchPercent?: number;         // Default: 10 (10% du max = 10k chars)
    codeSearchInitialLimit?: number;   // Default: 100 résultats initiaux
  }
)

// Calcul des seuils réels
private getL1Threshold(): number {
  const max = this.config?.maxContextChars ?? 100000;
  const percent = this.config?.l1ThresholdPercent ?? 10;
  return Math.floor(max * (percent / 100));
}

private getL2Threshold(): number {
  const max = this.config?.maxContextChars ?? 100000;
  const percent = this.config?.l2ThresholdPercent ?? 10;
  return Math.floor(max * (percent / 100));
}

private getLastUserQueriesMaxChars(): number {
  const max = this.config?.maxContextChars ?? 100000;
  const percent = this.config?.lastUserQueriesPercent ?? 5;
  return Math.floor(max * (percent / 100));
}

private getCodeSearchMaxChars(): number {
  const max = this.config?.maxContextChars ?? 100000;
  const percent = this.config?.codeSearchPercent ?? 10;
  return Math.floor(max * (percent / 100));
}
```

**Avantages** :
- Plus flexible : peut ajuster selon taille de conversation
- Plus intuitif : pourcentage plutôt que valeur absolue
- Économique : 100k chars = ~25k tokens pour Gemini Flash 2.0 (très peu cher)
- **Last User Queries** : 5% dédié aux dernières intentions utilisateur pour contexte immédiat
- **Code Semantic Search** : 10% dédié au code pertinent du projet (si sous-répertoire et embeddings disponibles)

#### 12.2 Créer instance dans BrainManager ou ConversationAgent

**Référence doc** : `EMBEDDING-GENERATION.md` lignes 165-177

---

## Ordre d'Implémentation Recommandé

1. **ÉTAPE 1** : Types et interfaces (fondation)
2. **ÉTAPE 2** : Stockage L0 avec embeddings (base)
3. **ÉTAPE 3** : Résumés L1 basés sur caractères (premier niveau)
4. **ÉTAPE 4** : Résumés L2 basés sur caractères (deuxième niveau)
5. **ÉTAPE 5** : Recherche sémantique multi-niveaux (recherche)
6. **ÉTAPE 6** : Contexte enrichi (assemblage)
7. **ÉTAPE 7** : ConversationSummarizer (adaptation)
8. **ÉTAPE 8** : useAgent.ts (intégration CLI)
9. **ÉTAPE 9** : RAG Agent (intégration core)
10. **ÉTAPE 10** : Sessions par CWD (gestion)
11. **ÉTAPE 11** : Relations fichiers (liens)
12. **ÉTAPE 12** : Initialisation (finalisation)

## Points d'Attention Critiques

1. **Embeddings** : Utiliser `GeminiEmbeddingProvider` directement (pas `EmbeddingService`), 3072 dimensions
2. **Pas de hash** : Chaque turn/résumé est unique, pas besoin de hash pour cache
3. **Seuils pourcentage** : L1 basé sur 10% du contexte max (100k chars), L2 basé sur 10% du contexte max de résumés L1
4. **Pas de L3** : S'arrêter à L2
5. **Parallélisme** : Résumés en arrière-plan, non-bloquants
6. **Schéma Neo4j** : Respecter exactement le schéma défini dans la doc (noms de nœuds, propriétés, relations)
7. **formatLocalDate()** : Utiliser pour horodatage des résumés (L1, L2)
8. **Relations** : Créer `SUMMARIZES` vers turns (L1) ou summaries (L2), `MENTIONS_FILE` vers fichiers
9. **Validations** : Toujours vérifier existence session, threshold > 0, données non vides avant traitement
10. **Gestion erreurs** : Toutes les opérations doivent avoir try/catch avec fallback gracieux (ne pas bloquer l'agent)
11. **Coût Gemini Flash 2.0** : 100k chars = ~25k tokens, très économique même pour gros contextes

## Tests à Effectuer

### Tests Unitaires
1. Stockage d'un turn avec embedding L0
2. Calcul correct des seuils L1/L2 (10% de 100k = 10k)
3. `shouldCreateL1Summary()` retourne `true` quand seuil atteint
4. `shouldCreateL2Summary()` retourne `true` quand seuil atteint
5. `shouldCreateL2Summary()` retourne `false` si moins de 2 résumés L1
6. Génération embedding L0 avec format correct
7. Génération embedding L1/L2 avec format correct
8. Recherche sémantique sur L0 retourne résultats pertinents
9. Recherche sémantique sur L1 retourne résultats pertinents
10. Recherche sémantique sur L2 retourne résultats pertinents
11. `searchCodeSemantic()` retourne `[]` si `cwd === projectRoot` (pas sous-répertoire)
12. `searchCodeSemantic()` retourne `[]` si `embeddingLockAvailable === false`
13. `searchCodeSemantic()` retourne résultats avec `startLine` et `endLine` présents
14. `searchCodeSemantic()` filtre uniquement `Scope` nodes (pas `MarkdownSection`, etc.)
15. `searchCodeSemantic()` limite correctement à 10% chars en gardant meilleurs scores
16. `searchCodeSemantic()` filtre correctement par chemin relatif sous-répertoire

### Tests d'Intégration
1. Génération automatique résumé L1 quand seuil atteint (10% de 100k)
2. Génération automatique résumé L2 quand seuil L1 atteint (10% de 100k)
3. Récupération Last User Queries avec limite 5% (5k chars)
4. Code Semantic Search activé uniquement si sous-répertoire ET lock disponible
5. Code Semantic Search filtré uniquement sur Scope nodes (pas MarkdownSection, etc.)
6. Code Semantic Search limite correctement à 10% chars en gardant meilleurs scores
7. Construction contexte enrichi avec tous les composants (lastUserQueries + codeSemantic + récent + sémantique + L1)
8. Recherches sémantiques (conversation + code) lancées en parallèle avec `Promise.all()` pour optimiser performances
9. Format contexte pour agent correct avec Last User Queries et Code Context en premier
10. Intégration dans agent avec contexte enrichi
11. Gestion sessions par CWD
12. Relations avec fichiers mentionnés
13. Performance recherche sémantique < 500ms (grâce à parallélisation)

### Tests de Validation
1. Vérifier que session existe avant opérations
2. Vérifier que threshold > 0 avant calculs
3. Gérer gracieusement erreurs Neo4j (fallback sur historique brut)
4. Gérer gracieusement erreurs génération embedding (ne pas bloquer)
5. Gérer gracieusement erreurs résumé LLM (ne pas bloquer)
6. Vérifier que charCount cumulé est correct
7. Vérifier que char_range_start/end sont cohérents

## Métriques de Validation

- ✅ Chaque turn stocké avec embedding L0 (3072 dimensions)
- ✅ Résumé L1 créé automatiquement quand conversation brute atteint 10% du contexte max (10k chars sur 100k)
- ✅ Résumé L2 créé automatiquement quand résumés L1 atteignent 10% du contexte max (10k chars sur 100k)
- ✅ Recherche sémantique fonctionne sur L0, L1, L2
- ✅ Contexte enrichi contient : lastUserQueries (5%) + codeSemantic (10% si conditions) + récent + sémantique + L1 non résumés
- ✅ Last User Queries récupérées (5% = 5k chars) avec dernières intentions utilisateur
- ✅ Code Semantic Search activé uniquement si sous-répertoire ET lock embeddings disponible
- ✅ Code Semantic Search filtre uniquement Scope nodes (code), limite 100 initiaux puis 10% chars
- ✅ Agent reçoit contexte enrichi formaté correctement avec Last User Queries et Code Context en premier
- ✅ Sessions liées au CWD
- ✅ Relations créées avec fichiers mentionnés
- ✅ Performance acceptable (< 500ms pour recherche sémantique totale grâce à parallélisation)
- ✅ Recherches sémantiques (conversation + code) lancées en parallèle avec `Promise.all()` pour optimiser les performances (les deux recherches sont indépendantes et peuvent s'exécuter simultanément)
- ✅ Gestion erreurs gracieuse (fallback, pas de blocage)
- ✅ Validations correctes (session existe, threshold > 0, données non vides)

## Améliorations du Plan pour Éviter les Erreurs

### Validations Ajoutées
- Vérifier existence session avant chaque opération
- Vérifier threshold > 0 avant calculs
- Vérifier données non vides (turns, summaries)
- Vérifier au moins 2 résumés L1 avant créer L2

### Gestion d'Erreurs
- Try/catch sur toutes opérations Neo4j avec fallback
- Try/catch sur génération embeddings avec log (ne pas bloquer)
- Try/catch sur résumés LLM avec fallback sur historique brut
- Logs détaillés pour debugging

### Points de Vérification
- Chaque méthode vérifie ses préconditions
- Chaque méthode gère ses erreurs
- Chaque méthode retourne valeurs cohérentes même en cas d'erreur
- Tests unitaires pour chaque cas limite

## ⚠️ Points d'Attention Critiques Identifiés

### 1. Gestion de la Concurrence (Race Conditions)

**Problème potentiel** :
- Si plusieurs turns arrivent rapidement, plusieurs résumés L1 peuvent être déclenchés en parallèle
- Risque de résumer les mêmes turns plusieurs fois
- Risque de désynchronisation des `char_range_start/end`

**Solution** : Utiliser un système de lock similaire à `ConversationLock` (voir `EMBEDDING-ARCHITECTURE.md`)
- Lock pour L1 : Empêcher résumés concurrents sur les mêmes turns
- Lock pour L2 : Empêcher résumés concurrents sur les mêmes résumés L1
- UUID déterministe basé sur hash du contenu pour idempotence

**Action** : Ajouter étape "ÉTAPE 0.5 : Implémenter ConversationLock" avant stockage

### 2. Calcul des char_range_start/end

**Problème potentiel** :
- Si un turn arrive pendant qu'un résumé L1 est en cours, le `char_range_end` peut être incorrect
- Besoin de calculer positions caractères de manière atomique

**Solution** :
- Calculer `char_range_start/end` AVANT d'acquérir le lock
- Utiliser transaction Neo4j pour garantir atomicité
- Stocker `char_range_start` et `char_range_end` dans le résumé pour traçabilité

**Action** : Dans `shouldCreateL1Summary()`, calculer ranges AVANT lock

### 3. Synchronisation Stockage vs Résumés

**Problème potentiel** :
- Stockage turn synchrone, résumé asynchrone
- Si résumé échoue, le turn reste non résumé mais peut être compté dans le seuil suivant

**Solution** :
- Marquer turns comme "en cours de résumé" (flag `summarizing: true`)
- En cas d'échec, retirer le flag et réessayer au prochain tour
- Utiliser UPSERT pour résumés (idempotent avec UUID déterministe)

**Action** : Ajouter flag `summarizing` aux turns dans Neo4j

### 4. Performance Requêtes Cypher UNION

**Problème potentiel** :
- Recherche sémantique avec UNION sur L0 + L1 + L2 peut être lente
- Plusieurs scans de graphe nécessaires

**Solution** :
- Utiliser index vectoriel Neo4j si disponible (`db.index.vector.queryNodes`)
- Sinon, optimiser avec `WITH` et filtres précoces
- Limiter résultats par niveau avant UNION
- **Parallélisation** : Recherches sémantiques conversation et code lancées en parallèle avec `Promise.all()` pour réduire temps total (les deux recherches sont indépendantes)

**Action** : Optimiser requête dans `searchConversationHistory()`, utiliser `Promise.all()` dans étape 6.1

### 5. Coût Embeddings

**Problème potentiel** :
- 3072 dimensions × nombre de turns/résumés = beaucoup d'embeddings
- Coût Gemini : ~$0.00001 par embedding

**Estimation** :
- 100 turns = 100 embeddings L0 = $0.001
- 10 résumés L1 = 10 embeddings = $0.0001
- 1 résumé L2 = 1 embedding = $0.00001
- **Total pour conversation moyenne** : ~$0.0011 (très faible)

**Solution** : Acceptable, mais monitorer le coût

### 6. Transition depuis Système Actuel

**Problème potentiel** :
- Le système actuel utilise peut-être un autre format
- Migration des données existantes nécessaire ?

**Solution** :
- Vérifier compatibilité avec `ConversationStorage` existant
- Si migration nécessaire, créer script de migration
- Mode "compatibilité" pendant transition

**Action** : Analyser code existant avant implémentation

### 7. Gestion des Sessions Multiples

**Problème potentiel** :
- Plusieurs sessions pour même CWD
- Comment choisir quelle session charger ?

**Solution** :
- Proposer liste au démarrage (comme prévu)
- Permettre création nouvelle session
- Marquer session "active" vs "archived"

**Action** : Clarifier UX dans étape 10

### 8. Code Semantic Search - Détection Sous-Répertoire

**Problème potentiel** :
- Normalisation des chemins nécessaire (symlinks, chemins relatifs vs absolus)
- Détection précise du sous-répertoire peut être complexe

**Solution** :
- Utiliser `path.relative(projectRoot, cwd)` pour calculer chemin relatif
- Normaliser avec `path.normalize()` et résoudre symlinks si nécessaire
- Vérifier que `relativePath !== '.'` et `relativePath !== ''` (pas à la racine)

**Action** : Ajouter helper `isSubdirectory(cwd, projectRoot): boolean` dans étape 5.3

### 9. Code Semantic Search - startLine/endLine Manquants

**Problème potentiel** :
- Certains scopes peuvent ne pas avoir `startLine`/`endLine` (scopes globaux, etc.)
- Risque d'erreur si on essaie d'éditer sans lignes

**Solution** :
- Filtrer dans requête Cypher : `WHERE s.startLine IS NOT NULL AND s.endLine IS NOT NULL`
- Si scope n'a pas de lignes, ne pas l'inclure dans résultats
- Logger warning si beaucoup de scopes sans lignes

**Action** : Ajouter filtres dans requête Cypher étape 5.3

## Recommandations Finales

### ✅ Points Forts à Conserver
- Architecture claire et bien documentée
- Système de pourcentage flexible
- Last User Queries pour contexte immédiat
- Validations et gestion d'erreurs prévues

### 🔧 Améliorations à Ajouter
1. **Ajouter ConversationLock** avant stockage (éviter race conditions)
2. **Calcul atomique** des char_range_start/end
3. **Flag `summarizing`** sur turns pour éviter doubles résumés
4. **Optimiser requêtes Cypher** avec index vectoriel
5. **Script de migration** si nécessaire
6. **Monitoring coûts** embeddings
7. **Code Semantic Search** : Vérifier conditions (sous-répertoire + lock disponible) avant recherche
8. **Code Semantic Search** : Filtrer uniquement Scope nodes, exclure documents
9. **Code Semantic Search** : Limite intelligente (100 initiaux → 10% chars avec meilleurs scores)
10. **Code Semantic Search** : Inclure `startLine` et `endLine` dans résultats (CRITIQUE pour édition)
11. **Code Semantic Search** : Filtrer scopes sans `startLine`/`endLine` (ne pas inclure dans résultats)
12. **Code Semantic Search** : Normalisation précise des chemins pour détection sous-répertoire

### 📊 Risques Restants (Acceptables)
- Coût embeddings : Très faible (~$0.001 par conversation)
- Performance : Parallélisation des recherches sémantiques réduit le temps total (conversation + code en même temps)
- Complexité : Gestion des locks ajoute de la complexité mais nécessaire
- Code Semantic Search : Peut ralentir légèrement si beaucoup de résultats, mais limite de 10% chars protège
- Code Semantic Search : Nécessite détection précise du sous-répertoire (normalisation des chemins)
- Code Semantic Search : Certains scopes peuvent ne pas avoir `startLine`/`endLine` (filtrer dans requête)

## Conclusion

Le plan est **solide et bien structuré**, mais nécessite quelques ajouts pour gérer la concurrence et la synchronisation. Les améliorations proposées sont réalistes et alignées avec les patterns existants dans le codebase (ConversationLock, IngestionLock).

**Recommandation** : Procéder avec le plan en ajoutant les améliorations critiques (locks, atomicité) dès le début.
