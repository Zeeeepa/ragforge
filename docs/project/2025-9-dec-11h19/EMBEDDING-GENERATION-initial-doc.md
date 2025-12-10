cursor-agent --resume=0ad5b8e5-293d-407c-9bd6-f74391322d87

# Génération d'Embeddings pour Turns et Résumés

Date: 2025-12-09

## Contexte : Ingestion vs Stockage Direct

### Ingestion dans le Brain (Code/Fichiers)

L'ingestion dans le brain se fait via `BrainManager.quickIngest()` pour ingérer du **code et des fichiers** :

- **Quand** : Lors de l'ingestion initiale d'un projet ou lors de modifications de fichiers (via file watcher)
- **Comment** : Utilise `IncrementalIngestionManager` qui parse les fichiers et crée des nœuds (`File`, `Scope`, `Directory`, etc.)
- **Embeddings** : Générés après l'ingestion via `EmbeddingService.generateMultiEmbeddings()` avec système de **hash** pour éviter régénération si contenu identique
- **Raison du hash** : Les fichiers peuvent être réingérés plusieurs fois (modifications, re-ingestion manuelle), donc le hash permet d'éviter de régénérer des embeddings inutilement

### Stockage Direct (Sessions de Chat)

Les **sessions de chat** sont stockées **directement** dans Neo4j, **sans passer par le système d'ingestion** :

- **Quand** : Immédiatement lors de la création d'un turn ou d'un résumé
- **Comment** : Utilise `ConversationStorage` qui crée directement les nœuds (`Conversation`, `Message`, `ToolCall`, `Summary`)
- **Embeddings** : Générés directement via `GeminiEmbeddingProvider` et stockés dans les propriétés `embedding` des nœuds
- **Pas de hash** : Chaque turn/résumé est unique et créé une seule fois, donc pas besoin de hash

**Différence clé** : Le brain ingère du **code réutilisable** (peut changer), les conversations sont des **événements uniques** (ne changent jamais).

## Provider d'Embedding Existant

RagForge utilise **`GeminiEmbeddingProvider`** (`packages/core/src/runtime/embedding/embedding-provider.ts`) qui :
- Utilise Gemini avec **3072 dimensions** (meilleure qualité)
- Supporte le batch processing pour performance
- Dispose de méthodes : `embed()` pour batch, `embedSingle()` pour un seul texte

**Note** : On utilise directement le provider, pas le `EmbeddingService` (qui est pour ingérer du code dans le brain). Pour les conversations, on gère le stockage nous-mêmes.

## Structure des Niveaux de Résumé

Le système utilise **3 niveaux** de résumé :

### L0 - Turns (Niveau 0)
- **Type** : Contenu brut (messages individuels)
- **Contenu** : User message + Assistant message + Tool calls + Tool results
- **Stockage** : Nœud `Message` avec propriété `timestamp`
- **Embedding** : Généré à partir du contenu combiné du turn
- **Usage** : Contexte récent immédiat, recherche sémantique sur actions récentes

### L1 - Short Term Summaries (Niveau 1)
- **Type** : Résumés court terme
- **Contenu** : Résumé structuré de plusieurs turns (tous les N caractères de conversation brute)
- **Stockage** : Nœud `Summary` avec `level: 1` et propriété `created_at`
- **Embedding** : Généré à partir du résumé textuel + fichiers mentionnés + découvertes
- **Usage** : Recherche sémantique sur contexte court terme, conservation de l'historique récent

### L2 - Long Term Summaries (Niveau 2)
- **Type** : Résumés long terme
- **Contenu** : Résumé structuré de plusieurs résumés L1 (tous les N caractères de résumés L1)
- **Stockage** : Nœud `Summary` avec `level: 2` et propriété `created_at`
- **Embedding** : Généré à partir du résumé textuel + fichiers mentionnés + découvertes agrégées
- **Usage** : Recherche sémantique sur contexte long terme, patterns et thèmes globaux

**Note importante** : Il n'y a **pas de L3** - la hiérarchie s'arrête à L2 (long term summaries). La structure est :
```
L0 (Turns) → L1 (Short Term) → L2 (Long Term)
```

## Stratégie d'Embedding

### L0 - Turns (Niveau 0)

Pour chaque turn, générer un embedding à partir du contenu combiné :

