# Plan d'Implémentation - Framework de Chat avec Agents et Tool Calling

## 📋 Vue d'Ensemble

Ce document analyse l'architecture actuelle de ragforge et propose un plan concret pour implémenter un framework de sessions de chat avec agents, en s'appuyant sur les roadmaps existantes et les composants déjà en place.

---

## 🔍 Analyse de l'Existant

### Composants Réutilisables

#### 1. **Infrastructure LLM** ✅ Mature
- **`LLMProviderAdapter`** (`packages/runtime/src/llm/provider-adapter.ts`)
  - Support multi-provider via LlamaIndex (Gemini, OpenAI, Anthropic, Ollama)
  - Interface unifiée pour génération de texte et chat
  - Configuration via YAML

- **`StructuredLLMExecutor`** (`packages/runtime/src/llm/structured-llm-executor.ts`)
  - Exécution structurée avec schéma de sortie
  - Parsing XML automatique
  - Batch processing

- **`StructuredPromptBuilder`** (`packages/runtime/src/llm/structured-prompt-builder.ts`)
  - Construction de prompts structurés
  - Templates configurables

#### 2. **Agent Existant** ✅ Référence Solide
- **`IterativeCodeAgent`** (`packages/runtime/src/agent/iterative-code-agent.ts`)
  - Agent itératif avec génération de code
  - Exécution dynamique de queries TypeScript
  - Analyse des résultats avec LLM
  - Synthèse finale avec contexte

**Points forts à réutiliser:**
- Pattern de reasoning explicite (XML `<reasoning>` + `<code>`)
- Analyse itérative avec feedback loop
- Summarization intelligente du code (avec orientation query)
- Gestion du contexte progressif

#### 3. **Summarization** ✅ Production-Ready
- **`GenericSummarizer`** (`packages/runtime/src/summarization/generic-summarizer.ts`)
  - Stratégies configurables
  - Batch processing efficace
  - Support de field-level summarization
  - Cache dans Neo4j

- **`SummaryStorage`** (`packages/runtime/src/summarization/summary-storage.ts`)
  - Stockage/récupération de résumés
  - Versioning

#### 4. **Configuration** ✅ Extensible
- **Config YAML** (`packages/core/src/types/config.ts`)
  - Support multi-provider LLM/embedding
  - Strategies de summarization configurables
  - Facilement extensible pour chat config

### Composants Manquants

#### 1. **Chat Session Management** ❌
- Gestion du cycle de vie des sessions
- Stockage des messages en Neo4j
- Tracking des participants (Interlocutors)

#### 2. **Agent Framework** ❌
- Registry des agents
- Configuration persistante des agents
- Orchestration multi-agents

#### 3. **Tool Calling** ❌
- Définition et registry des tools
- Exécution sécurisée
- Tracking des appels

#### 4. **Compression Hiérarchique** ⚠️ Partiellement
- L1/L2/L3 summarization définie dans roadmap
- Triggers automatiques
- Context window management

---

## 🎯 Objectifs du Framework

### Core Features (MVP)

1. **Chat Sessions**
   - Création/gestion de sessions multi-participants
   - Stockage persistant des messages
   - Historique queryable

2. **Agent Framework**
   - Définition déclarative d'agents (config YAML)
   - Registry centralisé
   - Agent built-in: `CodeAssistantAgent`

3. **Tool Calling**
   - Registry de tools (ragforge queries + custom)
   - Exécution avec validation
   - Résultats structurés

4. **Simple Compression**
   - Résumé L1 basique (tous les N messages)
   - Context window management

### Advanced Features (v2)

5. **Multi-Agent Orchestration**
   - Patterns: sequential, parallel, hierarchical
   - Communication inter-agents

6. **Hierarchical Compression**
   - L1, L2, L3 avec triggers configurables
   - RAG sur historique compressé

7. **Métriques & Observability**
   - Session analytics
   - Agent performance tracking
   - Cost monitoring

