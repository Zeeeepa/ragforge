/**
 * Entity Embedding Service
 *
 * Generates and manages embeddings for Entity, CanonicalEntity, and Tag nodes
 * to enable semantic search on extracted entities.
 *
 * Uses the same hybrid BM25 + semantic search approach as the main SearchService.
 *
 * Embedding strategy:
 * - Entity/CanonicalEntity: embedding_name (name + aliases)
 * - Tag: embedding_name (name + aliases)
 *
 * @since 2026-01-07
 */

import neo4j from 'neo4j-driver';
import crypto from 'crypto';
import type { Neo4jClient } from './neo4j-client';
import { logger } from './logger';

// ============================================================================
// Types
// ============================================================================

export interface EntityEmbeddingConfig {
  /** Neo4j client */
  neo4jClient: Neo4jClient;
  /** Function to generate embeddings (from EmbeddingService) */
  embedFunction: (texts: string[]) => Promise<number[][]>;
  /** Function to get single embedding for query */
  embedSingle: (text: string) => Promise<number[] | null>;
  /** Embedding dimension (e.g., 1024 for Ollama, 3072 for Gemini) */
  dimension: number;
  /** Verbose logging */
  verbose?: boolean;
}

export interface EntityEmbeddingResult {
  /** Number of entities embedded */
  entitiesEmbedded: number;
  /** Number of tags embedded */
  tagsEmbedded: number;
  /** Number skipped (cached) */
  skipped: number;
  /** Duration in ms */
  durationMs: number;
}

export interface EntitySearchOptions {
  /** Search query */
  query: string;
  /** Entity types to search (default: all) */
  entityTypes?: string[];
  /** Use semantic search (default: true) */
  semantic?: boolean;
  /** Use hybrid search (semantic + BM25) (default: true when semantic) */
  hybrid?: boolean;
  /** Maximum results (default: 20) */
  limit?: number;
  /** Minimum score (default: 0.3) */
  minScore?: number;
  /** Filter by project IDs */
  projectIds?: string[];
}

export interface EntitySearchResult {
  /** Node type: 'CanonicalEntity' or 'Tag' */
  nodeType: 'CanonicalEntity' | 'Tag';
  /** Node UUID */
  uuid: string;
  /** Name */
  name: string;
  /** Entity type (for CanonicalEntity) */
  entityType?: string;
  /** Category (for Tag) */
  category?: string;
  /** Aliases */
  aliases?: string[];
  /** Similarity score */
  score: number;
  /** Number of documents this entity appears in */
  documentCount?: number;
  /** Project IDs */
  projectIds?: string[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Hash content for change detection
 */
function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').substring(0, 16);
}

/**
 * Build searchable text for an entity
 */
function buildEntityText(name: string, aliases?: string[], entityType?: string): string {
  const parts = [name];
  if (aliases && aliases.length > 0) {
    parts.push(`Aliases: ${aliases.join(', ')}`);
  }
  if (entityType) {
    parts.push(`Type: ${entityType}`);
  }
  return parts.join('\n');
}

/**
 * Build searchable text for a tag
 */
function buildTagText(name: string, aliases?: string[], category?: string): string {
  const parts = [name];
  if (aliases && aliases.length > 0) {
    parts.push(`Aliases: ${aliases.join(', ')}`);
  }
  if (category) {
    parts.push(`Category: ${category}`);
  }
  return parts.join('\n');
}

// ============================================================================
// Entity Embedding Service
// ============================================================================

export class EntityEmbeddingService {
  private neo4jClient: Neo4jClient;
  private embedFunction: (texts: string[]) => Promise<number[][]>;
  private embedSingle: (text: string) => Promise<number[] | null>;
  private dimension: number;
  private verbose: boolean;

  constructor(config: EntityEmbeddingConfig) {
    this.neo4jClient = config.neo4jClient;
    this.embedFunction = config.embedFunction;
    this.embedSingle = config.embedSingle;
    this.dimension = config.dimension;
    this.verbose = config.verbose ?? false;
  }

  // ============================================================================
  // Vector Index Management
  // ============================================================================

