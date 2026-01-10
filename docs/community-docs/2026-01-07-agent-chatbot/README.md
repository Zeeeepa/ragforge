# Agent Chatbot pour Community Docs

> **Date de création:** 2026-01-07 17:46
> **Status:** Design Phase

## Objectif

Créer un chatbot intelligent avec:
- **Mémoire long-terme** (summaries L1/L2/L3)
- **Tools modernes** (Vercel AI SDK)
- **Ingestion de documents** (images, PDFs, GitHub)
- **Framework professionnel** (reconnu par les recruteurs)

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Design technique complet |
| [ROADMAP.md](./ROADMAP.md) | Plan d'implémentation par phases |
| [API-SPEC.md](./API-SPEC.md) | Spécification API détaillée |

## Stack Technique

```
Frontend:    Next.js (UI minimaliste sans logique)
Backend:     Fastify + Vercel AI SDK
LLM:         Claude 3.5 Sonnet via @ai-sdk/anthropic
Memory:      Neo4j (ConversationStorage existant)
Embeddings:  Ollama mxbai-embed-large
```

## Pourquoi Vercel AI SDK?

1. **Le plus populaire** en TypeScript (2.8M downloads/semaine)
2. **Reconnu professionnellement** (écosystème Vercel/Next.js)
3. **Native tool calling** avec boucle agent intégrée
4. **Streaming-first** pour une UX fluide
5. **Multi-provider** (peut switch vers OpenAI/Gemini facilement)

## Architecture simplifiée

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Chat UI       │────▶│   POST /chat    │────▶│   Claude 3.5    │
│  (Next.js)      │     │  (Vercel AI)    │     │   + Tools       │
└─────────────────┘     └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 ▼                       ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │  Memory Layer   │     │  Tool Handlers  │
                        │  (L1/L2 sums)   │     │  (search, etc)  │
                        └────────┬────────┘     └────────┬────────┘
                                 │                       │
                                 └───────────┬───────────┘
                                             ▼
                                    ┌─────────────────┐
                                    │     Neo4j       │
                                    │  (port 7688)    │
                                    └─────────────────┘
```

## Quick Start (après implémentation)

```bash
# Démarrer l'API
cd packages/community-docs
npm run api:dev

# Test via curl
curl -X POST http://127.0.0.1:6970/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Bonjour!"}'

# Ouvrir l'UI
open http://127.0.0.1:6970/chat
```

## Prochaines étapes

1. **Installer les dépendances** Vercel AI SDK
2. **Créer le Memory Layer** abstrait
3. **Définir les Tools** format Vercel
4. **Implémenter `/chat`** avec streaming
5. **Créer l'UI** minimale

---

*Voir [ROADMAP.md](./ROADMAP.md) pour le plan détaillé.*
