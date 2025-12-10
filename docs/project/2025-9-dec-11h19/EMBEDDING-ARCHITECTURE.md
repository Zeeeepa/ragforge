# Architecture des Embeddings et Résumés de Conversation

Date: 2025-12-09

## Vue d'ensemble

Après chaque réponse de l'agent, plusieurs opérations sont lancées **en parallèle** :

| Opération | Lock ? | Bloque le prochain appel ? |
|-----------|--------|----------------------------|
| **Embedding du Turn (L0)** | ✅ Oui | ✅ Oui |
| **Résumé L1** (si seuil atteint) | ✅ Oui | ✅ Oui |
| **Embedding du Résumé L1** | ❌ Non | ❌ Non (fait après le résumé) |
| **Résumé L2** (si seuil atteint) | ❌ Non | ❌ Non |
| **Embedding du Résumé L2** | ❌ Non | ❌ Non |

**Règle clé** : Seuls les **Turn embeddings** et les **Résumés L1** activent le lock. Les L2 sont fire-and-forget.

## Diagramme de flux complet

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      FLUX POST-RÉPONSE DE L'AGENT                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Agent Response                                                              │
│       │                                                                      │
│       ├─────────────────────┬─────────────────────┬─────────────────────┐   │
│       │                     │                     │                     │   │
│       ▼                     ▼                     ▼                     ▼   │
│  ┌─────────┐          ┌───────────┐         ┌───────────┐         ┌───────┐│
│  │ Réponse │          │ Turn      │         │ L1 Check  │         │ L2    ││
│  │ à user  │          │ Embedding │         │ (seuil?)  │         │ Check ││
│  └─────────┘          │ 🔒 LOCK   │         └─────┬─────┘         └───┬───┘│
│                       └─────┬─────┘               │                   │    │
│                             │                     │                   │    │
│                             │               ┌─────▼─────┐       ┌─────▼───┐│
│                             │               │ Seuil     │       │ Seuil   ││
│                             │               │ atteint?  │       │ atteint?││
│                             │               └─────┬─────┘       └────┬────┘│
│                             │                     │                  │     │
│                             │            ┌────────┴────────┐         │     │
│                             │            │                 │         │     │
│                             │           OUI               NON        │     │
│                             │            │                 │         │     │
│                             │            ▼                 │         │     │
│                             │      ┌───────────┐           │         │     │
│                             │      │ Résumé L1 │           │        OUI    │
│                             │      │ 🔒 LOCK   │           │         │     │
│                             │      └─────┬─────┘           │         │     │
│                             │            │                 │         ▼     │
│                             │            ▼                 │   ┌───────────┐│
│                             │      ┌───────────┐           │   │ Résumé L2 ││
│                             │      │ L1 Embed  │           │   │ (no lock) ││
│                             │      │ (no lock) │           │   └─────┬─────┘│
│                             │      └─────┬─────┘           │         │     │
│                             │            │                 │         ▼     │
│                             │            │                 │   ┌───────────┐│
│                             │            │                 │   │ L2 Embed  ││
│                             │            │                 │   │ (no lock) ││
│                             │            │                 │   └───────────┘│
│                             │            │                 │                │
│                             ▼            ▼                 │                │
│                       ┌─────────────────────┐              │                │
│                       │   RELEASE LOCK      │              │                │
│                       │   (quand L0 + L1    │              │                │
│                       │    terminés)        │              │                │
│                       └─────────────────────┘              │                │
│                                                            │                │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                │
│                                                                              │
│  User Message #2                                                             │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────┐                                                     │
│  │ WAIT: Lock release  │◄─── Bloqué jusqu'à ce que L0 + L1 soient terminés  │
│  └─────────────────────┘                                                     │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────┐                                                     │
│  │ Context Retrieval   │◄─── Embeddings L0 + L1 disponibles                 │
│  │ (avec tout le       │     (L2 peut encore être en cours, pas grave)      │
│  │  contexte à jour)   │                                                     │
│  └─────────────────────┘                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Pourquoi cette stratégie ?

### L0 (Turn Embedding) - LOCK

- **Critique** pour la recherche sémantique du turn précédent
- Doit être prêt avant le prochain appel
- Relativement rapide (un seul embedding)

### L1 (Résumé Short-Term) - LOCK

