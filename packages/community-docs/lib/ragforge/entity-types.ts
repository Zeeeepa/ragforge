/**
 * Entity Types for LLM-based Extraction
 *
 * These types define the structure of entities extracted from documents
 * using Claude/LLM analysis. Used by enrichment-service.ts.
 */

// ===== BASE ENTITY =====

export interface BaseEntity {
  /** Unique identifier for the entity */
  id?: string;
  /** Canonical name of the entity */
  name: string;
  /** Alternative names/aliases */
  aliases?: string[];
  /** Confidence score (0-1) */
  confidence: number;
  /** Source text that triggered extraction */
  sourceText?: string;
  /** Line number in source document */
  sourceLine?: number;
}

// ===== ENTITY TYPES =====

export interface PersonEntity extends BaseEntity {
  type: 'Person';
  /** Role/title if known */
  role?: string;
  /** Organization affiliation */
  organization?: string;
  /** Email if found */
  email?: string;
  /** Social/professional links */
  links?: string[];
}

export interface OrganizationEntity extends BaseEntity {
  type: 'Organization';
  /** Organization type (company, nonprofit, government, etc.) */
  orgType?: 'company' | 'nonprofit' | 'government' | 'educational' | 'community' | 'other';
  /** Industry/domain */
  industry?: string;
  /** Website URL */
  website?: string;
  /** Location/headquarters */
  location?: string;
}

export interface LocationEntity extends BaseEntity {
  type: 'Location';
  /** Location type (city, country, region, address, etc.) */
  locationType?: 'city' | 'country' | 'region' | 'address' | 'landmark' | 'other';
  /** Parent location (e.g., country for a city) */
  parentLocation?: string;
  /** Coordinates if known */
  coordinates?: { lat: number; lng: number };
}

export interface ConceptEntity extends BaseEntity {
  type: 'Concept';
  /** Domain/field of the concept */
  domain?: string;
  /** Brief definition */
  definition?: string;
  /** Related concepts */
  relatedConcepts?: string[];
}

export interface TechnologyEntity extends BaseEntity {
  type: 'Technology';
  /** Tech type (language, framework, tool, platform, etc.) */
  techType?: 'language' | 'framework' | 'library' | 'tool' | 'platform' | 'protocol' | 'other';
  /** Version if mentioned */
  version?: string;
  /** Official documentation URL */
  docsUrl?: string;
  /** Repository URL */
  repoUrl?: string;
}

export interface DateEventEntity extends BaseEntity {
  type: 'DateEvent';
  /** Event type (release, deadline, meeting, etc.) */
  eventType?: 'release' | 'deadline' | 'meeting' | 'announcement' | 'historical' | 'other';
  /** Parsed date if possible */
  date?: string; // ISO 8601 format
  /** Is this a recurring event? */
  recurring?: boolean;
}

export interface ProductEntity extends BaseEntity {
  type: 'Product';
  /** Product type */
  productType?: 'software' | 'hardware' | 'service' | 'api' | 'other';
  /** Version if mentioned */
  version?: string;
  /** Producer/vendor */
  vendor?: string;
  /** Product URL */
  url?: string;
}

// Union type for all entities
export type Entity =
  | PersonEntity
  | OrganizationEntity
  | LocationEntity
  | ConceptEntity
  | TechnologyEntity
  | DateEventEntity
  | ProductEntity;

export type EntityType = Entity['type'];

// ===== TAGS & CATEGORIES =====

export interface ExtractedTag {
  /** Tag name (lowercase, hyphenated) */
  name: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Category of the tag */
  category?: 'topic' | 'technology' | 'domain' | 'audience' | 'type' | 'other';
}

export interface SuggestedCategory {
  /** Category slug */
  slug: string;
  /** Human-readable name */
  name: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Reasoning for suggestion */
  reason?: string;
}

// ===== ENRICHMENT RESULTS =====

export interface DocumentEnrichment {
  /** Generated title (may improve on original) */
  title?: string;
  /** Generated description/summary */
  description?: string;
  /** Key topics/themes */
  topics?: string[];
  /** Target audience */
  audience?: string[];
  /** Document type classification */
  docType?: 'tutorial' | 'reference' | 'guide' | 'api-docs' | 'blog' | 'research' | 'other';
  /** Primary language of content */
  language?: string;
  /** Quality/completeness assessment */
  qualityScore?: number;
}

