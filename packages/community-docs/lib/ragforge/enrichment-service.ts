/**
 * Document Enrichment Service
 *
 * Uses Claude LLM to extract entities, tags, descriptions, and categories
 * from document content. Integrates with StructuredLLMExecutor from @ragforge/core.
 */

import {
  StructuredLLMExecutor,
  ClaudeAPIProvider,
  type LLMStructuredCallConfig,
  type OutputSchema,
} from '@luciformresearch/ragforge';

import {
  type Entity,
  type EntityType,
  type ExtractedTag,
  type SuggestedCategory,
  type DocumentEnrichment,
  type NodeEnrichment,
  type EnrichmentResult,
  type EnrichmentOptions,
  DEFAULT_ENRICHMENT_OPTIONS,
} from './entity-types';

// Re-export types for convenience
export type { EnrichmentOptions } from './entity-types';

import { logger } from './logger';

// ===== INTERFACES =====

export interface NodeToEnrich {
  /** Node UUID */
  uuid: string;
  /** Node type (File, Scope, MarkdownSection, etc.) */
  nodeType: string;
  /** Node name/title */
  name: string;
  /** Node content */
  content: string;
  /** File path (for code nodes) */
  filePath?: string;
  /** Line numbers (for scopes) */
  lines?: { start: number; end: number };
}

export interface DocumentContext {
  /** Document ID */
  documentId: string;
  /** Document title */
  title?: string;
  /** Document description (if provided by uploader) */
  description?: string;
  /** Project ID in Neo4j */
  projectId: string;
  /** All nodes to enrich */
  nodes: NodeToEnrich[];
}

// ===== OUTPUT SCHEMAS =====

/** Schema for entity extraction from a single node */
const ENTITY_EXTRACTION_SCHEMA: OutputSchema<{
  uuid: string;
  entities: Array<{
    type: string;
    name: string;
    confidence: number;
    aliases?: string[];
    role?: string;
    organization?: string;
    orgType?: string;
    industry?: string;
    website?: string;
    location?: string;
    locationType?: string;
    domain?: string;
    definition?: string;
    techType?: string;
    version?: string;
    docsUrl?: string;
    eventType?: string;
    date?: string;
    productType?: string;
    vendor?: string;
    url?: string;
  }>;
  tags: Array<{
    name: string;
    confidence: number;
    category?: string;
  }>;
  keywords: string[];
  description?: string;
}> = {
  uuid: {
    type: 'string',
    description: 'The unique identifier of the content node (copy from input)',
    required: true,
  },
  entities: {
    type: 'array',
    description: 'Entities extracted from the content',
    items: {
      type: 'object',
      description: 'An entity (person, organization, technology, etc.)',
      properties: {
        type: {
          type: 'string',
          description: 'Entity type',
          enum: ['Person', 'Organization', 'Location', 'Concept', 'Technology', 'DateEvent', 'Product'],
        },
        name: {
          type: 'string',
          description: 'Canonical name of the entity',
        },
        confidence: {
          type: 'number',
          description: 'Confidence score between 0 and 1',
          min: 0,
          max: 1,
        },
        aliases: {
          type: 'array',
          description: 'Alternative names/aliases',
          items: { type: 'string', description: 'Alias' },
        },
        // Person-specific
        role: { type: 'string', description: 'Role/title for Person' },
        organization: { type: 'string', description: 'Organization affiliation for Person' },
        // Organization-specific
        orgType: { type: 'string', description: 'Organization type', enum: ['company', 'nonprofit', 'government', 'educational', 'community', 'other'] },
        industry: { type: 'string', description: 'Industry/domain for Organization' },
        website: { type: 'string', description: 'Website URL for Organization' },
        location: { type: 'string', description: 'Location/headquarters for Organization' },
        // Location-specific
        locationType: { type: 'string', description: 'Location type', enum: ['city', 'country', 'region', 'address', 'landmark', 'other'] },
        // Concept-specific
        domain: { type: 'string', description: 'Domain/field for Concept' },
        definition: { type: 'string', description: 'Brief definition for Concept' },
        // Technology-specific
        techType: { type: 'string', description: 'Technology type', enum: ['language', 'framework', 'library', 'tool', 'platform', 'protocol', 'other'] },
        version: { type: 'string', description: 'Version for Technology/Product' },
        docsUrl: { type: 'string', description: 'Documentation URL for Technology' },
        // DateEvent-specific
        eventType: { type: 'string', description: 'Event type', enum: ['release', 'deadline', 'meeting', 'announcement', 'historical', 'other'] },
        date: { type: 'string', description: 'ISO 8601 date for DateEvent' },
        // Product-specific
        productType: { type: 'string', description: 'Product type', enum: ['software', 'hardware', 'service', 'api', 'other'] },
        vendor: { type: 'string', description: 'Producer/vendor for Product' },
        url: { type: 'string', description: 'Product URL' },
      },
    },
  },
  tags: {
    type: 'array',
    description: 'Thematic tags for the content',
    items: {
      type: 'object',
      description: 'A tag',
      properties: {
        name: {
          type: 'string',
          description: 'Tag name (lowercase, hyphenated)',
        },
        confidence: {
          type: 'number',
          description: 'Confidence score between 0 and 1',
          min: 0,
          max: 1,
        },
        category: {
          type: 'string',
          description: 'Tag category',
          enum: ['topic', 'technology', 'domain', 'audience', 'type', 'other'],
        },
      },
    },
  },
  keywords: {
    type: 'array',
    description: 'Key terms from the content',
    items: { type: 'string', description: 'Keyword' },
  },
  description: {
    type: 'string',
    description: 'Brief description of the content (1-2 sentences)',
    required: false,
  },
};

