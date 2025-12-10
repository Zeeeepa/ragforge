# Architecture : Système de Mémoire Conversationnelle

Date: 2025-12-09

## Vue d'Ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                    User Message                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Agent.ask() avec contexte enrichi                          │
│  - Contenu brut récent (2-3 tours)                         │
│  - Résultats recherche sémantique (résumés pertinents)     │
│  - Résumés niveau 1 non encore résumés en niveau 2         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Tool Calls (exécutés)                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Assistant Response                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
┌──────────────┐            ┌─────────────────────┐
│ Store Turn   │            │ Summarize Turn      │
│ + Tool Calls │            │ (en parallèle)      │
│ in Neo4j    │            └──────────┬──────────┘
└──────────────┘                      │
                                       ▼
                            ┌─────────────────────┐
                            │ Store Summary L1     │
                            │ + Generate Embedding│
                            └──────────┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │ Semantic Search     │
                            │ (pour prochain tour)│
                            └─────────────────────┘
```

## Flux de Données

### 1. Tour de Conversation

```typescript
// Après chaque réponse de l'agent
const completedTurn: ConversationTurn = {
  userMessage: "...",
  assistantMessage: "...",
  toolResults: [...],
  timestamp: Date.now(),
};

// Stockage immédiat (synchrone)
await conversationStorage.storeTurn(sessionId, completedTurn, toolCalls);

// Résumé en parallèle (asynchrone, non-bloquant)
conversationStorage.summarizeTurn(completedTurn).then(summary => {
  // Stocker résumé niveau 1 avec embedding
  conversationStorage.storeSummary(sessionId, summary, 1, [completedTurn.id]);
  
  // Vérifier si historique brut dépasse 5k chars
  const rawHistoryChars = conversationStorage.getRawHistoryCharCount(sessionId);
  if (rawHistoryChars > 5000) {
    // Déclencher résumé hiérarchique
    conversationStorage.summarizeSummaries(sessionId, 1);
  }
});
```

### 2. Recherche Sémantique (avant chaque appel agent)

```typescript
// Avant agent.ask()
// Recherche sur turns (niveau 0) ET résumés (niveaux 1+)
const semanticResults = await conversationStorage.searchConversationHistory(
  sessionId,
  userMessage,
  {
    semantic: true,
    maxResults: 5,
    includeTurns: true,  // Inclure les turns (niveau 0)
    levels: [0, 1, 2, 3], // Chercher dans tous les niveaux (0 = turns, 1+ = résumés)
  }
);

// Récupérer résumés niveau 1 non encore résumés en niveau 2
const level1SummariesNotSummarized = await conversationStorage.getLevel1SummariesNotSummarized(
  sessionId,
  { limit: 10 } // Limite raisonnable
);

// Construire contexte enrichi
const enrichedContext = {
  recentTurns: await conversationStorage.getRecentTurns(sessionId, {
    maxChars: 5000,
    limit: 3,
  }),
  semanticResults: semanticResults, // Turns (niveau 0) ET résumés pertinents (tous niveaux)
  level1SummariesNotSummarized: level1SummariesNotSummarized, // Résumés L1 non encore résumés
};
```

### 3. Contexte Passé à l'Agent

```typescript
const context = `
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
${result.summary.summary}

Key findings: ${result.summary.keyFindings.join(', ')}
Files mentioned: ${result.summary.filesMentioned.join(', ')}
`).join('\n')}

## Recent Level 1 Summaries (Not Yet Summarized to Level 2)
${enrichedContext.level1SummariesNotSummarized.map(summary => `
[Level 1 Summary]
${summary.summary}

Key findings: ${summary.keyFindings.join(', ')}
Files mentioned: ${summary.filesMentioned.join(', ')}
Tools used: ${summary.toolsUsed.join(', ')}
`).join('\n')}
`;
```

## Schéma Neo4j Détaillé

### Nodes