export interface NodeEnrichment {
  /** Node UUID */
  nodeId: string;
  /** Node type (File, Scope, MarkdownSection, etc.) */
  nodeType: string;
  /** Generated description for this specific node */
  description?: string;
  /** Keywords extracted from this node */
  keywords?: string[];
  /** Entities found in this node */
  entities?: Entity[];
  /** Tags for this node */
  tags?: ExtractedTag[];
}

export interface EnrichmentResult {
  /** Document-level enrichment */
  document: DocumentEnrichment;
  /** Extracted entities (deduplicated across nodes) */
  entities: Entity[];
  /** Extracted tags */
  tags: ExtractedTag[];
  /** Suggested category */
  suggestedCategory?: SuggestedCategory;
  /** Per-node enrichments */
  nodeEnrichments?: NodeEnrichment[];
  /** Processing metadata */
  metadata: {
    /** Processing time in ms */
    processingTimeMs: number;
    /** Number of nodes processed */
    nodesProcessed: number;
    /** LLM model used */
    model: string;
    /** Total input tokens */
    inputTokens: number;
    /** Total output tokens */
    outputTokens: number;
  };
}

// ===== ENRICHMENT OPTIONS =====

export interface EnrichmentOptions {
  /** Enable LLM-based enrichment */
  enableLLMEnrichment: boolean;
  /** Generate descriptions for nodes */
  generateDescriptions?: boolean;
  /** Extract entities (people, orgs, places, etc.) */
  extractEntities?: boolean;
  /** Suggest document category */
  suggestCategory?: boolean;
  /** Extract tags */
  extractTags?: boolean;
  /** Generate document-level summary */
  generateSummary?: boolean;
  /** Available categories for suggestion */
  availableCategories?: Array<{ slug: string; name: string; description?: string }>;
  /** Claude model to use */
  model?: string;
  /** Max nodes to enrich (for large documents) */
  maxNodes?: number;
  /** Minimum confidence threshold for entities */
  minEntityConfidence?: number;
}

export const DEFAULT_ENRICHMENT_OPTIONS: EnrichmentOptions = {
  enableLLMEnrichment: false,
  generateDescriptions: true,
  extractEntities: true,
  suggestCategory: true,
  extractTags: true,
  generateSummary: true,
  model: 'claude-3-5-haiku-20241022',
  maxNodes: 50,
  minEntityConfidence: 0.6,
};

// ===== ENTITY RESOLUTION =====

export interface EntityMatch {
  /** Entity from current document */
  entity: Entity;
  /** Matched canonical entity from database */
  canonicalEntity?: {
    id: string;
    name: string;
    type: EntityType;
    projectIds: string[];
  };
  /** Similarity score (0-1) */
  similarity: number;
  /** Match type */
  matchType: 'exact' | 'alias' | 'fuzzy' | 'llm';
}

export interface ResolutionResult {
  /** Entities that were merged into existing canonical entities */
  merged: Array<{
    newEntity: Entity;
    canonicalId: string;
    canonicalName: string;
  }>;
  /** Entities that became new canonical entities */
  created: Entity[];
  /** Total entities processed */
  totalProcessed: number;
  /** Processing time in ms */
  processingTimeMs: number;
}

// ===== NEO4J NODE TYPES =====

export interface EntityNode {
  /** Neo4j UUID */
  uuid: string;
  /** Entity type */
  entityType: EntityType;
  /** Canonical name */
  name: string;
  /** Lowercase normalized name for matching */
  normalizedName: string;
  /** Alternative names/aliases */
  aliases: string[];
  /** Projects where this entity appears */
  projectIds: string[];
  /** Additional properties (role, website, etc.) */
  properties: Record<string, unknown>;
  /** Embedding for semantic search */
  embedding?: number[];
  /** Created timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

export interface TagNode {
  /** Neo4j UUID */
  uuid: string;
  /** Tag name (lowercase, hyphenated) */
  name: string;
  /** Tag category */
  category: string;
  /** Projects using this tag */
  projectIds: string[];
  /** Usage count */
  usageCount: number;
  /** Embedding for semantic search */
  embedding?: number[];
}