/** Schema for document-level synthesis */
const DOCUMENT_SYNTHESIS_SCHEMA: OutputSchema<{
  uuid: string;
  title: string;
  description: string;
  topics: string[];
  audience: string[];
  docType: string;
  language: string;
  qualityScore: number;
  suggestedCategory?: {
    slug: string;
    name: string;
    confidence: number;
    reason: string;
  };
}> = {
  uuid: {
    type: 'string',
    description: 'The document identifier (copy from input)',
    required: true,
  },
  title: {
    type: 'string',
    description: 'Improved/cleaned title for the document',
  },
  description: {
    type: 'string',
    description: 'Comprehensive summary of the document (2-4 sentences)',
  },
  topics: {
    type: 'array',
    description: 'Main topics covered in the document',
    items: { type: 'string', description: 'Topic' },
  },
  audience: {
    type: 'array',
    description: 'Target audience for this document',
    items: { type: 'string', description: 'Audience type' },
  },
  docType: {
    type: 'string',
    description: 'Document type classification',
    enum: ['tutorial', 'reference', 'guide', 'api-docs', 'blog', 'research', 'other'],
  },
  language: {
    type: 'string',
    description: 'Primary language of the content (ISO 639-1 code)',
  },
  qualityScore: {
    type: 'number',
    description: 'Quality/completeness assessment (0-1)',
    min: 0,
    max: 1,
  },
  suggestedCategory: {
    type: 'object',
    description: 'Suggested category for the document',
    required: false,
    properties: {
      slug: { type: 'string', description: 'Category slug' },
      name: { type: 'string', description: 'Category name' },
      confidence: { type: 'number', description: 'Confidence (0-1)' },
      reason: { type: 'string', description: 'Why this category fits' },
    },
  },
};

// ===== SERVICE =====

export class EnrichmentService {
  private executor: StructuredLLMExecutor;
  private llmProvider: ClaudeAPIProvider;
  private options: EnrichmentOptions;

  constructor(apiKey: string, options: Partial<EnrichmentOptions> = {}) {
    this.options = { ...DEFAULT_ENRICHMENT_OPTIONS, ...options };

    // Create Claude provider
    this.llmProvider = new ClaudeAPIProvider({
      apiKey,
      model: this.options.model || 'claude-3-5-haiku-20241022',
      temperature: 0.3,
      maxOutputTokens: 4096,
    });

    // Create executor
    this.executor = new StructuredLLMExecutor();
  }

