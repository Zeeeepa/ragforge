/**
 * Touched Files Watcher
 *
 * Processes orphan files (files accessed outside known projects) through states:
 *   dirty → indexed → embedded
 *
 * Reuses existing ingestion patterns:
 * - UniversalSourceAdapter for parsing
 * - EmbeddingService for embeddings
 * - Batch processing with p-limit
 *
 * @since 2025-12-13
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';
import pLimit from 'p-limit';
import type { Neo4jClient } from '../runtime/client/neo4j-client.js';
import type { EmbeddingService } from './embedding-service.js';
import { UniversalSourceAdapter } from '../runtime/adapters/universal-source-adapter.js';
import type { ParsedGraph } from '../runtime/adapters/types.js';

// ============================================
// Types
// ============================================

export type OrphanFileState = 'mentioned' | 'dirty' | 'indexed' | 'embedded';

export interface OrphanFile {
  absolutePath: string;
  state: OrphanFileState;
  uuid: string;
  name: string;
  extension: string;
  hash?: string;
}

export interface TouchedFilesWatcherConfig {
  /** Neo4j client */
  neo4jClient: Neo4jClient;
  /** Embedding service (optional - if not provided, files stay at 'indexed') */
  embeddingService?: EmbeddingService;
  /** Project ID for touched-files */
  projectId?: string;
  /** Batch size for parsing (default: 10) */
  parsingBatchSize?: number;
  /** Batch size for embeddings (default: 500) */
  embeddingBatchSize?: number;
  /** Verbose logging */
  verbose?: boolean;
  /** Callback when processing starts */
  onProcessingStart?: (dirtyCount: number, indexedCount: number) => void;
  /** Callback when batch completes */
  onBatchComplete?: (stats: ProcessingStats) => void;
  /** Callback when all processing completes */
  onProcessingComplete?: (stats: ProcessingStats) => void;
  /**
   * Callback when a file transitions to 'indexed' state
   * Used to resolve PENDING_IMPORT → CONSUMES relations
   */
  onFileIndexed?: (filePath: string) => Promise<void>;
  /**
   * Callback to create a mentioned file (for unresolved imports)
   * Returns true if the mentioned file was created or already exists
   */
  onCreateMentionedFile?: (
    targetPath: string,
    importedBy: {
      filePath: string;
      scopeUuid?: string;
      symbols: string[];
      importPath: string;
    }
  ) => Promise<{ created: boolean; fileState: string }>;
  /**
   * Callback to check if a file exists in the graph and get its state
   */
  onGetFileState?: (absolutePath: string) => Promise<string | null>;
}

export interface ProcessingStats {
  /** Files parsed (dirty → indexed) */
  parsed: number;
  /** Files embedded (indexed → embedded) */
  embedded: number;
  /** Files skipped (unchanged hash) */
  skipped: number;
  /** Errors encountered */
  errors: number;
  /** Duration in ms */
  durationMs: number;
}

// ============================================
// Touched Files Watcher
// ============================================

export class TouchedFilesWatcher {
  private neo4jClient: Neo4jClient;
  private embeddingService?: EmbeddingService;
  private projectId: string;
  private parsingBatchSize: number;
  private embeddingBatchSize: number;
  private verbose: boolean;
  private adapter: UniversalSourceAdapter;
  private isProcessing = false;
  private config: TouchedFilesWatcherConfig;

  constructor(config: TouchedFilesWatcherConfig) {
    this.config = config;
    this.neo4jClient = config.neo4jClient;
    this.embeddingService = config.embeddingService;
    this.projectId = config.projectId || 'touched-files';
    this.parsingBatchSize = config.parsingBatchSize || 10;
    this.embeddingBatchSize = config.embeddingBatchSize || 500;
    this.verbose = config.verbose || false;
    this.adapter = new UniversalSourceAdapter();
  }

