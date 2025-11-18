# Agent avec Mémoire Conversationnelle - Design

## 🎯 Objectif

Créer un agent RagForge capable de :
1. **Mémoriser les messages** envoyés par l'utilisateur
2. **Stocker les tool calls** et leurs résultats
3. **Conserver les raisonnements** (thinking) de l'agent
4. **Récupérer le contexte pertinent** des conversations passées

## 📊 Schéma de Données

### Graph Structure dans Neo4j

```
(:Conversation)
  -[:HAS_MESSAGE]->(:Message)
    -[:MADE_TOOL_CALL]->(:ToolCall)
      -[:PRODUCED_RESULT]->(:ToolResult)
    -[:REFERENCES_CODE]->(:Scope)  // Optionnel: lien vers code discuté
```

### Nodes détaillés

```typescript
interface Conversation {
  uuid: string;
  created_at: timestamp;
  updated_at: timestamp;
  title?: string;           // Auto-généré par LLM ou user-provided
  summary?: string;          // Généré périodiquement
  tags?: string[];           // Pour catégoriser
  message_count: number;
  status: 'active' | 'archived';
}

interface Message {
  uuid: string;
  conversation_id: string;   // Pour query rapide
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;        // Le "thinking" de l'agent (si assistant)
  timestamp: timestamp;
  token_count?: number;
  embedding?: number[];      // Pour RAG sur messages
}

interface ToolCall {
  uuid: string;
  message_id: string;
  tool_name: string;
  arguments: string;         // JSON stringifié
  timestamp: timestamp;
  duration_ms: number;
  success: boolean;
  iteration?: number;        // Si per-item mode avec multiple iterations
}

interface ToolResult {
  uuid: string;
  tool_call_id: string;
  success: boolean;
  result: string;            // JSON stringifié
  error?: string;
  timestamp: timestamp;
  result_size_bytes: number;
}
```

## 🏗️ Architecture Proposée

### Option A: Tout dans Neo4j (Recommandé)

**Avantages**:
- Graph relationships naturelles
- Queries puissantes (ex: "conversations qui ont discuté du scope X")
- RAG sur messages avec vector search
- Tout centralisé dans RagForge

**Structure**:
```cypher
// Créer conversation
CREATE (c:Conversation {
  uuid: randomUUID(),
  created_at: datetime(),
  status: 'active'
})

// Ajouter message user
MATCH (c:Conversation {uuid: $conv_id})
CREATE (c)-[:HAS_MESSAGE]->(m:Message {
  uuid: randomUUID(),
  role: 'user',
  content: $content,
  timestamp: datetime()
})

// Message assistant avec tool calls
MATCH (c:Conversation {uuid: $conv_id})
CREATE (c)-[:HAS_MESSAGE]->(m:Message {
  uuid: randomUUID(),
  role: 'assistant',
  content: $content,
  reasoning: $reasoning,
  timestamp: datetime()
})
WITH m
UNWIND $tool_calls as tc
CREATE (m)-[:MADE_TOOL_CALL]->(t:ToolCall {
  uuid: randomUUID(),
  tool_name: tc.tool_name,
  arguments: tc.arguments,
  timestamp: datetime(),
  duration_ms: tc.duration_ms
})
CREATE (t)-[:PRODUCED_RESULT]->(r:ToolResult {
  uuid: randomUUID(),
  success: tc.success,
  result: tc.result
})
```

### Option B: Hybrid (Metadata dans Neo4j, contenu dans fichiers)

**Avantages**:
- Réduit la taille de la DB Neo4j
- Facilite backup/export des conversations

**Structure**:
```typescript
// Neo4j: metadata uniquement
(:Conversation {uuid, created_at, file_path: "./conversations/conv-123.json"})

// Fichier JSON: contenu complet
{
  "uuid": "conv-123",
  "messages": [
    {
      "role": "user",
      "content": "...",
      "timestamp": "..."
    },
    {
      "role": "assistant",
      "content": "...",
      "reasoning": "...",
      "tool_calls": [...]
    }
  ]
}
```