  /**
   * Enrich a document with LLM-extracted metadata
   */
  async enrichDocument(context: DocumentContext): Promise<EnrichmentResult> {
    const startTime = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    logger.info('Enrichment', `Starting enrichment for document ${context.documentId} (${context.nodes.length} nodes)`);

    // 1. Extract entities and tags from nodes (batch)
    const nodesToProcess = context.nodes.slice(0, this.options.maxNodes || 50);
    const nodeEnrichments: NodeEnrichment[] = [];
    const allEntities: Entity[] = [];
    const allTags: ExtractedTag[] = [];

    if (this.options.extractEntities || this.options.extractTags || this.options.generateDescriptions) {
      logger.info('Enrichment', `Extracting entities/tags from ${nodesToProcess.length} nodes...`);

      const extractionResults = await this.extractFromNodes(nodesToProcess, context.projectId);

      for (const result of extractionResults) {
        // Add to node enrichments
        nodeEnrichments.push({
          nodeId: result.uuid,
          nodeType: result.nodeType,
          description: result.description,
          keywords: result.keywords,
          entities: result.entities,
          tags: result.tags,
        });

        // Collect all entities and tags
        if (result.entities) {
          allEntities.push(...result.entities);
        }
        if (result.tags) {
          allTags.push(...result.tags);
        }
      }

      // Estimate tokens (rough approximation)
      inputTokens += nodesToProcess.reduce((sum, n) => sum + Math.ceil(n.content.length / 4), 0);
      outputTokens += extractionResults.length * 200; // ~200 tokens per node output
    }

    // 2. Deduplicate entities within document
    const deduplicatedEntities = this.deduplicateEntities(allEntities);
    const deduplicatedTags = this.deduplicateTags(allTags);

    logger.info('Enrichment', `Deduplicated: ${allEntities.length} → ${deduplicatedEntities.length} entities, ${allTags.length} → ${deduplicatedTags.length} tags`);

    // 3. Generate document-level synthesis
    let documentEnrichment: DocumentEnrichment = {};
    let suggestedCategory: SuggestedCategory | undefined;

    if (this.options.generateSummary || this.options.suggestCategory) {
      logger.info('Enrichment', 'Generating document synthesis...');

      const synthesis = await this.synthesizeDocument(context, deduplicatedEntities, deduplicatedTags);

      documentEnrichment = {
        title: synthesis.title,
        description: synthesis.description,
        topics: synthesis.topics,
        audience: synthesis.audience,
        docType: synthesis.docType as DocumentEnrichment['docType'],
        language: synthesis.language,
        qualityScore: synthesis.qualityScore,
      };

      if (synthesis.suggestedCategory) {
        suggestedCategory = {
          slug: synthesis.suggestedCategory.slug,
          name: synthesis.suggestedCategory.name,
          confidence: synthesis.suggestedCategory.confidence,
          reason: synthesis.suggestedCategory.reason,
        };
      }

      // Estimate tokens for synthesis
      const contextLength = context.nodes.reduce((sum, n) => sum + n.content.length, 0);
      inputTokens += Math.ceil(Math.min(contextLength, 20000) / 4);
      outputTokens += 300;
    }

    const processingTimeMs = Date.now() - startTime;

    logger.info('Enrichment', `Enrichment complete in ${processingTimeMs}ms: ${deduplicatedEntities.length} entities, ${deduplicatedTags.length} tags`);

    return {
      document: documentEnrichment,
      entities: deduplicatedEntities,
      tags: deduplicatedTags,
      suggestedCategory,
      nodeEnrichments,
      metadata: {
        processingTimeMs,
        nodesProcessed: nodesToProcess.length,
        model: this.options.model || 'claude-3-5-haiku-20241022',
        inputTokens,
        outputTokens,
      },
    };
  }

