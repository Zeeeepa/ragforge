/**
 * RagForge API Client for Next.js Routes
 *
 * HTTP client to call the Community API server (port 6970).
 * Used by Next.js API routes to trigger ingestion, search, etc.
 *
 * @since 2025-01-03
 */

import type { CommunityNodeMetadata, SearchFilters, SearchResult, IngestionResult, DocumentChunk } from "./types";

const API_BASE_URL = process.env.RAGFORGE_API_URL || "http://127.0.0.1:6970";

/**
 * API Client for RagForge Community Docs API
 */
export class RagForgeAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Check if the API server is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get API server status
   */
  async getStatus(): Promise<{
    status: string;
    port: number;
    uptime_ms: number;
    request_count: number;
    neo4j: { connected: boolean };
    embedding: { enabled: boolean; provider: string };
  } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/status`, { method: "GET" });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  /**
   * Ingest a single document
   */
  async ingestDocument(params: {
    documentId: string;
    content: string;
    metadata: CommunityNodeMetadata;
    generateEmbeddings?: boolean;
  }): Promise<IngestionResult> {
    const res = await fetch(`${this.baseUrl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        documentId: params.documentId,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      documentId: params.documentId,
      nodeCount: 1,
      embeddingsGenerated: data.embeddingGenerated ? 1 : 0,
    };
  }

  /**
   * Ingest document chunks
   */
  async ingestChunks(params: {
    documentId: string;
    chunks: DocumentChunk[];
    documentMetadata: CommunityNodeMetadata;
    generateEmbeddings?: boolean;
  }): Promise<IngestionResult> {
    const res = await fetch(`${this.baseUrl}/ingest/chunks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: params.documentId,
        chunks: params.chunks.map((c) => ({
          chunkId: c.chunkId,
          content: c.content,
          position: c.position,
        })),
        documentMetadata: params.documentMetadata,
        generateEmbeddings: params.generateEmbeddings ?? true,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        documentId: params.documentId,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      documentId: params.documentId,
      nodeCount: data.chunksIngested,
      embeddingsGenerated: data.embeddingsGenerated,
    };
  }

  /**
   * Semantic search with filters
   */
  async search(params: {
    query: string;
    filters?: SearchFilters;
    limit?: number;
    minScore?: number;
  }): Promise<{ success: boolean; results: SearchResult[]; error?: string }> {
    const res = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        results: [],
        error: data.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      results: data.results || [],
    };
  }

  /**
   * Delete a document and all its chunks from Neo4j
   */
  async deleteDocument(documentId: string): Promise<{ success: boolean; deletedNodes: number; error?: string }> {
    const res = await fetch(`${this.baseUrl}/document/${documentId}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        deletedNodes: 0,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      deletedNodes: data.deletedNodes || 0,
    };
  }

  /**
   * Update document metadata in Neo4j
   */
  async updateDocumentMetadata(
    documentId: string,
    updates: Partial<CommunityNodeMetadata>
  ): Promise<{ success: boolean; updatedNodes: number; error?: string }> {
    const res = await fetch(`${this.baseUrl}/document/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        updatedNodes: 0,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      updatedNodes: data.updatedNodes || 0,
    };
  }

  /**
   * Ensure vector index exists
   */
  async ensureVectorIndex(): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(`${this.baseUrl}/indexes/ensure-vector`, {
      method: "POST",
    });

    const data = await res.json();
    return { success: res.ok, error: data.error };
  }

  /**
   * Ingest a file with parsing (uses @ragforge/core parsers)
   *
   * For binary documents (PDF, DOCX, etc.), uses the new DocumentParser which creates:
   * - File node with original path (e.g., "paper.pdf")
   * - MarkdownDocument node
   * - MarkdownSection nodes
   *
   * For text files, uses the standard code/markdown parsers.
   */
  async ingestFile(params: {
    filePath: string;
    content?: Buffer;
    metadata: CommunityNodeMetadata;
    generateEmbeddings?: boolean;
    /** Enable Vision-based parsing for PDF (default: false) */
    enableVision?: boolean;
    /** Section title detection mode (default: 'detect') */
    sectionTitles?: 'none' | 'detect' | 'llm';
  }): Promise<{
    success: boolean;
    documentId: string;
    nodeCount?: number;
    relationshipCount?: number;
    embeddingsGenerated?: number;
    parseTimeMs?: number;
    totalTimeMs?: number;
    warnings?: string[];
    error?: string;
  }> {
    const res = await fetch(`${this.baseUrl}/ingest/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath: params.filePath,
        content: params.content?.toString("base64"),
        metadata: params.metadata,
        generateEmbeddings: params.generateEmbeddings ?? true,
        enableVision: params.enableVision ?? false,
        sectionTitles: params.sectionTitles ?? 'detect',
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        documentId: params.metadata.documentId,
        error: data.error || `HTTP ${res.status}`,
        warnings: data.warnings,
      };
    }

    return {
      success: true,
      documentId: params.metadata.documentId,
      nodeCount: data.nodesCreated,
      relationshipCount: data.relationshipsCreated,
      embeddingsGenerated: data.embeddingsGenerated,
      parseTimeMs: data.parseTimeMs,
      totalTimeMs: data.totalTimeMs,
      warnings: data.warnings,
    };
  }

  /**
   * Ingest multiple files in batch
   */
  async ingestBatch(params: {
    files: Array<{ filePath: string; content?: Buffer }>;
    metadata: CommunityNodeMetadata;
    generateEmbeddings?: boolean;
  }): Promise<{
    success: boolean;
    documentId: string;
    totalNodes?: number;
    totalRelationships?: number;
    embeddingsGenerated?: number;
    filesProcessed?: number;
    filesSkipped?: number;
    warnings?: string[];
    errors?: string[];
    totalTimeMs?: number;
    error?: string;
  }> {
    const res = await fetch(`${this.baseUrl}/ingest/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: params.files.map((f) => ({
          filePath: f.filePath,
          content: f.content?.toString("base64"),
        })),
        metadata: params.metadata,
        generateEmbeddings: params.generateEmbeddings ?? true,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        success: false,
        documentId: params.metadata.documentId,
        error: data.error || `HTTP ${res.status}`,
      };
    }

    return {
      success: true,
      documentId: params.metadata.documentId,
      totalNodes: data.totalNodes,
      totalRelationships: data.totalRelationships,
      embeddingsGenerated: data.embeddingsGenerated,
      filesProcessed: data.filesProcessed,
      filesSkipped: data.filesSkipped,
      warnings: data.warnings,
      errors: data.errors,
      totalTimeMs: data.totalTimeMs,
    };
  }

  /**
   * Get list of supported file extensions
   */
  async getSupportedExtensions(): Promise<{ extensions: string[]; count: number }> {
    try {
      const res = await fetch(`${this.baseUrl}/parsers/extensions`);
      if (!res.ok) return { extensions: [], count: 0 };
      return res.json();
    } catch {
      return { extensions: [], count: 0 };
    }
  }
}

// Singleton instance
let _client: RagForgeAPIClient | null = null;

/**
 * Get singleton RagForge API client
 */
export function getRagForgeClient(): RagForgeAPIClient {
  if (!_client) {
    _client = new RagForgeAPIClient();
  }
  return _client;
}

/**
 * Build CommunityNodeMetadata from Prisma document with relations
 */
export function buildNodeMetadata(document: {
  id: string;
  title: string;
  categoryId: string;
  uploadedById: string;
  category: { slug: string; name: string };
  uploadedBy: { username: string };
}): CommunityNodeMetadata {
  return {
    documentId: document.id,
    documentTitle: document.title,
    userId: document.uploadedById,
    userUsername: document.uploadedBy.username,
    categoryId: document.categoryId,
    categorySlug: document.category.slug,
    categoryName: document.category.name,
    isPublic: true,
  };
}
