/**
 * Embedding Provider - Multi-provider support via LlamaIndex
 *
 * DEPRECATED: GeminiEmbeddingProvider is now a legacy alias.
 * Use EmbeddingProvider directly for new code.
 *
 * This provider works with ANY LlamaIndex-supported embedding provider:
 * - Gemini, OpenAI, Anthropic, Cohere, Ollama, Voyage, Jina, HuggingFace, etc.
 */

import { EmbeddingProviderAdapter, type EmbeddingProviderConfig } from '../llm/provider-adapter.js';

/**
 * Modern embedding provider options - supports all LlamaIndex providers
 */
export interface EmbeddingProviderOptions {
  /** Provider name (gemini, openai, cohere, ollama, etc.) */
  provider: string;

  /** Model name (provider-specific) */
  model?: string;

  /** API key (not needed for Ollama) */
  apiKey?: string;

  /** Embedding dimensions (if customizable by the provider) */
  dimensions?: number;

  /** Batch size for processing multiple texts (default: 16) */
  batchSize?: number;

  /** Additional provider-specific options */
  options?: Record<string, any>;
}

/**
 * Universal embedding provider that works with any LlamaIndex provider
 *
 * @example
 * // Gemini
 * const provider = new EmbeddingProvider({
 *   provider: 'gemini',
 *   model: 'text-embedding-004',
 *   apiKey: process.env.GEMINI_API_KEY
 * });
 *
 * @example
 * // OpenAI
 * const provider = new EmbeddingProvider({
 *   provider: 'openai',
 *   model: 'text-embedding-3-small',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   dimensions: 1536
 * });
 *
 * @example
 * // Ollama (local, free)
 * const provider = new EmbeddingProvider({
 *   provider: 'ollama',
 *   model: 'nomic-embed-text'
 * });
 */
export class EmbeddingProvider {
  private adapter: EmbeddingProviderAdapter;
  private batchSize: number;
  private config: EmbeddingProviderConfig;

  constructor(options: EmbeddingProviderOptions) {
    this.config = {
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      dimensions: options.dimensions,
      options: options.options,
    };

    this.adapter = new EmbeddingProviderAdapter(this.config);
    this.batchSize = options.batchSize ?? 16;
  }

  /**
   * Get provider name for logging/debugging
   */
  getProviderName(): string {
    return this.config.provider;
  }

  /**
   * Get model name for logging/debugging
   */
  getModelName(): string | undefined {
    return this.config.model;
  }

  /**
   * Generate embeddings for multiple texts
   *
   * @param texts - Array of texts to embed
   * @param overrides - Optional overrides for model/dimensions
   * @returns Array of embedding vectors
   */
  async embed(
    texts: string[],
    overrides?: { model?: string; dimensions?: number }
  ): Promise<number[][]> {
    // If overrides provided, create a new adapter with updated config
    const effectiveAdapter = overrides
      ? new EmbeddingProviderAdapter({
          ...this.config,
          model: overrides.model || this.config.model,
          dimensions: overrides.dimensions ?? this.config.dimensions,
        })
      : this.adapter;

    // Process in batches
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize);

      try {
        // Use LlamaIndex's batch embedding
        const embeddings = await effectiveAdapter.embedBatch(chunk);
        results.push(...embeddings);
      } catch (error) {
        // Fallback to individual embedding if batch fails
        console.warn(
          `Batch embedding failed for chunk ${i}-${i + chunk.length} with ${this.config.provider}, ` +
          `falling back to individual embedding. Error: ${error}`
        );

        for (const text of chunk) {
          const embedding = await effectiveAdapter.embed(text);
          results.push(embedding);
        }
      }
    }

    return results;
  }

  /**
   * Generate embedding for a single text
   *
   * @param text - Text to embed
   * @param overrides - Optional overrides
   * @returns Embedding vector
   */
  async embedSingle(
    text: string,
    overrides?: { model?: string; dimensions?: number }
  ): Promise<number[]> {
    const embeddings = await this.embed([text], overrides);
    return embeddings[0];
  }
}

/**
 * @deprecated Use EmbeddingProvider instead
 * Legacy alias for backward compatibility with Gemini-only code
 */
export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  dimension?: number;
  batching?: {
    size?: number;
  };
}

/**
 * @deprecated Use EmbeddingProvider instead
 * Legacy class that now delegates to the universal EmbeddingProvider
 *
 * This maintains backward compatibility while using LlamaIndex internally
 */
export class GeminiEmbeddingProvider extends EmbeddingProvider {
  constructor(options: GeminiProviderOptions) {
    super({
      provider: 'gemini',
      model: options.model || 'text-embedding-004',
      apiKey: options.apiKey,
      dimensions: options.dimension,
      batchSize: options.batching?.size ?? 16,
    });
  }

  /**
   * @deprecated Use embed() which now accepts dimensions in overrides
   * Legacy method signature for backward compatibility
   */
  async embed(
    texts: string[],
    overrides?: { model?: string; dimension?: number }
  ): Promise<number[][]> {
    // Convert legacy 'dimension' to 'dimensions'
    const newOverrides = overrides
      ? {
          model: overrides.model,
          dimensions: overrides.dimension,
        }
      : undefined;

    return super.embed(texts, newOverrides);
  }
}