  /**
   * Extract entities and tags from nodes using batch LLM call
   */
  private async extractFromNodes(
    nodes: NodeToEnrich[],
    projectId: string
  ): Promise<Array<NodeToEnrich & {
    entities?: Entity[];
    tags?: ExtractedTag[];
    keywords?: string[];
    description?: string;
  }>> {
    // Prepare items for batch processing
    const items = nodes.map((node) => ({
      ...node,
      // Truncate content to avoid token limits
      content: node.content.slice(0, 4000),
    }));

    const config: LLMStructuredCallConfig<NodeToEnrich, {
      entities: any[];
      tags: any[];
      keywords: string[];
      description?: string;
    }> = {
      caller: 'EnrichmentService.extractFromNodes',
      llmProvider: this.llmProvider,
      inputFields: [
        { name: 'uuid', prompt: 'Unique identifier' },
        { name: 'nodeType', prompt: 'Type of content (MarkdownSection, ImageFile, ThreeDFile, etc.)' },
        { name: 'name', prompt: 'Name/title of the content' },
        { name: 'content', prompt: 'Content to analyze (text or vision description)', maxLength: 4000 },
        { name: 'filePath', prompt: 'File name/path - may contain entity names, project names, or other identifiers' },
      ],
      systemPrompt: `You are an entity extraction assistant. Analyze the provided content and extract:

1. **Entities**: People, organizations, locations, concepts, technologies, date/events, and products mentioned.
   - Be specific and accurate with names
   - Assign confidence scores between 0 and 1 based on how clearly the entity is mentioned
   - Include relevant metadata (role for people, type for organizations, etc.)
   - Entity types: Person, Organization, Location, Concept, Technology, DateEvent, Product
   - **IMPORTANT**: Also extract entities from the filename/filePath if provided - filenames often contain project names, people names, product names, or other meaningful identifiers (e.g., "Album Egr3gorr" in a filename suggests "Egr3gorr" as a potential Product/Concept entity)

2. **Tags**: Thematic tags that describe the content
   - Use lowercase, hyphenated format (e.g., "machine-learning", "api-design")
   - Focus on meaningful, reusable tags
   - Categorize tags: topic, technology, domain, audience, type, other

3. **Keywords**: Key terms and phrases from the content

4. **Description**: A brief 1-2 sentence description of what this content is about

Only extract entities that are clearly mentioned in the content OR the filename. Do not hallucinate or infer entities that aren't present.`,
      userTask: 'Extract entities, tags, keywords, and a description from this content.',
      outputSchema: ENTITY_EXTRACTION_SCHEMA,
      outputFormat: 'xml',
      batchSize: 5,
      parallel: 3,
    };

    const results = await this.executor.executeLLMBatch(items, config);

    // Build lookup map: stripped uuid -> original uuid with prefix
    // LLM may strip prefixes like "section:" from uuids, so we need to match by the base uuid
    const uuidLookup = new Map<string, string>();
    for (const item of items) {
      const originalUuid = item.uuid;
      // Extract base uuid (after last colon, or full string if no colon)
      const baseUuid = originalUuid.includes(':')
        ? originalUuid.substring(originalUuid.lastIndexOf(':') + 1)
        : originalUuid;
      uuidLookup.set(baseUuid, originalUuid);
      uuidLookup.set(originalUuid, originalUuid); // Also map full uuid to itself
    }

    // Convert raw results to typed entities
    return (results as any[]).map((result) => {
      // Restore original uuid with prefix
      const resultUuid = result.uuid || '';
      const originalUuid = uuidLookup.get(resultUuid) || resultUuid;

      return {
        ...result,
        uuid: originalUuid,
        entities: result.entities?.map((e: any) => this.convertToEntity(e)).filter(Boolean),
        tags: result.tags?.map((t: any) => ({
          name: (t.name || '').toLowerCase().replace(/\s+/g, '-'),
          confidence: t.confidence || 0.7,
          category: t.category || 'other',
        })).filter((t: any) => t.name), // Filter out empty names
      };
    });
  }

