import { createRagClient } from '../client.js';
import type { SearchResult } from '@luciformresearch/ragforge-runtime';

/**
 * @example Stopping criteria logic
 * @description Demonstrate when to stop searching
 * @intent Show decision logic for iterative search with quality thresholds
 * @tags stopping, criteria, iterative, quality
 */
async function stoppingCriteriaLogic() {
  const rag = createRagClient(); // Uses .env variables automatically

  const MAX_ITERATIONS = 3;
  const TARGET_RESULTS = 5;
  const MIN_SCORE = 0.8;

  let allResults: any[] = [];
  let iteration = 0;
  let shouldContinue = true;

  while (shouldContinue && iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\nIteration ${iteration}`);

    // Progressive search strategy
    const query = iteration === 1 ? 'initial query' : 'refined query';

    const results = await rag.scope()
      .semanticSearchBySource(query, { topK: 30 })
      .execute();

    allResults = [...allResults, ...results];
    console.log(`  Found ${results.length} results`);

    // Stopping criteria
    const highQuality = allResults.filter(r => r.score >= MIN_SCORE);

    if (highQuality.length >= TARGET_RESULTS) {
      console.log(`  ✅ STOP: Found ${highQuality.length} high-quality results`);
      shouldContinue = false;
    } else if (results.length === 0) {
      console.log(`  ⚠️ STOP: No results, need different strategy`);
      shouldContinue = false;
    } else if (iteration === MAX_ITERATIONS) {
      console.log(`  ⏱️ STOP: Max iterations reached`);
    } else {
      console.log(`  🔄 CONTINUE: Only ${highQuality.length}/${TARGET_RESULTS} high-quality`);
    }
  }

  console.log(`\nFinal: ${allResults.length} total, ${iteration} iterations`);

  await rag.close();
  return allResults;
}

export { stoppingCriteriaLogic };

// Only run if executed directly (not imported)
if (import.meta.url.startsWith('file://')) {
  const modulePath = new URL(import.meta.url).pathname;
  const executedPath = process.argv[1];
  if (executedPath && modulePath.endsWith(executedPath.split('/').pop() || '')) {
    stoppingCriteriaLogic()
      .then(() => process.exit(0))
      .catch(err => {
        console.error('❌ Failed:', err);
        console.error(err.stack);
        process.exit(1);
      });
  }
}