- **Critique** pour le contexte condensé récent
- Le LLM doit avoir accès aux résumés L1 pour comprendre ce qui s'est passé
- Génération du résumé = appel LLM (peut prendre quelques secondes)
- L'embedding L1 est généré **après** le résumé (chainé, pas en parallèle)

### L2 (Résumé Long-Term) - NO LOCK

- **Moins critique** pour le contexte immédiat
- Représente des patterns sur plusieurs sessions
- Peut être en retard d'un ou deux appels sans impact majeur
- Fire-and-forget pour ne pas ralentir l'expérience

## Implémentation

### 1. ConversationLock (Opérations nommées avec hash)

Le lock utilise un **tableau d'opérations nommées** plutôt qu'un simple compteur :
- Chaque opération a un **nom** (type) et un **hash** (identifiant unique basé sur le contenu)
- Permet de **logger** précisément ce qui bloque
- Garantit qu'on **retire la bonne opération** quand elle se termine
- Évite les bugs de compteur désynchronisé

```typescript
// packages/core/src/runtime/conversation/conversation-lock.ts

import * as crypto from 'crypto';

/**
 * Opération en cours dans le lock
 */
export interface PendingOperation {
  /** Type d'opération (ex: 'l0-embedding', 'l1-summary') */
  type: string;
  /** Hash unique basé sur le contenu à traiter */
  contentHash: string;
  /** Timestamp de début */
  startedAt: Date;
  /** Description lisible pour les logs */
  description: string;
}

/**
 * Génère un hash court depuis les premières lignes du contenu.
 * Utilisé pour :
 * - Identifier de manière unique une opération dans le lock
 * - Générer des UUIDs déterministes pour les résumés (idempotence)
 */
export function hashOperationContent(content: string, maxChars = 200): string {
  const preview = content.substring(0, maxChars);
  return crypto.createHash('sha256').update(preview).digest('hex').substring(0, 12);
}

/**
 * Génère un UUID déterministe basé sur le type et le hash du contenu.
 *
 * Avantages :
 * - Idempotence : re-générer le même résumé = même UUID = UPSERT au lieu de INSERT
 * - Traçabilité : le hash dans les logs correspond à l'UUID en DB
 * - Cohérence : clé du lock = hash dans l'UUID
 *
 * Format: {type}-{contentHash}-{timestamp_day}
 * Le timestamp_day permet de différencier des résumés similaires sur plusieurs jours
 */
export function generateDeterministicUuid(
  type: 'l1-summary' | 'l2-summary' | 'l0-embedding',
  contentHash: string,
  timestamp?: Date
): string {
  const date = timestamp || new Date();
  // Jour uniquement (pas heure) pour regrouper les résumés d'une même journée
  const dayStamp = date.toISOString().split('T')[0].replace(/-/g, '');
  return `${type}-${contentHash}-${dayStamp}`;
}

// Exemples d'UUIDs générés :
// - l1-summary-a1b2c3d4e5f6-20251209
// - l2-summary-x9y8z7w6v5u4-20251209
// - l0-embedding-m3n4o5p6q7r8-20251209

/**
 * Lock avec tableau d'opérations nommées.
 *
 * Avantages par rapport à un compteur :
 * - On sait exactement QUELLES opérations bloquent
 * - On peut logger l'état du lock de façon lisible
 * - On retire l'opération par son hash (pas de désync possible)
 * - Debug facile en cas de timeout
 */
export class ConversationLock {
  private pendingOperations: Map<string, PendingOperation> = new Map();
  private resolvers: (() => void)[] = [];

  /**
   * Génère une clé unique pour une opération
   */
  private makeKey(type: string, contentHash: string): string {
    return `${type}:${contentHash}`;
  }

  /**
   * Enregistre une nouvelle opération bloquante.
   *
   * @param type - Type d'opération ('l0-embedding', 'l1-summary', etc.)
   * @param content - Contenu à traiter (utilisé pour générer le hash)
   * @param description - Description lisible pour les logs
   * @returns La clé de l'opération (à passer à release())
   */
  acquire(type: string, content: string, description?: string): string {
    const contentHash = hashOperationContent(content);
    const key = this.makeKey(type, contentHash);

    // Vérifier si déjà en cours (évite les doublons)
    if (this.pendingOperations.has(key)) {
      console.warn(`[ConversationLock] Operation already pending: ${key}`);
      return key;
    }

    const operation: PendingOperation = {
      type,
      contentHash,
      startedAt: new Date(),
      description: description || `${type} (${contentHash})`,
    };

    this.pendingOperations.set(key, operation);

    console.log(
      `[ConversationLock] Acquired: ${operation.description} ` +
      `(${this.pendingOperations.size} pending)`
    );

    return key;
  }

  /**
   * Libère une opération par sa clé.
   * Le lock global est libéré quand toutes les opérations sont terminées.
   *
   * @param key - Clé retournée par acquire()
   */
  release(key: string): void {
    const operation = this.pendingOperations.get(key);

    if (!operation) {
      console.warn(`[ConversationLock] Trying to release unknown operation: ${key}`);
      return;
    }

    const duration = Date.now() - operation.startedAt.getTime();
    this.pendingOperations.delete(key);

    console.log(
      `[ConversationLock] Released: ${operation.description} ` +
      `(${duration}ms, ${this.pendingOperations.size} remaining)`
    );

    // Si plus d'opérations, libérer tous les waiters
    if (this.pendingOperations.size === 0) {
      console.log('[ConversationLock] All operations complete, releasing waiters');
      for (const resolve of this.resolvers) {
        resolve();
      }
      this.resolvers = [];
    }
  }

  /**
   * Attend que toutes les opérations bloquantes soient terminées.
   */
  async waitForCompletion(): Promise<void> {
    if (this.pendingOperations.size === 0) {
      return;
    }

    return new Promise<void>(resolve => {
      this.resolvers.push(resolve);
    });
  }

  /**
   * Vérifie si des opérations sont en cours
   */
  isLocked(): boolean {
    return this.pendingOperations.size > 0;
  }

  /**
   * Nombre d'opérations en cours
   */
  getPendingCount(): number {
    return this.pendingOperations.size;
  }

  /**
   * Liste des opérations en cours (pour debug/logging)
   */
  getPendingOperations(): PendingOperation[] {
    return Array.from(this.pendingOperations.values());
  }

  /**
   * Description lisible de l'état du lock (pour logs)
   */
  getStatusDescription(): string {
    if (this.pendingOperations.size === 0) {
      return 'No pending operations';
    }

    const ops = this.getPendingOperations();
    const descriptions = ops.map(op => {
      const elapsed = Date.now() - op.startedAt.getTime();
      return `  - ${op.description} (${elapsed}ms)`;
    });

    return `${ops.length} pending operations:\n${descriptions.join('\n')}`;
  }
}
```