```typescript
function generateTurnEmbeddingText(turn: ConversationTurn): string {
  const parts: string[] = [];
  
  // Message utilisateur
  parts.push(`User: ${turn.userMessage}`);
  
  // Message assistant
  parts.push(`Assistant: ${turn.assistantMessage}`);
  
  // Tool calls (noms + résultats tronqués)
  if (turn.toolResults.length > 0) {
    parts.push('Tools used:');
    for (const tool of turn.toolResults) {
      const resultStr = typeof tool.toolResult === 'string'
        ? tool.toolResult.substring(0, 200)
        : JSON.stringify(tool.toolResult).substring(0, 200);
      parts.push(`- ${tool.toolName}: ${resultStr}`);
    }
  }
  
  return parts.join('\n');
}
```

**Rationale** :
- Un seul embedding par turn (coût réduit)
- Capture le contexte complet de l'échange
- Inclut les résultats d'outils pour recherche sémantique sur actions effectuées

### L1 - Short Term Summaries (Niveau 1)

Pour chaque résumé L1 (short term), générer un embedding à partir du résumé textuel :

```typescript
function generateSummaryEmbeddingText(summary: ConversationSummary): string {
  const parts: string[] = [];
  
  // Résumé principal
  parts.push(summary.summary);
  
  // Fichiers mentionnés (important pour recherche)
  if (summary.filesMentioned.length > 0) {
    parts.push(`Files: ${summary.filesMentioned.join(', ')}`);
  }
  
  // Découvertes clés
  if (summary.keyFindings.length > 0) {
    parts.push(`Findings: ${summary.keyFindings.join('; ')}`);
  }
  
  return parts.join('\n\n');
}
```

**Rationale** :
- Résumé déjà condensé, donc embedding efficace
- Inclut fichiers et découvertes pour meilleure recherche
- Un embedding par résumé L1

### L2 - Long Term Summaries (Niveau 2)

Pour chaque résumé L2 (long term), générer un embedding à partir du résumé textuel :

```typescript
function generateL2SummaryEmbeddingText(summary: ConversationSummary): string {
  const parts: string[] = [];
  
  // Résumé principal (résumé des résumés L1)
  parts.push(summary.summary);
  
  // Fichiers mentionnés (agrégation des fichiers des résumés L1)
  if (summary.filesMentioned.length > 0) {
    parts.push(`Files: ${summary.filesMentioned.join(', ')}`);
  }
  
  // Découvertes clés (agrégation des découvertes des résumés L1)
  if (summary.keyFindings.length > 0) {
    parts.push(`Findings: ${summary.keyFindings.join('; ')}`);
  }
  
  return parts.join('\n\n');
}
```

**Rationale** :
- Résumé L2 = résumé de plusieurs résumés L1
- Plus abstrait et condensé que L1
- Capture les thèmes et patterns à long terme
- Un embedding par résumé L2

## Utilisation du GeminiEmbeddingProvider

### Création du Provider

```typescript
import { GeminiEmbeddingProvider } from '@luciformresearch/ragforge';

const embeddingProvider = new GeminiEmbeddingProvider({
  apiKey: process.env.GEMINI_API_KEY || geminiApiKey,
  model: 'gemini-embedding-001',
  dimension: 3072, // 3072 dimensions pour meilleure qualité
});
```

### Génération d'Embedding pour un Turn

```typescript
async function generateTurnEmbedding(
  embeddingProvider: GeminiEmbeddingProvider,
  turn: ConversationTurn
): Promise<number[]> {
  const embeddingText = generateTurnEmbeddingText(turn);
  
  // Utiliser embedSingle() pour un seul texte
  const embedding = await embeddingProvider.embedSingle(embeddingText);
  
  return embedding; // 3072 dimensions
}
```

### Génération d'Embedding pour Requête (Recherche)

```typescript
async function generateQueryEmbedding(
  embeddingProvider: GeminiEmbeddingProvider,
  query: string
): Promise<number[]> {
  return await embeddingProvider.embedSingle(query);
}
```

### Stockage en Neo4j

Les embeddings sont stockés directement dans les nœuds Neo4j comme tableaux de nombres :

#### Schéma des Nœuds de Conversation

