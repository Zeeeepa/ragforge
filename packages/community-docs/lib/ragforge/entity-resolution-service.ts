/**
 * Entity Resolution Service
 *
 * Resolves and deduplicates entities across all documents in the database.
 * Uses LLM to identify semantically similar entities and merge them.
 *
 * Process:
 * 1. Query all unresolved entities from Neo4j
 * 2. Group by entity type
 * 3. Use LLM to identify duplicates within each type
 * 4. Create/update canonical entities
 * 5. Link mentions to canonical entities
 */

import {
  StructuredLLMExecutor,
  ClaudeAPIProvider,
  type LLMStructuredCallConfig,
  type OutputSchema,
} from '@luciformresearch/ragforge';

import neo4j from 'neo4j-driver';
import { Neo4jClient } from './neo4j-client';
import {
  type Entity,
  type EntityType,
  type EntityMatch,
  type ResolutionResult,
  type ExtractedTag,
} from './entity-types';
import { logger } from './logger';

// ===== BIGINT CONVERSION HELPER =====

/**
 * Convert Neo4j Integer or native BigInt to a safe JavaScript number.
 * Neo4j driver 5.x returns BigInt for integers, which can't be used directly as numbers.
 */
function toSafeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;

  // Handle native BigInt
  if (typeof value === 'bigint') {
    return Number(value);
  }

  // Handle Neo4j Integer (has toNumber method)
  if (value && typeof value === 'object' && 'toNumber' in value && typeof (value as any).toNumber === 'function') {
    return (value as any).toNumber();
  }

  // Handle regular numbers
  if (typeof value === 'number') {
    return value;
  }

  // Fallback: try to convert to number
  return Number(value) || 0;
}

// ===== CANONICAL FORM SELECTION =====

/**
 * Pick the most descriptive canonical form for a tag.
 * Prefers: longer names, hyphenated format, lowercase, no abbreviations.
 */
export function pickCanonicalTag(variants: string[]): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return variants[0].toLowerCase().replace(/\s+/g, '-');

  return variants
    .map(v => v.trim())
    .sort((a, b) => {
      // 1. Prefer longer (more descriptive)
      if (a.length !== b.length) return b.length - a.length;

      // 2. Prefer without numbers/abbreviations (k8s, es6, etc.)
      const aHasNumbers = /\d/.test(a);
      const bHasNumbers = /\d/.test(b);
      if (aHasNumbers !== bHasNumbers) return aHasNumbers ? 1 : -1;

      // 3. Prefer with hyphens (tag convention)
      const aHasDash = a.includes('-');
      const bHasDash = b.includes('-');
      if (aHasDash !== bHasDash) return aHasDash ? -1 : 1;

      // 4. Prefer all lowercase
      const aIsLower = a === a.toLowerCase();
      const bIsLower = b === b.toLowerCase();
      if (aIsLower !== bIsLower) return aIsLower ? -1 : 1;

      // 5. Alphabetical as tiebreaker
      return a.localeCompare(b);
    })[0]
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/**
 * Pick the most descriptive canonical form for an entity name.
 * Prefers: titles (Dr., Prof.), full names, longer forms.
 */
export function pickCanonicalEntityName(
  variants: Array<{ name: string; usageCount?: number }>
): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return variants[0].name;

  // Title patterns to preserve
  const titlePatterns = [
    /^(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?|Sir|Dame|Lord|Lady)\s+/i,
    /,\s*(PhD|MD|JD|MBA|MSc|BSc|MA|BA|Esq\.?)$/i,
  ];

  return variants
    .sort((a, b) => {
      const nameA = a.name.trim();
      const nameB = b.name.trim();

      // 1. Prefer names with titles
      const aHasTitle = titlePatterns.some(p => p.test(nameA));
      const bHasTitle = titlePatterns.some(p => p.test(nameB));
      if (aHasTitle !== bHasTitle) return aHasTitle ? -1 : 1;

      // 2. Prefer longer names (more complete)
      if (nameA.length !== nameB.length) return nameB.length - nameA.length;

      // 3. Prefer names with more parts (first + middle + last)
      const aPartCount = nameA.split(/\s+/).length;
      const bPartCount = nameB.split(/\s+/).length;
      if (aPartCount !== bPartCount) return bPartCount - aPartCount;

      // 4. Prefer higher usage count (more common form)
      const usageA = a.usageCount || 0;
      const usageB = b.usageCount || 0;
      if (usageA !== usageB) return usageB - usageA;

      // 5. Prefer proper case over all-caps or all-lower
      const aProperCase = /^[A-Z][a-z]/.test(nameA);
      const bProperCase = /^[A-Z][a-z]/.test(nameB);
      if (aProperCase !== bProperCase) return aProperCase ? -1 : 1;

      // 6. Alphabetical as tiebreaker
      return nameA.localeCompare(nameB);
    })[0].name;
}

/**
 * Pick the most descriptive canonical form for an organization.
 * Prefers: full names over abbreviations, legal suffixes.
 */
