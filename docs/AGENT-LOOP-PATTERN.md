# Agent Loop Pattern Implementation

## 🎯 Vue d'Ensemble

Implémentation custom d'un agent loop pattern inspiré de LlamaIndex `llm.exec`, mais avec contrôle total et utilisation de notre `StructuredLLMExecutor`.

---

## 🔄 Pattern de Loop

```
┌─────────────────────────────────────────┐
│         User Query                      │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   Initialize Context                    │
│   - history                             │
│   - userQuery                           │
│   - toolExecutions: []                  │
└────────────┬────────────────────────────┘
             │
             ▼
     ┌───────────────┐
     │  iteration++  │
     └───────┬───────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   Call LLM with Context                 │
│   (StructuredLLMExecutor)               │
│                                         │
│   Output Schema:                        │
│   - reasoning: string                   │
│   - tool_calls?: array                  │
│   - answer?: string                     │
└────────────┬────────────────────────────┘
             │
             ▼
        ┌────────┐
        │ Has    │  YES
        │ tool_  ├──────┐
        │ calls? │      │
        └───┬────┘      │
            │ NO        │
            │           ▼
            │    ┌──────────────┐
            │    │ Execute Tools│
            │    └──────┬───────┘
            │           │
            │           ▼
            │    ┌──────────────────────┐
            │    │ Add to               │
            │    │ context.toolExecutions│
            │    └──────┬───────────────┘
            │           │
            │           └──────┐
            │                  │
            ▼                  │
     ┌──────────┐             │
     │ Has      │             │
     │ answer?  │             │
     └────┬─────┘             │
          │ YES               │
          │                   │
          ▼                   │
   ┌─────────────┐            │
   │ Exit Loop   │            │
   └─────────────┘            │
                              │
          ┌───────────────────┘
          │ Continue loop
          └────────────────────┐
                               │
                         ┌─────▼──────┐
                         │ iteration  │
                         │ < MAX?     │
                         └─────┬──────┘
                               │ YES
                               └───────► Back to "Call LLM"
                               │ NO
                               ▼
                         ┌──────────────┐
                         │ Return with  │
                         │ error message│
                         └──────────────┘
```

---

## 📊 Structure des Données

### ConversationContext

Accumulé à travers les itérations:

```typescript
interface ConversationContext {
  history: Message[];           // Messages de chat précédents
  userQuery: string;            // Query actuelle de l'user
  toolExecutions: ToolExecution[]; // Historique des tool executions
}
```

### ToolExecution

Une itération de tool execution:

```typescript
interface ToolExecution {
  iteration: number;            // Numéro d'itération
  reasoning: string;            // Raisonnement du LLM
  toolCalls: ToolCallRequest[]; // Tools demandés
  results: ToolResult[];        // Résultats obtenus
}
```

### LLMResponse

Réponse structurée du LLM via StructuredLLMExecutor:

```typescript
interface LLMResponse {
  reasoning: string;            // Toujours présent
  tool_calls?: ToolCallRequest[]; // Si besoin d'info
  answer?: string;              // Si peut répondre
}
```

---

## 🎨 Example de Flow

### Iteration 1: Initial Tool Call

**User Query:** "Explain how authentication works"

**LLM Response:**
```xml
<reasoning>
  I need to search for authentication-related code to answer this question.
</reasoning>
<tool_calls>
  <tool_call>
    <tool_name>generated.scope.semanticSearchBySource</tool_name>
    <arguments>
      <query>authentication</query>
      <topK>10</topK>
    </arguments>
  </tool_call>
</tool_calls>
```

**Tool Execution:**
```
Tool: generated.scope.semanticSearchBySource
Result: [
  { name: "authenticateUser", type: "function", file: "auth.ts" },
  { name: "validateToken", type: "function", file: "token.ts" },
  ...
]
```

**Context Updated:**
```typescript
context.toolExecutions = [
  {
    iteration: 1,
    reasoning: "I need to search...",
    toolCalls: [{ tool_name: "...", arguments: {...} }],
    results: [{ success: true, result: [...] }]
  }
]
```

### Iteration 2: Get Details

**LLM Response (with previous context):**
```xml
<reasoning>
  I found authenticateUser function, let me get its full code.
</reasoning>
<tool_calls>
  <tool_call>
    <tool_name>generated.scope.whereName</tool_name>
    <arguments>
      <name>authenticateUser</name>
    </arguments>
  </tool_call>
</tool_calls>
```

**Tool Execution:**
```
Tool: generated.scope.whereName
Result: { name: "authenticateUser", source: "function authenticateUser...", ... }
```

### Iteration 3: Final Answer

**LLM Response (with all previous context):**
```xml
<reasoning>
  Now I have enough information from the code to explain.
</reasoning>
<answer>
  Authentication in this codebase is handled by the authenticateUser function in auth.ts.
  It validates credentials and generates a JWT token using validateToken from token.ts.
  The process follows these steps:
  1. User provides credentials
  2. authenticateUser verifies them against the database
  3. If valid, validateToken generates a JWT
  4. Token is returned to the client for subsequent requests
</answer>
```

**Exit Loop:** Final answer provided!

---

## 💡 Avantages du Pattern

### 1. **Context Accumulation**
- Chaque tool execution s'ajoute au contexte
- Le LLM voit tout l'historique des actions
- Peut faire des décisions informées

### 2. **Flexible**
- Agent décide lui-même quand s'arrêter
- Peut appeler plusieurs tools par iteration
- Peut faire plusieurs itérations si nécessaire

