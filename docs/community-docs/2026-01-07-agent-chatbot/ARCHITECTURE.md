# Agent Chatbot - Architecture Technique

> Date: 2026-01-07 17:46
> Projet: Community Docs Agent Chatbot
> Stack: Vercel AI SDK + Claude + Neo4j + RagForge

## Vue d'ensemble

Un chatbot intelligent avec mémoire long-terme, capable d'ingérer des documents/images/liens et de rechercher dans la base de connaissances.

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│              Next.js Page (UI minimaliste)                       │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Chat Interface                                          │    │
│  │  ├─ Messages list (streaming)                            │    │
│  │  ├─ Input + file upload                                  │    │
│  │  └─ Tool execution indicators                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                    POST /api/chat (SSE stream)                   │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                          BACKEND                                 │
│                   Community Docs API                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  POST /chat                                              │    │
│  │  ├─ Vercel AI SDK (streamText)                          │    │
│  │  ├─ Claude 3.5 Sonnet via @ai-sdk/anthropic             │    │
│  │  ├─ maxSteps: 10 (agent loop)                           │    │
│  │  └─ tools: ingest, search, readFile, webFetch           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌───────────────────────────┼───────────────────────────┐      │
│  │                    TOOL HANDLERS                       │      │
│  │                                                        │      │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐│      │
│  │  │ ingest   │  │ search   │  │ readFile │  │webFetch││      │
│  │  │ _doc     │  │ _brain   │  │          │  │        ││      │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘│      │
│  │       │             │             │            │      │      │
│  └───────┼─────────────┼─────────────┼────────────┼──────┘      │
│          │             │             │            │              │
│  ┌───────▼─────────────▼─────────────▼────────────▼──────┐      │
│  │              MEMORY LAYER (abstrait)                   │      │
│  │                                                        │      │
│  │  ┌────────────────────────────────────────────────┐   │      │
│  │  │  ConversationMemory                             │   │      │
│  │  │  ├─ addMessage(role, content)                   │   │      │
│  │  │  ├─ getContext(query) → recent + RAG summaries  │   │      │
│  │  │  ├─ triggerSummarization()                      │   │      │
│  │  │  └─ search(query) → relevant history            │   │      │
│  │  └────────────────────────────────────────────────┘   │      │
│  │                         │                              │      │
│  │  ┌──────────────────────▼─────────────────────────┐   │      │
│  │  │  Neo4j Storage (existant)                       │   │      │
│  │  │  ├─ ConversationStorage                         │   │      │
│  │  │  ├─ ConversationSummarizer (L1/L2/L3)           │   │      │
│  │  │  └─ Embeddings (Ollama mxbai-embed-large)       │   │      │
│  │  └────────────────────────────────────────────────┘   │      │
│  └────────────────────────────────────────────────────────┘      │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐      │
│  │              RAGFORGE CORE (existant)                   │      │
│  │  ├─ CommunityOrchestrator (ingestion + search)         │      │
│  │  ├─ EntityEmbeddingService (tags/entities boost)       │      │
│  │  └─ EnrichmentService (extraction entités)             │      │
│  └────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

## Stack Technique

### Frontend
- **Framework**: Page dans Next.js existant (ou HTML statique minimal)
- **Principe**: ZERO logique côté client
- **Responsabilités**:
  - Afficher les messages (avec streaming SSE)
  - Envoyer les messages utilisateur
  - Upload de fichiers (images, PDFs, etc.)
  - Afficher les indicateurs d'exécution d'outils

### Backend API

#### Dépendances
```json
{
  "ai": "^4.x",
  "@ai-sdk/anthropic": "^1.x"
}
```

#### Endpoint Principal
```typescript
POST /chat
Content-Type: application/json

Request:
{
  "conversationId": "uuid",      // Optionnel, créé si absent
  "message": "string",
  "attachments": [               // Optionnel
    {
      "type": "file" | "url",
      "content": "base64 | url",
      "filename": "string",
      "mimeType": "string"
    }
  ]
}

Response: SSE Stream
data: {"type": "text-delta", "content": "..."}
data: {"type": "tool-call", "name": "search_brain", "args": {...}}
data: {"type": "tool-result", "name": "search_brain", "result": {...}}
data: {"type": "finish", "usage": {...}}
```

### Tools (Vercel AI SDK format)

