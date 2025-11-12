/**
 * Quick test to verify EmbeddingProvider works with multiple providers
 */

import 'dotenv/config'; // Load .env from ragforge root
import { EmbeddingProvider } from './src/embedding/embedding-provider.js';

async function testProvider(providerName: string, config: any) {
  console.log(`\n🧪 Testing ${providerName}...`);

  try {
    const provider = new EmbeddingProvider(config);
    console.log(`✅ Provider created: ${provider.getProviderName()} / ${provider.getModelName()}`);

    const testText = 'Hello, this is a test embedding';
    const embedding = await provider.embedSingle(testText);

    console.log(`✅ Embedding generated: ${embedding.length} dimensions`);
    console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

    return true;
  } catch (error) {
    console.error(`❌ Error with ${providerName}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

async function main() {
  console.log('🚀 Testing Multi-Provider Embedding Support\n');
  console.log('=' .repeat(60));

  const results: Record<string, boolean> = {};

  // Test Gemini (if API key available)
  if (process.env.GEMINI_API_KEY) {
    results.gemini = await testProvider('Gemini', {
      provider: 'gemini',
      model: 'text-embedding-004',
      apiKey: process.env.GEMINI_API_KEY,
    });
  } else {
    console.log('\n⚠️  Skipping Gemini (no GEMINI_API_KEY)');
  }

  // Test OpenAI (if API key available)
  if (process.env.OPENAI_API_KEY) {
    results.openai = await testProvider('OpenAI', {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
      dimensions: 1536,
    });
  } else {
    console.log('\n⚠️  Skipping OpenAI (no OPENAI_API_KEY)');
  }

  // Test Ollama (local, no API key needed)
  results.ollama = await testProvider('Ollama', {
    provider: 'ollama',
    model: 'nomic-embed-text',
  });

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Summary:');
  Object.entries(results).forEach(([provider, success]) => {
    console.log(`   ${success ? '✅' : '❌'} ${provider}`);
  });

  const successCount = Object.values(results).filter(Boolean).length;
  const totalCount = Object.values(results).length;

  console.log(`\n${successCount}/${totalCount} providers working`);

  if (successCount === 0) {
    console.log('\n❌ No providers working. Please check:');
    console.log('   - Ollama: Install from https://ollama.ai and run `ollama pull nomic-embed-text`');
    console.log('   - Gemini: Set GEMINI_API_KEY environment variable');
    console.log('   - OpenAI: Set OPENAI_API_KEY environment variable');
    process.exit(1);
  }

  console.log('\n✅ Multi-provider support is working!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
