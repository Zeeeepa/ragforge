/**
 * Agent Tools - Vercel AI SDK Format
 *
 * Tools available to the chat agent for:
 * - Searching the knowledge base
 * - Ingesting documents
 * - Reading files
 * - Fetching web pages
 */

import { tool } from "ai";
import { z } from "zod";
import { int as neo4jInt } from "neo4j-driver";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";
import type { CommunityOrchestratorAdapter } from "../orchestrator-adapter.js";
import type { Neo4jClient } from "../neo4j-client.js";
import {
  ClaudeOCRProvider,
  generateRender3DAssetHandler,
  type ThreeDToolsContext,
} from "@luciformresearch/ragforge";

// ============================================================================
// OCR Constants
// ============================================================================

const OCR_CONFIDENCE_THRESHOLD = 60; // Use Tesseract if confidence >= 60%, else Claude Vision
const TEMP_DIR = path.join(os.homedir(), ".ragforge", "temp");

// ============================================================================
// Content Size Limits
// ============================================================================

// ~50k chars = ~12k tokens = ~$0.04 with Claude Sonnet
const CONTENT_WARNING_THRESHOLD = 50_000;
// ~500k chars = ~125k tokens = ~$0.40 with Claude Sonnet
const CONTENT_ERROR_THRESHOLD = 500_000;

function checkContentSize(content: string, context: string): { ok: boolean; warning?: string; error?: string } {
  const size = content.length;

  if (size > CONTENT_ERROR_THRESHOLD) {
    return {
      ok: false,
      error: `[${context}] Content too large (${(size / 1000).toFixed(0)}k chars, ~${(size / 4000).toFixed(0)}k tokens). ` +
        `This would cost ~$${((size / 4000) * 0.003).toFixed(2)} in API calls. ` +
        `Please use search or summarization instead of fetching full content.`,
    };
  }

  if (size > CONTENT_WARNING_THRESHOLD) {
    console.warn(
      `[${context}] WARNING: Large content (${(size / 1000).toFixed(0)}k chars, ~${(size / 4000).toFixed(0)}k tokens). ` +
      `Estimated cost: ~$${((size / 4000) * 0.003).toFixed(2)}. Consider using search or summarization.`
    );
    return { ok: true, warning: `Large content: ${(size / 1000).toFixed(0)}k chars` };
  }

  return { ok: true };
}

// ============================================================================
// OCR Helper Functions
// ============================================================================

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Try Tesseract OCR first for PDFs (free), return result if confidence is good
 */
async function tryTesseractOCR(
  pdfBuffer: Buffer
): Promise<{ text: string; confidence: number } | null> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const { data } = await worker.recognize(pdfBuffer);
    await worker.terminate();

    if (data.confidence >= OCR_CONFIDENCE_THRESHOLD && data.text.trim().length > 20) {
      return { text: data.text, confidence: data.confidence };
    }
    console.log(`[OCR] Tesseract confidence ${data.confidence.toFixed(1)}% < ${OCR_CONFIDENCE_THRESHOLD}%, using Claude Vision`);
    return null;
  } catch (err: any) {
    console.warn(`[OCR] Tesseract failed: ${err.message}, using Claude Vision`);
    return null;
  }
}

/**
 * Convert PDF page to image buffer for Tesseract
 */
async function pdfPageToBuffer(pdfPath: string, page: number = 1): Promise<Buffer | null> {
  try {
    const { fromPath } = await import("pdf2pic");
    const outputDir = path.join(TEMP_DIR, "pdf-ocr");
    await ensureDir(outputDir);

    const options = {
      density: 200,
      saveFilename: "temp",
      savePath: outputDir,
      format: "png",
      width: 2000,
      height: 2000,
    };
    const convert = fromPath(pdfPath, options);
    const result = await convert(page, { responseType: "buffer" });
    return result.buffer || null;
  } catch (err: any) {
    console.warn(`[OCR] PDF to image conversion failed: ${err.message}`);
    return null;
  }
}

/**
 * Extract text from PDF using Tesseract-first, fallback to Claude Vision
 */
async function extractPdfContent(
  pdfPath: string,
  visionProvider: ClaudeOCRProvider
): Promise<{ text: string; provider: "tesseract" | "claude"; confidence?: number }> {
  // Try Tesseract first (free)
  console.log(`[OCR] PDF detected, trying Tesseract first...`);
  const pdfBuffer = await pdfPageToBuffer(pdfPath, 1);

  if (pdfBuffer) {
    const tesseractResult = await tryTesseractOCR(pdfBuffer);
    if (tesseractResult) {
      console.log(`[OCR] Using Tesseract result (confidence: ${tesseractResult.confidence.toFixed(1)}%)`);
      return {
        text: tesseractResult.text,
        provider: "tesseract",
        confidence: tesseractResult.confidence,
      };
    }
  }

  // Fallback to Claude Vision
  if (!visionProvider.isAvailable()) {
    return { text: "", provider: "claude" };
  }

  console.log(`[OCR] Falling back to Claude Vision...`);
  const result = await visionProvider.describeImage(
    pdfPath,
    "Extract and describe the content of this PDF document. Include key topics, structure, and any important information."
  );

  return {
    text: result.description || "",
    provider: "claude",
  };
}