  /**
   * Convert raw LLM output to typed Entity
   */
  private convertToEntity(raw: any): Entity | null {
    if (!raw.type || !raw.name) return null;

    const confidence = raw.confidence || 0.7;
    if (confidence < (this.options.minEntityConfidence || 0.6)) return null;

    const base = {
      name: raw.name,
      aliases: raw.aliases,
      confidence,
    };

    switch (raw.type) {
      case 'Person':
        return {
          ...base,
          type: 'Person',
          role: raw.role,
          organization: raw.organization,
        };
      case 'Organization':
        return {
          ...base,
          type: 'Organization',
          orgType: raw.orgType,
          industry: raw.industry,
          website: raw.website,
          location: raw.location,
        };
      case 'Location':
        return {
          ...base,
          type: 'Location',
          locationType: raw.locationType,
        };
      case 'Concept':
        return {
          ...base,
          type: 'Concept',
          domain: raw.domain,
          definition: raw.definition,
        };
      case 'Technology':
        return {
          ...base,
          type: 'Technology',
          techType: raw.techType,
          version: raw.version,
          docsUrl: raw.docsUrl,
        };
      case 'DateEvent':
        return {
          ...base,
          type: 'DateEvent',
          eventType: raw.eventType,
          date: raw.date,
        };
      case 'Product':
        return {
          ...base,
          type: 'Product',
          productType: raw.productType,
          version: raw.version,
          vendor: raw.vendor,
          url: raw.url,
        };
      default:
        return null;
    }
  }

