# Agent Chatbot - Roadmap d'Implémentation

> Date: 2026-01-07 17:46
> Status: En cours de design

## Phase 1: Foundation (MVP)

### 1.1 Installation des dépendances
```bash
cd packages/community-docs
npm install ai @ai-sdk/anthropic zod
```

**Fichiers à créer:**
- [ ] `lib/ragforge/agent/index.ts`

### 1.2 Memory Layer Abstraction
Abstraire le système de mémoire existant pour le rendre réutilisable.

**Fichiers à créer:**
- [ ] `lib/ragforge/agent/memory/interface.ts` - Interface ConversationMemory
- [ ] `lib/ragforge/agent/memory/neo4j-memory.ts` - Implémentation Neo4j

**Basé sur:**
- `packages/core/src/runtime/conversation/storage.ts`
- `packages/core/src/runtime/conversation/summarizer.ts`
- `packages/core/src/runtime/conversation/types.ts`

### 1.3 Tools Definition (Vercel AI SDK)
Définir les outils disponibles pour l'agent.

**Fichier:** `lib/ragforge/agent/tools.ts`

**Tools MVP:**
- [ ] `search_brain` - Recherche sémantique (utilise CommunityOrchestrator.search)
- [ ] `ingest_document` - Ingestion de fichier (utilise CommunityOrchestrator.ingest)
- [ ] `read_document` - Lecture d'un document existant

### 1.4 System Prompt
Créer le prompt système optimisé pour le chatbot.

**Fichier:** `lib/ragforge/agent/system-prompt.ts`

### 1.5 API Endpoint /chat
Endpoint principal utilisant Vercel AI SDK.

**Fichier:** `lib/ragforge/api/routes/chat.ts`

**Features:**
- [ ] Streaming SSE
- [ ] Agent loop (maxSteps: 10)
- [ ] Gestion des attachments (files, URLs)
- [ ] Intégration Memory Layer

### 1.6 UI Minimaliste
Interface chat sans logique.

**Fichier:** `app/chat/page.tsx` ou `public/chat.html`

**Features:**
- [ ] Liste de messages
- [ ] Input text + bouton send
- [ ] Upload de fichiers
- [ ] Affichage streaming
- [ ] Indicateurs d'exécution tools

---

## Phase 2: Enhanced Tools

### 2.1 Web Fetching
- [ ] `fetch_url` - Fetch et optionnellement ingère une page web
- [ ] Intégration avec le web scraper existant

### 2.2 GitHub Integration
- [ ] `ingest_github` - Clone et ingère un repo
- [ ] Shallow clone pour performance
- [ ] Parsing intelligent (README, code principal)

### 2.3 Image/Document Processing
- [ ] Support images (PNG, JPG) avec description Gemini Vision
- [ ] Support PDFs avec OCR
- [ ] Support DOCX, XLSX

---

## Phase 3: Advanced Memory

### 3.1 Enriched Context
- [ ] Intégration Entity/Tag boost dans le contexte
- [ ] RAG sur les entités mentionnées dans l'historique

### 3.2 Multi-conversation
- [ ] Liste des conversations
- [ ] Switch entre conversations
- [ ] Export de conversation

### 3.3 Memory Visualization
- [ ] Endpoint pour voir les summaries L1/L2
- [ ] Graph des entités mentionnées

---

## Phase 4: Production Ready

### 4.1 Authentication
- [ ] API Key validation
- [ ] Rate limiting

### 4.2 Observability
- [ ] Logging structuré
- [ ] Métriques (latence, tokens, tools usage)
- [ ] Error tracking

### 4.3 Performance
- [ ] Caching des embeddings
- [ ] Optimisation des requêtes Neo4j

---

## Dépendances techniques

### Packages requis
```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "zod": "^3.23.0"
  }
}
```

### Variables d'environnement
```env
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...

# Existant (déjà configuré)
NEO4J_URI=bolt://localhost:7688
NEO4J_USER=neo4j
NEO4J_PASSWORD=communitydocs
```

---

## Estimation

| Phase | Complexité | Estimation |
|-------|------------|------------|
| Phase 1 (MVP) | Medium | 1-2 jours |
| Phase 2 (Tools) | Medium | 1 jour |
| Phase 3 (Memory) | High | 2-3 jours |
| Phase 4 (Prod) | Medium | 1-2 jours |

**Total estimé:** 5-8 jours

---

## Critères de succès MVP

1. **API fonctionnelle**: `curl -X POST /chat` retourne un stream
2. **Agent loop**: Claude utilise les tools automatiquement
3. **Memory persiste**: Messages et summaries en Neo4j
4. **UI basique**: Peut chatter via l'interface web
5. **Ingestion**: Peut uploader un PDF et le retrouver via search

---

## Prochaine étape

**Commencer par Phase 1.1**: Installation des dépendances et structure de base.

```bash
cd packages/community-docs
npm install ai @ai-sdk/anthropic zod
mkdir -p lib/ragforge/agent/memory
```