// ============================================================================
// Attachment Types
// ============================================================================

export interface SavedAttachment {
  filename: string;
  filePath: string;
  mimeType?: string;
  fileType: "image" | "pdf" | "3d" | "zip" | "document" | "other";
  size: number;
}

// ============================================================================
// Tool Context (passed to tool handlers)
// ============================================================================

export interface ToolContext {
  orchestrator: CommunityOrchestratorAdapter;
  neo4j: Neo4jClient;
  userId?: string;
  categorySlug?: string;
  attachments?: SavedAttachment[];
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function createAgentTools(ctx: ToolContext) {
  return {
    /**
     * Search the knowledge base semantically
     */
    search_brain: tool({
      description: `Search the knowledge base for relevant documents, sections, and information.
Use this when the user asks about topics that might be in the indexed documents.
Returns matching content with relevance scores.`,
      inputSchema: z.object({
        query: z.string().describe("The search query - what to look for"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of results to return"),
        semantic: z
          .boolean()
          .optional()
          .default(true)
          .describe("Use semantic search (recommended)"),
      }),
      execute: async ({ query, limit = 10, semantic = true }) => {
        const limitInt = Math.floor(limit ?? 10);
        console.log(`[search_brain] query="${query}", limit=${limitInt}`);

        try {
          // Search across ALL content (don't filter by categorySlug by default)
          const results = await ctx.orchestrator.search({
            query,
            limit: limitInt,
            semantic: semantic ?? true,
            hybrid: true,
          });

          // Format results for the LLM
          const formatted = results.results.slice(0, limitInt).map((r: any, i: number) => ({
            rank: i + 1,
            score: r.score.toFixed(3),
            documentTitle: r.node.documentTitle || "Untitled",
            content: r.node.content || r.node.ownContent || "",
            documentId: r.node.documentId,
          }));

          // Check total content size
          const totalContent = formatted.map((f: any) => f.content).join("\n");
          const sizeCheck = checkContentSize(totalContent, "search_brain");
          if (!sizeCheck.ok) {
            return {
              success: false,
              error: sizeCheck.error,
            };
          }

          return {
            success: true,
            count: formatted.length,
            totalFound: results.totalCount,
            results: formatted,
            ...(sizeCheck.warning && { warning: sizeCheck.warning }),
          };
        } catch (error: any) {
          console.error(`[search_brain] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * Ingest a document into the knowledge base
     */
    ingest_document: tool({
      description: `Ingest a document (text, markdown, PDF content, etc.) into the knowledge base.
Use this when the user provides content they want to save and make searchable.
The document will be parsed, chunked, and indexed for semantic search.`,
      inputSchema: z.object({
        content: z.string().describe("The document content to ingest"),
        title: z.string().describe("Title for the document"),
        filename: z
          .string()
          .optional()
          .describe("Original filename (helps determine parsing)"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags to associate with the document"),
      }),
      execute: async ({ content, title, filename, tags }) => {
        console.log(`[ingest_document] title="${title}", filename=${filename}`);

        try {
          // Generate a unique document ID
          const documentId = `doc-${Date.now()}`;
          const finalFilename = filename || `${title.replace(/\s+/g, "-").toLowerCase()}.md`;

          const result = await ctx.orchestrator.ingestVirtual({
            virtualFiles: [
              {
                path: finalFilename,
                content,
              },
            ],
            metadata: {
              documentId,
              documentTitle: title,
              userId: ctx.userId || "agent-user",
              categoryId: "cat-agent",
              categorySlug: ctx.categorySlug || "agent-ingested",
              tags,
            },
            sourceIdentifier: "agent-upload",
            generateEmbeddings: true,
          });

          // Generate embeddings after ingestion
          await ctx.orchestrator.generateEmbeddingsForDocument(documentId);

          return {
            success: true,
            documentId,
            title,
            nodeCount: result.nodesCreated,
            message: `Document "${title}" has been ingested and is now searchable.`,
          };
        } catch (error: any) {
          console.error(`[ingest_document] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * Explore the contents of a source (files, sections, scopes)
     */
    explore_source: tool({
      description: `Explore the contents of an ingested source.
Returns the files, sections, and code scopes within a source.
Use this after list_sources to see what's inside a specific source.`,
      inputSchema: z.object({
        sourceId: z.string().describe("The source ID to explore (from list_sources)"),
        type: z
          .enum(["all", "files", "sections", "scopes"])
          .optional()
          .default("all")
          .describe("Filter by content type"),
        limit: z
          .number()
          .optional()
          .default(30)
          .describe("Maximum items to return"),
      }),
      execute: async ({ sourceId, type = "all", limit = 30 }) => {
        const limitInt = Math.floor(limit ?? 30);
        console.log(`[explore_source] sourceId="${sourceId}", type=${type}, limit=${limitInt}`);

        try {
          // Build label filter based on type
          let labelFilter = "";
          if (type === "files") {
            labelFilter = "AND (n:File OR n:MarkdownDocument OR n:DataFile)";
          } else if (type === "sections") {
            labelFilter = "AND (n:MarkdownSection OR n:DataSection)";
          } else if (type === "scopes") {
            labelFilter = "AND n:Scope";
          } else {
            labelFilter = "AND (n:File OR n:MarkdownDocument OR n:MarkdownSection OR n:Scope OR n:DataFile OR n:DataSection)";
          }

          const result = await ctx.neo4j.run(`
            MATCH (n {documentId: $sourceId})
            WHERE n.uuid IS NOT NULL ${labelFilter}
            RETURN n.uuid AS uuid, n.name AS name, n.heading AS heading, n.title AS title,
                   labels(n) AS labels, n.startLine AS startLine, n.endLine AS endLine,
                   substring(coalesce(n.content, n.ownContent, ""), 0, 150) AS preview
            ORDER BY n.startLine ASC, n.name ASC
            LIMIT $limit
          `, { sourceId, limit: neo4jInt(limitInt) });

          if (result.records.length === 0) {
            return {
              success: false,
              error: `Source "${sourceId}" not found or has no content`,
            };
          }

          const items = result.records.map((r: any) => ({
            uuid: r.get("uuid"),
            name: r.get("name") || r.get("heading") || r.get("title") || "(untitled)",
            type: r.get("labels")?.[0] || "Unknown",
            lines: r.get("startLine") && r.get("endLine")
              ? `${r.get("startLine")}-${r.get("endLine")}`
              : null,
            preview: r.get("preview") || "",
          }));

          return {
            success: true,
            sourceId,
            count: items.length,
            items,
          };
        } catch (error: any) {
          console.error(`[explore_source] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * Read specific content by UUID
     */
    read_content: tool({
      description: `Read the full content of a specific item (section, file, scope).
Use the UUID from search_brain or explore_source results.`,
      inputSchema: z.object({
        uuid: z.string().describe("The UUID of the content to read"),
      }),
      execute: async ({ uuid }) => {
        console.log(`[read_content] uuid="${uuid}"`);

        try {
          const result = await ctx.neo4j.run(`
            MATCH (n {uuid: $uuid})
            RETURN n.name AS name, n.heading AS heading, n.title AS title,
                   n.content AS content, n.ownContent AS ownContent,
                   n.documentId AS sourceId, n.documentTitle AS sourceTitle,
                   labels(n) AS labels, n.startLine AS startLine, n.endLine AS endLine
          `, { uuid });

          if (result.records.length === 0) {
            return {
              success: false,
              error: `Content with UUID "${uuid}" not found`,
            };
          }

          const r = result.records[0];
          const content = r.get("content") || r.get("ownContent") || "";
          const name = r.get("name") || r.get("heading") || r.get("title") || uuid;

          // Check content size
          const sizeCheck = checkContentSize(content, "read_content");
          if (!sizeCheck.ok) {
            return {
              success: false,
              error: sizeCheck.error,
              hint: "Use search_brain to find specific parts instead.",
            };
          }

          return {
            success: true,
            uuid,
            name,
            type: r.get("labels")?.[0] || "Unknown",
            sourceId: r.get("sourceId"),
            sourceTitle: r.get("sourceTitle"),
            lines: r.get("startLine") && r.get("endLine")
              ? { start: r.get("startLine"), end: r.get("endLine") }
              : null,
            content,
            ...(sizeCheck.warning && { warning: sizeCheck.warning }),
          };
        } catch (error: any) {
          console.error(`[read_content] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * Fetch a web page
     */
    fetch_url: tool({
      description: `Fetch the content of a web page.
Use this when the user provides a URL they want to analyze or ingest.
Can optionally ingest the page into the knowledge base.`,
      inputSchema: z.object({
        url: z.string().url().describe("The URL to fetch"),
        ingest: z
          .boolean()
          .optional()
          .default(false)
          .describe("Whether to ingest the page into the knowledge base"),
      }),
      execute: async ({ url, ingest = false }) => {
        console.log(`[fetch_url] url="${url}", ingest=${ingest}`);

        try {
          // Fetch the URL
          const response = await fetch(url, {
            headers: {
              "User-Agent": "RagForge-Agent/1.0",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });

          if (!response.ok) {
            return {
              success: false,
              error: `HTTP ${response.status}: ${response.statusText}`,
            };
          }

          const html = await response.text();

          // Simple HTML to text conversion (strip tags)
          const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || new URL(url).hostname;
          const content = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          // Optionally ingest
          if (ingest && content) {
            const documentId = `web-${Date.now()}`;
            await ctx.orchestrator.ingestVirtual({
              virtualFiles: [
                {
                  path: `${new URL(url).hostname}.md`,
                  content: `# ${title}\n\nSource: ${url}\n\n${content}`,
                },
              ],
              metadata: {
                documentId,
                documentTitle: title,
                userId: ctx.userId || "agent-user",
                categoryId: "cat-web",
                categorySlug: "web-pages",
              },
              sourceIdentifier: "web-fetch",
              generateEmbeddings: true,
            });

            await ctx.orchestrator.generateEmbeddingsForDocument(documentId);

            return {
              success: true,
              url,
              title,
              contentLength: content.length,
              ingested: true,
              documentId,
              message: `Page fetched and ingested as "${title}"`,
            };
          }

          // Check content size
          const sizeCheck = checkContentSize(content, "fetch_url");
          if (!sizeCheck.ok) {
            return {
              success: false,
              error: sizeCheck.error,
              hint: "Consider using ingest=true to store the page and search it instead.",
            };
          }

          return {
            success: true,
            url,
            title,
            content,
            contentLength: content.length,
            ingested: false,
            ...(sizeCheck.warning && { warning: sizeCheck.warning }),
          };
        } catch (error: any) {
          console.error(`[fetch_url] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * List ingested sources (projects, uploads, repos) in the knowledge base
     */
    list_sources: tool({
      description: `List ingested sources in the knowledge base.
Sources are ingested content bundles: code repositories, markdown uploads, GitHub repos, etc.
Each source has a unique documentId and may contain multiple files, sections, or code scopes.
Use this to see what has been indexed.`,
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .default(20)
          .describe("Maximum number of sources to list"),
        categorySlug: z
          .string()
          .optional()
          .describe("Filter by category"),
      }),
      execute: async ({ limit = 20, categorySlug }) => {
        const limitInt = Math.floor(limit ?? 20);
        console.log(`[list_sources] limit=${limitInt}, category=${categorySlug}`);

        try {
          // Query Neo4j directly for unique documents
          // Only filter by categorySlug if explicitly provided (don't use context default)
          const filterCategory = categorySlug;
          const result = await ctx.neo4j.run(`
            MATCH (n)
            WHERE n.documentId IS NOT NULL
            ${filterCategory ? "AND n.categorySlug = $categorySlug" : ""}
            WITH n.documentId AS documentId, n.documentTitle AS title, n.categorySlug AS categorySlug
            RETURN DISTINCT documentId, title, categorySlug, count(*) AS nodeCount
            ORDER BY title ASC
            LIMIT $limit
          `, { limit: neo4jInt(limitInt), categorySlug: filterCategory });

          const sources = result.records.map((r: any) => ({
            sourceId: r.get("documentId"),
            title: r.get("title") || r.get("documentId"),
            category: r.get("categorySlug"),
            nodeCount: r.get("nodeCount")?.toNumber?.() ?? r.get("nodeCount") ?? 0,
          }));

          return {
            success: true,
            count: sources.length,
            sources,
          };
        } catch (error: any) {
          console.error(`[list_sources] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * List tags or get content for a specific tag
     */
    list_tags: tool({
      description: `List all tags, or get content linked to a specific tag.
Tags are keywords associated with content for categorization.
- Without tagName: lists all tags with usage counts
- With tagName: returns documents/sections that have this tag`,
      inputSchema: z.object({
        tagName: z
          .string()
          .optional()
          .describe("If provided, returns content linked to this tag"),
        limit: z
          .number()
          .optional()
          .default(50)
          .describe("Maximum number of results to return"),
      }),
      execute: async ({ tagName, limit = 50 }) => {
        const limitInt = Math.floor(limit ?? 50);
        console.log(`[list_tags] tagName=${tagName}, limit=${limitInt}`);

        try {
          if (tagName) {
            // Get content linked to this tag
            const result = await ctx.neo4j.run(`
              MATCH (t:Tag {name: $tagName})<-[:HAS_TAG]-(n)
              RETURN n.uuid AS uuid, n.documentId AS sourceId, n.documentTitle AS sourceTitle,
                     coalesce(n.heading, n.name, n.title) AS name,
                     labels(n)[0] AS type,
                     substring(coalesce(n.content, n.ownContent, ""), 0, 200) AS preview
              ORDER BY n.documentTitle ASC
              LIMIT $limit
            `, { tagName, limit: neo4jInt(limitInt) });

            const content = result.records.map((r: any) => ({
              uuid: r.get("uuid"),
              sourceId: r.get("sourceId"),
              sourceTitle: r.get("sourceTitle"),
              name: r.get("name") || "(untitled)",
              type: r.get("type"),
              preview: r.get("preview"),
            }));

            return {
              success: true,
              tagName,
              count: content.length,
              content,
            };
          } else {
            // List all tags
            const result = await ctx.neo4j.run(`
              MATCH (t:Tag)
              OPTIONAL MATCH (t)<-[:HAS_TAG]-(n)
              RETURN t.name AS name, t.uuid AS uuid, count(n) AS usageCount
              ORDER BY usageCount DESC
              LIMIT $limit
            `, { limit: neo4jInt(limitInt) });

            const tags = result.records.map((r: any) => ({
              name: r.get("name"),
              uuid: r.get("uuid"),
              usageCount: r.get("usageCount")?.toNumber?.() ?? r.get("usageCount") ?? 0,
            }));

            return {
              success: true,
              count: tags.length,
              tags,
            };
          }
        } catch (error: any) {
          console.error(`[list_tags] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * List entity types in the knowledge base
     */
    list_entity_types: tool({
      description: `List all entity types found in the knowledge base.
Entity types include: Person, Organization, Technology, Product, Event, Location, Concept, etc.
Use this to discover what kinds of entities have been extracted.`,
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[list_entity_types]`);

        try {
          const result = await ctx.neo4j.run(`
            MATCH (e:Entity)
            WHERE e.entityType IS NOT NULL
            RETURN e.entityType AS entityType, count(*) AS count
            ORDER BY count DESC
          `);

          const types = result.records.map((r: any) => ({
            type: r.get("entityType"),
            count: r.get("count")?.toNumber?.() ?? r.get("count") ?? 0,
          }));

          return {
            success: true,
            count: types.length,
            types,
          };
        } catch (error: any) {
          console.error(`[list_entity_types] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * List entities or get content mentioning a specific entity
     */
    list_entities: tool({
      description: `List entities, or get content that mentions a specific entity.
Entities are people, organizations, technologies, products, etc. extracted from documents.
- Without entityName: lists entities (optionally filtered by type)
- With entityName: returns documents/sections that mention this entity`,
      inputSchema: z.object({
        entityName: z
          .string()
          .optional()
          .describe("If provided, returns content that mentions this entity"),
        type: z
          .string()
          .optional()
          .describe("Entity type to filter by (e.g., 'Person', 'Technology')"),
        limit: z
          .number()
          .optional()
          .default(30)
          .describe("Maximum number of results to return"),
      }),
      execute: async ({ entityName, type, limit = 30 }) => {
        const limitInt = Math.floor(limit ?? 30);
        console.log(`[list_entities] entityName=${entityName}, type=${type}, limit=${limitInt}`);

        try {
          if (entityName) {
            // Get content that mentions this entity
            const result = await ctx.neo4j.run(`
              MATCH (e:Entity)
              WHERE e.name =~ ('(?i)' + $entityName) OR $entityName IN e.aliases
              MATCH (n)-[:CONTAINS_ENTITY]->(e)
              RETURN n.uuid AS uuid, n.documentId AS sourceId, n.documentTitle AS sourceTitle,
                     coalesce(n.heading, n.name, n.title) AS name,
                     labels(n)[0] AS type,
                     substring(coalesce(n.content, n.ownContent, ""), 0, 200) AS preview,
                     e.name AS entityFound, e.entityType AS entityType
              ORDER BY n.documentTitle ASC
              LIMIT $limit
            `, { entityName, limit: neo4jInt(limitInt) });

            const content = result.records.map((r: any) => ({
              uuid: r.get("uuid"),
              sourceId: r.get("sourceId"),
              sourceTitle: r.get("sourceTitle"),
              name: r.get("name") || "(untitled)",
              type: r.get("type"),
              preview: r.get("preview"),
              entityFound: r.get("entityFound"),
              entityType: r.get("entityType"),
            }));

            return {
              success: true,
              entityName,
              count: content.length,
              content,
            };
          } else {
            // List entities
            const typeFilter = type ? "AND e.entityType = $type" : "";
            const result = await ctx.neo4j.run(`
              MATCH (e:Entity)
              WHERE e.name IS NOT NULL ${typeFilter}
              RETURN e.name AS name, e.uuid AS uuid,
                     e.entityType AS entityType,
                     e.aliases AS aliases
              ORDER BY e.name ASC
              LIMIT $limit
            `, { type, limit: neo4jInt(limitInt) });

            const entities = result.records.map((r: any) => ({
              name: r.get("name"),
              uuid: r.get("uuid"),
              type: r.get("entityType"),
              aliases: r.get("aliases"),
            }));

            return {
              success: true,
              count: entities.length,
              filterType: type || "all",
              entities,
            };
          }
        } catch (error: any) {
          console.error(`[list_entities] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * List attachments uploaded in this conversation
     */
    list_attachments: tool({
      description: `List files that the user has uploaded in this conversation.
Shows filename, type, and size for each attachment.
Use this to see what files are available before analyzing or ingesting them.`,
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[list_attachments]`);

        if (!ctx.attachments || ctx.attachments.length === 0) {
          return {
            success: true,
            count: 0,
            attachments: [],
            message: "No attachments in this conversation.",
          };
        }

        const attachments = ctx.attachments.map((a) => ({
          filename: a.filename,
          type: a.fileType,
          size: a.size,
          sizeFormatted: a.size > 1024 * 1024
            ? `${(a.size / (1024 * 1024)).toFixed(1)} MB`
            : `${(a.size / 1024).toFixed(1)} KB`,
        }));

        return {
          success: true,
          count: attachments.length,
          attachments,
        };
      },
    }),

    /**
     * Analyze an attachment (image, PDF, 3D model)
     */
    analyze_attachment: tool({
      description: `Analyze an uploaded file using AI vision.
Works with images (PNG, JPG, etc.), PDFs, and 3D models.
Returns a description or extracted text from the file.`,
      inputSchema: z.object({
        filename: z.string().describe("Filename of the attachment to analyze"),
        prompt: z
          .string()
          .optional()
          .describe("Custom prompt for analysis (e.g., 'Extract all text' or 'Describe what you see')"),
      }),
      execute: async ({ filename, prompt }) => {
        console.log(`[analyze_attachment] filename="${filename}", prompt="${prompt}"`);

        // Find the attachment
        const attachment = ctx.attachments?.find(
          (a) => a.filename.toLowerCase() === filename.toLowerCase()
        );

        if (!attachment) {
          return {
            success: false,
            error: `Attachment "${filename}" not found. Use list_attachments to see available files.`,
          };
        }

        try {
          // Use orchestrator's vision capabilities if available
          if (attachment.fileType === "image" || attachment.fileType === "pdf") {
            // Check if orchestrator has vision method
            if (typeof (ctx.orchestrator as any).analyzeImage === "function") {
              const result = await (ctx.orchestrator as any).analyzeImage(
                attachment.filePath,
                prompt || "Describe this image in detail."
              );
              return {
                success: true,
                filename: attachment.filename,
                type: attachment.fileType,
                analysis: result,
              };
            }

            // Fallback: read file and return base64 for Claude vision
            const fileBuffer = await fs.readFile(attachment.filePath);
            const base64 = fileBuffer.toString("base64");

            return {
              success: true,
              filename: attachment.filename,
              type: attachment.fileType,
              message: "File loaded. Vision analysis available via Claude.",
              base64Preview: base64.substring(0, 100) + "...",
              hint: "The LLM can see this image directly in the conversation.",
            };
          } else if (attachment.fileType === "3d") {
            return {
              success: true,
              filename: attachment.filename,
              type: "3d",
              message: "3D model detected. Use ingest_attachment to add it to the knowledge base for analysis.",
            };
          } else {
            return {
              success: false,
              error: `Cannot analyze file type: ${attachment.fileType}. Supported: image, pdf, 3d`,
            };
          }
        } catch (error: any) {
          console.error(`[analyze_attachment] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),

    /**
     * Ingest an attachment (zip, document, image, 3D, etc.)
     */
    ingest_attachment: tool({
      description: `Ingest an uploaded file into the knowledge base.
- For ZIP files: extracts and ingests all supported files inside
- For documents (MD, TXT, JSON, etc.): ingests the content directly
- For images/PDFs: generates AI description and stores it for semantic search
- For 3D models: renders multiple views, generates descriptions, and stores for search`,
      inputSchema: z.object({
        filename: z.string().describe("Filename of the attachment to ingest"),
        title: z
          .string()
          .optional()
          .describe("Title for the ingested content (defaults to filename)"),
        analyzeMedia: z
          .boolean()
          .optional()
          .default(false)
          .describe("Use AI to analyze images and 3D models"),
      }),
      execute: async ({ filename, title, analyzeMedia = false }) => {
        console.log(`[ingest_attachment] filename="${filename}", title="${title}", analyzeMedia=${analyzeMedia}`);

        // Find the attachment
        const attachment = ctx.attachments?.find(
          (a) => a.filename.toLowerCase() === filename.toLowerCase()
        );

        if (!attachment) {
          return {
            success: false,
            error: `Attachment "${filename}" not found. Use list_attachments to see available files.`,
          };
        }

        try {
          const documentId = `upload-${Date.now()}`;
          const documentTitle = title || attachment.filename;

          if (attachment.fileType === "zip") {
            // Extract ZIP and ingest contents
            const zip = new AdmZip(attachment.filePath);
            const entries = zip.getEntries();

            const virtualFiles: { path: string; content: string }[] = [];

            for (const entry of entries) {
              if (entry.isDirectory) continue;

              const ext = path.extname(entry.entryName).toLowerCase();
              // Only ingest text-based files
              if ([".md", ".txt", ".json", ".yaml", ".yml", ".ts", ".js", ".py", ".csv"].includes(ext)) {
                const content = entry.getData().toString("utf8");
                virtualFiles.push({
                  path: entry.entryName,
                  content,
                });
              }
            }

            if (virtualFiles.length === 0) {
              return {
                success: false,
                error: "ZIP contains no supported text files (.md, .txt, .json, .yaml, .ts, .js, .py, .csv)",
              };
            }

            const result = await ctx.orchestrator.ingestVirtual({
              virtualFiles,
              metadata: {
                documentId,
                documentTitle,
                userId: ctx.userId || "chat-user",
                categoryId: "cat-uploads",
                categorySlug: "uploads",
              },
              sourceIdentifier: "chat-upload",
              generateEmbeddings: true,
            });

            await ctx.orchestrator.generateEmbeddingsForDocument(documentId);

            return {
              success: true,
              documentId,
              title: documentTitle,
              filesIngested: virtualFiles.length,
              totalFiles: entries.length,
              nodesCreated: result.nodesCreated,
              message: `ZIP extracted and ingested: ${virtualFiles.length} files processed.`,
            };

          } else if (attachment.fileType === "document" || attachment.fileType === "other") {
            // Read and ingest as single file
            const content = await fs.readFile(attachment.filePath, "utf8");

            const result = await ctx.orchestrator.ingestVirtual({
              virtualFiles: [{ path: attachment.filename, content }],
              metadata: {
                documentId,
                documentTitle,
                userId: ctx.userId || "chat-user",
                categoryId: "cat-uploads",
                categorySlug: "uploads",
              },
              sourceIdentifier: "chat-upload",
              generateEmbeddings: true,
            });

            await ctx.orchestrator.generateEmbeddingsForDocument(documentId);

            return {
              success: true,
              documentId,
              title: documentTitle,
              nodesCreated: result.nodesCreated,
              message: `Document "${documentTitle}" has been ingested and is now searchable.`,
            };

          } else if (attachment.fileType === "image" || attachment.fileType === "pdf") {
            // Ingest image/PDF with AI-generated description
            console.log(`[ingest_attachment] Analyzing ${attachment.fileType}...`);

            let description = "";
            let ocrProvider: "tesseract" | "claude" = "claude";
            let ocrConfidence: number | undefined;
            const visionProvider = new ClaudeOCRProvider();

            try {
              if (attachment.fileType === "pdf") {
                // For PDFs: try Tesseract first (free), fallback to Claude Vision
                const pdfResult = await extractPdfContent(attachment.filePath, visionProvider);
                description = pdfResult.text;
                ocrProvider = pdfResult.provider;
                ocrConfidence = pdfResult.confidence;
              } else {
                // For images: use Claude Vision directly
                if (visionProvider.isAvailable()) {
                  const result = await visionProvider.describeImage(
                    attachment.filePath,
                    "Describe this image in detail. Include what you see, any text present, colors, composition, and potential use."
                  );
                  description = result.description || "";
                }
              }
            } catch (err: any) {
              console.warn(`[ingest_attachment] Vision analysis failed: ${err.message}`);
            }

            // Create markdown content with description
            const mdContent = `# ${documentTitle}

## File Information
- **Type**: ${attachment.fileType.toUpperCase()}
- **Filename**: ${attachment.filename}
- **Size**: ${(attachment.size / 1024).toFixed(1)} KB
${ocrProvider === "tesseract" ? `- **OCR Provider**: Tesseract (free)${ocrConfidence ? ` - Confidence: ${ocrConfidence.toFixed(1)}%` : ""}` : ""}
${ocrProvider === "claude" && attachment.fileType === "pdf" ? "- **OCR Provider**: Claude Vision" : ""}

## AI Description
${description || "(No description available)"}
`;

            const result = await ctx.orchestrator.ingestVirtual({
              virtualFiles: [{ path: `${attachment.filename}.md`, content: mdContent }],
              metadata: {
                documentId,
                documentTitle,
                userId: ctx.userId || "chat-user",
                categoryId: "cat-uploads",
                categorySlug: "uploads",
                mediaType: attachment.fileType,
                originalFile: attachment.filePath,
              },
              sourceIdentifier: "chat-upload-media",
              generateEmbeddings: true,
            });

            await ctx.orchestrator.generateEmbeddingsForDocument(documentId);

            return {
              success: true,
              documentId,
              title: documentTitle,
              type: attachment.fileType,
              ocrProvider: attachment.fileType === "pdf" ? ocrProvider : undefined,
              ocrConfidence,
              nodesCreated: result.nodesCreated,
              hasDescription: !!description,
              message: `${attachment.fileType.toUpperCase()} "${documentTitle}" ingested${attachment.fileType === "pdf" ? ` (OCR: ${ocrProvider})` : ""}. Now searchable.`,
            };

          } else if (attachment.fileType === "3d") {
            // Ingest 3D model with rendered views and descriptions
            console.log(`[ingest_attachment] Rendering 3D model views...`);

            // Render views
            const renderDir = path.join(os.homedir(), ".ragforge", "temp", "3d-renders", documentId);
            await fs.mkdir(renderDir, { recursive: true });

            let renders: Array<{ view: string; path: string }> = [];
            try {
              const threeDCtx: ThreeDToolsContext = { projectRoot: renderDir };
              const handler = generateRender3DAssetHandler(threeDCtx);
              const renderResult = await handler({
                model_path: attachment.filePath,
                output_dir: renderDir,
                views: ["front", "right", "perspective"],
                width: 512,
                height: 512,
                background: "#f0f0f0",
              });
              renders = renderResult.renders || [];
            } catch (err: any) {
              console.warn(`[ingest_attachment] 3D rendering failed: ${err.message}`);
            }

            // Generate descriptions for each view
            const viewDescriptions: Array<{ view: string; description: string }> = [];
            const visionProvider = new ClaudeOCRProvider();

            if (visionProvider.isAvailable() && renders.length > 0) {
              for (const render of renders) {
                try {
                  const result = await visionProvider.describe3DRender(render.path);
                  if (result.description) {
                    viewDescriptions.push({ view: render.view, description: result.description });
                  }
                } catch (err: any) {
                  console.warn(`[ingest_attachment] View description failed for ${render.view}: ${err.message}`);
                }
              }
            }

            // Synthesize global description
            let globalDescription = "";
            if (viewDescriptions.length > 0 && visionProvider.isAvailable()) {
              try {
                globalDescription = await visionProvider.synthesizeDescription(viewDescriptions);
              } catch (err: any) {
                console.warn(`[ingest_attachment] Synthesis failed: ${err.message}`);
                globalDescription = viewDescriptions.map(v => `**${v.view}**: ${v.description}`).join("\n\n");
              }
            }

            // Create markdown content
            const mdContent = `# ${documentTitle}

## 3D Model Information
- **Filename**: ${attachment.filename}
- **Size**: ${(attachment.size / 1024).toFixed(1)} KB
- **Views Rendered**: ${renders.length}

## AI Description
${globalDescription || "(No description available)"}

${viewDescriptions.length > 0 ? `## View Descriptions\n${viewDescriptions.map(v => `### ${v.view}\n${v.description}`).join("\n\n")}` : ""}
`;

            const result = await ctx.orchestrator.ingestVirtual({
              virtualFiles: [{ path: `${attachment.filename}.md`, content: mdContent }],
              metadata: {
                documentId,
                documentTitle,
                userId: ctx.userId || "chat-user",
                categoryId: "cat-uploads",
                categorySlug: "uploads",
                mediaType: "3d",
                originalFile: attachment.filePath,
                renderedViews: renders.map(r => r.path),
              },
              sourceIdentifier: "chat-upload-3d",
              generateEmbeddings: true,
            });

            await ctx.orchestrator.generateEmbeddingsForDocument(documentId);

            return {
              success: true,
              documentId,
              title: documentTitle,
              type: "3d",
              viewsRendered: renders.length,
              viewsDescribed: viewDescriptions.length,
              nodesCreated: result.nodesCreated,
              hasDescription: !!globalDescription,
              message: `3D model "${documentTitle}" ingested with ${viewDescriptions.length} view descriptions. Now searchable.`,
            };
          }

          return {
            success: false,
            error: `Unsupported file type: ${attachment.fileType}`,
          };
        } catch (error: any) {
          console.error(`[ingest_attachment] Error: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      },
    }),
  };
}

// ============================================================================
// Tool Names (for type safety)
// ============================================================================

export type AgentToolName = keyof ReturnType<typeof createAgentTools>;

export const AGENT_TOOL_NAMES: AgentToolName[] = [
  "search_brain",
  "ingest_document",
  "explore_source",
  "read_content",
  "fetch_url",
  "list_sources",
  "list_tags",
  "list_entity_types",
  "list_entities",
  "list_attachments",
  "analyze_attachment",
  "ingest_attachment",
];