export function pickCanonicalOrgName(
  variants: Array<{ name: string; usageCount?: number }>
): string {
  if (variants.length === 0) return '';
  if (variants.length === 1) return variants[0].name;

  // Legal suffix patterns
  const legalSuffixes = /\s+(Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|GmbH|SA|AG|PLC)$/i;

  return variants
    .sort((a, b) => {
      const nameA = a.name.trim();
      const nameB = b.name.trim();

      // 1. Prefer longer names (full form over abbreviation)
      if (nameA.length !== nameB.length) return nameB.length - nameA.length;

      // 2. Prefer names with legal suffixes (more formal)
      const aHasSuffix = legalSuffixes.test(nameA);
      const bHasSuffix = legalSuffixes.test(nameB);
      if (aHasSuffix !== bHasSuffix) return aHasSuffix ? -1 : 1;

      // 3. Prefer without all-caps (except known acronyms)
      const aAllCaps = nameA === nameA.toUpperCase() && nameA.length > 4;
      const bAllCaps = nameB === nameB.toUpperCase() && nameB.length > 4;
      if (aAllCaps !== bAllCaps) return aAllCaps ? 1 : -1;

      // 4. Higher usage count
      const usageA = a.usageCount || 0;
      const usageB = b.usageCount || 0;
      if (usageA !== usageB) return usageB - usageA;

      return nameA.localeCompare(nameB);
    })[0].name;
}

/**
 * Pick canonical form based on entity type.
 */
export function pickCanonicalName(
  entityType: string,
  variants: Array<{ name: string; usageCount?: number }>
): string {
  switch (entityType) {
    case 'Person':
      return pickCanonicalEntityName(variants);
    case 'Organization':
      return pickCanonicalOrgName(variants);
    default:
      // For other types, prefer longer, more descriptive form
      return variants.sort((a, b) => {
        if (a.name.length !== b.name.length) return b.name.length - a.name.length;
        return (b.usageCount || 0) - (a.usageCount || 0);
      })[0]?.name || '';
  }
}

// ===== INTERFACES =====

export interface EntityResolutionOptions {
  /** Minimum confidence to process an entity */
  minConfidence?: number;
  /** Minimum similarity score for LLM to consider a match */
  minSimilarity?: number;
  /** Maximum entities to process per batch */
  batchSize?: number;
  /** Maximum entities to process in one resolution run */
  maxEntities?: number;
  /** Claude model to use */
  model?: string;
  /** Dry run mode - don't modify database */
  dryRun?: boolean;
}

export const DEFAULT_RESOLUTION_OPTIONS: EntityResolutionOptions = {
  minConfidence: 0.6,
  minSimilarity: 0.8,
  batchSize: 50,
  maxEntities: 500,
  model: 'claude-3-5-haiku-20241022',
  dryRun: false,
};

interface UnresolvedEntity {
  uuid: string;
  name: string;
  entityType: EntityType;
  confidence: number;
  projectId: string;
  documentId: string;
  aliases?: string[];
  properties: Record<string, unknown>;
}

interface CanonicalEntity {
  uuid: string;
  name: string;
  entityType: EntityType;
  normalizedName: string;
  aliases: string[];
  projectIds: string[];
  documentIds: string[];
  properties: Record<string, unknown>;
}

// ===== SCHEMA FOR LLM ENTITY MATCHING =====

const ENTITY_MATCHING_SCHEMA: OutputSchema<{
  uuid: string;
  matches: Array<{
    entityIndex: number;
    canonicalIndex: number;
    similarity: number;
    reason: string;
  }>;
  newCanonicals: number[];
}> = {
  uuid: {
    type: 'string',
    description: 'Copy this value exactly from the input uuid field',
    required: true,
  },
  matches: {
    type: 'array',
    description: 'Entities that match existing canonicals',
    items: {
      type: 'object',
      description: 'A match between an entity and a canonical',
      properties: {
        entityIndex: {
          type: 'number',
          description: 'Index of the entity in the input list',
        },
        canonicalIndex: {
          type: 'number',
          description: 'Index of the canonical entity it matches',
        },
        similarity: {
          type: 'number',
          description: 'Similarity score (0-1)',
          min: 0,
          max: 1,
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why these match',
        },
      },
    },
  },
  newCanonicals: {
    type: 'array',
    description: 'Indices of entities that should become new canonicals',
    items: {
      type: 'number',
      description: 'Entity index',
    },
  },
};

// ===== SCHEMA FOR LLM TAG MATCHING =====