---

## 📐 Architecture Proposée

```
┌─────────────────────────────────────────────────────────┐
│                    Developer API                         │
│         ChatSessionManager, AgentRegistry                │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
  ┌─────▼──────┐          ┌──────▼─────┐
  │  Session   │          │   Agent    │
  │  Runtime   │          │  Runtime   │
  └─────┬──────┘          └──────┬─────┘
        │                         │
        └────────┬────────────────┘
                 │
      ┌──────────▼──────────┐
      │   Tool Executor     │
      │  (RagForge Tools)   │
      └──────────┬──────────┘
                 │
      ┌──────────▼──────────┐
      │   Neo4j Storage     │
      │  Messages, Agents,  │
      │  Sessions, Summaries│
      └─────────────────────┘
```

### Nouveaux Packages

```
packages/runtime/src/
├── chat/                           # 🆕 Chat session management
│   ├── session-manager.ts          # Create/manage sessions
│   ├── message-store.ts            # Store/query messages
│   ├── interlocutor-registry.ts    # Manage participants
│   └── context-builder.ts          # Build context for LLM
│
├── agents/                         # 🆕 Agent framework
│   ├── agent-registry.ts           # Global agent registry
│   ├── agent-config.ts             # Agent configuration types
│   ├── agent-runtime.ts            # Agent execution runtime
│   ├── tools/                      # Tool system
│   │   ├── tool-registry.ts        # Tool definitions
│   │   ├── tool-executor.ts        # Tool execution
│   │   └── built-in/               # Built-in tools
│   │       ├── ragforge-tools.ts   # RagForge query tools
│   │       └── system-tools.ts     # System tools
│   └── built-in/                   # Built-in agents
│       └── code-assistant.ts       # Code assistant agent
│
└── compression/                    # ✅ Extend existing summarization
    ├── hierarchical-compressor.ts  # L1/L2/L3 compression
    ├── compression-triggers.ts     # Auto-compression logic
    └── context-window-manager.ts   # Optimal context selection
```

---

## 🚀 Plan d'Implémentation par Phases

### Phase 0: Foundation & Types (1 semaine)

**Objectif**: Définir les types et le schéma Neo4j

#### Tâches:

1. **Schéma Neo4j pour Chat**
   - Créer migrations/constraints
   - Définir nodes: `ChatSession`, `Message`, `Interlocutor`, `Agent`, `Tool`, `ToolCall`

2. **Types TypeScript**
   - `packages/runtime/src/types/chat.ts`
   - Interfaces pour Session, Message, Agent, Tool

3. **Configuration YAML Extension**
   - Étendre `RagForgeConfig` pour chat:
   ```yaml
   chat:
     enabled: true
     compression:
       l1_threshold: 10  # messages
     agents:
       - name: code-assistant
         model: gemini-1.5-pro
         temperature: 0.7
         tools:
           - ragforge.semanticSearch
           - ragforge.getScope
   ```

**Livrables:**
- Schéma Neo4j complet
- Types TypeScript
- Config YAML étendue

---

### Phase 1: Chat Sessions (2 semaines)

**Objectif**: Gestion basique des sessions et messages

#### Composants:

**1. `ChatSessionManager`**
```typescript
class ChatSessionManager {
  constructor(
    private neo4j: Neo4jClient,
    private llmProvider: LLMProviderAdapter
  ) {}

  async createSession(config: SessionConfig): Promise<ChatSession>
  async getSession(sessionId: string): Promise<ChatSession>
  async addMessage(sessionId: string, message: Message): Promise<void>
  async getMessages(sessionId: string, limit?: number): Promise<Message[]>
  async closeSession(sessionId: string): Promise<void>
}
```

**2. `MessageStore`**
```typescript
class MessageStore {
  async store(sessionId: string, message: Message): Promise<void>
  async query(sessionId: string, filters: MessageFilters): Promise<Message[]>
  async search(sessionId: string, query: string): Promise<Message[]>
}
```

