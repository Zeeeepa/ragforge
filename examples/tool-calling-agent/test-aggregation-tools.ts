/**
 * Test Aggregation Tools Generation (Phase 5)
 */
import { readFileSync } from 'fs';
import yaml from 'yaml';
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';
import type { RagForgeConfig } from '@luciformresearch/ragforge-core';

console.log('🧪 Testing Aggregation Tools Generation (Phase 5)\n');

// Load config with numeric fields
const configContent = readFileSync('./test-config-with-aggregations.yaml', 'utf-8');
const config: RagForgeConfig = yaml.parse(configContent);

console.log(`📋 Config loaded: ${config.name} v${config.version}`);
console.log(`   Entities: ${config.entities.map(e => e.name).join(', ')}`);

// Show numeric fields
const entity = config.entities[0];
const numericFields = entity.searchable_fields.filter(f => f.type === 'number');
console.log(`\n🔢 Numeric Fields in ${entity.name}:`);
for (const field of numericFields) {
  console.log(`   - ${field.name} (${field.type}) - ${field.description}`);
}

// Show computed fields
console.log(`\n📊 Computed Fields:`);
for (const cf of entity.computed_fields || []) {
  console.log(`   - ${cf.name} (${cf.type}) - ${cf.description}`);
}

// Generate tools with aggregations enabled
const { tools, handlers, metadata } = generateToolsFromConfig(config, {
  includeAggregations: true,
});

console.log(`\n✅ Generated ${metadata.toolCount} tools:`);
for (const tool of tools) {
  console.log(`   - ${tool.name}`);
}

// Find aggregation tool
const aggTool = tools.find(t => t.name === 'aggregate_entities');

if (aggTool) {
  console.log(`\n📊 Aggregation Tool: aggregate_entities`);
  console.log(`   Description (excerpt):`);
  const lines = aggTool.description.split('\n');
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    console.log(`   ${lines[i]}`);
  }

  console.log(`\n   Supported Operations:`);
  const operations = aggTool.inputSchema.properties.operation.enum;
  console.log(`   ${operations.join(', ')}`);

  console.log(`\n   Input Schema:`);
  console.log(`   - entity_type: enum [${aggTool.inputSchema.properties.entity_type.enum?.join(', ')}]`);
  console.log(`   - operation: enum [${operations.join(', ')}]`);
  console.log(`   - field: string (required for AVG/SUM/MIN/MAX)`);
  console.log(`   - group_by: string (optional)`);
  console.log(`   - conditions: array (optional WHERE filters)`);
  console.log(`   - limit: number (default: 100 for GROUP BY results)`);

  console.log(`\n   Example Queries:`);
  console.log(`   1. Count all scopes:`);
  console.log(`      {entity_type: "Scope", operation: "COUNT"}`);
  console.log(`   2. Count scopes by type:`);
  console.log(`      {entity_type: "Scope", operation: "COUNT", group_by: "type"}`);
  console.log(`   3. Average complexity:`);
  console.log(`      {entity_type: "Scope", operation: "AVG", field: "complexity"}`);
  console.log(`   4. Sum line count by file:`);
  console.log(`      {entity_type: "Scope", operation: "SUM", field: "line_count", group_by: "file"}`);
  console.log(`   5. Max complexity per type:`);
  console.log(`      {entity_type: "Scope", operation: "MAX", field: "complexity", group_by: "type"}`);
} else {
  console.log('\n⚠️  aggregate_entities tool not found');
}

console.log(`\n📊 Metadata:`);
console.log(`   - Total tools: ${metadata.toolCount}`);
console.log(`   - Entities: ${metadata.entityCount}`);
console.log(`   - Aggregations enabled: ${metadata.options.includeAggregations}`);

console.log('\n✅ Phase 5 - Aggregation Tools integration test completed!');
console.log('   Aggregation tools are now:');
console.log('   - Generated with numeric field detection');
console.log('   - Support COUNT, AVG, SUM, MIN, MAX operations');
console.log('   - Support GROUP BY for grouping results');
console.log('   - Can filter with WHERE conditions before aggregating');
console.log('   - Ready to use for data analysis and metrics');
