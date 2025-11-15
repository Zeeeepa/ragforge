# Quick Start - Chat Framework MVP

## 🎯 Objectif Immédiat

Créer un prototype minimal fonctionnel en 2 semaines:
- Session de chat persistée
- 1 agent simple (CodeAssistant)
- Tool calling basique (RagForge queries)

---

## 🏗️ Architecture Minimale

```
User Message
    ↓
ChatSession (Neo4j)
    ↓
AgentRuntime
    ↓
LLM + Tools → Response
    ↓
Store Response
```

---

## 📝 Checklist Sprint 1 (Semaine 1)

### Jour 1-2: Schéma Neo4j

```cypher
// Messages
CREATE CONSTRAINT message_id IF NOT EXISTS
FOR (m:Message) REQUIRE m.messageId IS UNIQUE;

(:Message {
  messageId: STRING,
  sessionId: STRING,
  content: STRING,
  role: STRING,  // 'user' | 'agent'
  sentBy: STRING,
  timestamp: DATETIME,
  tokens: INTEGER
})

// Sessions
CREATE CONSTRAINT session_id IF NOT EXISTS
FOR (s:ChatSession) REQUIRE s.sessionId IS UNIQUE;

(:ChatSession {
  sessionId: STRING,
  title: STRING,
  createdAt: DATETIME,
  lastActiveAt: DATETIME
})

// Relations
(:Message)-[:IN_SESSION]->(:ChatSession)
```

**Code:** `packages/runtime/src/chat/schema.cypher`

---

### Jour 3-4: Types & Config

**Types:** `packages/runtime/src/types/chat.ts`

```typescript
export interface ChatSession {
  sessionId: string;
  title: string;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface Message {
  messageId: string;
  sessionId: string;
  content: string;
  role: 'user' | 'agent';
  sentBy: string;
  timestamp: Date;
  tokens?: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  toolName: string;
  arguments: Record<string, any>;
  result?: any;
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  tools: string[];
}
```

**Config YAML Extension:** `packages/core/src/types/config.ts`

```typescript
export interface RagForgeConfig {
  // ... existing fields
  chat?: ChatConfig;
}

export interface ChatConfig {
  enabled: boolean;
  agents?: AgentConfig[];
}
```

---

### Jour 5: ChatSessionManager

**Code:** `packages/runtime/src/chat/session-manager.ts`

```typescript
import type { Neo4jClient } from '../client/neo4j-client.js';
import type { ChatSession, Message } from '../types/chat.js';
import { v4 as uuidv4 } from 'uuid';

export class ChatSessionManager {
  constructor(private neo4j: Neo4jClient) {}

  async createSession(title: string): Promise<ChatSession> {
    const sessionId = uuidv4();
    const now = new Date();

    await this.neo4j.run(`
      CREATE (s:ChatSession {
        sessionId: $sessionId,
        title: $title,
        createdAt: datetime($createdAt),
        lastActiveAt: datetime($createdAt)
      })
    `, {
      sessionId,
      title,
      createdAt: now.toISOString()
    });

    return {
      sessionId,
      title,
      createdAt: now,
      lastActiveAt: now
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    const result = await this.neo4j.run(`
      MATCH (s:ChatSession {sessionId: $sessionId})
      RETURN s
    `, { sessionId });

    if (result.records.length === 0) return null;

    const node = result.records[0].get('s');
    return {
      sessionId: node.properties.sessionId,
      title: node.properties.title,
      createdAt: new Date(node.properties.createdAt),
      lastActiveAt: new Date(node.properties.lastActiveAt)
    };
  }

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
        tokens: $tokens
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
      tokens: message.tokens || 0
    });
  }

  async getMessages(
    sessionId: string,
    limit: number = 50
  ): Promise<Message[]> {
    const result = await this.neo4j.run(`
      MATCH (m:Message)-[:IN_SESSION]->(s:ChatSession {sessionId: $sessionId})
      RETURN m
      ORDER BY m.timestamp DESC
      LIMIT $limit
    `, { sessionId, limit });

    return result.records.map(r => {
      const node = r.get('m');
      return {
        messageId: node.properties.messageId,
        sessionId: node.properties.sessionId,
        content: node.properties.content,
        role: node.properties.role,
        sentBy: node.properties.sentBy,
        timestamp: new Date(node.properties.timestamp),
        tokens: node.properties.tokens
      };
    }).reverse(); // Oldest first
  }
}
```

---

## 📝 Checklist Sprint 2 (Semaine 2)

### Jour 1-2: Tool Registry

**Code:** `packages/runtime/src/agents/tools/tool-registry.ts`

