/**
 * Test Tool Generation Integration
 *
 * Compares manual tool generation with new automated system
 */

import { readFileSync } from 'fs';
import * as yaml from 'yaml';
import { generateToolsFromConfig } from '../../packages/core/src/tools/tool-generator.js';

console.log('🧪 Testing Tool Generation Integration\n');

// Load config
const configContent = readFileSync('./ragforge.config.yaml', 'utf-8');
const config = yaml.parse(configContent);

console.log(`📋 Config loaded: ${config.name} v${config.version}`);
console.log(`   Entities: ${config.entities.map((e: any) => e.name).join(', ')}\n`);

// Generate tools
const { tools, handlers, metadata } = generateToolsFromConfig(config, {
  includeSemanticSearch: true,
  includeRelationships: true,
  includeSpecializedTools: false,
});

console.log(`✅ Generated ${metadata.toolCount} tools:`);
for (const tool of tools) {
  console.log(`   - ${tool.name}`);
}
console.log();

console.log(`📊 Metadata:`);
console.log(`   - Entities: ${metadata.entityCount}`);
console.log(`   - Searchable fields: ${metadata.searchableFieldsCount}`);
console.log(`   - Computed fields: ${metadata.computedFieldsCount}`);
console.log();

// Show detailed info for query_entities
const queryEntities = tools.find(t => t.name === 'query_entities')!;
console.log('═'.repeat(80));
console.log('QUERY_ENTITIES TOOL');
console.log('═'.repeat(80));
console.log(queryEntities.description);
console.log('═'.repeat(80));
console.log();

// Show detailed info for semantic_search
const semanticSearch = tools.find(t => t.name === 'semantic_search');
if (semanticSearch) {
  console.log('═'.repeat(80));
  console.log('SEMANTIC_SEARCH TOOL');
  console.log('═'.repeat(80));
  console.log(semanticSearch.description);
  console.log('═'.repeat(80));
  console.log();
}

// Show detailed info for explore_relationships
const exploreRels = tools.find(t => t.name === 'explore_relationships');
if (exploreRels) {
  console.log('═'.repeat(80));
  console.log('EXPLORE_RELATIONSHIPS TOOL');
  console.log('═'.repeat(80));
  console.log(exploreRels.description);
  console.log('═'.repeat(80));
  console.log();
}

// Show detailed info for get_entity_by_id
const getById = tools.find(t => t.name === 'get_entity_by_id')!;
console.log('═'.repeat(80));
console.log('GET_ENTITY_BY_ID TOOL');
console.log('═'.repeat(80));
console.log(getById.description);
console.log('═'.repeat(80));
console.log();

console.log('✅ Tool generation test completed successfully!\n');
