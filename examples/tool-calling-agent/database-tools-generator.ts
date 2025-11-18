/**
 * Database Tools Generator
 *
 * Generates domain-agnostic database query tools from ragforge.config.yaml
 * Similar to how ragforge generates examples and client code
 */

import { readFileSync } from 'fs';
import * as yaml from 'yaml';
import type { RagClient } from './client.js';

export async function generateDatabaseTools(configPath: string, rag: RagClient) {
  // 1. Load config to get entity metadata
  const configContent = readFileSync(configPath, 'utf-8');
  const config = yaml.parse(configContent) as any;

  if (!config.entities || config.entities.length === 0) {
    throw new Error('No entities found in config');
  }

  // 2. Extract metadata for each entity
  const entityMetadata = config.entities.map((entity: any) => ({
    name: entity.name,
    unique_field: entity.unique_field || 'uuid',
    vector_indexes: entity.vector_indexes || [],
    relationships: entity.relationships || [],
    searchable_fields: entity.searchable_fields || []
  }));

  const entityNames = entityMetadata.map((e: any) => e.name);
  const allRelationships = new Set<string>();

  for (const entity of entityMetadata) {
    for (const rel of entity.relationships) {
      allRelationships.add(rel.type);
    }
  }

  // 3. Generate tool definitions with config-aware schemas
  const tools = [
    {
      name: 'query_entities',
      description: `Query entities from the database with flexible conditions.

Available entities: ${entityNames.join(', ')}

Each entity has different unique fields:
${entityMetadata.map((e: any) => `- ${e.name}: ${e.unique_field}`).join('\n')}

Returns matching entities with their properties.`,
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            enum: entityNames,
            description: 'Entity type to query'
          },
          conditions: {
            type: 'array',
            description: 'WHERE conditions to filter results',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', description: 'Field name' },
                operator: {
                  type: 'string',
                  enum: ['=', '!=', '>', '>=', '<', '<=', 'CONTAINS', 'STARTS WITH', 'ENDS WITH', 'IN'],
                },
                value: { description: 'Value to compare' }
              },
              required: ['field', 'operator', 'value']
            }
          },
          limit: {
            type: 'number',
            description: 'Max results (default: 10, max: 50)',
            default: 10
          },
          order_by: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['ASC', 'DESC'] }
            }
          }
        },
        required: ['entity_type']
      }
    },
    {
      name: 'semantic_search',
      description: `Semantic search using vector similarity.

Available vector indexes:
${entityMetadata
  .filter((e: any) => e.vector_indexes.length > 0)
  .map((e: any) => `- ${e.name}: ${e.vector_indexes.map((v: any) => v.name).join(', ')}`)
  .join('\n')}

Best for natural language queries about entity content.`,
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            enum: entityNames,
            description: 'Entity type with vector index'
          },
          query: {
            type: 'string',
            description: 'Natural language search query'
          },
          top_k: { type: 'number', default: 5 },
          min_score: { type: 'number', default: 0.7 }
        },
        required: ['entity_type', 'query']
      }
    },
    {
      name: 'explore_relationships',
      description: `Follow relationships between entities.

Available relationships: ${Array.from(allRelationships).join(', ')}

Navigate the graph to find connected entities.`,
      inputSchema: {
        type: 'object',
        properties: {
          start_entity_type: {
            type: 'string',
            enum: entityNames
          },
          start_conditions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                operator: { type: 'string' },
                value: {}
              }
            }
          },
          relationship_type: {
            type: 'string',
            enum: Array.from(allRelationships)
          },
          direction: {
            type: 'string',
            enum: ['outgoing', 'incoming', 'both'],
            default: 'outgoing'
          },
          target_entity_type: {
            type: 'string',
            enum: entityNames
          },
          limit: { type: 'number', default: 10 }
        },
        required: ['start_entity_type', 'relationship_type']
      }
    },
    {
      name: 'get_entity_by_id',
      description: `Get full entity details by unique identifier.

Unique fields per entity:
${entityMetadata.map((e: any) => `- ${e.name}: ${e.unique_field}`).join('\n')}`,
      inputSchema: {
        type: 'object',
        properties: {
          entity_type: {
            type: 'string',
            enum: entityNames
          },
          id_value: {
            type: 'string',
            description: 'Value of the unique identifier'
          }
        },
        required: ['entity_type', 'id_value']
      }
    }
  ];

  // 4. Create handlers with config-aware logic
  const handlers = {
    async query_entities(params: any) {
      const { entity_type, conditions = [], limit = 10, order_by } = params;
      const entityMeta = entityMetadata.find((e: any) => e.name === entity_type);

      if (!entityMeta) {
        return { error: `Unknown entity: ${entity_type}` };
      }

      let query = rag.get(entity_type);

      for (const condition of conditions) {
        query = query.where(condition.field, condition.operator, condition.value);
      }

      if (order_by) {
        query = query.orderBy(order_by.field, order_by.direction || 'ASC');
      }

      query = query.limit(Math.min(limit, 50));
      const results = await query.execute();

      return {
        entity_type,
        count: results.length,
        unique_field: entityMeta.unique_field,
        results: results.map((r: any) => {
          const filtered: any = {};
          for (const [k, v] of Object.entries(r)) {
            if (!k.includes('embedding') && k !== 'source' && v !== undefined) {
              filtered[k] = v;
            }
          }
          return filtered;
        })
      };
    },

    async semantic_search(params: any) {
      const { entity_type, query, top_k = 5, min_score = 0.7 } = params;
      const entityMeta = entityMetadata.find((e: any) => e.name === entity_type);

      if (!entityMeta) {
        return { error: `Unknown entity: ${entity_type}` };
      }

      const vectorIndex = entityMeta.vector_indexes[0];
      if (!vectorIndex) {
        return { error: `No vector index for ${entity_type}` };
      }

      const queryBuilder = rag.get(entity_type)
        .semanticSearch(vectorIndex.name, query, {
          topK: Math.min(top_k, 20),
          minScore: min_score
        });

      const results = await queryBuilder.execute();

      return {
        entity_type,
        query,
        count: results.length,
        index_used: vectorIndex.name,
        unique_field: entityMeta.unique_field,
        results: results.map((r: any) => ({
          [entityMeta.unique_field]: r[entityMeta.unique_field],
          name: r.name || r.path || 'N/A',
          type: r.type,
          file: r.file,
          score: r.score?.toFixed(3),
          snippet: r[vectorIndex.source_field]?.substring(0, 200)
        }))
      };
    },

    async explore_relationships(params: any) {
      const {
        start_entity_type,
        start_conditions = [],
        relationship_type,
        direction = 'outgoing',
        target_entity_type,
        limit = 10
      } = params;

      const startMeta = entityMetadata.find((e: any) => e.name === start_entity_type);
      if (!startMeta) {
        return { error: `Unknown entity: ${start_entity_type}` };
      }

      let query = rag.get(start_entity_type);

      for (const condition of start_conditions) {
        query = query.where(condition.field, condition.operator, condition.value);
      }

      query = query.getRelationship(relationship_type, direction as any, target_entity_type);
      query = query.limit(Math.min(limit, 50));

      const results = await query.execute();

      const targetMeta = target_entity_type
        ? entityMetadata.find((e: any) => e.name === target_entity_type)
        : null;
      const targetUniqueField = targetMeta?.unique_field || 'uuid';

      return {
        count: results.length,
        relationship: `${start_entity_type} -[${relationship_type}:${direction}]-> ${target_entity_type || 'Any'}`,
        target_unique_field: targetUniqueField,
        results: results.map((r: any) => {
          const filtered: any = {};
          for (const [k, v] of Object.entries(r)) {
            if (!k.includes('embedding') && k !== 'source' && v !== undefined) {
              filtered[k] = v;
            }
          }
          return filtered;
        })
      };
    },

    async get_entity_by_id(params: any) {
      const { entity_type, id_value } = params;
      const entityMeta = entityMetadata.find((e: any) => e.name === entity_type);

      if (!entityMeta) {
        return { error: `Unknown entity: ${entity_type}` };
      }

      const results = await rag.get(entity_type)
        .where(entityMeta.unique_field, '=', id_value)
        .limit(1)
        .execute();

      if (results.length === 0) {
        return { error: `Not found: ${entity_type} with ${entityMeta.unique_field}=${id_value}` };
      }

      const entity = results[0];
      const filtered: any = {};
      for (const [k, v] of Object.entries(entity)) {
        if (!k.includes('embedding')) {
          filtered[k] = v;
        }
      }

      return {
        entity_type,
        unique_field: entityMeta.unique_field,
        ...filtered
      };
    }
  };

  return { tools, handlers };
}