```typescript
export interface Tool {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
  execute: (args: Record<string, any>) => Promise<any>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  // Auto-register RagForge query tools
  registerRagForgeTools(ragClient: any): void {
    this.register({
      name: 'ragforge.semanticSearch',
      description: 'Search code by semantic similarity',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'Search query',
          required: true
        },
        {
          name: 'topK',
          type: 'number',
          description: 'Number of results (default: 10)',
          required: false
        }
      ],
      execute: async (args) => {
        const results = await ragClient.scope()
          .semanticSearchBySource(args.query, {
            topK: args.topK || 10
          })
          .execute();

        // Format for LLM
        return results.map((r: any) => ({
          name: r.entity.name,
          type: r.entity.type,
          file: r.entity.file,
          signature: r.entity.signature,
          score: r.score
        }));
      }
    });

    this.register({
      name: 'ragforge.getScope',
      description: 'Get a specific scope by name',
      parameters: [
        {
          name: 'name',
          type: 'string',
          description: 'Scope name',
          required: true
        }
      ],
      execute: async (args) => {
        const results = await ragClient.scope()
          .whereName(args.name)
          .execute();

        return results[0] || null;
      }
    });
  }
}
```

---

### Jour 3-5: Agent Runtime

**Code:** `packages/runtime/src/agents/agent-runtime.ts`

```typescript
import type { LLMProviderAdapter } from '../llm/provider-adapter.js';
import type { ToolRegistry } from './tools/tool-registry.js';
import type { ChatSessionManager } from '../chat/session-manager.js';
import type { Message, AgentConfig, ToolCall } from '../types/chat.js';
import { v4 as uuidv4 } from 'uuid';

export class AgentRuntime {
  constructor(
    private config: AgentConfig,
    private llm: LLMProviderAdapter,
    private tools: ToolRegistry,
    private chatManager: ChatSessionManager
  ) {}

  async processMessage(
    sessionId: string,
    userMessage: Message
  ): Promise<Message> {
    // Get chat history
    const history = await this.chatManager.getMessages(sessionId, 10);

    // Build prompt
    const prompt = this.buildPrompt(history, userMessage);

    // Call LLM
    const response = await this.llm.generate(prompt);

    // Check for tool calls
    const toolCalls = this.parseToolCalls(response);

    if (toolCalls.length > 0) {
      // Execute tools
      const toolResults = await this.executeTools(toolCalls);

      // Generate final response with tool results
      const finalPrompt = this.buildFinalPrompt(
        history,
        userMessage,
        toolCalls,
        toolResults
      );

      const finalResponse = await this.llm.generate(finalPrompt);

      return {
        messageId: uuidv4(),
        sessionId,
        content: this.extractAnswer(finalResponse),
        role: 'agent',
        sentBy: this.config.id,
        timestamp: new Date(),
        toolCalls: toolCalls.map((tc, i) => ({
          ...tc,
          result: toolResults[i]
        }))
      };
    }

    // Direct response (no tools)
    return {
      messageId: uuidv4(),
      sessionId,
      content: this.extractAnswer(response),
      role: 'agent',
      sentBy: this.config.id,
      timestamp: new Date()
    };
  }

  private buildPrompt(
    history: Message[],
    currentMessage: Message
  ): string {
    const tools = this.tools.list().filter(t =>
      this.config.tools.includes(t.name)
    );

    return `${this.config.systemPrompt}

You have access to these tools:
${tools.map(t => `
- ${t.name}: ${t.description}
  Parameters: ${t.parameters.map(p => `${p.name} (${p.type})${p.required ? ' *required' : ''}`).join(', ')}
`).join('\n')}

Chat History:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

User: ${currentMessage.content}

If you need tools, respond with XML:
<response>
  <reasoning>Why you need these tools</reasoning>
  <tool_calls>
    <tool>
      <name>ragforge.semanticSearch</name>
      <arguments>
        <query>your query</query>
        <topK>10</topK>
      </arguments>
    </tool>
  </tool_calls>
</response>

If you can answer directly, respond with:
<response>
  <answer>Your answer here</answer>
</response>`;
  }

  private parseToolCalls(response: string): ToolCall[] {
    // Simple regex parsing for MVP
    const toolCallsMatch = response.match(/<tool_calls>([\s\S]*?)<\/tool_calls>/);
    if (!toolCallsMatch) return [];

    const toolMatches = [...toolCallsMatch[1].matchAll(/<tool>([\s\S]*?)<\/tool>/g)];

    return toolMatches.map(match => {
      const nameMatch = match[1].match(/<name>(.*?)<\/name>/);
      const argsMatch = match[1].match(/<arguments>([\s\S]*?)<\/arguments>/);

      const name = nameMatch ? nameMatch[1].trim() : '';
      const argsXml = argsMatch ? argsMatch[1] : '';

      // Parse arguments (simple key-value)
      const args: Record<string, any> = {};
      const argMatches = [...argsXml.matchAll(/<(\w+)>(.*?)<\/\1>/g)];
      argMatches.forEach(([, key, value]) => {
        args[key] = value.trim();
      });

      return { toolName: name, arguments: args };
    });
  }

  private async executeTools(toolCalls: ToolCall[]): Promise<any[]> {
    return Promise.all(
      toolCalls.map(async tc => {
        const tool = this.tools.get(tc.toolName);
        if (!tool) {
          throw new Error(`Tool not found: ${tc.toolName}`);
        }
        return await tool.execute(tc.arguments);
      })
    );
  }

  private buildFinalPrompt(
    history: Message[],
    userMessage: Message,
    toolCalls: ToolCall[],
    toolResults: any[]
  ): string {
    return `${this.config.systemPrompt}

