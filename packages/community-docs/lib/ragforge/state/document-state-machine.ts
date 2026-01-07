/**
 * Document State Machine
 *
 * Manages the lifecycle states of documents during ingestion.
 * Inspired by @ragforge/core's NodeStateMachine but adapted for community-docs.
 *
 * Key differences from @ragforge/core:
 * - Operates at document level (not file/node level)
 * - Simpler state flow for upload-based ingestion
 * - Stores state on a virtual "Document" node linked to all content nodes
 *
 * @since 2025-01-04
 */

import type { Neo4jClient } from "../neo4j-client";
import {
  type DocumentState,
  type DocumentErrorType,
  type TransitionOptions,
  type DocumentStateInfo,
  type BatchTransition,
  type StateCounts,
  type NodeState,
  type NodeStateInfo,
  P,
} from "./types";

// ============================================================================
// DOCUMENT STATE MACHINE
// ============================================================================

export class DocumentStateMachine {
  constructor(private neo4j: Neo4jClient) {}

  // ==========================================================================
  // DOCUMENT-LEVEL STATE
  // ==========================================================================

  /**
   * Initialize state for a new document
   */
  async initializeDocument(
    documentId: string,
    contentHash?: string
  ): Promise<boolean> {
    const now = new Date().toISOString();

    const result = await this.neo4j.run(
      `
      MERGE (d:Document {documentId: $documentId})
      ON CREATE SET
        d.${P.docState} = 'pending',
        d.${P.docStateChangedAt} = datetime($now),
        d.${P.docRetryCount} = 0,
        d.${P.docContentHash} = $contentHash,
        d.createdAt = datetime($now)
      ON MATCH SET
        d.${P.docState} = CASE
          WHEN d.${P.docContentHash} <> $contentHash THEN 'pending'
          ELSE d.${P.docState}
        END,
        d.${P.docStateChangedAt} = CASE
          WHEN d.${P.docContentHash} <> $contentHash THEN datetime($now)
          ELSE d.${P.docStateChangedAt}
        END,
        d.${P.docContentHash} = $contentHash
      RETURN d.${P.docState} AS state
      `,
      { documentId, now, contentHash: contentHash || null }
    );

    return result.records.length > 0;
  }

  /**
   * Transition a document to a new state
   */
  async transition(
    documentId: string,
    newState: DocumentState,
    options?: TransitionOptions
  ): Promise<boolean> {
    const now = new Date().toISOString();

    // Build additional SET clauses based on state
    let additionalSets = "";
    if (newState === "parsing") {
      additionalSets = `, d.${P.docParseStartedAt} = datetime($now)`;
    } else if (newState === "parsed") {
      additionalSets = `, d.${P.docParsedAt} = datetime($now)`;
    } else if (newState === "linked") {
      additionalSets = `, d.${P.docLinkedAt} = datetime($now)`;
    } else if (newState === "ready") {
      additionalSets = `, d.${P.docEmbeddedAt} = datetime($now)`;
    } else if (newState === "pending") {
      // Reset timestamps when going back to pending
      additionalSets = `, d.${P.docParseStartedAt} = null, d.${P.docParsedAt} = null, d.${P.docLinkedAt} = null, d.${P.docEmbeddedAt} = null`;
    }

    const result = await this.neo4j.run(
      `
      MATCH (d:Document {documentId: $documentId})
      SET d.${P.docState} = $newState,
          d.${P.docStateChangedAt} = datetime($now),
          d.${P.docErrorType} = $errorType,
          d.${P.docErrorMessage} = $errorMessage,
          d.${P.docContentHash} = COALESCE($contentHash, d.${P.docContentHash}),
          d.${P.docRetryCount} = CASE
            WHEN $newState = 'error' THEN COALESCE(d.${P.docRetryCount}, 0) + 1
            WHEN $newState = 'pending' THEN 0
            ELSE d.${P.docRetryCount}
          END
          ${additionalSets}
      RETURN d.${P.docState} AS state
      `,
      {
        documentId,
        newState,
        now,
        errorType: options?.errorType || null,
        errorMessage: options?.errorMessage || null,
        contentHash: options?.contentHash || null,
      }
    );

    return result.records.length > 0;
  }