  /**
   * Check if processing is in progress
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Process all pending orphan files (dirty → indexed → embedded)
   * This is the main entry point for batch processing
   */
  async processAll(): Promise<ProcessingStats> {
    if (this.isProcessing) {
      if (this.verbose) {
        console.log('[TouchedFilesWatcher] Already processing, skipping');
      }
      return { parsed: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };
    }

    this.isProcessing = true;
    const startTime = Date.now();
    const stats: ProcessingStats = { parsed: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

    try {
      // Get counts for callback
      const dirtyFiles = await this.getFilesByState('dirty');
      const indexedFiles = await this.getFilesByState('indexed');

      if (dirtyFiles.length === 0 && indexedFiles.length === 0) {
        if (this.verbose) {
          console.log('[TouchedFilesWatcher] No pending files to process');
        }
        return stats;
      }

      this.config.onProcessingStart?.(dirtyFiles.length, indexedFiles.length);

      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] Processing ${dirtyFiles.length} dirty, ${indexedFiles.length} indexed files`);
      }

      // Phase 1: dirty → indexed (parsing)
      if (dirtyFiles.length > 0) {
        const parseStats = await this.processDirtyFiles(dirtyFiles);
        stats.parsed = parseStats.parsed;
        stats.skipped += parseStats.skipped;
        stats.errors += parseStats.errors;
      }

      // Phase 2: indexed → embedded (embeddings)
      // Re-fetch indexed files as some may have been added from dirty
      const toEmbed = await this.getFilesByState('indexed');
      if (toEmbed.length > 0 && this.embeddingService) {
        const embedStats = await this.processIndexedFiles(toEmbed);
        stats.embedded = embedStats.embedded;
        stats.errors += embedStats.errors;
      }

      stats.durationMs = Date.now() - startTime;
      this.config.onProcessingComplete?.(stats);

      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] Complete: ${stats.parsed} parsed, ${stats.embedded} embedded, ${stats.skipped} skipped, ${stats.errors} errors (${stats.durationMs}ms)`);
      }