**3. `InterlocutorRegistry`**
```typescript
class InterlocutorRegistry {
  async register(interlocutor: Interlocutor): Promise<void>
  async get(id: string): Promise<Interlocutor>
  async listForSession(sessionId: string): Promise<Interlocutor[]>
}
```

**4. `ContextBuilder`**
```typescript
class ContextBuilder {
  async buildContext(
    sessionId: string,
    maxTokens: number
  ): Promise<ContextWindow>

  // Simple strategy for MVP: last N messages
  private selectRecentMessages(messages: Message[], maxTokens: number): Message[]
}
```

**Exemple d'utilisation:**
```typescript
import { ChatSessionManager } from '@ragforge/runtime';

const chatManager = new ChatSessionManager(neo4jClient, llmProvider);

// Create session
const session = await chatManager.createSession({
  title: 'Code review session',
  participants: [
    { type: 'human', userId: 'user-123' },
    { type: 'agent', agentId: 'code-assistant' }
  ]
});

// Add message
await chatManager.addMessage(session.id, {
  content: 'Review this function',
  sentBy: 'user-123',
  timestamp: new Date()
});

// Get history
const messages = await chatManager.getMessages(session.id);
```

**Livrables:**
- `ChatSessionManager` fonctionnel
- Tests unitaires
- Example usage script

---

### Phase 2: Tool System (2 semaines)

**Objectif**: Permettre aux agents d'exécuter des tools

#### Composants:

**1. `ToolRegistry`**
```typescript
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, any>) => Promise<any>;
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void
  get(name: string): Tool | undefined
  list(): Tool[]

  // Auto-register RagForge query tools
  registerRagForgeTools(ragClient: any): void
}
```

**2. Built-in RagForge Tools**
```typescript
const RAGFORGE_TOOLS: Tool[] = [
  {
    name: 'ragforge.semanticSearch',
    description: 'Search code by semantic similarity',
    parameters: [
      { name: 'query', type: 'string', required: true },
      { name: 'topK', type: 'number', required: false }
    ],
    execute: async (args) => {
      return await rag.scope()
        .semanticSearchBySource(args.query, { topK: args.topK || 10 })
        .execute();
    }
  },
  {
    name: 'ragforge.getScope',
    description: 'Get a specific scope by name',
    parameters: [
      { name: 'name', type: 'string', required: true }
    ],
    execute: async (args) => {
      return await rag.scope()
        .whereName(args.name)
        .execute();
    }
  }
  // ... autres tools
];
```

**3. `ToolExecutor`**
```typescript
class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private validator: ToolValidator
  ) {}

  async execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Promise<ToolResult> {
    // Validate
    const tool = this.registry.get(toolCall.toolName);
    if (!tool) throw new Error(`Tool not found: ${toolCall.toolName}`);

    this.validator.validate(toolCall.arguments, tool.parameters);

    // Execute
    const result = await tool.execute(toolCall.arguments);

    // Store in Neo4j
    await this.storeToolCall(toolCall, result);

    return result;
  }
}
```

**4. LLM Tool Calling Integration**
```typescript
class AgentRuntime {
  async processMessage(message: Message): Promise<Message> {
    // Build context with available tools
    const tools = this.toolRegistry.list();
    const prompt = this.buildPromptWithTools(message, tools);

    // Call LLM
    const response = await this.llm.generate(prompt);

    // Parse tool calls from response
    const toolCalls = this.parseToolCalls(response);

    // Execute tools
    const toolResults = await Promise.all(
      toolCalls.map(tc => this.toolExecutor.execute(tc))
    );

    // Generate final response with tool results
    const finalResponse = await this.synthesizeResponse(
      message,
      toolResults
    );

    return finalResponse;
  }
}
```

**Format de Tool Calling (XML structuré)**
```typescript
const TOOL_CALLING_PROMPT = `
You have access to these tools:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

