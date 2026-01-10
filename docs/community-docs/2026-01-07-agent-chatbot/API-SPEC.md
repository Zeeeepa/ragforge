# Agent Chatbot - Spécification API

> Date: 2026-01-07 17:46
> Version: 1.0.0

## Base URL

```
http://127.0.0.1:6970
```

---

## Endpoints

### POST /chat

Endpoint principal pour le chat avec l'agent. Supporte le streaming SSE.

#### Request

```http
POST /chat
Content-Type: application/json
```

**Body:**
```typescript
interface ChatRequest {
  // ID de conversation (optionnel, créé automatiquement si absent)
  conversationId?: string;

  // Message utilisateur
  message: string;

  // Fichiers/URLs attachés (optionnel)
  attachments?: Attachment[];

  // Options
  options?: {
    // Streaming (default: true)
    stream?: boolean;
    // Max iterations pour l'agent loop (default: 10)
    maxSteps?: number;
    // Inclure le contexte mémoire (default: true)
    includeMemoryContext?: boolean;
  };
}

interface Attachment {
  // Type d'attachment
  type: 'file' | 'url';

  // Contenu (base64 pour file, URL pour url)
  content: string;

  // Nom du fichier (requis pour file)
  filename?: string;

  // MIME type (optionnel, détecté automatiquement)
  mimeType?: string;

  // Metadata additionnelle
  metadata?: Record<string, any>;
}
```

**Exemple - Message simple:**
```json
{
  "message": "Qu'est-ce que tu sais sur le machine learning?"
}
```

**Exemple - Avec fichier:**
```json
{
  "conversationId": "conv-123",
  "message": "Analyse ce document et dis-moi les points clés",
  "attachments": [
    {
      "type": "file",
      "content": "JVBERi0xLjQK...",
      "filename": "rapport.pdf",
      "mimeType": "application/pdf"
    }
  ]
}
```

**Exemple - Avec URL:**
```json
{
  "message": "Ingère ce repo GitHub et explique-moi l'architecture",
  "attachments": [
    {
      "type": "url",
      "content": "https://github.com/vercel/ai"
    }
  ]
}
```

#### Response (Streaming)

Le endpoint retourne un stream SSE (Server-Sent Events).

**Event types:**

```typescript
// Début de la réponse
{ "type": "start", "conversationId": "conv-123" }

// Delta de texte (streaming)
{ "type": "text-delta", "content": "Voici " }
{ "type": "text-delta", "content": "ma réponse..." }

// Tool call (l'agent appelle un outil)
{
  "type": "tool-call",
  "id": "call-456",
  "name": "search_brain",
  "args": { "query": "machine learning", "limit": 5 }
}

// Tool result (résultat de l'outil)
{
  "type": "tool-result",
  "id": "call-456",
  "name": "search_brain",
  "result": { "results": [...], "count": 5 }
}

// Fin de la réponse
{
  "type": "finish",
  "finishReason": "stop",
  "usage": {
    "promptTokens": 1234,
    "completionTokens": 567
  }
}

// Erreur
{
  "type": "error",
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT"
}
```

**Exemple SSE stream:**
```
data: {"type":"start","conversationId":"conv-abc123"}

data: {"type":"text-delta","content":"Je vais "}

data: {"type":"text-delta","content":"chercher dans "}

data: {"type":"text-delta","content":"la base..."}

data: {"type":"tool-call","id":"call-1","name":"search_brain","args":{"query":"machine learning"}}

data: {"type":"tool-result","id":"call-1","name":"search_brain","result":{"count":3}}

data: {"type":"text-delta","content":"J'ai trouvé 3 documents pertinents..."}

data: {"type":"finish","finishReason":"stop","usage":{"promptTokens":500,"completionTokens":150}}

```

#### Response (Non-streaming)

Si `options.stream: false`:

```typescript
interface ChatResponse {
  conversationId: string;
  message: string;
  toolCalls: ToolCallResult[];
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

interface ToolCallResult {
  id: string;
  name: string;
  args: Record<string, any>;
  result: any;
  durationMs: number;
}
```

