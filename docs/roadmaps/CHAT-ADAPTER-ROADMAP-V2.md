# Chat Adapter v2 - Roadmap Complète & Améliorée

Cette roadmap revoit et étend significativement la v1 pour supporter:
- **Conversations multi-participants** (agents nommés + utilisateurs)
- **Modélisation avancée des agents** avec nodes dédiés en BDD
- **Compression hiérarchique précise** avec plan détaillé
- **Système multi-agents** avec orchestration
- **Agents pré-construits** pour RagForge
- **Architecture extensible** pour la communauté

Voir `CHAT-ADAPTER-QUESTIONS.md` pour les considérations détaillées ayant mené à cette roadmap.

---

## 🎯 Objectifs v2 (Extended)

### Objectifs de base (v1)
1. ✅ Adapter générique pour n'importe quel format de chat
2. ✅ Compression hiérarchique automatique (L1, L2, L3)
3. ✅ Embeddings à la volée pour nouveaux messages
4. ✅ RAG sur historique avec semantic search
5. ✅ Compatible avec n'importe quel LLM

### Nouveaux objectifs (v2)
6. 🆕 **Multi-interlocuteurs**: Support de N participants (agents + humains)
7. 🆕 **Agent modeling**: Agents comme entités de première classe en BDD
8. 🆕 **Multi-agent systems**: Orchestration de plusieurs agents collaboratifs
9. 🆕 **Built-in agents**: Agents prêts à l'emploi pour RagForge
10. 🆕 **Developer-friendly**: API intuitive, hooks, événements
11. 🆕 **Observability**: Métriques, analytics, debugging
12. 🆕 **Extensibility**: Plugin system pour agents custom

---

## 📐 Architecture v2

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                     Developer API                            │
│  (ChatSession, AgentOrchestrator, ContextWindowManager)     │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   Chat Adapter  │     │ Agent Framework │
│  (Multi-party)  │     │   (Modeling)    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │ Hierarchical        │
         │ Compressor          │
         │ (L1/L2/L3)         │
         └──────────┬──────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
┌──────────────┐    ┌────────────────┐
│ Neo4j Client │    │ Vector Search  │
└──────────────┘    └────────────────┘
```

### Composants existants (réutilisés)
- ✅ `GenericSummarizer` - packages/runtime/src/summarization/generic-summarizer.ts
- ✅ `SummaryStorage` - packages/runtime/src/summarization/summary-storage.ts
- ✅ `VectorSearch` - packages/runtime/src/vector/vector-search.ts
- ✅ `Neo4jClient` - packages/runtime/src/client/neo4j-client.ts

### Nouveaux composants v2

```
packages/runtime/src/
├── adapters/
│   └── chat-adapter.ts                    // ✅ Base adapter (multi-party)
│
├── chat/
│   ├── session-manager.ts                 // ✅ Gestion des sessions
│   ├── message-store.ts                   // ✅ Stockage messages
│   ├── context-window-manager.ts          // ✅ Gestion contexte optimal
│   └── interlocutor-registry.ts           // 🆕 Registre des interlocuteurs
│
├── agents/
│   ├── agent-framework.ts                 // 🆕 Framework de base pour agents
│   ├── agent-builder.ts                   // 🆕 Builder pour créer agents
│   ├── agent-registry.ts                  // 🆕 Registre global des agents
│   ├── agent-orchestrator.ts              // 🆕 Orchestration multi-agents
│   └── built-in/
│       ├── code-review-agent.ts           // 🆕 Agent review de code
│       ├── documentation-agent.ts         // 🆕 Agent documentation
│       ├── refactoring-agent.ts           // 🆕 Agent refactoring
│       └── architecture-agent.ts          // 🆕 Agent architecture
│
├── summarization/
│   ├── hierarchical-compressor.ts         // ✅ Compression L1/L2/L3
│   ├── compression-triggers.ts            // 🆕 Logique de déclenchement
│   └── compression-strategies.ts          // 🆕 Stratégies LLM par niveau
│
└── analytics/
    ├── chat-metrics.ts                    // 🆕 Métriques sessions
    ├── agent-metrics.ts                   // 🆕 Métriques agents
    └── compression-metrics.ts             // 🆕 Métriques compression
```

---

## 📊 Schéma Neo4j v2 (Extended)

### 1. Interlocuteurs (Nouveau)

```cypher
// Base pour tous les participants
(:Interlocutor {
  interlocutorId: STRING [UNIQUE],
  type: STRING,              // 'human', 'agent', 'system'
  name: STRING,
  displayName: STRING,
  createdAt: DATETIME,
  isActive: BOOLEAN,
  metadata: MAP
})

// Humains (users)
(:Human:Interlocutor {
  userId: STRING,
  email: STRING,
  displayName: STRING,
  organization: STRING,
  role: STRING,              // 'developer', 'manager', etc.
  preferences: MAP
})

// Agents IA
(:Agent:Interlocutor {
  agentId: STRING [UNIQUE],
  role: STRING,              // 'code_reviewer', 'writer', etc.
  capabilities: LIST<STRING>,
  version: STRING,
  isBuiltIn: BOOLEAN,        // true pour agents fournis par RagForge
  createdBy: STRING          // user qui a créé l'agent custom
})

// System (messages automatiques)
(:System:Interlocutor {
  systemId: STRING,
  purpose: STRING            // 'notification', 'automation', etc.
})
```

### 2. Configuration des Agents (Nouveau)

```cypher
(:AgentConfig {
  configId: STRING [UNIQUE],
  agentId: STRING,
  version: STRING,

  // LLM Configuration
  model: STRING,             // 'gpt-4', 'claude-3', 'gemini-pro'
  temperature: FLOAT,
  maxTokens: INTEGER,
  topP: FLOAT,

  // Persona & Behavior
  personaPrompt: STRING,     // System prompt définissant la personnalité
  instructions: STRING,      // Instructions comportementales

  // Capabilities & Tools
  capabilities: LIST<STRING>,
  enabledTools: LIST<STRING>,

  // Metadata
  createdAt: DATETIME,
  isActive: BOOLEAN,
  metadata: MAP
})

Relations:
(:Agent)-[:CONFIGURED_WITH {activeFrom: DATETIME}]->(:AgentConfig)
(:AgentConfig)-[:PREVIOUS_VERSION]->(:AgentConfig)  // Versioning
```

### 3. Sessions de Chat (Amélioré)

```cypher
(:ChatSession {
  sessionId: STRING [UNIQUE],
  title: STRING,
  createdAt: DATETIME,
  lastActiveAt: DATETIME,
  closedAt: DATETIME,

  // Tokens & Cost
  totalTokens: INTEGER,
  totalCost: FLOAT,

  // Configuration
  compressionEnabled: BOOLEAN,
  maxContextTokens: INTEGER,

  // Metadata
  metadata: MAP,
  tags: LIST<STRING>
})

Relations:
(:Interlocutor)-[:PARTICIPANT_IN {joinedAt: DATETIME, role: STRING}]->(:ChatSession)
(:ChatSession)-[:CREATED_BY]->(:Interlocutor)
```

### 4. Messages (Remplace ChatTurn)

```cypher
(:Message {
  messageId: STRING [UNIQUE],
  content: STRING,
  contentType: STRING,       // 'text', 'code', 'image', 'file', 'tool_result'
  tokens: INTEGER,
  timestamp: DATETIME,

  // Threading (pour branches de conversation)
  threadId: STRING,
  replyToId: STRING,

  // Embeddings
  embedding: VECTOR[768],

  // Tool calls (si agent utilise des outils)
  toolCalls: LIST<MAP>,      // [{tool: 'search', args: {...}, result: ...}]

  // Metadata
  metadata: MAP,
  editedAt: DATETIME,
  isDeleted: BOOLEAN
})

Relations:
(:Message)-[:SENT_BY]->(:Interlocutor)
(:Message)-[:SENT_TO]->(:Interlocutor)        // Pour messages ciblés (@mention)
(:Message)-[:SENT_IN]->(:ChatSession)
(:Message)-[:REPLY_TO]->(:Message)            // Threading
(:Message)-[:REFERENCES]->(:RagReference)     // Contenu RAG utilisé
```

### 5. Références RAG (Inchangé)

```cypher
(:RagReference {
  referenceId: STRING [UNIQUE],
  entityType: STRING,        // 'Scope', 'Document', etc.
  entityId: STRING,
  relevanceScore: FLOAT,
  snippet: STRING,           // Extrait du contenu référencé
  metadata: MAP
})

Relations:
(:RagReference)-[:POINTS_TO]->(:Scope|:Document|...)  // Dynamic
```

### 6. Summaries Hiérarchiques (Amélioré)

```cypher
(:SessionSummary {
  summaryId: STRING [UNIQUE],
  level: STRING,             // 'L1', 'L2', 'L3'
  content: STRING,
  tokens: INTEGER,

  // Coverage (quels messages/summaries sont résumés)
  coversRangeStart: DATETIME,
  coversRangeEnd: DATETIME,
  coversMessageCount: INTEGER,

  // Embeddings
  embedding: VECTOR[768],

  // Generation metadata
  strategy: STRING,          // Quelle stratégie LLM utilisée
  generatedAt: DATETIME,
  generationCost: FLOAT,

  // Versioning (si re-génération)
  version: INTEGER,
  supersededBy: STRING,      // summaryId qui remplace celui-ci

  metadata: MAP
})

Relations:
(:SessionSummary)-[:SUMMARIZES]->(:ChatSession)
(:SessionSummary)-[:COVERS_MESSAGE]->(:Message)      // L1 couvre des messages
(:SessionSummary)-[:COVERS_SUMMARY]->(:SessionSummary)  // L2 couvre des L1
(:SessionSummary)-[:PARENT_SUMMARY]->(:SessionSummary)  // Hiérarchie
```

### 7. Métriques (Nouveau)

```cypher
(:SessionMetrics {
  metricsId: STRING,
  sessionId: STRING,
  timestamp: DATETIME,

  // Counts
  totalMessages: INTEGER,
  messagesByInterlocutor: MAP,      // {interlocutorId: count}

  // Tokens & Cost
  totalTokens: INTEGER,
  tokensByInterlocutor: MAP,
  totalCost: FLOAT,

  // Performance
  averageResponseTime: FLOAT,
  p95ResponseTime: FLOAT,

  // Compression
  l1Count: INTEGER,
  l2Count: INTEGER,
  l3Count: INTEGER,
  compressionRatio: FLOAT,

  metadata: MAP
})

