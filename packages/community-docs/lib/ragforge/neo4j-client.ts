/**
 * Neo4j Client for Community Docs
 *
 * Wrapper around @ragforge/core Neo4jClient with community-docs specific config.
 * Connects to dedicated Neo4j instance (port 7688, different from CLI's 7687).
 *
 * @since 2025-01-03
 */

import neo4j, { Driver, Session, QueryResult } from "neo4j-driver";

export interface Neo4jClientConfig {
  uri: string;
  username: string;
  password: string;
  database?: string;
}

/**
 * Neo4j Client for community-docs
 */
export class Neo4jClient {
  private driver: Driver;
  private database?: string;

  constructor(config: Neo4jClientConfig) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
      {
        maxConnectionPoolSize: 20,
        connectionTimeout: 30000,
      }
    );
    this.database = config.database;
  }

  /**
   * Execute a Cypher query
   */
  async run(
    cypher: string,
    params?: Record<string, unknown>
  ): Promise<QueryResult> {
    const session = this.driver.session({ database: this.database });

    try {
      return await session.run(cypher, params || {});
    } finally {
      await session.close();
    }
  }

  /**
   * Execute multiple queries in a write transaction
   */
  async transaction<T>(fn: (tx: Session) => Promise<T>): Promise<T> {
    const session = this.driver.session({ database: this.database });

    try {
      return await session.executeWrite(fn as any);
    } finally {
      await session.close();
    }
  }

  /**
   * Execute a read-only transaction
   */
  async readTransaction<T>(fn: (tx: Session) => Promise<T>): Promise<T> {
    const session = this.driver.session({ database: this.database });

    try {
      return await session.executeRead(fn as any);
    } finally {
      await session.close();
    }
  }

  /**
   * Vector similarity search
   */
  async vectorSearch(
    indexName: string,
    embedding: number[],
    topK: number = 20,
    minScore: number = 0.3
  ): Promise<Array<{ node: Record<string, unknown>; score: number }>> {
    const result = await this.run(
      `
      CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
      YIELD node, score
      WHERE score >= $minScore
      RETURN node, score
      ORDER BY score DESC
      `,
      { indexName, topK: neo4j.int(topK), embedding, minScore }
    );

    return result.records.map((record) => ({
      node: record.get("node").properties,
      score: record.get("score"),
    }));
  }

  /**
   * Vector search with filters
   */
  async vectorSearchWithFilters(
    indexName: string,
    embedding: number[],
    filters: {
      categoryId?: string;
      categorySlug?: string;
      userId?: string;
      documentId?: string;
      isPublic?: boolean;
    },
    topK: number = 20,
    minScore: number = 0.3
  ): Promise<Array<{ node: Record<string, unknown>; score: number }>> {
    // Build WHERE clause from filters
    const whereClauses: string[] = ["score >= $minScore"];
    const params: Record<string, unknown> = {
      indexName,
      topK: neo4j.int(topK),
      embedding,
      minScore,
    };

    if (filters.categoryId) {
      whereClauses.push("node.categoryId = $categoryId");
      params.categoryId = filters.categoryId;
    }

    if (filters.categorySlug) {
      whereClauses.push("node.categorySlug = $categorySlug");
      params.categorySlug = filters.categorySlug;
    }

    if (filters.userId) {
      whereClauses.push("node.userId = $userId");
      params.userId = filters.userId;
    }

    if (filters.documentId) {
      whereClauses.push("node.documentId = $documentId");
      params.documentId = filters.documentId;
    }

    if (filters.isPublic !== undefined) {
      whereClauses.push("node.isPublic = $isPublic");
      params.isPublic = filters.isPublic;
    }

    const result = await this.run(
      `
      CALL db.index.vector.queryNodes($indexName, $topK, $embedding)
      YIELD node, score
      WHERE ${whereClauses.join(" AND ")}
      RETURN node, score
      ORDER BY score DESC
      `,
      params
    );

    return result.records.map((record) => ({
      node: record.get("node").properties,
      score: record.get("score"),
    }));
  }

  /**
   * Delete all nodes for a document
   */
  async deleteDocument(documentId: string): Promise<number> {
    // First count, then delete (Neo4j doesn't allow count after DELETE)
    const countResult = await this.run(
      `MATCH (n {documentId: $documentId}) RETURN count(n) AS cnt`,
      { documentId }
    );
    const count = countResult.records[0]?.get("cnt")?.toNumber() || 0;

    if (count > 0) {
      await this.run(
        `MATCH (n {documentId: $documentId}) DETACH DELETE n`,
        { documentId }
      );
    }

    return count;
  }

  /**
   * Update metadata for all nodes of a document
   */
  async updateDocumentMetadata(
    documentId: string,
    updates: Record<string, unknown>
  ): Promise<number> {
    const result = await this.run(
      `
      MATCH (n {documentId: $documentId})
      SET n += $updates
      RETURN count(n) AS cnt
      `,
      { documentId, updates }
    );

    return result.records[0]?.get("cnt")?.toNumber() || 0;
  }

  /**
   * Check if indexes exist, create if not
   */
  async ensureIndexes(): Promise<void> {
    const indexes = [
      // Filtering indexes
      "CREATE INDEX IF NOT EXISTS node_documentId FOR (n:Scope) ON (n.documentId)",
      "CREATE INDEX IF NOT EXISTS node_userId FOR (n:Scope) ON (n.userId)",
      "CREATE INDEX IF NOT EXISTS node_categoryId FOR (n:Scope) ON (n.categoryId)",
      "CREATE INDEX IF NOT EXISTS node_categorySlug FOR (n:Scope) ON (n.categorySlug)",
    ];

    const constraints = [
      // Unique constraints to prevent race conditions during concurrent ingestion
      "CREATE CONSTRAINT canonical_entity_unique IF NOT EXISTS FOR (c:CanonicalEntity) REQUIRE (c.normalizedName, c.entityType) IS UNIQUE",
      "CREATE CONSTRAINT tag_unique IF NOT EXISTS FOR (t:Tag) REQUIRE (t.normalizedName) IS UNIQUE",
    ];

    for (const idx of indexes) {
      try {
        await this.run(idx);
      } catch (e) {
        // Index might already exist, ignore
      }
    }

    for (const constraint of constraints) {
      try {
        await this.run(constraint);
      } catch (e) {
        // Constraint might already exist, ignore
      }
    }
  }

  /**
   * Verify connectivity
   */
  async verifyConnectivity(): Promise<boolean> {
    try {
      await this.run("RETURN 1");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the underlying Neo4j driver
   * Used by IngestionOrchestrator and other components
   */
  getDriver(): Driver {
    return this.driver;
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.driver.close();
  }
}

// Singleton instance
let clientInstance: Neo4jClient | null = null;

/**
 * Get or create Neo4j client singleton
 */
export function getNeo4jClient(): Neo4jClient {
  if (!clientInstance) {
    const uri = process.env.NEO4J_URI || "bolt://localhost:7688";
    const username = process.env.NEO4J_USER || "neo4j";
    const password = process.env.NEO4J_PASSWORD || "communitydocs";

    clientInstance = new Neo4jClient({
      uri,
      username,
      password,
    });
  }

  return clientInstance;
}

/**
 * Close singleton client
 */
export async function closeNeo4jClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
  }
}
