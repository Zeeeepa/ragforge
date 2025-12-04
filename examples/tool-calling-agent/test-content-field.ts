/**
 * Test content_field + get_entities_by_ids
 *
 * Vérifie que:
 * 1. get_schema retourne content_field
 * 2. get_entities_by_ids fonctionne avec les IDs de semantic_search
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { createRagClient } from './client.js';

// Import directly from source for testing
import { generateToolsFromConfig } from '../../packages/core/src/tools/tool-generator.js';

config({ path: resolve(process.cwd(), '.env') });

function loadYamlConfig(configPath: string): any {
  const content = fs.readFileSync(configPath, 'utf-8');
  return yaml.load(content);
}

async function main() {
  console.log('🧪 Test content_field + get_entities_by_ids\n');

  // Load config
  const ragConfig = loadYamlConfig('./ragforge.config.yaml');
  console.log('✅ Config loaded');

  // Generate tools
  const { tools, handlers } = generateToolsFromConfig(ragConfig);
  console.log(`✅ Generated ${tools.length} tools`);
  console.log(`   Tools: ${tools.map(t => t.name).join(', ')}\n`);

  // Create RAG client
  const rag = createRagClient();

  // Attach handlers to rag client
  const boundHandlers: Record<string, (args: any) => Promise<any>> = {};
  for (const [name, handlerGen] of Object.entries(handlers)) {
    boundHandlers[name] = handlerGen(rag);
  }

  // Test 1: get_schema - check content_field is present
  console.log('='.repeat(60));
  console.log('TEST 1: get_schema returns content_field');
  console.log('='.repeat(60));

  const schema = await boundHandlers['get_schema']({ include_tips: true });
  const scopeSchema = schema.entity_details?.Scope;

  console.log(`\n📋 Scope entity schema:`);
  console.log(`   unique_field: ${scopeSchema?.unique_field}`);
  console.log(`   display_name_field: ${scopeSchema?.display_name_field}`);
  console.log(`   content_field: ${scopeSchema?.content_field}`);
  console.log(`   hierarchical_content: ${JSON.stringify(scopeSchema?.hierarchical_content)}`);
  console.log(`\n📝 Usage tips:`);
  for (const tip of schema.usage_tips || []) {
    console.log(`   - ${tip}`);
  }

  if (scopeSchema?.content_field === 'source') {
    console.log('\n✅ content_field correctly set to "source"');
  } else {
    console.log('\n❌ content_field missing or incorrect');
  }

  // Test 2: semantic_search
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: semantic_search returns IDs');
  console.log('='.repeat(60));

  const searchResults = await boundHandlers['semantic_search']({
    entity_type: 'Scope',
    query: 'StructuredLLMExecutor',
    top_k: 3,
  });

  console.log(`\n🔍 Found ${searchResults.count} results`);
  const ids: string[] = [];
  for (const r of searchResults.results || []) {
    console.log(`   - ${r.name} (${r.uuid}) score: ${r.score}`);
    console.log(`     snippet: ${r.snippet?.substring(0, 80)}...`);
    ids.push(r.uuid);
  }

  // Test 3: get_entities_by_ids
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: get_entities_by_ids returns full content');
  console.log('='.repeat(60));

  if (ids.length > 0) {
    const entities = await boundHandlers['get_entities_by_ids']({
      entity_type: 'Scope',
      ids: ids.slice(0, 2), // Just first 2
    });

    console.log(`\n📦 Fetched ${entities.found} entities`);
    console.log(`   Fields returned: ${entities.fields_returned?.join(', ')}`);
    console.log(`   content_field: ${entities.content_field}`);

    for (const e of entities.results || []) {
      const contentLength = e.source?.length || 0;
      console.log(`\n   📄 ${e.name}`);
      console.log(`      uuid: ${e.uuid}`);
      console.log(`      source length: ${contentLength} chars`);
      if (contentLength > 0) {
        console.log(`      source preview: ${e.source?.substring(0, 150)}...`);
      }
    }

    if (entities.results?.[0]?.source?.length > 200) {
      console.log('\n✅ Full content retrieved (not just snippet)');
    } else {
      console.log('\n⚠️ Content seems short, check if full source was returned');
    }
  }

  // Test 4: get_entities_by_ids with specific fields
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: get_entities_by_ids with specific fields');
  console.log('='.repeat(60));

  if (ids.length > 0) {
    const entities = await boundHandlers['get_entities_by_ids']({
      entity_type: 'Scope',
      ids: ids.slice(0, 1),
      fields: ['name', 'file'], // Without source
    });

    console.log(`\n📦 Fetched with fields: ${entities.fields_returned?.join(', ')}`);
    for (const e of entities.results || []) {
      console.log(`   name: ${e.name}`);
      console.log(`   file: ${e.file}`);
      console.log(`   source: ${e.source ? 'present' : 'not requested'}`);
    }

    if (!entities.results?.[0]?.source) {
      console.log('\n✅ Field filtering works correctly');
    }
  }

  await rag.close();
  console.log('\n✅ All tests completed!');
}

main().catch(console.error);