  /**
   * Get document state
   */
  async getDocumentState(documentId: string): Promise<DocumentStateInfo | null> {
    const result = await this.neo4j.run(
      `
      MATCH (d:Document {documentId: $documentId})
      RETURN d.documentId AS documentId,
             d.${P.docState} AS state,
             d.${P.docErrorType} AS errorType,
             d.${P.docErrorMessage} AS errorMessage,
             d.${P.docRetryCount} AS retryCount,
             d.${P.docStateChangedAt} AS stateChangedAt,
             d.${P.docParseStartedAt} AS parseStartedAt,
             d.${P.docParsedAt} AS parsedAt,
             d.${P.docLinkedAt} AS linkedAt,
             d.${P.docEmbeddedAt} AS embeddedAt,
             d.${P.docContentHash} AS contentHash
      `,
      { documentId }
    );

    if (result.records.length === 0) return null;

    const r = result.records[0];
    return {
      documentId: r.get("documentId"),
      state: r.get("state") || "pending",
      errorType: r.get("errorType") || undefined,
      errorMessage: r.get("errorMessage") || undefined,
      retryCount: r.get("retryCount")?.toNumber?.() || r.get("retryCount") || 0,
      stateChangedAt: r.get("stateChangedAt")?.toStandardDate?.() || new Date(),
      parseStartedAt: r.get("parseStartedAt")?.toStandardDate?.() || undefined,
      parsedAt: r.get("parsedAt")?.toStandardDate?.() || undefined,
      linkedAt: r.get("linkedAt")?.toStandardDate?.() || undefined,
      embeddedAt: r.get("embeddedAt")?.toStandardDate?.() || undefined,
      contentHash: r.get("contentHash") || undefined,
    };
  }

  /**
   * Count documents by state
   */
  async countByState(): Promise<StateCounts> {
    const result = await this.neo4j.run(
      `
      MATCH (d:Document)
      WHERE d.${P.docState} IS NOT NULL
      RETURN d.${P.docState} AS state, count(d) AS count
      `
    );

    const counts: StateCounts = {
      pending: 0,
      parsing: 0,
      parsed: 0,
      linking: 0,
      linked: 0,
      embedding: 0,
      ready: 0,
      error: 0,
    };

    for (const record of result.records) {
      const state = record.get("state") as DocumentState;
      const count = record.get("count")?.toNumber?.() || record.get("count") || 0;
      if (state in counts) {
        counts[state] = count;
      }
    }

    return counts;
  }

  /**
   * Get documents in a specific state
   */
  async getDocumentsInState(
    state: DocumentState | DocumentState[],
    limit: number = 100
  ): Promise<DocumentStateInfo[]> {
    const states = Array.isArray(state) ? state : [state];

    const result = await this.neo4j.run(
      `
      MATCH (d:Document)
      WHERE d.${P.docState} IN $states
      RETURN d.documentId AS documentId,
             d.${P.docState} AS state,
             d.${P.docErrorType} AS errorType,
             d.${P.docErrorMessage} AS errorMessage,
             d.${P.docRetryCount} AS retryCount,
             d.${P.docStateChangedAt} AS stateChangedAt
      ORDER BY d.${P.docStateChangedAt} ASC
      LIMIT $limit
      `,
      { states, limit }
    );

    return result.records.map((r) => ({
      documentId: r.get("documentId"),
      state: r.get("state") || "pending",
      errorType: r.get("errorType") || undefined,
      errorMessage: r.get("errorMessage") || undefined,
      retryCount: r.get("retryCount")?.toNumber?.() || r.get("retryCount") || 0,
      stateChangedAt: r.get("stateChangedAt")?.toStandardDate?.() || new Date(),
    }));
  }

  /**
   * Retry documents in error state
   */
  async retryErrors(maxRetries: number = 3): Promise<number> {
    const now = new Date().toISOString();

    const result = await this.neo4j.run(
      `
      MATCH (d:Document)
      WHERE d.${P.docState} = 'error'
        AND COALESCE(d.${P.docRetryCount}, 0) < $maxRetries
      SET d.${P.docState} = 'pending',
          d.${P.docStateChangedAt} = datetime($now),
          d.${P.docErrorType} = null,
          d.${P.docErrorMessage} = null
      RETURN count(d) AS count
      `,
      { maxRetries, now }
    );

    return result.records[0]?.get("count")?.toNumber?.() || 0;
  }

