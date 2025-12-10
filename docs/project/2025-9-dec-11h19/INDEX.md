# Session 2025-12-09 11h19 - Embeddings et Résumés de Conversation

## Documents

1. **[RETRY-ABSTRACTION.md](./RETRY-ABSTRACTION.md)**
   - Abstraction de la logique retry avec backoff exponentiel
   - Migration de l'implémentation inline vers un utilitaire réutilisable
   - Configurations recommandées par cas d'usage

2. **[EMBEDDING-ARCHITECTURE.md](./EMBEDDING-ARCHITECTURE.md)**
   - Architecture complète de génération d'embeddings ET résumés
   - `ConversationLock` - lock avec **opérations nommées + hash** (pas un simple compteur)
   - `ConversationBackgroundService` - orchestration de toutes les opérations post-réponse
   - Diagrammes de flux et séquence détaillés

3. **[BRAIN-SEARCH-WATCHER-FIX.md](./BRAIN-SEARCH-WATCHER-FIX.md)**
   - Fix: `brain_search` doit passer par le watcher, pas juste vérifier le lock
   - Démarrer automatiquement le watcher si pas actif
   - Forcer `flush()` de la queue avant la recherche
   - Limiter au projet spécifié si `projects` est passé

## Décisions clés

### Stratégie de lock

| Opération | Lock ? | Raison |
|-----------|--------|--------|
| **Turn Embedding (L0)** | ✅ Oui | Critique pour recherche sémantique |
| **Résumé L1** | ✅ Oui | Critique pour contexte condensé |
| **Embedding L1** | ❌ Non | Chainé après L1, dans le même lock |
| **Résumé L2** | ❌ Non | Moins critique, fire-and-forget |
| **Embedding L2** | ❌ Non | Chainé après L2, fire-and-forget |

### UUIDs déterministes

Le **hash du contenu** sert à la fois pour :
1. **Clé du lock** - identifier l'opération en cours
2. **UUID du résumé** - `{type}-{hash}-{date}` (ex: `l1-summary-a1b2c3d4e5f6-20251209`)

Avantages :
- **Idempotence** - re-générer = UPSERT au lieu de INSERT (pas de doublons)
- **Traçabilité** - hash dans les logs = hash dans l'UUID en DB
- **Debug** - retrouver facilement un résumé depuis les logs

### Flux simplifié

```
Agent Response
     │
     ├─────────────┬─────────────┬─────────────┐
     │             │             │             │
     ▼             ▼             ▼             ▼
  Réponse      L0 Embed      L1 Check      L2 Check
  à user       🔒 LOCK       (seuil?)      (seuil?)
                  │             │             │
                  │            OUI           OUI
                  │             │             │
                  │             ▼             ▼
                  │          L1 Résumé     L2 Résumé
                  │          🔒 LOCK       (no lock)
                  │             │             │
                  │             ▼             ▼
                  │          L1 Embed     L2 Embed
                  │          (chainé)     (chainé)
                  │             │
                  ▼             ▼
              RELEASE LOCK (quand L0 + L1 terminés)
                       │
User Message #2 ──────>│
                       │
              WAIT (si lock actif)
                       │
              Context Retrieval (L0+L1 prêts)
```

### Seuils de déclenchement

```typescript
{
  l1Threshold: 8000,      // Déclenche L1 après 8000 chars de conversation
  l2Threshold: 15000,     // Déclenche L2 après 15000 chars de résumés L1
  criticalTimeout: 120000 // 2 minutes max d'attente
}
```

## Fichiers à créer/modifier

### Nouveaux fichiers

| Fichier | Description |
|---------|-------------|
| `packages/core/src/runtime/utils/retry.ts` | Abstraction retry générique |
| `packages/core/src/runtime/conversation/conversation-lock.ts` | Lock multi-compteur |
| `packages/core/src/runtime/conversation/background-service.ts` | Orchestration post-réponse |

### Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `packages/core/src/runtime/embedding/embedding-provider.ts` | Utiliser l'abstraction retry |
| `packages/core/src/runtime/agents/rag-agent.ts` | Intégrer le BackgroundService |
| `packages/core/src/runtime/conversation/storage.ts` | Ajouter `getUnsummarizedTurns`, `getUnaggregatedL1Summaries`, `upsertSummary` |
| `packages/core/src/runtime/index.ts` | Exports |

## Contexte

Cette session fait suite à la roadmap [EMBEDDING-GENERATION.md](../EMBEDDING-GENERATION.md) qui définit la structure des embeddings pour les conversations (L0, L1, L2).

**Évolution de la stratégie** :
- ~~Lazy~~ → Génération **parallèle** après chaque réponse
- Lock avec **opérations nommées + hash** pour traçabilité et debug
- L2 est **fire-and-forget** (non-critique)