### 3. **Robust**
- Safety limit (MAX_ITERATIONS = 10)
- Error handling à chaque tool call
- Logging détaillé pour debugging

### 4. **Uses StructuredLLMExecutor**
- Pas de parsing manuel
- Schema XML robuste
- Testé et validé

---

## 🔧 Configuration

### Agent Config

```yaml
chat:
  agents:
    - id: code-assistant
      name: Code Assistant
      domain: code
      model: gemini-1.5-pro
      temperature: 0.7
      system_prompt: |
        You are a code assistant.
        Use available tools to search and analyze code.
        Iterate until you have enough information.
      tools:
        - generated.scope.semanticSearchBySource
        - generated.scope.whereName
        - generated.scope.withConsumes
```

### Runtime

```typescript
const agent = new AgentRuntime(
  agentConfig,
  llmProvider,
  toolRegistry,
  sessionManager
);

// Optional: adjust max iterations
agent.setMaxIterations(15);

// Process message (will loop automatically)
const response = await agent.processMessage(sessionId, userMessage);
```

---

## 📈 Métriques & Logging

### Console Output

```
🤖 Agent starting (session: abc-123)
   Query: "Explain how authentication works"
   Max iterations: 10

============================================================
Iteration 1
============================================================
Reasoning: I need to search for authentication-related code
Tool calls requested: generated.scope.semanticSearchBySource
Tools executed: 1/1 successful

============================================================
Iteration 2
============================================================
Reasoning: I found authenticateUser function, let me get details
Tool calls requested: generated.scope.whereName
Tools executed: 1/1 successful

============================================================
Iteration 3
============================================================
Reasoning: Now I have enough information
Final answer provided (487 chars)

✅ Agent complete (3 iterations, 2 tool executions)
```

### Stored in Message

```typescript
{
  messageId: "msg-456",
  content: "Authentication in this codebase...",
  role: "agent",
  toolCalls: [
    {
      toolName: "generated.scope.semanticSearchBySource",
      arguments: { query: "authentication", topK: 10 },
      result: [...]
    },
    {
      toolName: "generated.scope.whereName",
      arguments: { name: "authenticateUser" },
      result: {...}
    }
  ]
}
```

---

## 🎯 Différences vs LlamaIndex llm.exec

| Feature | LlamaIndex | Notre Pattern |
|---------|-----------|---------------|
| Tool calling | Natif provider | StructuredLLMExecutor (XML) |
| Message format | ChatMessage | Custom Message type |
| Context | Messages array | ConversationContext object |
| Loop control | Manual do-while | Manual while loop |
| Streaming | Built-in | TODO |
| Tool format | Zod schemas | ToolRegistry |
| Customization | Limited | Full control |

---

## 🚀 Prochaines Étapes

### Court Terme
1. ✅ **Test avec mock tools** - Valider le flow
2. ✅ **Test avec vrai client** - Intégration complète
3. ⏳ **Streaming support** - AsyncGenerator pattern
4. ⏳ **Error recovery** - Retry failed tools

### Moyen Terme
5. **Parallel tool execution** - Execute multiple tools simultaneously
6. **Context compression** - Summarize old tool executions
7. **Cost tracking** - Monitor token usage per iteration
8. **Agent orchestration** - Multiple agents collaborating

---

## 📝 Example d'Usage Complet

```typescript
import {
  ChatSessionManager,
  ToolRegistry,
  AgentRuntime
} from '@ragforge/runtime';
import { LLMProviderAdapter } from '@ragforge/runtime/llm/provider-adapter';
import { createRagClient } from './generated-client';

// Setup
const rag = createRagClient(config);
const neo4j = new Neo4jClient(config.neo4j);
const llmProvider = new LLMProviderAdapter(config.llm);

// Register tools (auto-generated!)
const tools = new ToolRegistry();
tools.autoRegisterFromClient(rag, 'Scope');

// Create session manager
const sessionManager = new ChatSessionManager(neo4j);

// Create agent
const agentConfig = {
  id: 'code-assistant',
  name: 'Code Assistant',
  model: 'gemini-1.5-pro',
  temperature: 0.7,
  systemPrompt: 'You are a code assistant...',
  tools: [
    'generated.scope.semanticSearchBySource',
    'generated.scope.whereName'
  ]
};

const agent = new AgentRuntime(
  agentConfig,
  llmProvider.getInstance(), // Pass LLMProvider for StructuredLLMExecutor
  tools,
  sessionManager
);

// Create session
const session = await sessionManager.createSession({
  title: 'Code Review',
  domain: 'code'
});

// User message
const userMsg = {
  messageId: uuidv4(),
  sessionId: session.sessionId,
  content: 'Explain how authentication works',
  role: 'user' as const,
  sentBy: 'user-123',
  timestamp: new Date()
};

await sessionManager.addMessage(userMsg);

// Agent processes (with automatic loop!)
const agentResponse = await agent.processMessage(session.sessionId, userMsg);

// Store response
await sessionManager.addMessage(agentResponse);

// Print result
console.log(agentResponse.content);
console.log(`Used ${agentResponse.toolCalls?.length || 0} tools`);
```

---

## ✅ Checklist de Validation

Avant de considérer le pattern complete:

- [x] **Loop pattern implémenté**
- [x] **StructuredLLMExecutor intégré**
- [x] **Context accumulation**
- [x] **Tool execution**
- [x] **Error handling**
- [x] **Safety limits**
- [x] **Logging**
- [ ] **Tests unitaires**
- [ ] **Tests d'intégration**
- [ ] **Streaming support**
- [ ] **Documentation examples**

---

**Status:** Ready for testing ✅
