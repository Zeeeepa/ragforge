import { createRagClient } from './client.js';

const client = createRagClient();

console.log('🔍 Testing custom code searches...\n');

try {
  // Test 1: Find all error handling code (try-catch blocks)
  console.log('📋 Test 1: Find error handling code (try-catch)');
  console.log('❌ Problem: Cannot search by regex pattern in source code');
  console.log('Current workaround: Semantic search with broad query\n');

  const errorHandling = await client.scope()
    .semanticSearchBySource('try catch error handling exception', { topK: 20 })
    .execute();

  console.log(`Found ${errorHandling.length} results`);
  console.log('But this gives semantic similarity, not exact pattern matches\n');

  // Test 2: Find all functions that start with "handle"
  console.log('📋 Test 2: Find functions starting with "handle"');
  console.log('❌ Problem: Cannot filter by name pattern/regex');
  console.log('Would need: .whereNameMatches(/^handle/)\n');

  const allScopes = await client.scope().limit(100).execute();
  const handleFunctions = allScopes.filter(r =>
    r.entity.name && r.entity.name.startsWith('handle')
  );
  console.log(`Found ${handleFunctions.length} "handle*" functions (client-side filter)`);
  console.log('But this requires fetching ALL scopes first (inefficient)\n');

  // Test 3: Find all async functions
  console.log('📋 Test 3: Find async functions');
  console.log('❌ Problem: Cannot search for code patterns like "async function"');
  console.log('Current workaround: Semantic search\n');

  const asyncFunctions = await client.scope()
    .semanticSearchBySource('async function await promise', { topK: 20 })
    .execute();

  console.log(`Found ${asyncFunctions.length} results (semantic, not pattern-based)\n`);

  // Test 4: Find all classes that implement an interface
  console.log('📋 Test 4: Find classes implementing specific interface');
  console.log('❌ Problem: No "implements" field in schema, cannot filter by it');
  console.log('Would need: .whereImplements("SomeInterface")\n');

  // Test 5: Find recently modified code
  console.log('📋 Test 5: Find recently modified code');
  console.log('❌ Problem: No timestamp metadata in Neo4j');
  console.log('Would need: timestamps from git or file system\n');

  // Test 6: Find code by file path pattern
  console.log('📋 Test 6: Find code in specific directories');
  console.log('✅ Possible with relationship filtering (if File has path)');

  const inSrc = await client.scope()
    .whereFileName('src/generator/code-generator.ts')
    .limit(10)
    .execute();

  console.log(`Found ${inSrc.length} scopes in specific file`);
  console.log('But cannot filter by path pattern like "src/**/*.ts"\n');

  // Test 7: Find code that calls a specific function
  console.log('📋 Test 7: Find code that calls "generateContent"');
  console.log('✅ Possible with CONSUMES relationship (incoming direction)');

  const callsGenerate = await client.scope()
    .whereConsumedByScope('generateContent')
    .limit(10)
    .execute();

  console.log(`Found ${callsGenerate.length} scopes that consume generateContent\n`);

  // Test 8: Complex boolean search
  console.log('📋 Test 8: Find (async functions OR promises) AND (in src/ directory)');
  console.log('❌ Problem: Limited boolean logic in filters');
  console.log('Would need: .where({ OR: [...], AND: [...] })\n');

  console.log('='.repeat(60));
  console.log('🎯 SUMMARY OF MISSING FEATURES:');
  console.log('='.repeat(60));
  console.log('1. ❌ Regex/pattern search on source code');
  console.log('2. ❌ Name pattern matching (startsWith, contains, regex)');
  console.log('3. ❌ File path pattern matching (glob patterns)');
  console.log('4. ❌ Timestamp/recency filtering');
  console.log('5. ❌ Complex boolean queries (OR/AND combinations)');
  console.log('6. ❌ Code structure search (find all classes, interfaces, etc.)');
  console.log('7. ❌ Client-side .filter() for post-query filtering');
  console.log('8. ✅ Semantic search (works well)');
  console.log('9. ✅ Relationship filtering (works well)');
  console.log('10. ✅ LLM reranking (works well)');

} catch (error) {
  console.error('Error:', error.message);
} finally {
  await client.close();
}
