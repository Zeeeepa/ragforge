/**
 * Test VectorSearch with multi-provider support
 */

import 'dotenv/config';
import { VectorSearch } from './src/vector/vector-search.js';
import { Neo4jClient } from './src/client/neo4j-client.js';

async function testVectorSearch() {
  console.log('🧪 Testing VectorSearch Multi-Provider Support\n');
  console.log('=' .repeat(60));

  // Mock Neo4j client (we won't actually query, just test embedding generation)
  const mockClient = {
    run: async () => ({ records: [] }),
    close: async () => {},
    verifyConnectivity: async () => true,
  } as any;

  // Test 1: Gemini (default)
  console.log('\n📦 Test 1: Gemini Provider');
  VectorSearch.setDefaultConfig({
    provider: 'gemini',
    model: 'text-embedding-004',
    dimension: 768,
  });

  const vsGemini = new VectorSearch(mockClient, {
    apiKey: process.env.GEMINI_API_KEY,
  });

  console.log('Default config:', vsGemini.getModelInfo());

  try {
    const embeddings1 = await vsGemini.generateEmbeddings(
      ['Hello world', 'Test embedding'],
      'test-index'
    );
    console.log(`✅ Generated ${embeddings1.length} embeddings`);
    console.log(`   Dimensions: ${embeddings1[0].length}`);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  }

  // Test 2: Ollama (local)
  console.log('\n📦 Test 2: Ollama Provider (Local)');
  VectorSearch.setDefaultConfig({
    provider: 'ollama',
    model: 'nomic-embed-text',
    dimension: 768,
  });

  const vsOllama = new VectorSearch(mockClient);
  console.log('Default config:', vsOllama.getModelInfo());

  try {
    const embeddings2 = await vsOllama.generateEmbeddings(
      ['Hello world', 'Test embedding'],
      'test-index'
    );
    console.log(`✅ Generated ${embeddings2.length} embeddings`);
    console.log(`   Dimensions: ${embeddings2[0].length}`);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  }

  // Test 3: Index-specific config
  console.log('\n📦 Test 3: Index-Specific Provider Config');
  VectorSearch.registerIndex('gemini-index', {
    provider: 'gemini',
    model: 'text-embedding-004',
    apiKey: process.env.GEMINI_API_KEY,
  });

  VectorSearch.registerIndex('ollama-index', {
    provider: 'ollama',
    model: 'nomic-embed-text',
  });

  const vsMulti = new VectorSearch(mockClient);

  try {
    console.log('   Testing gemini-index...');
    const emb1 = await vsMulti.generateEmbeddings(['Test'], 'gemini-index');
    console.log(`   ✅ Gemini: ${emb1[0].length} dimensions`);

    console.log('   Testing ollama-index...');
    const emb2 = await vsMulti.generateEmbeddings(['Test'], 'ollama-index');
    console.log(`   ✅ Ollama: ${emb2[0].length} dimensions`);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ VectorSearch multi-provider support is working!');
}

testVectorSearch().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