```cypher
// Conversation (session)
CREATE (c:Conversation {
  uuid: "uuid",
  title: "...",
  created_at: datetime(),
  updated_at: datetime(),
  message_count: 0,
  total_chars: 0,
  status: "active"
})

// Message (turn)
CREATE (m:Message {
  uuid: "uuid",
  conversation_id: "uuid",
  role: "user" | "assistant",
  content: "...",
  reasoning: "...",  // Pour messages assistant
  timestamp: datetime(),
  char_count: 1234,
  embedding: [0.1, 0.2, ..., 0.3072]  // 3072 dimensions pour Gemini
})

// ToolCall
CREATE (t:ToolCall {
  uuid: "uuid",
  message_id: "uuid",
  tool_name: "grep_files",
  arguments: "{...}",  // JSON string
  timestamp: datetime(),
  duration_ms: 123,
  success: true,
  iteration: null
})

// ToolResult
CREATE (r:ToolResult {
  uuid: "uuid",
  tool_call_id: "uuid",
  success: true,
  result: "{...}",  // JSON string
  error: null,
  timestamp: datetime(),
  result_size_bytes: 1234
})

// Summary (résumé hiérarchique)
CREATE (s:Summary {
  uuid: "uuid",
  conversation_id: "uuid",
  level: 1,  // 1 = L1 (short term), 2 = L2 (long term)
  conversation_summary: "...",
  actions_summary: "...",
  char_range_start: 0,
  char_range_end: 5000,
  summary_char_count: 567,
  created_at: datetime("2025-12-09T14:30:00.123+01:00"),  // Horodatage avec timezone locale
  parent_summaries: [],  // Array de UUIDs
  embedding: [0.1, 0.2, ..., 0.3072]  // 3072 dimensions
})
```

#### Relations

```cypher
// Conversation → Message
(c:Conversation)-[:HAS_MESSAGE]->(m:Message)

// Message → ToolCall
(m:Message)-[:MADE_TOOL_CALL]->(t:ToolCall)

// ToolCall → ToolResult
(t:ToolCall)-[:PRODUCED_RESULT]->(r:ToolResult)

// Conversation → Summary
(c:Conversation)-[:HAS_SUMMARY]->(s:Summary)

// Summary → File (fichiers mentionnés dans le résumé)
(s:Summary)-[:MENTIONS_FILE]->(f:File)

// Summary → Scope (scopes de code mentionnés, optionnel)
(s:Summary)-[:MENTIONS_SCOPE]->(sc:Scope)
```

**Note importante** : Les relations `MENTIONS_FILE` et `MENTIONS_SCOPE` doivent être créées lors du stockage du résumé pour lier les fichiers mentionnés (extraits via LLM structuré) aux nœuds existants dans le brain.

## Horodatage des Résumés

### Utilisation de formatLocalDate()

Tous les résumés (L0, L1, L2) doivent être horodatés avec `formatLocalDate()` pour permettre le filtrage par date :

```typescript
import { formatLocalDate } from '../utils/timestamp.js';

// Lors de la création d'un résumé
const summary: Summary = {
  uuid: crypto.randomUUID(),
  conversation_id: conversationId,
  level: 1, // ou 2 (L1 ou L2)
  content: {
    conversation_summary: "...",
    actions_summary: "..."
  },
  char_range_start: 0,
  char_range_end: 5000,
  summary_char_count: 567,
  created_at: new Date(), // Date JavaScript
  parent_summaries: []
};

// Stockage avec conversion en date locale
await storage.storeSummary(summary);
// Dans storeSummary(), formatLocalDate() convertit automatiquement :
// new Date() → "2025-12-09T14:30:00.123+01:00"
```

**Note** : 
- **L0 (Messages/Turns)** : Utilisent `timestamp` (déjà horodatés)
- **L1 (Short Term Summaries)** : Utilisent `created_at` (doit être horodaté avec `formatLocalDate()`)
- **L2 (Long Term Summaries)** : Utilisent `created_at` (doit être horodaté avec `formatLocalDate()`)

### Fonction formatLocalDate()

La fonction `formatLocalDate()` (`packages/core/src/runtime/utils/timestamp.ts`) convertit une Date JavaScript en string ISO avec timezone locale :

```typescript
import { formatLocalDate } from '../utils/timestamp.js';

const date = new Date();
const localDateString = formatLocalDate(date);
// Résultat : "2025-12-09T14:30:00.123+01:00" (avec timezone locale)

// Utilisation dans Neo4j
await neo4j.run(
  `CREATE (s:Summary {
    created_at: datetime($created_at)
  })`,
  { created_at: formatLocalDate(new Date()) }
);
```

