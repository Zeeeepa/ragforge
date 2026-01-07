/**
 * Community Upload Adapter
 *
 * Wraps UniversalSourceAdapter from @ragforge/core to handle uploaded files
 * and inject community-specific metadata on all parsed nodes.
 *
 * This adapter:
 * 1. Saves uploaded files (Buffer) to a temp directory
 * 2. Uses UniversalSourceAdapter.parse() for full parsing (chunking, imports, etc.)
 * 3. Injects community metadata on all returned nodes
 * 4. Returns the ParseResult for merging into Neo4j
 *
 * @since 2025-01-04
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  UniversalSourceAdapter,
  type ParseResult,
  type ParsedNode,
} from "@luciformresearch/ragforge";
import { getPipelineLogger } from "./logger";
import type { CommunityNodeMetadata } from "./types";

const logger = getPipelineLogger();

export interface UploadedFile {
  /** Original filename */
  filename: string;
  /** File content as Buffer or string */
  content: Buffer | string;
  /** Optional MIME type */
  mimeType?: string;
}

export interface ParseUploadOptions {
  /** Files to parse */
  files: UploadedFile[];
  /** Community metadata to inject on all nodes */
  metadata: CommunityNodeMetadata;
  /** Optional progress callback */
  onProgress?: (progress: {
    phase: string;
    current: number;
    total: number;
  }) => void;
}

export interface ParseUploadResult {
  /** The parsed result from UniversalSourceAdapter */
  parseResult: ParseResult;
  /** Temp directory used (caller should clean up) */
  tempDir: string;
  /** Files that were saved */
  savedFiles: string[];
  /** Any errors encountered */
  errors: Array<{ file: string; error: string }>;
}

/**
 * Community Upload Adapter
 *
 * Parses uploaded files using @ragforge/core's full parsing pipeline
 * (chunking, import resolution, AST analysis, relationship creation)
 * and injects community-specific metadata.
 */
export class CommunityUploadAdapter {
  private universalAdapter: UniversalSourceAdapter;

  constructor() {
    this.universalAdapter = new UniversalSourceAdapter();
  }