(:AgentMetrics {
  metricsId: STRING,
  agentId: STRING,
  sessionId: STRING,
  timestamp: DATETIME,

  // Activity
  messagesHandled: INTEGER,
  toolCallsExecuted: INTEGER,

  // Performance
  averageLatency: FLOAT,
  p95Latency: FLOAT,
  p99Latency: FLOAT,

  // Tokens & Cost
  inputTokens: INTEGER,
  outputTokens: INTEGER,
  totalCost: FLOAT,

  // Quality (si feedback disponible)
  successRate: FLOAT,
  userSatisfaction: FLOAT,

  metadata: MAP
})

Relations:
(:SessionMetrics)-[:FOR_SESSION]->(:ChatSession)
(:AgentMetrics)-[:FOR_AGENT]->(:Agent)
(:AgentMetrics)-[:IN_SESSION]->(:ChatSession)
```

---

## 🛠️ Implémentation v2 - Plan Détaillé

La roadmap est organisée en **6 phases** progressives, chacune construisant sur la précédente.

---

## Phase 1: Fondations Multi-Interlocuteurs

**Durée estimée**: 2-3 semaines

### Step 1.1: Modèle Interlocutor

**Fichier**: `packages/runtime/src/chat/interlocutor-registry.ts`

**Objectif**: Créer l'abstraction de base pour tous les participants.

```typescript
export enum InterlocutorType {
  HUMAN = 'human',
  AGENT = 'agent',
  SYSTEM = 'system'
}

export interface Interlocutor {
  interlocutorId: string;
  type: InterlocutorType;
  name: string;
  displayName: string;
  metadata?: Record<string, any>;
}

export interface Human extends Interlocutor {
  type: InterlocutorType.HUMAN;
  userId: string;
  email: string;
  organization?: string;
  role?: string;
}

export interface Agent extends Interlocutor {
  type: InterlocutorType.AGENT;
  agentId: string;
  role: string;
  capabilities: string[];
  version: string;
  isBuiltIn: boolean;
}

export interface System extends Interlocutor {
  type: InterlocutorType.SYSTEM;
  systemId: string;
  purpose: string;
}

export class InterlocutorRegistry {
  constructor(private client: Neo4jClient) {}

  /**
   * Enregistrer un interlocuteur (human/agent/system)
   */
  async register(interlocutor: Interlocutor): Promise<void> {
    const labels = ['Interlocutor', this.getTypeLabel(interlocutor.type)];

    await this.client.run(`
      MERGE (i:${labels.join(':')} {interlocutorId: $id})
      SET i += $props,
          i.createdAt = coalesce(i.createdAt, datetime()),
          i.isActive = true
    `, {
      id: interlocutor.interlocutorId,
      props: this.serializeProps(interlocutor)
    });
  }

  /**
   * Récupérer un interlocuteur
   */
  async get(interlocutorId: string): Promise<Interlocutor | null> {
    const result = await this.client.run(`
      MATCH (i:Interlocutor {interlocutorId: $id})
      RETURN i
    `, { id: interlocutorId });

    if (result.records.length === 0) return null;

    return this.deserialize(result.records[0].get('i'));
  }

  /**
   * Lister tous les interlocuteurs d'une session
   */
  async listForSession(sessionId: string): Promise<Interlocutor[]> {
    const result = await this.client.run(`
      MATCH (i:Interlocutor)-[:PARTICIPANT_IN]->(s:ChatSession {sessionId: $sessionId})
      RETURN i
      ORDER BY i.name
    `, { sessionId });

    return result.records.map(r => this.deserialize(r.get('i')));
  }

  private getTypeLabel(type: InterlocutorType): string {
    switch (type) {
      case InterlocutorType.HUMAN: return 'Human';
      case InterlocutorType.AGENT: return 'Agent';
      case InterlocutorType.SYSTEM: return 'System';
    }
  }

  private serializeProps(interlocutor: Interlocutor): Record<string, any> {
    const base = {
      type: interlocutor.type,
      name: interlocutor.name,
      displayName: interlocutor.displayName,
      metadata: interlocutor.metadata || {}
    };

    switch (interlocutor.type) {
      case InterlocutorType.HUMAN:
        const human = interlocutor as Human;
        return {
          ...base,
          userId: human.userId,
          email: human.email,
          organization: human.organization,
          role: human.role
        };

      case InterlocutorType.AGENT:
        const agent = interlocutor as Agent;
        return {
          ...base,
          agentId: agent.agentId,
          role: agent.role,
          capabilities: agent.capabilities,
          version: agent.version,
          isBuiltIn: agent.isBuiltIn
        };

      case InterlocutorType.SYSTEM:
        const system = interlocutor as System;
        return {
          ...base,
          systemId: system.systemId,
          purpose: system.purpose
        };
    }
  }

  private deserialize(node: any): Interlocutor {
    const props = node.properties;

    switch (props.type) {
      case InterlocutorType.HUMAN:
        return {
          interlocutorId: props.interlocutorId,
          type: InterlocutorType.HUMAN,
          name: props.name,
          displayName: props.displayName,
          userId: props.userId,
          email: props.email,
          organization: props.organization,
          role: props.role,
          metadata: props.metadata
        } as Human;

      case InterlocutorType.AGENT:
        return {
          interlocutorId: props.interlocutorId,
          type: InterlocutorType.AGENT,
          name: props.name,
          displayName: props.displayName,
          agentId: props.agentId,
          role: props.role,
          capabilities: props.capabilities,
          version: props.version,
          isBuiltIn: props.isBuiltIn,
          metadata: props.metadata
        } as Agent;

      case InterlocutorType.SYSTEM:
        return {
          interlocutorId: props.interlocutorId,
          type: InterlocutorType.SYSTEM,
          name: props.name,
          displayName: props.displayName,
          systemId: props.systemId,
          purpose: props.purpose,
          metadata: props.metadata
        } as System;

      default:
        throw new Error(`Unknown interlocutor type: ${props.type}`);
    }
  }
}
```

**Tests**: `packages/runtime/src/chat/__tests__/interlocutor-registry.test.ts`

```typescript
describe('InterlocutorRegistry', () => {
  test('registers human interlocutor', async () => {
    const human: Human = {
      interlocutorId: 'user-123',
      type: InterlocutorType.HUMAN,
      name: 'John Doe',
      displayName: 'John',
      userId: 'user-123',
      email: 'john@example.com'
    };

    await registry.register(human);
    const retrieved = await registry.get('user-123');

    expect(retrieved).toMatchObject(human);
  });

  test('registers agent interlocutor', async () => {
    const agent: Agent = {
      interlocutorId: 'agent-456',
      type: InterlocutorType.AGENT,
      name: 'CodeReviewAgent',
      displayName: 'Code Reviewer',
      agentId: 'agent-456',
      role: 'code_reviewer',
      capabilities: ['code_analysis', 'security_audit'],
      version: '1.0.0',
      isBuiltIn: true
    };

    await registry.register(agent);
    const retrieved = await registry.get('agent-456');

    expect(retrieved).toMatchObject(agent);
  });

  test('lists all participants in a session', async () => {
    // Setup: create session with multiple participants
    await registry.register(human1);
    await registry.register(agent1);
    await registry.register(agent2);

    await sessionManager.addParticipant(sessionId, human1.interlocutorId);
    await sessionManager.addParticipant(sessionId, agent1.interlocutorId);
    await sessionManager.addParticipant(sessionId, agent2.interlocutorId);

    // Test
    const participants = await registry.listForSession(sessionId);

    expect(participants).toHaveLength(3);
    expect(participants.map(p => p.interlocutorId)).toEqual(
      expect.arrayContaining(['user-123', 'agent-456', 'agent-789'])
    );
  });
});
```

---

### Step 1.2: Modèle Message (remplace ChatTurn)

**Fichier**: `packages/runtime/src/chat/message-store.ts`

**Objectif**: Nouveau modèle de message supportant multi-participants et threading.

```typescript
export enum ContentType {
  TEXT = 'text',
  CODE = 'code',
  IMAGE = 'image',
  FILE = 'file',
  TOOL_RESULT = 'tool_result'
}

export interface Message {
  messageId: string;
  sessionId: string;

  // Content
  content: string;
  contentType: ContentType;
  tokens: number;

  // Sender/Receiver
  sentBy: string;              // interlocutorId
  sentTo?: string[];           // Pour messages ciblés (@mentions)

  // Threading
  threadId?: string;
  replyToId?: string;

  // Timestamp
  timestamp: Date;
  editedAt?: Date;
  isDeleted: boolean;

  // RAG & Tools
  ragReferences?: RagReference[];
  toolCalls?: ToolCall[];

  // Embeddings
  embedding?: number[];

  // Metadata
  metadata?: Record<string, any>;
}

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
  result?: any;
  error?: string;
}

export interface RagReference {
  referenceId: string;
  entityType: string;
  entityId: string;
  relevanceScore: number;
  snippet?: string;
}

export class MessageStore {
  constructor(
    private client: Neo4jClient,
    private vectorSearch: VectorSearch
  ) {}

  /**
   * Créer un nouveau message
   */
  async create(message: Omit<Message, 'messageId' | 'timestamp'>): Promise<string> {
    const messageId = crypto.randomUUID();
    const now = new Date();

    // 1. Calculer tokens si pas fourni
    const tokens = message.tokens || this.estimateTokens(message.content);

    // 2. Générer embedding
    let embedding: number[] | undefined;
    if (message.contentType === ContentType.TEXT || message.contentType === ContentType.CODE) {
      embedding = await this.vectorSearch.generateEmbedding(message.content);
    }

    // 3. Créer le message
    await this.client.run(`
      MATCH (sender:Interlocutor {interlocutorId: $sentBy})
      MATCH (session:ChatSession {sessionId: $sessionId})
      CREATE (m:Message {
        messageId: $messageId,
        content: $content,
        contentType: $contentType,
        tokens: $tokens,
        timestamp: datetime($timestamp),
        threadId: $threadId,
        replyToId: $replyToId,
        isDeleted: false,
        embedding: $embedding,
        metadata: $metadata
      })
      CREATE (m)-[:SENT_BY]->(sender)
      CREATE (m)-[:SENT_IN]->(session)

      // Si c'est une réponse, créer la relation REPLY_TO
      WITH m
      ${message.replyToId ? `
        MATCH (parent:Message {messageId: $replyToId})
        CREATE (m)-[:REPLY_TO]->(parent)
      ` : ''}

      // Si messages ciblés (@mentions), créer SENT_TO
      WITH m
      ${message.sentTo && message.sentTo.length > 0 ? `
        UNWIND $sentTo as recipientId
        MATCH (recipient:Interlocutor {interlocutorId: recipientId})
        CREATE (m)-[:SENT_TO]->(recipient)
      ` : ''}

      // Mettre à jour la session
      WITH m, session
      SET session.lastActiveAt = datetime(),
          session.totalTokens = coalesce(session.totalTokens, 0) + $tokens

      RETURN m.messageId as messageId
    `, {
      messageId,
      sessionId: message.sessionId,
      content: message.content,
      contentType: message.contentType,
      tokens,
      sentBy: message.sentBy,
      sentTo: message.sentTo || [],
      threadId: message.threadId,
      replyToId: message.replyToId,
      timestamp: now.toISOString(),
      embedding,
      metadata: message.metadata || {}
    });

    // 4. Ajouter les RAG references si présentes
    if (message.ragReferences && message.ragReferences.length > 0) {
      await this.addRagReferences(messageId, message.ragReferences);
    }

    // 5. Ajouter les tool calls si présents
    if (message.toolCalls && message.toolCalls.length > 0) {
      await this.addToolCalls(messageId, message.toolCalls);
    }

    return messageId;
  }