If you need to use tools, respond with XML:
<response>
  <reasoning>Why you need these tools</reasoning>
  <tool_calls>
    <tool>
      <name>ragforge.semanticSearch</name>
      <arguments>
        <query>authentication</query>
        <topK>5</topK>
      </arguments>
    </tool>
  </tool_calls>
</response>

If no tools needed, respond with:
<response>
  <answer>Your direct answer here</answer>
</response>
`;
```

**Livrables:**
- `ToolRegistry` + `ToolExecutor`
- RagForge tools enregistrés automatiquement
- Tests avec tool calling
- Example agent utilisant tools

---

### Phase 3: Agent Framework (2 semaines)

**Objectif**: Framework pour créer et exécuter des agents

#### Composants:

**1. `AgentConfig` (YAML)**
```yaml
agents:
  - id: code-assistant
    name: Code Assistant
    role: assistant
    model: gemini-1.5-pro
    temperature: 0.7
    max_tokens: 4096

    persona: |
      You are an expert code assistant.
      You help developers understand and improve their code.
      You use RagForge tools to search and analyze code.

    tools:
      - ragforge.semanticSearch
      - ragforge.getScope
      - ragforge.analyzeRelationships

    system_prompt: |
      When answering questions:
      1. Use semantic search to find relevant code
      2. Analyze the code context
      3. Provide clear, actionable answers
      4. Reference specific files and functions
```

**2. `AgentRegistry`**
```typescript
class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  constructor(
    private neo4j: Neo4jClient,
    private config: RagForgeConfig
  ) {
    this.loadFromConfig();
  }

  register(agent: AgentDefinition): Promise<void>
  get(agentId: string): Promise<AgentDefinition>
  list(): Promise<AgentDefinition[]>

  // Store agent config in Neo4j
  private async storeInNeo4j(agent: AgentDefinition): Promise<void>
}
```

**3. `AgentRuntime`**
```typescript
class AgentRuntime {
  constructor(
    private agent: AgentDefinition,
    private llm: LLMProviderAdapter,
    private toolExecutor: ToolExecutor,
    private contextBuilder: ContextBuilder
  ) {}

  async processMessage(
    sessionId: string,
    message: Message
  ): Promise<Message> {
    // Build context
    const context = await this.contextBuilder.buildContext(
      sessionId,
      this.agent.maxTokens * 0.7 // Reserve 30% for response
    );

    // Build prompt
    const prompt = this.buildAgentPrompt(context, message);

    // Generate response
    const response = await this.llm.generate(prompt);

    // Check for tool calls
    if (this.hasToolCalls(response)) {
      return await this.executeToolsAndRespond(response, sessionId);
    }

    // Direct response
    return this.parseResponse(response);
  }

  private buildAgentPrompt(
    context: ContextWindow,
    message: Message
  ): string {
    return `
${this.agent.persona}

${this.agent.systemPrompt}

Available tools:
${this.agent.tools.map(t => this.describeToolForPrompt(t)).join('\n')}

Chat history:
${context.messages.map(m => `${m.role}: ${m.content}`).join('\n')}

User: ${message.content}

Respond with reasoning and tool usage if needed.
`;
  }
}
```

**4. Built-in Agent: `CodeAssistantAgent`**
```typescript
export const CODE_ASSISTANT_AGENT: AgentDefinition = {
  id: 'code-assistant',
  name: 'Code Assistant',
  role: 'assistant',
  model: 'gemini-1.5-pro',
  temperature: 0.7,

  persona: `You are an expert code assistant powered by RagForge.
You have access to a knowledge graph of the codebase and can search code semantically.
Your goal is to help developers understand, review, and improve their code.`,

  systemPrompt: `When answering:
1. Search for relevant code using semantic search
2. Analyze relationships and dependencies
3. Provide specific, actionable insights
4. Reference exact file paths and function names
5. Explain WHY, not just WHAT`,

  tools: [
    'ragforge.semanticSearch',
    'ragforge.getScope',
    'ragforge.getRelatedScopes',
    'ragforge.analyzeScope'
  ],

  maxTokens: 4096
};
```

