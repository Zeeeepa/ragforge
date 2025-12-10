# Abstraction Retry avec Backoff Exponentiel

Date: 2025-12-09

## Contexte

La logique de retry avec backoff exponentiel existe actuellement **inline** dans `GeminiEmbeddingProvider.embed()` (`packages/core/src/runtime/embedding/embedding-provider.ts:63-89`).

### Problèmes de l'implémentation actuelle

1. **Non réutilisable** - définie inline, pas accessible ailleurs
2. **Spécifique aux embeddings** - détecte seulement les erreurs Gemini embedding
3. **Non configurable** - paramètres hardcodés (5 retries, 60s base delay)

## Proposition d'abstraction

### Fichier: `packages/core/src/runtime/utils/retry.ts`

```typescript
/**
 * Retry Utilities
 *
 * Generic retry logic with exponential backoff for API calls.
 * Used by:
 * - GeminiEmbeddingProvider (embeddings)
 * - ConversationStorage (conversation embeddings)
 * - Any future API integration
 */

export interface RetryOptions {
  /** Max retry attempts (default: 5) */
  maxRetries?: number;
  /** Base delay in ms (default: 60000 = 1 minute) */
  baseDelay?: number;
  /** Exponential backoff factor (default: 1.5) */
  backoffFactor?: number;
  /** Max jitter in ms to avoid thundering herd (default: 10000) */
  maxJitter?: number;
  /** Custom error classifier - returns true if error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Callback on retry (for logging) */
  onRetry?: (attempt: number, delay: number, error: Error) => void;
}

/**
 * Default classifier for Gemini API rate limits
 */
export function isGeminiRateLimitError(error: Error): boolean {
  const msg = error.message || '';
  return (
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('quota') ||
    msg.includes('RESOURCE_EXHAUSTED')
  );
}

/**
 * Generic classifier for network/transient errors
 */
export function isTransientError(error: Error): boolean {
  const msg = error.message || '';
  return (
    isGeminiRateLimitError(error) ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('timeout')
  );
}

/**
 * Generic retry with exponential backoff
 *
 * @example
 * // Basic usage with defaults
 * const result = await retryWithBackoff(() => apiCall());
 *
 * @example
 * // Custom configuration
 * const result = await retryWithBackoff(
 *   () => embeddingProvider.embedSingle(text),
 *   {
 *     maxRetries: 3,
 *     baseDelay: 30000,
 *     isRetryable: isGeminiRateLimitError,
 *     onRetry: (attempt, delay) => console.log(`Retry ${attempt}...`),
 *   }
 * );
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 5,
    baseDelay = 60000,
    backoffFactor = 1.5,
    maxJitter = 10000,
    isRetryable = isGeminiRateLimitError,
    onRetry,
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const shouldRetry = attempt < maxRetries && isRetryable(error);

      if (shouldRetry) {
        // Add jitter to avoid thundering herd
        const jitter = Math.random() * maxJitter;
        const delay = baseDelay * Math.pow(backoffFactor, attempt) + jitter;

        onRetry?.(attempt + 1, delay, error);

        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }

  throw new Error('Max retries exceeded');
}
```

## Migration de `GeminiEmbeddingProvider`

### Avant (inline)

```typescript
// Dans embed() - lignes 63-89
const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelay = 60000
): Promise<T> => {
  // ... logique inline
};
```

### Après (import)

```typescript
import { retryWithBackoff, isGeminiRateLimitError } from '../utils/retry.js';

// Dans embed()
const response = await retryWithBackoff(
  () => this.client.models.embedContent({
    model,
    contents: batch.map(text => ({ parts: [{ text }] })),
    config: dimension ? { outputDimensionality: dimension } : undefined,
  }),
  {
    isRetryable: isGeminiRateLimitError,
    onRetry: (attempt, delay) => {
      console.warn(
        `[Embedding] Rate limited, retrying in ${Math.round(delay / 1000)}s ` +
        `(attempt ${attempt}/${5})...`
      );
    },
  }
);
```

## Utilisation pour les Conversations

Pour la génération d'embeddings de conversations (voir `EMBEDDING-ARCHITECTURE.md`):

```typescript
import { retryWithBackoff, isGeminiRateLimitError } from '../utils/retry.js';

async function generateConversationEmbedding(
  embeddingProvider: GeminiEmbeddingProvider,
  text: string
): Promise<number[]> {
  return retryWithBackoff(
    () => embeddingProvider.embedSingle(text),
    {
      maxRetries: 3,        // Moins de retries pour les conversations
      baseDelay: 30000,     // 30s base delay (plus agressif)
      backoffFactor: 2,     // Double à chaque retry
      onRetry: (attempt, delay, error) => {
        console.warn(
          `[ConversationEmbedding] Rate limited, retry ${attempt} in ${Math.round(delay / 1000)}s`
        );
      },
    }
  );
}
```

## Configurations recommandées

### Embeddings de code (ingestion)

```typescript
{
  maxRetries: 5,
  baseDelay: 60000,      // 1 minute (Gemini rate limits are per-minute)
  backoffFactor: 1.5,
  maxJitter: 10000,
}
```

### Embeddings de conversations (temps réel)

```typescript
{
  maxRetries: 3,
  baseDelay: 30000,      // 30s (plus rapide pour UX)
  backoffFactor: 2,
  maxJitter: 5000,
}
```

### Appels LLM (génération de résumés)

```typescript
{
  maxRetries: 3,
  baseDelay: 10000,      // 10s
  backoffFactor: 2,
  isRetryable: isTransientError,  // Inclut plus d'erreurs réseau
}
```

## Export depuis le package

Ajouter dans `packages/core/src/runtime/utils/index.ts`:

```typescript
export {
  retryWithBackoff,
  isGeminiRateLimitError,
  isTransientError,
  type RetryOptions
} from './retry.js';
```

Et dans `packages/core/src/runtime/index.ts`:

```typescript
export * from './utils/retry.js';
```