  /**
   * Reset stuck documents (in processing states too long)
   */
  async resetStuckDocuments(stuckThresholdMs: number = 5 * 60 * 1000): Promise<number> {
    const now = new Date().toISOString();

    const result = await this.neo4j.run(
      `
      MATCH (d:Document)
      WHERE d.${P.docState} IN ['parsing', 'linking', 'embedding']
        AND d.${P.docStateChangedAt} < datetime() - duration({milliseconds: $threshold})
      SET d.${P.docState} = 'pending',
          d.${P.docStateChangedAt} = datetime($now),
          d.${P.docErrorMessage} = 'Reset: stuck in processing state'
      RETURN count(d) AS count
      `,
      { threshold: stuckThresholdMs, now }
    );

    return result.records[0]?.get("count")?.toNumber?.() || 0;
  }

  // ==========================================================================
  // NODE-LEVEL STATE (for Scopes, MarkdownSections, etc.)
  // ==========================================================================

  /**
   * Transition nodes for a document
   */
  async transitionNodes(
    documentId: string,
    newState: NodeState,
    options?: TransitionOptions
  ): Promise<number> {
    const now = new Date().toISOString();

    // Build additional SET clauses based on state
    let additionalSets = "";
    if (newState === "parsed") {
      additionalSets = `, n.${P.parsedAt} = datetime($now)`;
    } else if (newState === "linked") {
      additionalSets = `, n.${P.linkedAt} = datetime($now)`;
    } else if (newState === "ready") {
      additionalSets = `, n.${P.embeddedAt} = datetime($now)`;
    }

    const result = await this.neo4j.run(
      `
      MATCH (n {documentId: $documentId})
      WHERE n:Scope OR n:MarkdownSection OR n:CodeBlock
      SET n.${P.state} = $newState,
          n.${P.stateChangedAt} = datetime($now),
          n.${P.errorType} = $errorType,
          n.${P.errorMessage} = $errorMessage,
          n.${P.contentHash} = COALESCE($contentHash, n.${P.contentHash}),
          n.${P.embeddingProvider} = COALESCE($embeddingProvider, n.${P.embeddingProvider}),
          n.${P.embeddingModel} = COALESCE($embeddingModel, n.${P.embeddingModel}),
          n.${P.retryCount} = CASE
            WHEN $newState = 'error' THEN COALESCE(n.${P.retryCount}, 0) + 1
            WHEN $newState = 'pending' THEN 0
            ELSE n.${P.retryCount}
          END
          ${additionalSets}
      RETURN count(n) AS count
      `,
      {
        documentId,
        newState,
        now,
        errorType: options?.errorType || null,
        errorMessage: options?.errorMessage || null,
        contentHash: options?.contentHash || null,
        embeddingProvider: options?.embeddingProvider || null,
        embeddingModel: options?.embeddingModel || null,
      }
    );

    return result.records[0]?.get("count")?.toNumber?.() || 0;
  }

  /**
   * Get nodes in a specific state for a document
   */
  async getNodesInState(
    documentId: string,
    state: NodeState | NodeState[]
  ): Promise<NodeStateInfo[]> {
    const states = Array.isArray(state) ? state : [state];

    const result = await this.neo4j.run(
      `
      MATCH (n {documentId: $documentId})
      WHERE (n:Scope OR n:MarkdownSection OR n:CodeBlock)
        AND n.${P.state} IN $states
      RETURN n.uuid AS uuid,
             labels(n)[0] AS label,
             n.${P.state} AS state,
             n.${P.errorType} AS errorType,
             n.${P.errorMessage} AS errorMessage,
             n.${P.retryCount} AS retryCount,
             n.${P.stateChangedAt} AS stateChangedAt,
             n.${P.contentHash} AS contentHash
      `,
      { documentId, states }
    );

    return result.records.map((r) => ({
      uuid: r.get("uuid"),
      label: r.get("label"),
      state: r.get("state") || "pending",
      errorType: r.get("errorType") || undefined,
      errorMessage: r.get("errorMessage") || undefined,
      retryCount: r.get("retryCount")?.toNumber?.() || r.get("retryCount") || 0,
      stateChangedAt: r.get("stateChangedAt")?.toStandardDate?.() || new Date(),
      contentHash: r.get("contentHash") || undefined,
    }));
  }

