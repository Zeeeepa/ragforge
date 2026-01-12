/**
 * Unified Ingestion Service for Community Docs
 *
 * Single entry point for all file ingestion:
 * - Single files or batches
 * - Binary documents (PDF, DOCX, XLSX)
 * - Media files (images, 3D models)
 * - Text/code files
 *
 * Automatically routes to the appropriate handler based on file type.
 *
 * @since 2025-01-10
 */

import { getPipelineLogger } from "./logger";
import type { CommunityOrchestratorAdapter } from "./orchestrator-adapter";
import type { CommunityNodeMetadata } from "./types";
import * as path from "path";

const logger = getPipelineLogger();

// File type detection
const BINARY_DOC_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".xlsx", ".xls"]);
const MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
  ".glb", ".gltf", ".obj", ".fbx"
]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const MODEL_3D_EXTENSIONS = new Set([".glb", ".gltf", ".obj", ".fbx"]);

/**
 * Input file for ingestion
 */
export interface IngestFile {
  /** File path (relative or absolute) */
  path: string;
  /** File content as Buffer */
  content: Buffer;
}

/**
 * Options for unified ingestion
 */
export interface IngestOptions {
  /** Files to ingest */
  files: IngestFile[];
  /** Community metadata to attach to all nodes */
  metadata: CommunityNodeMetadata;
  /** Project ID for Neo4j */
  projectId: string;
  /** Generate embeddings after ingestion (default: true) */
  generateEmbeddings?: boolean;
  /** Enable Vision API for PDFs and images (default: false) */
  enableVision?: boolean;
  /** Generate titles for document sections via LLM (default: true) */
  generateTitles?: boolean;
  /** Section title detection mode (default: 'detect') */
  sectionTitles?: 'none' | 'detect' | 'llm';
}

/**
 * Result of ingestion
 */
export interface IngestResult {
  success: boolean;
  stats: {
    filesProcessed: number;
    nodesCreated: number;
    relationshipsCreated: number;
    embeddingsGenerated: number;
  };
  /** Per-file results */
  files: Array<{
    path: string;
    type: 'binary' | 'media' | 'text';
    success: boolean;
    nodesCreated: number;
    error?: string;
  }>;
  /** Warnings from parsing */
  warnings: string[];
  /** Errors that didn't stop ingestion */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Detect file type from extension
 */
function detectFileType(filePath: string): 'binary' | 'media' | 'text' {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_DOC_EXTENSIONS.has(ext)) return 'binary';
  if (MEDIA_EXTENSIONS.has(ext)) return 'media';
  return 'text';
}

/**
 * Check if file is a binary document
 */
export function isBinaryDocument(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_DOC_EXTENSIONS.has(ext);
}

/**
 * Check if file is a media file (image or 3D model)
 */
export function isMediaFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return MEDIA_EXTENSIONS.has(ext);
}

/**
 * Check if file is an image
 */