      return stats;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process files in a specific directory (used by brain_search)
   * Returns when all files in the directory are embedded
   */
  async processDirectory(dirPath: string, timeout = 30000): Promise<ProcessingStats> {
    const absoluteDirPath = path.resolve(dirPath);
    const startTime = Date.now();
    const stats: ProcessingStats = { parsed: 0, embedded: 0, skipped: 0, errors: 0, durationMs: 0 };

    // Get pending files in directory
    const pendingFiles = await this.getPendingFilesInDirectory(absoluteDirPath);

    if (pendingFiles.length === 0) {
      return stats;
    }

    if (this.verbose) {
      console.log(`[TouchedFilesWatcher] Processing ${pendingFiles.length} pending files in ${absoluteDirPath}`);
    }

    // Process with timeout
    const deadline = startTime + timeout;

    // Phase 1: Parse dirty files
    const dirtyFiles = pendingFiles.filter(f => f.state === 'dirty');
    if (dirtyFiles.length > 0) {
      const parseStats = await this.processDirtyFiles(dirtyFiles);
      stats.parsed = parseStats.parsed;
      stats.skipped += parseStats.skipped;
      stats.errors += parseStats.errors;
    }

    // Check timeout
    if (Date.now() > deadline) {
      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] Timeout reached after parsing`);
      }
      stats.durationMs = Date.now() - startTime;
      return stats;
    }

    // Phase 2: Embed indexed files
    if (this.embeddingService) {
      const toEmbed = await this.getPendingFilesInDirectory(absoluteDirPath);
      const indexedFiles = toEmbed.filter(f => f.state === 'indexed');

      if (indexedFiles.length > 0) {
        const embedStats = await this.processIndexedFiles(indexedFiles);
        stats.embedded = embedStats.embedded;
        stats.errors += embedStats.errors;
      }
    }

    stats.durationMs = Date.now() - startTime;
    return stats;
  }

  // ============================================
  // Phase 1: Parsing (dirty → indexed)
  // ============================================

  /**
   * Process dirty files: parse and create scopes
   */
  private async processDirtyFiles(files: OrphanFile[]): Promise<{ parsed: number; skipped: number; errors: number }> {
    const limit = pLimit(this.parsingBatchSize);
    let parsed = 0;
    let skipped = 0;
    let errors = 0;

    await Promise.all(
      files.map(file =>
        limit(async () => {
          try {
            const result = await this.parseAndIngestFile(file);
            if (result === 'parsed') {
              parsed++;
            } else if (result === 'skipped') {
              skipped++;
            }
          } catch (err: any) {
            errors++;
            console.error(`[TouchedFilesWatcher] Error parsing ${file.absolutePath}: ${err.message}`);
          }
        })
      )
    );

    return { parsed, skipped, errors };
  }

  /**
   * Parse a single file and create scopes
   */
  private async parseAndIngestFile(file: OrphanFile): Promise<'parsed' | 'skipped' | 'error'> {
    // Read file content
    let content: string;
    try {
      content = await fs.readFile(file.absolutePath, 'utf-8');
    } catch (err: any) {
      // File may have been deleted
      if (err.code === 'ENOENT') {
        await this.markFileDeleted(file.absolutePath);
        return 'skipped';
      }
      throw err;
    }

    // Compute content hash
    const newHash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);

    // Check if unchanged (skip re-parsing)
    if (file.hash === newHash) {
      // Just transition to indexed (scopes already exist)
      await this.updateFileState(file.absolutePath, 'indexed');
      return 'skipped';
    }

    // Parse the file using SourceConfig format
    const parseResult = await this.adapter.parse({
      source: {
        type: 'code',
        root: path.dirname(file.absolutePath),
        include: [file.name],
      },
      projectId: this.projectId,
    });

    if (!parseResult || !parseResult.graph || parseResult.graph.nodes.length === 0) {
      // No scopes extracted - still mark as indexed
      await this.updateFileState(file.absolutePath, 'indexed', { hash: newHash });
      return 'parsed';
    }

    // Delete existing scopes for this file (if any)
    await this.deleteFileScopes(file.absolutePath);

    // Create scopes in Neo4j
    await this.createScopes(parseResult.graph, file);

    // Process imports and create PENDING_IMPORT or CONSUMES relations
    try {
      await this.processFileImports(file.absolutePath, content);
    } catch (err: any) {
      if (this.verbose) {
        console.warn(`[TouchedFilesWatcher] Error processing imports for ${file.name}: ${err.message}`);
      }
    }

    // Update file state
    await this.updateFileState(file.absolutePath, 'indexed', {
      hash: newHash,
      lineCount: content.split('\n').length,
    });

    // Notify that file was indexed (to resolve PENDING_IMPORT relations)
    if (this.config.onFileIndexed) {
      try {
        await this.config.onFileIndexed(file.absolutePath);
      } catch (err: any) {
        // Don't fail the whole ingestion if import resolution fails
        if (this.verbose) {
          console.warn(`[TouchedFilesWatcher] Error resolving imports for ${file.name}: ${err.message}`);
        }
      }
    }

    if (this.verbose) {
      console.log(`[TouchedFilesWatcher] Parsed ${file.name}: ${parseResult.graph.nodes.length} nodes`);
    }

    return 'parsed';
  }

  /**
   * Create scope nodes in Neo4j
   */
  private async createScopes(graph: ParsedGraph, file: OrphanFile): Promise<void> {
    for (const node of graph.nodes) {
      // Adapt node properties for touched-files context
      const nodeProps: Record<string, any> = {
        ...node.properties,
        uuid: node.id || crypto.randomUUID(),
        projectId: this.projectId,
        file: file.absolutePath,
        absolutePath: file.absolutePath,
        // Mark as needing embeddings
        embeddingsDirty: true,
      };

      // Determine label (first label or default to Scope)
      const label = node.labels[0] || 'Scope';

      // Build properties string for Cypher
      const propKeys = Object.keys(nodeProps);
      const propAssignments = propKeys.map(k => `n.${k} = $props.${k}`).join(', ');

      await this.neo4jClient.run(
        `CREATE (n:${label})
         SET ${propAssignments}
         WITH n
         MATCH (f:File {absolutePath: $filePath})
         CREATE (n)-[:DEFINED_IN]->(f)`,
        { props: nodeProps, filePath: file.absolutePath }
      );
    }

    // Create relationships
    if (graph.relationships) {
      for (const rel of graph.relationships) {
        await this.neo4jClient.run(
          `MATCH (source {uuid: $sourceId}), (target {uuid: $targetId})
           CREATE (source)-[:${rel.type}]->(target)`,
          { sourceId: rel.from, targetId: rel.to }
        );
      }
    }
  }

  /**
   * Delete existing scopes for a file
   */
  private async deleteFileScopes(absolutePath: string): Promise<void> {
    await this.neo4jClient.run(
      `MATCH (n)-[:DEFINED_IN]->(f:File {absolutePath: $absolutePath})
       WHERE n.projectId = $projectId
       DETACH DELETE n`,
      { absolutePath, projectId: this.projectId }
    );
  }

  // ============================================
  // Phase 2: Embeddings (indexed → embedded)
  // ============================================

  /**
   * Process indexed files: generate embeddings
   *
   * Uses the standard EmbeddingService for the touched-files project.
   * The service will automatically find and embed all scopes with embeddingsDirty=true.
   */
  private async processIndexedFiles(files: OrphanFile[]): Promise<{ embedded: number; errors: number }> {
    if (!this.embeddingService) {
      // No embedding service available - files stay at 'indexed' state
      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] No embedding service, ${files.length} files remain at 'indexed'`);
      }
      return { embedded: 0, errors: 0 };
    }

    try {
      // Generate embeddings for all scopes in the touched-files project
      // The service will find nodes with embeddingsDirty=true or missing embeddings
      const result = await this.embeddingService.generateMultiEmbeddings({
        projectId: this.projectId,
        verbose: this.verbose,
        incrementalOnly: true,
      });

      // Mark files as embedded only on success
      for (const file of files) {
        await this.updateFileState(file.absolutePath, 'embedded');
      }

      if (this.verbose) {
        console.log(`[TouchedFilesWatcher] Embedded ${result.totalEmbedded} vectors for ${files.length} files`);
      }

      return { embedded: files.length, errors: 0 };
    } catch (err: any) {
      // On error, files stay at 'indexed' for retry later
      console.error(`[TouchedFilesWatcher] Error generating embeddings: ${err.message}`);
      return { embedded: 0, errors: files.length };
    }
  }

  // ============================================
  // Query Helpers
  // ============================================

  /**
   * Get files by state
   */
  private async getFilesByState(state: OrphanFileState): Promise<OrphanFile[]> {
    const result = await this.neo4jClient.run(
      `MATCH (f:File {projectId: $projectId, state: $state})
       RETURN f.absolutePath AS absolutePath, f.state AS state, f.uuid AS uuid,
              f.name AS name, f.extension AS extension, f.hash AS hash`,
      { projectId: this.projectId, state }
    );

    return result.records.map(r => ({
      absolutePath: r.get('absolutePath'),
      state: r.get('state'),
      uuid: r.get('uuid'),
      name: r.get('name'),
      extension: r.get('extension'),
      hash: r.get('hash'),
    }));
  }

  /**
   * Get pending files in a directory (not 'embedded')
   */
  private async getPendingFilesInDirectory(dirPath: string): Promise<OrphanFile[]> {
    const result = await this.neo4jClient.run(
      `MATCH (f:File {projectId: $projectId})-[:IN_DIRECTORY*]->(d:Directory)
       WHERE (d.path = $dirPath OR d.path STARTS WITH $dirPathPrefix)
         AND f.state <> 'embedded'
       RETURN DISTINCT f.absolutePath AS absolutePath, f.state AS state, f.uuid AS uuid,
              f.name AS name, f.extension AS extension, f.hash AS hash`,
      {
        projectId: this.projectId,
        dirPath,
        dirPathPrefix: dirPath + path.sep,
      }
    );

    return result.records.map(r => ({
      absolutePath: r.get('absolutePath'),
      state: r.get('state'),
      uuid: r.get('uuid'),
      name: r.get('name'),
      extension: r.get('extension'),
      hash: r.get('hash'),
    }));
  }

  /**
   * Update file state
   */
  private async updateFileState(
    absolutePath: string,
    newState: OrphanFileState,
    additionalProps?: Record<string, any>
  ): Promise<void> {
    const props: Record<string, any> = { state: newState };
    if (additionalProps) {
      Object.assign(props, additionalProps);
    }

    const propAssignments = Object.keys(props)
      .map(k => `f.${k} = $props.${k}`)
      .join(', ');

    await this.neo4jClient.run(
      `MATCH (f:File {absolutePath: $absolutePath, projectId: $projectId})
       SET ${propAssignments}`,
      { absolutePath, projectId: this.projectId, props }
    );
  }

  /**
   * Mark a file as deleted (remove from graph)
   */
  private async markFileDeleted(absolutePath: string): Promise<void> {
    // Delete scopes first
    await this.deleteFileScopes(absolutePath);

    // Delete the file node
    await this.neo4jClient.run(
      `MATCH (f:File {absolutePath: $absolutePath, projectId: $projectId})
       DETACH DELETE f`,
      { absolutePath, projectId: this.projectId }
    );

    if (this.verbose) {
      console.log(`[TouchedFilesWatcher] Deleted ${absolutePath} (file not found)`);
    }
  }

  // ============================================
  // Import Processing
  // ============================================

  /**
   * Process imports from a file and create PENDING_IMPORT or CONSUMES relations
   *
   * @param filePath - Absolute path to the file being processed
   * @param content - File content
   */
  private async processFileImports(filePath: string, content: string): Promise<void> {
    if (!this.config.onCreateMentionedFile || !this.config.onGetFileState) {
      // Callbacks not configured, skip import processing
      return;
    }

    const imports = this.extractImportsFromContent(content, filePath);
    if (imports.length === 0) {
      return;
    }

    for (const imp of imports) {
      // Only process local imports (relative paths)
      if (!imp.isLocal) {
        continue;
      }

      // Resolve the import path to absolute
      const resolvedPath = await this.resolveImportPath(imp.source, filePath);
      if (!resolvedPath) {
        continue;
      }

      // Check if target file exists in graph and its state
      const targetState = await this.config.onGetFileState(resolvedPath);

      if (targetState === 'indexed' || targetState === 'embedded') {
        // Target is already indexed - create CONSUMES relation directly
        await this.createConsumesRelation(filePath, resolvedPath, imp.symbols);
      } else {
        // Target not indexed - create mentioned file + PENDING_IMPORT
        await this.config.onCreateMentionedFile(resolvedPath, {
          filePath,
          symbols: imp.symbols,
          importPath: imp.source,
        });
      }
    }
  }

  /**
   * Extract imports from file content
   * Returns structured import information
   */
  private extractImportsFromContent(
    content: string,
    filePath: string
  ): Array<{
    source: string;
    symbols: string[];
    isLocal: boolean;
  }> {
    const imports: Array<{ source: string; symbols: string[]; isLocal: boolean }> = [];
    const ext = path.extname(filePath).toLowerCase();

    // TypeScript/JavaScript imports
    if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      // Named imports: import { foo, bar } from './module'
      const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
      let match;
      while ((match = namedImportRegex.exec(content)) !== null) {
        const symbols = match[1].split(',').map(s => {
          // Handle "foo as bar" aliases
          const parts = s.trim().split(/\s+as\s+/);
          return parts[0].trim();
        }).filter(s => s.length > 0);
        const source = match[2];
        imports.push({
          source,
          symbols,
          isLocal: source.startsWith('.') || source.startsWith('/'),
        });
      }

      // Default imports: import Foo from './module'
      const defaultImportRegex = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
      while ((match = defaultImportRegex.exec(content)) !== null) {
        const symbol = match[1];
        const source = match[2];
        // Skip if already captured as named import
        if (!imports.some(i => i.source === source)) {
          imports.push({
            source,
            symbols: [symbol],
            isLocal: source.startsWith('.') || source.startsWith('/'),
          });
        }
      }

      // Namespace imports: import * as Foo from './module'
      const namespaceImportRegex = /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
      while ((match = namespaceImportRegex.exec(content)) !== null) {
        const alias = match[1];
        const source = match[2];
        imports.push({
          source,
          symbols: ['*'],
          isLocal: source.startsWith('.') || source.startsWith('/'),
        });
      }

      // Dynamic imports: import('./module') or require('./module')
      const dynamicImportRegex = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = dynamicImportRegex.exec(content)) !== null) {
        const source = match[1];
        if (!imports.some(i => i.source === source)) {
          imports.push({
            source,
            symbols: ['*'],
            isLocal: source.startsWith('.') || source.startsWith('/'),
          });
        }
      }
    }

    // Python imports
    if (['.py', '.pyw'].includes(ext)) {
      // from .module import foo, bar
      const fromImportRegex = /from\s+(\S+)\s+import\s+([^#\n]+)/g;
      let match;
      while ((match = fromImportRegex.exec(content)) !== null) {
        const source = match[1];
        const symbols = match[2].split(',').map(s => {
          const parts = s.trim().split(/\s+as\s+/);
          return parts[0].trim();
        }).filter(s => s.length > 0 && s !== '*');
        imports.push({
          source,
          symbols: symbols.length > 0 ? symbols : ['*'],
          isLocal: source.startsWith('.'),
        });
      }
    }

    // Markdown links and images
    if (['.md', '.mdx', '.markdown'].includes(ext)) {
      let match;

      // Markdown links: [text](./path/to/file.md) or [text](../other.ts)
      const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
      while ((match = linkRegex.exec(content)) !== null) {
        const linkText = match[1];
        const linkPath = match[2];

        // Skip external links (http/https), anchors (#), and mailto
        if (
          linkPath.startsWith('http://') ||
          linkPath.startsWith('https://') ||
          linkPath.startsWith('#') ||
          linkPath.startsWith('mailto:')
        ) {
          continue;
        }

        // Handle anchor in relative paths: ./file.md#section -> ./file.md
        const pathWithoutAnchor = linkPath.split('#')[0];
        if (pathWithoutAnchor && (pathWithoutAnchor.startsWith('.') || pathWithoutAnchor.startsWith('/'))) {
          imports.push({
            source: pathWithoutAnchor,
            symbols: [linkText || 'link'],
            isLocal: true,
          });
        }
      }

      // Markdown images: ![alt](./path/to/image.png)
      const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      while ((match = imgRegex.exec(content)) !== null) {
        const altText = match[1];
        const imgPath = match[2];

        // Skip external images
        if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
          continue;
        }

        if (imgPath.startsWith('.') || imgPath.startsWith('/')) {
          imports.push({
            source: imgPath,
            symbols: [altText || 'image'],
            isLocal: true,
          });
        }
      }
    }

    // CSS/SCSS @import
    if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
      let match;

      // @import "./path/to/file.css" or @import url("./file.css")
      const importRegex = /@import\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]\s*\)?/g;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[1];

        // Skip external URLs
        if (importPath.startsWith('http://') || importPath.startsWith('https://')) {
          continue;
        }

        if (importPath.startsWith('.') || importPath.startsWith('/')) {
          imports.push({
            source: importPath,
            symbols: ['stylesheet'],
            isLocal: true,
          });
        }
      }

      // CSS url() references for images/fonts
      const urlRegex = /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/g;
      while ((match = urlRegex.exec(content)) !== null) {
        const urlPath = match[1];

        // Skip external URLs and data URIs
        if (
          urlPath.startsWith('http://') ||
          urlPath.startsWith('https://') ||
          urlPath.startsWith('data:')
        ) {
          continue;
        }

        if (urlPath.startsWith('.') || urlPath.startsWith('/')) {
          imports.push({
            source: urlPath,
            symbols: ['asset'],
            isLocal: true,
          });
        }
      }
    }

    // HTML references
    if (['.html', '.htm', '.xhtml'].includes(ext)) {
      let match;

      // <script src="./script.js">
      const scriptRegex = /<script[^>]+src\s*=\s*['"]([^'"]+)['"]/gi;
      while ((match = scriptRegex.exec(content)) !== null) {
        const src = match[1];
        if (!src.startsWith('http://') && !src.startsWith('https://')) {
          if (src.startsWith('.') || src.startsWith('/')) {
            imports.push({
              source: src,
              symbols: ['script'],
              isLocal: true,
            });
          }
        }
      }

      // <link href="./styles.css">
      const linkRegex = /<link[^>]+href\s*=\s*['"]([^'"]+)['"]/gi;
      while ((match = linkRegex.exec(content)) !== null) {
        const href = match[1];
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
          if (href.startsWith('.') || href.startsWith('/')) {
            imports.push({
              source: href,
              symbols: ['stylesheet'],
              isLocal: true,
            });
          }
        }
      }

      // <img src="./image.png">
      const imgRegex = /<img[^>]+src\s*=\s*['"]([^'"]+)['"]/gi;
      while ((match = imgRegex.exec(content)) !== null) {
        const src = match[1];
        if (!src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
          if (src.startsWith('.') || src.startsWith('/')) {
            imports.push({
              source: src,
              symbols: ['image'],
              isLocal: true,
            });
          }
        }
      }

      // <a href="./other.html"> (internal links)
      const anchorRegex = /<a[^>]+href\s*=\s*['"]([^'"]+)['"]/gi;
      while ((match = anchorRegex.exec(content)) !== null) {
        const href = match[1];
        // Skip external, anchors, mailto, javascript
        if (
          href.startsWith('http://') ||
          href.startsWith('https://') ||
          href.startsWith('#') ||
          href.startsWith('mailto:') ||
          href.startsWith('javascript:')
        ) {
          continue;
        }

        const pathWithoutAnchor = href.split('#')[0];
        if (pathWithoutAnchor && (pathWithoutAnchor.startsWith('.') || pathWithoutAnchor.startsWith('/'))) {
          imports.push({
            source: pathWithoutAnchor,
            symbols: ['link'],
            isLocal: true,
          });
        }
      }
    }

    // Vue/Svelte - extract from script section (simplified)
    if (['.vue', '.svelte'].includes(ext)) {
      // Extract script content and use TS/JS rules
      const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      if (scriptMatch) {
        const scriptContent = scriptMatch[1];

        // Named imports
        const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
        let match;
        while ((match = namedImportRegex.exec(scriptContent)) !== null) {
          const symbols = match[1].split(',').map(s => {
            const parts = s.trim().split(/\s+as\s+/);
            return parts[0].trim();
          }).filter(s => s.length > 0);
          const source = match[2];
          imports.push({
            source,
            symbols,
            isLocal: source.startsWith('.') || source.startsWith('/'),
          });
        }

        // Default imports
        const defaultImportRegex = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
        while ((match = defaultImportRegex.exec(scriptContent)) !== null) {
          const symbol = match[1];
          const source = match[2];
          if (!imports.some(i => i.source === source)) {
            imports.push({
              source,
              symbols: [symbol],
              isLocal: source.startsWith('.') || source.startsWith('/'),
            });
          }
        }
      }
    }

    return imports;
  }

  /**
   * Resolve import path to absolute file path
   * Handles relative imports and extension resolution
   */
  private async resolveImportPath(
    importPath: string,
    currentFile: string
  ): Promise<string | null> {
    // Only handle relative imports for now
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const currentDir = path.dirname(currentFile);
    let resolved = path.resolve(currentDir, importPath);

    // Try various extensions
    const candidates = this.getImportCandidates(resolved);

    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          return candidate;
        }
      } catch {
        // File doesn't exist, try next candidate
      }
    }

    return null;
  }

  /**
   * Get candidate file paths for an import
   * Supports multiple file types: code, markdown, CSS, HTML, images, fonts
   */
  private getImportCandidates(basePath: string): string[] {
    const candidates: string[] = [];

    // If already has extension, try as-is first
    const ext = path.extname(basePath).toLowerCase();
    if (ext) {
      candidates.push(basePath);

      // Extension-specific alternatives
      if (ext === '.js') {
        candidates.push(basePath.replace(/\.js$/i, '.ts'));
        candidates.push(basePath.replace(/\.js$/i, '.tsx'));
      } else if (ext === '.css') {
        candidates.push(basePath.replace(/\.css$/i, '.scss'));
        candidates.push(basePath.replace(/\.css$/i, '.sass'));
        candidates.push(basePath.replace(/\.css$/i, '.less'));
      }

      // If it has an extension, we likely want exactly that file
      return candidates;
    }

    // No extension - try common code extensions first
    candidates.push(`${basePath}.ts`);
    candidates.push(`${basePath}.tsx`);
    candidates.push(`${basePath}.js`);
    candidates.push(`${basePath}.jsx`);
    candidates.push(`${basePath}.mjs`);
    candidates.push(`${basePath}.cjs`);

    // Markdown
    candidates.push(`${basePath}.md`);
    candidates.push(`${basePath}.mdx`);
    candidates.push(`${basePath}.markdown`);

    // Stylesheets
    candidates.push(`${basePath}.css`);
    candidates.push(`${basePath}.scss`);
    candidates.push(`${basePath}.sass`);
    candidates.push(`${basePath}.less`);

    // HTML
    candidates.push(`${basePath}.html`);
    candidates.push(`${basePath}.htm`);

    // Vue/Svelte
    candidates.push(`${basePath}.vue`);
    candidates.push(`${basePath}.svelte`);

    // Images (common formats)
    candidates.push(`${basePath}.png`);
    candidates.push(`${basePath}.jpg`);
    candidates.push(`${basePath}.jpeg`);
    candidates.push(`${basePath}.gif`);
    candidates.push(`${basePath}.svg`);
    candidates.push(`${basePath}.webp`);

    // Fonts
    candidates.push(`${basePath}.woff`);
    candidates.push(`${basePath}.woff2`);
    candidates.push(`${basePath}.ttf`);
    candidates.push(`${basePath}.eot`);

    // Python
    candidates.push(`${basePath}.py`);
    candidates.push(path.join(basePath, '__init__.py'));

    // Data files
    candidates.push(`${basePath}.json`);
    candidates.push(`${basePath}.yaml`);
    candidates.push(`${basePath}.yml`);

    // Try as directory with index file (code only)
    candidates.push(path.join(basePath, 'index.ts'));
    candidates.push(path.join(basePath, 'index.tsx'));
    candidates.push(path.join(basePath, 'index.js'));
    candidates.push(path.join(basePath, 'index.jsx'));
    candidates.push(path.join(basePath, 'index.md'));
    candidates.push(path.join(basePath, 'README.md'));

    return candidates;
  }

  /**
   * Create CONSUMES relation between scopes, or REFERENCES for non-code files
   * Handles both code files (with Scopes) and assets (images, stylesheets, etc.)
   */
  private async createConsumesRelation(
    sourceFile: string,
    targetFile: string,
    symbols: string[]
  ): Promise<void> {
    // Determine target file type
    const targetExt = path.extname(targetFile).toLowerCase();
    const isAsset = this.isAssetFile(targetExt);
    const isMarkdown = ['.md', '.mdx', '.markdown'].includes(targetExt);

    if (isAsset) {
      // For assets (images, fonts), create REFERENCES_ASSET relationship
      await this.neo4jClient.run(`
        MATCH (sourceFile:File {absolutePath: $sourceFile})
        MATCH (targetFile:File {absolutePath: $targetFile})
        MERGE (sourceFile)-[:REFERENCES_ASSET {symbols: $symbols}]->(targetFile)
      `, { sourceFile, targetFile, symbols });
    } else if (isMarkdown) {
      // For markdown, create REFERENCES_DOC relationship
      await this.neo4jClient.run(`
        MATCH (sourceFile:File {absolutePath: $sourceFile})
        MATCH (targetFile:File {absolutePath: $targetFile})
        MERGE (sourceFile)-[:REFERENCES_DOC {symbols: $symbols}]->(targetFile)
      `, { sourceFile, targetFile, symbols });
    } else {
      // For code files, try to create CONSUMES between Scopes
      const result = await this.neo4jClient.run(`
        MATCH (sourceFile:File {absolutePath: $sourceFile})
        MATCH (targetFile:File {absolutePath: $targetFile})

        // Try to find scopes in both files
        OPTIONAL MATCH (sourceScope:Scope)-[:DEFINED_IN]->(sourceFile)
        OPTIONAL MATCH (targetScope:Scope)-[:DEFINED_IN]->(targetFile)
        WHERE targetScope IS NOT NULL AND (
          targetScope.name IN $symbols
          OR targetScope.exportedAs IN $symbols
          OR $hasWildcard
        )

        // Create CONSUMES if both have scopes
        FOREACH (_ IN CASE WHEN sourceScope IS NOT NULL AND targetScope IS NOT NULL
          THEN [1] ELSE [] END |
          MERGE (sourceScope)-[:CONSUMES]->(targetScope)
        )

        // Return whether scopes were found
        RETURN count(sourceScope) as sourceScopes, count(targetScope) as targetScopes
      `, {
        sourceFile,
        targetFile,
        symbols,
        hasWildcard: symbols.includes('*'),
      });

      // If no scopes found, create file-level IMPORTS relationship as fallback
      const record = result.records[0];
      if (record) {
        const sourceScopes = record.get('sourceScopes')?.toNumber?.() ?? record.get('sourceScopes') ?? 0;
        const targetScopes = record.get('targetScopes')?.toNumber?.() ?? record.get('targetScopes') ?? 0;

        if (sourceScopes === 0 || targetScopes === 0) {
          await this.neo4jClient.run(`
            MATCH (sourceFile:File {absolutePath: $sourceFile})
            MATCH (targetFile:File {absolutePath: $targetFile})
            MERGE (sourceFile)-[:IMPORTS {symbols: $symbols}]->(targetFile)
          `, { sourceFile, targetFile, symbols });
        }
      }
    }
  }

  /**
   * Check if file extension represents an asset (non-code) file
   */
  private isAssetFile(ext: string): boolean {
    const assetExtensions = [
      // Images
      '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
      // Fonts
      '.woff', '.woff2', '.ttf', '.eot', '.otf',
      // Audio/Video
      '.mp3', '.mp4', '.webm', '.ogg', '.wav',
      // Other assets
      '.pdf', '.zip', '.tar', '.gz',
    ];
    return assetExtensions.includes(ext.toLowerCase());
  }
}