### Exemple de logs

```
[ConversationLock] Acquired: l0-embedding (a1b2c3d4e5f6) (1 pending)
[ConversationLock] Acquired: l1-summary (x9y8z7w6v5u4) (2 pending)
[ConversationLock] Released: l0-embedding (a1b2c3d4e5f6) (1523ms, 1 remaining)
[ConversationLock] Released: l1-summary (x9y8z7w6v5u4) (3201ms, 0 remaining)
[ConversationLock] All operations complete, releasing waiters
```

### En cas de timeout

```typescript
async waitForCriticalOperations(timeout = 120000): Promise<void> {
  if (!this.lock.isLocked()) {
    return;
  }

  console.log(`[BackgroundService] Waiting for critical operations...`);
  console.log(this.lock.getStatusDescription());

  const timeoutPromise = new Promise<void>((_, reject) => {
    setTimeout(() => reject(new Error('Critical operations timeout')), timeout);
  });

  try {
    await Promise.race([
      this.lock.waitForCompletion(),
      timeoutPromise
    ]);
  } catch (error) {
    // Log détaillé de ce qui bloque
    console.warn('[BackgroundService] Timeout! Still pending:');
    console.warn(this.lock.getStatusDescription());
    // Continuer quand même
  }
}
```

### 2. ConversationBackgroundService

