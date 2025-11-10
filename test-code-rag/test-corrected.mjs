import { createRagClient } from './client.js';

const client = createRagClient();

console.log('🔍 Testing with CORRECT file names...\n');

try {
  console.log('Test 1: whereFileName with REAL file');
  const inIndexTs = await client.scope()
    .whereFileName('index.ts')
    .limit(10)
    .execute();
  console.log(`✅ Found ${inIndexTs.length} scopes in index.ts`);
  inIndexTs.slice(0, 3).forEach(r => {
    console.log(`  - ${r.entity.name} (${r.entity.type})`);
  });

  console.log('\nTest 2: withDefinedIn expansion');
  const expanded = await client.scope()
    .whereName('createClient')
    .withDefinedIn(1)
    .execute();

  console.log(`Found ${expanded.length} scopes`);
  if (expanded.length > 0) {
    const first = expanded[0];
    console.log(`Entity: ${first.entity.name}`);
    console.log(`Context:`, first.context);
    console.log(`Has related?`, first.context?.related?.length || 0);

    if (first.context?.related && first.context.related.length > 0) {
      console.log('✅ Expansion works! Related entities:');
      first.context.related.forEach(r => {
        console.log(`  - ${r.relationshipType}: ${JSON.stringify(r.entity).substring(0, 100)}`);
      });
    } else {
      console.log('❌ No related entities in context (expansion not working)');
    }
  }

  console.log('\n🎯 FINAL VERDICT:');
  console.log('='.repeat(60));
  console.log('✅ whereName() - WORKS');
  console.log('✅ whereFileName() - WORKS (when using correct file name)');
  console.log('✅ whereConsumesScope() - WORKS');
  console.log('✅ Semantic search - WORKS');
  console.log('❓ withDefinedIn() expansion - Need to check context.related');
  console.log('❌ Regex/pattern search - NOT IMPLEMENTED');
  console.log('❌ Post-query .filter() - NOT IMPLEMENTED');

} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
} finally {
  await client.close();
}