  /**
   * Ensure vector indexes exist for Entity and Tag nodes
   */
  async ensureVectorIndexes(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    const indexes = [
      { label: 'CanonicalEntity', property: 'embedding_name', name: 'canonicalentity_embedding_name_vector' },
      { label: 'Tag', property: 'embedding_name', name: 'tag_embedding_name_vector' },
    ];

    for (const index of indexes) {
      try {
        // Check if index exists
        const checkResult = await this.neo4jClient.run(
          `SHOW INDEXES YIELD name WHERE name = $indexName RETURN count(name) as count`,
          { indexName: index.name }
        );

        const exists = checkResult.records[0]?.get('count')?.toNumber() > 0;

        if (!exists) {
          const createQuery = `
            CREATE VECTOR INDEX ${index.name} IF NOT EXISTS
            FOR (n:\`${index.label}\`)
            ON n.\`${index.property}\`
            OPTIONS {
              indexConfig: {
                \`vector.dimensions\`: ${this.dimension},
                \`vector.similarity_function\`: 'cosine'
              }
            }
          `;
          await this.neo4jClient.run(createQuery);
          created++;
          if (this.verbose) {
            logger.info('EntityEmbedding', `Created vector index: ${index.name}`);
          }
        } else {
          skipped++;
        }
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          logger.warn('EntityEmbedding', `Vector index creation warning for ${index.name}: ${err.message}`);
        }
      }
    }

    if (this.verbose) {
      logger.info('EntityEmbedding', `Vector indexes: ${created} created, ${skipped} existed`);
    }

    return { created, skipped };
  }

  /**
   * Ensure full-text indexes exist for BM25 search on Entity and Tag nodes
   */
  async ensureFullTextIndexes(): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;

    const indexes = [
      {
        name: 'canonicalentity_fulltext',
        label: 'CanonicalEntity',
        properties: ['name', 'normalizedName', 'aliases'],
      },
      {
        name: 'tag_fulltext',
        label: 'Tag',
        properties: ['name', 'normalizedName', 'aliases'],
      },
    ];

    for (const index of indexes) {
      try {
        // Check if index exists
        const checkResult = await this.neo4jClient.run(
          `SHOW INDEXES YIELD name WHERE name = $indexName RETURN count(name) as count`,
          { indexName: index.name }
        );

        const exists = checkResult.records[0]?.get('count')?.toNumber() > 0;

        if (!exists) {
          const propsStr = index.properties.map(p => `n.${p}`).join(', ');
          const createQuery = `
            CREATE FULLTEXT INDEX ${index.name} IF NOT EXISTS
            FOR (n:\`${index.label}\`)
            ON EACH [${propsStr}]
          `;
          await this.neo4jClient.run(createQuery);
          created++;
          if (this.verbose) {
            logger.info('EntityEmbedding', `Created full-text index: ${index.name}`);
          }
        } else {
          skipped++;
        }
      } catch (err: any) {
        if (!err.message?.includes('already exists')) {
          logger.warn('EntityEmbedding', `Full-text index creation warning for ${index.name}: ${err.message}`);
        }
      }
    }

    if (this.verbose) {
      logger.info('EntityEmbedding', `Full-text indexes: ${created} created, ${skipped} existed`);
    }

