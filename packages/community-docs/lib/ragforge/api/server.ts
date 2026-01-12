/**
 * Community Docs API Server
 *
 * Dedicated HTTP API for community-docs (port 6970).
 * Inspired by RagForge CLI daemon but specialized for document management.
 *
 * Features:
 * - Document ingestion with metadata (userId, categoryId, documentId)
 * - Semantic search with filtering
 * - Document deletion/update
 * - Ollama embeddings (local)
 *
 * @since 2025-01-03
 */

// Load environment variables FIRST before any other imports
import dotenv from "dotenv";
import { existsSync } from "fs";
import { homedir } from "os";
import { join as pathJoin } from "path";

// 1. Load community-docs local .env (highest priority)
const localEnvPath = pathJoin(process.cwd(), ".env");
if (existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
}

// 2. Load ~/.ragforge/.env as fallback (won't override existing vars)
const ragforgeEnvPath = pathJoin(homedir(), ".ragforge", ".env");
if (existsSync(ragforgeEnvPath)) {
  dotenv.config({ path: ragforgeEnvPath });
}

import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import AdmZip from "adm-zip";
import { basename } from "path";
import { randomUUID } from "crypto";
import { getNeo4jClient, closeNeo4jClient, type Neo4jClient } from "../neo4j-client";
import { OllamaEmbeddingService, type OllamaEmbeddingConfig } from "../embedding-service";
import { CommunityOrchestratorAdapter } from "../orchestrator-adapter";
import { getSupportedExtensions } from "../parsers";
import { getAPILogger, LOG_FILES } from "../logger";
import type { CommunityNodeMetadata, SearchResult, SearchFilters } from "../types";
// LLM Enrichment Services
import { EnrichmentService, type EnrichmentOptions, type DocumentContext, type NodeToEnrich } from "../enrichment-service";
import { EntityResolutionService, type EntityResolutionOptions } from "../entity-resolution-service";
import { EntityEmbeddingService, type EntitySearchOptions, type EntitySearchResult } from "../entity-embedding-service";
// Chat Agent Routes (Vercel AI SDK + Claude)
import { registerChatRoutes } from "./routes/chat";
// Vision API Routes (image/PDF/3D analysis)
import { registerVisionRoutes } from "./routes/vision";
// Core vision tools for ingestion
import {
  getOCRService,
  generateRender3DAssetHandler,
  getLocalTimestamp,
  type ThreeDToolsContext,
} from "@luciformresearch/ragforge";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// ============================================================================
// GitHub Clone Helper
// ============================================================================

/**
 * Clone a GitHub repository to a temporary directory
 * Uses shallow clone (--depth 1) for speed
 */
async function cloneGitHubRepo(
  githubUrl: string,
  branch: string = "main"
): Promise<{ tempDir: string; repoDir: string }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "github-ingest-"));

  // Extract repo name from URL for the directory name
  const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!urlMatch) {
    throw new Error("Invalid GitHub URL format");
  }
  const [, , repoName] = urlMatch;
  const repoDir = path.join(tempDir, repoName);

  logger.info(`Cloning ${githubUrl} (branch: ${branch}) to ${tempDir}...`);

  try {
    // Shallow clone for speed - only get the latest commit
    await execAsync(`git clone --depth 1 --branch ${branch} ${githubUrl} ${repoDir}`, {
      timeout: 120000, // 2 minutes timeout
    });
    logger.info(`Clone complete: ${repoDir}`);
    return { tempDir, repoDir };
  } catch (err: any) {
    // Cleanup on failure
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Failed to clone repository: ${err.message}`);
  }
}

/**
 * Recursively get all files in a directory matching CODE_EXTENSIONS
 */
async function getCodeFilesFromDir(
  dir: string,
  baseDir: string,
  extensions: Set<string>
): Promise<Array<{ path: string; absolutePath: string }>> {
  const files: Array<{ path: string; absolutePath: string }> = [];

  async function walk(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      // Skip hidden directories and node_modules
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = "." + entry.name.split(".").pop()?.toLowerCase();
        if (extensions.has(ext)) {
          files.push({ path: relativePath, absolutePath: fullPath });
        }
      }
    }
  }

  await walk(dir);
  return files;
}

// ============================================================================
// GitHub API Helpers (kept for reference, not used for ingestion anymore)
// ============================================================================

interface GitHubTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
}

interface GitHubBlobResponse {
  content: string;
  encoding: string;
}

async function fetchGitHubTree(owner: string, repo: string, branch = "main"): Promise<GitHubTreeItem[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "CommunityDocs-RagForge",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const data: GitHubTreeResponse = await response.json();
  if (data.truncated) {
    logger.warn("GitHub tree response was truncated - some files may be missing");
  }
  return data.tree;
}

async function fetchGitHubFile(owner: string, repo: string, sha: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${sha}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "CommunityDocs-RagForge",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub blob error: ${response.status}`);
  }

  const data: GitHubBlobResponse = await response.json();
  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return data.content;
}

// Supported code file extensions for GitHub ingestion
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi",
  ".rs",                                          // Rust
  ".go",                                          // Go
  ".c", ".h",                                     // C
  ".cpp", ".cc", ".cxx", ".hpp", ".hxx",          // C++
  ".cs",                                          // C#
  ".vue", ".svelte",
  ".html", ".css", ".scss", ".sass", ".less",
  ".json", ".yaml", ".yml",
  ".md", ".mdx",
]);

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PORT = 6970;

// ============================================================================
// Console Interception (add local timestamps + SSE log streaming)
// ============================================================================

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
const originalConsoleWarn = console.warn.bind(console);

/**
 * Log sink for SSE streaming
 * When set, all console.log/error/warn are also sent to this callback
 */
type LogSink = (level: "log" | "error" | "warn", message: string, timestamp: string) => void;
let currentLogSink: LogSink | null = null;

/**
 * Set a log sink to receive all console output
 * Used during SSE streaming to forward logs to client
 */
export function setLogSink(sink: LogSink | null): void {
  currentLogSink = sink;
}

function serializeArg(arg: any): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

console.log = (...args: any[]) => {
  const message = args.map(serializeArg).join(" ");
  const timestamp = getLocalTimestamp();
  originalConsoleLog(`[${timestamp}] ${message}`);
  // Send to SSE sink if active
  if (currentLogSink) {
    currentLogSink("log", message, timestamp);
  }
};

console.error = (...args: any[]) => {
  const message = args.map(serializeArg).join(" ");
  const timestamp = getLocalTimestamp();
  originalConsoleError(`[${timestamp}] [ERROR] ${message}`);
  // Send to SSE sink if active
  if (currentLogSink) {
    currentLogSink("error", message, timestamp);
  }
};