---

### GET /chat/conversations

Liste les conversations.

```http
GET /chat/conversations?limit=20&status=active
```

**Query params:**
- `limit`: Nombre max (default: 20)
- `status`: 'active' | 'archived' (default: 'active')

**Response:**
```json
{
  "conversations": [
    {
      "id": "conv-123",
      "title": "Discussion ML",
      "messageCount": 15,
      "createdAt": "2026-01-07T10:00:00Z",
      "updatedAt": "2026-01-07T17:30:00Z"
    }
  ],
  "total": 5
}
```

---

### GET /chat/conversations/:id

Récupère une conversation avec ses messages.

```http
GET /chat/conversations/conv-123?includeToolCalls=true
```

**Query params:**
- `includeToolCalls`: Inclure les tool calls (default: false)
- `limit`: Nombre de messages (default: 50)

**Response:**
```json
{
  "id": "conv-123",
  "title": "Discussion ML",
  "messages": [
    {
      "role": "user",
      "content": "Qu'est-ce que le ML?",
      "timestamp": "2026-01-07T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "Le machine learning est...",
      "timestamp": "2026-01-07T10:00:05Z",
      "toolCalls": [...]
    }
  ],
  "summaries": [
    {
      "level": 1,
      "content": {
        "conversation_summary": "User asked about ML...",
        "actions_summary": "Assistant searched and explained..."
      }
    }
  ]
}
```

---

### DELETE /chat/conversations/:id

Supprime une conversation.

```http
DELETE /chat/conversations/conv-123
```

**Response:**
```json
{
  "success": true,
  "deleted": {
    "messages": 15,
    "summaries": 2
  }
}
```

---

## Tools disponibles pour l'agent

L'agent peut utiliser ces outils automatiquement:

### search_brain
Recherche sémantique dans la base de connaissances.

```typescript
{
  query: string;      // Requête de recherche
  limit?: number;     // Max résultats (default: 10)
  semantic?: boolean; // Recherche sémantique (default: true)
}
```

### ingest_document
Ingère un document dans la base.

```typescript
{
  content: string;    // Contenu (texte ou base64)
  filename: string;   // Nom du fichier
  metadata?: {
    documentTitle?: string;
    categorySlug?: string;
    tags?: string[];
  };
}
```

### read_document
Lit un document existant.

```typescript
{
  documentId: string; // ID du document
}
```

### fetch_url
Fetch une page web.

```typescript
{
  url: string;        // URL à fetcher
  ingest?: boolean;   // Ingérer après fetch (default: false)
}
```

### ingest_github
Clone et ingère un repo GitHub.

```typescript
{
  url: string;        // URL du repo (https://github.com/...)
  branch?: string;    // Branche (default: "main")
  maxFiles?: number;  // Max fichiers à ingérer (default: 100)
}
```

---

## Codes d'erreur

| Code | Description |
|------|-------------|
| `INVALID_REQUEST` | Requête malformée |
| `CONVERSATION_NOT_FOUND` | Conversation inexistante |
| `RATE_LIMIT` | Trop de requêtes |
| `LLM_ERROR` | Erreur du modèle Claude |
| `TOOL_ERROR` | Erreur lors de l'exécution d'un outil |
| `MEMORY_ERROR` | Erreur de stockage mémoire |

---

## Exemples curl

### Chat simple
```bash
curl -X POST http://127.0.0.1:6970/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Bonjour, que peux-tu faire?"}'
```

### Chat avec fichier
```bash
curl -X POST http://127.0.0.1:6970/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Analyse ce fichier",
    "attachments": [{
      "type": "file",
      "content": "'$(base64 -w0 document.pdf)'",
      "filename": "document.pdf"
    }]
  }'
```

### Liste des conversations
```bash
curl http://127.0.0.1:6970/chat/conversations
```

### Récupérer une conversation
```bash
curl http://127.0.0.1:6970/chat/conversations/conv-123
```
