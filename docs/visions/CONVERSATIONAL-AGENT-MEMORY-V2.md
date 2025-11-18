# Agent avec Mémoire Conversationnelle - Architecture Runtime

## 🎯 Objectif

Créer un agent conversationnel **directement dans `@luciformresearch/ragforge-runtime`**, utilisable sans génération de code, avec :
1. **Tout dans Neo4j** par défaut
2. **Export temps réel optionnel** vers fichiers JSON (pour debug)
3. **Testable immédiatement** sans `ragforge generate`
4. **Zero configuration** - juste instancier et utiliser

## 🏗️ Architecture

### Package Structure

```
packages/runtime/src/
  conversation/
    agent.ts              # ConversationAgent class
    conversation.ts       # Conversation class
    storage.ts            # Neo4j storage operations
    exporter.ts           # Optional file export
    types.ts              # TypeScript interfaces
    index.ts              # Exports
```

### Graph Structure Neo4j

```cypher
(:Conversation {
  uuid: string,
  created_at: datetime,
  updated_at: datetime,
  title: string,
  summary: string,
  tags: [string],
  message_count: number,
  status: 'active' | 'archived'
})
  -[:HAS_MESSAGE]->
(:Message {
  uuid: string,
  conversation_id: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  reasoning: string,         // Le "thinking" de l'agent
  timestamp: datetime,
  token_count: number,
  embedding: [float]         // Optionnel pour RAG
})
  -[:MADE_TOOL_CALL]->
(:ToolCall {
  uuid: string,
  message_id: string,
  tool_name: string,
  arguments: string,         // JSON stringifié
  timestamp: datetime,
  duration_ms: number,
  success: boolean,
  iteration: number          // Pour per-item mode
})
  -[:PRODUCED_RESULT]->
(:ToolResult {
  uuid: string,
  tool_call_id: string,
  success: boolean,
  result: string,            // JSON stringifié
  error: string,
  timestamp: datetime,
  result_size_bytes: number
})

// Optionnel: lier messages au code discuté
(:Message)-[:REFERENCES_CODE]->(:Scope)
```

## 💻 API Runtime

### Import Direct depuis Runtime

```typescript
import {
  ConversationAgent,
  type ConversationConfig,
  type ConversationMetadata
} from '@luciformresearch/ragforge-runtime';

// Pas besoin de ragforge generate !
```

### Configuration

```typescript
const agent = new ConversationAgent({
  // Required
  neo4j: client,
  llmProvider: geminiProvider,

  // Optional
  tools: CODE_SEARCH_TOOLS,           // Outils disponibles
  toolExecutor: toolExecutor,         // Executor pour les tools

  config: {
    // Context management
    maxContextMessages: 20,           // Derniers N messages dans contexte
    contextStrategy: 'hybrid',        // 'recent' | 'relevant' | 'hybrid'

    // Summarization
    enableSummarization: true,
    summarizeEvery: 10,               // Auto-résumé tous les N messages

    // Embeddings (pour RAG sur historique)
    embedMessages: true,
    embeddingProvider: embeddingProvider,

    // Export pour debug (NOUVEAU)
    exportToFiles: true,              // Enable real-time export
    exportPath: './conversations',    // Où exporter
    exportFormat: 'json',             // 'json' | 'markdown'
    exportOnEveryMessage: true,       // Export après chaque message
  }
});
```

### Usage de Base

```typescript
// 1. Créer conversation
const conv = await agent.createConversation({
  title: "Debug authentication",
  tags: ["debugging", "auth"]
});

// Fichier créé automatiquement si exportToFiles: true
// → ./conversations/conv-abc123.json

// 2. Envoyer message
const response = await conv.sendMessage(
  "Find all functions that handle password validation"
);

console.log(response.content);
// → "I found 3 functions: validatePassword, checkPasswordStrength, hashPassword"

console.log(response.reasoning);
// → "First I'll search for functions with 'password' in name, then filter for validation..."

console.log(response.tool_calls);
// → [{ tool_name: 'search_functions', arguments: {...}, result: [...] }]

// 3. Continue conversation (agent se souvient)
const response2 = await conv.sendMessage(
  "Show me the implementation of validatePassword"
);
// L'agent sait de quelle fonction on parle !

// 4. Reprendre plus tard
const conversations = await agent.listConversations();
const conv = await agent.loadConversation(conversations[0].uuid);
await conv.sendMessage("Where were we?");
```

