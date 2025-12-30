/**
 * Ollama Embedding Provider
 *
 * Uses Ollama's local API for embeddings - free and private.
 * Requires Ollama to be running locally with an embedding model pulled.
 *
 * Recommended models:
 * - nomic-embed-text (768 dimensions, good quality)
 * - mxbai-embed-large (1024 dimensions, better quality)
 * - all-minilm (384 dimensions, fast)
 */

import pLimit from 'p-limit';

export interface OllamaProviderOptions {
  /** Ollama API base URL (default: http://localhost:11434) */
  baseUrl?: string;
  /** Model name (default: nomic-embed-text) */
  model?: string;
  /** Batch size for parallel requests (default: 10) */
  batchSize?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export class OllamaEmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private batchSize: number;
  private timeout: number;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'nomic-embed-text';
    this.batchSize = options.batchSize ?? 10;
    this.timeout = options.timeout ?? 30000;
  }

  getProviderName(): string {
    return 'ollama';
  }

  getModelName(): string {
    return this.model;
  }

  /**
   * Generate embedding for a single text
   */
  private async embedOne(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${error}`);
      }

      const data = (await response.json()) as { embedding: number[] };
      return data.embedding;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate embeddings for multiple texts
   * Ollama doesn't support batch embeddings natively, so we parallelize single requests
   */
  async embed(
    texts: string[],
    overrides?: { model?: string }
  ): Promise<number[][]> {
    const originalModel = this.model;
    if (overrides?.model) {
      this.model = overrides.model;
    }

    try {
      const batches: string[][] = [];
      for (let i = 0; i < texts.length; i += this.batchSize) {
        batches.push(texts.slice(i, i + this.batchSize));
      }

      console.log(`[Embedding:Ollama] ${texts.length} texts → ${batches.length} batches (model: ${this.model})`);
      const startTime = Date.now();

      const limit = pLimit(this.batchSize); // Parallelize within batch size

      const allEmbeddings: number[][] = [];

      for (let batchNum = 0; batchNum < batches.length; batchNum++) {
        const batch = batches[batchNum];
        const batchStart = Date.now();

        const batchEmbeddings = await Promise.all(
          batch.map(text => limit(() => this.embedOne(text)))
        );

        allEmbeddings.push(...batchEmbeddings);
        console.log(`[Embedding:Ollama] Batch ${batchNum + 1}/${batches.length}: ${batch.length} texts in ${Date.now() - batchStart}ms`);
      }

      console.log(`[Embedding:Ollama] Total: ${allEmbeddings.length} embeddings in ${Date.now() - startTime}ms`);
      return allEmbeddings;
    } finally {
      this.model = originalModel;
    }
  }

  async embedSingle(text: string, overrides?: { model?: string }): Promise<number[]> {
    const originalModel = this.model;
    if (overrides?.model) {
      this.model = overrides.model;
    }

    try {
      return await this.embedOne(text);
    } finally {
      this.model = originalModel;
    }
  }

  /**
   * Check if Ollama is running and the model is available
   */
  async checkHealth(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Check if Ollama is running
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { ok: false, error: `Ollama not responding: ${response.status}` };
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models || [];
      const modelNames = models.map(m => m.name.split(':')[0]);

      if (!modelNames.includes(this.model.split(':')[0])) {
        return {
          ok: false,
          error: `Model '${this.model}' not found. Available: ${modelNames.join(', ')}. Run: ollama pull ${this.model}`,
        };
      }

      return { ok: true };
    } catch (error: any) {
      return {
        ok: false,
        error: `Cannot connect to Ollama at ${this.baseUrl}: ${error.message}`,
      };
    }
  }
}