```typescript
const tools = {
  // Recherche sémantique dans la base
  search_brain: tool({
    description: "Search the knowledge base for relevant documents",
    parameters: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10),
    }),
    execute: async ({ query, limit }) => {
      return orchestrator.search({ query, semantic: true, limit });
    },
  }),

  // Ingestion de document
  ingest_document: tool({
    description: "Ingest a document into the knowledge base",
    parameters: z.object({
      content: z.string().describe("Document content or base64"),
      filename: z.string().describe("Original filename"),
      metadata: z.object({...}).optional(),
    }),
    execute: async ({ content, filename, metadata }) => {
      return orchestrator.ingestVirtual(content, filename, metadata);
    },
  }),

  // Lecture de fichier existant
  read_file: tool({
    description: "Read a file from the knowledge base",
    parameters: z.object({
      documentId: z.string(),
    }),
    execute: async ({ documentId }) => {
      return orchestrator.getDocument(documentId);
    },
  }),

  // Fetch web page
  fetch_url: tool({
    description: "Fetch and optionally ingest a web page",
    parameters: z.object({
      url: z.string().url(),
      ingest: z.boolean().optional().default(false),
    }),
    execute: async ({ url, ingest }) => {
      const content = await fetchWebPage(url);
      if (ingest) await orchestrator.ingestWeb(url, content);
      return content;
    },
  }),

  // Clone et ingère un repo GitHub
  ingest_github: tool({
    description: "Clone and ingest a GitHub repository",
    parameters: z.object({
      url: z.string().describe("GitHub repo URL"),
      branch: z.string().optional().default("main"),
    }),
    execute: async ({ url, branch }) => {
      // Clone shallow, parse, ingest
      return orchestrator.ingestGitHub(url, branch);
    },
  }),
};
```

## Memory Layer (Abstraction)

### Interface
```typescript
interface ConversationMemory {
  // Lifecycle
  create(title?: string): Promise<string>; // Returns conversationId

  // Messages
  addUserMessage(content: string, attachments?: Attachment[]): Promise<void>;
  addAssistantMessage(content: string, toolCalls?: ToolCall[]): Promise<void>;

  // Context retrieval (for LLM prompt)
  getContext(query: string): Promise<{
    recentMessages: Message[];      // Last N non-summarized
    relevantSummaries: Summary[];   // RAG on L1/L2/L3
    relevantHistory: Message[];     // Semantic search on old messages
  }>;

  // Summarization
  checkAndTriggerSummarization(): Promise<void>;

  // Search
  searchHistory(query: string): Promise<Message[]>;
}
```

### Implémentation (wraps existant)
```typescript
class Neo4jConversationMemory implements ConversationMemory {
  constructor(
    private storage: ConversationStorage,
    private summarizer: ConversationSummarizer,
    private embeddingProvider: EmbeddingProvider,
    private config: ConversationConfig,
  ) {}

  // ... implémente l'interface en utilisant les classes existantes
}
```

## Flow d'une requête

```
1. User envoie message + fichier PDF
   │
2. POST /chat
   │
3. Memory.addUserMessage(message, [{type: "file", content: pdf}])
   │
4. Memory.getContext(message) → construit le contexte
   │  ├─ Recent: derniers 5 messages non résumés
   │  ├─ RAG: top 3 summaries pertinentes (L1/L2)
   │  └─ History: 2-3 messages anciens très pertinents
   │
5. Vercel AI SDK streamText({
   │  model: anthropic("claude-3-5-sonnet"),
   │  system: SYSTEM_PROMPT + context,
   │  messages: conversationHistory,
   │  tools: { search_brain, ingest_document, ... },
   │  maxSteps: 10,
   │})
   │
6. Agent loop (géré par Vercel AI SDK)
   │  ├─ Step 1: Claude décide d'ingérer le PDF
   │  │          → tool_call: ingest_document
   │  │          → execute → result
   │  │
   │  ├─ Step 2: Claude cherche dans la base
   │  │          → tool_call: search_brain
   │  │          → execute → result
   │  │
   │  └─ Step 3: Claude répond avec les infos trouvées
   │             → text response (streamed)
   │
7. Memory.addAssistantMessage(response, toolCalls)
   │
8. Memory.checkAndTriggerSummarization()
   │  └─ Si seuil atteint → génère L1 summary
   │
9. Stream terminé, response complète au client
```

## Structure des fichiers

```
packages/community-docs/
├── lib/ragforge/
│   ├── api/
│   │   ├── server.ts              # Existant + nouveau endpoint /chat
│   │   └── routes/
│   │       └── chat.ts            # Nouveau: handler /chat
│   │
│   ├── agent/                     # Nouveau dossier
│   │   ├── index.ts               # Export principal
│   │   ├── tools.ts               # Définition des tools Vercel AI
│   │   ├── system-prompt.ts       # System prompt du chatbot
│   │   └── memory/
│   │       ├── interface.ts       # ConversationMemory interface
│   │       └── neo4j-memory.ts    # Implémentation Neo4j
│   │
│   └── orchestrator-adapter.ts    # Existant (utilisé par les tools)
│
├── app/                           # Ou pages/ selon config Next.js
│   └── chat/
│       └── page.tsx               # UI Chat minimaliste
│
└── public/
    └── chat.html                  # Alternative: HTML statique
```

## Avantages de cette architecture

1. **Framework reconnu**: Vercel AI SDK = crédibilité pro
2. **Séparation claire**: UI sans logique, API avec toute l'intelligence
3. **Réutilisation**: Memory layer abstrait, utilisable ailleurs
4. **Testable**: API testable via curl/Postman facilement
5. **Streaming natif**: UX fluide avec SSE
6. **Agent loop géré**: maxSteps de Vercel AI SDK gère la boucle
