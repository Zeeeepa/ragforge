# Chat Framework - Generic Design

## 🎯 Principe Fondamental

**RagForge Chat doit être 100% domain-agnostic.**

Le chat framework fonctionne avec **n'importe quelle entité Neo4j** configurée dans `ragforge.config.yaml`, pas seulement du code.

---

## 🏗️ Architecture Générique

```
┌─────────────────────────────────────────────────┐
│          RagForge Core (Generic)                │
│  - ChatSessionManager                           │
│  - AgentRuntime                                 │
│  - ToolRegistry                                 │
│  - ContextBuilder                               │
└────────────────┬────────────────────────────────┘
                 │
                 │ uses
                 │
┌────────────────▼────────────────────────────────┐
│      Generated Client (Domain-Specific)         │
│  - Auto-generated from config                   │
│  - Query methods for all entities               │
│  - Relationships                                │
└────────────────┬────────────────────────────────┘
                 │
                 │ queries
                 │
┌────────────────▼────────────────────────────────┐
│             Neo4j Database                      │
│  - Domain entities (Scope, Product, etc.)       │
│  - Chat entities (Session, Message, Agent)      │
└─────────────────────────────────────────────────┘
```

---

## 📊 Neo4j Schema - Generic Chat Entities

Ces nodes sont **domain-agnostic** et coexistent avec les entités du domaine:

```cypher
// ============================================
// GENERIC CHAT ENTITIES (Core RagForge)
// ============================================

// Chat Session (generic)
(:ChatSession {
  sessionId: STRING [UNIQUE],
  title: STRING,
  domain: STRING,              // 'code', 'products', 'documents'
  createdAt: DATETIME,
  lastActiveAt: DATETIME,
  metadata: MAP
})

// Message (generic)
(:Message {
  messageId: STRING [UNIQUE],
  sessionId: STRING,
  content: STRING,
  role: STRING,                // 'user', 'agent', 'system'
  sentBy: STRING,              // user ID or agent ID
  timestamp: DATETIME,
  tokens: INTEGER,
  metadata: MAP
})

// Agent (generic)
(:Agent {
  agentId: STRING [UNIQUE],
  name: STRING,
  domain: STRING,              // 'code', 'products', 'documents', 'generic'
  model: STRING,
  temperature: FLOAT,
  systemPrompt: STRING,
  tools: LIST<STRING>,         // Tool names
  metadata: MAP
})

// Tool Call (generic)
(:ToolCall {
  toolCallId: STRING [UNIQUE],
  messageId: STRING,
  toolName: STRING,
  arguments: MAP,
  result: MAP,
  executedAt: DATETIME,
  status: STRING               // 'success', 'error'
})

// Relations
(:Message)-[:IN_SESSION]->(:ChatSession)
(:Message)-[:EXECUTED_TOOL]->(:ToolCall)
(:Agent)-[:PARTICIPATED_IN]->(:ChatSession)

// Domain-specific references (dynamic)
(:Message)-[:REFERENCES]->(:<DomainEntity>)
(:ToolCall)-[:RETURNED]->(:<DomainEntity>)
```

---

## 🎨 Generic Tool System

**Concept clé:** Tools sont **auto-générés depuis le client généré**.

### Exemple: Config pour Code

```yaml
name: my-codebase
version: 1.0.0

entities:
  - name: Scope
    searchable_fields:
      - name: name
        type: string
      - name: source
        type: string
    vector_indexes:
      - name: signature_index
        field: embedding_signature
        source_field: signature

chat:
  enabled: true
  agents:
    - id: code-assistant
      name: Code Assistant
      domain: code                    # Specific to this domain
      model: gemini-1.5-pro
      system_prompt: |
        You are a code assistant for this codebase.
        Use available tools to search and analyze code.
      tools:
        - generated.scope.semanticSearchBySource
        - generated.scope.whereName
```

### Exemple: Config pour E-commerce

```yaml
name: my-shop
version: 1.0.0

entities:
  - name: Product
    searchable_fields:
      - name: name
        type: string
      - name: description
        type: string
    vector_indexes:
      - name: description_index
        field: embedding_description
        source_field: description

chat:
  enabled: true
  agents:
    - id: shopping-assistant
      name: Shopping Assistant
      domain: products               # Different domain
      model: gemini-1.5-pro
      system_prompt: |
        You are a shopping assistant.
        Help customers find products.
      tools:
        - generated.product.semanticSearchByDescription
        - generated.product.whereName
```

---

## 🔧 Generic Tool Registry

Tools sont **automatiquement créés** depuis le client généré:

```typescript
// packages/runtime/src/agents/tools/tool-registry.ts

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, any>) => Promise<any>;
  domain?: string;               // Optional: 'code', 'products', etc.
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /**
   * Auto-register ALL query methods from generated client
   * This makes the registry completely generic
   */
  autoRegisterFromClient(client: any, entityName: string): void {
    const queryBuilder = client[entityName.toLowerCase()]();

    // Introspect the query builder methods
    const methods = Object.getOwnPropertyNames(
      Object.getPrototypeOf(queryBuilder)
    );

    methods.forEach(method => {
      // Skip internal methods
      if (method.startsWith('_') || method === 'execute') return;

      // Infer tool from method name
      const tool = this.createToolFromMethod(
        entityName,
        method,
        queryBuilder[method]
      );

      this.register(tool);
    });
  }

  private createToolFromMethod(
    entityName: string,
    methodName: string,
    method: Function
  ): Tool {
    // Parse method signature to infer parameters
    const params = this.inferParameters(method);

    return {
      name: `generated.${entityName.toLowerCase()}.${methodName}`,
      description: this.generateDescription(entityName, methodName),
      parameters: params,
      execute: async (args) => {
        // Generic execution
        const builder = this.getBuilderInstance(entityName);
        const query = builder[methodName](...this.buildArgs(params, args));
        return await query.execute();
      }
    };
  }

  private generateDescription(entity: string, method: string): string {
    // Semantic description from method name
    if (method.startsWith('semanticSearch')) {
      return `Search ${entity} by semantic similarity`;
    }
    if (method.startsWith('where')) {
      const field = method.replace('where', '').replace(/^[A-Z]/, c => c.toLowerCase());
      return `Filter ${entity} by ${field}`;
    }
    if (method.startsWith('with')) {
      const rel = method.replace('with', '');
      return `Include ${rel} relationships for ${entity}`;
    }

    return `Query ${entity} using ${method}`;
  }

  private inferParameters(method: Function): ToolParameter[] {
    // Parse function signature
    const fnStr = method.toString();

    // Extract parameter names (simplified)
    const match = fnStr.match(/\(([^)]*)\)/);
    if (!match) return [];

    const paramStr = match[1];
    if (!paramStr.trim()) return [];

    // Parse parameters
    return paramStr.split(',').map(param => {
      const name = param.trim().split(':')[0].trim();

      // Infer type from name
      let type = 'string';
      if (name.includes('topK') || name.includes('limit')) type = 'number';
      if (name.includes('options')) type = 'object';

      return {
        name,
        type,
        description: `Parameter: ${name}`,
        required: !param.includes('?')
      };
    });
  }
}
```

---

## 🤖 Generic Agent Runtime

L'agent est **complètement domain-agnostic**:

```typescript
// packages/runtime/src/agents/agent-runtime.ts

export interface AgentConfig {
  id: string;
  name: string;
  domain?: string;              // Optional: for organization
  model: string;
  temperature: number;
  systemPrompt: string;
  tools: string[];              // Tool names (auto-generated)
  maxContextTokens?: number;
}

export class AgentRuntime {
  constructor(
    private config: AgentConfig,
    private llm: LLMProviderAdapter,
    private tools: ToolRegistry,
    private sessionManager: ChatSessionManager
  ) {}

  async processMessage(
    sessionId: string,
    userMessage: Message
  ): Promise<Message> {
    // Generic flow, no domain-specific logic

    // 1. Get context (generic)
    const history = await this.sessionManager.getMessages(sessionId, 10);

    // 2. Build prompt (generic)
    const prompt = this.buildPrompt(history, userMessage);

    // 3. Call LLM (generic)
    const response = await this.llm.generate(prompt);

    // 4. Parse tool calls (generic)
    const toolCalls = this.parseToolCalls(response);

    // 5. Execute tools (generic)
    if (toolCalls.length > 0) {
      const toolResults = await this.executeTools(toolCalls);
      return await this.synthesizeWithToolResults(
        sessionId,
        userMessage,
        toolCalls,
        toolResults
      );
    }

    // 6. Return response (generic)
    return this.createAgentMessage(
      sessionId,
      this.extractAnswer(response)
    );
  }

  private buildPrompt(
    history: Message[],
    currentMessage: Message
  ): string {
    // Get available tools for this agent
    const availableTools = this.config.tools
      .map(name => this.tools.get(name))
      .filter(Boolean);

    // Generic prompt template
    return `${this.config.systemPrompt}

Available Tools:
${availableTools.map(t => this.formatToolForPrompt(t)).join('\n\n')}

Conversation History:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

User: ${currentMessage.content}

If you need to use tools, respond with:
<response>
  <reasoning>Explain why you need these tools</reasoning>
  <tool_calls>
    <tool>
      <name>tool.name.here</name>
      <arguments>
        <param1>value1</param1>
        <param2>value2</param2>
      </arguments>
    </tool>
  </tool_calls>
</response>