### Filtrage par Date dans Neo4j

Une fois horodatés, on peut filtrer les résumés par date :

```cypher
// Résumés créés après une date spécifique
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.created_at >= datetime($startDate)
RETURN s
ORDER BY s.created_at DESC

// Résumés créés dans une plage de dates
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.created_at >= datetime($startDate)
  AND s.created_at <= datetime($endDate)
RETURN s
ORDER BY s.created_at ASC

// Résumés créés dans les N derniers jours
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.created_at >= datetime() - duration({days: $days})
RETURN s
ORDER BY s.created_at DESC

// Résumés récents (dernières 24h)
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.created_at >= datetime() - duration({hours: 24})
RETURN s
ORDER BY s.created_at DESC
```

### Trim par Date (Nettoyage)

Pour nettoyer les anciens résumés :

```typescript
/**
 * Supprime les résumés plus anciens qu'une date donnée
 */
async function trimSummariesByDate(
  storage: ConversationStorage,
  conversationId: string,
  beforeDate: Date,
  level?: number
): Promise<number> {
  const levelFilter = level !== undefined ? 'AND s.level = $level' : '';
  const beforeDateString = formatLocalDate(beforeDate);
  
  const result = await storage.neo4j.run(
    `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
     WHERE s.created_at < datetime($beforeDate)
     ${levelFilter}
     DETACH DELETE s
     RETURN count(s) AS deleted`,
    {
      conversationId,
      beforeDate: beforeDateString,
      level
    }
  );
  
  return result.records[0]?.get('deleted')?.toNumber() || 0;
}

// Exemple : Supprimer les résumés L1 (short term) de plus de 30 jours
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
const deletedL1 = await trimSummariesByDate(storage, conversationId, thirtyDaysAgo, 1);
console.log(`Deleted ${deletedL1} old L1 (short term) summaries`);

// Exemple : Supprimer les résumés L2 (long term) de plus de 90 jours
const ninetyDaysAgo = new Date();
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
const deletedL2 = await trimSummariesByDate(storage, conversationId, ninetyDaysAgo, 2);
console.log(`Deleted ${deletedL2} old L2 (long term) summaries`);
```

### Requêtes Utiles avec Dates

```cypher
// Résumés par niveau et par date
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.level = $level
  AND s.created_at >= datetime($startDate)
RETURN s
ORDER BY s.created_at DESC

// Derniers résumés créés (tous niveaux confondus)
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
RETURN s
ORDER BY s.created_at DESC
LIMIT 10

// Statistiques par date
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.created_at >= datetime($startDate)
RETURN 
  s.level AS level,
  count(s) AS count,
  min(s.created_at) AS oldest,
  max(s.created_at) AS newest
ORDER BY s.level ASC

// Recherche sémantique avec filtre de date
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.embedding IS NOT NULL
  AND s.created_at >= datetime($startDate)
WITH s, vector.similarity.cosine(s.embedding, $queryEmbedding) AS score
WHERE score > $minScore
RETURN s, score
ORDER BY score DESC
LIMIT 5
```

### Intégration dans ConversationStorage

```typescript
export class ConversationStorage {
  // ... méthodes existantes ...
  
  async getSummariesByDateRange(
    conversationId: string,
    startDate: Date,
    endDate: Date,
    level?: number
  ): Promise<Summary[]> {
    const levelFilter = level !== undefined ? 'AND s.level = $level' : '';
    const startDateString = formatLocalDate(startDate);
    const endDateString = formatLocalDate(endDate);
    
    const result = await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
       WHERE s.created_at >= datetime($startDate)
         AND s.created_at <= datetime($endDate)
       ${levelFilter}
       RETURN s
       ORDER BY s.created_at ASC`,
      {
        conversationId,
        startDate: startDateString,
        endDate: endDateString,
        level
      }
    );
    
    return result.records.map(r => {
      const props = r.get('s').properties;
      return {
        uuid: props.uuid,
        conversation_id: props.conversation_id,
        level: this.toNumber(props.level) || 1,
        content: {
          conversation_summary: props.conversation_summary || '',
          actions_summary: props.actions_summary || ''
        },
        char_range_start: this.toNumber(props.char_range_start),
        char_range_end: this.toNumber(props.char_range_end),
        summary_char_count: this.toNumber(props.summary_char_count),
        created_at: props.created_at,
        embedding: props.embedding || undefined,
        parent_summaries: props.parent_summaries || undefined
      };
    });
  }
  
  async getRecentSummaries(
    conversationId: string,
    days: number = 7,
    level?: number
  ): Promise<Summary[]> {
    const levelFilter = level !== undefined ? 'AND s.level = $level' : '';
    
    const result = await this.neo4j.run(
      `MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
       WHERE s.created_at >= datetime() - duration({days: $days})
       ${levelFilter}
       RETURN s
       ORDER BY s.created_at DESC`,
      {
        conversationId,
        days,
        level
      }
    );
    
    // ... mapping comme ci-dessus ...
  }
}
```

#### Stockage des Embeddings

Les embeddings sont stockés directement dans les propriétés `embedding` des nœuds `Message` et `Summary` :

```typescript
// Pour un Message (turn)
await conversationStorage.updateMessageEmbedding(messageUuid, embedding);

