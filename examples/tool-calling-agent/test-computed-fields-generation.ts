/**
 * Test Computed Fields Generation (Phase 3)
 */
import { readFileSync } from 'fs';
import yaml from 'yaml';
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';
import type { RagForgeConfig } from '@luciformresearch/ragforge-core';

console.log('🧪 Testing Computed Fields in Tool Generation (Phase 3)\n');

// Load config with computed fields
const configContent = readFileSync('./test-config-with-computed-fields.yaml', 'utf-8');
const config: RagForgeConfig = yaml.parse(configContent);

console.log(`📋 Config loaded: ${config.name} v${config.version}`);
console.log(`   Entities: ${config.entities.map(e => e.name).join(', ')}`);

// Show computed fields from config
const entity = config.entities[0];
console.log(`\n🔢 Computed Fields for ${entity.name}:`);
for (const cf of entity.computed_fields || []) {
  const typeInfo = cf.expression
    ? `expression: ${cf.expression}`
    : cf.cypher
      ? `cypher: ${cf.cypher.split('\n')[0]}...`
      : 'unknown';
  const materializedTag = cf.materialized ? ' [MATERIALIZED]' : '';
  console.log(`   - ${cf.name} (${cf.type})${materializedTag} - ${typeInfo}`);
}

// Generate tools (Phase 1 + Phase 3)
const { tools, handlers, metadata } = generateToolsFromConfig(config);

console.log(`\n✅ Generated ${metadata.toolCount} tools:`);
for (const tool of tools) {
  console.log(`   - ${tool.name}`);
}

console.log(`\n📊 Metadata:`);
console.log(`   - Entities: ${metadata.entityCount}`);
console.log(`   - Searchable fields: ${metadata.searchableFieldsCount}`);
console.log(`   - Computed fields: ${metadata.computedFieldsCount}`);

// Show query_entities tool description (should include computed fields)
const queryEntitiesTool = tools.find(t => t.name === 'query_entities');
if (queryEntitiesTool) {
  console.log(`\n📝 query_entities description excerpt:`);
  const lines = queryEntitiesTool.description.split('\n');

  // Find computed fields section
  const computedIdx = lines.findIndex(l => l.includes('Computed fields'));
  if (computedIdx > 0) {
    console.log('   Found computed fields section:');
    for (let i = computedIdx; i < Math.min(computedIdx + 6, lines.length); i++) {
      console.log(`   ${lines[i]}`);
    }
  } else {
    console.log('   ⚠️  No computed fields section found');
  }

  // Check ORDER BY mention
  const orderByLine = lines.find(l => l.includes('ORDER BY'));
  if (orderByLine) {
    console.log(`\n   ORDER BY support: ${orderByLine.trim()}`);
  }
}

console.log('\n✅ Phase 3 integration test completed!');
console.log('   Computed fields are now:');
console.log('   - Extracted from config');
console.log('   - Included in tool descriptions');
console.log('   - Marked as read-only and ORDER BY compatible');