**Exemple d'utilisation:**
```typescript
import { AgentRegistry, AgentRuntime, ChatSessionManager } from '@ragforge/runtime';

// Load agents from config
const registry = new AgentRegistry(neo4j, config);

// Get agent
const agent = await registry.get('code-assistant');

// Create runtime
const runtime = new AgentRuntime(
  agent,
  llmProvider,
  toolExecutor,
  contextBuilder
);

// Create session with agent
const session = await chatManager.createSession({
  participants: [
    { type: 'human', userId: 'user-123' },
    { type: 'agent', agentId: 'code-assistant' }
  ]
});

// User sends message
await chatManager.addMessage(session.id, {
  content: 'Explain how authentication works in this codebase',
  sentBy: 'user-123'
});

// Agent processes and responds
const response = await runtime.processMessage(
  session.id,
  userMessage
);

// Store agent response
await chatManager.addMessage(session.id, response);
```

**Livrables:**
- `AgentRegistry` + `AgentRuntime`
- `CodeAssistantAgent` built-in
- Agent config loading from YAML
- Tests end-to-end
- Example chat session script

---

### Phase 4: Compression Simple (1 semaine)

**Objectif**: Résumé L1 basique et context window management

#### Composants:

**1. `SimpleCompressor`**
```typescript
class SimpleCompressor {
  constructor(
    private summarizer: GenericSummarizer,
    private messageStore: MessageStore
  ) {}

  async compressIfNeeded(sessionId: string): Promise<void> {
    const config = await this.getCompressionConfig(sessionId);
    if (!config.enabled) return;

    // Count uncompressed messages
    const uncompressed = await this.messageStore.getUncompressed(sessionId);

    if (uncompressed.length >= config.l1Threshold) {
      await this.createL1Summary(sessionId, uncompressed);
    }
  }

  private async createL1Summary(
    sessionId: string,
    messages: Message[]
  ): Promise<SessionSummary> {
    // Prepare for summarization
    const content = messages.map(m =>
      `${m.sentBy}: ${m.content}`
    ).join('\n\n');

    // Summarize
    const summary = await this.summarizer.summarizeField(
      'ChatSession',
      'messages',
      content,
      { sessionId },
      {
        enabled: true,
        strategy: 'chat_l1_summary',
        threshold: 0,
        output_fields: ['key_points', 'topics', 'decisions']
      }
    );

    // Store in Neo4j
    return await this.storeSummary(sessionId, 'L1', summary, messages);
  }
}
```

**2. Stratégie de Summarization L1**
```yaml
summarization_strategies:
  chat_l1_summary:
    name: Chat L1 Summary
    system_prompt: |
      Summarize this conversation segment concisely.
      Extract key points, topics discussed, and decisions made.

    output_schema:
      root: summary
      fields:
        - name: key_points
          type: array
          description: Main points discussed (3-5 items)

        - name: topics
          type: array
          description: Topics/themes covered

        - name: decisions
          type: array
          description: Decisions or action items

        - name: overview
          type: string
          description: 2-3 sentence overview
```

**3. `ContextWindowManager` (Simple)**
```typescript
class ContextWindowManager {
  async buildContext(
    sessionId: string,
    maxTokens: number
  ): Promise<ContextWindow> {
    // Get recent messages
    const messages = await this.messageStore.getRecent(sessionId, 50);

    // Get L1 summaries if exist
    const summaries = await this.getSummaries(sessionId);

    // Pack context within budget
    const context: ContextWindow = {
      summaries: [],
      messages: [],
      totalTokens: 0
    };

    // Always include recent messages
    const recentBudget = maxTokens * 0.7;
    const recentMessages = this.packMessages(messages, recentBudget);
    context.messages = recentMessages;
    context.totalTokens += this.countTokens(recentMessages);

    // Add summaries if space left
    const summaryBudget = maxTokens - context.totalTokens;
    if (summaries.length > 0) {
      const packedSummaries = this.packSummaries(summaries, summaryBudget);
      context.summaries = packedSummaries;
      context.totalTokens += this.countTokens(packedSummaries);
    }

    return context;
  }
}
```