console.warn = (...args: any[]) => {
  const message = args.map(serializeArg).join(" ");
  const timestamp = getLocalTimestamp();
  originalConsoleWarn(`[${timestamp}] [WARN] ${message}`);
  // Send to SSE sink if active
  if (currentLogSink) {
    currentLogSink("warn", message, timestamp);
  }
};

// ============================================================================
// Logger
// ============================================================================

const logger = getAPILogger();

// ============================================================================
// API Server
// ============================================================================

export class CommunityAPIServer {
  private server: FastifyInstance;
  private neo4j: Neo4jClient | null = null;
  private embedding: OllamaEmbeddingService | null = null;
  private orchestrator: CommunityOrchestratorAdapter | null = null;
  private enrichment: EnrichmentService | null = null;
  private entityEmbedding: EntityEmbeddingService | null = null;
  private startTime: Date;
  private requestCount: number = 0;

  constructor() {
    this.startTime = new Date();
    this.server = Fastify({
      logger: false,
      bodyLimit: 50 * 1024 * 1024, // 50MB for large documents
    });
  }

  /**
   * Create a vision analyzer function for image/page description
   * Uses Claude via OCR service
   */
  private createVisionAnalyzer(): (imageBuffer: Buffer, prompt?: string) => Promise<string> {
    const ocrService = getOCRService({ primaryProvider: "claude" });
    const tempDir = path.join(os.homedir(), ".ragforge", "temp", "vision-ingest");

    return async (imageBuffer: Buffer, prompt?: string): Promise<string> => {
      // Ensure temp dir exists
      await fs.mkdir(tempDir, { recursive: true }).catch(() => {});

      const tempPath = path.join(tempDir, `vision-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
      await fs.writeFile(tempPath, imageBuffer);

      try {
        const result = await ocrService.extractText(tempPath, {
          prompt: prompt || "Describe this image in detail. What does it show? Include any text visible.",
        });
        return result.text || "[No description available]";
      } finally {
        await fs.unlink(tempPath).catch(() => {});
      }
    };
  }

  /**
   * Create a 3D render function for model visualization
   * Renders model to single perspective view and returns buffer
   */
  private createRender3DFunction(): (modelPath: string) => Promise<Array<{ view: string; buffer: Buffer }>> {
    const outputDir = path.join(os.homedir(), ".ragforge", "temp", "3d-renders");
    const ctx: ThreeDToolsContext = { projectRoot: outputDir };
    const render3DHandler = generateRender3DAssetHandler(ctx);

    return async (modelPath: string): Promise<Array<{ view: string; buffer: Buffer }>> => {
      console.log(`[3D Render] Starting render for: ${modelPath}`);
      console.log(`[3D Render] Output dir: ${outputDir}`);

      // Ensure output dir exists
      await fs.mkdir(outputDir, { recursive: true }).catch(() => {});

      try {
        console.log(`[3D Render] Calling render3DHandler...`);
        const result = await render3DHandler({
          model_path: modelPath,
          output_dir: outputDir,
          views: ["perspective"], // Single view for efficiency
          width: 512,
          height: 512,
        });
        console.log(`[3D Render] Handler result:`, JSON.stringify(result, null, 2));

        if (!result.renders || result.renders.length === 0) {
          console.warn(`[3D Render] No renders returned from handler`);
          return [];
        }

        // Read rendered images and return as buffers
        const renders: Array<{ view: string; buffer: Buffer }> = [];
        for (const render of result.renders) {
          try {
            // The handler returns relative paths, join with outputDir's parent to get absolute
            const renderPath = render.path.startsWith('/')
              ? render.path
              : path.join(path.dirname(outputDir), render.path);
            console.log(`[3D Render] Reading render file: ${renderPath}`);
            const buffer = await fs.readFile(renderPath);
            renders.push({ view: render.view, buffer });
            console.log(`[3D Render] Loaded render: ${render.view}, size: ${buffer.length} bytes`);
            // Clean up render file
            await fs.unlink(renderPath).catch(() => {});
          } catch (readErr) {
            console.warn(`[3D Render] Failed to read ${render.path}:`, readErr);
          }
        }

        console.log(`[3D Render] Returning ${renders.length} renders`);
        return renders;
      } catch (err) {
        console.error(`[3D Render] Failed to render ${modelPath}:`, err);
        return [];
      }
    };
  }

  async initialize(): Promise<void> {
    logger.info( "Initializing Community API...");

    await this.server.register(cors, {
      origin: true,
      methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
    });

    // Multipart for file uploads
    await this.server.register(multipart, {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    });

    // Initialize Neo4j
    this.neo4j = getNeo4jClient();
    const connected = await this.neo4j.verifyConnectivity();
    if (!connected) {
      throw new Error("Failed to connect to Neo4j on port 7688");
    }
    logger.info( "Connected to Neo4j (port 7688)");

    await this.neo4j.ensureIndexes();

    // Initialize Ollama embedding service
    const ollamaConfig: OllamaEmbeddingConfig = {
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: process.env.OLLAMA_EMBEDDING_MODEL || "mxbai-embed-large",
    };
    this.embedding = new OllamaEmbeddingService(ollamaConfig);

    const ollamaOk = await this.embedding.checkHealth();
    if (!ollamaOk) {
      logger.warn( "Ollama not available - embeddings disabled");
      this.embedding = null;
    } else {
      logger.info( `Ollama connected (model: ${ollamaConfig.model})`);
    }

    // Initialize orchestrator for all file ingestion (file, batch, GitHub)
    // Uses ragforge core EmbeddingService with batching for efficiency
    this.orchestrator = new CommunityOrchestratorAdapter({
      neo4j: this.neo4j!,
      embeddingConfig: this.embedding
        ? {
            provider: "ollama",
            model: process.env.OLLAMA_EMBEDDING_MODEL || "mxbai-embed-large",
            options: {
              baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
              batchSize: 10,
            },
          }
        : undefined,
      verbose: false,
    });
    await this.orchestrator.initialize();
    logger.info("Orchestrator initialized for virtual file ingestion (with core EmbeddingService)");

    // Initialize LLM enrichment service (optional - only if ANTHROPIC_API_KEY is set)
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      this.enrichment = new EnrichmentService(anthropicKey, {
        model: process.env.ENRICHMENT_MODEL || "claude-3-5-haiku-20241022",
      });
      logger.info("EnrichmentService initialized (Claude LLM)");
    } else {
      logger.info("EnrichmentService disabled (no ANTHROPIC_API_KEY)");
    }

    // Initialize EntityEmbeddingService for Entity/Tag embeddings and search
    if (this.embedding) {
      this.entityEmbedding = new EntityEmbeddingService({
        neo4jClient: this.neo4j!,
        embedFunction: async (texts: string[]) => {
          // Use Ollama batch embedding (one at a time for compatibility)
          const embeddings: number[][] = [];
          for (const text of texts) {
            const emb = await this.embedding!.embed(text);
            embeddings.push(emb);
          }
          return embeddings;
        },
        embedSingle: async (text: string) => {
          return this.embedding!.embed(text);
        },
        dimension: 1024, // mxbai-embed-large dimension
        verbose: false,
      });

      // Ensure vector and full-text indexes for Entity/Tag
      const vectorIndexResult = await this.entityEmbedding.ensureVectorIndexes();
      const fulltextIndexResult = await this.entityEmbedding.ensureFullTextIndexes();
      logger.info(`EntityEmbeddingService initialized (vector: ${vectorIndexResult.created} created, fulltext: ${fulltextIndexResult.created} created)`);

      // Connect EntityEmbeddingService to orchestrator for entity boost in search
      if (this.orchestrator) {
        this.orchestrator.setEntityEmbeddingService(this.entityEmbedding);
      }
    } else {
      logger.info("EntityEmbeddingService disabled (no embedding service)");
    }

    this.setupRoutes();
    this.server.addHook("onRequest", async () => { this.requestCount++; });

    logger.info( "Community API initialized");
  }

  private setupRoutes(): void {
    // Health & Status
    this.server.get("/health", async () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
    }));

    this.server.get("/status", async () => ({
      status: "running",
      port: DEFAULT_PORT,
      uptime_ms: Date.now() - this.startTime.getTime(),
      request_count: this.requestCount,
      neo4j: { connected: !!this.neo4j },
      embedding: { enabled: !!this.embedding, provider: "ollama" },
    }));

    // Document Ingestion
    this.server.post<{
      Body: {
        documentId: string;
        content: string;
        metadata: CommunityNodeMetadata;
        generateEmbeddings?: boolean;
      };
    }>("/ingest", async (request, reply) => {
      const { documentId, content, metadata, generateEmbeddings = true } = request.body || {};

      if (!documentId || !content || !metadata) {
        reply.status(400);
        return { success: false, error: "Missing documentId, content, or metadata" };
      }

      logger.info( `Ingesting document: ${documentId}`);

      try {
        await this.neo4j!.run(
          `MERGE (n:Scope {documentId: $documentId, type: 'document'})
           SET n += $props, n.content = $content, n.updatedAt = datetime()`,
          { documentId, content, props: { ...metadata, type: "document", name: metadata.documentTitle } }
        );

        let embeddingGenerated = false;
        if (generateEmbeddings && this.embedding) {
          try {
            const embedding = await this.embedding.embed(content);
            await this.neo4j!.run(
              `MATCH (n:Scope {documentId: $documentId, type: 'document'})
               SET n.embedding_content = $embedding`,
              { documentId, embedding }
            );
            embeddingGenerated = true;
          } catch (err: any) {
            logger.warn( `Embedding failed: ${err.message}`);
          }
        }

        return { success: true, documentId, embeddingGenerated };
      } catch (err: any) {
        logger.error( `Ingestion failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // Chunk Ingestion
    this.server.post<{
      Body: {
        documentId: string;
        chunks: Array<{ chunkId: string; content: string; position: number }>;
        documentMetadata: CommunityNodeMetadata;
        generateEmbeddings?: boolean;
      };
    }>("/ingest/chunks", async (request, reply) => {
      const { documentId, chunks, documentMetadata, generateEmbeddings = true } = request.body || {};

      if (!documentId || !chunks || !documentMetadata) {
        reply.status(400);
        return { success: false, error: "Missing required fields" };
      }

      logger.info( `Ingesting ${chunks.length} chunks for: ${documentId}`);

      try {
        let embeddingsGenerated = 0;

        for (const chunk of chunks) {
          await this.neo4j!.run(
            `MERGE (n:Scope {documentId: $documentId, chunkId: $chunkId})
             SET n += $props, n.content = $content, n.position = $position, n.type = 'chunk', n.updatedAt = datetime()`,
            {
              documentId,
              chunkId: chunk.chunkId,
              content: chunk.content,
              position: chunk.position,
              props: { ...documentMetadata, name: `${documentMetadata.documentTitle} - Chunk ${chunk.position}` },
            }
          );

          if (generateEmbeddings && this.embedding) {
            try {
              const embedding = await this.embedding.embed(chunk.content);
              await this.neo4j!.run(
                `MATCH (n:Scope {documentId: $documentId, chunkId: $chunkId})
                 SET n.embedding_content = $embedding`,
                { documentId, chunkId: chunk.chunkId, embedding }
              );
              embeddingsGenerated++;
            } catch {}
          }
        }

        return { success: true, documentId, chunksIngested: chunks.length, embeddingsGenerated };
      } catch (err: any) {
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // File Ingestion with Parsing (uses CommunityOrchestratorAdapter → ragforge core)
    // Supports both text files (via ingestVirtual) and binary documents (via ingestBinaryDocument)
    this.server.post<{
      Body: {
        filePath: string;
        content: string; // Base64 encoded content (required for virtual ingestion)
        metadata: CommunityNodeMetadata;
        generateEmbeddings?: boolean;
        /** Enable Vision-based parsing for PDF (default: false) */
        enableVision?: boolean;
        /** Section title detection mode (default: 'detect') */
        sectionTitles?: 'none' | 'detect' | 'llm';
        /** Generate titles for sections without one using LLM (default: true) */
        generateTitles?: boolean;
      };
    }>("/ingest/file", async (request, reply) => {
      const { filePath, content, metadata, generateEmbeddings = true, enableVision = false, sectionTitles = 'detect', generateTitles = true } = request.body || {};

      if (!filePath || !content || !metadata) {
        reply.status(400);
        return { success: false, error: "Missing filePath, content, or metadata" };
      }

      if (!this.orchestrator) {
        reply.status(503);
        return { success: false, error: "Orchestrator not available" };
      }

      logger.info(`Ingesting file: ${filePath}`);
      const startTime = Date.now();

      try {
        // Decode base64 content to Buffer
        const buffer = Buffer.from(content, "base64");

        // Use unified ingestion
        const result = await this.orchestrator.ingestFiles({
          files: [{ fileName: filePath, buffer }],
          metadata,
          documentId: metadata.documentId,
          enableVision,
          visionAnalyzer: enableVision ? this.createVisionAnalyzer() : undefined,
          render3D: enableVision ? this.createRender3DFunction() : undefined,
          sectionTitles,
          generateTitles,
          generateEmbeddings,
        });

        return {
          success: true,
          documentId: metadata.documentId,
          nodesCreated: result.nodesCreated,
          relationshipsCreated: result.relationshipsCreated,
          embeddingsGenerated: result.embeddingsGenerated,
          totalTimeMs: Date.now() - startTime,
          warnings: result.warnings,
        };
      } catch (err: any) {
        logger.error(`File ingestion failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // Batch File Ingestion (multiple files at once, uses unified ingestFiles)
    this.server.post<{
      Body: {
        files: Array<{ filePath: string; content: string }>; // content is base64 encoded
        metadata: CommunityNodeMetadata;
        generateEmbeddings?: boolean;
        enableVision?: boolean;
        extractEntities?: boolean;
        sectionTitles?: 'none' | 'detect' | 'llm';
        generateTitles?: boolean;
      };
    }>("/ingest/batch", async (request, reply) => {
      const {
        files,
        metadata,
        generateEmbeddings = true,
        enableVision = false,
        extractEntities = false,
        sectionTitles = 'detect',
        generateTitles = true,
      } = request.body || {};

      if (!files || files.length === 0 || !metadata) {
        reply.status(400);
        return { success: false, error: "Missing files or metadata" };
      }

      if (!this.orchestrator) {
        reply.status(503);
        return { success: false, error: "Orchestrator not available" };
      }

      logger.info(`Batch ingesting ${files.length} files for document: ${metadata.documentId}`);
      const startTime = Date.now();

      try {
        // Convert base64 to Buffer for each file
        const filesToIngest = files.map((f) => ({
          fileName: f.filePath,
          buffer: Buffer.from(f.content, "base64"),
        }));

        // Use unified ingestion (handles all file types)
        const result = await this.orchestrator.ingestFiles({
          files: filesToIngest,
          metadata,
          documentId: metadata.documentId,
          enableVision,
          visionAnalyzer: enableVision ? this.createVisionAnalyzer() : undefined,
          render3D: enableVision ? this.createRender3DFunction() : undefined,
          sectionTitles,
          generateTitles,
          generateEmbeddings,
          extractEntities,
          enrichmentService: extractEntities && this.enrichment ? this.enrichment : undefined,
        });

        return {
          success: true,
          documentId: metadata.documentId,
          nodesCreated: result.nodesCreated,
          relationshipsCreated: result.relationshipsCreated,
          embeddingsGenerated: result.embeddingsGenerated,
          entityStats: result.entityStats,
          filesProcessed: files.length,
          stats: result.stats,
          totalTimeMs: Date.now() - startTime,
          warnings: result.warnings,
        };
      } catch (err: any) {
        logger.error(`Batch ingestion failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // GitHub Repository Ingestion with SSE (Server-Sent Events)
    // Streams progress updates in real-time to avoid timeout issues with large repos
    this.server.post<{
      Body: {
        githubUrl: string;
        metadata: CommunityNodeMetadata;
        branch?: string;
        maxFiles?: number;
        generateEmbeddings?: boolean;
      };
    }>("/ingest/github", async (request, reply) => {
      const { githubUrl, metadata, branch = "main", maxFiles = 1000, generateEmbeddings = true } = request.body || {};

      // Validation (return JSON errors before switching to SSE)
      if (!githubUrl || !metadata) {
        reply.status(400);
        return { success: false, error: "Missing githubUrl or metadata" };
      }

      if (!this.orchestrator) {
        reply.status(503);
        return { success: false, error: "Orchestrator not available" };
      }

      const urlMatch = githubUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
      if (!urlMatch) {
        reply.status(400);
        return { success: false, error: "Invalid GitHub URL format" };
      }

      const [, owner, repo] = urlMatch;
      const sourceIdentifier = `github.com/${owner}/${repo}`;

      // Switch to SSE mode
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      });

      // Track if client disconnected - use reply.raw (response stream), not request.raw
      // request.raw 'close' fires when client finishes sending the request body
      // reply.raw 'close' fires when the response stream is closed (client disconnect)
      let clientDisconnected = false;

      // SSE helper functions
      const sendEvent = (event: string, data: any) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const sendProgress = (phase: string, current?: number, total?: number, message?: string) => {
        sendEvent("progress", { phase, current, total, message, timestamp: getLocalTimestamp() });
      };

      // Send log events from console.log/error/warn (captures core output)
      const sendLog = (level: "log" | "error" | "warn", message: string, timestamp: string) => {
        if (!clientDisconnected) {
          sendEvent("log", { level, message, timestamp });
        }
      };

      // Heartbeat to keep connection alive (every 30s)
      const heartbeat = setInterval(() => {
        reply.raw.write(": heartbeat\n\n");
      }, 30000);

      reply.raw.on("close", () => {
        clientDisconnected = true;
        setLogSink(null); // Stop forwarding logs when client disconnects
        clearInterval(heartbeat);
        logger.info(`[SSE] Client disconnected (reply.raw close event)`);
      });

      // Activate log sink to capture all console output during ingestion
      setLogSink(sendLog);

      logger.info(`GitHub ingestion (SSE): ${sourceIdentifier} (branch: ${branch})`);
      const startTime = Date.now();
      let tempDir: string | null = null;

      try {
        // Phase 1: Clone repository
        sendProgress("cloning", 0, 1, `Cloning ${githubUrl}...`);
        const cloneResult = await cloneGitHubRepo(githubUrl, branch);
        tempDir = cloneResult.tempDir;
        const repoDir = cloneResult.repoDir;
        sendProgress("cloning", 1, 1, "Repository cloned");

        // Note: We continue ingestion even if client disconnects - the work should complete

        // Phase 2: Scan files
        sendProgress("scanning", 0, 0, "Scanning for code files...");
        const codeFiles = await getCodeFilesFromDir(repoDir, repoDir, CODE_EXTENSIONS);

        if (codeFiles.length === 0) {
          sendEvent("error", { success: false, error: "No supported code files found in repository", phase: "scanning" });
          return;
        }

        const filesToIngest = codeFiles.slice(0, maxFiles);
        sendProgress("scanning", filesToIngest.length, codeFiles.length, `Found ${codeFiles.length} files, will ingest ${filesToIngest.length}`);

        // Phase 3: Read files
        sendProgress("reading", 0, filesToIngest.length, "Reading file contents...");
        const virtualFiles: Array<{ path: string; content: string }> = [];
        for (let i = 0; i < filesToIngest.length; i++) {
          const file = filesToIngest[i];
          try {
            const content = await fs.readFile(file.absolutePath, "utf-8");
            virtualFiles.push({ path: file.path, content });
          } catch (err) {
            logger.warn(`Failed to read ${file.path}: ${err}`);
          }
          // Send progress every 50 files
          if ((i + 1) % 50 === 0 || i === filesToIngest.length - 1) {
            sendProgress("reading", i + 1, filesToIngest.length, `Read ${i + 1}/${filesToIngest.length} files`);
          }
        }

        // Phase 4: Ingest (parsing + nodes + relationships)
        sendProgress("ingesting", 0, 0, "Starting ingestion pipeline...");

        const result = await this.orchestrator.ingestVirtual({
          virtualFiles,
          sourceIdentifier,
          metadata,
          onProgress: (phase: string, current: number, total: number, message?: string) => {
            if (!clientDisconnected) {
              sendProgress(phase, current, total, message);
            }
          },
        });

        logger.info(`[DEBUG] ingestVirtual completed: ${result.nodesCreated} nodes, ${result.relationshipsCreated} rels`);

        // Phase 5: Generate embeddings
        logger.info(`[DEBUG] Phase 5: generateEmbeddings=${generateEmbeddings}, hasEmbeddingService=${this.orchestrator.hasEmbeddingService()}`);
        let embeddingsGenerated = 0;
        if (generateEmbeddings && this.orchestrator.hasEmbeddingService()) {
          logger.info(`[DEBUG] Starting embedding generation for document: ${metadata.documentId}`);
          sendProgress("embeddings", 0, 0, "Starting embedding generation...");
          embeddingsGenerated = await this.orchestrator.generateEmbeddingsForDocument(
            metadata.documentId,
            (current: number, total: number) => {
              if (!clientDisconnected) {
                sendProgress("embeddings", current, total, `Generating embeddings: ${current}/${total}`);
              }
            }
          );
          sendProgress("embeddings", embeddingsGenerated, embeddingsGenerated, `Generated ${embeddingsGenerated} embeddings`);
        }

        // Success!
        const duration = Date.now() - startTime;
        sendEvent("complete", {
          success: true,
          documentId: metadata.documentId,
          sourceIdentifier,
          filesIngested: virtualFiles.length,
          nodesCreated: result.nodesCreated,
          relationshipsCreated: result.relationshipsCreated,
          embeddingsGenerated,
          durationMs: duration,
        });

        logger.info(`GitHub ingestion complete: ${result.nodesCreated} nodes, ${result.relationshipsCreated} rels, ${embeddingsGenerated} embeddings in ${duration}ms`);

      } catch (err: any) {
        if (!clientDisconnected) {
          logger.error(`GitHub ingestion failed: ${err.message}`);
          sendEvent("error", { success: false, error: err.message });
        }
      } finally {
        // Deactivate log sink (stop forwarding console output to SSE)
        setLogSink(null);
        clearInterval(heartbeat);

        // Cleanup temp directory
        if (tempDir) {
          logger.info(`Cleaning up temp directory: ${tempDir}`);
          await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
            logger.warn(`Failed to cleanup temp dir: ${err.message}`);
          });
        }

        // End SSE stream
        if (!clientDisconnected) {
          reply.raw.end();
        }
      }
    });

    // Get supported file extensions
    this.server.get("/parsers/extensions", async () => ({
      extensions: getSupportedExtensions(),
      count: getSupportedExtensions().length,
    }));

    // Semantic Search (uses SearchService from ragforge core via orchestrator)
    // Supports post-processing: keyword boosting, relationship exploration, summarization, reranking
    // Supports output formatting: json (default), markdown (human-readable with ASCII graph)
    this.server.post<{
      Body: {
        query: string;
        filters?: SearchFilters;
        limit?: number;
        minScore?: number;
        semantic?: boolean;
        hybrid?: boolean;
        embeddingType?: "name" | "content" | "description" | "all";
        // Post-processing options
        boostKeywords?: string[];
        boostWeight?: number;
        exploreDepth?: number;
        summarize?: boolean;
        summarizeContext?: string;
        rerank?: boolean;
        // Output formatting options
        format?: "json" | "markdown" | "compact";
        includeSource?: boolean;
        maxSourceResults?: number;
      };
    }>("/search", async (request, reply) => {
      const {
        query,
        filters = {},
        limit = 20,
        minScore = 0.3,
        semantic = true,
        hybrid = true,
        embeddingType = "all",
        // Post-processing
        boostKeywords,
        boostWeight,
        exploreDepth,
        summarize,
        summarizeContext,
        rerank,
        // Formatting
        format,
        includeSource,
        maxSourceResults,
      } = request.body || {};

      if (!query) {
        reply.status(400);
        return { success: false, error: "Missing query" };
      }

      if (!this.orchestrator) {
        reply.status(503);
        return { success: false, error: "Orchestrator not available" };
      }

      // Check if semantic search is requested but not available
      if (semantic && !this.orchestrator.canDoSemanticSearch()) {
        reply.status(503);
        return { success: false, error: "Semantic search not available (no embedding service)" };
      }

      logger.info(`Search: "${query.substring(0, 50)}..." (semantic: ${semantic}, hybrid: ${hybrid})`);

      try {
        // Use orchestrator's search method which wraps SearchService + post-processing + formatting
        const searchResult = await this.orchestrator.search({
          query,
          categorySlug: filters.categorySlug,
          userId: filters.userId,
          documentId: filters.documentId,
          isPublic: filters.isPublic,
          semantic,
          hybrid,
          embeddingType,
          limit,
          minScore,
          // Post-processing options
          boostKeywords,
          boostWeight,
          exploreDepth,
          summarize,
          summarizeContext,
          rerank,
          // Formatting options
          format,
          includeSource,
          maxSourceResults,
        });

        // Map to API response format
        const searchResults: SearchResult[] = searchResult.results.map((r) => ({
          documentId: r.node.documentId as string,
          chunkId: r.node.chunkId as string | undefined,
          // Use snippet for agent-friendly output (truncated or chunk text)
          content: r.snippet || (r.node.content || r.node.source || r.node.description) as string,
          score: r.score,
          // Include source file info
          sourcePath: (r.filePath || r.node.sourcePath || r.node.file) as string | undefined,
          nodeType: r.node._labels?.[0] as string | undefined,
          // Matched range info (when a chunk matched)
          matchedRange: r.matchedRange,
          // Position info from the node (useful for navigation)
          // For chunks, prefer matchedRange info which has absolute positions
          position: {
            pageNum: (r.matchedRange?.pageNum ?? r.node.pageNum) as number | undefined,
            sectionIndex: r.node.index as number | undefined,
            startLine: (r.matchedRange?.startLine ?? r.node.startLine) as number | undefined,
            endLine: (r.matchedRange?.endLine ?? r.node.endLine) as number | undefined,
          },
          metadata: {
            documentTitle: r.node.documentTitle as string,
            categoryId: r.node.categoryId as string,
            categorySlug: r.node.categorySlug as string,
            userId: r.node.userId as string,
          },
          // Include boost info if present
          keywordBoost: r.keywordBoost,
          entityBoostApplied: r.entityBoostApplied,
          matchedEntities: r.matchedEntities,
        }));

        return {
          success: true,
          query,
          results: searchResults,
          count: searchResults.length,
          totalCount: searchResult.totalCount,
          // Post-processing results
          reranked: searchResult.reranked,
          keywordBoosted: searchResult.keywordBoosted,
          entityBoosted: searchResult.entityBoosted,
          matchingEntities: searchResult.matchingEntities,
          relationshipsExplored: searchResult.relationshipsExplored,
          summarized: searchResult.summarized,
          graph: searchResult.graph,
          summary: searchResult.summary,
          // Formatted output (if format was specified)
          formattedOutput: searchResult.formattedOutput,
        };
      } catch (err: any) {
        logger.error(`Search failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // =========================================================================
    // Entity/Tag Semantic Search (uses EntityEmbeddingService with hybrid BM25 + semantic)
    // =========================================================================
    this.server.post<{
      Body: {
        query: string;
        entityTypes?: string[];
        semantic?: boolean;
        hybrid?: boolean;
        limit?: number;
        minScore?: number;
        projectIds?: string[];
      };
    }>("/search/entities", async (request, reply) => {
      const {
        query,
        entityTypes,
        semantic = true,
        hybrid = true,
        limit = 20,
        minScore = 0.3,
        projectIds,
      } = request.body || {};

      if (!query) {
        reply.status(400);
        return { success: false, error: "Missing query" };
      }

      if (!this.entityEmbedding) {
        reply.status(503);
        return { success: false, error: "Entity embedding service not available" };
      }

      logger.info(`[EntitySearch] "${query.substring(0, 50)}..." (semantic: ${semantic}, hybrid: ${hybrid})`);

      try {
        const results = await this.entityEmbedding.search({
          query,
          entityTypes,
          semantic,
          hybrid,
          limit,
          minScore,
          projectIds,
        });

        return {
          success: true,
          query,
          results,
          count: results.length,
        };
      } catch (err: any) {
        logger.error(`[EntitySearch] Failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // =========================================================================
    // Entity/Tag Stats
    // =========================================================================
    this.server.get("/entities/stats", async (request, reply) => {
      if (!this.entityEmbedding) {
        reply.status(503);
        return { success: false, error: "Entity embedding service not available" };
      }

      try {
        const stats = await this.entityEmbedding.getStats();
        return {
          success: true,
          ...stats,
        };
      } catch (err: any) {
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // =========================================================================
    // Generate Entity/Tag Embeddings (admin endpoint)
    // =========================================================================
    this.server.post("/admin/generate-entity-embeddings", async (request, reply) => {
      if (!this.entityEmbedding) {
        reply.status(503);
        return { success: false, error: "Entity embedding service not available" };
      }

      logger.info("[Admin] Generating entity/tag embeddings...");

      try {
        const result = await this.entityEmbedding.generateEmbeddings();

        return {
          success: true,
          entitiesEmbedded: result.entitiesEmbedded,
          tagsEmbedded: result.tagsEmbedded,
          skipped: result.skipped,
          durationMs: result.durationMs,
        };
      } catch (err: any) {
        logger.error(`[Admin] Entity embedding failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // Delete document
    this.server.delete<{ Params: { documentId: string } }>("/document/:documentId", async (request, reply) => {
      const { documentId } = request.params;
      logger.info( `Deleting document: ${documentId}`);

      try {
        const deletedCount = await this.neo4j!.deleteDocument(documentId);
        return { success: true, documentId, deletedNodes: deletedCount };
      } catch (err: any) {
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // Update document metadata
    this.server.patch<{ Params: { documentId: string }; Body: Partial<CommunityNodeMetadata> }>(
      "/document/:documentId",
      async (request, reply) => {
        const { documentId } = request.params;
        const updates = request.body || {};

        try {
          const updatedCount = await this.neo4j!.updateDocumentMetadata(documentId, updates);
          return { success: true, documentId, updatedNodes: updatedCount };
        } catch (err: any) {
          reply.status(500);
          return { success: false, error: err.message };
        }
      }
    );

    // Ensure vector index
    this.server.post("/indexes/ensure-vector", async (request, reply) => {
      try {
        await this.neo4j!.run(
          `CREATE VECTOR INDEX scope_embedding_content_vector IF NOT EXISTS
           FOR (n:Scope) ON (n.embedding_content)
           OPTIONS {indexConfig: {\`vector.dimensions\`: 1024, \`vector.similarity_function\`: 'cosine'}}`
        );
        return { success: true, message: "Vector index ensured" };
      } catch (err: any) {
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // Debug: Execute Cypher query directly
    this.server.post<{
      Body: {
        query: string;
        params?: Record<string, unknown>;
      };
    }>("/cypher", async (request, reply) => {
      const { query, params = {} } = request.body || {};

      if (!query) {
        reply.status(400);
        return { success: false, error: "Missing query" };
      }

      logger.info(`Cypher: ${query.slice(0, 100)}...`);

      try {
        const result = await this.neo4j!.run(query, params);
        const records = result.records.map((r: any) => r.toObject ? r.toObject() : r);
        return {
          success: true,
          records,
          count: records.length,
        };
      } catch (err: any) {
        logger.error(`Cypher failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // =========================================================================
    // DEBUG: File upload without authentication (for testing)
    // Supports Vision parsing for PDFs when enableVision=true query param is set
    // =========================================================================
    this.server.post<{
      Querystring: {
        enableVision?: string;
        sectionTitles?: string;
        generateTitles?: string;
      };
    }>("/debug/upload", async (request, reply) => {
      if (!this.orchestrator) {
        reply.status(503);
        return { success: false, error: "Orchestrator not available" };
      }

      // Parse options from query string
      const enableVision = request.query.enableVision === "true";
      const sectionTitles = (request.query.sectionTitles as 'none' | 'detect' | 'llm') || 'detect';
      const generateTitles = request.query.generateTitles !== "false"; // Default to true

      try {
        const data = await request.file();
        if (!data) {
          reply.status(400);
          return { success: false, error: "No file uploaded" };
        }

        const buffer = await data.toBuffer();
        const fileName = data.filename;

        // Read form fields from multipart data
        const fields = data.fields as Record<string, { value?: string } | undefined>;
        const getField = (name: string, defaultValue: string): string => {
          const field = fields[name];
          return (field && typeof field === 'object' && 'value' in field) ? (field.value || defaultValue) : defaultValue;
        };

        // Use form fields or defaults
        const documentId = getField('documentId', `debug-${Date.now()}`);
        const documentTitle = getField('documentTitle', fileName.replace(/\.[^.]+$/, ""));
        const categorySlug = getField('categorySlug', 'debug-uploads');
        const categoryId = getField('categoryId', 'cat-debug');
        const userId = getField('userId', 'debug-user');

        logger.info(`[DEBUG] Upload: ${fileName} (${buffer.length} bytes), enableVision: ${enableVision}, documentId: ${documentId}`);

        // Metadata from form fields or defaults
        const metadata = {
          documentId,
          documentTitle,
          categorySlug,
          categoryId,
          userId,
          isPublic: true,
        };

        // Build list of files to ingest (from ZIP or single file)
        const isZip = fileName.toLowerCase().endsWith(".zip");
        const filesToIngest: Array<{ fileName: string; buffer: Buffer }> = [];

        if (isZip) {
          const zip = new AdmZip(buffer);
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            // Use basename to strip directory path from ZIP entry
            filesToIngest.push({
              fileName: basename(entry.entryName),
              buffer: entry.getData(),
            });
          }
          logger.info(`[DEBUG] ZIP extracted: ${filesToIngest.length} files`);
        } else {
          filesToIngest.push({ fileName, buffer });
        }

        // Use unified ingestion from orchestrator
        const result = await this.orchestrator.ingestFiles({
          files: filesToIngest,
          metadata,
          documentId,
          enableVision,
          visionAnalyzer: enableVision ? this.createVisionAnalyzer() : undefined,
          render3D: enableVision ? this.createRender3DFunction() : undefined,
          sectionTitles,
          generateTitles,
          generateEmbeddings: true,
        });

        if (result.nodesCreated === 0) {
          return { success: false, error: "No supported files found" };
        }

        return {
          success: true,
          documentId,
          fileName,
          filesExtracted: filesToIngest.length,
          filesIngested: result.stats.textFiles + result.stats.binaryDocs + result.stats.mediaFiles,
          stats: result.stats,
          nodesCreated: result.nodesCreated,
          relationshipsCreated: result.relationshipsCreated,
          embeddingsGenerated: result.embeddingsGenerated,
          warnings: result.warnings,
        };
      } catch (err: any) {
        logger.error(`[DEBUG] Upload failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // =========================================================================
    // Upload with LLM Enrichment Support
    // =========================================================================
    this.server.post<{
      Querystring: {
        enableEnrichment?: string;
        extractEntities?: string;
        extractTags?: string;
        generateSummary?: string;
        suggestCategory?: string;
      };
    }>("/ingest/upload", async (request, reply) => {
      if (!this.orchestrator) {
        reply.status(503);
        return { success: false, error: "Orchestrator not available" };
      }

      // Parse enrichment options from query string
      const enrichmentEnabled = request.query.enableEnrichment === "true";
      const enrichmentOptions: Partial<EnrichmentOptions> = {
        enableLLMEnrichment: enrichmentEnabled,
        extractEntities: request.query.extractEntities !== "false",
        extractTags: request.query.extractTags !== "false",
        generateSummary: request.query.generateSummary !== "false",
        suggestCategory: request.query.suggestCategory !== "false",
      };

      if (enrichmentEnabled && !this.enrichment) {
        reply.status(400);
        return { success: false, error: "Enrichment requested but ANTHROPIC_API_KEY not configured" };
      }

      try {
        const data = await request.file();
        if (!data) {
          reply.status(400);
          return { success: false, error: "No file uploaded" };
        }

        const buffer = await data.toBuffer();
        const fileName = data.filename;
        const documentId = `doc-${Date.now()}`;
        const projectId = `doc-${documentId}`;

        logger.info(`[Upload] ${fileName} (${buffer.length} bytes), enrichment: ${enrichmentEnabled}`);

        // Default metadata
        const metadata: CommunityNodeMetadata = {
          documentId,
          documentTitle: fileName.replace(/\.[^.]+$/, ""),
          categorySlug: "uploads",
          categoryId: "cat-uploads",
          userId: "api-user",
          isPublic: true,
        };

        // Build list of files to ingest
        const isZip = fileName.toLowerCase().endsWith(".zip");
        const filesToIngest: Array<{ fileName: string; buffer: Buffer }> = [];

        if (isZip) {
          const zip = new AdmZip(buffer);
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory) continue;
            filesToIngest.push({
              fileName: basename(entry.entryName),
              buffer: entry.getData(),
            });
          }
        } else {
          filesToIngest.push({ fileName, buffer });
        }

        // Use unified ingestion
        const result = await this.orchestrator.ingestFiles({
          files: filesToIngest,
          metadata,
          documentId,
          enableVision: false,
          sectionTitles: 'detect',
          generateTitles: true,
          generateEmbeddings: true,
        });

        if (result.nodesCreated === 0) {
          return { success: false, error: "No supported files found" };
        }

        const embeddingsGenerated = result.embeddingsGenerated;

        // LLM Enrichment (if enabled)
        let enrichmentResult = null;
        if (enrichmentEnabled && this.enrichment) {
          logger.info(`[Upload] Running LLM enrichment for ${documentId}...`);

          // Query ONLY document/text nodes for enrichment (NOT code)
          // Includes: markdown, documents, web pages, and vision-described media
          // Excludes: Scope (code), CodeBlock (code in markdown)
          const nodesResult = await this.neo4j!.run(`
            MATCH (n)
            WHERE n.documentId = $documentId
            AND (
              n:MarkdownSection OR n:MarkdownDocument OR
              n:PDFDocument OR n:WordDocument OR n:DataFile OR
              n:WebPage OR
              n:ImageFile OR n:ThreeDFile OR n:MediaFile
            )
            AND NOT n:CodeBlock
            RETURN n.uuid AS uuid, labels(n)[0] AS nodeType, n.name AS name,
                   coalesce(n.content, n.rawContent, n.textContent, n.description, n.visionDescription, n.ocrText, '') AS content
            LIMIT 50
          `, { documentId });

          const nodes: NodeToEnrich[] = nodesResult.records.map((r) => ({
            uuid: r.get("uuid"),
            nodeType: r.get("nodeType"),
            name: r.get("name") || "Untitled",
            content: r.get("content") || "",
          }));

          if (nodes.length > 0) {
            const context: DocumentContext = {
              documentId,
              title: metadata.documentTitle,
              projectId,
              nodes,
            };

            this.enrichment.updateOptions(enrichmentOptions);
            enrichmentResult = await this.enrichment.enrichDocument(context);

            // Store entities with CONTAINS_ENTITY relationships to source nodes
            let entitiesCreated = 0;
            let containsRelCreated = 0;

            if (enrichmentResult.nodeEnrichments) {
              for (const nodeEnrich of enrichmentResult.nodeEnrichments) {
                // Create entities linked to their source node
                if (nodeEnrich.entities && nodeEnrich.entities.length > 0) {
                  for (const entity of nodeEnrich.entities) {
                    await this.neo4j!.run(`
                      // Create Entity node
                      CREATE (e:Entity {
                        uuid: randomUUID(),
                        name: $name,
                        normalizedName: toLower($name),
                        entityType: $type,
                        confidence: $confidence,
                        aliases: $aliases,
                        projectId: $projectId,
                        documentId: $documentId,
                        sourceNodeId: $sourceNodeId,
                        createdAt: datetime()
                      })
                      // Link to source node via CONTAINS_ENTITY
                      WITH e
                      MATCH (source {uuid: $sourceNodeId})
                      CREATE (source)-[:CONTAINS_ENTITY {confidence: $confidence}]->(e)
                    `, {
                      name: entity.name,
                      type: entity.type,
                      confidence: entity.confidence,
                      aliases: entity.aliases || [],
                      projectId,
                      documentId,
                      sourceNodeId: nodeEnrich.nodeId,
                    });
                    entitiesCreated++;
                    containsRelCreated++;
                  }
                }

                // Create HAS_TAG relationships to source nodes
                if (nodeEnrich.tags && nodeEnrich.tags.length > 0) {
                  for (const tag of nodeEnrich.tags) {
                    // Compute normalizedName in JS to match the constraint key
                    const normalizedName = tag.name.toLowerCase().replace(/\s+/g, '-');
                    await this.neo4j!.run(`
                      // Get or create Tag node using normalizedName as unique key
                      MERGE (t:Tag {normalizedName: $normalizedName})
                      ON CREATE SET t.uuid = randomUUID(), t.name = $name, t.category = $category,
                                    t.createdAt = datetime()
                      ON MATCH SET t.name = CASE WHEN t.name IS NULL THEN $name ELSE t.name END
                      SET t.projectIds = CASE
                        WHEN $projectId IN coalesce(t.projectIds, []) THEN t.projectIds
                        ELSE coalesce(t.projectIds, []) + $projectId
                      END,
                      t.usageCount = coalesce(t.usageCount, 0) + 1
                      // Link to source node
                      WITH t
                      MATCH (source {uuid: $sourceNodeId})
                      MERGE (source)-[:HAS_TAG]->(t)
                    `, {
                      name: tag.name,
                      normalizedName,
                      category: tag.category || "other",
                      projectId,
                      sourceNodeId: nodeEnrich.nodeId,
                    });
                  }
                }
              }
            }

            logger.info(`[Upload] Created ${entitiesCreated} Entity nodes, ${containsRelCreated} CONTAINS_ENTITY relations`);
          }
        }

        return {
          success: true,
          documentId,
          fileName,
          filesIngested: result.stats.textFiles + result.stats.binaryDocs + result.stats.mediaFiles,
          stats: result.stats,
          nodesCreated: result.nodesCreated,
          relationshipsCreated: result.relationshipsCreated,
          embeddingsGenerated,
          enrichment: enrichmentResult ? {
            entitiesExtracted: enrichmentResult.entities.length,
            tagsExtracted: enrichmentResult.tags.length,
            suggestedCategory: enrichmentResult.suggestedCategory,
            processingTimeMs: enrichmentResult.metadata.processingTimeMs,
          } : null,
        };
      } catch (err: any) {
        logger.error(`[Upload] Failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // =========================================================================
    // Admin: Entity Resolution (cross-document deduplication)
    // =========================================================================
    this.server.post<{
      Body: {
        dryRun?: boolean;
        minSimilarity?: number;
        maxEntities?: number;
      };
    }>("/admin/resolve-entities", async (request, reply) => {
      if (!this.enrichment) {
        reply.status(400);
        return { success: false, error: "ANTHROPIC_API_KEY not configured - entity resolution requires LLM" };
      }

      const { dryRun = false, minSimilarity = 0.8, maxEntities = 500 } = request.body || {};

      logger.info(`[Admin] Entity resolution started (dryRun: ${dryRun})`);

      try {
        const resolutionService = new EntityResolutionService(
          this.neo4j!,
          process.env.ANTHROPIC_API_KEY!,
          { dryRun, minSimilarity, maxEntities }
        );

        const result = await resolutionService.resolveEntities();
        const canonicalMergeResult = await resolutionService.mergeCanonicals();
        const tagResult = await resolutionService.resolveTags();

        // Generate embeddings for Entity/Tag nodes (for hybrid search)
        let embeddingResult = null;
        if (this.entityEmbedding && !dryRun) {
          logger.info("[Admin] Generating embeddings for Entity/Tag nodes...");
          embeddingResult = await this.entityEmbedding.generateEmbeddings();
          logger.info(`[Admin] Entity embeddings: ${embeddingResult.entitiesEmbedded} entities, ${embeddingResult.tagsEmbedded} tags`);
        }

        logger.info(`[Admin] Resolution complete: ${result.merged.length} entities merged, ${result.created.length} created, ${canonicalMergeResult.merged} canonicals deduplicated, ${tagResult.llmMerged} tags LLM-merged`);

        return {
          success: true,
          entities: {
            merged: result.merged.length,
            created: result.created.length,
            totalProcessed: result.totalProcessed,
            canonicalsMerged: canonicalMergeResult.merged,
          },
          tags: tagResult,
          embeddings: embeddingResult ? {
            entitiesEmbedded: embeddingResult.entitiesEmbedded,
            tagsEmbedded: embeddingResult.tagsEmbedded,
            skipped: embeddingResult.skipped,
            durationMs: embeddingResult.durationMs,
          } : null,
          processingTimeMs: result.processingTimeMs,
          dryRun,
        };
      } catch (err: any) {
        logger.error(`[Admin] Entity resolution failed: ${err.message}`);
        reply.status(500);
        return { success: false, error: err.message };
      }
    });

    // Shutdown
    this.server.post("/shutdown", async () => {
      setTimeout(() => this.shutdown(), 100);
      return { status: "shutting_down" };
    });

    // =========================================================================
    // Chat Agent Routes (Vercel AI SDK + Claude)
    // =========================================================================
    registerChatRoutes(this.server, {
      orchestrator: this.orchestrator!,
      neo4j: this.neo4j!,
    });

    // Vision API Routes (image/PDF/3D analysis)
    // =========================================================================
    registerVisionRoutes(this.server);
  }

  async start(port: number = DEFAULT_PORT): Promise<void> {
    await this.server.listen({ port, host: "127.0.0.1" });
    logger.info(`Community API listening on http://127.0.0.1:${port}`);
    logger.info(`Logs: ${LOG_FILES.dir}`);
    console.log(`📚 Community Docs API running on http://127.0.0.1:${port}`);
    console.log(`📝 Logs: ${LOG_FILES.dir}`);
  }

  async shutdown(): Promise<void> {
    logger.info( "Shutting down...");
    if (this.orchestrator) {
      await this.orchestrator.stop();
    }
    await closeNeo4jClient();
    await this.server.close();
    process.exit(0);
  }
}

export async function startCommunityAPI(options: { port?: number } = {}): Promise<void> {
  const api = new CommunityAPIServer();
  await api.initialize();
  await api.start(options.port);
}

const isMainModule = process.argv[1]?.includes("community-api") || process.argv[1]?.includes("api/server");
if (isMainModule) {
  startCommunityAPI().catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
}