```cypher
// Session (liée au CWD)
CREATE (s:ConversationSession {
  sessionId: "uuid",
  startTime: datetime(),
  lastActivity: datetime(),
  cwd: "/home/user/project",  // Current Working Directory (normalisé)
  projectPath: "/path/to/project"  // Project path si projet RagForge
})

// Turn (Niveau 0 = contenu brut)
CREATE (t:ConversationTurn {
  uuid: "uuid",
  userMessage: "...",
  assistantMessage: "...",
  timestamp: datetime(),
  turnIndex: 1,
  charCount: 1234,
  level: 0,  // Niveau 0 = contenu brut
  embedding: [0.1, 0.2, ...],  // Vector embedding (3072 dimensions via EmbeddingService)
  embedding_hash: "abc123..."  // Hash pour cache (géré par EmbeddingService)
})

// Tool Call
CREATE (tc:ToolCall {
  uuid: "uuid",
  toolName: "grep_files",
  toolArgs: "{...}",  // JSON string
  toolResult: "{...}", // JSON string
  success: true,
  durationMs: 123,
  timestamp: datetime()
})

// Summary Level 1
CREATE (s1:ConversationSummary {
  uuid: "uuid",
  summary: "...",
  level: 1,
  charCount: 567,
  turnCount: 1,
  filesMentioned: ["file1.ts", "file2.ts"], // JSON array string
  keyFindings: ["finding1", "finding2"],    // JSON array string
  toolsUsed: ["grep_files", "read_file"],   // JSON array string
  topics: ["topic1", "topic2"],             // JSON array string
  timestamp: datetime(),
  embedding: [0.1, 0.2, ...],  // Vector embedding (3072 dimensions via EmbeddingService)
  embedding_hash: "def456..."  // Hash pour cache (géré par EmbeddingService)
})

// Summary Level 2+
CREATE (s2:ConversationSummary {
  uuid: "uuid",
  summary: "...",
  level: 2,
  charCount: 890,
  turnCount: 5,  // Somme des tours résumés
  // ... mêmes propriétés que niveau 1
})
```

### Relations

```cypher
// Session → Turn
(session)-[:HAS_TURN {index: 1}]->(turn)

// Turn → Tool Call
(turn)-[:HAS_TOOL_CALL {order: 0}]->(toolCall)

// Session → Summary
(session)-[:HAS_SUMMARY {level: 1}]->(summary)

// Summary → Turn (si niveau 1)
(summary)-[:SUMMARIZES {level: 1}]->(turn)

// Summary → Summary (si niveau 2+)
(summary2)-[:SUMMARIZES {level: 2}]->(summary1)
```

## Requêtes Cypher Utiles

### Récupérer tours récents

```cypher
MATCH (s:ConversationSession {sessionId: $sessionId})
MATCH (s)-[:HAS_TURN]->(t:ConversationTurn)
WITH t ORDER BY t.timestamp DESC
LIMIT 3
MATCH (t)-[:HAS_TOOL_CALL]->(tc:ToolCall)
RETURN t, collect(tc) as toolCalls
ORDER BY t.timestamp ASC
```

### Recherche sémantique (turns + résumés)

```cypher
// Recherche sur turns (niveau 0)
MATCH (s:ConversationSession {sessionId: $sessionId})
MATCH (s)-[:HAS_TURN]->(t:ConversationTurn)
WITH t,
  gds.similarity.cosine(t.embedding, $queryEmbedding) as score
WHERE score > 0.7
RETURN 'turn' as type, t, null as summary, score
ORDER BY score DESC
LIMIT 3

UNION

// Recherche sur résumés (niveaux 1+)
MATCH (s:ConversationSession {sessionId: $sessionId})
MATCH (s)-[:HAS_SUMMARY]->(sum:ConversationSummary)
WHERE sum.level >= 1
WITH sum,
  gds.similarity.cosine(sum.embedding, $queryEmbedding) as score
WHERE score > 0.7
RETURN 'summary' as type, null as turn, sum as summary, score
ORDER BY score DESC
LIMIT 5

// Fusionner et trier par score
ORDER BY score DESC
LIMIT 5
```

### Calculer taille historique brut