// Pour un Summary
await conversationStorage.updateSummaryEmbedding(summaryUuid, embedding);
```

**Note** : Pour les sessions de chat, chaque turn est créé une seule fois et ne change jamais. Il n'est donc pas nécessaire d'utiliser un hash pour éviter la régénération d'embeddings (contrairement à l'ingestion de code où les fichiers peuvent être réingérés plusieurs fois).

```typescript
// Générer et stocker l'embedding lors de la création du turn
const embeddingText = generateTurnEmbeddingText(turn);
const embedding = await embeddingProvider.embedSingle(embeddingText);
await conversationStorage.updateMessageEmbedding(messageUuid, embedding);
```

## Relations avec Fichiers et Code Mentionnés

### Extraction des Filepaths depuis les Résumés

Les résumés extraient automatiquement les filepaths mentionnés via le LLM structuré (`ConversationSummarizer`) :

```typescript
interface ConversationSummary {
  summary: string;
  filesMentioned: string[];  // Filepaths extraits par le LLM
  keyFindings: string[];
  toolsUsed: string[];
  topics: string[];
}
```

Les filepaths peuvent être dans différents formats :
- **Chemins absolus** : `/home/user/project/src/index.ts`
- **Chemins relatifs** : `src/index.ts`, `./src/index.ts`
- **Chemins depuis root** : `packages/core/src/index.ts`

### Création des Relations avec les Fichiers Existants

Lors du stockage d'un résumé, il faut créer des relations `MENTIONS_FILE` vers les nœuds `File` existants dans Neo4j si les fichiers sont ingérés dans le brain.

#### Matching des Filepaths

Les filepaths extraits doivent être normalisés et matchés avec les fichiers existants :

```typescript
import * as path from 'path';
import type { Neo4jClient } from '../client/neo4j-client.js';

/**
 * Normalise un filepath et trouve le nœud File correspondant dans Neo4j
 */