## 💻 API Proposée

### 1. Création et gestion de conversations

```typescript
import { ConversationAgent } from '@luciformresearch/ragforge-runtime';

// Créer un agent conversationnel
const agent = new ConversationAgent({
  neo4j: client,
  llmProvider: geminiProvider,
  tools: CODE_SEARCH_TOOLS,
  config: {
    maxContextMessages: 20,      // Derniers N messages dans le contexte
    enableSummarization: true,   // Auto-résumé périodique
    summarizeEvery: 10,          // Tous les 10 messages
    embedMessages: true,         // Embeddings pour RAG sur messages
  }
});

// Démarrer nouvelle conversation
const conversation = await agent.createConversation({
  title: "Refactoring authentication module",
  tags: ["refactoring", "auth"]
});

// Ou reprendre une conversation existante
const conversation = await agent.loadConversation(conversationId);
```

### 2. Envoi de messages

```typescript
// Envoyer un message
const response = await conversation.sendMessage(
  "Find all functions that handle user authentication"
);

console.log(response.content);           // Réponse de l'agent
console.log(response.tool_calls);        // Tools appelés
console.log(response.reasoning);         // Thinking de l'agent
console.log(response.context_used);      // Historique utilisé
```

### 3. Récupération de l'historique

```typescript
// Récupérer historique complet
const history = await conversation.getHistory({
  limit: 50,
  includeToolCalls: true,
  includeReasoning: true
});

// Récupérer messages pertinents (RAG sur historique)
const relevantHistory = await conversation.searchHistory({
  query: "authentication refactoring",
  limit: 10
});

// Récupérer tool calls spécifiques
const toolCalls = await conversation.getToolCalls({
  toolName: "search_functions",
  success: true,
  limit: 5
});
```

### 4. Gestion du contexte

```typescript
// Générer un résumé de la conversation
const summary = await conversation.summarize();
console.log(summary);
// "This conversation focused on refactoring authentication.
//  We identified 15 functions, suggested splitting AuthService..."

// Context window management
const context = await conversation.buildContext({
  strategy: 'hybrid',  // 'recent' | 'relevant' | 'hybrid'
  recentMessages: 5,   // Derniers 5 messages
  relevantMessages: 10, // Top 10 messages pertinents par RAG
  includeSummary: true
});
```

## 🔧 Implémentation

### ConversationAgent Class

```typescript
export class ConversationAgent {
  private neo4j: Neo4jClient;
  private executor: StructuredLLMExecutor;
  private llmProvider: LLMProvider;
  private tools: ToolDefinition[];
  private config: ConversationConfig;

  constructor(options: ConversationAgentOptions) {
    this.neo4j = options.neo4j;
    this.llmProvider = options.llmProvider;
    this.executor = new StructuredLLMExecutor();
    this.tools = options.tools;
    this.config = options.config;
  }

  async createConversation(options?: {
    title?: string;
    tags?: string[];
  }): Promise<Conversation> {
    const uuid = crypto.randomUUID();

    await this.neo4j.run(`
      CREATE (c:Conversation {
        uuid: $uuid,
        title: $title,
        tags: $tags,
        created_at: datetime(),
        updated_at: datetime(),
        message_count: 0,
        status: 'active'
      })
    `, {
      uuid,
      title: options?.title || 'New Conversation',
      tags: options?.tags || []
    });

    return new Conversation(uuid, this);
  }

  async loadConversation(uuid: string): Promise<Conversation> {
    // Vérifier que la conversation existe
    const result = await this.neo4j.run(`
      MATCH (c:Conversation {uuid: $uuid})
      RETURN c
    `, { uuid });

    if (result.records.length === 0) {
      throw new Error(`Conversation ${uuid} not found`);
    }

    return new Conversation(uuid, this);
  }

  async listConversations(options?: {
    limit?: number;
    status?: 'active' | 'archived';
    tags?: string[];
  }): Promise<ConversationMetadata[]> {
    const filters = [];
    if (options?.status) filters.push(`c.status = $status`);
    if (options?.tags?.length) filters.push(`ANY(tag IN $tags WHERE tag IN c.tags)`);

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const result = await this.neo4j.run(`
      MATCH (c:Conversation)
      ${whereClause}
      RETURN c
      ORDER BY c.updated_at DESC
      LIMIT $limit
    `, {
      limit: options?.limit || 50,
      status: options?.status,
      tags: options?.tags
    });

    return result.records.map(r => r.get('c').properties);
  }

  async findSimilarConversations(query: string, limit: number = 5): Promise<ConversationMetadata[]> {
    // RAG sur les summaries/titles des conversations
    const embedding = await this.generateEmbedding(query);

    // Assuming we have embeddings on Conversation.summary
    const result = await this.neo4j.run(`
      MATCH (c:Conversation)
      WHERE c.summary IS NOT NULL AND c.summary_embedding IS NOT NULL
      WITH c, vector.similarity.cosine(c.summary_embedding, $embedding) AS score
      WHERE score > 0.7
      RETURN c, score
      ORDER BY score DESC
      LIMIT $limit
    `, { embedding, limit });

    return result.records.map(r => ({
      ...r.get('c').properties,
      similarity: r.get('score')
    }));
  }
}
```

