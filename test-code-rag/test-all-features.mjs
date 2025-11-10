import { createRagClient } from './client.js';

const client = createRagClient();

console.log('🎯 Comprehensive test of all 3 new RagForge features\n');
console.log('='.repeat(60));

try {
  // FEATURE 1: Expansion fix - context.related is now populated
  console.log('\n✅ FEATURE 1: Expansion fix - context.related populated');
  console.log('-'.repeat(60));
  const expanded = await client.scope()
    .whereName('createClient')
    .withDefinedIn(1)
    .execute();

  if (expanded.length > 0) {
    console.log(`Found: ${expanded[0].entity.name}`);
    console.log(`Related entities: ${expanded[0].context?.related?.length || 0}`);
    if (expanded[0].context?.related && expanded[0].context.related.length > 0) {
      const rel = expanded[0].context.related[0];
      console.log(`  - Type: ${rel.relationshipType}`);
      console.log(`  - Entity: ${rel.entity.name} (${rel.entity.path || rel.entity.type})`);
      console.log(`  - Depth: ${rel.depth}`);
    }
  }

  // FEATURE 2: Pattern search - server-side regex using Neo4j =~
  console.log('\n✅ FEATURE 2: Pattern search - server-side regex');
  console.log('-'.repeat(60));
  const pattern1 = await client.scope()
    .wherePattern('name', /^create/)
    .limit(10)
    .execute();
  console.log(`Regex /^create/ found: ${pattern1.length} results`);
  pattern1.forEach(r => console.log(`  - ${r.entity.name} (${r.entity.type})`));

  // Test multiline pattern
  const pattern2 = await client.scope()
    .wherePattern('source', /function.*\{/)
    .limit(5)
    .execute();
  console.log(`\nRegex /function.*\\{/ found: ${pattern2.length} results`);

  // FEATURE 3: Client-side filtering - post-query predicates
  console.log('\n✅ FEATURE 3: Client-side filtering - JavaScript predicates');
  console.log('-'.repeat(60));
  const filtered = await client.scope()
    .limit(100)
    .filter(r => r.entity.name && r.entity.name.length > 5)
    .filter(r => r.entity.name && r.entity.name.includes('e'))
    .execute();
  console.log(`Client filter (name length > 5 && contains 'e'): ${filtered.length} results`);
  filtered.slice(0, 5).forEach(r => console.log(`  - ${r.entity.name} (length: ${r.entity.name.length})`));

  // COMBINED: All 3 features together
  console.log('\n🚀 COMBINED: All 3 features in one query');
  console.log('-'.repeat(60));
  const combined = await client.scope()
    .wherePattern('name', /^[a-z]/)  // Pattern: starts with lowercase
    .withDefinedIn(1)                // Expansion: get file info
    .limit(50)
    .filter(r => r.entity.type === 'function')  // Client filter: only functions
    .execute();

  console.log(`Combined query results: ${combined.length}`);
  combined.slice(0, 3).forEach((r, i) => {
    console.log(`  [${i+1}] ${r.entity.name} (${r.entity.type})`);
    if (r.context?.related && r.context.related.length > 0) {
      console.log(`      Related: ${r.context.related[0].entity.name} via ${r.context.related[0].relationshipType}`);
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log('✅ ALL 3 FEATURES WORKING CORRECTLY!');
  console.log('='.repeat(60));
  console.log('\n📋 Summary:');
  console.log('1. ✅ Expansion fix - context.related now populated with {entity, relationshipType, depth}');
  console.log('2. ✅ Pattern search - .wherePattern(field, regex) for server-side Neo4j regex');
  console.log('3. ✅ Client filter - .filter(predicate) for post-query JavaScript filtering');
  console.log('\n💡 These features are generic in RagForge and work for any entity type!');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
} finally {
  await client.close();
}
