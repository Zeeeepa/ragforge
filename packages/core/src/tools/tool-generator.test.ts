/**
 * Tool Generator Tests
 *
 * Tests for config-driven tool generation
 */

import { describe, it, expect } from 'vitest';
import { generateToolsFromConfig } from './tool-generator.js';
import type { RagForgeConfig } from '../types/config.js';

describe('generateToolsFromConfig', () => {
  it('should generate core tools from config', () => {
    const config: RagForgeConfig = {
      name: 'test-project',
      version: '1.0.0',
      neo4j: {
        uri: 'bolt://localhost:7687',
      },
      entities: [
        {
          name: 'Scope',
          unique_field: 'uuid',
          searchable_fields: [
            { name: 'name', type: 'string', description: 'Scope name' },
            { name: 'file', type: 'string', description: 'File path' },
            { name: 'type', type: 'string', description: 'Scope type' },
          ],
          vector_indexes: [
            {
              name: 'scopeSourceEmbeddings',
              field: 'source_embedding',
              source_field: 'source',
              dimension: 768,
              similarity: 'cosine',
            },
          ],
          relationships: [
            {
              type: 'DEFINED_IN',
              direction: 'outgoing',
              target: 'File',
              description: 'Scope defined in file',
            },
          ],
        },
        {
          name: 'File',
          unique_field: 'path',
          searchable_fields: [
            { name: 'path', type: 'string', description: 'File path' },
            { name: 'extension', type: 'string', description: 'File extension' },
          ],
          relationships: [],
        },
      ],
    };

    const { tools, handlers, metadata } = generateToolsFromConfig(config);

    // Should generate 4 core tools
    expect(tools).toHaveLength(4);
    expect(handlers).toBeDefined();
    expect(metadata.entityCount).toBe(2);
    expect(metadata.toolCount).toBe(4);

    // Check query_entities
    const queryEntities = tools.find(t => t.name === 'query_entities');
    expect(queryEntities).toBeDefined();
    expect(queryEntities!.description).toContain('Scope, File');
    expect(queryEntities!.description).toContain('uuid (string)');
    expect(queryEntities!.description).toContain('path (string)');
    expect(queryEntities!.description).toContain('[UNIQUE FIELD]');
    expect(queryEntities!.description).toContain('REGEX');
    expect(queryEntities!.description).toContain('GLOB');
    expect(queryEntities!.description).toContain('Examples:');
    expect(queryEntities!.inputSchema.properties.entity_type.enum).toEqual(['Scope', 'File']);
    expect(queryEntities!.inputSchema.properties.conditions.items.properties.operator.enum).toContain('REGEX');
    expect(queryEntities!.inputSchema.properties.conditions.items.properties.operator.enum).toContain('GLOB');

    // Check semantic_search
    const semanticSearch = tools.find(t => t.name === 'semantic_search');
    expect(semanticSearch).toBeDefined();
    expect(semanticSearch!.description).toContain('scopeSourceEmbeddings');
    expect(semanticSearch!.description).toContain('uuid (string)');

    // Check explore_relationships
    const exploreRels = tools.find(t => t.name === 'explore_relationships');
    expect(exploreRels).toBeDefined();
    expect(exploreRels!.description).toContain('DEFINED_IN');
    expect(exploreRels!.description).toContain('Scope -->');
    expect(exploreRels!.description).toContain('File');

    // Check get_entity_by_id
    const getById = tools.find(t => t.name === 'get_entity_by_id');
    expect(getById).toBeDefined();
    expect(getById!.description).toContain('uuid (string)');
    expect(getById!.description).toContain('path (string)');

    // Check handlers exist
    expect(handlers['query_entities']).toBeDefined();
    expect(handlers['semantic_search']).toBeDefined();
    expect(handlers['explore_relationships']).toBeDefined();
    expect(handlers['get_entity_by_id']).toBeDefined();
  });

  it('should handle config without vector indexes', () => {
    const config: RagForgeConfig = {
      name: 'test-project',
      version: '1.0.0',
      neo4j: { uri: 'bolt://localhost:7687' },
      entities: [
        {
          name: 'Document',
          unique_field: 'id',
          searchable_fields: [
            { name: 'title', type: 'string' },
          ],
          relationships: [],
        },
      ],
    };

    const { tools } = generateToolsFromConfig(config);

    // Should not include semantic_search
    expect(tools.find(t => t.name === 'semantic_search')).toBeUndefined();
    expect(tools.find(t => t.name === 'query_entities')).toBeDefined();
  });

  it('should handle config without relationships', () => {
    const config: RagForgeConfig = {
      name: 'test-project',
      version: '1.0.0',
      neo4j: { uri: 'bolt://localhost:7687' },
      entities: [
        {
          name: 'Product',
          unique_field: 'id',
          searchable_fields: [
            { name: 'name', type: 'string' },
          ],
          relationships: [],
        },
      ],
    };

    const { tools } = generateToolsFromConfig(config);

    // Should not include explore_relationships
    expect(tools.find(t => t.name === 'explore_relationships')).toBeUndefined();
    expect(tools.find(t => t.name === 'query_entities')).toBeDefined();
  });

  it('should respect includeSemanticSearch option', () => {
    const config: RagForgeConfig = {
      name: 'test-project',
      version: '1.0.0',
      neo4j: { uri: 'bolt://localhost:7687' },
      entities: [
        {
          name: 'Scope',
          unique_field: 'uuid',
          searchable_fields: [{ name: 'name', type: 'string' }],
          vector_indexes: [
            {
              name: 'test',
              field: 'embedding',
              source_field: 'source',
              dimension: 768,
            },
          ],
          relationships: [],
        },
      ],
    };

    const { tools } = generateToolsFromConfig(config, {
      includeSemanticSearch: false,
    });

    expect(tools.find(t => t.name === 'semantic_search')).toBeUndefined();
  });

  it('should include multiple searchable fields in description', () => {
    const config: RagForgeConfig = {
      name: 'test-project',
      version: '1.0.0',
      neo4j: { uri: 'bolt://localhost:7687' },
      entities: [
        {
          name: 'Scope',
          unique_field: 'uuid',
          searchable_fields: [
            { name: 'name', type: 'string', description: 'Scope name' },
            { name: 'file', type: 'string', description: 'File path' },
            { name: 'type', type: 'string', description: 'Scope type' },
            { name: 'startLine', type: 'number', description: 'Start line' },
            { name: 'endLine', type: 'number', description: 'End line' },
          ],
          relationships: [],
        },
      ],
    };

    const { tools } = generateToolsFromConfig(config);
    const queryEntities = tools.find(t => t.name === 'query_entities')!;

    expect(queryEntities.description).toContain('name (string) - Scope name');
    expect(queryEntities.description).toContain('file (string) - File path');
    expect(queryEntities.description).toContain('type (string) - Scope type');
    expect(queryEntities.description).toContain('startLine (number) - Start line');
    expect(queryEntities.description).toContain('endLine (number) - End line');
  });

  it('should document relationship directions correctly', () => {
    const config: RagForgeConfig = {
      name: 'test-project',
      version: '1.0.0',
      neo4j: { uri: 'bolt://localhost:7687' },
      entities: [
        {
          name: 'Scope',
          unique_field: 'uuid',
          searchable_fields: [{ name: 'name', type: 'string' }],
          relationships: [
            {
              type: 'DEFINED_IN',
              direction: 'outgoing',
              target: 'File',
            },
            {
              type: 'CONTAINS',
              direction: 'incoming',
              target: 'Scope',
            },
          ],
        },
        {
          name: 'File',
          unique_field: 'path',
          searchable_fields: [{ name: 'path', type: 'string' }],
          relationships: [],
        },
      ],
    };

    const { tools } = generateToolsFromConfig(config);
    const exploreRels = tools.find(t => t.name === 'explore_relationships')!;

    expect(exploreRels.description).toContain('DEFINED_IN');
    expect(exploreRels.description).toContain('Scope -->');
    expect(exploreRels.description).toContain('CONTAINS');
    expect(exploreRels.description).toContain('<--');
  });
});