Chat History:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

User: ${userMessage.content}

You executed these tools:
${toolCalls.map((tc, i) => `
Tool: ${tc.toolName}
Arguments: ${JSON.stringify(tc.arguments)}
Result: ${JSON.stringify(toolResults[i], null, 2)}
`).join('\n')}

Now provide a final answer based on the tool results.
Respond with:
<response>
  <answer>Your comprehensive answer referencing the tool results</answer>
</response>`;
  }

  private extractAnswer(response: string): string {
    const answerMatch = response.match(/<answer>([\s\S]*?)<\/answer>/);
    return answerMatch ? answerMatch[1].trim() : response;
  }
}
```

---

## 🧪 Test Example

**Code:** `examples/chat-basic/index.ts`

```typescript
import {
  ChatSessionManager,
  AgentRuntime,
  ToolRegistry
} from '@ragforge/runtime';
import { LLMProviderAdapter } from '@ragforge/runtime/llm/provider-adapter';
import { createRagClient } from './generated-client';
import config from './ragforge.config.yaml';

async function main() {
  // Setup
  const neo4j = new Neo4jClient(config.neo4j);
  const llm = new LLMProviderAdapter(config.llm);
  const rag = createRagClient(config);

  // Register tools
  const tools = new ToolRegistry();
  tools.registerRagForgeTools(rag);

  // Agent config
  const agentConfig = {
    id: 'code-assistant',
    name: 'Code Assistant',
    model: 'gemini-1.5-pro',
    temperature: 0.7,
    systemPrompt: `You are a code assistant.
Use semantic search to find relevant code.
Provide clear, specific answers with file paths and function names.`,
    tools: ['ragforge.semanticSearch', 'ragforge.getScope']
  };

  // Create runtime
  const chatManager = new ChatSessionManager(neo4j);
  const agent = new AgentRuntime(agentConfig, llm, tools, chatManager);

  // Create session
  console.log('Creating chat session...');
  const session = await chatManager.createSession(
    'Code Review Session'
  );

  console.log(`Session ID: ${session.sessionId}\n`);

  // User message
  const userMessage = {
    messageId: uuidv4(),
    sessionId: session.sessionId,
    content: 'Explain how authentication works in this codebase',
    role: 'user' as const,
    sentBy: 'user-123',
    timestamp: new Date()
  };

  console.log(`User: ${userMessage.content}\n`);
  await chatManager.addMessage(userMessage);

  // Agent responds
  console.log('Agent processing...');
  const agentResponse = await agent.processMessage(
    session.sessionId,
    userMessage
  );

  await chatManager.addMessage(agentResponse);

  console.log(`\nAgent: ${agentResponse.content}`);

  if (agentResponse.toolCalls) {
    console.log('\nTool calls executed:');
    agentResponse.toolCalls.forEach(tc => {
      console.log(`  - ${tc.toolName}(${JSON.stringify(tc.arguments)})`);
    });
  }

  // Cleanup
  await rag.close();
  await neo4j.close();
}

main();
```

---

## ✅ Test Checklist

Après Sprint 2, on devrait avoir:

- [ ] Session créée en Neo4j
- [ ] Messages persistés
- [ ] Agent répond aux questions
- [ ] Tool calling fonctionne (semantic search)
- [ ] Réponse finale intègre résultats des tools
- [ ] Historique visible dans Neo4j

---

## 🚀 Commande Rapide

```bash
# Install dependencies
npm install uuid @luciformresearch/xmlparser

# Run schema
npx tsx scripts/create-chat-schema.ts

# Test
npx tsx examples/chat-basic/index.ts
```

---

## 📊 Metrics à Suivre

```typescript
// After example run
SELECT
  (SELECT count(*) FROM ChatSession) as sessions,
  (SELECT count(*) FROM Message) as messages,
  (SELECT count(*) FROM Message WHERE role='agent' AND toolCalls IS NOT NULL) as tool_uses
```

---

## 🎯 Success Criteria

**MVP réussi si:**
1. ✅ Conversation persistée en Neo4j
2. ✅ Agent utilise semantic search automatiquement
3. ✅ Réponse cohérente basée sur code trouvé
4. ✅ < 5s response time

**Démo scenario:**
```
User: "Explain authentication"
Agent:
  1. Searches "authentication" (tool)
  2. Finds auth.ts, login.ts
  3. Responds: "Authentication is handled in auth.ts:15
     by the authenticateUser() function which checks..."
```

---

## 🔄 Itération Suivante

Après MVP:
1. Add compression (L1)
2. Add more tools (getRelatedScopes, etc.)
3. Better prompt engineering
4. Error handling
5. Streaming responses