### Conversation Class

```typescript
export class Conversation {
  private uuid: string;
  private agent: ConversationAgent;
  private messageCache: Message[] = [];

  constructor(uuid: string, agent: ConversationAgent) {
    this.uuid = uuid;
    this.agent = agent;
  }

  async sendMessage(userMessage: string): Promise<AssistantResponse> {
    // 1. Stocker message user
    await this.storeMessage({
      role: 'user',
      content: userMessage
    });

    // 2. Build context from history
    const context = await this.buildContext();

    // 3. Exécuter avec tools
    const result = await this.agent.executor.executeLLMBatchWithTools(
      [{ user_message: userMessage }],
      {
        inputFields: ['user_message'],
        systemPrompt: this.buildSystemPrompt(context),
        userTask: 'Answer the user message using available tools',
        outputSchema: {
          response: { type: 'string', description: 'Your response to the user' },
          reasoning: { type: 'string', description: 'Your thinking process' }
        },
        tools: this.agent.tools,
        toolMode: 'per-item',
        maxIterationsPerItem: 5,
        toolExecutor: this.agent.toolExecutor,
        llmProvider: this.agent.llmProvider,
        batchSize: 1
      }
    );

    const response = Array.isArray(result) ? result[0] : result;

    // 4. Stocker réponse assistant + tool calls
    await this.storeMessage({
      role: 'assistant',
      content: response.response,
      reasoning: response.reasoning,
      toolCalls: response._metadata?.tool_calls  // Metadata from executor
    });

    // 5. Auto-summarize si nécessaire
    await this.checkSummarization();

    return {
      content: response.response,
      reasoning: response.reasoning,
      tool_calls: response._metadata?.tool_calls,
      context_used: context
    };
  }

  private async buildContext(options?: {
    strategy?: 'recent' | 'relevant' | 'hybrid';
    recentMessages?: number;
    relevantMessages?: number;
  }): Promise<ConversationContext> {
    const strategy = options?.strategy || 'hybrid';

    if (strategy === 'recent') {
      return this.getRecentContext(options?.recentMessages || 10);
    }

    if (strategy === 'relevant') {
      // RAG sur l'historique (pas encore implémenté)
      return this.getRelevantContext(options?.relevantMessages || 10);
    }

    // Hybrid: recent + relevant
    const recent = await this.getRecentContext(options?.recentMessages || 5);
    const summary = await this.getSummary();

    return {
      summary,
      recent_messages: recent.messages,
      message_count: recent.message_count
    };
  }

  private async getRecentContext(limit: number): Promise<ConversationContext> {
    const result = await this.agent.neo4j.run(`
      MATCH (c:Conversation {uuid: $uuid})-[:HAS_MESSAGE]->(m:Message)
      OPTIONAL MATCH (m)-[:MADE_TOOL_CALL]->(t:ToolCall)-[:PRODUCED_RESULT]->(r:ToolResult)
      WITH m, collect({
        tool_name: t.tool_name,
        arguments: t.arguments,
        result: r.result,
        success: r.success
      }) as tool_calls
      RETURN m, tool_calls
      ORDER BY m.timestamp DESC
      LIMIT $limit
    `, { uuid: this.uuid, limit });

    const messages = result.records.map(r => ({
      ...r.get('m').properties,
      tool_calls: r.get('tool_calls').filter((tc: any) => tc.tool_name)
    }));

    return {
      messages: messages.reverse(),  // Chronological order
      message_count: messages.length
    };
  }

  private buildSystemPrompt(context: ConversationContext): string {
    let prompt = `You are a helpful code analysis assistant with access to powerful tools.`;

    if (context.summary) {
      prompt += `\n\n## Conversation Summary\n${context.summary}`;
    }

    if (context.recent_messages?.length) {
      prompt += `\n\n## Recent Messages\n`;
      for (const msg of context.recent_messages) {
        prompt += `\n**${msg.role}**: ${msg.content}`;
        if (msg.reasoning) {
          prompt += `\n*Reasoning*: ${msg.reasoning}`;
        }
        if (msg.tool_calls?.length) {
          prompt += `\n*Tools used*: ${msg.tool_calls.map((tc: any) => tc.tool_name).join(', ')}`;
        }
      }
    }

    return prompt;
  }

  private async storeMessage(message: {
    role: string;
    content: string;
    reasoning?: string;
    toolCalls?: any[];
  }): Promise<void> {
    const messageUuid = crypto.randomUUID();

    // Stocker le message
    await this.agent.neo4j.run(`
      MATCH (c:Conversation {uuid: $convUuid})
      CREATE (c)-[:HAS_MESSAGE]->(m:Message {
        uuid: $msgUuid,
        conversation_id: $convUuid,
        role: $role,
        content: $content,
        reasoning: $reasoning,
        timestamp: datetime()
      })
      SET c.updated_at = datetime(),
          c.message_count = c.message_count + 1
    `, {
      convUuid: this.uuid,
      msgUuid: messageUuid,
      role: message.role,
      content: message.content,
      reasoning: message.reasoning || null
    });

    // Stocker les tool calls si présents
    if (message.toolCalls?.length) {
      for (const tc of message.toolCalls) {
        await this.storeToolCall(messageUuid, tc);
      }
    }

    // Générer embedding du message (async, non-bloquant)
    if (this.agent.config.embedMessages) {
      this.generateMessageEmbedding(messageUuid, message.content).catch(console.error);
    }
  }

  private async storeToolCall(messageUuid: string, toolCall: any): Promise<void> {
    const tcUuid = crypto.randomUUID();
    const resultUuid = crypto.randomUUID();

    await this.agent.neo4j.run(`
      MATCH (m:Message {uuid: $msgUuid})
      CREATE (m)-[:MADE_TOOL_CALL]->(t:ToolCall {
        uuid: $tcUuid,
        message_id: $msgUuid,
        tool_name: $toolName,
        arguments: $arguments,
        timestamp: datetime(),
        duration_ms: $duration,
        success: $success
      })
      CREATE (t)-[:PRODUCED_RESULT]->(r:ToolResult {
        uuid: $resultUuid,
        tool_call_id: $tcUuid,
        success: $success,
        result: $result,
        error: $error,
        timestamp: datetime()
      })
    `, {
      msgUuid: messageUuid,
      tcUuid,
      resultUuid,
      toolName: toolCall.tool_name,
      arguments: JSON.stringify(toolCall.arguments),
      duration: toolCall.duration_ms || 0,
      success: toolCall.success,
      result: JSON.stringify(toolCall.result),
      error: toolCall.error || null
    });
  }

  private async checkSummarization(): Promise<void> {
    if (!this.agent.config.enableSummarization) return;

    // Récupérer le nombre de messages
    const result = await this.agent.neo4j.run(`
      MATCH (c:Conversation {uuid: $uuid})
      RETURN c.message_count as count, c.summary as summary
    `, { uuid: this.uuid });

    const count = result.records[0]?.get('count')?.toNumber() || 0;
    const hasSummary = !!result.records[0]?.get('summary');

    // Générer résumé tous les N messages
    if (count % this.agent.config.summarizeEvery === 0 && count > 0) {
      await this.summarize();
    }
  }

  async summarize(): Promise<string> {
    // Récupérer tous les messages
    const history = await this.getHistory({ limit: 1000 });

    // Générer résumé avec LLM
    const conversationText = history.messages.map(m =>
      `${m.role}: ${m.content}`
    ).join('\n\n');

    const result = await this.agent.executor.executeLLMBatch(
      [{ conversation: conversationText }],
      {
        inputFields: ['conversation'],
        userTask: 'Summarize this conversation in 2-3 sentences. Focus on: 1) What was discussed, 2) What actions were taken, 3) Key findings',
        outputSchema: {
          summary: { type: 'string', description: 'Concise summary' }
        },
        llmProvider: this.agent.llmProvider,
        batchSize: 1
      }
    );

    const summary = Array.isArray(result) ? result[0].summary : result.summary;

    // Stocker le résumé
    await this.agent.neo4j.run(`
      MATCH (c:Conversation {uuid: $uuid})
      SET c.summary = $summary,
          c.updated_at = datetime()
    `, { uuid: this.uuid, summary });

    return summary;
  }

  async getHistory(options?: {
    limit?: number;
    includeToolCalls?: boolean;
    includeReasoning?: boolean;
  }): Promise<{ messages: Message[] }> {
    const includeToolCalls = options?.includeToolCalls ?? true;

    const toolCallsQuery = includeToolCalls ? `
      OPTIONAL MATCH (m)-[:MADE_TOOL_CALL]->(t:ToolCall)-[:PRODUCED_RESULT]->(r:ToolResult)
      WITH m, collect({
        tool_name: t.tool_name,
        arguments: t.arguments,
        result: r.result,
        success: r.success,
        duration_ms: t.duration_ms
      }) as tool_calls
    ` : 'WITH m, [] as tool_calls';

    const result = await this.agent.neo4j.run(`
      MATCH (c:Conversation {uuid: $uuid})-[:HAS_MESSAGE]->(m:Message)
      ${toolCallsQuery}
      RETURN m, tool_calls
      ORDER BY m.timestamp ASC
      LIMIT $limit
    `, { uuid: this.uuid, limit: options?.limit || 100 });

    const messages = result.records.map(r => ({
      ...r.get('m').properties,
      tool_calls: r.get('tool_calls').filter((tc: any) => tc.tool_name)
    }));

    return { messages };
  }
}
```

## 🎨 Fonctionnalités Avancées

### 1. RAG sur l'historique

```typescript
// Embeddings sur les messages pour retrieval sémantique
await conversation.searchHistory({
  query: "functions that validate passwords",
  limit: 5
});