If you can answer directly:
<response>
  <answer>Your answer here</answer>
</response>`;
  }

  private formatToolForPrompt(tool: Tool): string {
    return `Tool: ${tool.name}
Description: ${tool.description}
Parameters:
${tool.parameters.map(p =>
  `  - ${p.name} (${p.type})${p.required ? ' *required' : ''}: ${p.description}`
).join('\n')}`;
  }

  private async executeTools(toolCalls: ToolCall[]): Promise<any[]> {
    return Promise.all(
      toolCalls.map(async tc => {
        const tool = this.tools.get(tc.toolName);
        if (!tool) {
          return { error: `Tool not found: ${tc.toolName}` };
        }

        try {
          return await tool.execute(tc.arguments);
        } catch (error: any) {
          return { error: error.message };
        }
      })
    );
  }

  private async synthesizeWithToolResults(
    sessionId: string,
    userMessage: Message,
    toolCalls: ToolCall[],
    toolResults: any[]
  ): Promise<Message> {
    // Build synthesis prompt
    const synthesisPrompt = `${this.config.systemPrompt}

User asked: ${userMessage.content}

You executed these tools:
${toolCalls.map((tc, i) => `
Tool: ${tc.toolName}
Arguments: ${JSON.stringify(tc.arguments, null, 2)}
Result: ${JSON.stringify(toolResults[i], null, 2)}
`).join('\n')}

Now provide a comprehensive answer based on the tool results.
Reference specific entities by name when relevant.

Respond with:
<response>
  <answer>Your final answer here</answer>
</response>`;

    const response = await this.llm.generate(synthesisPrompt);
    const answer = this.extractAnswer(response);

    return this.createAgentMessage(sessionId, answer, toolCalls.map((tc, i) => ({
      ...tc,
      result: toolResults[i]
    })));
  }
}
```

---

## 🎯 Generic Chat Session Manager

```typescript
// packages/runtime/src/chat/session-manager.ts

export class ChatSessionManager {
  constructor(
    private neo4j: Neo4jClient,
    private config: RagForgeConfig
  ) {}

  /**
   * Create a generic chat session
   * Works for ANY domain configured in RagForge
   */
  async createSession(options: {
    title: string;
    domain?: string;              // Optional: 'code', 'products', etc.
    metadata?: Record<string, any>;
  }): Promise<ChatSession> {
    const sessionId = uuidv4();
    const now = new Date();

    await this.neo4j.run(`
      CREATE (s:ChatSession {
        sessionId: $sessionId,
        title: $title,
        domain: $domain,
        createdAt: datetime($createdAt),
        lastActiveAt: datetime($createdAt),
        metadata: $metadata
      })
    `, {
      sessionId,
      title: options.title,
      domain: options.domain || 'generic',
      createdAt: now.toISOString(),
      metadata: options.metadata || {}
    });

    return {
      sessionId,
      title: options.title,
      domain: options.domain,
      createdAt: now,
      lastActiveAt: now,
      metadata: options.metadata
    };
  }

  /**
   * Add a message (generic, works for any domain)
   */
  async addMessage(message: Message): Promise<void> {
    await this.neo4j.run(`
      MATCH (s:ChatSession {sessionId: $sessionId})
      CREATE (m:Message {
        messageId: $messageId,
        sessionId: $sessionId,
        content: $content,
        role: $role,
        sentBy: $sentBy,
        timestamp: datetime($timestamp),
        tokens: $tokens,
        metadata: $metadata
      })
      CREATE (m)-[:IN_SESSION]->(s)
      SET s.lastActiveAt = datetime($timestamp)
    `, {
      messageId: message.messageId,
      sessionId: message.sessionId,
      content: message.content,
      role: message.role,
      sentBy: message.sentBy,
      timestamp: message.timestamp.toISOString(),
      tokens: message.tokens || 0,
      metadata: message.metadata || {}
    });

    // Store tool calls if present
    if (message.toolCalls) {
      await this.storeToolCalls(message.messageId, message.toolCalls);
    }
  }

  private async storeToolCalls(
    messageId: string,
    toolCalls: ToolCall[]
  ): Promise<void> {
    for (const tc of toolCalls) {
      await this.neo4j.run(`
        MATCH (m:Message {messageId: $messageId})
        CREATE (t:ToolCall {
          toolCallId: $toolCallId,
          messageId: $messageId,
          toolName: $toolName,
          arguments: $arguments,
          result: $result,
          executedAt: datetime($executedAt),
          status: $status
        })
        CREATE (m)-[:EXECUTED_TOOL]->(t)
      `, {
        messageId,
        toolCallId: uuidv4(),
        toolName: tc.toolName,
        arguments: tc.arguments,
        result: tc.result || {},
        executedAt: new Date().toISOString(),
        status: tc.result ? 'success' : 'pending'
      });
    }
  }

  /**
   * Get messages (generic)
   */
  async getMessages(
    sessionId: string,
    limit: number = 50
  ): Promise<Message[]> {
    const result = await this.neo4j.run(`
      MATCH (m:Message)-[:IN_SESSION]->(s:ChatSession {sessionId: $sessionId})
      OPTIONAL MATCH (m)-[:EXECUTED_TOOL]->(t:ToolCall)
      RETURN m, collect(t) as toolCalls
      ORDER BY m.timestamp DESC
      LIMIT $limit
    `, { sessionId, limit });

    return result.records.map(r => {
      const node = r.get('m');
      const toolCalls = r.get('toolCalls')
        .filter((t: any) => t)
        .map((t: any) => ({
          toolName: t.properties.toolName,
          arguments: t.properties.arguments,
          result: t.properties.result
        }));

      return {
        messageId: node.properties.messageId,
        sessionId: node.properties.sessionId,
        content: node.properties.content,
        role: node.properties.role,
        sentBy: node.properties.sentBy,
        timestamp: new Date(node.properties.timestamp),
        tokens: node.properties.tokens,
        metadata: node.properties.metadata,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined
      };
    }).reverse();
  }
}
```