const TAG_MATCHING_SCHEMA: OutputSchema<{
  uuid: string;
  tagGroups: Array<{
    canonicalTag: string;
    category: string;
    variants: number[];
    reason: string;
  }>;
}> = {
  uuid: {
    type: 'string',
    description: 'Copy this value exactly from the input uuid field',
    required: true,
  },
  tagGroups: {
    type: 'array',
    description: 'Groups of semantically equivalent tags',
    items: {
      type: 'object',
      description: 'A group of tags that should be merged',
      properties: {
        canonicalTag: {
          type: 'string',
          description: 'The canonical/preferred form of the tag (lowercase, hyphenated)',
        },
        category: {
          type: 'string',
          description: 'Category for this tag group (topic, technology, domain, audience, type, other)',
        },
        variants: {
          type: 'array',
          description: 'Indices of tags that should be merged into this canonical',
          items: {
            type: 'number',
            description: 'Tag index from the input list',
          },
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why these tags are equivalent',
        },
      },
    },
  },
};

interface TagForResolution {
  uuid: string;
  name: string;
  normalizedName: string;
  category: string;
  projectIds: string[];
  usageCount: number;
}

// ===== SERVICE =====

export class EntityResolutionService {
  private neo4jClient: Neo4jClient;
  private executor: StructuredLLMExecutor;
  private llmProvider: ClaudeAPIProvider;
  private options: EntityResolutionOptions;

  constructor(
    neo4jClient: Neo4jClient,
    apiKey: string,
    options: Partial<EntityResolutionOptions> = {}
  ) {
    this.neo4jClient = neo4jClient;
    this.options = { ...DEFAULT_RESOLUTION_OPTIONS, ...options };

    this.llmProvider = new ClaudeAPIProvider({
      apiKey,
      model: this.options.model || 'claude-3-5-haiku-20241022',
      temperature: 0.2, // Lower temperature for more consistent matching
      maxOutputTokens: 4096,
    });

    this.executor = new StructuredLLMExecutor();
  }

  /**
   * Run entity resolution across all documents
   */
  async resolveEntities(): Promise<ResolutionResult> {
    const startTime = Date.now();
    const result: ResolutionResult = {
      merged: [],
      created: [],
      totalProcessed: 0,
      processingTimeMs: 0,
    };

    logger.info('EntityResolution', 'Starting entity resolution...');

    // 1. Get all unresolved entities
    const unresolvedEntities = await this.getUnresolvedEntities();
    logger.info('EntityResolution', `Found ${unresolvedEntities.length} unresolved entities`);

    if (unresolvedEntities.length === 0) {
      result.processingTimeMs = Date.now() - startTime;
      return result;
    }

    // 2. Get existing canonical entities
    const canonicals = await this.getCanonicalEntities();
    logger.info('EntityResolution', `Found ${canonicals.length} existing canonical entities`);

    // 3. Process by entity type
    const entityTypes: EntityType[] = ['Person', 'Organization', 'Location', 'Technology', 'Concept', 'Product', 'DateEvent'];

    for (const entityType of entityTypes) {
      const entitiesOfType = unresolvedEntities.filter((e) => e.entityType === entityType);
      const canonicalsOfType = canonicals.filter((c) => c.entityType === entityType);

      if (entitiesOfType.length === 0) continue;

      logger.info('EntityResolution', `Processing ${entitiesOfType.length} ${entityType} entities against ${canonicalsOfType.length} canonicals`);

      // Process in batches
      for (let i = 0; i < entitiesOfType.length; i += this.options.batchSize!) {
        const batch = entitiesOfType.slice(i, i + this.options.batchSize!);

        const batchResult = await this.processBatch(batch, canonicalsOfType, entityType);

        result.merged.push(...batchResult.merged);
        result.created.push(...batchResult.created);
        result.totalProcessed += batch.length;

        // Add newly created canonicals for next batch
        canonicalsOfType.push(
          ...batchResult.created.map((e) => ({
            uuid: e.id || '',
            name: e.name,
            entityType,
            normalizedName: e.name.toLowerCase(),
            aliases: e.aliases || [],
            projectIds: [],
            documentIds: [],
            properties: {},
          }))
        );
      }
    }

    result.processingTimeMs = Date.now() - startTime;

    logger.info(
      'EntityResolution',
      `Resolution complete: ${result.merged.length} merged, ${result.created.length} created in ${result.processingTimeMs}ms`
    );

    return result;
  }

  /**
   * Process a batch of entities for resolution
   */
  private async processBatch(
    entities: UnresolvedEntity[],
    canonicals: CanonicalEntity[],
    entityType: EntityType
  ): Promise<{ merged: ResolutionResult['merged']; created: Entity[] }> {
    const merged: ResolutionResult['merged'] = [];
    const created: Entity[] = [];

    if (canonicals.length === 0) {
      // No canonicals exist, create new ones for all entities
      for (const entity of entities) {
        const newCanonical = await this.createCanonicalEntity(entity);
        created.push(newCanonical);
      }
      return { merged, created };
    }

    // Use LLM to match entities to canonicals
    const matchResult = await this.matchEntities(entities, canonicals, entityType);

    // Process matches
    for (const match of matchResult.matches) {
      if (match.similarity >= (this.options.minSimilarity || 0.8)) {
        const entity = entities[match.entityIndex];
        const canonical = canonicals[match.canonicalIndex];

        if (!this.options.dryRun) {
          await this.mergeEntityToCanonical(entity, canonical);
        }

        merged.push({
          newEntity: this.unresolvedToEntity(entity),
          canonicalId: canonical.uuid,
          canonicalName: canonical.name,
        });
      }
    }

    // Create new canonicals for unmatched entities
    for (const entityIndex of matchResult.newCanonicals) {
      const entity = entities[entityIndex];
      if (!this.options.dryRun) {
        const newCanonical = await this.createCanonicalEntity(entity);
        created.push(newCanonical);
      } else {
        created.push(this.unresolvedToEntity(entity));
      }
    }

    return { merged, created };
  }