  /**
   * Récupérer les messages d'une session
   */
  async getForSession(
    sessionId: string,
    options?: {
      limit?: number;
      offset?: number;
      threadId?: string;
      includeDeleted?: boolean;
      includeReferences?: boolean;
    }
  ): Promise<Message[]> {
    const query = `
      MATCH (m:Message)-[:SENT_IN]->(s:ChatSession {sessionId: $sessionId})
      MATCH (m)-[:SENT_BY]->(sender:Interlocutor)
      ${options?.threadId ? 'WHERE m.threadId = $threadId' : ''}
      ${!options?.includeDeleted ? 'AND NOT m.isDeleted' : ''}

      ${options?.includeReferences ? `
        OPTIONAL MATCH (m)-[:REFERENCES]->(ref:RagReference)
        OPTIONAL MATCH (ref)-[:POINTS_TO]->(entity)
      ` : ''}

      WITH m, sender
      ${options?.includeReferences ? ', collect({ref: ref, entity: entity}) as references' : ''}

      OPTIONAL MATCH (m)-[:SENT_TO]->(recipient:Interlocutor)

      RETURN
        m,
        sender.interlocutorId as sentBy,
        collect(recipient.interlocutorId) as sentTo
        ${options?.includeReferences ? ', references' : ''}

      ORDER BY m.timestamp DESC
      ${options?.offset ? 'SKIP $offset' : ''}
      ${options?.limit ? 'LIMIT $limit' : ''}
    `;

    const result = await this.client.run(query, {
      sessionId,
      threadId: options?.threadId,
      offset: options?.offset,
      limit: options?.limit
    });

    return result.records.map(r => this.deserializeMessage(r));
  }

  /**
   * Récupérer les N derniers messages
   */
  async getRecent(
    sessionId: string,
    count: number
  ): Promise<Message[]> {
    return this.getForSession(sessionId, { limit: count });
  }

  /**
   * Recherche sémantique dans les messages
   */
  async semanticSearch(
    sessionId: string,
    query: string,
    topK: number = 10
  ): Promise<Array<Message & { score: number }>> {
    const queryEmbedding = await this.vectorSearch.generateEmbedding(query);

    const result = await this.client.run(`
      MATCH (m:Message)-[:SENT_IN]->(s:ChatSession {sessionId: $sessionId})
      WHERE m.embedding IS NOT NULL AND NOT m.isDeleted

      WITH m, vector.similarity.cosine(m.embedding, $queryEmbedding) as score
      WHERE score > 0.7

      MATCH (m)-[:SENT_BY]->(sender:Interlocutor)

      RETURN m, sender.interlocutorId as sentBy, score
      ORDER BY score DESC
      LIMIT $topK
    `, {
      sessionId,
      queryEmbedding,
      topK
    });

    return result.records.map(r => ({
      ...this.deserializeMessage(r),
      score: r.get('score')
    }));
  }

  /**
   * Obtenir le thread d'un message (tous les messages du même thread)
   */
  async getThread(threadId: string): Promise<Message[]> {
    const result = await this.client.run(`
      MATCH (m:Message {threadId: $threadId})
      MATCH (m)-[:SENT_BY]->(sender:Interlocutor)

      OPTIONAL MATCH (m)-[:SENT_TO]->(recipient:Interlocutor)

      RETURN
        m,
        sender.interlocutorId as sentBy,
        collect(recipient.interlocutor Id) as sentTo

      ORDER BY m.timestamp ASC
    `, { threadId });

    return result.records.map(r => this.deserializeMessage(r));
  }

