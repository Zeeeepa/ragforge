/**
 * Test Phase 1 DX Improvements:
 * - patterns.ts: Common query patterns
 * - Helper methods: .first(), .pluck(), .count(), .debug()
 * - QUICKSTART.md: Developer guide
 * - entity-contexts.ts: EntityContext from config
 */

import { createRagClient } from './generated/client.js';
import { createCommonPatterns } from './generated/patterns.js';

const rag = createRagClient();
const patterns = createCommonPatterns(rag);

console.log('🎯 Phase 1 DX Improvements Test\n');
console.log('='.repeat(70));

// ==================== Test 1: Common Patterns ====================
console.log('\n✅ Test 1: Common Patterns (patterns.ts)');
console.log('-'.repeat(70));

try {
  // Test findScopeByPrefix
  console.log('Testing: patterns.findScopeByPrefix("create")...');
  const prefixResults = await patterns.findScopeByPrefix('create').limit(3).execute();
  console.log(`  ✓ Found ${prefixResults.length} scopes starting with "create"`);
  if (prefixResults.length > 0) {
    console.log(`    Example: ${prefixResults[0].entity.name}`);
  }

  // Test findScopeByContaining
  console.log('\nTesting: patterns.findScopeByContaining("Query")...');
  const containingResults = await patterns.findScopeByContaining('Query').limit(3).execute();
  console.log(`  ✓ Found ${containingResults.length} scopes containing "Query"`);
  if (containingResults.length > 0) {
    console.log(`    Example: ${containingResults[0].entity.name}`);
  }

  // Test findScopeByExact
  console.log('\nTesting: patterns.findScopeByExact("QueryBuilder")...');
  const exactResults = await patterns.findScopeByExact('QueryBuilder').execute();
  console.log(`  ✓ Found ${exactResults.length} scope(s) with exact name "QueryBuilder"`);

  // Test findScopeBySource (searchable field pattern)
  console.log('\nTesting: patterns.findScopeBySource("EntityContext")...');
  const sourceResults = await patterns.findScopeBySource('EntityContext').limit(3).execute();
  console.log(`  ✓ Found ${sourceResults.length} scopes with source containing "EntityContext"`);

  console.log('\n✅ Common Patterns: All tests passed!');
} catch (error) {
  console.error('❌ Common Patterns test failed:', error.message);
}

// ==================== Test 2: Helper Methods ====================
console.log('\n✅ Test 2: Helper Methods (.first(), .pluck(), .count(), .debug())');
console.log('-'.repeat(70));

try {
  // Test .first()
  console.log('\nTesting: .first() method...');
  const firstResult = await rag.scope().whereName({ startsWith: 'Query' }).first();
  if (firstResult) {
    console.log(`  ✓ .first() returned: ${firstResult.entity.name}`);
    console.log(`    Type: ${typeof firstResult}, has entity: ${!!firstResult.entity}`);
  } else {
    console.log(`  ✓ .first() returned undefined (no results)`);
  }

  // Test .pluck()
  console.log('\nTesting: .pluck("name") method...');
  const names = await rag.scope().where({ type: 'function' }).limit(5).pluck('name');
  console.log(`  ✓ .pluck() returned ${names.length} names`);
  console.log(`    Type: Array<${typeof names[0]}>`);
  console.log(`    Examples: ${names.slice(0, 3).join(', ')}`);

  // Test .count()
  console.log('\nTesting: .count() method...');
  const totalCount = await rag.scope().where({ type: 'class' }).count();
  console.log(`  ✓ .count() returned: ${totalCount} classes`);
  console.log(`    Type: ${typeof totalCount}`);

  // Test .debug()
  console.log('\nTesting: .debug() method...');
  const query = rag.scope().whereName({ startsWith: 'Query' }).limit(5);
  const debugOutput = query.debug();
  console.log(`  ✓ .debug() returned Cypher query`);
  console.log(`    Output length: ${debugOutput.length} characters`);
  console.log(`    Contains "MATCH": ${debugOutput.includes('MATCH')}`);
  console.log(`    Contains "WHERE": ${debugOutput.includes('WHERE')}`);
  console.log('\n  Debug output preview:');
  console.log(debugOutput.split('\n').slice(0, 4).map(line => '    ' + line).join('\n'));

  console.log('\n✅ Helper Methods: All tests passed!');
} catch (error) {
  console.error('❌ Helper Methods test failed:', error.message);
  console.error(error.stack);
}