    return { created, skipped };
  }

  // ============================================================================
  // Embedding Generation
  // ============================================================================

  /**
   * Generate embeddings for all CanonicalEntity and Tag nodes that need them
   */
  async generateEmbeddings(): Promise<EntityEmbeddingResult> {
    const startTime = Date.now();
    let entitiesEmbedded = 0;
    let tagsEmbedded = 0;
    let skipped = 0;

    // 1. Generate embeddings for CanonicalEntity nodes
    const entityResult = await this.embedCanonicalEntities();
    entitiesEmbedded = entityResult.embedded;
    skipped += entityResult.skipped;

    // 2. Generate embeddings for Tag nodes
    const tagResult = await this.embedTags();
    tagsEmbedded = tagResult.embedded;
    skipped += tagResult.skipped;

    const durationMs = Date.now() - startTime;

    if (this.verbose) {
      logger.info('EntityEmbedding', `Embedding complete: ${entitiesEmbedded} entities, ${tagsEmbedded} tags, ${skipped} skipped in ${durationMs}ms`);
    }

    return { entitiesEmbedded, tagsEmbedded, skipped, durationMs };
  }

  /**
   * Generate embeddings for CanonicalEntity nodes
   */
  private async embedCanonicalEntities(): Promise<{ embedded: number; skipped: number }> {
    // Fetch entities that need embedding (no embedding_name_hash or content changed)
    const result = await this.neo4jClient.run(`
      MATCH (c:CanonicalEntity)
      RETURN c.uuid AS uuid, c.name AS name, c.entityType AS entityType,
             c.aliases AS aliases, c.embedding_name_hash AS existingHash
      LIMIT 1000
    `);

    if (result.records.length === 0) {
      return { embedded: 0, skipped: 0 };
    }

    const nodes = result.records.map(r => ({
      uuid: r.get('uuid'),
      name: r.get('name'),
      entityType: r.get('entityType'),
      aliases: r.get('aliases') || [],
      existingHash: r.get('existingHash'),
    }));

    // Build text and compute hash for each
    const toEmbed: Array<{ uuid: string; text: string; hash: string }> = [];
    let skipped = 0;

    for (const node of nodes) {
      const text = buildEntityText(node.name, node.aliases, node.entityType);
      const hash = hashContent(text);

      if (node.existingHash === hash) {
        skipped++;
        continue;
      }

      toEmbed.push({ uuid: node.uuid, text, hash });
    }

    if (toEmbed.length === 0) {
      if (this.verbose) {
        logger.info('EntityEmbedding', `CanonicalEntity: ${nodes.length} nodes (all cached)`);
      }
      return { embedded: 0, skipped };
    }

    if (this.verbose) {
      logger.info('EntityEmbedding', `CanonicalEntity: embedding ${toEmbed.length} nodes (${skipped} cached)`);
    }

    // Generate embeddings in batches
    const batchSize = 100;
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const texts = batch.map(n => n.text);
      const embeddings = await this.embedFunction(texts);

      // Update nodes with embeddings
      const updateData = batch.map((n, idx) => ({
        uuid: n.uuid,
        embedding: embeddings[idx],
        hash: n.hash,
      }));

      await this.neo4jClient.run(`
        UNWIND $batch AS item
        MATCH (c:CanonicalEntity {uuid: item.uuid})
        SET c.embedding_name = item.embedding,
            c.embedding_name_hash = item.hash,
            c.embeddedAt = datetime()
      `, { batch: updateData });
    }

    return { embedded: toEmbed.length, skipped };
  }

  /**
   * Generate embeddings for Tag nodes
   */
  private async embedTags(): Promise<{ embedded: number; skipped: number }> {
    // Fetch tags that need embedding
    const result = await this.neo4jClient.run(`
      MATCH (t:Tag)
      RETURN t.uuid AS uuid, t.name AS name, t.category AS category,
             t.aliases AS aliases, t.embedding_name_hash AS existingHash
      LIMIT 1000
    `);

    if (result.records.length === 0) {
      return { embedded: 0, skipped: 0 };
    }

    const nodes = result.records.map(r => ({
      uuid: r.get('uuid'),
      name: r.get('name'),
      category: r.get('category'),
      aliases: r.get('aliases') || [],
      existingHash: r.get('existingHash'),
    }));

    // Build text and compute hash for each
    const toEmbed: Array<{ uuid: string; text: string; hash: string }> = [];
    let skipped = 0;

    for (const node of nodes) {
      const text = buildTagText(node.name, node.aliases, node.category);
      const hash = hashContent(text);

      if (node.existingHash === hash) {
        skipped++;
        continue;
      }

      toEmbed.push({ uuid: node.uuid, text, hash });
    }

    if (toEmbed.length === 0) {
      if (this.verbose) {
        logger.info('EntityEmbedding', `Tag: ${nodes.length} nodes (all cached)`);
      }
      return { embedded: 0, skipped };
    }

    if (this.verbose) {
      logger.info('EntityEmbedding', `Tag: embedding ${toEmbed.length} nodes (${skipped} cached)`);
    }

    // Generate embeddings in batches
    const batchSize = 100;
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const texts = batch.map(n => n.text);
      const embeddings = await this.embedFunction(texts);

      // Update nodes with embeddings
      const updateData = batch.map((n, idx) => ({
        uuid: n.uuid,
        embedding: embeddings[idx],
        hash: n.hash,
      }));

      await this.neo4jClient.run(`
        UNWIND $batch AS item
        MATCH (t:Tag {uuid: item.uuid})
        SET t.embedding_name = item.embedding,
            t.embedding_name_hash = item.hash,
            t.embeddedAt = datetime()
      `, { batch: updateData });
    }

    return { embedded: toEmbed.length, skipped };
  }

  // ============================================================================
  // Hybrid Search (BM25 + Semantic)
  // ============================================================================

  /**
   * Search entities and tags using hybrid BM25 + semantic search
   */
  async search(options: EntitySearchOptions): Promise<EntitySearchResult[]> {
    const {
      query,
      entityTypes,
      semantic = true,
      hybrid = true,
      limit = 20,
      minScore = 0.3,
      projectIds,
    } = options;

    if (semantic && hybrid) {
      return this.hybridSearch(query, { entityTypes, limit, minScore, projectIds });
    } else if (semantic) {
      return this.semanticSearch(query, { entityTypes, limit, minScore, projectIds });
    } else {
      return this.fullTextSearch(query, { entityTypes, limit, projectIds });
    }
  }

  /**
   * Semantic vector search
   */
  private async semanticSearch(
    query: string,
    options: { entityTypes?: string[]; limit: number; minScore: number; projectIds?: string[] }
  ): Promise<EntitySearchResult[]> {
    const { entityTypes, limit, minScore, projectIds } = options;

    // Get query embedding
    const queryEmbedding = await this.embedSingle(query);
    if (!queryEmbedding) {
      logger.warn('EntityEmbedding', 'Failed to get query embedding');
      return [];
    }

    const results: EntitySearchResult[] = [];
    const requestTopK = Math.min(limit * 2, 100);

    // Search CanonicalEntity
    if (!entityTypes || entityTypes.length === 0) {
      try {
        const entityFilter = projectIds?.length
          ? `AND ANY(p IN c.projectIds WHERE p IN $projectIds)`
          : '';

        const entityResult = await this.neo4jClient.run(`
          CALL db.index.vector.queryNodes('canonicalentity_embedding_name_vector', $topK, $queryEmbedding)
          YIELD node AS c, score
          WHERE score >= $minScore ${entityFilter}
          RETURN c, score
          ORDER BY score DESC
          LIMIT $limit
        `, {
          topK: neo4j.int(requestTopK),
          queryEmbedding,
          minScore,
          limit: neo4j.int(limit),
          projectIds: projectIds || [],
        });

        for (const record of entityResult.records) {
          const node = record.get('c').properties;
          results.push({
            nodeType: 'CanonicalEntity',
            uuid: node.uuid,
            name: node.name,
            entityType: node.entityType,
            aliases: node.aliases || [],
            score: record.get('score'),
            documentCount: node.documentIds?.length || 0,
            projectIds: node.projectIds || [],
          });
        }
      } catch (err: any) {
        if (this.verbose && !err.message?.includes('does not exist')) {
          logger.warn('EntityEmbedding', `Semantic search failed for CanonicalEntity: ${err.message}`);
        }
      }
    }

    // Search Tag
    try {
      const tagFilter = projectIds?.length
        ? `AND ANY(p IN t.projectIds WHERE p IN $projectIds)`
        : '';

      const tagResult = await this.neo4jClient.run(`
        CALL db.index.vector.queryNodes('tag_embedding_name_vector', $topK, $queryEmbedding)
        YIELD node AS t, score
        WHERE score >= $minScore ${tagFilter}
        RETURN t, score
        ORDER BY score DESC
        LIMIT $limit
      `, {
        topK: neo4j.int(requestTopK),
        queryEmbedding,
        minScore,
        limit: neo4j.int(limit),
        projectIds: projectIds || [],
      });

      for (const record of tagResult.records) {
        const node = record.get('t').properties;
        results.push({
          nodeType: 'Tag',
          uuid: node.uuid,
          name: node.name,
          category: node.category,
          aliases: node.aliases || [],
          score: record.get('score'),
          projectIds: node.projectIds || [],
        });
      }
    } catch (err: any) {
      if (this.verbose && !err.message?.includes('does not exist')) {
        logger.warn('EntityEmbedding', `Semantic search failed for Tag: ${err.message}`);
      }
    }

    // Sort and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Full-text BM25 search
   */
  private async fullTextSearch(
    query: string,
    options: { entityTypes?: string[]; limit: number; projectIds?: string[] }
  ): Promise<EntitySearchResult[]> {
    const { entityTypes, limit, projectIds } = options;

    // Escape Lucene special characters and build fuzzy query
    const escapedQuery = query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
    const words = escapedQuery.split(/\s+/).filter(w => w.length > 0);
    const luceneQuery = words.map(w => `${w}~1`).join(' ');

    const results: EntitySearchResult[] = [];

    // Search CanonicalEntity
    if (!entityTypes || entityTypes.length === 0) {
      try {
        const entityFilter = projectIds?.length
          ? `AND ANY(p IN c.projectIds WHERE p IN $projectIds)`
          : '';

        const entityResult = await this.neo4jClient.run(`
          CALL db.index.fulltext.queryNodes('canonicalentity_fulltext', $luceneQuery)
          YIELD node AS c, score
          WHERE true ${entityFilter}
          RETURN c, score
          ORDER BY score DESC
          LIMIT $limit
        `, { luceneQuery, limit: neo4j.int(limit), projectIds: projectIds || [] });

        for (const record of entityResult.records) {
          const node = record.get('c').properties;
          results.push({
            nodeType: 'CanonicalEntity',
            uuid: node.uuid,
            name: node.name,
            entityType: node.entityType,
            aliases: node.aliases || [],
            score: record.get('score') / 10, // Normalize BM25 score
            documentCount: node.documentIds?.length || 0,
            projectIds: node.projectIds || [],
          });
        }
      } catch (err: any) {
        if (this.verbose && !err.message?.includes('does not exist')) {
          logger.warn('EntityEmbedding', `Full-text search failed for CanonicalEntity: ${err.message}`);
        }
      }
    }

    // Search Tag
    try {
      const tagFilter = projectIds?.length
        ? `AND ANY(p IN t.projectIds WHERE p IN $projectIds)`
        : '';

      const tagResult = await this.neo4jClient.run(`
        CALL db.index.fulltext.queryNodes('tag_fulltext', $luceneQuery)
        YIELD node AS t, score
        WHERE true ${tagFilter}
        RETURN t, score
        ORDER BY score DESC
        LIMIT $limit
      `, { luceneQuery, limit: neo4j.int(limit), projectIds: projectIds || [] });

      for (const record of tagResult.records) {
        const node = record.get('t').properties;
        results.push({
          nodeType: 'Tag',
          uuid: node.uuid,
          name: node.name,
          category: node.category,
          aliases: node.aliases || [],
          score: record.get('score') / 10,
          projectIds: node.projectIds || [],
        });
      }
    } catch (err: any) {
      if (this.verbose && !err.message?.includes('does not exist')) {
        logger.warn('EntityEmbedding', `Full-text search failed for Tag: ${err.message}`);
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Hybrid search: semantic + BM25 with boost fusion
   */
  private async hybridSearch(
    query: string,
    options: { entityTypes?: string[]; limit: number; minScore: number; projectIds?: string[] }
  ): Promise<EntitySearchResult[]> {
    const { entityTypes, limit, minScore, projectIds } = options;

    // Fetch more candidates for fusion
    const candidateLimit = Math.min(limit * 3, 100);

    const [semanticResults, bm25Results] = await Promise.all([
      this.semanticSearch(query, {
        entityTypes,
        limit: candidateLimit,
        minScore: Math.max(minScore * 0.5, 0.1),
        projectIds,
      }),
      this.fullTextSearch(query, {
        entityTypes,
        limit: candidateLimit,
        projectIds,
      }),
    ]);

    if (this.verbose) {
      logger.info('EntityEmbedding', `Hybrid search: ${semanticResults.length} semantic, ${bm25Results.length} BM25`);
    }

    // Boost strategy: semantic-first with BM25 boost
    const bm25BoostFactor = 0.3;
    const bm25OnlyTopN = 3;
    const bm25OnlyScoreBase = 0.4;

    // Build lookup maps
    const semanticUuids = new Set(semanticResults.map(r => r.uuid));
    const bm25RankMap = new Map<string, number>();
    bm25Results.forEach((r, idx) => {
      if (!bm25RankMap.has(r.uuid)) {
        bm25RankMap.set(r.uuid, idx + 1);
      }
    });

    // Boost semantic results by BM25 rank
    const boostedResults: EntitySearchResult[] = semanticResults.map(r => {
      const bm25Rank = bm25RankMap.get(r.uuid);
      let boostedScore = r.score;

      if (bm25Rank) {
        const boost = bm25BoostFactor / Math.sqrt(bm25Rank);
        boostedScore = r.score * (1 + boost);
      }

      return { ...r, score: boostedScore };
    });

    // Add top BM25-only results
    let bm25OnlyCount = 0;
    for (const r of bm25Results) {
      if (bm25OnlyCount >= bm25OnlyTopN) break;

      if (!semanticUuids.has(r.uuid)) {
        boostedResults.push({
          ...r,
          score: bm25OnlyScoreBase - (bm25OnlyCount * 0.05),
        });
        bm25OnlyCount++;
      }
    }

    // Sort and filter
    boostedResults.sort((a, b) => b.score - a.score);
    return boostedResults.filter(r => r.score >= minScore).slice(0, limit);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Embed a single entity immediately after creation
   */
  async embedSingleEntity(uuid: string, name: string, aliases?: string[], entityType?: string): Promise<boolean> {
    const text = buildEntityText(name, aliases, entityType);
    const hash = hashContent(text);

    const embedding = await this.embedSingle(text);
    if (!embedding) {
      return false;
    }

    await this.neo4jClient.run(`
      MATCH (c:CanonicalEntity {uuid: $uuid})
      SET c.embedding_name = $embedding,
          c.embedding_name_hash = $hash,
          c.embeddedAt = datetime()
    `, { uuid, embedding, hash });

    return true;
  }

  /**
   * Embed a single tag immediately after creation
   */
  async embedSingleTag(uuid: string, name: string, aliases?: string[], category?: string): Promise<boolean> {
    const text = buildTagText(name, aliases, category);
    const hash = hashContent(text);

    const embedding = await this.embedSingle(text);
    if (!embedding) {
      return false;
    }

    await this.neo4jClient.run(`
      MATCH (t:Tag {uuid: $uuid})
      SET t.embedding_name = $embedding,
          t.embedding_name_hash = $hash,
          t.embeddedAt = datetime()
    `, { uuid, embedding, hash });

    return true;
  }

  /**
   * Get statistics about entity/tag embeddings
   */
  async getStats(): Promise<{
    totalEntities: number;
    entitiesWithEmbeddings: number;
    totalTags: number;
    tagsWithEmbeddings: number;
  }> {
    const result = await this.neo4jClient.run(`
      MATCH (c:CanonicalEntity)
      WITH count(c) AS totalEntities,
           sum(CASE WHEN c.embedding_name IS NOT NULL THEN 1 ELSE 0 END) AS entitiesWithEmbeddings
      MATCH (t:Tag)
      WITH totalEntities, entitiesWithEmbeddings,
           count(t) AS totalTags,
           sum(CASE WHEN t.embedding_name IS NOT NULL THEN 1 ELSE 0 END) AS tagsWithEmbeddings
      RETURN totalEntities, entitiesWithEmbeddings, totalTags, tagsWithEmbeddings
    `);

    const record = result.records[0];
    return {
      totalEntities: record?.get('totalEntities')?.toNumber() || 0,
      entitiesWithEmbeddings: record?.get('entitiesWithEmbeddings')?.toNumber() || 0,
      totalTags: record?.get('totalTags')?.toNumber() || 0,
      tagsWithEmbeddings: record?.get('tagsWithEmbeddings')?.toNumber() || 0,
    };
  }
}
