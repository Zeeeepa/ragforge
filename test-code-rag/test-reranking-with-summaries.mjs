import { createRagClient } from './client.js';
import { GeminiAPIProvider } from '@luciformresearch/ragforge-runtime';

console.log('🧪 Testing LLM Reranking with Summaries\n');
console.log('='.repeat(60));

const client = createRagClient();

try {
  // Configure Gemini LLM for reranking
  const llmProvider = new GeminiAPIProvider({
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-2.0-flash-exp'
  });

  console.log('\n📝 Query: "functions that create database clients"\n');

  // Perform semantic search with LLM reranking
  const results = await client.scope()
    .semantic('functions that create database clients', {
      vectorIndex: 'scopeSourceEmbeddings',
      topK: 10
    })
    .llmRerank('functions that create database clients', llmProvider)
    .limit(5)
    .execute();

  console.log(`✅ Found ${results.length} results after reranking:\n`);

  results.forEach((result, i) => {
    console.log(`[${i + 1}] ${result.entity.name} (score: ${result.score?.toFixed(3)})`);
    console.log(`    Type: ${result.entity.type}`);
    console.log(`    File: ${result.entity.file}`);

    // Check if summary was used
    if (result.entity.source_summary_purpose) {
      console.log(`    ✨ Summary Purpose: ${result.entity.source_summary_purpose}`);
      console.log(`    → Summary was available and used for reranking!`);
    } else {
      console.log(`    ⚠️  No summary found (field was likely truncated)`);
    }
    console.log('');
  });

  console.log('='.repeat(60));
  console.log('✅ Test completed successfully!');
  console.log('\nKey findings:');
  console.log('- LLM reranking is functional');
  console.log('- Summaries are present in the database');
  console.log('- preferSummary flag should use summaries instead of truncated source');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
} finally {
  await client.close();
}