### Export Temps Réel

```typescript
// Si exportToFiles: true, chaque message génère:

// ./conversations/conv-abc123.json
{
  "uuid": "abc123",
  "title": "Debug authentication",
  "tags": ["debugging", "auth"],
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:05:23Z",
  "summary": "User debugging authentication. Found validatePassword function.",
  "messages": [
    {
      "uuid": "msg-001",
      "role": "user",
      "content": "Find all functions that handle password validation",
      "timestamp": "2025-01-15T10:00:00Z"
    },
    {
      "uuid": "msg-002",
      "role": "assistant",
      "content": "I found 3 functions...",
      "reasoning": "First I'll search for functions...",
      "timestamp": "2025-01-15T10:00:15Z",
      "tool_calls": [
        {
          "tool_name": "search_functions",
          "arguments": { "query": "password validation" },
          "duration_ms": 1234,
          "success": true,
          "result": {
            "functions": [...]
          }
        }
      ]
    },
    {
      "uuid": "msg-003",
      "role": "user",
      "content": "Show me the implementation of validatePassword",
      "timestamp": "2025-01-15T10:05:00Z"
    }
    // ...
  ]
}

// Fichier mis à jour en temps réel après chaque message !
```

### Aussi en Markdown (optionnel)

```typescript
config: {
  exportFormat: 'markdown'
}

// Génère: ./conversations/conv-abc123.md
```

```markdown
# Debug authentication

**Created**: 2025-01-15T10:00:00Z
**Tags**: debugging, auth
**Status**: active

---

## Summary

User debugging authentication. Found validatePassword function.

---

## Messages

### User (2025-01-15T10:00:00Z)

Find all functions that handle password validation

### Assistant (2025-01-15T10:00:15Z)

I found 3 functions: validatePassword, checkPasswordStrength, hashPassword

**Reasoning**: First I'll search for functions with 'password' in name...

**Tools used**:
- `search_functions`: Found 3 matching functions (1.2s)

### User (2025-01-15T10:05:00Z)

Show me the implementation of validatePassword
```

## 🔧 Implementation

### ConversationAgent Class

