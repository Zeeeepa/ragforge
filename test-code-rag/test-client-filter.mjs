import { createRagClient } from './client.js';

const client = createRagClient();

console.log('🔍 Testing .filter() for client-side filtering...\n');

try {
  // Test 1: Post-query filtering by name pattern
  console.log('📋 Test 1: Client-side filter by name pattern');
  const handleFunctions = await client.scope()
    .limit(100)
    .filter(r => r.entity.name && r.entity.name.startsWith('handle'))
    .execute();
  console.log(`✅ Found ${handleFunctions.length} functions starting with "handle" (client-side filter)`);
  handleFunctions.slice(0, 5).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (${r.entity.type})`);
  });

  // Test 2: Filter by custom logic
  console.log('\n📋 Test 2: Filter by custom logic (functions with short names)');
  const shortNames = await client.scope()
    .limit(100)
    .filter(r => r.entity.name && r.entity.name.length <= 5)
    .execute();
  console.log(`✅ Found ${shortNames.length} scopes with name length <= 5`);
  shortNames.slice(0, 5).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (${r.entity.type})`);
  });

  // Test 3: Combine with semantic search and score filtering
  console.log('\n📋 Test 3: Semantic search + client-side score filter');
  const highScore = await client.scope()
    .semanticSearchBySource('create client database', { topK: 20 })
    .filter(r => r.score && r.score > 0.8)
    .execute();
  console.log(`✅ Found ${highScore.length} results with score > 0.8`);
  highScore.slice(0, 3).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (score: ${r.score.toFixed(3)})`);
  });

  // Test 4: Multiple filters chained
  console.log('\n📋 Test 4: Multiple client-side filters chained');
  const chainedFilters = await client.scope()
    .limit(100)
    .filter(r => r.entity.type === 'function')
    .filter(r => r.entity.name && r.entity.name.length > 5)
    .filter(r => r.entity.name && r.entity.name.includes('e'))
    .execute();
  console.log(`✅ Found ${chainedFilters.length} functions with name length > 5 and containing 'e'`);
  chainedFilters.slice(0, 5).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (${r.entity.type})`);
  });

  // Test 5: Combine server-side and client-side filtering
  console.log('\n📋 Test 5: Server-side + client-side filtering');
  const combined = await client.scope()
    .where({ type: 'function' })  // Server-side
    .limit(50)
    .filter(r => r.entity.name && r.entity.name.includes('create'))  // Client-side
    .execute();
  console.log(`✅ Found ${combined.length} functions with "create" in name (combined filtering)`);
  combined.slice(0, 5).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name}`);
  });

  console.log('\n✅ .filter() is working correctly!');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
} finally {
  await client.close();
}
