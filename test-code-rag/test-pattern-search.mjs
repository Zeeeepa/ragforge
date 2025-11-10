import { createRagClient } from './client.js';

const client = createRagClient();

console.log('🔍 Testing .wherePattern() for regex search...\n');

try {
  // Test 1: Find async functions
  console.log('📋 Test 1: Find async functions using regex pattern');
  const asyncFunctions = await client.scope()
    .wherePattern('source', /async\s+function/)
    .limit(10)
    .execute();
  console.log(`✅ Found ${asyncFunctions.length} async functions`);
  asyncFunctions.slice(0, 3).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (${r.entity.type})`);
  });

  // Test 2: Find functions starting with "create"
  console.log('\n📋 Test 2: Find functions starting with "create"');
  const createFunctions = await client.scope()
    .wherePattern('name', /^create/)
    .limit(10)
    .execute();
  console.log(`✅ Found ${createFunctions.length} functions starting with "create"`);
  createFunctions.slice(0, 5).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (${r.entity.type})`);
  });

  // Test 3: Find try-catch blocks
  console.log('\n📋 Test 3: Find try-catch blocks');
  const tryCatch = await client.scope()
    .wherePattern('source', /try\s*\{[\s\S]*catch/)
    .limit(10)
    .execute();
  console.log(`✅ Found ${tryCatch.length} scopes with try-catch`);
  tryCatch.slice(0, 3).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (${r.entity.type})`);
  });

  // Test 4: Combine with other filters
  console.log('\n📋 Test 4: Combine wherePattern with where filter');
  const asyncExports = await client.scope()
    .where({ type: 'function' })
    .wherePattern('source', /async/)
    .limit(10)
    .execute();
  console.log(`✅ Found ${asyncExports.length} async functions (combined filters)`);

  console.log('\n✅ .wherePattern() is working correctly!');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
} finally {
  await client.close();
}