```typescript
// packages/core/src/runtime/conversation/background-service.ts

import { ConversationLock } from './conversation-lock.js';
import { ConversationSummarizer } from './summarizer.js';
import { GeminiEmbeddingProvider } from '../embedding/embedding-provider.js';
import { retryWithBackoff, isGeminiRateLimitError } from '../utils/retry.js';
import type { ConversationStorage } from './storage.js';
import type { ConversationTurn, Summary } from './types.js';

export interface BackgroundServiceOptions {
  storage: ConversationStorage;
  summarizer: ConversationSummarizer;
  embeddingProvider: GeminiEmbeddingProvider;
  /** Seuil en caractères pour déclencher L1 (default: 8000) */
  l1Threshold?: number;
  /** Seuil en caractères de résumés L1 pour déclencher L2 (default: 15000) */
  l2Threshold?: number;
  /** Max text length pour embeddings (default: 4000) */
  maxTextLength?: number;
}

/**
 * Service qui gère toutes les opérations en arrière-plan après une réponse.
 */
export class ConversationBackgroundService {
  private lock = new ConversationLock();
  private storage: ConversationStorage;
  private summarizer: ConversationSummarizer;
  private embeddingProvider: GeminiEmbeddingProvider;
  private l1Threshold: number;
  private l2Threshold: number;
  private maxTextLength: number;

  constructor(options: BackgroundServiceOptions) {
    this.storage = options.storage;
    this.summarizer = options.summarizer;
    this.embeddingProvider = options.embeddingProvider;
    this.l1Threshold = options.l1Threshold ?? 8000;
    this.l2Threshold = options.l2Threshold ?? 15000;
    this.maxTextLength = options.maxTextLength ?? 4000;
  }

  /**
   * Lance toutes les opérations post-réponse en parallèle.
   * Ne pas await - c'est fire-and-forget du point de vue de l'appelant.
   */
  async processPostResponse(
    conversationId: string,
    turn: ConversationTurn,
    conversationStats: { totalChars: number; l1CharsAccumulated: number }
  ): Promise<void> {
    // Lancer les opérations en parallèle
    const operations: Promise<void>[] = [];

    // 1. Turn Embedding (L0) - AVEC LOCK
    operations.push(this.generateTurnEmbeddingWithLock(turn));

    // 2. Vérifier si L1 nécessaire - AVEC LOCK
    if (conversationStats.totalChars >= this.l1Threshold) {
      operations.push(this.generateL1SummaryWithLock(conversationId));
    }

    // 3. Vérifier si L2 nécessaire - SANS LOCK
    if (conversationStats.l1CharsAccumulated >= this.l2Threshold) {
      operations.push(this.generateL2SummaryNoLock(conversationId));
    }

    // Attendre toutes les opérations (pour logging/errors)
    await Promise.allSettled(operations);
  }

  /**
   * Attend que les opérations bloquantes soient terminées.
   * À appeler AVANT la prise de contexte du prochain appel.
   */
  async waitForCriticalOperations(timeout = 120000): Promise<void> {
    if (!this.lock.isLocked()) {
      return;
    }

    console.log(`[BackgroundService] Waiting for critical operations...`);
    console.log(this.lock.getStatusDescription());

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Critical operations timeout')), timeout);
    });

    try {
      await Promise.race([
        this.lock.waitForCompletion(),
        timeoutPromise
      ]);
      console.log('[BackgroundService] Critical operations complete');
    } catch (error) {
      // Log détaillé de ce qui bloque encore
      console.warn('[BackgroundService] Timeout! Still pending:');
      console.warn(this.lock.getStatusDescription());
      // Continuer quand même - mieux vaut un contexte incomplet que bloquer l'agent
    }
  }

  // ============================================
  // Opérations AVEC lock (bloquantes)
  // ============================================

  /**
   * Génère l'embedding du turn - AVEC LOCK
   */
  private async generateTurnEmbeddingWithLock(turn: ConversationTurn): Promise<void> {
    const embeddingText = this.generateTurnEmbeddingText(turn);

    if (!embeddingText || embeddingText.length < 10) {
      console.warn('[BackgroundService] Turn text too short, skipping embedding');
      return;
    }

    // Acquérir le lock avec le contenu (pour hash unique)
    const lockKey = this.lock.acquire(
      'l0-embedding',
      embeddingText,
      `L0 embedding for turn ${turn.messageUuid?.substring(0, 8) || 'unknown'}`
    );

    try {
      const truncated = this.truncateText(embeddingText);

      const embedding = await retryWithBackoff(
        () => this.embeddingProvider.embedSingle(truncated),
        {
          maxRetries: 3,
          baseDelay: 30000,
          backoffFactor: 2,
          isRetryable: isGeminiRateLimitError,
          onRetry: (attempt, delay) => {
            console.warn(`[BackgroundService] Turn embedding retry ${attempt} in ${Math.round(delay / 1000)}s`);
          },
        }
      );

      await this.storage.updateMessageEmbedding(turn.messageUuid, embedding);
      console.log(`[BackgroundService] Turn embedding generated (${embedding.length} dims)`);
    } catch (error) {
      console.error('[BackgroundService] Turn embedding failed:', error);
    } finally {
      // Libérer avec la clé exacte
      this.lock.release(lockKey);
    }
  }

  /**
   * Génère un résumé L1 - AVEC LOCK
   * L'embedding L1 est généré APRÈS le résumé (chainé, dans le même lock)
   */
  private async generateL1SummaryWithLock(conversationId: string): Promise<void> {
    // 1. Récupérer les turns non résumés AVANT d'acquérir le lock
    //    (pour avoir le contenu à hasher)
    const unsummarizedTurns = await this.storage.getUnsummarizedTurns(conversationId);

    if (unsummarizedTurns.length === 0) {
      console.log('[BackgroundService] No turns to summarize');
      return;
    }

    // Construire un aperçu du contenu pour le hash
    const contentPreview = unsummarizedTurns
      .map(t => t.userMessage?.substring(0, 50) || '')
      .join(' | ');

    // Générer le hash (utilisé pour lock ET uuid)
    const contentHash = hashOperationContent(contentPreview);

    // Acquérir le lock
    const lockKey = this.lock.acquire(
      'l1-summary',
      contentPreview,
      `L1 summary for ${unsummarizedTurns.length} turns`
    );

    try {
      console.log('[BackgroundService] Generating L1 summary...');

      // 2. Générer le résumé L1 via LLM
      const summaryContent = await this.summarizer.summarizeTurns(unsummarizedTurns);

      // 3. Générer UUID déterministe (même hash que le lock)
      const summaryUuid = generateDeterministicUuid('l1-summary', contentHash);

      // 4. Stocker le résumé L1 avec UPSERT (idempotent)
      const summary = await this.storage.upsertSummary({
        uuid: summaryUuid,  // UUID déterministe basé sur le contenu
        conversation_id: conversationId,
        level: 1,
        content: summaryContent,
        created_at: new Date(),
      });

      console.log(`[BackgroundService] L1 summary stored: ${summary.uuid}`);

      // 5. Générer l'embedding du L1 (chainé, toujours dans le lock)
      await this.generateSummaryEmbedding(summary);

      console.log('[BackgroundService] L1 summary + embedding complete');
    } catch (error) {
      console.error('[BackgroundService] L1 summary failed:', error);
    } finally {
      this.lock.release(lockKey);
    }
  }

  // ============================================
  // Opérations SANS lock (fire-and-forget)
  // ============================================

  /**
   * Génère un résumé L2 - SANS LOCK
   * Fire-and-forget, ne bloque pas le prochain appel
   */
  private async generateL2SummaryNoLock(conversationId: string): Promise<void> {
    try {
      console.log('[BackgroundService] Generating L2 summary (background)...');

      // 1. Récupérer les résumés L1 non agrégés
      const l1Summaries = await this.storage.getUnaggregatedL1Summaries(conversationId);

      if (l1Summaries.length < 2) {
        console.log('[BackgroundService] Not enough L1 summaries for L2');
        return;
      }

      // 2. Construire un aperçu pour le hash (UUIDs des L1 parents)
      const contentPreview = l1Summaries.map(s => s.uuid).join('|');
      const contentHash = hashOperationContent(contentPreview);

      // 3. Générer le résumé L2 via LLM
      const summaryContent = await this.summarizer.summarizeL1Summaries(l1Summaries);

      // 4. Générer UUID déterministe
      const summaryUuid = generateDeterministicUuid('l2-summary', contentHash);

      // 5. Stocker le résumé L2 avec UPSERT (idempotent)
      const summary = await this.storage.upsertSummary({
        uuid: summaryUuid,  // UUID déterministe basé sur les L1 parents
        conversation_id: conversationId,
        level: 2,
        content: summaryContent,
        created_at: new Date(),
        parent_summaries: l1Summaries.map(s => s.uuid),
      });

      console.log(`[BackgroundService] L2 summary stored: ${summary.uuid}`);

      // 6. Générer l'embedding du L2 (toujours sans lock)
      await this.generateSummaryEmbedding(summary);

      console.log('[BackgroundService] L2 summary + embedding complete (background)');
    } catch (error) {
      console.error('[BackgroundService] L2 summary failed:', error);
      // Pas grave - L2 est non-critique
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private async generateSummaryEmbedding(summary: Summary): Promise<void> {
    const embeddingText = this.generateSummaryEmbeddingText(summary);

    if (!embeddingText || embeddingText.length < 10) {
      return;
    }

    const truncated = this.truncateText(embeddingText);

    const embedding = await retryWithBackoff(
      () => this.embeddingProvider.embedSingle(truncated),
      {
        maxRetries: 3,
        baseDelay: 30000,
        backoffFactor: 2,
        isRetryable: isGeminiRateLimitError,
      }
    );

    await this.storage.updateSummaryEmbedding(summary.uuid, embedding);
  }

  private generateTurnEmbeddingText(turn: ConversationTurn): string {
    const parts: string[] = [];

    if (turn.userMessage) {
      parts.push(`User: ${turn.userMessage}`);
    }

    if (turn.assistantMessage) {
      parts.push(`Assistant: ${turn.assistantMessage}`);
    }

    if (turn.toolResults && turn.toolResults.length > 0) {
      parts.push('Tools used:');
      for (const tool of turn.toolResults) {
        const resultStr = typeof tool.toolResult === 'string'
          ? tool.toolResult.substring(0, 200)
          : JSON.stringify(tool.toolResult).substring(0, 200);
        parts.push(`- ${tool.toolName}: ${resultStr}`);
      }
    }

    return parts.join('\n');
  }

  private generateSummaryEmbeddingText(summary: Summary): string {
    const parts: string[] = [];

    parts.push(summary.content.conversation_summary);

    if (summary.content.actions_summary) {
      parts.push(`Actions: ${summary.content.actions_summary}`);
    }

    if (summary.content.filesMentioned?.length > 0) {
      parts.push(`Files: ${summary.content.filesMentioned.join(', ')}`);
    }

    if (summary.content.keyFindings?.length > 0) {
      parts.push(`Findings: ${summary.content.keyFindings.join('; ')}`);
    }

    return parts.join('\n\n');
  }

  private truncateText(text: string): string {
    return text.length > this.maxTextLength
      ? text.substring(0, this.maxTextLength) + '...'
      : text;
  }
}
```

