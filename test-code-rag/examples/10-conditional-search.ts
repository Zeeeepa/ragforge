import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Conditional search strategy
 * @description Adapt search based on initial results
 * @intent Demonstrate decision-making based on result count and quality
 * @tags conditional, adaptive, strategy
 */
async function conditionalSearchStrategy() {
  const rag = createRagClient(); // Uses .env variables automatically

  // Initial broad search
  let results = await rag.scope()
    .semanticSearchBySource('query', { topK: 50 })
    .execute();

  console.log(`Found ${results.length} initial results`);

  // Decision 1: Too few results? Broaden query
  if (results.length < 5) {
    console.log('Too few results, broadening query...');
    results = await rag.scope()
      .semanticSearchBySource('broader query terms', { topK: 50 })
      .execute();
  }

  // Decision 2: Too many results? Add filter or rerank
  if (results.length > 30) {
    console.log('Too many results, refining with llmRerank...');
    results = await rag.scope()
      .semanticSearchBySource('query', { topK: 50 })
      .llmRerank('specific question', { topK: 10 })
      .execute();
  }

  // Decision 3: Get context for top results if found
  if (results.length > 0) {
    console.log(`Final: ${results.length} results`);
    results.slice(0, 3).forEach(r => {
      console.log(`  - ${r.entity.name} (score: ${r.score.toFixed(3)})`);
    });
  }

  await rag.close();
  return results;
}

export { conditionalSearchStrategy };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    conditionalSearchStrategy()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
