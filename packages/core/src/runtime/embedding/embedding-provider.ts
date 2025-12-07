/**
 * Embedding Provider - Native Gemini implementation
 *
 * Uses @google/genai directly instead of LlamaIndex for simpler dependencies.
 *
 * To restore multi-provider support via LlamaIndex, see embedding-provider.llamaindex.ts.bak
 */

import { GoogleGenAI } from '@google/genai';
import pLimit from 'p-limit';

/**
 * Gemini embedding provider options
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
 * Native Gemini Embedding Provider using @google/genai
 *
 * @example
 * const provider = new GeminiEmbeddingProvider({
 *   apiKey: process.env.GEMINI_API_KEY!,
 *   model: 'text-embedding-004',
 *   dimension: 768
 * });
 *
 * const embeddings = await provider.embed(['hello world', 'foo bar']);
 */
export class GeminiEmbeddingProvider {
  private client: GoogleGenAI;
  private model: string;
  private dimension?: number;
  private batchSize: number;

  constructor(options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    // Use gemini-embedding-001 (3072 dims native) - replaces deprecated text-embedding-004/005
    this.model = options.model || 'gemini-embedding-001';
    this.dimension = options.dimension; // undefined = use native 3072 dims for best quality
    this.batchSize = options.batching?.size ?? 100; // Gemini supports up to 100 texts per batch
  }

  /**
   * Get provider name for logging
   */
  getProviderName(): string {
    return 'gemini';
  }

  /**
   * Get model name for logging
   */
  getModelName(): string {
    return this.model;
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embed(
    texts: string[],
    overrides?: { model?: string; dimension?: number }
  ): Promise<number[][]> {
    const model = overrides?.model || this.model;
    const dimension = overrides?.dimension ?? this.dimension;

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push(texts.slice(i, i + this.batchSize));
    }

    console.log(`[Embedding] ${texts.length} texts → ${batches.length} batches`);
    const startTime = Date.now();

    // Limit concurrency to avoid rate limits (5 parallel requests)
    const limit = pLimit(5);

    // Helper: retry with exponential backoff
    const retryWithBackoff = async <T>(
      fn: () => Promise<T>,
      maxRetries = 3,
      baseDelay = 1000
    ): Promise<T> => {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (error: any) {
          const isRateLimit = error.message?.includes('429') || error.message?.includes('rate');
          if (attempt < maxRetries && isRateLimit) {
            const delay = baseDelay * Math.pow(2, attempt);
            console.warn(`[Embedding] Rate limited, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
          } else {
            throw error;
          }
        }
      }
      throw new Error('Max retries exceeded');
    };

    // Process batches with limited concurrency
    const batchResults = await Promise.all(
      batches.map((batch, batchNum) =>
        limit(async () => {
          const batchStart = Date.now();
          try {
            const response = await retryWithBackoff(() =>
              this.client.models.embedContent({
                model,
                contents: batch.map(text => ({ parts: [{ text }] })),
                config: dimension ? { outputDimensionality: dimension } : undefined,
              })
            );

            const embeddings: number[][] = [];
            if (response.embeddings) {
              for (const embedding of response.embeddings) {
                if (embedding.values) {
                  embeddings.push(embedding.values);
                }
              }
            }
            console.log(`[Embedding] Batch ${batchNum + 1}/${batches.length}: ${batch.length} texts in ${Date.now() - batchStart}ms`);
            return embeddings;
          } catch (error: any) {
            console.warn(`[Embedding] Batch ${batchNum + 1} failed: ${error.message}`);
            return []; // Return empty instead of crashing
          }
        })
      )
    );

    // Flatten results maintaining order
    const results = batchResults.flat();
    console.log(`[Embedding] Total: ${results.length} embeddings in ${Date.now() - startTime}ms`);

    return results;
  }

  /**
   * Generate embedding for a single text
   */
  async embedSingle(text: string, overrides?: { model?: string; dimension?: number }): Promise<number[]> {
    const embeddings = await this.embed([text], overrides);
    return embeddings[0];
  }
}

// Legacy exports for compatibility
export type EmbeddingProviderOptions = GeminiProviderOptions;
export const EmbeddingProvider = GeminiEmbeddingProvider;
export type EmbeddingProviderType = GeminiEmbeddingProvider;