```typescript
// packages/runtime/src/conversation/agent.ts

import type { Neo4jClient } from '../client/neo4j-client.js';
import type { LLMProvider } from '../llm/types.js';
import type { EmbeddingProvider } from '../embedding/types.js';
import type { ToolDefinition, ToolExecutor } from '../tools/types.js';
import { Conversation } from './conversation.js';
import { ConversationStorage } from './storage.js';
import { ConversationExporter } from './exporter.js';

export interface ConversationConfig {
  maxContextMessages?: number;
  contextStrategy?: 'recent' | 'relevant' | 'hybrid';
  enableSummarization?: boolean;
  summarizeEvery?: number;
  embedMessages?: boolean;
  embeddingProvider?: EmbeddingProvider;
  exportToFiles?: boolean;
  exportPath?: string;
  exportFormat?: 'json' | 'markdown';
  exportOnEveryMessage?: boolean;
}

export interface ConversationAgentOptions {
  neo4j: Neo4jClient;
  llmProvider: LLMProvider;
  tools?: ToolDefinition[];
  toolExecutor?: ToolExecutor;
  config?: ConversationConfig;
}

export class ConversationAgent {
  private neo4j: Neo4jClient;
  private llmProvider: LLMProvider;
  private tools: ToolDefinition[];
  private toolExecutor?: ToolExecutor;
  private config: Required<ConversationConfig>;
  private storage: ConversationStorage;
  private exporter?: ConversationExporter;
  private initialized: boolean = false;

  constructor(options: ConversationAgentOptions) {
    this.neo4j = options.neo4j;
    this.llmProvider = options.llmProvider;
    this.tools = options.tools || [];
    this.toolExecutor = options.toolExecutor;

    // Default config
    this.config = {
      maxContextMessages: options.config?.maxContextMessages ?? 20,
      contextStrategy: options.config?.contextStrategy ?? 'hybrid',
      enableSummarization: options.config?.enableSummarization ?? true,
      summarizeEvery: options.config?.summarizeEvery ?? 10,
      embedMessages: options.config?.embedMessages ?? false,
      embeddingProvider: options.config?.embeddingProvider,
      exportToFiles: options.config?.exportToFiles ?? false,
      exportPath: options.config?.exportPath ?? './conversations',
      exportFormat: options.config?.exportFormat ?? 'json',
      exportOnEveryMessage: options.config?.exportOnEveryMessage ?? true
    };

    this.storage = new ConversationStorage(this.neo4j);

    // Setup exporter si activé
    if (this.config.exportToFiles) {
      this.exporter = new ConversationExporter({
        path: this.config.exportPath,
        format: this.config.exportFormat
      });
    }
  }

  /**
   * Initialize database schema (create constraints/indexes)
   * Call once at startup, or use auto-init on first conversation
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('🔧 Initializing ConversationAgent schema...');

    // Créer contraintes
    await this.neo4j.run(`
      CREATE CONSTRAINT conversation_uuid IF NOT EXISTS
      FOR (c:Conversation) REQUIRE c.uuid IS UNIQUE
    `);

    await this.neo4j.run(`
      CREATE CONSTRAINT message_uuid IF NOT EXISTS
      FOR (m:Message) REQUIRE m.uuid IS UNIQUE
    `);

    await this.neo4j.run(`
      CREATE CONSTRAINT tool_call_uuid IF NOT EXISTS
      FOR (t:ToolCall) REQUIRE t.uuid IS UNIQUE
    `);

    // Index pour recherche rapide
    await this.neo4j.run(`
      CREATE INDEX conversation_status IF NOT EXISTS
      FOR (c:Conversation) ON (c.status)
    `);

    await this.neo4j.run(`
      CREATE INDEX message_conversation IF NOT EXISTS
      FOR (m:Message) ON (m.conversation_id)
    `);

    // Vector index si embeddings activés
    if (this.config.embedMessages) {
      try {
        await this.neo4j.run(`
          CREATE VECTOR INDEX message_embeddings IF NOT EXISTS
          FOR (m:Message) ON (m.embedding)
          OPTIONS {
            indexConfig: {
              \`vector.dimensions\`: 768,
              \`vector.similarity_function\`: 'cosine'
            }
          }
        `);
        console.log('   ✓ Vector index created for message embeddings');
      } catch (error) {
        console.warn('   ⚠️  Vector index creation failed (requires Neo4j 5.15+):', error);
      }
    }

    this.initialized = true;
    console.log('✅ ConversationAgent schema initialized');
  }

  /**
   * Create a new conversation
   */
  async createConversation(options?: {
    title?: string;
    tags?: string[];
    autoInit?: boolean;
  }): Promise<Conversation> {
    // Auto-init si pas déjà fait
    if (options?.autoInit !== false && !this.initialized) {
      await this.initialize();
    }

    const uuid = crypto.randomUUID();
    const title = options?.title || 'New Conversation';
    const tags = options?.tags || [];

    await this.storage.createConversation({
      uuid,
      title,
      tags,
      created_at: new Date(),
      updated_at: new Date(),
      message_count: 0,
      status: 'active'
    });

    const conversation = new Conversation(uuid, this);

    // Export initial state si activé
    if (this.exporter) {
      await this.exporter.export(conversation, await conversation.getFullData());
    }

    return conversation;
  }

  /**
   * Load existing conversation
   */
  async loadConversation(uuid: string): Promise<Conversation> {
    const metadata = await this.storage.getConversationMetadata(uuid);
    if (!metadata) {
      throw new Error(`Conversation ${uuid} not found`);
    }

    return new Conversation(uuid, this);
  }

  /**
   * List all conversations
   */
  async listConversations(options?: {
    limit?: number;
    status?: 'active' | 'archived';
    tags?: string[];
    orderBy?: 'created' | 'updated';
  }): Promise<ConversationMetadata[]> {
    return this.storage.listConversations(options);
  }

  /**
   * Find conversations similar to a query (RAG on summaries)
   */
  async findSimilarConversations(
    query: string,
    options?: {
      limit?: number;
      minScore?: number;
    }
  ): Promise<Array<ConversationMetadata & { similarity: number }>> {
    if (!this.config.embeddingProvider) {
      throw new Error('embeddingProvider required for semantic search');
    }

    const embedding = await this.config.embeddingProvider.generateEmbedding(query);

    return this.storage.findSimilarConversations(embedding, {
      limit: options?.limit ?? 5,
      minScore: options?.minScore ?? 0.7
    });
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(uuid: string): Promise<void> {
    await this.storage.deleteConversation(uuid);

    // Supprimer fichier export si existe
    if (this.exporter) {
      await this.exporter.delete(uuid);
    }
  }

  /**
   * Archive a conversation (keep in DB but mark as archived)
   */
  async archiveConversation(uuid: string): Promise<void> {
    await this.storage.updateConversationStatus(uuid, 'archived');
  }

  // Getters for internal use by Conversation
  getStorage() { return this.storage; }
  getConfig() { return this.config; }
  getLLMProvider() { return this.llmProvider; }
  getTools() { return this.tools; }
  getToolExecutor() { return this.toolExecutor; }
  getExporter() { return this.exporter; }
}
```

### Conversation Class (Simplified)

```typescript
// packages/runtime/src/conversation/conversation.ts