### 3. Intégration dans le RAG Agent

```typescript
// Dans packages/core/src/runtime/agents/rag-agent.ts

class RagAgent {
  private backgroundService: ConversationBackgroundService;
  private conversationStats = { totalChars: 0, l1CharsAccumulated: 0 };

  async processMessage(userMessage: string): Promise<string> {
    // 1. ATTENDRE les opérations critiques du turn précédent (L0 + L1)
    await this.backgroundService.waitForCriticalOperations();

    // 2. Récupérer le contexte (L0 embeddings + L1 résumés disponibles)
    const context = await this.getRAGContext(userMessage);

    // 3. Appeler le LLM
    const response = await this.callLLM(userMessage, context);

    // 4. Stocker le turn
    const turn = await this.storeTurn(userMessage, response);

    // 5. Mettre à jour les stats
    this.conversationStats.totalChars += turn.charCount;

    // 6. LANCER les opérations en arrière-plan (fire-and-forget)
    this.backgroundService.processPostResponse(
      this.conversationId,
      turn,
      this.conversationStats
    ).catch(err => console.error('Background processing failed:', err));

    // 7. Retourner la réponse immédiatement
    return response;
  }
}
```

## Diagramme de séquence détaillé

```
┌──────┐     ┌───────┐     ┌─────────┐     ┌────────────┐     ┌──────┐
│ User │     │ Agent │     │ Storage │     │ Background │     │ LLM  │
│      │     │       │     │         │     │ Service    │     │      │
└──┬───┘     └───┬───┘     └────┬────┘     └─────┬──────┘     └──┬───┘
   │             │              │                │               │
   │ Message #1  │              │                │               │
   │────────────>│              │                │               │
   │             │              │                │               │
   │             │ waitForCritical()             │               │
   │             │─────────────────────────────>│               │
   │             │              │    (no lock)  │               │
   │             │<─────────────────────────────│               │
   │             │              │                │               │
   │             │ getContext() │                │               │
   │             │─────────────>│                │               │
   │             │<─────────────│                │               │
   │             │              │                │               │
   │             │ callLLM()    │                │               │
   │             │──────────────────────────────────────────────>│
   │             │<──────────────────────────────────────────────│
   │             │              │                │               │
   │             │ storeTurn()  │                │               │
   │             │─────────────>│                │               │
   │             │<─────────────│                │               │
   │             │              │                │               │
   │  Response   │              │                │               │
   │<────────────│              │                │               │
   │             │              │                │               │
   │             │ processPostResponse()        │               │
   │             │─────────────────────────────>│               │
   │             │              │                │               │
   │             │              │                │──┐            │
   │             │              │                │  │ acquire()  │
   │             │              │                │  │ L0 embed   │
   │             │              │                │  │            │
   │             │              │                │  │ acquire()  │
   │             │              │                │  │ L1 summary │
   │             │              │                │  │            │
   │             │              │                │  │ L2 summary │
   │             │              │                │  │ (no lock)  │
   │             │              │                │<─┘            │
   │             │              │                │               │
   │ Message #2  │              │                │               │
   │────────────>│              │                │               │
   │             │              │                │               │
   │             │ waitForCritical()             │               │
   │             │─────────────────────────────>│               │
   │             │              │   (BLOCKED)   │               │
   │             │              │   pending=2   │               │
   │             │ . . . . . . .│. . . . . . . .│. . . . . . . .│
   │             │              │                │               │
   │             │              │                │──┐            │
   │             │              │                │  │ L0 done    │
   │             │              │                │  │ release()  │
   │             │              │                │  │ pending=1  │
   │             │              │                │<─┘            │
   │             │              │                │               │
   │             │              │                │──┐            │
   │             │              │                │  │ L1 done    │
   │             │              │                │  │ release()  │
   │             │              │                │  │ pending=0  │
   │             │              │                │<─┘            │
   │             │              │                │               │
   │             │<─────────────────────────────│ (unblock)     │
   │             │              │                │               │
   │             │ getContext() │                │               │
   │             │─────────────>│ (L0+L1 ready) │               │
   │             │<─────────────│                │               │
   │             │              │                │               │
```