// Query:
MATCH (c:Conversation {uuid: $uuid})-[:HAS_MESSAGE]->(m:Message)
WHERE m.embedding IS NOT NULL
WITH m, vector.similarity.cosine(m.embedding, $queryEmbedding) AS score
WHERE score > 0.7
RETURN m
ORDER BY score DESC
LIMIT $limit
```

### 2. Linking messages to code

```typescript
// Créer relationship entre message et scopes discutés
MATCH (m:Message {uuid: $msgUuid})
MATCH (s:Scope {uuid: $scopeUuid})
CREATE (m)-[:REFERENCES_CODE]->(s)

// Query conversations about a specific scope
MATCH (s:Scope {name: "AuthService"})<-[:REFERENCES_CODE]-(m:Message)
<-[:HAS_MESSAGE]-(c:Conversation)
RETURN DISTINCT c
```

### 3. Export/Import conversations

```typescript
// Export to JSON
const exported = await conversation.export();
fs.writeFileSync('conversation.json', JSON.stringify(exported, null, 2));

// Import from JSON
await agent.importConversation(exported);
```

### 4. Conversation branching

```typescript
// Créer une branche à partir d'un message spécifique
const branch = await conversation.branch({
  fromMessageId: messageUuid,
  title: "Alternative approach"
});