import type { ConversationAgent } from './agent.js';
import type { Message, ToolCall, AssistantResponse } from './types.js';
import { StructuredLLMExecutor } from '../llm/structured-executor.js';

export class Conversation {
  private uuid: string;
  private agent: ConversationAgent;
  private executor: StructuredLLMExecutor;

  constructor(uuid: string, agent: ConversationAgent) {
    this.uuid = uuid;
    this.agent = agent;
    this.executor = new StructuredLLMExecutor();
  }

  /**
   * Send a message in the conversation
   */
  async sendMessage(userMessage: string): Promise<AssistantResponse> {
    const storage = this.agent.getStorage();
    const config = this.agent.getConfig();

    // 1. Store user message
    const userMsgUuid = await storage.storeMessage({
      conversation_id: this.uuid,
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    // 2. Build context from history
    const context = await this.buildContext();

    // 3. Execute with tools
    const tools = this.agent.getTools();
    const toolExecutor = this.agent.getToolExecutor();
    const llmProvider = this.agent.getLLMProvider();

    const result = await this.executor.executeLLMBatchWithTools(
      [{ user_message: userMessage }],
      {
        inputFields: ['user_message'],
        systemPrompt: this.buildSystemPrompt(context),
        userTask: 'Answer the user message using available tools if needed',
        outputSchema: {
          response: { type: 'string', description: 'Your response' },
          reasoning: { type: 'string', description: 'Your thinking process' }
        },
        tools,
        toolMode: 'per-item',
        maxIterationsPerItem: 5,
        toolExecutor,
        llmProvider,
        batchSize: 1
      }
    );

    const response = Array.isArray(result) ? result[0] : result;

    // 4. Store assistant message + tool calls
    const assistantMsgUuid = await storage.storeMessage({
      conversation_id: this.uuid,
      role: 'assistant',
      content: response.response,
      reasoning: response.reasoning,
      timestamp: new Date()
    });

    // Store tool calls
    const toolCalls = response._metadata?.tool_calls || [];
    for (const tc of toolCalls) {
      await storage.storeToolCall(assistantMsgUuid, tc);
    }

    // 5. Update conversation metadata
    await storage.incrementMessageCount(this.uuid);

    // 6. Check if summarization needed
    await this.checkSummarization();

    // 7. Generate embedding for messages if enabled
    if (config.embedMessages && config.embeddingProvider) {
      // Async, non-blocking
      Promise.all([
        this.generateMessageEmbedding(userMsgUuid, userMessage),
        this.generateMessageEmbedding(assistantMsgUuid, response.response)
      ]).catch(console.error);
    }

    // 8. Export to file if enabled
    if (config.exportToFiles && config.exportOnEveryMessage) {
      const exporter = this.agent.getExporter();
      if (exporter) {
        const data = await this.getFullData();
        await exporter.export(this, data);
      }
    }

    return {
      content: response.response,
      reasoning: response.reasoning,
      tool_calls: toolCalls,
      context_used: context
    };
  }

  /**
   * Build context from conversation history
   */
  private async buildContext(): Promise<ConversationContext> {
    const config = this.agent.getConfig();
    const storage = this.agent.getStorage();

    if (config.contextStrategy === 'recent') {
      return storage.getRecentContext(this.uuid, config.maxContextMessages);
    }

    if (config.contextStrategy === 'relevant') {
      // TODO: RAG-based context (pas encore implémenté)
      return storage.getRecentContext(this.uuid, config.maxContextMessages);
    }

    // Hybrid: recent + summary
    const recent = await storage.getRecentContext(this.uuid, 5);
    const metadata = await storage.getConversationMetadata(this.uuid);

    return {
      summary: metadata?.summary,
      recent_messages: recent.messages,
      message_count: metadata?.message_count || 0
    };
  }

  /**
   * Build system prompt with context
   */
  private buildSystemPrompt(context: ConversationContext): string {
    let prompt = `You are a helpful code analysis assistant with access to powerful tools.`;

    if (context.summary) {
      prompt += `\n\n## Conversation Summary\n${context.summary}`;
    }

    if (context.recent_messages?.length) {
      prompt += `\n\n## Recent Messages (for context)\n`;
      for (const msg of context.recent_messages) {
        prompt += `\n**${msg.role}**: ${msg.content}`;
        if (msg.reasoning) {
          prompt += `\n  *Reasoning*: ${msg.reasoning}`;
        }
      }
    }

    prompt += `\n\nUse tools when needed to answer accurately.`;

    return prompt;
  }

  /**
   * Check if summarization is needed
   */
  private async checkSummarization(): Promise<void> {
    const config = this.agent.getConfig();
    if (!config.enableSummarization) return;

    const storage = this.agent.getStorage();
    const metadata = await storage.getConversationMetadata(this.uuid);
    const count = metadata?.message_count || 0;

    if (count > 0 && count % config.summarizeEvery === 0) {
      await this.summarize();
    }
  }

  /**
   * Generate a summary of the conversation
   */
  async summarize(): Promise<string> {
    const storage = this.agent.getStorage();
    const llmProvider = this.agent.getLLMProvider();

    const history = await storage.getMessages(this.uuid, { limit: 1000 });

    const conversationText = history.map(m =>
      `${m.role}: ${m.content}`
    ).join('\n\n');

    const result = await this.executor.executeLLMBatch(
      [{ conversation: conversationText }],
      {
        inputFields: ['conversation'],
        userTask: 'Summarize this conversation in 2-3 sentences. Focus on: what was discussed, actions taken, key findings.',
        outputSchema: {
          summary: { type: 'string' }
        },
        llmProvider,
        batchSize: 1
      }
    );

    const summary = Array.isArray(result) ? result[0].summary : result.summary;

    await storage.updateConversationSummary(this.uuid, summary);

    return summary;
  }

  /**
   * Generate embedding for a message
   */
  private async generateMessageEmbedding(messageUuid: string, content: string): Promise<void> {
    const config = this.agent.getConfig();
    const storage = this.agent.getStorage();

    if (!config.embeddingProvider) return;

    const embedding = await config.embeddingProvider.generateEmbedding(content);
    await storage.updateMessageEmbedding(messageUuid, embedding);
  }

  /**
   * Get conversation history
   */
  async getHistory(options?: {
    limit?: number;
    includeToolCalls?: boolean;
  }): Promise<{ messages: Message[] }> {
    const storage = this.agent.getStorage();
    const messages = await storage.getMessages(this.uuid, options);
    return { messages };
  }

  /**
   * Get full conversation data (for export)
   */
  async getFullData(): Promise<ConversationFullData> {
    const storage = this.agent.getStorage();
    const metadata = await storage.getConversationMetadata(this.uuid);
    const messages = await storage.getMessages(this.uuid, {
      includeToolCalls: true,
      limit: 10000
    });

    return {
      ...metadata!,
      messages
    };
  }

  /**
   * Get conversation UUID
   */
  getUuid(): string {
    return this.uuid;
  }
}
```

### ConversationExporter

```typescript
// packages/runtime/src/conversation/exporter.ts

import { promises as fs } from 'fs';
import path from 'path';
import type { Conversation } from './conversation.js';
import type { ConversationFullData } from './types.js';

export interface ExporterOptions {
  path: string;
  format: 'json' | 'markdown';
}

export class ConversationExporter {
  private path: string;
  private format: 'json' | 'markdown';

  constructor(options: ExporterOptions) {
    this.path = options.path;
    this.format = options.format;
  }

  /**
   * Export conversation to file
   */
  async export(conversation: Conversation, data: ConversationFullData): Promise<void> {
    await fs.mkdir(this.path, { recursive: true });

    const filename = this.format === 'json'
      ? `conv-${conversation.getUuid()}.json`
      : `conv-${conversation.getUuid()}.md`;

    const filepath = path.join(this.path, filename);

    const content = this.format === 'json'
      ? this.toJSON(data)
      : this.toMarkdown(data);

    await fs.writeFile(filepath, content, 'utf-8');
  }

  /**
   * Delete exported file
   */
  async delete(uuid: string): Promise<void> {
    const jsonPath = path.join(this.path, `conv-${uuid}.json`);
    const mdPath = path.join(this.path, `conv-${uuid}.md`);

    await Promise.allSettled([
      fs.unlink(jsonPath),
      fs.unlink(mdPath)
    ]);
  }

  private toJSON(data: ConversationFullData): string {
    return JSON.stringify(data, null, 2);
  }

  private toMarkdown(data: ConversationFullData): string {
    let md = `# ${data.title}\n\n`;
    md += `**Created**: ${data.created_at}\n`;
    md += `**Updated**: ${data.updated_at}\n`;
    if (data.tags?.length) {
      md += `**Tags**: ${data.tags.join(', ')}\n`;
    }
    md += `**Status**: ${data.status}\n\n`;
    md += `---\n\n`;

    if (data.summary) {
      md += `## Summary\n\n${data.summary}\n\n---\n\n`;
    }

    md += `## Messages\n\n`;

    for (const msg of data.messages) {
      md += `### ${msg.role} (${msg.timestamp})\n\n`;
      md += `${msg.content}\n\n`;

      if (msg.reasoning) {
        md += `**Reasoning**: ${msg.reasoning}\n\n`;
      }

      if (msg.tool_calls?.length) {
        md += `**Tools used**:\n`;
        for (const tc of msg.tool_calls) {
          const status = tc.success ? '✓' : '✗';
          md += `- ${status} \`${tc.tool_name}\``;
          if (tc.duration_ms) {
            md += ` (${tc.duration_ms}ms)`;
          }
          md += `\n`;
        }
        md += `\n`;
      }
    }

    return md;
  }
}
```

## 🧪 Testing (Sans Generate!)

```typescript
// test-conversation-agent.ts

import { config } from 'dotenv';
import {
  Neo4jClient,
  GeminiAPIProvider,
  GeminiEmbeddingProvider,
  ConversationAgent
} from '@luciformresearch/ragforge-runtime';

config();

async function test() {
  const neo4j = new Neo4jClient({
    uri: process.env.NEO4J_URI!,
    username: process.env.NEO4J_USERNAME!,
    password: process.env.NEO4J_PASSWORD!
  });

  const llmProvider = new GeminiAPIProvider({
    apiKey: process.env.GEMINI_API_KEY!,
    model: 'gemini-2.0-flash'
  });

  const embeddingProvider = new GeminiEmbeddingProvider({
    apiKey: process.env.GEMINI_API_KEY!
  });

  // Create agent (pas besoin de generate!)
  const agent = new ConversationAgent({
    neo4j,
    llmProvider,
    config: {
      enableSummarization: true,
      summarizeEvery: 5,
      embedMessages: true,
      embeddingProvider,
      exportToFiles: true,              // Export pour debug
      exportPath: './test-conversations',
      exportFormat: 'json'               // ou 'markdown'
    }
  });

  // Initialize schema (une fois)
  await agent.initialize();

  // Créer conversation
  const conv = await agent.createConversation({
    title: "Test conversation",
    tags: ["test"]
  });

  // Envoyer messages
  const r1 = await conv.sendMessage("Hello, what can you do?");
  console.log('Assistant:', r1.content);

  const r2 = await conv.sendMessage("Tell me more");
  console.log('Assistant:', r2.content);

  // Vérifier export
  console.log('\nExported to:', `./test-conversations/conv-${conv.getUuid()}.json`);

  // Lister conversations
  const conversations = await agent.listConversations();
  console.log('\nAll conversations:', conversations);

  await neo4j.close();
}

test();
```

## 🎯 Avantages de cette Architecture

1. **Zero generate**: Directement utilisable depuis runtime
2. **Testable immédiatement**: Pas besoin de setup complexe
3. **Debug facile**: Export temps réel vers JSON/Markdown
4. **Flexible**: Configuration au runtime, pas dans YAML
5. **Standalone**: Peut être utilisé indépendamment de RagForge generate
6. **Graph + Files**: Meilleur des deux mondes

## 📦 Export dans @luciformresearch/ragforge-runtime

```typescript
// packages/runtime/src/index.ts

// Existing exports...
export * from './conversation/index.js';

// Maintenant on peut faire:
import { ConversationAgent } from '@luciformresearch/ragforge-runtime';
```

## 🚀 Rollout

### Phase 1: Core (3h)
1. ⏳ Créer `/packages/runtime/src/conversation/`
2. ⏳ Implement types.ts
3. ⏳ Implement storage.ts (Neo4j operations)
4. ⏳ Implement agent.ts (basic)
5. ⏳ Implement conversation.ts (basic)
6. ⏳ Test sans tools

### Phase 2: Tools Integration (2h)
1. ⏳ Integrate executeLLMBatchWithTools
2. ⏳ Store tool calls
3. ⏳ Include tool calls in context
4. ⏳ Test with real tools

### Phase 3: Export (1h)
1. ⏳ Implement exporter.ts
2. ⏳ JSON export
3. ⏳ Markdown export
4. ⏳ Test export temps réel

### Phase 4: Advanced (2h)
1. ⏳ Auto-summarization
2. ⏳ Message embeddings
3. ⏳ RAG on history

Ça te va comme architecture ? On est prêt à implémenter Phase 1 ? 🚀