## Résumé des seuils

```typescript
const SUMMARIZATION_CONFIG = {
  // L1 - Short Term
  l1Threshold: 8000,           // Déclenche L1 après 8000 chars de conversation
  l1TurnsMin: 3,               // Minimum 3 turns avant de résumer

  // L2 - Long Term
  l2Threshold: 15000,          // Déclenche L2 après 15000 chars de résumés L1
  l2SummariesMin: 2,           // Minimum 2 résumés L1 avant de créer L2

  // Timeouts
  criticalTimeout: 120000,     // 2 minutes max d'attente pour L0+L1
};
```

## Tests

```typescript
describe('ConversationBackgroundService', () => {
  it('should block until L0 and L1 are complete', async () => {
    const service = new ConversationBackgroundService({ ... });

    // Simuler un traitement long
    service.processPostResponse(convId, turn, { totalChars: 10000, l1CharsAccumulated: 0 });

    // Doit bloquer
    const startTime = Date.now();
    await service.waitForCriticalOperations();
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeGreaterThan(100); // A dû attendre L0 + L1
  });

  it('should not block for L2', async () => {
    const service = new ConversationBackgroundService({ ... });

    // Déclencher seulement L2 (L0 et L1 pas nécessaires)
    service.processPostResponse(convId, turn, { totalChars: 100, l1CharsAccumulated: 20000 });

    // Ne doit PAS bloquer pour L2
    const startTime = Date.now();
    await service.waitForCriticalOperations();
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(50); // L2 ne bloque pas
  });

  it('should handle timeout gracefully', async () => {
    const service = new ConversationBackgroundService({ ... });

    // Simuler un blocage infini
    service.processPostResponse(convId, turn, { totalChars: 10000, l1CharsAccumulated: 0 });

    // Timeout court pour le test
    await service.waitForCriticalOperations(100);

    // Doit continuer malgré le timeout
    expect(true).toBe(true);
  });
});
```
