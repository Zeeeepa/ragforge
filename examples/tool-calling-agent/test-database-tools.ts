/**
 * Test Database Tools Generator
 */

import { createRagClient } from './client.js';
import { generateDatabaseTools } from './database-tools-generator.js';

async function main() {
  console.log('🧪 Testing Database Tools Generator\n');

  const rag = createRagClient();

  // Generate tools from config
  console.log('📋 Generating tools from ragforge.config.yaml...');
  const { tools, handlers } = await generateDatabaseTools('./ragforge.config.yaml', rag);

  console.log(`\n✅ Generated ${tools.length} tools:\n`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description.split('\n')[0]}`);
  }

  console.log('\n\n🔍 Testing query_entities tool...\n');
  const result1 = await handlers.query_entities({
    entity_type: 'Scope',
    conditions: [
      { field: 'type', operator: '=', value: 'function' }
    ],
    limit: 3
  });

  console.log(`Found ${result1.count} scopes`);
  console.log(`Unique field: ${result1.unique_field}`);
  if (result1.results.length > 0) {
    console.log(`First result:`, result1.results[0]);
  }

  console.log('\n\n🔍 Testing semantic_search tool...\n');
  const result2 = await handlers.semantic_search({
    entity_type: 'Scope',
    query: 'functions that handle authentication',
    top_k: 3,
    min_score: 0.7
  });

  console.log(`Query: "${result2.query}"`);
  console.log(`Found ${result2.count} results`);
  console.log(`Index used: ${result2.index_used}`);
  console.log(`Unique field: ${result2.unique_field}`);
  if (result2.results.length > 0) {
    console.log(`\nTop result:`);
    console.log(`  ${result2.unique_field}: ${result2.results[0][result2.unique_field]}`);
    console.log(`  name: ${result2.results[0].name}`);
    console.log(`  score: ${result2.results[0].score}`);
  }

  console.log('\n\n🔍 Testing explore_relationships tool...\n');
  const result3 = await handlers.explore_relationships({
    start_entity_type: 'Scope',
    start_conditions: [
      { field: 'name', operator: '=', value: 'generateDatabaseTools' }
    ],
    relationship_type: 'DEFINED_IN',
    direction: 'outgoing',
    target_entity_type: 'File',
    limit: 5
  });

  console.log(`Relationship: ${result3.relationship}`);
  console.log(`Found ${result3.count} connected entities`);
  console.log(`Target unique field: ${result3.target_unique_field}`);
  if (result3.results.length > 0) {
    console.log(`First result:`, result3.results[0]);
  }

  console.log('\n\n🔍 Testing get_entity_by_id tool...\n');
  if (result1.results.length > 0) {
    const firstScope = result1.results[0];
    const idValue = firstScope[result1.unique_field];

    const result4 = await handlers.get_entity_by_id({
      entity_type: 'Scope',
      id_value: idValue
    });

    console.log(`Entity type: ${result4.entity_type}`);
    console.log(`Unique field: ${result4.unique_field}`);
    console.log(`Name: ${result4.name}`);
    console.log(`Type: ${result4.type}`);
    console.log(`File: ${result4.file}`);
  }

  console.log('\n\n✅ All tools working correctly!\n');

  await rag.close();
}

main().catch(console.error);