  /**
   * Parse uploaded files
   *
   * @param options Parse options including files and metadata
   * @returns ParseResult with community metadata injected
   */
  async parse(options: ParseUploadOptions): Promise<ParseUploadResult> {
    const { files, metadata, onProgress } = options;
    const errors: Array<{ file: string; error: string }> = [];
    const savedFiles: string[] = [];

    // Create temp directory
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "community-docs-")
    );
    logger.info(`Created temp directory: ${tempDir}`);

    try {
      // Phase 1: Save files to temp directory
      onProgress?.({ phase: "saving", current: 0, total: files.length });

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const filePath = path.join(tempDir, file.filename);

          // Create subdirectories if needed
          const fileDir = path.dirname(filePath);
          await fs.mkdir(fileDir, { recursive: true });

          // Write file
          const content =
            typeof file.content === "string"
              ? file.content
              : file.content;
          await fs.writeFile(filePath, content);

          savedFiles.push(file.filename);
          logger.debug(`Saved file: ${file.filename}`);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          errors.push({ file: file.filename, error: errorMsg });
          logger.error(`Failed to save ${file.filename}: ${errorMsg}`);
        }

        onProgress?.({ phase: "saving", current: i + 1, total: files.length });
      }

      if (savedFiles.length === 0) {
        throw new Error("No files were saved successfully");
      }

      // Phase 2: Parse with UniversalSourceAdapter
      onProgress?.({ phase: "parsing", current: 0, total: savedFiles.length });
      logger.info(
        `Parsing ${savedFiles.length} files with UniversalSourceAdapter`
      );

      const parseResult = await this.universalAdapter.parse({
        source: {
          type: "files",
          root: tempDir,
          include: ["**/*"],
          exclude: [],
        },
        onProgress: (progress) => {
          onProgress?.({
            phase: progress.phase,
            current: progress.filesProcessed,
            total: progress.totalFiles,
          });
        },
      });

      // Phase 3: Inject community metadata on all nodes
      onProgress?.({
        phase: "injecting_metadata",
        current: 0,
        total: parseResult.graph.nodes.length,
      });
      logger.info(
        `Injecting metadata on ${parseResult.graph.nodes.length} nodes`
      );

      for (let i = 0; i < parseResult.graph.nodes.length; i++) {
        const node = parseResult.graph.nodes[i];
        this.injectMetadata(node, metadata);

        if (i % 100 === 0) {
          onProgress?.({
            phase: "injecting_metadata",
            current: i,
            total: parseResult.graph.nodes.length,
          });
        }
      }

      logger.info(
        `Parsing complete: ${parseResult.graph.nodes.length} nodes, ` +
          `${parseResult.graph.relationships.length} relationships`
      );

      return {
        parseResult,
        tempDir,
        savedFiles,
        errors,
      };
    } catch (error) {
      // Clean up temp dir on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Parse a single file from disk (already saved)
   */
  async parseFile(
    filePath: string,
    metadata: CommunityNodeMetadata
  ): Promise<ParseResult> {
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);

    logger.info(`Parsing file: ${filename}`);

    const parseResult = await this.universalAdapter.parse({
      source: {
        type: "files",
        root: dir,
        include: [filename],
        exclude: [],
      },
    });

    // Inject metadata on all nodes
    for (const node of parseResult.graph.nodes) {
      this.injectMetadata(node, metadata);
    }

    return parseResult;
  }

  /**
   * Parse a directory
   */
  async parseDirectory(
    dirPath: string,
    metadata: CommunityNodeMetadata,
    options?: {
      include?: string[];
      exclude?: string[];
      onProgress?: (progress: {
        phase: string;
        current: number;
        total: number;
      }) => void;
    }
  ): Promise<ParseResult> {
    logger.info(`Parsing directory: ${dirPath}`);

    const parseResult = await this.universalAdapter.parse({
      source: {
        type: "files",
        root: dirPath,
        include: options?.include || ["**/*"],
        exclude: options?.exclude || [],
      },
      onProgress: (progress) => {
        options?.onProgress?.({
          phase: progress.phase,
          current: progress.filesProcessed,
          total: progress.totalFiles,
        });
      },
    });

    // Inject metadata on all nodes
    for (const node of parseResult.graph.nodes) {
      this.injectMetadata(node, metadata);
    }

    logger.info(
      `Directory parsing complete: ${parseResult.graph.nodes.length} nodes`
    );

    return parseResult;
  }

  /**
   * Inject community metadata into a node
   * Uses the actual CommunityNodeMetadata properties
   */
  private injectMetadata(
    node: ParsedNode,
    metadata: CommunityNodeMetadata
  ): void {
    // Document identity
    node.properties.documentId = metadata.documentId;
    node.properties.documentTitle = metadata.documentTitle;

    // User info
    node.properties.userId = metadata.userId;
    if (metadata.userUsername) {
      node.properties.userUsername = metadata.userUsername;
    }

    // Category info
    node.properties.categoryId = metadata.categoryId;
    node.properties.categorySlug = metadata.categorySlug;
    if (metadata.categoryName) {
      node.properties.categoryName = metadata.categoryName;
    }

    // Permissions
    if (metadata.isPublic !== undefined) {
      node.properties.isPublic = metadata.isPublic;
    }

    // Tags
    if (metadata.tags && metadata.tags.length > 0) {
      node.properties.tags = metadata.tags;
    }

    // Add ingestion timestamp if not present
    if (!node.properties.ingestedAt) {
      node.properties.ingestedAt = new Date().toISOString();
    }

    // Mark as community content
    node.properties.sourceType = "community-upload";
  }

  /**
   * Clean up a temp directory
   */
  async cleanup(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      logger.debug(`Cleaned up temp directory: ${tempDir}`);
    } catch (error) {
      logger.warn(`Failed to clean up ${tempDir}: ${error}`);
    }
  }
}

/**
 * Singleton instance
 */
let uploadAdapter: CommunityUploadAdapter | null = null;

export function getUploadAdapter(): CommunityUploadAdapter {
  if (!uploadAdapter) {
    uploadAdapter = new CommunityUploadAdapter();
  }
  return uploadAdapter;
}

export function resetUploadAdapter(): void {
  uploadAdapter = null;
}