```cypher
MATCH (s:ConversationSession {sessionId: $sessionId})
MATCH (s)-[:HAS_TURN]->(t:ConversationTurn)
WHERE NOT EXISTS {
  MATCH (s)-[:HAS_SUMMARY]->(sum:ConversationSummary {level: 1})
  MATCH (sum)-[:SUMMARIZES]->(t)
}
RETURN sum(t.charCount) as totalChars
```

### Récupérer résumés niveau 1 non résumés en niveau 2

```cypher
MATCH (s:ConversationSession {sessionId: $sessionId})
MATCH (s)-[:HAS_SUMMARY]->(sum1:ConversationSummary {level: 1})
WHERE NOT EXISTS {
  MATCH (s)-[:HAS_SUMMARY]->(sum2:ConversationSummary {level: 2})
  MATCH (sum2)-[:SUMMARIZES]->(sum1)
}
RETURN sum1
ORDER BY sum1.timestamp DESC
LIMIT $limit
```

## Interface ConversationStorage

```typescript
export interface ConversationStorage {
  // Sessions
  createSession(cwd: string, projectPath?: string): Promise<string>; // Retourne sessionId
  getSessionsByCwd(cwd: string): Promise<Array<{
    sessionId: string;
    startTime: Date;
    lastActivity: Date;
    turnCount: number;
    lastMessage?: string;
  }>>;
  loadSession(sessionId: string): Promise<{
    sessionId: string;
    cwd: string;
    projectPath?: string;
    turns: ConversationTurn[];
  }>;
  
  // Stockage
  storeTurn(
    sessionId: string,
    turn: ConversationTurn,
    toolCalls: ToolCall[]
  ): Promise<void>; // Génère aussi l'embedding du turn via EmbeddingService
  
  storeSummary(
    sessionId: string,
    summary: ConversationSummary,
    level: number,
    parentIds: string[]  // IDs des turns ou summaries résumés
  ): Promise<void>;
  
  // Récupération
  getRecentTurns(
    sessionId: string,
    options: { maxChars?: number; limit?: number }
  ): Promise<ConversationTurn[]>;
  
  getRawHistoryCharCount(sessionId: string): Promise<number>;
  
  // Récupération résumés niveau 1 non résumés
  getLevel1SummariesNotSummarized(
    sessionId: string,
    options: { limit?: number }
  ): Promise<ConversationSummary[]>;
  
  // Recherche
  searchConversationHistory(
    sessionId: string,
    query: string,
    options: {
      semantic?: boolean;
      maxResults?: number;
      includeTurns?: boolean; // Inclure les turns (niveau 0)
      levels?: number[]; // [0] = turns, [1,2,3...] = résumés
    }
  ): Promise<Array<{
    type: 'turn' | 'summary';
    turn?: ConversationTurn;
    summary?: ConversationSummary;
    score: number;
  }>>;
  
  // Résumé
  summarizeTurn(turn: ConversationTurn): Promise<ConversationSummary>;
  
  summarizeSummaries(
    sessionId: string,
    level: number
  ): Promise<ConversationSummary>;
}
```

## Points d'Attention

1. **Performance** : Les insertions en BDD doivent être rapides (< 100ms)
2. **Parallélisme** : Le résumé ne doit jamais bloquer la réponse
3. **Erreurs** : Gérer gracieusement les échecs (fallback sur historique brut)
4. **Embeddings** : 
   - Coût en tokens pour chaque turn ET résumé
   - Peut-être batch les générations d'embeddings
   - Pour turns : combiner userMessage + assistantMessage + toolResults pour un seul embedding
5. **Index** : Créer index sur `sessionId`, `timestamp`, `level`, `cwd` pour performance
6. **CWD** : Normaliser les chemins CWD (résoudre les symlinks, chemins relatifs)
7. **Sessions multiples** : Gérer plusieurs sessions pour le même CWD (historique)

## Métriques à Surveiller

- Temps de stockage d'un turn
- Temps de génération d'un résumé
- Temps de recherche sémantique
- Taille de la base de données
- Nombre de résumés par niveau
- Taux de réussite des recherches sémantiques