async function findFileNode(
  neo4j: Neo4jClient,
  filePath: string,
  projectRoot?: string
): Promise<{ uuid: string; path: string } | null> {
  // Normaliser le chemin (enlever ./ et ../)
  const normalized = path.normalize(filePath).replace(/^\.\//, '');
  
  // Essayer plusieurs formats de matching
  const candidates = [
    normalized,                    // Format exact
    normalized.replace(/^\//, ''), // Sans leading slash
    path.relative(projectRoot || '', normalized), // Relatif au projet
  ];
  
  // Chercher dans Neo4j
  for (const candidate of candidates) {
    const result = await neo4j.run(
      `MATCH (f:File)
       WHERE f.path = $path OR f.path ENDS WITH $path
       RETURN f.uuid AS uuid, f.path AS path
       LIMIT 1`,
      { path: candidate }
    );
    
    if (result.records.length > 0) {
      return {
        uuid: result.records[0].get('uuid'),
        path: result.records[0].get('path')
      };
    }
  }
  
  return null; // Fichier non trouvé dans le brain
}
```

#### Stockage avec Relations

```typescript
async function storeSummaryWithFileRelations(
  storage: ConversationStorage,
  summary: Summary,
  filesMentioned: string[],
  projectRoot?: string
): Promise<void> {
  // 1. Stocker le résumé
  await storage.storeSummary(summary);
  
  // 2. Créer les relations avec les fichiers mentionnés
  for (const filePath of filesMentioned) {
    const fileNode = await findFileNode(storage.neo4j, filePath, projectRoot);
    
    if (fileNode) {
      // Créer relation Summary → File
      await storage.neo4j.run(
        `MATCH (s:Summary {uuid: $summaryUuid})
         MATCH (f:File {uuid: $fileUuid})
         MERGE (s)-[:MENTIONS_FILE]->(f)`,
        {
          summaryUuid: summary.uuid,
          fileUuid: fileNode.uuid
        }
      );
    }
  }
}
```

#### Relations avec Scopes (Optionnel)

Si on veut aussi lier aux scopes de code spécifiques mentionnés :

```typescript
/**
 * Trouve les scopes dans un fichier qui correspondent à des mentions dans le résumé
 * (par exemple, si le résumé mentionne "la fonction calculateTotal")
 */
async function findMentionedScopes(
  neo4j: Neo4jClient,
  fileUuid: string,
  summaryText: string
): Promise<string[]> {
  // Chercher les scopes dans le fichier qui pourraient être mentionnés
  // (par nom, par contexte, etc.)
  const result = await neo4j.run(
    `MATCH (f:File {uuid: $fileUuid})<-[:DEFINED_IN]-(sc:Scope)
     WHERE sc.name IS NOT NULL
     RETURN sc.uuid AS uuid, sc.name AS name
     LIMIT 20`,
    { fileUuid }
  );
  
  // Filtrer ceux qui sont probablement mentionnés dans le résumé
  // (simple matching par nom pour l'instant)
  const mentionedScopes: string[] = [];
  for (const record of result.records) {
    const name = record.get('name');
    if (summaryText.toLowerCase().includes(name.toLowerCase())) {
      mentionedScopes.push(record.get('uuid'));
    }
  }
  
  return mentionedScopes;
}

async function createScopeRelations(
  storage: ConversationStorage,
  summaryUuid: string,
  fileUuid: string,
  summaryText: string
): Promise<void> {
  const scopeUuids = await findMentionedScopes(storage.neo4j, fileUuid, summaryText);
  
  for (const scopeUuid of scopeUuids) {
    await storage.neo4j.run(
      `MATCH (s:Summary {uuid: $summaryUuid})
       MATCH (sc:Scope {uuid: $scopeUuid})
       MERGE (s)-[:MENTIONS_SCOPE]->(sc)`,
      {
        summaryUuid,
        scopeUuid
      }
    );
  }
}
```

### Requêtes Utiles avec Relations

Une fois les relations créées, on peut faire des requêtes croisées :

```cypher
// Trouver tous les résumés qui mentionnent un fichier spécifique
MATCH (f:File {path: 'src/index.ts'})<-[:MENTIONS_FILE]-(s:Summary)
RETURN s

// Trouver tous les fichiers mentionnés dans une conversation
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)-[:MENTIONS_FILE]->(f:File)
RETURN DISTINCT f.path AS filePath, f.uuid AS fileUuid

// Trouver les scopes de code mentionnés dans une conversation
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)-[:MENTIONS_SCOPE]->(sc:Scope)
RETURN DISTINCT sc.name AS scopeName, sc.type AS scopeType, sc.file AS filePath

// Recherche sémantique avec contexte de fichiers
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE vector.similarity.cosine(s.embedding, $queryEmbedding) > 0.7
OPTIONAL MATCH (s)-[:MENTIONS_FILE]->(f:File)
OPTIONAL MATCH (s)-[:MENTIONS_SCOPE]->(sc:Scope)
RETURN s, collect(DISTINCT f.path) AS mentionedFiles, collect(DISTINCT sc.name) AS mentionedScopes
ORDER BY vector.similarity.cosine(s.embedding, $queryEmbedding) DESC
LIMIT 5
```

### Intégration dans ConversationStorage

```typescript
export class ConversationStorage {
  // ... méthodes existantes ...
  
  async storeSummaryWithRelations(
    summary: Summary,
    filesMentioned: string[],
    projectRoot?: string
  ): Promise<void> {
    // 1. Stocker le résumé
    await this.storeSummary(summary);
    
    // 2. Créer relations avec fichiers
    for (const filePath of filesMentioned) {
      const fileNode = await this.findFileNode(filePath, projectRoot);
      if (fileNode) {
        await this.neo4j.run(
          `MATCH (s:Summary {uuid: $summaryUuid})
           MATCH (f:File {uuid: $fileUuid})
           MERGE (s)-[:MENTIONS_FILE]->(f)`,
          {
            summaryUuid: summary.uuid,
            fileUuid: fileNode.uuid
          }
        );
      }
    }
  }
  