  /**
   * Count nodes by state for a document
   */
  async countNodesByState(documentId: string): Promise<Record<NodeState, number>> {
    const result = await this.neo4j.run(
      `
      MATCH (n {documentId: $documentId})
      WHERE (n:Scope OR n:MarkdownSection OR n:CodeBlock)
        AND n.${P.state} IS NOT NULL
      RETURN n.${P.state} AS state, count(n) AS count
      `,
      { documentId }
    );

    const counts: Record<string, number> = {
      pending: 0,
      parsing: 0,
      parsed: 0,
      linking: 0,
      linked: 0,
      embedding: 0,
      ready: 0,
      skip: 0,
      error: 0,
    };

    for (const record of result.records) {
      const state = record.get("state");
      const count = record.get("count")?.toNumber?.() || record.get("count") || 0;
      if (state in counts) {
        counts[state] = count;
      }
    }

    return counts as Record<NodeState, number>;
  }

  /**
   * Get nodes that need embedding for a document
   */
  async getNodesNeedingEmbedding(documentId: string, limit: number = 50): Promise<Array<{
    uuid: string;
    label: string;
    content: string;
  }>> {
    const result = await this.neo4j.run(
      `
      MATCH (n {documentId: $documentId})
      WHERE (n:Scope OR n:MarkdownSection OR n:CodeBlock)
        AND n.${P.state} = 'linked'
        AND (n.source IS NOT NULL OR n.textContent IS NOT NULL OR n.content IS NOT NULL)
      RETURN n.uuid AS uuid,
             labels(n)[0] AS label,
             COALESCE(n.source, n.textContent, n.content) AS content
      LIMIT $limit
      `,
      { documentId, limit }
    );

    return result.records.map((r) => ({
      uuid: r.get("uuid"),
      label: r.get("label"),
      content: r.get("content"),
    }));
  }

  /**
   * Update node embedding
   */
  async setNodeEmbedding(
    uuid: string,
    label: string,
    embedding: number[],
    provider: string,
    model: string
  ): Promise<boolean> {
    const now = new Date().toISOString();

    const result = await this.neo4j.run(
      `
      MATCH (n:${label} {uuid: $uuid})
      SET n.embedding_content = $embedding,
          n.${P.state} = 'ready',
          n.${P.stateChangedAt} = datetime($now),
          n.${P.embeddedAt} = datetime($now),
          n.${P.embeddingProvider} = $provider,
          n.${P.embeddingModel} = $model
      RETURN n.uuid AS uuid
      `,
      { uuid, embedding, provider, model, now }
    );

    return result.records.length > 0;
  }

  /**
   * Batch update node embeddings
   */
  async setNodeEmbeddingsBatch(
    nodes: Array<{
      uuid: string;
      label: string;
      embedding: number[];
    }>,
    provider: string,
    model: string
  ): Promise<number> {
    if (nodes.length === 0) return 0;

    const now = new Date().toISOString();

    // Group by label for efficient queries
    const byLabel = new Map<string, Array<{ uuid: string; embedding: number[] }>>();
    for (const n of nodes) {
      const existing = byLabel.get(n.label) || [];
      existing.push({ uuid: n.uuid, embedding: n.embedding });
      byLabel.set(n.label, existing);
    }

    let total = 0;

    for (const [label, labelNodes] of byLabel) {
      const result = await this.neo4j.run(
        `
        UNWIND $nodes AS n
        MATCH (node:${label} {uuid: n.uuid})
        SET node.embedding_content = n.embedding,
            node.${P.state} = 'ready',
            node.${P.stateChangedAt} = datetime($now),
            node.${P.embeddedAt} = datetime($now),
            node.${P.embeddingProvider} = $provider,
            node.${P.embeddingModel} = $model
        RETURN count(node) AS count
        `,
        { nodes: labelNodes, provider, model, now }
      );

      total += result.records[0]?.get("count")?.toNumber?.() || 0;
    }

    return total;
  }
}