// Graph structure:
(:Conversation)-[:HAS_BRANCH]->(:Conversation)
```

## 📦 Configuration dans ragforge.config.yaml

```yaml
agent:
  memory:
    enabled: true
    max_context_messages: 20
    summarization:
      enabled: true
      every_n_messages: 10
    embeddings:
      enabled: true
      model: text-embedding-004
      dimension: 768
    persistence:
      type: neo4j  # ou 'files'
      auto_save: true
```

## 🚀 Rollout Plan

### Phase 1: Core Memory (2-3h)
1. ✅ Design document (ce fichier)
2. ⏳ Implement ConversationAgent class
3. ⏳ Implement Conversation class
4. ⏳ Basic storage (messages only, no tool calls)
5. ⏳ Simple context building (recent messages)

### Phase 2: Tool Calls Storage (1-2h)
1. ⏳ Store ToolCall and ToolResult nodes
2. ⏳ Include tool calls in context
3. ⏳ Query tool calls history

### Phase 3: Advanced Features (2-3h)
1. ⏳ Auto-summarization
2. ⏳ Message embeddings + RAG
3. ⏳ Linking messages to code scopes
4. ⏳ Export/import conversations

### Phase 4: Code Generation (1h)
1. ⏳ Add to ragforge.config.yaml schema
2. ⏳ Generate ConversationAgent in generated projects
3. ⏳ Add examples

## 💡 Use Cases

### Use Case 1: Debugging Session
```typescript
const session = await agent.createConversation({
  title: "Debug authentication bug",
  tags: ["debugging", "auth"]
});