  private async findFileNode(
    filePath: string,
    projectRoot?: string
  ): Promise<{ uuid: string; path: string } | null> {
    // Implémentation du matching (voir ci-dessus)
  }
}
```

## Recherche Sémantique

La recherche sémantique peut être effectuée sur **tous les niveaux** (L0, L1, L2) pour trouver le contexte le plus pertinent :

- **L0 (Turns)** : Pour trouver des actions récentes spécifiques (tool calls, résultats)
- **L1 (Short Term)** : Pour trouver du contexte récent condensé
- **L2 (Long Term)** : Pour trouver des patterns et thèmes à long terme

### Génération d'Embedding pour Requête

Utiliser directement `GeminiEmbeddingProvider.embedSingle()` :

```typescript
const queryEmbedding = await embeddingProvider.embedSingle(userMessage);
```

### Requête avec Similarité Cosine

Pour Neo4j 5.15+, utiliser la fonction native `vector.similarity.cosine()` :

```cypher
// Recherche dans L0 (Messages/Turns)
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_MESSAGE]->(m:Message)
WHERE m.embedding IS NOT NULL
WITH m, vector.similarity.cosine(m.embedding, $queryEmbedding) AS score
WHERE score > $minScore
RETURN 'L0' as level, m, null as summary, score
ORDER BY score DESC
LIMIT 3

UNION

// Recherche dans L1 (Short Term Summaries)
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.embedding IS NOT NULL
  AND s.level = 1  // L1 seulement
WITH s, vector.similarity.cosine(s.embedding, $queryEmbedding) AS score
WHERE score > $minScore
RETURN 'L1' as level, null as message, s as summary, score
ORDER BY score DESC
LIMIT 5

UNION

// Recherche dans L2 (Long Term Summaries)
MATCH (c:Conversation {uuid: $conversationId})-[:HAS_SUMMARY]->(s:Summary)
WHERE s.embedding IS NOT NULL
  AND s.level = 2  // L2 seulement
WITH s, vector.similarity.cosine(s.embedding, $queryEmbedding) AS score
WHERE score > $minScore
RETURN 'L2' as level, null as message, s as summary, score
ORDER BY score DESC
LIMIT 3
```

**Note** : 
- Neo4j 5.15+ : Utiliser `vector.similarity.cosine()` (fonction native)
- Neo4j < 5.15 : Utiliser GDS (Graph Data Science) avec `gds.similarity.cosine()`
- Le code actuel dans `ConversationStorage.findSimilarMessages()` et `ConversationStorage.getRAGContext()` utilise déjà `vector.similarity.cosine()`
- On peut combiner les résultats de tous les niveaux (L0, L1, L2) pour un contexte enrichi

## Coûts et Optimisations

### Coût par Embedding

- Gemini gemini-embedding-001 : ~$0.00001 par embedding (**3072 dimensions**)
- **L0 (Turn)** : 1 embedding par turn
- **L1 (Short Term Summary)** : 1 embedding par résumé L1
- **L2 (Long Term Summary)** : 1 embedding par résumé L2

### Optimisations

1. **Vérification d'existence** : Vérifier si l'embedding existe déjà pour ce turn avant génération
2. **Batch processing** : Utiliser `embed()` pour générer plusieurs embeddings en parallèle lors de la création de plusieurs turns
3. **Troncature** : Limiter taille du texte avant embedding (max 4000 chars recommandé)
4. **Génération asynchrone** : Générer les embeddings en arrière-plan pour ne pas bloquer la création du turn

### Vérification avant Génération

Éviter de régénérer un embedding si le turn en possède déjà un :

```typescript
// Vérifier si l'embedding existe déjà
const existingEmbedding = await getTurnEmbedding(sessionId, turn.uuid);

if (existingEmbedding) {
  // Embedding déjà généré, skip
  return;
}

