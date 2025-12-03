/**
 * Test Code Generation with Tools (Phase 2)
 */
import { readFileSync } from 'fs';
import yaml from 'yaml';
import { CodeGenerator, SchemaIntrospector } from '@luciformresearch/ragforge-core';
import type { RagForgeConfig } from '@luciformresearch/ragforge-core';

console.log('🧪 Testing Code Generation with Tools Integration\n');

// Load config
const configContent = readFileSync('./ragforge.config.yaml', 'utf-8');
const config: RagForgeConfig = yaml.parse(configContent);

console.log(`📋 Config loaded: ${config.name} v${config.version}`);
console.log(`   Entities: ${config.entities.map(e => e.name).join(', ')}\n`);

// Generate minimal schema (we don't need real Neo4j for this test)
const schema = {
  nodes: config.entities.map(e => ({
    label: e.name,
    properties: e.searchable_fields.map(f => ({ name: f.name, type: 'string' as any })),
    count: 0
  })),
  relationships: [],
  indexes: [],
  constraints: [],
  vectorIndexes: []
};

// Generate code
const generated = CodeGenerator.generate(config, schema);

console.log('✅ Code generation completed!');
console.log(`   - Queries: ${generated.queries.size} entities`);
console.log(`   - Mutations: ${generated.mutations.size} entities`);
console.log(`   - Client: ${generated.client ? 'Generated' : 'Missing'}`);
console.log(`   - Index: ${generated.index ? 'Generated' : 'Missing'}`);
console.log(`   - Tools: ${generated.tools ? 'Generated' : 'Missing'}\n`);

if (generated.tools) {
  console.log('🛠️  Generated Tool Files:');
  console.log(`   - database-tools.ts: ${generated.tools.databaseTools.split('\n').length} lines`);
  console.log(`   - custom-tools.ts: ${generated.tools.customTools.split('\n').length} lines`);
  console.log(`   - index.ts: ${generated.tools.index.split('\n').length} lines`);
  console.log('');

  // Show first entity example in custom-tools
  const firstEntity = config.entities[0];
  const customToolsLines = generated.tools.customTools.split('\n');
  const exampleStart = customToolsLines.findIndex(line => line.includes('name:'));

  if (exampleStart > 0) {
    console.log('📝 Custom Tools Example (generated from config):');
    console.log(customToolsLines.slice(exampleStart, exampleStart + 10).map(l => '   ' + l).join('\n'));
    console.log('');
  }

  // Show database tools count
  const dbToolsMatch = generated.tools.databaseTools.match(/export const DATABASE_TOOLS.*?\[([^\]]+)\]/s);
  if (dbToolsMatch) {
    const toolsCount = (dbToolsMatch[1].match(/{\s*name:/g) || []).length;
    console.log(`✅ Database Tools: ${toolsCount} tools generated`);
  }
}

console.log('\n✅ Phase 2 integration test completed successfully!');
