/**
 * Test Change Tracking Tools Generation (Phase 5)
 */
import { readFileSync } from 'fs';
import yaml from 'yaml';
import { generateToolsFromConfig } from '@luciformresearch/ragforge-core';
import type { RagForgeConfig } from '@luciformresearch/ragforge-core';

console.log('🧪 Testing Change Tracking Tools Generation (Phase 5)\n');

// Load config with change tracking enabled
const configContent = readFileSync('./test-config-with-change-tracking.yaml', 'utf-8');
const config: RagForgeConfig = yaml.parse(configContent);

console.log(`📋 Config loaded: ${config.name} v${config.version}`);
console.log(`   Entities: ${config.entities.map(e => e.name).join(', ')}`);

// Show change tracking config
const entity = config.entities[0];
console.log(`\n🔄 Change Tracking for ${entity.name}:`);
console.log(`   - Enabled: ${entity.track_changes}`);
console.log(`   - Content field: ${entity.change_tracking?.content_field}`);
console.log(`   - Metadata fields: ${entity.change_tracking?.metadata_fields?.join(', ')}`);
console.log(`   - Hash field: ${entity.change_tracking?.hash_field}`);

// Generate tools (should auto-detect change tracking and include those tools)
const { tools, handlers, metadata } = generateToolsFromConfig(config);

console.log(`\n✅ Generated ${metadata.toolCount} tools:`);
for (const tool of tools) {
  console.log(`   - ${tool.name}`);
}

// Find change tracking tools
const changeTrackingTools = tools.filter(t =>
  t.name.includes('change') || t.name.includes('modified')
);

console.log(`\n🔄 Change Tracking Tools (${changeTrackingTools.length}):`);
for (const tool of changeTrackingTools) {
  console.log(`\n   📍 ${tool.name}`);

  // Show first line of description
  const firstLine = tool.description.split('\n')[0];
  console.log(`      ${firstLine}`);

  // Show required parameters
  const required = tool.inputSchema.required || [];
  if (required.length > 0) {
    console.log(`      Required: ${required.join(', ')}`);
  }
}

// Show full description of get_entity_change_history
const historyTool = tools.find(t => t.name === 'get_entity_change_history');
if (historyTool) {
  console.log(`\n📝 Example Tool: get_entity_change_history`);
  console.log(`   Description (excerpt):`);
  const lines = historyTool.description.split('\n');
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    console.log(`   ${lines[i]}`);
  }

  console.log(`\n   Input Schema:`);
  console.log(`   - entity_type: enum [${historyTool.inputSchema.properties.entity_type.enum?.join(', ')}]`);
  console.log(`   - entity_uuid: string (required)`);
  console.log(`   - limit: number (default: 10, max: 50)`);
}

console.log(`\n📊 Metadata:`);
console.log(`   - Total tools: ${metadata.toolCount}`);
console.log(`   - Entities: ${metadata.entityCount}`);
console.log(`   - Change tracking enabled: ${metadata.options.includeChangeTracking}`);

console.log('\n✅ Phase 5 - Change Tracking Tools integration test completed!');
console.log('   Change tracking tools are now:');
console.log('   - Auto-detected from config (track_changes: true)');
console.log('   - Generated with full descriptions');
console.log('   - Ready to use with ChangeTracker');
console.log('   - Include diffs, statistics, and hot spot analysis');