// Générer nouvel embedding seulement si nécessaire
const embeddingText = generateTurnEmbeddingText(turn);
const embedding = await embeddingProvider.embedSingle(embeddingText);
await storeTurnEmbedding(sessionId, turn.uuid, embedding);
```

## Exemple d'Implémentation

```typescript
async function storeTurnWithEmbedding(
  sessionId: string,
  turn: ConversationTurn,
  toolCalls: ToolCall[],
  embeddingProvider: GeminiEmbeddingProvider
): Promise<void> {
  // 1. Stocker turn et tool calls
  await storeTurnAndToolCalls(sessionId, turn, toolCalls);
  
  // 2. Vérifier si l'embedding existe déjà
  const existingEmbedding = await getTurnEmbedding(sessionId, turn.uuid);
  if (existingEmbedding) {
    return; // Embedding déjà généré
  }
  
  // 3. Générer texte pour embedding
  const embeddingText = generateTurnEmbeddingText(turn);
  
  // 4. Générer et stocker l'embedding
  const embedding = await embeddingProvider.embedSingle(embeddingText);
  await storeTurnEmbedding(sessionId, turn.uuid, embedding);
}
```

### Intégration avec ConversationStorage

Le `ConversationStorage` (`packages/core/src/runtime/conversation/storage.ts`) stocke déjà les conversations directement dans Neo4j. Pour ajouter la génération d'embeddings :

```typescript
import { GeminiEmbeddingProvider } from '@luciformresearch/ragforge';
import { ConversationStorage } from './storage.js';

export class ConversationStorageWithEmbeddings extends ConversationStorage {
  constructor(
    neo4j: Neo4jClient,
    private embeddingProvider: GeminiEmbeddingProvider
  ) {
    super(neo4j);
  }
  
  async storeMessageWithEmbedding(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    reasoning?: string
  ): Promise<string> {
    // 1. Stocker le message (utilise storeMessage existant)
    const messageUuid = await this.storeMessage({
      conversation_id: conversationId,
      role,
      content,
      reasoning,
      timestamp: new Date()
    });
    
    // 2. Vérifier si l'embedding existe déjà
    const existing = await this.getMessages(conversationId, { limit: 1 });
    const message = existing.find(m => m.uuid === messageUuid);
    if (message?.embedding) {
      return messageUuid; // Embedding déjà généré
    }
    
    // 3. Générer texte pour embedding
    const embeddingText = this.generateMessageEmbeddingText(role, content, reasoning);
    
    // 4. Générer et stocker embedding (en parallèle, non-bloquant)
    this.embeddingProvider.embedSingle(embeddingText)
      .then(embedding => this.updateMessageEmbedding(messageUuid, embedding))
      .catch(err => console.error('Failed to generate message embedding:', err));
    
    return messageUuid;
  }
  
  async storeSummaryWithEmbedding(summary: Summary): Promise<void> {
    // 1. Stocker le résumé (utilise storeSummary existant)
    await this.storeSummary(summary);
    
    // 2. Vérifier si l'embedding existe déjà
    const existing = await this.getSummaries(summary.conversation_id, summary.level);
    const existingSummary = existing.find(s => s.uuid === summary.uuid);
    if (existingSummary?.embedding) {
      return; // Embedding déjà généré
    }
    
    // 3. Générer texte pour embedding
    const embeddingText = this.generateSummaryEmbeddingText(summary);
    
    // 4. Générer et stocker embedding (en parallèle, non-bloquant)
    this.embeddingProvider.embedSingle(embeddingText)
      .then(embedding => this.updateSummaryEmbedding(summary.uuid, embedding))
      .catch(err => console.error('Failed to generate summary embedding:', err));
  }
  
  private generateMessageEmbeddingText(
    role: string,
    content: string,
    reasoning?: string
  ): string {
    const parts: string[] = [];
    parts.push(`${role === 'user' ? 'User' : 'Assistant'}: ${content}`);
    if (reasoning) {
      parts.push(`Reasoning: ${reasoning.substring(0, 500)}`);
    }
    return parts.join('\n');
  }
  
  private generateSummaryEmbeddingText(summary: Summary): string {
    const parts: string[] = [];
    parts.push(summary.content.conversation_summary);
    if (summary.content.actions_summary) {
      parts.push(`Actions: ${summary.content.actions_summary}`);
    }
    return parts.join('\n\n');
  }
}
```

**Note** : Le `ConversationStorage` actuel expose déjà les méthodes `updateMessageEmbedding()` et `updateSummaryEmbedding()` pour stocker les embeddings. Il suffit d'ajouter la génération d'embeddings lors de la création des messages/résumés.