---

## 📦 Generated Client Integration

Le code generator doit **automatiquement créer les tools**:

```typescript
// packages/core/src/generator/code-generator.ts (extension)

export class CodeGenerator {
  // ... existing methods

  /**
   * Generate chat integration code
   */
  generateChatIntegration(config: RagForgeConfig): string {
    if (!config.chat?.enabled) return '';

    return `
// Chat Integration (Auto-generated)
import { ToolRegistry, AgentRegistry } from '@ragforge/runtime';

/**
 * Auto-register all query methods as tools
 */
export function registerTools(client: RagClient, registry: ToolRegistry): void {
  ${config.entities.map(entity => `
  // Register ${entity.name} tools
  registry.autoRegisterFromClient(client, '${entity.name}');
  `).join('\n')}
}

/**
 * Pre-configured agents from config
 */
export const configuredAgents = ${JSON.stringify(config.chat?.agents || [], null, 2)};

/**
 * Initialize chat system
 */
export async function initializeChat(
  client: RagClient,
  neo4j: Neo4jClient,
  llm: LLMProviderAdapter
) {
  const toolRegistry = new ToolRegistry();
  registerTools(client, toolRegistry);

  const agentRegistry = new AgentRegistry(neo4j);
  for (const agentConfig of configuredAgents) {
    await agentRegistry.register(agentConfig);
  }

  return { toolRegistry, agentRegistry };
}
`;
  }
}
```

---

## 🎨 Example Usage - Generic

### Example 1: Code Domain

```typescript
import { createRagClient, initializeChat } from './generated-client';

const rag = createRagClient(config);
const { toolRegistry, agentRegistry } = await initializeChat(rag, neo4j, llm);

// Create session for code
const session = await chatManager.createSession({
  title: 'Code Review',
  domain: 'code'
});

// Agent uses auto-generated tools
const agent = await agentRegistry.get('code-assistant');
// Agent can use: generated.scope.semanticSearchBySource, etc.
```

### Example 2: E-commerce Domain

```typescript
import { createRagClient, initializeChat } from './generated-client';

const rag = createRagClient(config);
const { toolRegistry, agentRegistry } = await initializeChat(rag, neo4j, llm);

// Create session for shopping
const session = await chatManager.createSession({
  title: 'Shopping Help',
  domain: 'products'
});

// Agent uses auto-generated tools
const agent = await agentRegistry.get('shopping-assistant');
// Agent can use: generated.product.semanticSearchByDescription, etc.
```

---

## ✅ Generic Design Principles

1. **Zero hardcoded domain logic** in core packages
2. **All tools auto-generated** from entity config
3. **Agents configured via YAML** (not hardcoded)
4. **Chat entities separate** from domain entities
5. **Generated client integrates** chat automatically
6. **Same API works** for code, products, documents, etc.

---

## 🚀 Implementation Order

1. **Generic chat entities** (Session, Message, Agent, ToolCall)
2. **Generic ChatSessionManager**
3. **Generic ToolRegistry** with auto-registration
4. **Generic AgentRuntime**
5. **Code generator extension** for chat integration
6. **Example for code domain**
7. **Example for e-commerce domain**

---

## 📊 Success Criteria

Chat framework is truly generic if:
- ✅ Works with code entities (Scope, File)
- ✅ Works with product entities (Product, Category)
- ✅ Works with document entities (Document, Section)
- ✅ No domain-specific logic in core
- ✅ All tools auto-generated from config
- ✅ Single API for all domains