  /**
   * Use LLM to match entities to canonicals
   */
  private async matchEntities(
    entities: UnresolvedEntity[],
    canonicals: CanonicalEntity[],
    entityType: EntityType
  ): Promise<{
    matches: Array<{ entityIndex: number; canonicalIndex: number; similarity: number; reason: string }>;
    newCanonicals: number[];
  }> {
    // Build entity list string
    const entityList = entities
      .map((e, i) => `[${i}] ${e.name}${e.aliases?.length ? ` (aliases: ${e.aliases.join(', ')})` : ''}`)
      .join('\n');

    // Build canonical list string
    const canonicalList = canonicals
      .map((c, i) => `[${i}] ${c.name}${c.aliases?.length ? ` (aliases: ${c.aliases.join(', ')})` : ''}`)
      .join('\n');

    const batchUuid = `match-${entityType}-${Date.now()}`;
    const input = {
      uuid: batchUuid,
      entityType,
      entityList,
      canonicalList,
      entityCount: entities.length,
      canonicalCount: canonicals.length,
    };

    const config: LLMStructuredCallConfig<typeof input, {
      uuid: string;
      matches: Array<{ entityIndex: number; canonicalIndex: number; similarity: number; reason: string }>;
      newCanonicals: number[];
    }> = {
      caller: 'EntityResolutionService.matchEntities',
      llmProvider: this.llmProvider,
      inputFields: [
        { name: 'uuid', prompt: 'Batch identifier (copy exactly to output)' },
        { name: 'entityType', prompt: 'Type of entities being matched' },
        { name: 'entityList', prompt: 'New entities to match (with indices)' },
        { name: 'canonicalList', prompt: 'Existing canonical entities (with indices)' },
      ],
      systemPrompt: `You are an entity resolution assistant. Your task is to identify which entities from the new list match existing canonical entities.

Two entities match if they refer to the same real-world entity, even if spelled differently or using aliases.

For each entity in the new list:
1. Check if it matches any canonical entity (considering name variations, aliases, common misspellings)
2. If it matches, add to "matches" with the entity index, canonical index, similarity score (0-1), and reason
3. If it doesn't match any canonical, add its index to "newCanonicals"

Be conservative - only match if confident (similarity >= 0.8). It's better to create a new canonical than to wrongly merge distinct entities.

Examples of matches:
- "Microsoft Corporation" matches "Microsoft" (same company)
- "JS" matches "JavaScript" (common abbreviation)
- "NYC" matches "New York City" (common abbreviation)
- "Dr. John Smith" matches "John Smith" (title variation)

Examples of non-matches:
- "Apple" (company) vs "Apple" (fruit) - different entities
- "Python" (language) vs "Python" (snake) - different domains
- "John Smith" vs "James Smith" - different people`,
      userTask: `Match these ${entityType} entities to existing canonicals or mark as new.`,
      outputSchema: ENTITY_MATCHING_SCHEMA,
      outputFormat: 'xml',
      batchSize: 1,
    };

    const results = await this.executor.executeLLMBatch([input], config);
    return (results as any[])[0];
  }

  /**
   * Get unresolved entities from Neo4j
   */
  private async getUnresolvedEntities(): Promise<UnresolvedEntity[]> {
    // Query Entity nodes that don't have a CANONICAL_IS relationship
    const result = await this.neo4jClient.run(`
      MATCH (e:Entity)
      WHERE NOT (e)-[:CANONICAL_IS]->(:CanonicalEntity)
      AND e.confidence >= $minConfidence
      RETURN e
      ORDER BY e.entityType, e.name
      LIMIT $limit
    `, {
      minConfidence: this.options.minConfidence,
      limit: neo4j.int(this.options.maxEntities || 500), // Neo4j LIMIT requires integer
    });

    return result.records.map((record) => {
      const props = record.get('e').properties;
      return {
        uuid: props.uuid,
        name: props.name,
        entityType: props.entityType,
        confidence: props.confidence || 0.7,
        projectId: props.projectId,
        documentId: props.documentId,
        aliases: props.aliases || [],
        properties: props,
      };
    });
  }