// User can ask follow-up questions
await session.sendMessage("Find authentication functions");
// Agent uses tools, stores results

await session.sendMessage("Which one handles password validation?");
// Agent has context from previous message

await session.sendMessage("Show me its implementation");
// Agent knows which function we're talking about

// Later, resume
const session = await agent.loadConversation(sessionId);
await session.sendMessage("Did we fix that bug?");
```

### Use Case 2: Refactoring Planning
```typescript
const planning = await agent.createConversation({
  title: "Refactor UserService"
});

// Multi-turn conversation pour planifier
await planning.sendMessage("Analyze UserService complexity");
await planning.sendMessage("What are the main issues?");
await planning.sendMessage("Suggest refactoring strategy");

// Générer résumé
const summary = await planning.summarize();
// "Analyzed UserService. Found high complexity in auth methods.
//  Suggested splitting into AuthService and UserDataService."
```

### Use Case 3: Learning from Past Conversations
```typescript
// Trouver conversations similaires
const similar = await agent.findSimilarConversations(
  "refactoring authentication",
  limit: 3
);

// "You had 3 similar conversations. Here's what we learned..."
```

## ✅ Benefits

1. **Contexte persistant**: L'agent se souvient des conversations
2. **Tool calls history**: Voir quels tools ont été utilisés et leurs résultats
3. **Reasoning tracking**: Comprendre comment l'agent raisonne
4. **Multi-session**: Reprendre une conversation plus tard
5. **Knowledge accumulation**: Apprendre des conversations passées
6. **Debugging**: Tracer les décisions de l'agent

## 🔗 Integration avec Meta-LLM

Cette fonctionnalité se marie parfaitement avec batch_analyze:

```typescript
// Analyser toutes les conversations passées
const conversations = await agent.listConversations({ limit: 50 });

const insights = await batch_analyze({
  items: conversations,
  task: "Extract key insights and patterns from this conversation",
  outputSchema: {
    main_topic: { type: 'string' },
    key_findings: { type: 'array' },
    action_items: { type: 'array' }
  }
});

// Stocker insights dans Neo4j
for (const insight of insights) {
  await storeConversationInsights(insight);
}
```