**Livrables:**
- Compression L1 fonctionnelle
- Context window management simple
- Tests de compression
- Métriques de compression ratio

---

### Phase 5: Example & Documentation (1 semaine)

**Objectif**: Example complet et documentation

#### Example: Chat Assistant pour Code Review

```typescript
// examples/chat-code-review/index.ts
import {
  ChatSessionManager,
  AgentRegistry,
  ToolRegistry,
  createRagClient
} from '@ragforge/runtime';

async function main() {
  // Initialize RagForge
  const rag = createRagClient(config);

  // Setup tool registry
  const tools = new ToolRegistry();
  tools.registerRagForgeTools(rag);

  // Setup agent registry
  const agents = new AgentRegistry(neo4j, config);
  await agents.register(CODE_ASSISTANT_AGENT);

  // Create chat session
  const chatManager = new ChatSessionManager(neo4j, llmProvider);
  const session = await chatManager.createSession({
    title: 'Code Review: Authentication Module',
    participants: [
      { type: 'human', userId: 'developer-123', name: 'Alice' },
      { type: 'agent', agentId: 'code-assistant' }
    ],
    compression: { enabled: true, l1Threshold: 10 }
  });

  console.log(`Session created: ${session.id}`);

  // User asks question
  console.log('\nUser: Explain how authentication works');

  const userMsg = await chatManager.addMessage(session.id, {
    content: 'Explain how authentication works in this codebase',
    sentBy: 'developer-123'
  });

  // Agent processes
  const agent = await agents.get('code-assistant');
  const runtime = new AgentRuntime(agent, llmProvider, tools, contextBuilder);

  const agentResponse = await runtime.processMessage(session.id, userMsg);

  await chatManager.addMessage(session.id, agentResponse);

  console.log(`\nAgent: ${agentResponse.content}`);

  // Show tool calls if any
  if (agentResponse.toolCalls) {
    console.log('\nTool calls:');
    agentResponse.toolCalls.forEach(tc => {
      console.log(`  - ${tc.toolName}(${JSON.stringify(tc.arguments)})`);
    });
  }

  await rag.close();
}

main();
```

**Configuration Example:**
```yaml
# ragforge.config.yaml
name: my-project
version: 1.0.0

neo4j:
  uri: bolt://localhost:7687
  database: neo4j

llm:
  provider: gemini
  model: gemini-1.5-pro
  temperature: 0.7
  max_tokens: 8192

chat:
  enabled: true
  compression:
    enabled: true
    l1_threshold: 10

  agents:
    - id: code-assistant
      name: Code Assistant
      model: gemini-1.5-pro
      temperature: 0.7
      tools:
        - ragforge.semanticSearch
        - ragforge.getScope
        - ragforge.getRelatedScopes

summarization_strategies:
  chat_l1_summary:
    system_prompt: |
      Summarize conversation segment...
    output_schema:
      root: summary
      fields:
        - name: key_points
          type: array
```

#### Documentation

1. **Getting Started Guide**
   - Installation
   - Basic chat session
   - Adding agents
   - Using tools

2. **Agent Development Guide**
   - Creating custom agents
   - Tool definition
   - Best practices

3. **API Reference**
   - ChatSessionManager
   - AgentRegistry
   - ToolRegistry
   - AgentRuntime

4. **Architecture Guide**
   - How it works
   - Neo4j schema
   - Extension points

**Livrables:**
- Example complet fonctionnel
- Documentation complète
- Tutorial step-by-step
- Video demo (optionnel)

---

## 🔄 Évolution Future (Post-MVP)

### Phase 6: Multi-Agent Orchestration