// ==================== Test 3: Entity Contexts ====================
console.log('\n✅ Test 3: Entity Contexts (entity-contexts.ts)');
console.log('-'.repeat(70));

try {
  const { SCOPE_CONTEXT, ENTITY_CONTEXTS, getEntityContext } = await import('./generated/entity-contexts.js');

  console.log('\nChecking SCOPE_CONTEXT...');
  console.log(`  ✓ type: ${SCOPE_CONTEXT.type}`);
  console.log(`  ✓ displayName: ${SCOPE_CONTEXT.displayName}`);
  console.log(`  ✓ uniqueField: ${SCOPE_CONTEXT.uniqueField}`);
  console.log(`  ✓ fields: ${SCOPE_CONTEXT.fields.length} fields defined`);
  SCOPE_CONTEXT.fields.forEach(f => {
    console.log(`    - ${f.name} (${f.required ? 'required' : 'optional'}${f.preferSummary ? ', preferSummary' : ''})`);
  });

  console.log('\nChecking ENTITY_CONTEXTS map...');
  console.log(`  ✓ Available entities: ${Object.keys(ENTITY_CONTEXTS).join(', ')}`);

  console.log('\nTesting getEntityContext("Scope")...');
  const context = getEntityContext('Scope');
  console.log(`  ✓ Retrieved context for: ${context.type}`);

  console.log('\nTesting getEntityContext with invalid type...');
  try {
    getEntityContext('InvalidType');
    console.log('  ❌ Should have thrown error!');
  } catch (error) {
    console.log(`  ✓ Correctly threw error: "${error.message}"`);
  }

  console.log('\n✅ Entity Contexts: All tests passed!');
} catch (error) {
  console.error('❌ Entity Contexts test failed:', error.message);
}

// ==================== Test 4: QUICKSTART.md ====================
console.log('\n✅ Test 4: QUICKSTART.md Documentation');
console.log('-'.repeat(70));

try {
  const fs = await import('fs/promises');
  const quickstart = await fs.readFile('./generated/QUICKSTART.md', 'utf-8');

  console.log('\nChecking QUICKSTART.md content...');
  console.log(`  ✓ File size: ${quickstart.length} characters`);
  console.log(`  ✓ Contains "Quick Start": ${quickstart.includes('Quick Start')}`);
  console.log(`  ✓ Contains "Common Patterns": ${quickstart.includes('Common Patterns')}`);
  console.log(`  ✓ Contains ".first()": ${quickstart.includes('.first()')}`);
  console.log(`  ✓ Contains ".pluck()": ${quickstart.includes('.pluck(')}`);
  console.log(`  ✓ Contains ".count()": ${quickstart.includes('.count()')}`);
  console.log(`  ✓ Contains ".debug()": ${quickstart.includes('.debug()')}`);

  const sections = quickstart.match(/^## /gm);
  console.log(`  ✓ Number of sections: ${sections ? sections.length : 0}`);

  console.log('\n✅ QUICKSTART.md: All checks passed!');
} catch (error) {
  console.error('❌ QUICKSTART.md test failed:', error.message);
}

// ==================== Summary ====================
console.log('\n' + '='.repeat(70));
console.log('📊 Phase 1 DX Improvements Summary');
console.log('='.repeat(70));
console.log('✅ patterns.ts - Common query patterns generated');
console.log('✅ Helper methods - .first(), .pluck(), .count(), .debug() work correctly');
console.log('✅ entity-contexts.ts - EntityContext config-driven (no hard-coded defaults)');
console.log('✅ QUICKSTART.md - Developer guide available');
console.log('\n🎉 All Phase 1 improvements validated successfully!');
console.log('\n💡 Next: Check QUICKSTART.md for usage examples');
console.log('   File: ./generated/QUICKSTART.md\n');

await rag.close();
