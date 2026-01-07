/**
 * Parser Configuration for Community Docs
 *
 * Uses UniversalSourceAdapter from @ragforge/core.
 * This ensures we get the FULL parsing pipeline including:
 * - AST analysis for code files
 * - Chunking with semantic boundaries
 * - Import/export resolution
 * - Relationship creation (CONSUMES, DEFINED_IN, etc.)
 *
 * @since 2025-01-04
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  UniversalSourceAdapter,
  detectFileCategory,
  type ParseResult,
  type ParsedNode,
  type ParsedRelationship,
} from "@luciformresearch/ragforge";
import { getPipelineLogger } from "./logger";

const logger = getPipelineLogger();

// ============================================================================
// TYPES (compatible with pipeline interface)
// ============================================================================

export interface ParseInput {
  filePath: string;
  projectId: string;
  content?: string;
}

export interface ParserNode {
  id: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface ParserRelationship {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, any>;
}

export interface ParseOutput {
  nodes: ParserNode[];
  relationships: ParserRelationship[];
  warnings?: string[];
  metadata?: {
    parseTimeMs?: number;
    fileType?: string;
    parserUsed?: string;
  };
}

// ============================================================================
// ADAPTER SINGLETON
// ============================================================================

let adapter: UniversalSourceAdapter | null = null;
let initialized = false;

function getAdapter(): UniversalSourceAdapter {
  if (!adapter) {
    adapter = new UniversalSourceAdapter();
  }
  return adapter;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize parsers (creates UniversalSourceAdapter)
 */
export function initializeParsers(): void {
  if (initialized) return;
  initialized = true;

  getAdapter();
  logger.info("[CommunityParsers] Initialized with UniversalSourceAdapter");
}

/**
 * Check if parsers are initialized
 */
export function isParsersInitialized(): boolean {
  return initialized;
}

// ============================================================================
// SUPPORTED EXTENSIONS
// ============================================================================

const SUPPORTED_EXTENSIONS = new Set([
  // Code
  ".ts", ".tsx", ".js", ".jsx", ".py", ".vue", ".svelte", ".html", ".htm",
  ".css", ".scss", ".sass", ".astro",
  // Documents
  ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".csv",
  // Data
  ".json", ".yaml", ".yml", ".xml", ".toml", ".env",
  // Media (descriptions only)
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
  // Markdown
  ".md", ".mdx", ".markdown",
  // Text
  ".txt", ".text",
]);

/**
 * Check if a file can be parsed
 */
export function canParse(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Get parser name for a file (for logging)
 */
export function getParserName(filePath: string): string | null {
  if (!canParse(filePath)) return null;
  const category = detectFileCategory(filePath);
  return `universal-${category}`;
}

/**
 * Get list of supported extensions
 */
export function getSupportedExtensions(): string[] {
  return Array.from(SUPPORTED_EXTENSIONS);
}

// ============================================================================
// PARSING INTERFACE
// ============================================================================

/**
 * Parse a file and return nodes + relationships
 *
 * Uses UniversalSourceAdapter from @ragforge/core for full parsing:
 * - Code: AST analysis, scope detection, import resolution
 * - Markdown: Heading structure, code blocks, links
 * - Documents: Text extraction, chunking
 * - Data: Schema detection, field extraction
 *
 * @param filePath - Absolute path to the file
 * @param projectId - Project ID for the nodes
 * @param content - Optional: file content (for in-memory files)
 * @returns ParseOutput with nodes and relationships, or null if no parser
 */
export async function parseFile(
  filePath: string,
  projectId: string,
  content?: Buffer | string
): Promise<ParseOutput | null> {
  if (!initialized) {
    initializeParsers();
  }

  if (!canParse(filePath)) {
    logger.warn(`[CommunityParsers] No parser found for: ${filePath}`);
    return null;
  }

  const startTime = Date.now();
  let tempDir: string | null = null;
  let actualFilePath = filePath;

  try {
    // If content is provided, write to temp file for UniversalSourceAdapter
    if (content) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "community-parse-"));
      const filename = path.basename(filePath);
      actualFilePath = path.join(tempDir, filename);
      await fs.writeFile(actualFilePath, content);
    }

    const fileDir = path.dirname(actualFilePath);
    const filename = path.basename(actualFilePath);

    // Parse with UniversalSourceAdapter
    const result: ParseResult = await getAdapter().parse({
      source: {
        type: "files",
        root: fileDir,
        include: [filename],
        exclude: [],
      },
      projectId,
    });

    const parseTimeMs = Date.now() - startTime;
    const category = detectFileCategory(filePath);

    // Convert ParsedNode to ParserNode
    const nodes: ParserNode[] = result.graph.nodes.map((node: ParsedNode) => ({
      id: node.id,
      labels: node.labels,
      properties: node.properties,
    }));

    // Convert ParsedRelationship to ParserRelationship
    const relationships: ParserRelationship[] = result.graph.relationships.map(
      (rel: ParsedRelationship) => ({
        from: rel.from,
        to: rel.to,
        type: rel.type,
        properties: rel.properties,
      })
    );

    logger.debug(
      `[CommunityParsers] Parsed ${filename}: ${nodes.length} nodes, ${relationships.length} relationships in ${parseTimeMs}ms`
    );

    return {
      nodes,
      relationships,
      warnings: result.graph.metadata?.warnings,
      metadata: {
        parseTimeMs,
        fileType: category,
        parserUsed: `universal-${category}`,
      },
    };
  } catch (error) {
    logger.error(`[CommunityParsers] Parse error for ${filePath}:`, error);
    return null;
  } finally {
    // Clean up temp directory if created
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// ============================================================================
// ADDITIONAL EXPORTS (for compatibility)
// ============================================================================

export type ContentParseInput = ParseInput;
export type ContentParseOutput = ParseOutput;
export type ContentNode = ParserNode;
export type ContentRelationship = ParserRelationship;

export const parseContent = parseFile;
export const canParseContent = canParse;
export const getSupportedContentExtensions = getSupportedExtensions;