- **AgentOrchestrator**
  - Sequential pipelines
  - Parallel execution
  - Hierarchical delegation
  - Debate/consensus

### Phase 7: Compression Hiérarchique Complète

- **L2/L3 Compression**
  - Auto-triggers configurables
  - RAG sur historique compressé
  - Smart context selection

### Phase 8: Advanced Features

- **Streaming Responses**
- **React/Vue Components**
- **MCP Server Integration**
- **Agent Marketplace**
- **Analytics Dashboard**

---

## 📊 Estimation Totale

| Phase | Durée | Effort |
|-------|-------|--------|
| Phase 0: Foundation | 1 semaine | 40h |
| Phase 1: Sessions | 2 semaines | 80h |
| Phase 2: Tools | 2 semaines | 80h |
| Phase 3: Agents | 2 semaines | 80h |
| Phase 4: Compression | 1 semaine | 40h |
| Phase 5: Example/Docs | 1 semaine | 40h |
| **Total MVP** | **9 semaines** | **360h** |

---

## 🎯 Prochaines Étapes Immédiates

### Cette Semaine

1. ✅ **Valider cette roadmap**
   - Review avec l'équipe
   - Ajustements priorités

2. **Phase 0: Setup**
   - Créer branches git
   - Setup structure packages
   - Définir schéma Neo4j initial

3. **Prototype Minimal**
   - Simple chat session storage
   - 1 message en Neo4j
   - Test basic query

### Semaine Prochaine

4. **Phase 1: Start**
   - Implémenter `ChatSessionManager`
   - Tests unitaires
   - Example script

---

## 💡 Recommandations

### Architecture

1. **Réutiliser au Maximum**
   - `LLMProviderAdapter` déjà excellent
   - `GenericSummarizer` production-ready
   - Pattern de `IterativeCodeAgent` comme référence

2. **Garder Simple au Début**
   - MVP = sessions + 1 agent + tools basiques
   - Compression L1 seulement
   - Pas d'orchestration multi-agents

3. **Extensibilité**
   - Config YAML pour agents
   - Tool registry pluggable
   - Strategy pattern pour compression

### Tool Calling

1. **Format Structuré (XML)**
   - Cohérent avec `IterativeCodeAgent`
   - Parsing robuste avec LuciformXMLParser
   - Reasoning explicite

2. **RagForge Tools Auto-Generated**
   - Tous les query methods deviennent des tools
   - Descriptions depuis config YAML
   - Validation automatique des args

### Compression

1. **Commencer Simple**
   - L1 uniquement pour MVP
   - Trigger: tous les 10 messages
   - Context = 70% recent + 30% summaries

2. **Expansion Future**
   - L2/L3 quand besoin
   - RAG sur historique
   - Semantic deduplication

---

## ❓ Questions Ouvertes

1. **Stockage des Tool Results**
   - Inline dans Message.metadata?
   - Node séparé ToolCall?
   - → Recommandation: Node séparé pour queryabilité

2. **Agent State**
   - Agents stateless?
   - Ou state persisté entre messages?
   - → Recommandation: Stateless pour MVP

3. **Error Handling**
   - Tool execution failures?
   - LLM errors?
   - → Recommandation: Retry + fallback + error messages

4. **Permissions**
   - Agents peuvent tout faire?
   - Tool permissions par agent?
   - → Recommandation: Whitelist tools per agent

---

## 📚 Références

- Roadmaps existantes:
  - `CHAT-ADAPTER-ROADMAP-V2.md`
  - `CHAT-ADAPTER-QUESTIONS.md`
  - `CHAT-ADAPTER-COMPRESSION.md`

- Code existant:
  - `packages/runtime/src/agent/iterative-code-agent.ts`
  - `packages/runtime/src/llm/provider-adapter.ts`
  - `packages/runtime/src/summarization/generic-summarizer.ts`

- Config types:
  - `packages/core/src/types/config.ts`