  /**
   * Supprimer un message (soft delete)
   */
  async delete(messageId: string): Promise<void> {
    await this.client.run(`
      MATCH (m:Message {messageId: $messageId})
      SET m.isDeleted = true,
          m.content = '[Message supprimé]'
    `, { messageId });
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private async addRagReferences(
    messageId: string,
    references: RagReference[]
  ): Promise<void> {
    for (const ref of references) {
      await this.client.run(`
        MATCH (m:Message {messageId: $messageId})
        MATCH (entity:${ref.entityType} {uuid: $entityId})

        CREATE (r:RagReference {
          referenceId: $referenceId,
          entityType: $entityType,
          entityId: $entityId,
          relevanceScore: $score,
          snippet: $snippet
        })

        CREATE (m)-[:REFERENCES]->(r)
        CREATE (r)-[:POINTS_TO]->(entity)
      `, {
        messageId,
        referenceId: ref.referenceId,
        entityType: ref.entityType,
        entityId: ref.entityId,
        score: ref.relevanceScore,
        snippet: ref.snippet
      });
    }
  }

  private async addToolCalls(
    messageId: string,
    toolCalls: ToolCall[]
  ): Promise<void> {
    await this.client.run(`
      MATCH (m:Message {messageId: $messageId})
      SET m.toolCalls = $toolCalls
    `, {
      messageId,
      toolCalls: toolCalls.map(tc => ({
        tool: tc.tool,
        args: tc.args,
        result: tc.result,
        error: tc.error
      }))
    });
  }

  private deserializeMessage(record: any): Message {
    const m = record.get('m').properties;
    const sentBy = record.get('sentBy');
    const sentTo = record.get('sentTo') || [];

    return {
      messageId: m.messageId,
      sessionId: m.sessionId,
      content: m.content,
      contentType: m.contentType as ContentType,
      tokens: m.tokens,
      sentBy,
      sentTo: sentTo.length > 0 ? sentTo : undefined,
      threadId: m.threadId,
      replyToId: m.replyToId,
      timestamp: new Date(m.timestamp),
      editedAt: m.editedAt ? new Date(m.editedAt) : undefined,
      isDeleted: m.isDeleted,
      embedding: m.embedding,
      toolCalls: m.toolCalls,
      metadata: m.metadata
    };
  }
}
```

**Tests**: `packages/runtime/src/chat/__tests__/message-store.test.ts`

```typescript
describe('MessageStore', () => {
  test('creates message from human to agent', async () => {
    const messageId = await store.create({
      sessionId: 'session-1',
      content: 'Please review this code',
      contentType: ContentType.TEXT,
      sentBy: 'user-123',
      sentTo: ['agent-456']
    });

    expect(messageId).toBeDefined();

    const messages = await store.getForSession('session-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Please review this code');
  });

  test('creates threaded conversation', async () => {
    const threadId = crypto.randomUUID();

    // Message initial
    const msg1Id = await store.create({
      sessionId: 'session-1',
      content: 'Question about authentication',
      contentType: ContentType.TEXT,
      sentBy: 'user-123',
      threadId
    });

    // Réponse
    const msg2Id = await store.create({
      sessionId: 'session-1',
      content: 'Here\'s how to implement OAuth',
      contentType: ContentType.TEXT,
      sentBy: 'agent-456',
      threadId,
      replyToId: msg1Id
    });

    // Follow-up
    const msg3Id = await store.create({
      sessionId: 'session-1',
      content: 'What about JWT tokens?',
      contentType: ContentType.TEXT,
      sentBy: 'user-123',
      threadId,
      replyToId: msg2Id
    });

    const thread = await store.getThread(threadId);

    expect(thread).toHaveLength(3);
    expect(thread[0].messageId).toBe(msg1Id);
    expect(thread[1].replyToId).toBe(msg1Id);
    expect(thread[2].replyToId).toBe(msg2Id);
  });

  test('semantic search in messages', async () => {
    // Create messages
    await store.create({
      sessionId: 'session-1',
      content: 'How do I implement OAuth authentication?',
      contentType: ContentType.TEXT,
      sentBy: 'user-123'
    });

    await store.create({
      sessionId: 'session-1',
      content: 'What is the weather like today?',
      contentType: ContentType.TEXT,
      sentBy: 'user-123'
    });

    await store.create({
      sessionId: 'session-1',
      content: 'JWT tokens are used for authentication',
      contentType: ContentType.TEXT,
      sentBy: 'agent-456'
    });

    // Search
    const results = await store.semanticSearch(
      'session-1',
      'authentication methods',
      10
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain('OAuth');
    expect(results[0].score).toBeGreaterThan(0.7);
  });

  test('handles RAG references', async () => {
    const messageId = await store.create({
      sessionId: 'session-1',
      content: 'The authenticate() function handles login',
      contentType: ContentType.TEXT,
      sentBy: 'agent-456',
      ragReferences: [{
        referenceId: 'ref-1',
        entityType: 'Scope',
        entityId: 'scope-123',
        relevanceScore: 0.95,
        snippet: 'function authenticate(user, pass) { ... }'
      }]
    });

    const messages = await store.getForSession('session-1', {
      limit: 1,
      includeReferences: true
    });

    expect(messages[0].ragReferences).toHaveLength(1);
    expect(messages[0].ragReferences![0].entityType).toBe('Scope');
  });

  test('soft deletes messages', async () => {
    const messageId = await store.create({
      sessionId: 'session-1',
      content: 'Sensitive information',
      contentType: ContentType.TEXT,
      sentBy: 'user-123'
    });

    await store.delete(messageId);

    const messages = await store.getForSession('session-1', {
      includeDeleted: false
    });

    expect(messages).toHaveLength(0);

    const allMessages = await store.getForSession('session-1', {
      includeDeleted: true
    });

    expect(allMessages).toHaveLength(1);
    expect(allMessages[0].isDeleted).toBe(true);
    expect(allMessages[0].content).toBe('[Message supprimé]');
  });
});
```

---

### Step 1.3: SessionManager

**Fichier**: `packages/runtime/src/chat/session-manager.ts`

**Objectif**: Gérer les sessions de chat multi-participants.

```typescript
export interface ChatSessionConfig {
  title?: string;
  compressionEnabled?: boolean;
  maxContextTokens?: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface ChatSession {
  sessionId: string;
  title: string;
  createdAt: Date;
  lastActiveAt: Date;
  closedAt?: Date;
  totalTokens: number;
  totalCost: number;
  compressionEnabled: boolean;
  maxContextTokens: number;
  tags: string[];
  metadata: Record<string, any>;
}

export class SessionManager {
  constructor(
    private client: Neo4jClient,
    private interlocutorRegistry: InterlocutorRegistry
  ) {}

  /**
   * Créer une nouvelle session
   */
  async create(
    createdBy: string,  // interlocutorId
    config?: ChatSessionConfig
  ): Promise<string> {
    const sessionId = crypto.randomUUID();
    const now = new Date();

    await this.client.run(`
      MATCH (creator:Interlocutor {interlocutorId: $createdBy})
      CREATE (s:ChatSession {
        sessionId: $sessionId,
        title: $title,
        createdAt: datetime($now),
        lastActiveAt: datetime($now),
        totalTokens: 0,
        totalCost: 0,
        compressionEnabled: $compressionEnabled,
        maxContextTokens: $maxContextTokens,
        tags: $tags,
        metadata: $metadata
      })
      CREATE (s)-[:CREATED_BY]->(creator)
      CREATE (creator)-[:PARTICIPANT_IN {
        joinedAt: datetime($now),
        role: 'creator'
      }]->(s)
    `, {
      sessionId,
      createdBy,
      title: config?.title || 'Nouvelle conversation',
      now: now.toISOString(),
      compressionEnabled: config?.compressionEnabled ?? true,
      maxContextTokens: config?.maxContextTokens ?? 8000,
      tags: config?.tags || [],
      metadata: config?.metadata || {}
    });

    return sessionId;
  }

  /**
   * Ajouter un participant à une session
   */
  async addParticipant(
    sessionId: string,
    interlocutorId: string,
    role: string = 'participant'
  ): Promise<void> {
    await this.client.run(`
      MATCH (i:Interlocutor {interlocutorId: $interlocutorId})
      MATCH (s:ChatSession {sessionId: $sessionId})
      MERGE (i)-[:PARTICIPANT_IN {
        joinedAt: datetime(),
        role: $role
      }]->(s)
    `, {
      sessionId,
      interlocutorId,
      role
    });
  }

  /**
   * Retirer un participant d'une session
   */
  async removeParticipant(
    sessionId: string,
    interlocutorId: string
  ): Promise<void> {
    await this.client.run(`
      MATCH (i:Interlocutor {interlocutorId: $interlocutorId})
            -[rel:PARTICIPANT_IN]->
            (s:ChatSession {sessionId: $sessionId})
      SET rel.leftAt = datetime()
    `, {
      sessionId,
      interlocutorId
    });
  }

  /**
   * Récupérer une session
   */
  async get(sessionId: string): Promise<ChatSession | null> {
    const result = await this.client.run(`
      MATCH (s:ChatSession {sessionId: $sessionId})
      RETURN s
    `, { sessionId });

    if (result.records.length === 0) return null;

    return this.deserializeSession(result.records[0].get('s'));
  }

  /**
   * Lister toutes les sessions d'un interlocuteur
   */
  async listForInterlocutor(
    interlocutorId: string,
    options?: {
      includeClosed?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<ChatSession[]> {
    const result = await this.client.run(`
      MATCH (i:Interlocutor {interlocutorId: $interlocutorId})
            -[:PARTICIPANT_IN]->
            (s:ChatSession)
      ${!options?.includeClosed ? 'WHERE s.closedAt IS NULL' : ''}
      RETURN s
      ORDER BY s.lastActiveAt DESC
      ${options?.offset ? 'SKIP $offset' : ''}
      ${options?.limit ? 'LIMIT $limit' : ''}
    `, {
      interlocutorId,
      offset: options?.offset,
      limit: options?.limit
    });

    return result.records.map(r => this.deserializeSession(r.get('s')));
  }

  /**
   * Fermer une session
   */
  async close(sessionId: string): Promise<void> {
    await this.client.run(`
      MATCH (s:ChatSession {sessionId: $sessionId})
      SET s.closedAt = datetime()
    `, { sessionId });
  }

  /**
   * Mettre à jour la configuration d'une session
   */
  async updateConfig(
    sessionId: string,
    config: Partial<ChatSessionConfig>
  ): Promise<void> {
    const updates: string[] = [];
    const params: Record<string, any> = { sessionId };

    if (config.title !== undefined) {
      updates.push('s.title = $title');
      params.title = config.title;
    }
    if (config.compressionEnabled !== undefined) {
      updates.push('s.compressionEnabled = $compressionEnabled');
      params.compressionEnabled = config.compressionEnabled;
    }
    if (config.maxContextTokens !== undefined) {
      updates.push('s.maxContextTokens = $maxContextTokens');
      params.maxContextTokens = config.maxContextTokens;
    }
    if (config.tags !== undefined) {
      updates.push('s.tags = $tags');
      params.tags = config.tags;
    }
    if (config.metadata !== undefined) {
      updates.push('s.metadata = $metadata');
      params.metadata = config.metadata;
    }

    if (updates.length > 0) {
      await this.client.run(`
        MATCH (s:ChatSession {sessionId: $sessionId})
        SET ${updates.join(', ')}
      `, params);
    }
  }

  /**
   * Obtenir les participants actifs d'une session
   */
  async getActiveParticipants(sessionId: string): Promise<Interlocutor[]> {
    return this.interlocutorRegistry.listForSession(sessionId);
  }

  /**
   * Obtenir les statistiques d'une session
   */
  async getStats(sessionId: string): Promise<{
    messageCount: number;
    participantCount: number;
    totalTokens: number;
    totalCost: number;
    avgMessagesPerParticipant: number;
  }> {
    const result = await this.client.run(`
      MATCH (s:ChatSession {sessionId: $sessionId})
      MATCH (m:Message)-[:SENT_IN]->(s)
      MATCH (p:Interlocutor)-[:PARTICIPANT_IN]->(s)

      WITH s, count(DISTINCT m) as msgCount, count(DISTINCT p) as pCount

      RETURN
        msgCount as messageCount,
        pCount as participantCount,
        s.totalTokens as totalTokens,
        s.totalCost as totalCost,
        toFloat(msgCount) / toFloat(pCount) as avgMessagesPerParticipant
    `, { sessionId });

    if (result.records.length === 0) {
      return {
        messageCount: 0,
        participantCount: 0,
        totalTokens: 0,
        totalCost: 0,
        avgMessagesPerParticipant: 0
      };
    }

    const r = result.records[0];
    return {
      messageCount: r.get('messageCount').toNumber(),
      participantCount: r.get('participantCount').toNumber(),
      totalTokens: r.get('totalTokens') || 0,
      totalCost: r.get('totalCost') || 0,
      avgMessagesPerParticipant: r.get('avgMessagesPerParticipant') || 0
    };
  }

  private deserializeSession(node: any): ChatSession {
    const props = node.properties;

    return {
      sessionId: props.sessionId,
      title: props.title,
      createdAt: new Date(props.createdAt),
      lastActiveAt: new Date(props.lastActiveAt),
      closedAt: props.closedAt ? new Date(props.closedAt) : undefined,
      totalTokens: props.totalTokens || 0,
      totalCost: props.totalCost || 0,
      compressionEnabled: props.compressionEnabled ?? true,
      maxContextTokens: props.maxContextTokens || 8000,
      tags: props.tags || [],
      metadata: props.metadata || {}
    };
  }
}
```

**Tests**: `packages/runtime/src/chat/__tests__/session-manager.test.ts`

```typescript
describe('SessionManager', () => {
  test('creates session with creator as participant', async () => {
    const sessionId = await sessionManager.create('user-123', {
      title: 'Code Review Session'
    });

    expect(sessionId).toBeDefined();

    const session = await sessionManager.get(sessionId);
    expect(session?.title).toBe('Code Review Session');

    const participants = await sessionManager.getActiveParticipants(sessionId);
    expect(participants).toHaveLength(1);
    expect(participants[0].interlocutorId).toBe('user-123');
  });

  test('adds multiple participants to session', async () => {
    const sessionId = await sessionManager.create('user-123');

    await sessionManager.addParticipant(sessionId, 'agent-456', 'reviewer');
    await sessionManager.addParticipant(sessionId, 'agent-789', 'assistant');

    const participants = await sessionManager.getActiveParticipants(sessionId);
    expect(participants).toHaveLength(3);
  });

  test('removes participant from session', async () => {
    const sessionId = await sessionManager.create('user-123');
    await sessionManager.addParticipant(sessionId, 'agent-456');

    await sessionManager.removeParticipant(sessionId, 'agent-456');

    const participants = await sessionManager.getActiveParticipants(sessionId);
    expect(participants).toHaveLength(1);
  });

  test('lists sessions for interlocutor', async () => {
    const session1 = await sessionManager.create('user-123', {
      title: 'Session 1'
    });
    const session2 = await sessionManager.create('user-123', {
      title: 'Session 2'
    });

    const sessions = await sessionManager.listForInterlocutor('user-123');

    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.title)).toEqual(
      expect.arrayContaining(['Session 1', 'Session 2'])
    );
  });

  test('closes session', async () => {
    const sessionId = await sessionManager.create('user-123');

    await sessionManager.close(sessionId);

    const session = await sessionManager.get(sessionId);
    expect(session?.closedAt).toBeDefined();
  });

  test('gets session statistics', async () => {
    const sessionId = await sessionManager.create('user-123');
    await sessionManager.addParticipant(sessionId, 'agent-456');

    // Create some messages
    await messageStore.create({
      sessionId,
      content: 'Hello',
      contentType: ContentType.TEXT,
      sentBy: 'user-123',
      tokens: 5
    });

    await messageStore.create({
      sessionId,
      content: 'Hi there',
      contentType: ContentType.TEXT,
      sentBy: 'agent-456',
      tokens: 7
    });

    const stats = await sessionManager.getStats(sessionId);

    expect(stats.messageCount).toBe(2);
    expect(stats.participantCount).toBe(2);
    expect(stats.avgMessagesPerParticipant).toBe(1);
  });

  test('updates session configuration', async () => {
    const sessionId = await sessionManager.create('user-123');

    await sessionManager.updateConfig(sessionId, {
      title: 'Updated Title',
      maxContextTokens: 16000,
      tags: ['production', 'critical']
    });

    const session = await sessionManager.get(sessionId);

    expect(session?.title).toBe('Updated Title');
    expect(session?.maxContextTokens).toBe(16000);
    expect(session?.tags).toEqual(['production', 'critical']);
  });
});
```

**✅ Phase 1 Complete**: Les fondations multi-interlocuteurs sont en place.

---

## Phase 2: Agent Framework & Modeling

**Durée estimée**: 3-4 semaines

### Step 2.1: AgentConfig Management

**Fichier**: `packages/runtime/src/agents/agent-config.ts`

**Objectif**: Gérer les configurations d'agents avec versioning.

```typescript
export interface AgentConfigData {
  agentId: string;
  version: string;

  // LLM Configuration
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;

  // Persona & Behavior
  personaPrompt: string;
  instructions?: string;

  // Capabilities & Tools
  capabilities: string[];
  enabledTools?: string[];

  // Metadata
  metadata?: Record<string, any>;
}

export class AgentConfigManager {
  constructor(private client: Neo4jClient) {}

  /**
   * Créer une nouvelle configuration d'agent
   */
  async create(config: AgentConfigData): Promise<string> {
    const configId = crypto.randomUUID();

    await this.client.run(`
      MATCH (a:Agent {agentId: $agentId})
      CREATE (c:AgentConfig {
        configId: $configId,
        agentId: $agentId,
        version: $version,
        model: $model,
        temperature: $temperature,
        maxTokens: $maxTokens,
        topP: $topP,
        personaPrompt: $personaPrompt,
        instructions: $instructions,
        capabilities: $capabilities,
        enabledTools: $enabledTools,
        createdAt: datetime(),
        isActive: true,
        metadata: $metadata
      })
      CREATE (a)-[:CONFIGURED_WITH {activeFrom: datetime()}]->(c)

      // Si une config précédente existe, créer le lien de versioning
      WITH a, c
      OPTIONAL MATCH (a)-[oldRel:CONFIGURED_WITH]->(oldConfig:AgentConfig)
      WHERE oldConfig.configId <> $configId
        AND oldConfig.isActive = true
      WITH c, oldConfig, oldRel
      WHERE oldConfig IS NOT NULL
      SET oldConfig.isActive = false
      CREATE (c)-[:PREVIOUS_VERSION]->(oldConfig)

      RETURN c.configId as configId
    `, {
      configId,
      agentId: config.agentId,
      version: config.version,
      model: config.model,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
      topP: config.topP ?? 1.0,
      personaPrompt: config.personaPrompt,
      instructions: config.instructions,
      capabilities: config.capabilities,
      enabledTools: config.enabledTools || [],
      metadata: config.metadata || {}
    });

    return configId;
  }

  /**
   * Récupérer la configuration active d'un agent
   */
  async getActive(agentId: string): Promise<AgentConfigData | null> {
    const result = await this.client.run(`
      MATCH (a:Agent {agentId: $agentId})
            -[:CONFIGURED_WITH]->
            (c:AgentConfig {isActive: true})
      RETURN c
      ORDER BY c.createdAt DESC
      LIMIT 1
    `, { agentId });

    if (result.records.length === 0) return null;

    return this.deserialize(result.records[0].get('c'));
  }

  /**
   * Récupérer une version spécifique
   */
  async getVersion(agentId: string, version: string): Promise<AgentConfigData | null> {
    const result = await this.client.run(`
      MATCH (a:Agent {agentId: $agentId})
            -[:CONFIGURED_WITH]->
            (c:AgentConfig {version: $version})
      RETURN c
    `, { agentId, version });

    if (result.records.length === 0) return null;

    return this.deserialize(result.records[0].get('c'));
  }

  /**
   * Lister l'historique des versions
   */
  async listVersions(agentId: string): Promise<AgentConfigData[]> {
    const result = await this.client.run(`
      MATCH (a:Agent {agentId: $agentId})
            -[:CONFIGURED_WITH]->
            (c:AgentConfig)
      RETURN c
      ORDER BY c.createdAt DESC
    `, { agentId });

    return result.records.map(r => this.deserialize(r.get('c')));
  }

  private deserialize(node: any): AgentConfigData {
    const props = node.properties;

    return {
      agentId: props.agentId,
      version: props.version,
      model: props.model,
      temperature: props.temperature,
      maxTokens: props.maxTokens,
      topP: props.topP,
      personaPrompt: props.personaPrompt,
      instructions: props.instructions,
      capabilities: props.capabilities,
      enabledTools: props.enabledTools,
      metadata: props.metadata
    };
  }
}
```

---

### Step 2.2: AgentBuilder (Fluent API)

**Fichier**: `packages/runtime/src/agents/agent-builder.ts`

**Objectif**: API intuitive pour créer des agents.

```typescript
export class AgentBuilder {
  private config: Partial<Agent & AgentConfigData> = {
    capabilities: [],
    enabledTools: [],
    isBuiltIn: false,
    temperature: 0.7,
    maxTokens: 4096
  };

  constructor(
    private interlocutorRegistry: InterlocutorRegistry,
    private configManager: AgentConfigManager
  ) {}

  /**
   * Définir l'identifiant et le nom de l'agent
   */
  withId(agentId: string): this {
    this.config.agentId = agentId;
    this.config.interlocutorId = agentId;
    return this;
  }

  withName(name: string): this {
    this.config.name = name;
    this.config.displayName = name;
    return this;
  }

  /**
   * Définir le rôle
   */
  withRole(role: string): this {
    this.config.role = role;
    return this;
  }

  /**
   * Définir la personnalité
   */
  withPersona(prompt: string): this {
    this.config.personaPrompt = prompt;
    return this;
  }

  withInstructions(instructions: string): this {
    this.config.instructions = instructions;
    return this;
  }

  /**
   * Configuration LLM
   */
  withModel(model: string): this {
    this.config.model = model;
    return this;
  }

  withTemperature(temp: number): this {
    this.config.temperature = temp;
    return this;
  }

  withMaxTokens(tokens: number): this {
    this.config.maxTokens = tokens;
    return this;
  }

  /**
   * Capacités
   */
  withCapability(capability: string): this {
    this.config.capabilities!.push(capability);
    return this;
  }

  withCapabilities(capabilities: string[]): this {
    this.config.capabilities = [...this.config.capabilities!, ...capabilities];
    return this;
  }

  /**
   * Outils
   */
  withTool(tool: string): this {
    this.config.enabledTools!.push(tool);
    return this;
  }

  withTools(tools: string[]): this {
    this.config.enabledTools = [...this.config.enabledTools!, ...tools];
    return this;
  }

  /**
   * Marquer comme agent pré-construit
   */
  asBuiltIn(): this {
    this.config.isBuiltIn = true;
    return this;
  }

  /**
   * Métadonnées
   */
  withMetadata(metadata: Record<string, any>): this {
    this.config.metadata = { ...this.config.metadata, ...metadata };
    return this;
  }

  /**
   * Construire et enregistrer l'agent
   */
  async build(): Promise<string> {
    // Validation
    if (!this.config.agentId) throw new Error('Agent ID is required');
    if (!this.config.name) throw new Error('Agent name is required');
    if (!this.config.role) throw new Error('Agent role is required');
    if (!this.config.personaPrompt) throw new Error('Agent persona is required');
    if (!this.config.model) throw new Error('Agent model is required');

    // Créer l'interlocuteur Agent
    const agent: Agent = {
      interlocutorId: this.config.agentId,
      type: InterlocutorType.AGENT,
      name: this.config.name,
      displayName: this.config.displayName!,
      agentId: this.config.agentId,
      role: this.config.role,
      capabilities: this.config.capabilities!,
      version: this.config.version || '1.0.0',
      isBuiltIn: this.config.isBuiltIn!
    };

    await this.interlocutorRegistry.register(agent);

    // Créer la configuration
    const configData: AgentConfigData = {
      agentId: this.config.agentId,
      version: this.config.version || '1.0.0',
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      topP: this.config.topP,
      personaPrompt: this.config.personaPrompt,
      instructions: this.config.instructions,
      capabilities: this.config.capabilities!,
      enabledTools: this.config.enabledTools,
      metadata: this.config.metadata
    };

    await this.configManager.create(configData);

    return this.config.agentId;
  }
}
```

**Exemple d'utilisation**:
```typescript
const agentId = await new AgentBuilder(registry, configManager)
  .withId('code-reviewer-001')
  .withName('Code Review Assistant')
  .withRole('code_reviewer')
  .withPersona(`You are an expert code reviewer with deep knowledge of best practices.
    Focus on: security, performance, maintainability, and style consistency.`)
  .withInstructions('Always provide constructive feedback with specific examples.')
  .withModel('gemini-1.5-pro')
  .withTemperature(0.3)
  .withCapabilities(['code_analysis', 'security_audit', 'performance_analysis'])
  .withTools(['semantic_search', 'code_navigation'])
  .asBuiltIn()
  .build();
```

---

### Step 2.3: AgentRegistry

**Fichier**: `packages/runtime/src/agents/agent-registry.ts`

**Objectif**: Registre global pour découvrir et instancier des agents.

```typescript
export interface AgentInstance {
  agent: Agent;
  config: AgentConfigData;
  execute: (message: string, context: any) => Promise<string>;
}

export class AgentRegistry {
  private instances = new Map<string, AgentInstance>();

  constructor(
    private interlocutorRegistry: InterlocutorRegistry,
    private configManager: AgentConfigManager,
    private llmProvider: LLMProvider
  ) {}

  /**
   * Enregistrer un agent
   */
  async register(agentId: string): Promise<void> {
    // Charger agent et config
    const agent = await this.interlocutorRegistry.get(agentId) as Agent;
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const config = await this.configManager.getActive(agentId);
    if (!config) throw new Error(`No active config for agent ${agentId}`);

    // Créer l'instance
    const instance: AgentInstance = {
      agent,
      config,
      execute: async (message: string, context: any) => {
        return this.executeAgent(agent, config, message, context);
      }
    };

    this.instances.set(agentId, instance);
  }

  /**
   * Récupérer une instance d'agent
   */
  get(agentId: string): AgentInstance | undefined {
    return this.instances.get(agentId);
  }

  /**
   * Lister tous les agents
   */
  list(): AgentInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Lister les agents par capacité
   */
  listByCapability(capability: string): AgentInstance[] {
    return this.list().filter(instance =>
      instance.config.capabilities.includes(capability)
    );
  }

  /**
   * Trouver le meilleur agent pour une tâche
   */
  findBestAgent(task: string, requiredCapabilities: string[]): AgentInstance | null {
    const candidates = this.list().filter(instance =>
      requiredCapabilities.every(cap =>
        instance.config.capabilities.includes(cap)
      )
    );

    if (candidates.length === 0) return null;

    // TODO: Implémenter un scoring plus sophistiqué
    return candidates[0];
  }

  /**
   * Exécuter un agent
   */
  private async executeAgent(
    agent: Agent,
    config: AgentConfigData,
    message: string,
    context: any
  ): Promise<string> {
    // Construire le prompt avec persona
    const systemPrompt = [
      config.personaPrompt,
      config.instructions
    ].filter(Boolean).join('\n\n');

    // Préparer le contexte
    const contextStr = JSON.stringify(context, null, 2);

    // Appeler le LLM
    const response = await this.llmProvider.generate({
      model: config.model,
      systemPrompt,
      messages: [
        { role: 'system', content: `CONTEXT:\n${contextStr}` },
        { role: 'user', content: message }
      ],
      temperature: config.temperature,
      maxTokens: config.maxTokens
    });

    return response.text;
  }
}
```

**✅ Phase 2 Complete**: Le framework d'agents est opérationnel.

---

## Phase 3: Compression Hiérarchique (Implémentation)

**Durée estimée**: 3-4 semaines

**Note**: Voir `CHAT-ADAPTER-COMPRESSION.md` pour le plan détaillé.

### Step 3.1: CompressionTrigger

**Fichier**: `packages/runtime/src/summarization/compression-trigger.ts`

**Objectif**: Détecter quand déclencher la compression à chaque niveau.

```typescript
export interface TriggerConfig {
  // L1
  l1MessageThreshold: number;
  l1TokenThreshold: number;
  l1TimeThreshold: number;

  // L2
  l2SummaryThreshold: number;
  l2TokenThreshold: number;
  l2MessageThreshold: number;

  // L3
  l3SummaryThreshold: number;
  l3TokenThreshold: number;
  l3MessageThreshold: number;
}

export interface TriggerResult {
  shouldTrigger: boolean;
  level: 'L1' | 'L2' | 'L3';
  reason: string;
  itemsToCompress: string[]; // IDs des messages ou summaries
}

export class CompressionTrigger {
  constructor(
    private client: Neo4jClient,
    private config: TriggerConfig
  ) {}

  /**
   * Vérifier si la compression L1 doit être déclenchée
   */
  async checkL1(sessionId: string): Promise<TriggerResult> {
    const result = await this.client.run(`
      MATCH (m:Message)-[:SENT_IN]->(s:ChatSession {sessionId: $sessionId})
      WHERE NOT EXISTS((m)<-[:COVERS_MESSAGE]-(:SessionSummary))
      WITH
        count(m) as uncompressedCount,
        sum(m.tokens) as uncompressedTokens,
        max(m.timestamp) as lastMessageTime,
        collect(m.messageId) as messageIds
      RETURN
        uncompressedCount,
        uncompressedTokens,
        duration.inSeconds(lastMessageTime, datetime()).seconds as secondsSinceLast,
        messageIds
    `, { sessionId });

    if (result.records.length === 0) {
      return { shouldTrigger: false, level: 'L1', reason: 'No messages', itemsToCompress: [] };
    }

    const r = result.records[0];
    const count = r.get('uncompressedCount').toNumber();
    const tokens = r.get('uncompressedTokens') || 0;
    const secondsSinceLast = r.get('secondsSinceLast') || 0;
    const messageIds = r.get('messageIds');

    // Vérifier les seuils
    if (count >= this.config.l1MessageThreshold) {
      return {
        shouldTrigger: true,
        level: 'L1',
        reason: `Message threshold reached (${count} >= ${this.config.l1MessageThreshold})`,
        itemsToCompress: messageIds
      };
    }

    if (tokens >= this.config.l1TokenThreshold) {
      return {
        shouldTrigger: true,
        level: 'L1',
        reason: `Token threshold reached (${tokens} >= ${this.config.l1TokenThreshold})`,
        itemsToCompress: messageIds
      };
    }

    if (secondsSinceLast >= this.config.l1TimeThreshold) {
      return {
        shouldTrigger: true,
        level: 'L1',
        reason: `Time threshold reached (${secondsSinceLast}s >= ${this.config.l1TimeThreshold}s)`,
        itemsToCompress: messageIds
      };
    }

    return { shouldTrigger: false, level: 'L1', reason: 'No threshold reached', itemsToCompress: [] };
  }

  /**
   * Vérifier si la compression L2 doit être déclenchée
   */
  async checkL2(sessionId: string): Promise<TriggerResult> {
    const result = await this.client.run(`
      MATCH (l1:SessionSummary {level: 'L1'})
            -[:SUMMARIZES]->
            (s:ChatSession {sessionId: $sessionId})
      WHERE NOT EXISTS((l1)<-[:COVERS_SUMMARY]-(:SessionSummary))
      WITH
        count(l1) as uncompressedL1Count,
        sum(l1.tokens) as uncompressedL1Tokens,
        collect(l1.summaryId) as summaryIds
      RETURN
        uncompressedL1Count,
        uncompressedL1Tokens,
        summaryIds
    `, { sessionId });

    if (result.records.length === 0) {
      return { shouldTrigger: false, level: 'L2', reason: 'No L1 summaries', itemsToCompress: [] };
    }

    const r = result.records[0];
    const count = r.get('uncompressedL1Count').toNumber();
    const tokens = r.get('uncompressedL1Tokens') || 0;
    const summaryIds = r.get('summaryIds');

    if (count >= this.config.l2SummaryThreshold) {
      return {
        shouldTrigger: true,
        level: 'L2',
        reason: `L1 summary threshold reached (${count} >= ${this.config.l2SummaryThreshold})`,
        itemsToCompress: summaryIds
      };
    }

    if (tokens >= this.config.l2TokenThreshold) {
      return {
        shouldTrigger: true,
        level: 'L2',
        reason: `L1 token threshold reached (${tokens} >= ${this.config.l2TokenThreshold})`,
        itemsToCompress: summaryIds
      };
    }

    return { shouldTrigger: false, level: 'L2', reason: 'No threshold reached', itemsToCompress: [] };
  }

  /**
   * Vérifier si la compression L3 doit être déclenchée
   */
  async checkL3(sessionId: string): Promise<TriggerResult> {
    const result = await this.client.run(`
      MATCH (l2:SessionSummary {level: 'L2'})
            -[:SUMMARIZES]->
            (s:ChatSession {sessionId: $sessionId})
      WHERE NOT EXISTS((l2)<-[:COVERS_SUMMARY]-(:SessionSummary))
      WITH
        count(l2) as uncompressedL2Count,
        sum(l2.tokens) as uncompressedL2Tokens,
        collect(l2.summaryId) as summaryIds
      RETURN
        uncompressedL2Count,
        uncompressedL2Tokens,
        summaryIds
    `, { sessionId });

    if (result.records.length === 0) {
      return { shouldTrigger: false, level: 'L3', reason: 'No L2 summaries', itemsToCompress: [] };
    }

    const r = result.records[0];
    const count = r.get('uncompressedL2Count').toNumber();
    const tokens = r.get('uncompressedL2Tokens') || 0;
    const summaryIds = r.get('summaryIds');

    if (count >= this.config.l3SummaryThreshold) {
      return {
        shouldTrigger: true,
        level: 'L3',
        reason: `L2 summary threshold reached (${count} >= ${this.config.l3SummaryThreshold})`,
        itemsToCompress: summaryIds
      };
    }

    if (tokens >= this.config.l3TokenThreshold) {
      return {
        shouldTrigger: true,
        level: 'L3',
        reason: `L2 token threshold reached (${tokens} >= ${this.config.l3TokenThreshold})`,
        itemsToCompress: summaryIds
      };
    }

    return { shouldTrigger: false, level: 'L3', reason: 'No threshold reached', itemsToCompress: [] };
  }

  /**
   * Vérifier tous les niveaux
   */
  async checkAll(sessionId: string): Promise<TriggerResult[]> {
    return Promise.all([
      this.checkL1(sessionId),
      this.checkL2(sessionId),
      this.checkL3(sessionId)
    ]);
  }
}
```

---

### Step 3.2: HierarchicalCompressor

**Fichier**: `packages/runtime/src/summarization/hierarchical-compressor.ts`

**Objectif**: Orchestrer la compression à tous les niveaux.

```typescript
export class HierarchicalCompressor {
  constructor(
    private client: Neo4jClient,
    private messageStore: MessageStore,
    private trigger: CompressionTrigger,
    private summarizer: GenericSummarizer,
    private vectorSearch: VectorSearch,
    private config: CompressionConfig
  ) {}

  /**
   * Processus principal: vérifier et déclencher compression si nécessaire
   */
  async processSession(sessionId: string): Promise<void> {
    // Vérifier tous les triggers
    const triggers = await this.trigger.checkAll(sessionId);

    for (const trigger of triggers) {
      if (trigger.shouldTrigger) {
        console.log(`Triggering ${trigger.level} compression: ${trigger.reason}`);

        switch (trigger.level) {
          case 'L1':
            await this.generateL1(sessionId, trigger.itemsToCompress);
            break;
          case 'L2':
            await this.generateL2(sessionId, trigger.itemsToCompress);
            break;
          case 'L3':
            await this.generateL3(sessionId, trigger.itemsToCompress);
            break;
        }
      }
    }
  }

  /**
   * Générer résumé L1
   */
  private async generateL1(sessionId: string, messageIds: string[]): Promise<string> {
    // 1. Récupérer les messages
    const messages = await this.fetchMessages(messageIds);

    // 2. Préparer le prompt
    const prompt = this.buildL1Prompt(messages);

    // 3. Générer le résumé
    const summary = await this.summarizer.summarize(prompt, {
      model: this.config.summarizationModel,
      temperature: this.config.summarizationTemperature,
      maxTokens: Math.floor(this.sumTokens(messages) * 0.5) // Target 50% compression
    });

    // 4. Générer embedding
    const embedding = this.config.generateEmbeddingsForSummaries
      ? await this.vectorSearch.generateEmbedding(summary)
      : undefined;

    // 5. Stocker le résumé
    const summaryId = await this.storeSummary({
      sessionId,
      level: 'L1',
      content: summary,
      tokens: this.estimateTokens(summary),
      coversMessageIds: messageIds,
      embedding,
      strategy: 'detailed'
    });

    return summaryId;
  }

  /**
   * Générer résumé L2
   */
  private async generateL2(sessionId: string, l1SummaryIds: string[]): Promise<string> {
    // 1. Récupérer les résumés L1
    const l1Summaries = await this.fetchSummaries(l1SummaryIds);

    // 2. Préparer le prompt
    const prompt = this.buildL2Prompt(l1Summaries);

    // 3. Générer le méta-résumé
    const summary = await this.summarizer.summarize(prompt, {
      model: this.config.summarizationModel,
      temperature: this.config.summarizationTemperature,
      maxTokens: Math.floor(this.sumTokens(l1Summaries) * 0.3) // Target 70% compression
    });

    // 4. Générer embedding
    const embedding = this.config.generateEmbeddingsForSummaries
      ? await this.vectorSearch.generateEmbedding(summary)
      : undefined;

    // 5. Stocker le résumé
    const summaryId = await this.storeSummary({
      sessionId,
      level: 'L2',
      content: summary,
      tokens: this.estimateTokens(summary),
      coversSummaryIds: l1SummaryIds,
      embedding,
      strategy: 'thematic'
    });

    return summaryId;
  }

  /**
   * Générer résumé L3
   */
  private async generateL3(sessionId: string, l2SummaryIds: string[]): Promise<string> {
    // 1. Récupérer les résumés L2
    const l2Summaries = await this.fetchSummaries(l2SummaryIds);

    // 2. Préparer le prompt
    const prompt = this.buildL3Prompt(l2Summaries);

    // 3. Générer le résumé exécutif
    const summary = await this.summarizer.summarize(prompt, {
      model: this.config.summarizationModel,
      temperature: this.config.summarizationTemperature,
      maxTokens: 800 // Ultra-condensé
    });

    // 4. Générer embedding
    const embedding = this.config.generateEmbeddingsForSummaries
      ? await this.vectorSearch.generateEmbedding(summary)
      : undefined;

    // 5. Stocker le résumé
    const summaryId = await this.storeSummary({
      sessionId,
      level: 'L3',
      content: summary,
      tokens: this.estimateTokens(summary),
      coversSummaryIds: l2SummaryIds,
      embedding,
      strategy: 'executive'
    });

    return summaryId;
  }

  private buildL1Prompt(messages: Message[]): string {
    return `You are summarizing a conversation segment.

MESSAGES:
${messages.map(m => `[${m.sentBy}]: ${m.content}`).join('\n')}

Provide a detailed summary preserving key facts, decisions, and technical details.
Target: ~50% of original length.`;
  }

  private buildL2Prompt(l1Summaries: any[]): string {
    return `You are creating a meta-summary from multiple summaries.

SUMMARIES:
${l1Summaries.map((s, i) => `--- Summary ${i + 1} ---\n${s.content}`).join('\n\n')}

Synthesize these into a thematic overview, eliminating redundancies.
Target: ~30% of combined length.`;
  }

  private buildL3Prompt(l2Summaries: any[]): string {
    return `You are creating an executive summary of an entire conversation.

META-SUMMARIES:
${l2Summaries.map((s, i) => `--- Meta-Summary ${i + 1} ---\n${s.content}`).join('\n\n')}

Provide an ultra-concise overview focusing on outcomes and impact.
Target: 200-400 tokens.`;
  }

  private async fetchMessages(messageIds: string[]): Promise<Message[]> {
    // Implementation
    return [];
  }

  private async fetchSummaries(summaryIds: string[]): Promise<any[]> {
    // Implementation
    return [];
  }

  private async storeSummary(data: any): Promise<string> {
    // Implementation using Neo4j
    return crypto.randomUUID();
  }

  private sumTokens(items: any[]): number {
    return items.reduce((sum, item) => sum + (item.tokens || 0), 0);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

**✅ Phase 3 Complete**: La compression hiérarchique est implémentée.

---

## Phase 4: Multi-Agent Orchestration

**Durée estimée**: 2-3 semaines

### Step 4.1: Orchestration Patterns

**Fichier**: `packages/runtime/src/agents/agent-orchestrator.ts`

**Objectif**: Implémenter les patterns d'orchestration multi-agents.

```typescript
export enum OrchestrationPattern {
  SEQUENTIAL = 'sequential',      // Agents s'exécutent l'un après l'autre
  PARALLEL = 'parallel',          // Agents s'exécutent en parallèle
  HIERARCHICAL = 'hierarchical',  // Agent coordinateur + agents workers
  DEBATE = 'debate'               // Agents débattent pour converger
}

export interface OrchestrationConfig {
  pattern: OrchestrationPattern;
  agents: string[];               // Agent IDs
  coordinator?: string;           // Pour HIERARCHICAL
  maxRounds?: number;             // Pour DEBATE
  consensusThreshold?: number;    // Pour DEBATE
}

export class AgentOrchestrator {
  constructor(
    private registry: AgentRegistry,
    private sessionManager: SessionManager,
    private messageStore: MessageStore
  ) {}

  /**
   * Orchestrer plusieurs agents selon un pattern
   */
  async orchestrate(
    sessionId: string,
    userMessage: string,
    config: OrchestrationConfig
  ): Promise<string> {
    switch (config.pattern) {
      case OrchestrationPattern.SEQUENTIAL:
        return this.sequential(sessionId, userMessage, config.agents);

      case OrchestrationPattern.PARALLEL:
        return this.parallel(sessionId, userMessage, config.agents);

      case OrchestrationPattern.HIERARCHICAL:
        return this.hierarchical(sessionId, userMessage, config);

      case OrchestrationPattern.DEBATE:
        return this.debate(sessionId, userMessage, config);

      default:
        throw new Error(`Unknown pattern: ${config.pattern}`);
    }
  }

  /**
   * Pattern Sequential: A → B → C
   */
  private async sequential(
    sessionId: string,
    initialMessage: string,
    agentIds: string[]
  ): Promise<string> {
    let currentMessage = initialMessage;
    let lastResponse = '';

    for (const agentId of agentIds) {
      const agent = this.registry.get(agentId);
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      // Récupérer contexte
      const context = await this.buildContext(sessionId);

      // Exécuter agent
      const response = await agent.execute(currentMessage, context);

      // Stocker le message
      await this.messageStore.create({
        sessionId,
        content: response,
        contentType: ContentType.TEXT,
        sentBy: agentId,
        tokens: this.estimateTokens(response)
      });

      currentMessage = response;
      lastResponse = response;
    }

    return lastResponse;
  }

  /**
   * Pattern Parallel: A + B + C → Synthesis
   */
  private async parallel(
    sessionId: string,
    message: string,
    agentIds: string[]
  ): Promise<string> {
    const context = await this.buildContext(sessionId);

    // Exécuter tous les agents en parallèle
    const responses = await Promise.all(
      agentIds.map(async (agentId) => {
        const agent = this.registry.get(agentId);
        if (!agent) throw new Error(`Agent ${agentId} not found`);

        const response = await agent.execute(message, context);

        // Stocker
        await this.messageStore.create({
          sessionId,
          content: response,
          contentType: ContentType.TEXT,
          sentBy: agentId,
          tokens: this.estimateTokens(response)
        });

        return { agentId, response };
      })
    );

    // Synthétiser les réponses
    const synthesis = await this.synthesizeResponses(responses);

    return synthesis;
  }

  /**
   * Pattern Hierarchical: Coordinator délègue aux workers
   */
  private async hierarchical(
    sessionId: string,
    message: string,
    config: OrchestrationConfig
  ): Promise<string> {
    if (!config.coordinator) {
      throw new Error('Coordinator required for hierarchical pattern');
    }

    const coordinator = this.registry.get(config.coordinator);
    if (!coordinator) throw new Error(`Coordinator ${config.coordinator} not found`);

    const context = await this.buildContext(sessionId);

    // 1. Coordinator décide de la stratégie
    const plan = await coordinator.execute(
      `Analyze this request and create an execution plan:\n\n${message}\n\nAvailable agents: ${config.agents.join(', ')}`,
      context
    );

    // 2. Parser le plan (simplifié)
    const tasks = this.parsePlan(plan);

    // 3. Déléguer aux workers
    const results = await Promise.all(
      tasks.map(async (task) => {
        const agent = this.registry.get(task.agentId);
        if (!agent) return null;

        const response = await agent.execute(task.instruction, context);

        await this.messageStore.create({
          sessionId,
          content: response,
          contentType: ContentType.TEXT,
          sentBy: task.agentId,
          tokens: this.estimateTokens(response)
        });

        return { agentId: task.agentId, response };
      })
    );

    // 4. Coordinator synthétise
    const finalResponse = await coordinator.execute(
      `Synthesize these results into a final answer:\n\n${JSON.stringify(results, null, 2)}`,
      context
    );

    return finalResponse;
  }

  /**
   * Pattern Debate: Agents débattent jusqu'à consensus
   */
  private async debate(
    sessionId: string,
    message: string,
    config: OrchestrationConfig
  ): Promise<string> {
    const maxRounds = config.maxRounds || 3;
    const context = await this.buildContext(sessionId);

    let currentProposals: Map<string, string> = new Map();

    // Round initial: chaque agent donne sa réponse
    for (const agentId of config.agents) {
      const agent = this.registry.get(agentId);
      if (!agent) continue;

      const response = await agent.execute(message, context);
      currentProposals.set(agentId, response);

      await this.messageStore.create({
        sessionId,
        content: response,
        contentType: ContentType.TEXT,
        sentBy: agentId,
        tokens: this.estimateTokens(response)
      });
    }

    // Rounds de débat
    for (let round = 1; round <= maxRounds; round++) {
      const newProposals: Map<string, string> = new Map();

      for (const agentId of config.agents) {
        const agent = this.registry.get(agentId);
        if (!agent) continue;

        // Montrer les autres propositions
        const otherProposals = Array.from(currentProposals.entries())
          .filter(([id]) => id !== agentId)
          .map(([id, prop]) => `Agent ${id}: ${prop}`)
          .join('\n\n');

        const debatePrompt = `
Original question: ${message}

Other agents' proposals:
${otherProposals}

Your previous proposal:
${currentProposals.get(agentId)}

Consider the other proposals and refine your answer or argue for your position.
`;

        const response = await agent.execute(debatePrompt, context);
        newProposals.set(agentId, response);

        await this.messageStore.create({
          sessionId,
          content: response,
          contentType: ContentType.TEXT,
          sentBy: agentId,
          tokens: this.estimateTokens(response),
          metadata: { round }
        });
      }

      currentProposals = newProposals;

      // Vérifier consensus (simplifié)
      if (this.hasConsensus(currentProposals)) {
        break;
      }
    }

    // Synthétiser le consensus
    return this.synthesizeDebate(currentProposals);
  }

  private async buildContext(sessionId: string): Promise<any> {
    const recentMessages = await this.messageStore.getRecent(sessionId, 10);
    return {
      sessionId,
      recentMessages: recentMessages.map(m => ({
        sender: m.sentBy,
        content: m.content
      }))
    };
  }

  private parsePlan(plan: string): Array<{ agentId: string; instruction: string }> {
    // Parsing simple pour démonstration
    // En production: utiliser un format structuré (JSON, YAML)
    return [];
  }

  private hasConsensus(proposals: Map<string, string>): boolean {
    // Implémentation simplifiée: vérifier similarité sémantique
    return false;
  }

  private async synthesizeResponses(responses: Array<{ agentId: string; response: string }>): Promise<string> {
    return `Synthesized response from ${responses.length} agents:\n\n` +
      responses.map(r => `[${r.agentId}]: ${r.response}`).join('\n\n');
  }

  private async synthesizeDebate(proposals: Map<string, string>): Promise<string> {
    return `Consensus after debate:\n\n` +
      Array.from(proposals.entries()).map(([id, prop]) => `[${id}]: ${prop}`).join('\n\n');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

**✅ Phase 4 Complete**: L'orchestration multi-agents est fonctionnelle.

---

## Phase 5: Built-in Agents pour RagForge

**Durée estimée**: 3-4 semaines

### Agents Pré-construits

**Fichier**: `packages/runtime/src/agents/built-in/index.ts`

```typescript
export class BuiltInAgents {
  static async registerAll(
    builder: AgentBuilder,
    registry: AgentRegistry
  ): Promise<void> {
    // 1. Code Review Agent
    const codeReviewerId = await builder
      .withId('built-in-code-reviewer')
      .withName('Code Review Assistant')
      .withRole('code_reviewer')
      .withPersona(`You are an expert code reviewer with deep knowledge of software engineering best practices.
Focus on: security vulnerabilities, performance issues, maintainability, code style, and potential bugs.`)
      .withInstructions('Provide constructive, actionable feedback with specific examples and suggested fixes.')
      .withModel('gemini-1.5-pro')
      .withTemperature(0.3)
      .withCapabilities(['code_analysis', 'security_audit', 'performance_analysis', 'best_practices'])
      .withTools(['semantic_search', 'code_navigation', 'rag_query'])
      .asBuiltIn()
      .build();

    await registry.register(codeReviewerId);

    // 2. Documentation Agent
    const docAgentId = await builder
      .withId('built-in-documentation')
      .withName('Documentation Assistant')
      .withRole('documentation')
      .withPersona(`You are a technical writer specialized in creating clear, comprehensive documentation.
Focus on: explaining complex concepts simply, providing examples, maintaining consistency.`)
      .withInstructions('Generate well-structured documentation with code examples, use cases, and best practices.')
      .withModel('gemini-1.5-pro')
      .withTemperature(0.5)
      .withCapabilities(['documentation', 'explanation', 'tutorial_creation'])
      .withTools(['semantic_search', 'code_navigation'])
      .asBuiltIn()
      .build();

    await registry.register(docAgentId);

    // 3. Refactoring Agent
    const refactoringId = await builder
      .withId('built-in-refactoring')
      .withName('Refactoring Assistant')
      .withRole('refactoring')
      .withPersona(`You are a refactoring expert who improves code quality without changing behavior.
Focus on: DRY principle, SOLID principles, design patterns, code organization.`)
      .withInstructions('Suggest refactorings that improve maintainability while preserving functionality.')
      .withModel('gemini-1.5-pro')
      .withTemperature(0.3)
      .withCapabilities(['refactoring', 'code_improvement', 'pattern_recognition'])
      .withTools(['semantic_search', 'code_navigation', 'dependency_analysis'])
      .asBuiltIn()
      .build();

    await registry.register(refactoringId);

    // 4. Architecture Agent
    const architectId = await builder
      .withId('built-in-architecture')
      .withName('Architecture Advisor')
      .withRole('architecture')
      .withPersona(`You are a software architect with expertise in system design and scalability.
Focus on: architecture patterns, scalability, maintainability, technology choices.`)
      .withInstructions('Provide high-level architectural guidance and identify design issues.')
      .withModel('gemini-1.5-pro')
      .withTemperature(0.4)
      .withCapabilities(['architecture', 'design', 'scalability', 'system_analysis'])
      .withTools(['semantic_search', 'dependency_analysis', 'pattern_analysis'])
      .asBuiltIn()
      .build();

    await registry.register(architectId);
  }
}
```

**✅ Phase 5 Complete**: 4 agents pré-construits disponibles.

---

## Phase 6: Developer Experience & High-Level API

**Durée estimée**: 2 semaines

### Step 6.1: High-Level ChatAdapter API

**Fichier**: `packages/runtime/src/adapters/chat-adapter.ts`

**Objectif**: API simple et intuitive pour les développeurs.

```typescript
export class ChatAdapter {
  private sessionManager: SessionManager;
  private messageStore: MessageStore;
  private orchestrator: AgentOrchestrator;
  private compressor: HierarchicalCompressor;
  private contextManager: ContextWindowManager;

  constructor(
    client: Neo4jClient,
    vectorSearch: VectorSearch,
    config: ChatAdapterConfig
  ) {
    // Initialize all components
    const interlocutorRegistry = new InterlocutorRegistry(client);
    this.sessionManager = new SessionManager(client, interlocutorRegistry);
    this.messageStore = new MessageStore(client, vectorSearch);
    // ... initialize other components
  }

  /**
   * Créer une nouvelle session de chat
   */
  async createSession(
    createdBy: string,
    config?: ChatSessionConfig
  ): Promise<string> {
    return this.sessionManager.create(createdBy, config);
  }

  /**
   * Ajouter un agent à une session
   */
  async addAgent(sessionId: string, agentId: string): Promise<void> {
    await this.sessionManager.addParticipant(sessionId, agentId, 'agent');
  }

  /**
   * Envoyer un message
   */
  async sendMessage(
    sessionId: string,
    content: string,
    sentBy: string,
    options?: {
      contentType?: ContentType;
      sentTo?: string[];
      threadId?: string;
      replyToId?: string;
    }
  ): Promise<string> {
    const messageId = await this.messageStore.create({
      sessionId,
      content,
      contentType: options?.contentType || ContentType.TEXT,
      sentBy,
      sentTo: options?.sentTo,
      threadId: options?.threadId,
      replyToId: options?.replyToId,
      tokens: this.estimateTokens(content)
    });

    // Déclencher compression si nécessaire
    await this.compressor.processSession(sessionId);

    return messageId;
  }

  /**
   * Obtenir une réponse d'un agent
   */
  async getAgentResponse(
    sessionId: string,
    agentId: string,
    userMessage: string
  ): Promise<string> {
    // 1. Sélectionner le contexte optimal
    const context = await this.contextManager.selectOptimalContext(sessionId, {
      maxTokens: 8000,
      reserveForMessages: 2000,
      availableForSummaries: 6000
    });

    // 2. Récupérer l'agent
    const agent = this.orchestrator['registry'].get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // 3. Exécuter l'agent
    const response = await agent.execute(userMessage, context);

    // 4. Stocker la réponse
    await this.sendMessage(sessionId, response, agentId);

    return response;
  }

  /**
   * Orchestrer plusieurs agents
   */
  async orchestrateAgents(
    sessionId: string,
    message: string,
    config: OrchestrationConfig
  ): Promise<string> {
    return this.orchestrator.orchestrate(sessionId, message, config);
  }

  /**
   * Recherche sémantique dans l'historique
   */
  async searchHistory(
    sessionId: string,
    query: string,
    topK: number = 10
  ): Promise<Array<Message & { score: number }>> {
    return this.messageStore.semanticSearch(sessionId, query, topK);
  }

  /**
   * Obtenir les statistiques d'une session
   */
  async getStats(sessionId: string) {
    return this.sessionManager.getStats(sessionId);
  }

  /**
   * Fermer une session
   */
  async closeSession(sessionId: string): Promise<void> {
    await this.sessionManager.close(sessionId);
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
```

### Step 6.2: Exemple d'Utilisation

```typescript
// Initialisation
const chatAdapter = new ChatAdapter(neo4jClient, vectorSearch, {
  compression: {
    enabled: true,
    l1MessageThreshold: 10,
    l2SummaryThreshold: 5,
    l3SummaryThreshold: 3
  }
});

// Enregistrer les built-in agents
await BuiltInAgents.registerAll(agentBuilder, agentRegistry);

// Créer une session
const sessionId = await chatAdapter.createSession('user-123', {
  title: 'Code Review Session',
  maxContextTokens: 8000
});

// Ajouter un agent
await chatAdapter.addAgent(sessionId, 'built-in-code-reviewer');

// Conversation
await chatAdapter.sendMessage(
  sessionId,
  'Please review the authentication module',
  'user-123'
);

const response = await chatAdapter.getAgentResponse(
  sessionId,
  'built-in-code-reviewer',
  'Focus on security vulnerabilities'
);

console.log(response);

// Orchestration multi-agents
const synthesis = await chatAdapter.orchestrateAgents(
  sessionId,
  'Design a scalable authentication system',
  {
    pattern: OrchestrationPattern.PARALLEL,
    agents: [
      'built-in-architecture',
      'built-in-code-reviewer',
      'built-in-documentation'
    ]
  }
);

// Recherche sémantique
const relevantMessages = await chatAdapter.searchHistory(
  sessionId,
  'security best practices',
  5
);

// Stats
const stats = await chatAdapter.getStats(sessionId);
console.log(`Messages: ${stats.messageCount}, Tokens: ${stats.totalTokens}`);
```

**✅ Phase 6 Complete**: API développeur intuitive et exemples complets.

---

## 🎉 Roadmap v2 Complete

### Résumé des Phases

1. ✅ **Phase 1**: Fondations multi-interlocuteurs (InterlocutorRegistry, MessageStore, SessionManager)
2. ✅ **Phase 2**: Agent Framework (AgentConfig, AgentBuilder, AgentRegistry)
3. ✅ **Phase 3**: Compression hiérarchique (Triggers L1/L2/L3, HierarchicalCompressor)
4. ✅ **Phase 4**: Orchestration multi-agents (Sequential, Parallel, Hierarchical, Debate)
5. ✅ **Phase 5**: Built-in Agents (CodeReview, Documentation, Refactoring, Architecture)
6. ✅ **Phase 6**: Developer Experience (High-level API, exemples d'utilisation)

### Documents Associés

- `CHAT-ADAPTER-QUESTIONS.md` - Questions et considérations détaillées
- `CHAT-ADAPTER-COMPRESSION.md` - Plan détaillé de compression hiérarchique

### Prochaines Étapes

1. **Implémentation**: Suivre les phases dans l'ordre
2. **Tests**: Tests unitaires et d'intégration pour chaque composant
3. **Documentation**: Guides utilisateur et API reference
4. **Exemples**: Applications de démonstration
5. **Métriques**: Monitoring et observabilité
6. **Optimisations**: Performance tuning et cost optimization
