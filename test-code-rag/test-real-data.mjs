import { createRagClient } from './client.js';

const client = createRagClient();

console.log('🔍 Testing what actually exists in the database...\n');

try {
  // Test: Get ANY scopes to see what data we have
  const anyScopes = await client.scope().limit(5).execute();
  console.log('Sample scopes in DB:');
  anyScopes.forEach((r, i) => {
    console.log(`  [${i+1}] name: ${r.entity.name}`);
    console.log(`      type: ${r.entity.type}`);
    console.log(`      signature: ${r.entity.signature?.substring(0, 60)}...`);
  });

  console.log('\n🔗 Test 1: whereName() - Does it work?');
  const realScopeName = anyScopes[0]?.entity.name;
  if (realScopeName) {
    console.log(`Searching for name: ${realScopeName}`);
    const byName = await client.scope().whereName(realScopeName).execute();
    console.log(`✅ Found ${byName.length} scopes (should be 1)`);
  }

  console.log('\n🔗 Test 2: whereFileName() - Does it work?');
  // First get a File that exists
  const scopesWithFile = await client.scope()
    .whereFileName('code-generator.ts')
    .limit(5)
    .execute();
  console.log(`Result: ${scopesWithFile.length} scopes`);
  if (scopesWithFile.length === 0) {
    console.log('❌ whereFileName() returns 0 - might be broken or no matching file');
  } else {
    console.log('✅ whereFileName() works!');
  }

  console.log('\n🔗 Test 3: whereConsumesScope() - Does it work?');
  // Try with a scope that likely consumes something
  const withConsumes = await client.scope()
    .whereConsumesScope('createClient')
    .limit(5)
    .execute();
  console.log(`Result: ${withConsumes.length} scopes that consume 'createClient'`);
  if (withConsumes.length === 0) {
    console.log('❌ whereConsumesScope() returns 0 - might be broken or no CONSUMES relationships');
  } else {
    console.log('✅ whereConsumesScope() works!');
  }

  console.log('\n🔗 Test 4: withDefinedIn() - Does expansion work?');
  const firstScope = anyScopes[0]?.entity.name;
  const expanded = await client.scope()
    .whereName(firstScope)
    .withDefinedIn(1)
    .execute();
  console.log(`Result: ${expanded.length} scopes with expanded DEFINED_IN`);
  if (expanded.length > 0 && expanded[0].context?.related?.length > 0) {
    console.log(`✅ Expansion works! Found ${expanded[0].context.related.length} related entities`);
  } else {
    console.log('❌ No related entities in context');
  }

  console.log('\n🔗 Test 5: Semantic search - Does it work?');
  const semantic = await client.scope()
    .semanticSearchBySource('create client database', { topK: 5 })
    .execute();
  console.log(`✅ Found ${semantic.length} results by semantic search`);
  semantic.slice(0, 3).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (score: ${r.score.toFixed(3)})`);
  });

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
} finally {
  await client.close();
}