  /**
   * Get existing canonical entities from Neo4j
   */
  private async getCanonicalEntities(): Promise<CanonicalEntity[]> {
    const result = await this.neo4jClient.run(`
      MATCH (c:CanonicalEntity)
      RETURN c
      ORDER BY c.entityType, c.name
    `);

    return result.records.map((record) => {
      const props = record.get('c').properties;
      return {
        uuid: props.uuid,
        name: props.name,
        entityType: props.entityType,
        normalizedName: props.normalizedName,
        aliases: props.aliases || [],
        projectIds: props.projectIds || [],
        documentIds: props.documentIds || [],
        properties: props,
      };
    });
  }

  /**
   * Create a new canonical entity in Neo4j (or merge with existing)
   * Uses MERGE with unique constraint to handle concurrent creation attempts.
   */
  private async createCanonicalEntity(entity: UnresolvedEntity): Promise<Entity> {
    const uuid = `canonical-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const normalizedName = entity.name.toLowerCase().trim();

    try {
      // Use MERGE to avoid creating duplicates if same normalizedName+entityType already exists
      // The unique constraint on (normalizedName, entityType) ensures atomicity
      const result = await this.neo4jClient.run(`
        MERGE (c:CanonicalEntity {normalizedName: $normalizedName, entityType: $entityType})
        ON CREATE SET
          c.uuid = $uuid,
          c.name = $name,
          c.aliases = $aliases,
          c.projectIds = [$projectId],
          c.documentIds = [$documentId],
          c.createdAt = datetime(),
          c.updatedAt = datetime()
        ON MATCH SET
          c.aliases = CASE WHEN $name IN c.aliases THEN c.aliases ELSE c.aliases + $name END,
          c.projectIds = CASE WHEN $projectId IN c.projectIds THEN c.projectIds ELSE c.projectIds + $projectId END,
          c.documentIds = CASE WHEN $documentId IN c.documentIds THEN c.documentIds ELSE c.documentIds + $documentId END,
          c.updatedAt = datetime()
        WITH c
        MATCH (e:Entity {uuid: $entityUuid})
        MERGE (e)-[:CANONICAL_IS]->(c)
        RETURN c.uuid as canonicalUuid, c.name as canonicalName
      `, {
        uuid,
        name: entity.name,
        normalizedName,
        entityType: entity.entityType,
        aliases: entity.aliases || [],
        projectId: entity.projectId,
        documentId: entity.documentId,
        entityUuid: entity.uuid,
      });

      const wasCreated = result.records.length > 0 && result.records[0].get('canonicalUuid') === uuid;
      const canonicalName = result.records.length > 0 ? result.records[0].get('canonicalName') : entity.name;

      if (wasCreated) {
        logger.info('EntityResolution', `Created canonical entity: ${entity.name} (${entity.entityType})`);
      } else {
        logger.info('EntityResolution', `Merged entity "${entity.name}" into existing canonical "${canonicalName}" (${entity.entityType})`);
      }

      return {
        id: uuid,
        name: entity.name,
        type: entity.entityType,
        aliases: entity.aliases,
        confidence: entity.confidence,
      } as Entity;
    } catch (error: any) {
      // Handle constraint violation (rare race condition where two threads try MERGE simultaneously)
      if (error.message?.includes('ConstraintValidationFailed') || error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
        logger.warn('EntityResolution', `Constraint violation for "${entity.name}", fetching existing canonical`);

        // Fetch existing and link to it
        const existingResult = await this.neo4jClient.run(`
          MATCH (c:CanonicalEntity {normalizedName: $normalizedName, entityType: $entityType})
          SET c.aliases = CASE WHEN $name IN c.aliases THEN c.aliases ELSE c.aliases + $name END,
              c.projectIds = CASE WHEN $projectId IN c.projectIds THEN c.projectIds ELSE c.projectIds + $projectId END,
              c.documentIds = CASE WHEN $documentId IN c.documentIds THEN c.documentIds ELSE c.documentIds + $documentId END,
              c.updatedAt = datetime()
          WITH c
          MATCH (e:Entity {uuid: $entityUuid})
          MERGE (e)-[:CANONICAL_IS]->(c)
          RETURN c.uuid as canonicalUuid, c.name as canonicalName
        `, {
          name: entity.name,
          normalizedName,
          entityType: entity.entityType,
          projectId: entity.projectId,
          documentId: entity.documentId,
          entityUuid: entity.uuid,
        });

        const canonicalName = existingResult.records.length > 0
          ? existingResult.records[0].get('canonicalName')
          : entity.name;

        logger.info('EntityResolution', `Linked entity "${entity.name}" to existing canonical "${canonicalName}"`);

        return {
          id: existingResult.records[0]?.get('canonicalUuid') || uuid,
          name: entity.name,
          type: entity.entityType,
          aliases: entity.aliases,
          confidence: entity.confidence,
        } as Entity;
      }

      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Merge an entity into an existing canonical
   */
  private async mergeEntityToCanonical(entity: UnresolvedEntity, canonical: CanonicalEntity): Promise<void> {
    // Determine the best canonical name (most descriptive)
    const allNames = [
      { name: canonical.name, usageCount: 1 },
      { name: entity.name, usageCount: 1 },
      ...(canonical.aliases || []).map(a => ({ name: a, usageCount: 0 })),
      ...(entity.aliases || []).map(a => ({ name: a, usageCount: 0 })),
    ];

    const bestName = pickCanonicalName(entity.entityType, allNames);
    const nameChanged = bestName !== canonical.name;

    // Collect all names as aliases (except the canonical one)
    const allAliases = new Set([
      ...canonical.aliases,
      ...(entity.aliases || []),
      canonical.name,
      entity.name,
    ]);
    allAliases.delete(bestName); // Remove canonical from aliases

    // Create relationship and update canonical with new aliases/projects
    await this.neo4jClient.run(`
      MATCH (e:Entity {uuid: $entityUuid})
      MATCH (c:CanonicalEntity {uuid: $canonicalUuid})
      CREATE (e)-[:CANONICAL_IS]->(c)
      SET c.name = $canonicalName,
          c.normalizedName = $normalizedName,
          c.aliases = $allAliases,
          c.projectIds = CASE WHEN $projectId IN c.projectIds THEN c.projectIds ELSE c.projectIds + $projectId END,
          c.documentIds = CASE WHEN $documentId IN c.documentIds THEN c.documentIds ELSE c.documentIds + $documentId END,
          c.updatedAt = datetime()
    `, {
      entityUuid: entity.uuid,
      canonicalUuid: canonical.uuid,
      canonicalName: bestName,
      normalizedName: bestName.toLowerCase().trim(),
      allAliases: Array.from(allAliases),
      projectId: entity.projectId,
      documentId: entity.documentId,
    });

    if (nameChanged) {
      logger.info('EntityResolution', `Merged "${entity.name}" into canonical, updated name: "${canonical.name}" → "${bestName}"`);
    } else {
      logger.info('EntityResolution', `Merged "${entity.name}" into canonical "${canonical.name}"`);
    }
  }

  /**
   * Convert unresolved entity to typed Entity
   */
  private unresolvedToEntity(unresolved: UnresolvedEntity): Entity {
    return {
      name: unresolved.name,
      type: unresolved.entityType,
      aliases: unresolved.aliases,
      confidence: unresolved.confidence,
    } as Entity;
  }

  /**
   * Merge duplicate CanonicalEntity nodes (same normalizedName + entityType)
   * Uses algorithmic selection to pick the most descriptive canonical name.
   */
  async mergeCanonicals(): Promise<{ merged: number }> {
    logger.info('EntityResolution', 'Merging duplicate canonical entities...');

    // 1. Find all duplicate pairs
    const duplicatesResult = await this.neo4jClient.run(`
      MATCH (c1:CanonicalEntity)
      MATCH (c2:CanonicalEntity)
      WHERE c1.uuid < c2.uuid
      AND c1.normalizedName = c2.normalizedName
      AND c1.entityType = c2.entityType
      RETURN c1, c2
    `);

    if (duplicatesResult.records.length === 0) {
      logger.info('EntityResolution', 'No duplicate canonicals found');
      return { merged: 0 };
    }

    let totalMerged = 0;

    // 2. Process each duplicate pair
    for (const record of duplicatesResult.records) {
      const c1Props = record.get('c1').properties;
      const c2Props = record.get('c2').properties;

      // Collect all names and aliases from both canonicals
      const allNames = [
        { name: c1Props.name, usageCount: 1 },
        { name: c2Props.name, usageCount: 1 },
        ...((c1Props.aliases || []) as string[]).map((a: string) => ({ name: a, usageCount: 0 })),
        ...((c2Props.aliases || []) as string[]).map((a: string) => ({ name: a, usageCount: 0 })),
      ];

      // Pick the best canonical name
      const bestName = pickCanonicalName(c1Props.entityType, allNames);

      // Collect all aliases (excluding the canonical name)
      const allAliases = new Set<string>([
        ...((c1Props.aliases || []) as string[]),
        ...((c2Props.aliases || []) as string[]),
        c1Props.name,
        c2Props.name,
      ]);
      allAliases.delete(bestName);

      // Merge c2 into c1 with the best name
      await this.neo4jClient.run(`
        MATCH (c1:CanonicalEntity {uuid: $c1Uuid})
        MATCH (c2:CanonicalEntity {uuid: $c2Uuid})
        // Transfer CANONICAL_IS relationships from c2 to c1
        OPTIONAL MATCH (e:Entity)-[r:CANONICAL_IS]->(c2)
        CREATE (e)-[:CANONICAL_IS]->(c1)
        DELETE r
        WITH c1, c2
        // Update c1 with best name and merged data
        SET c1.name = $bestName,
            c1.normalizedName = $normalizedName,
            c1.aliases = $allAliases,
            c1.projectIds = [x IN coalesce(c1.projectIds, []) WHERE NOT x IN coalesce(c2.projectIds, [])] + coalesce(c2.projectIds, []),
            c1.documentIds = [x IN coalesce(c1.documentIds, []) WHERE NOT x IN coalesce(c2.documentIds, [])] + coalesce(c2.documentIds, []),
            c1.updatedAt = datetime()
        DETACH DELETE c2
      `, {
        c1Uuid: c1Props.uuid,
        c2Uuid: c2Props.uuid,
        bestName,
        normalizedName: bestName.toLowerCase().trim(),
        allAliases: Array.from(allAliases),
      });

      totalMerged++;
      logger.info('EntityResolution', `Merged canonicals: "${c1Props.name}" + "${c2Props.name}" → "${bestName}"`);
    }

    logger.info('EntityResolution', `Canonical merge: ${totalMerged} duplicates merged`);

    return { merged: totalMerged };
  }

  /**
   * Resolve tags using LLM for semantic deduplication
   */
  async resolveTags(): Promise<{ normalized: number; merged: number; llmMerged: number }> {
    logger.info('EntityResolution', 'Starting tag resolution with LLM...');

    // 1. Normalize all tags
    const normalizeResult = await this.neo4jClient.run(`
      MATCH (t:Tag)
      WHERE t.normalizedName IS NULL OR t.normalizedName <> toLower(replace(t.name, ' ', '-'))
      SET t.normalizedName = toLower(replace(t.name, ' ', '-'))
      RETURN count(t) AS normalized
    `);
    const normalized = toSafeNumber(normalizeResult.records[0]?.get('normalized'));

    // 2. Simple merge (exact normalizedName match)
    const mergeResult = await this.neo4jClient.run(`
      MATCH (t1:Tag)
      MATCH (t2:Tag)
      WHERE t1.uuid < t2.uuid
      AND t1.normalizedName = t2.normalizedName
      WITH t1, t2
      // Transfer relationships from t2 to t1
      OPTIONAL MATCH (n)-[r:HAS_TAG]->(t2)
      CREATE (n)-[:HAS_TAG]->(t1)
      WITH t1, t2, count(r) AS transferred
      // Update t1 projectIds
      SET t1.projectIds = [x IN t1.projectIds WHERE NOT x IN t2.projectIds] + t2.projectIds,
          t1.usageCount = coalesce(t1.usageCount, 0) + coalesce(t2.usageCount, 0)
      DETACH DELETE t2
      RETURN count(t2) AS merged
    `);
    const merged = toSafeNumber(mergeResult.records[0]?.get('merged'));

    // 3. LLM-based semantic deduplication
    const llmMerged = await this.resolveTagsWithLLM();

    logger.info('EntityResolution', `Tag resolution: ${normalized} normalized, ${merged} exact matches merged, ${llmMerged} LLM matches merged`);

    return { normalized, merged, llmMerged };
  }

  /**
   * Get all tags for resolution
   */
  private async getAllTags(): Promise<TagForResolution[]> {
    const result = await this.neo4jClient.run(`
      MATCH (t:Tag)
      RETURN t
      ORDER BY t.name
      LIMIT $limit
    `, {
      limit: neo4j.int(this.options.maxEntities || 500),
    });

    return result.records.map((record) => {
      const props = record.get('t').properties;
      return {
        uuid: props.uuid,
        name: props.name,
        normalizedName: props.normalizedName || props.name.toLowerCase().replace(/ /g, '-'),
        category: props.category || 'other',
        projectIds: props.projectIds || [],
        usageCount: toSafeNumber(props.usageCount) || 1,
      };
    });
  }

  /**
   * Use LLM to identify semantically equivalent tags
   */
  private async resolveTagsWithLLM(): Promise<number> {
    const tags = await this.getAllTags();

    if (tags.length < 2) {
      return 0;
    }

    logger.info('EntityResolution', `LLM tag resolution: analyzing ${tags.length} tags...`);

    // Build tag list for LLM
    const tagList = tags
      .map((t, i) => `[${i}] "${t.name}" (category: ${t.category}, usage: ${t.usageCount})`)
      .join('\n');

    const batchUuid = `tag-match-${Date.now()}`;
    const input = {
      uuid: batchUuid,
      tagList,
      tagCount: tags.length,
    };

    const config: LLMStructuredCallConfig<typeof input, {
      uuid: string;
      tagGroups: Array<{
        canonicalTag: string;
        category: string;
        variants: number[];
        reason: string;
      }>;
    }> = {
      caller: 'EntityResolutionService.resolveTagsWithLLM',
      llmProvider: this.llmProvider,
      inputFields: [
        { name: 'uuid', prompt: 'Batch identifier (copy exactly to output)' },
        { name: 'tagList', prompt: 'Tags to analyze (with indices)' },
        { name: 'tagCount', prompt: 'Total number of tags' },
      ],
      systemPrompt: `You are a tag deduplication assistant. Your task is to identify semantically equivalent tags that should be merged.

Two tags are equivalent if they represent the SAME concept, even with different:
- Capitalization: "Machine Learning" = "machine learning" = "MACHINE LEARNING"
- Spacing/hyphens: "machine-learning" = "machine learning" = "machinelearning"
- Abbreviations: "ML" = "machine-learning", "AI" = "artificial-intelligence", "JS" = "javascript"
- Plurals: "api" = "apis", "model" = "models"
- Minor variations: "typescript" = "TypeScript" = "TS"

For each group of equivalent tags:
1. Choose the best canonical form (lowercase, hyphenated, full words preferred)
2. List all variant indices that should be merged into this canonical
3. Assign the most appropriate category

Categories:
- topic: General subject areas (ai, machine-learning, web-development)
- technology: Specific technologies, frameworks, languages (typescript, react, neo4j)
- domain: Industry or application domains (healthcare, finance, gaming)
- audience: Target users (beginners, developers, data-scientists)
- type: Content types (tutorial, reference, guide)
- other: Everything else

Only group tags if you are CONFIDENT they refer to the same concept. If unsure, keep them separate.
If a tag has no equivalent, include it as a single-item group.`,
      userTask: 'Group these tags by semantic equivalence and identify the canonical form for each group.',
      outputSchema: TAG_MATCHING_SCHEMA,
      outputFormat: 'xml',
      batchSize: 1,
    };

    const results = await this.executor.executeLLMBatch([input], config);
    const matchResult = (results as any[])[0];

    if (!matchResult?.tagGroups || !Array.isArray(matchResult.tagGroups)) {
      logger.warn('EntityResolution', 'LLM tag resolution returned invalid result');
      return 0;
    }

    // Process each group
    let totalMerged = 0;
    for (const group of matchResult.tagGroups) {
      if (!group.variants || group.variants.length < 2) {
        // Single tag or empty group, nothing to merge
        continue;
      }

      // Collect all tag names from this group
      const variantTags = group.variants
        .map((idx: number) => tags[idx])
        .filter((t: TagForResolution | undefined): t is TagForResolution => t !== undefined);

      if (variantTags.length < 2) continue;

      // Use algorithmic selection for canonical form (more descriptive)
      const canonicalName = pickCanonicalTag(variantTags.map((t: TagForResolution) => t.name));

      // Find the tag with highest usage to be the target (keeps most relationships)
      const sortedByUsage = [...variantTags].sort((a, b) => b.usageCount - a.usageCount);
      const targetTag = sortedByUsage[0];

      logger.info('EntityResolution', `Tag group: [${variantTags.map((t: TagForResolution) => t.name).join(', ')}] → "${canonicalName}"`);

      // Update the target tag to canonical form
      await this.neo4jClient.run(`
        MATCH (t:Tag {uuid: $uuid})
        SET t.name = $canonicalName,
            t.normalizedName = $normalizedName,
            t.category = $category,
            t.updatedAt = datetime()
      `, {
        uuid: targetTag.uuid,
        canonicalName: canonicalName,
        normalizedName: canonicalName.toLowerCase().replace(/ /g, '-'),
        category: group.category || targetTag.category,
      });

      // Merge other variants into the target
      for (const variantTag of variantTags) {
        if (variantTag.uuid === targetTag.uuid) continue;

        // Transfer relationships and merge
        // First: transfer HAS_TAG relationships (separate query to handle when no relationships exist)
        await this.neo4jClient.run(`
          MATCH (target:Tag {uuid: $targetUuid})
          MATCH (variant:Tag {uuid: $variantUuid})
          MATCH (n)-[:HAS_TAG]->(variant)
          WHERE NOT (n)-[:HAS_TAG]->(target)
          CREATE (n)-[:HAS_TAG]->(target)
        `, {
          targetUuid: targetTag.uuid,
          variantUuid: variantTag.uuid,
        });

        // Second: merge the variant into target
        await this.neo4jClient.run(`
          MATCH (target:Tag {uuid: $targetUuid})
          MATCH (variant:Tag {uuid: $variantUuid})
          SET target.projectIds = [x IN coalesce(target.projectIds, []) WHERE NOT x IN coalesce(variant.projectIds, [])] + coalesce(variant.projectIds, []),
              target.usageCount = coalesce(target.usageCount, 0) + coalesce(variant.usageCount, 0),
              target.aliases = coalesce(target.aliases, []) + [$variantName]
          DETACH DELETE variant
        `, {
          targetUuid: targetTag.uuid,
          variantUuid: variantTag.uuid,
          variantName: variantTag.name,
        });

        totalMerged++;
        logger.info('EntityResolution', `Merged tag "${variantTag.name}" into "${canonicalName}" (${group.reason})`);
      }
    }

    return totalMerged;
  }
}

/**
 * Create entity resolution service from environment variables
 */
export function createEntityResolutionService(
  neo4jClient: Neo4jClient,
  options?: Partial<EntityResolutionOptions>
): EntityResolutionService {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set. Required for entity resolution.');
  }

  return new EntityResolutionService(neo4jClient, apiKey, options);
}