  /**
   * Deduplicate entities by name and type
   */
  private deduplicateEntities(entities: Entity[]): Entity[] {
    const seen = new Map<string, Entity>();

    for (const entity of entities) {
      if (!entity.name || !entity.type) continue;
      const key = `${entity.type}:${entity.name.toLowerCase()}`;

      if (seen.has(key)) {
        const existing = seen.get(key)!;
        // Merge: keep highest confidence, merge aliases
        if (entity.confidence > existing.confidence) {
          seen.set(key, {
            ...entity,
            aliases: [...new Set([...(existing.aliases || []), ...(entity.aliases || [])])],
          });
        } else {
          existing.aliases = [...new Set([...(existing.aliases || []), ...(entity.aliases || [])])];
        }
      } else {
        seen.set(key, { ...entity });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Deduplicate tags by name
   */
  private deduplicateTags(tags: ExtractedTag[]): ExtractedTag[] {
    const seen = new Map<string, ExtractedTag>();

    for (const tag of tags) {
      if (!tag.name) continue;
      const key = tag.name.toLowerCase();

      if (seen.has(key)) {
        const existing = seen.get(key)!;
        // Keep highest confidence
        if (tag.confidence > existing.confidence) {
          seen.set(key, tag);
        }
      } else {
        seen.set(key, tag);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate document-level synthesis
   */
  private async synthesizeDocument(
    context: DocumentContext,
    entities: Entity[],
    tags: ExtractedTag[]
  ): Promise<{
    title: string;
    description: string;
    topics: string[];
    audience: string[];
    docType: string;
    language: string;
    qualityScore: number;
    suggestedCategory?: {
      slug: string;
      name: string;
      confidence: number;
      reason: string;
    };
  }> {
    // Build document summary for context
    const contentSamples = context.nodes
      .slice(0, 10)
      .map((n) => `[${n.nodeType}] ${n.name}: ${n.content.slice(0, 500)}...`)
      .join('\n\n');

    const entitySummary = entities
      .slice(0, 20)
      .map((e) => `${e.type}: ${e.name}`)
      .join(', ');

    const tagSummary = tags.slice(0, 15).map((t) => t.name).join(', ');

    // Build category list if available
    const categoryList = this.options.availableCategories?.length
      ? this.options.availableCategories
          .map((c) => `- ${c.slug}: ${c.name}${c.description ? ` (${c.description})` : ''}`)
          .join('\n')
      : '';

    const input = {
      uuid: context.documentId,
      title: context.title || 'Untitled Document',
      description: context.description || '',
      contentSamples,
      entitySummary,
      tagSummary,
      categoryList,
    };

    const config: LLMStructuredCallConfig<typeof input, {
      title: string;
      description: string;
      topics: string[];
      audience: string[];
      docType: string;
      language: string;
      qualityScore: number;
      suggestedCategory?: {
        slug: string;
        name: string;
        confidence: number;
        reason: string;
      };
    }> = {
      caller: 'EnrichmentService.synthesizeDocument',
      llmProvider: this.llmProvider,
      inputFields: [
        { name: 'uuid', prompt: 'Document identifier' },
        { name: 'title', prompt: 'Original title' },
        { name: 'description', prompt: 'Original description' },
        { name: 'contentSamples', prompt: 'Content samples', maxLength: 8000 },
        { name: 'entitySummary', prompt: 'Extracted entities' },
        { name: 'tagSummary', prompt: 'Extracted tags' },
        ...(categoryList ? [{ name: 'categoryList', prompt: 'Available categories' }] : []),
      ],
      systemPrompt: `You are a document analysis assistant. Based on the content samples and extracted metadata, provide a comprehensive synthesis of the document.

Your task is to:
1. Suggest an improved title (cleaner, more descriptive)
2. Write a comprehensive description (2-4 sentences)
3. Identify main topics covered
4. Determine target audience
5. Classify the document type
6. Detect the primary language
7. Assess content quality/completeness (0-1)
${categoryList ? '8. Suggest the most appropriate category from the available list' : ''}

Be accurate and concise. Base your analysis on the actual content provided.`,
      userTask: 'Synthesize document metadata from the provided content and extracted information.',
      outputSchema: DOCUMENT_SYNTHESIS_SCHEMA,
      outputFormat: 'xml',
      batchSize: 1,
    };

    const results = await this.executor.executeLLMBatch([input], config);
    return (results as any[])[0];
  }

  /**
   * Generate titles for document sections that don't have one.
   * Uses Claude to analyze section content and generate descriptive titles.
   * Titles are generated in the same language as the content.
   *
   * @param sections - Array of sections with index and content
   * @returns Array of sections with generated titles
   */
  async generateSectionTitles(
    sections: Array<{ index: number; content: string }>
  ): Promise<Array<{ index: number; title: string }>> {
    if (sections.length === 0) return [];

    logger.info('Enrichment', `Generating titles for ${sections.length} sections via Claude batch`);

    // Prepare items for batch processing - all items processed in optimized batches
    const items = sections.map(s => ({
      index: s.index,
      content: s.content.substring(0, 1500), // Limit content per section for LLM
    }));

    try {
      const results = await this.executor.executeLLMBatch(items, {
        inputFields: ['content'],
        llmProvider: this.llmProvider,
        systemPrompt: `You are an expert document analyzer. Your task is to generate short, descriptive titles for document sections.

Rules:
- The title must be short (3-8 words maximum)
- The title must summarize the main content of the section
- IMPORTANT: The title must be in the SAME LANGUAGE as the content excerpt (if content is in French, title must be in French; if in English, title must be in English; etc.)
- Do not use final punctuation (no period at the end)
- The title should be informative and specific, not generic like "Introduction" or "Conclusion" unless truly appropriate`,
        userTask: 'Generate a short, descriptive title for this document section based on its content. The title must be in the same language as the content.',
        outputSchema: {
          title: {
            type: 'string',
            description: 'Short descriptive title for the section (3-8 words, same language as content)',
            required: true,
          },
        },
        outputFormat: 'xml',
        caller: 'EnrichmentService.generateSectionTitles',
        batchSize: 20, // Process up to 20 sections per LLM call
      });

      // Handle return type (array or LLMBatchResult)
      const resultItems = Array.isArray(results) ? results : results.items;

      logger.info('Enrichment', `Generated ${resultItems.length} section titles`);

      return resultItems.map((item: any) => ({
        index: item.index,
        title: item.title || `Section ${item.index}`,
      }));
    } catch (error) {
      logger.warn('Enrichment', `Failed to generate section titles: ${error}`);
      // Fallback: return empty array, sections will get default "Section X" titles
      return [];
    }
  }

  /**
   * Update options at runtime
   */
  updateOptions(options: Partial<EnrichmentOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

/**
 * Create an enrichment service from environment variables
 */
export function createEnrichmentService(options?: Partial<EnrichmentOptions>): EnrichmentService {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set. Required for LLM enrichment.');
  }

  return new EnrichmentService(apiKey, options);
}
