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

  // Media files (images, PDFs, 3D models)
  mediaType?: "image" | "pdf" | "3d";
  originalFile?: string;
  renderedViews?: string[];
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
  /** Content snippet (truncated or chunk text for agent-friendly output) */
  content: string;
  score: number;
  /** Source file path (e.g., "document.pdf", "image.png") */
  sourcePath?: string;
  /** Node type (e.g., "MarkdownSection", "MediaFile") */
  nodeType?: string;
  /** Matched range info (when a chunk matched instead of full content) */
  matchedRange?: {
    startLine: number;
    endLine: number;
    startChar: number;
    endChar: number;
    chunkIndex: number;
    chunkScore: number;
    /** Page number from parent document (for PDFs/Word docs) */
    pageNum?: number | null;
  };
  /** Position info from the node (pageNum for docs, startLine for code) */
  position?: {
    pageNum?: number;
    sectionIndex?: number;
    startLine?: number;
    endLine?: number;
  };
  metadata: {
    documentTitle: string;
    categoryId: string;
    categorySlug: string;
    userId: string;
  };
  /** Keyword boost info (if boostKeywords was used) */
  keywordBoost?: {
    keyword: string;
    similarity: number;
    boost: number;
  };
  /** Entity/tag boost applied (if entityBoost was used) */
  entityBoostApplied?: number;
  /** Matched entities/tags (if includeMatchedEntities: true) */
  matchedEntities?: Array<{
    uuid: string;
    name: string;
    type: 'Tag' | 'CanonicalEntity';
    matchScore: number;
  }>;
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
