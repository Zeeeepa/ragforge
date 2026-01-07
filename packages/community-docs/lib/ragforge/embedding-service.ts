/**
 * Ollama Embedding Service for Community Docs
 *
 * Uses Ollama locally for generating embeddings.
 * Default model: mxbai-embed-large (1024 dimensions)
 *
 * Features:
 * - Parallel batch embedding with concurrency control
 * - Same approach as ragforge core OllamaEmbeddingProvider
 *
 * @since 2025-01-03
 */

import pLimit from "p-limit";

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
  keepAlive?: string;
  /** Concurrency for parallel embedding requests (default: 10) */
  concurrency?: number;
}

export interface EmbeddingResponse {
  embedding: number[];
}

export class OllamaEmbeddingService {
  private baseUrl: string;
  private model: string;
  private keepAlive: string;
  private concurrency: number;

  constructor(config: OllamaEmbeddingConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.keepAlive = config.keepAlive || "5m";
    this.concurrency = config.concurrency ?? 10;
  }

  /**
   * Check if Ollama is available
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt: text,
        keep_alive: this.keepAlive,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama embedding failed: ${error}`);
    }

    const result = (await response.json()) as EmbeddingResponse;
    return result.embedding;
  }

  /**
   * Generate embeddings for multiple texts (batch)
   * Uses parallel processing with concurrency control for efficiency.
   *
   * @param texts - Array of texts to embed
   * @param options - Optional: verbose logging, custom batch size
   * @returns Array of embeddings in same order as input texts
   */
  async embedBatch(
    texts: string[],
    options?: { verbose?: boolean; batchSize?: number }
  ): Promise<number[][]> {
    const verbose = options?.verbose ?? false;
    const batchSize = options?.batchSize ?? 50;

    if (texts.length === 0) return [];

    const limit = pLimit(this.concurrency);
    const startTime = Date.now();

    if (verbose) {
      console.log(
        `[Embedding:Ollama] ${texts.length} texts, concurrency=${this.concurrency}, model=${this.model}`
      );
    }

    // Process in batches to show progress
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchStart = Date.now();

      const batchEmbeddings = await Promise.all(
        batch.map((text) => limit(() => this.embed(text)))
      );

      allEmbeddings.push(...batchEmbeddings);

      if (verbose) {
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(texts.length / batchSize);
        console.log(
          `[Embedding:Ollama] Batch ${batchNum}/${totalBatches}: ${batch.length} texts in ${Date.now() - batchStart}ms`
        );
      }
    }

    if (verbose) {
      console.log(
        `[Embedding:Ollama] Total: ${allEmbeddings.length} embeddings in ${Date.now() - startTime}ms`
      );
    }

    return allEmbeddings;
  }

  /**
   * Get embedding dimension for current model
   */
  getDimension(): number {
    // mxbai-embed-large: 1024
    // nomic-embed-text: 768
    // all-minilm: 384
    const dimensions: Record<string, number> = {
      "mxbai-embed-large": 1024,
      "nomic-embed-text": 768,
      "all-minilm": 384,
    };

    return dimensions[this.model] || 1024;
  }

  /**
   * Get the current model name
   */
  getModel(): string {
    return this.model;
  }
}