export function isImage(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Check if file is a 3D model
 */
export function is3DModel(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return MODEL_3D_EXTENSIONS.has(ext);
}

/**
 * Unified Ingestion Service
 *
 * Handles all file ingestion through a single entry point.
 */
export class CommunityIngestionService {
  constructor(private orchestrator: CommunityOrchestratorAdapter) {}

  /**
   * Ingest files with automatic type detection and routing
   */
  async ingest(options: IngestOptions): Promise<IngestResult> {
    const {
      files,
      metadata,
      projectId,
      generateEmbeddings = true,
      enableVision = false,
      generateTitles = true,
      sectionTitles = 'detect',
    } = options;

    logger.info(`[IngestionService] Starting ingestion of ${files.length} files`);

    const result: IngestResult = {
      success: true,
      stats: {
        filesProcessed: 0,
        nodesCreated: 0,
        relationshipsCreated: 0,
        embeddingsGenerated: 0,
      },
      files: [],
      warnings: [],
      errors: [],
    };

    // Group files by type
    const binaryDocs: IngestFile[] = [];
    const mediaFiles: IngestFile[] = [];
    const textFiles: IngestFile[] = [];

    for (const file of files) {
      const type = detectFileType(file.path);
      switch (type) {
        case 'binary':
          binaryDocs.push(file);
          break;
        case 'media':
          mediaFiles.push(file);
          break;
        default:
          textFiles.push(file);
      }
    }

    logger.info(`[IngestionService] File breakdown: ${binaryDocs.length} binary docs, ${mediaFiles.length} media, ${textFiles.length} text`);

    // Process binary documents (PDF, DOCX, XLSX)
    for (const file of binaryDocs) {
      try {
        logger.info(`[IngestionService] Processing binary document: ${file.path}`);
        const docResult = await this.orchestrator.ingestBinaryDocument({
          filePath: file.path,
          binaryContent: file.content,
          metadata,
          projectId,
          enableVision,
          sectionTitles,
          generateTitles,
        });

        result.files.push({
          path: file.path,
          type: 'binary',
          success: true,
          nodesCreated: docResult.nodesCreated,
        });
        result.stats.nodesCreated += docResult.nodesCreated;
        result.stats.relationshipsCreated += docResult.relationshipsCreated;
        if (docResult.warnings) {
          result.warnings.push(...docResult.warnings);
        }
        result.stats.filesProcessed++;
      } catch (err: any) {
        logger.error(`[IngestionService] Failed to ingest binary document ${file.path}: ${err.message}`);
        result.files.push({
          path: file.path,
          type: 'binary',
          success: false,
          nodesCreated: 0,
          error: err.message,
        });
        result.errors.push({ file: file.path, error: err.message });
      }
    }

    // Process media files (images, 3D models)
    for (const file of mediaFiles) {
      try {
        logger.info(`[IngestionService] Processing media file: ${file.path}`);
        const mediaResult = await this.orchestrator.ingestMedia({
          filePath: file.path,
          binaryContent: file.content,
          metadata,
          projectId,
          enableVision,
        });

        result.files.push({
          path: file.path,
          type: 'media',
          success: true,
          nodesCreated: mediaResult.nodesCreated,
        });
        result.stats.nodesCreated += mediaResult.nodesCreated;
        result.stats.relationshipsCreated += mediaResult.relationshipsCreated;
        if (mediaResult.warnings) {
          result.warnings.push(...mediaResult.warnings);
        }
        result.stats.filesProcessed++;
      } catch (err: any) {
        logger.error(`[IngestionService] Failed to ingest media ${file.path}: ${err.message}`);
        result.files.push({
          path: file.path,
          type: 'media',
          success: false,
          nodesCreated: 0,
          error: err.message,
        });
        result.errors.push({ file: file.path, error: err.message });
      }
    }

    // Process text/code files in batch via ingestVirtual
    if (textFiles.length > 0) {
      try {
        logger.info(`[IngestionService] Processing ${textFiles.length} text files`);
        const virtualFiles = textFiles.map(f => ({
          path: f.path,
          content: f.content.toString('utf-8'),
        }));

        const textResult = await this.orchestrator.ingestVirtual({
          virtualFiles,
          metadata,
          projectId,
          sourceIdentifier: 'upload',
          generateEmbeddings: false, // We'll do it at the end
        });

        for (const file of textFiles) {
          result.files.push({
            path: file.path,
            type: 'text',
            success: true,
            nodesCreated: Math.floor(textResult.nodesCreated / textFiles.length), // Approximate
          });
        }
        result.stats.nodesCreated += textResult.nodesCreated;
        result.stats.relationshipsCreated += textResult.relationshipsCreated;
        result.stats.filesProcessed += textFiles.length;
      } catch (err: any) {
        logger.error(`[IngestionService] Failed to ingest text files: ${err.message}`);
        for (const file of textFiles) {
          result.files.push({
            path: file.path,
            type: 'text',
            success: false,
            nodesCreated: 0,
            error: err.message,
          });
          result.errors.push({ file: file.path, error: err.message });
        }
      }
    }

    // Generate embeddings if requested
    if (generateEmbeddings && result.stats.nodesCreated > 0) {
      try {
        logger.info(`[IngestionService] Generating embeddings for ${result.stats.nodesCreated} nodes`);
        // generateEmbeddingsForDocument calculates projectId from documentId internally
        const embeddingsGenerated = await this.orchestrator.generateEmbeddingsForDocument(
          metadata.documentId
        );
        result.stats.embeddingsGenerated = embeddingsGenerated;
      } catch (err: any) {
        logger.warn(`[IngestionService] Failed to generate embeddings: ${err.message}`);
        result.warnings.push(`Embedding generation failed: ${err.message}`);
      }
    }

    // Set overall success based on errors
    result.success = result.errors.length === 0;

    logger.info(`[IngestionService] Ingestion complete: ${result.stats.filesProcessed} files, ${result.stats.nodesCreated} nodes, ${result.stats.embeddingsGenerated} embeddings`);

    return result;
  }

  /**
   * Convenience method for single file ingestion
   */
  async ingestFile(
    filePath: string,
    content: Buffer,
    metadata: CommunityNodeMetadata,
    projectId: string,
    options?: Partial<Omit<IngestOptions, 'files' | 'metadata' | 'projectId'>>
  ): Promise<IngestResult> {
    return this.ingest({
      files: [{ path: filePath, content }],
      metadata,
      projectId,
      ...options,
    });
  }
}

/**
 * Create an ingestion service instance
 */
export function createIngestionService(orchestrator: CommunityOrchestratorAdapter): CommunityIngestionService {
  return new CommunityIngestionService(orchestrator);
}
