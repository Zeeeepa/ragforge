# Agent Chatbot - Notes d'Implémentation

## Architecture Choisie

- **Framework**: Vercel AI SDK (`ai`, `@ai-sdk/anthropic`)
- **LLM**: Claude via `@ai-sdk/anthropic`
- **Storage**: Neo4j (existant)
- **Streaming**: SSE (Server-Sent Events)

## APIs Disponibles

### CommunityOrchestratorAdapter (orchestrator-adapter.ts)

Méthodes disponibles:
- `search(options: CommunitySearchOptions)` - Recherche sémantique
- `ingestVirtual(options)` - Ingestion de fichiers virtuels
- `deleteDocument(documentId)` - Suppression de documents
- `generateEmbeddingsForDocument(documentId)` - Génération d'embeddings

Méthodes MANQUANTES (à implémenter via Neo4j direct):
- `getDocument(documentId)` - Récupérer un document complet
- `listDocuments(options)` - Lister les documents
- `fetchWebPage(url)` - Récupérer une page web

### ConversationStorage (core - storage.ts)

API complète pour la mémoire multi-niveaux:

```typescript
// Conversation lifecycle
createConversation(data: ConversationMetadata): Promise<void>
getConversationMetadata(uuid: string): Promise<ConversationMetadata | null>
listConversations(options?: ListConversationsOptions): Promise<ConversationMetadata[]>
deleteConversation(uuid: string): Promise<void>

// Messages
storeMessage(options: StoreMessageOptions): Promise<string>
getMessages(conversationId: string, options?: GetMessagesOptions): Promise<Message[]>
storeTurnWithEmbedding(conversationId, userMessage, assistantMessage, options?)

// Tool calls
storeToolCall(messageUuid: string, toolCall: any): Promise<void>

// Summaries (L1, L2)
storeSummary(summary: Summary): Promise<void>
getSummaries(conversationId: string, level?: number): Promise<Summary[]>
generateL1SummaryIfNeeded(conversationId, options?): Promise<Summary | null>
generateL2SummaryIfNeeded(conversationId, options?): Promise<Summary | null>

// Semantic search multi-level
searchConversationHistory(conversationId, query, options): Promise<Array<{type, turn?, summary?, score}>>
```

### Types (core - types.ts)

```typescript
interface ConversationMetadata {
  uuid: string;
  title: string;
  tags: string[];
  created_at: Date | string;
  updated_at: Date | string;
  message_count: number;
  total_chars: number;
  status: 'active' | 'archived';
}

interface Message {
  uuid: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  timestamp: Date | string;
  char_count: number;
  embedding?: number[];
  tool_calls?: ToolCall[];
}

interface Summary {
  uuid: string;
  conversation_id: string;
  level: number; // 1, 2, 3...
  content: SummaryContent;
  start_turn_index: number;
  end_turn_index: number;
  char_range_start: number;
  char_range_end: number;
  summary_char_count: number;
  created_at: Date | string;
  embedding?: number[];
}

interface ConversationConfig {
  maxContextChars?: number; // Default: 100000
  l1ThresholdPercent?: number; // Default: 10 (10k chars)
  l2ThresholdPercent?: number; // Default: 10
  enableSummarization?: boolean;
  // ...
}
```

## Structure des Fichiers

```
lib/ragforge/
├── agent/
│   ├── index.ts          - Exports du module agent
│   ├── tools.ts          - Définition des tools (Vercel AI format)
│   └── system-prompt.ts  - System prompt de l'agent
├── api/routes/
│   └── chat.ts           - Endpoint POST /chat avec streaming
└── orchestrator-adapter.ts - Wrapper autour du core
```

## Décision: Simplification vs Full Memory

Pour cette v1, on utilise un storage Neo4j **simplifié** directement dans chat.ts:
- Pas d'import de ConversationStorage du core (complexité)
- Stockage basique: ChatConversation, ChatMessage nodes
- Conversation context via les 10 derniers messages

La mémoire multi-niveaux (L1/L2/L3) sera ajoutée dans une v2.

## Tools Implémentés

1. **search_brain** - Recherche sémantique dans la knowledge base
2. **ingest_document** - Ingestion de documents
3. **read_document** - Lecture d'un document (via Neo4j direct)
4. **fetch_url** - Récupération de pages web (via fetch + node-html-parser)
5. **list_documents** - Liste des documents (via Neo4j direct)

## Corrections Apportées

### tools.ts
- Import: `CommunityOrchestratorAdapter` (pas `CommunityOrchestrator`)
- Méthode: `ingestVirtual` (pas `ingestVirtualFile`)
- `getDocument`: Query Neo4j directement
- `fetchWebPage`: Utiliser fetch + parsing
- `listDocuments`: Query Neo4j directement

### chat.ts
- Storage simplifié via Neo4j direct
- SSE streaming avec events: start, text-delta, tool-call, tool-result, finish, error
- Conversation management: create, list, get, delete
