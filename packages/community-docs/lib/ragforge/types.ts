/**
 * Types for Community Docs RagForge Integration
 *
 * @since 2025-01-03
 */

/**
 * Metadata attached to every node in Neo4j
 * Used for filtering in search queries
 */
export interface CommunityNodeMetadata {
  // Document identity
  documentId: string;
  documentTitle: string;

  // User filtering
  userId: string;
  userUsername?: string;

  // Category filtering
  categoryId: string;
  categorySlug: string;
  categoryName?: string;

  // Permissions
  isPublic?: boolean;

  // Tags (future)
  tags?: string[];
}

/**
 * Search filters for vector search
 */
export interface SearchFilters {
  categoryId?: string;
  categorySlug?: string;
  userId?: string;
  documentId?: string;
  isPublic?: boolean;
}

/**
 * Search result from vector search
 */
export interface SearchResult {
  documentId: string;
  chunkId?: string;
  content: string;
  score: number;
  metadata: {
    documentTitle: string;
    categoryId: string;
    categorySlug: string;
    userId: string;
  };
}

/**
 * Result of document ingestion
 */
export interface IngestionResult {
  success: boolean;
  documentId: string;
  nodeCount?: number;
  embeddingsGenerated?: number;
  error?: string;
}

/**
 * Chunk for splitting large documents
 */
export interface DocumentChunk {
  chunkId: string;
  content: string;
  position: number;
  metadata?: Record<string, any>;
}
