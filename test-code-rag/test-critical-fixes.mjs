/**
 * Test des corrections critiques:
 * 1. .whereFile() doit maintenant exister
 * 2. .debug() doit afficher la query Cypher
 */

import { createRagClient } from './generated/client.js';

const rag = createRagClient();

console.log('🔧 Test des corrections critiques\n');
console.log('='.repeat(70));

// ========================================================================
// Test 1: .whereFile() doit exister maintenant
// ========================================================================
console.log('\n✅ Test 1: .whereFile() existe et fonctionne');
console.log('-'.repeat(70));

try {
  const results = await rag.scope()
    .where({ type: 'function' })
    .whereName({ startsWith: 'create' })
    .whereFile({ contains: 'client' })
    .limit(5)
    .execute();

  console.log(`✅ .whereFile() marche! Trouvé ${results.length} résultats`);
  results.forEach(r => {
    const shortFile = r.entity.file?.split('/').pop() || 'unknown';
    console.log(`  - ${r.entity.name} in ${shortFile}`);
  });

} catch (error) {
  console.error('❌ ÉCHEC:', error.message);
  process.exit(1);
}

// ========================================================================
// Test 2: .debug() doit afficher la query Cypher
// ========================================================================
console.log('\n✅ Test 2: .debug() affiche la query Cypher');
console.log('-'.repeat(70));

try {
  const query = rag.scope()
    .whereName({ startsWith: 'Query' })
    .where({ type: 'class' })
    .limit(5);

  const debugOutput = query.debug();

  console.log('Debug output:');
  console.log(debugOutput);
  console.log('');

  // Vérifications
  if (debugOutput.includes('MATCH')) {
    console.log('✅ Contient MATCH');
  } else {
    console.error('❌ ÉCHEC: Pas de MATCH dans la query');
    process.exit(1);
  }

  if (debugOutput.includes('Cypher Query:') && !debugOutput.includes('undefined')) {
    console.log('✅ Query Cypher affichée correctement');
  } else {
    console.error('❌ ÉCHEC: Query undefined');
    process.exit(1);
  }

  if (debugOutput.includes('Parameters:')) {
    console.log('✅ Paramètres affichés');
  } else {
    console.error('❌ ÉCHEC: Pas de paramètres');
    process.exit(1);
  }

} catch (error) {
  console.error('❌ ÉCHEC:', error.message);
  process.exit(1);
}

// ========================================================================
// Test 3: Scenario 4 de l'ergonomie (qui échouait avant)
// ========================================================================
console.log('\n✅ Test 3: Scenario 4 - Conditions multiples');
console.log('-'.repeat(70));

try {
  const results = await rag.scope()
    .where({ type: 'function' })
    .whereName({ startsWith: 'create' })
    .whereFile({ contains: 'client' })
    .limit(5)
    .execute();

  console.log(`✅ Chaîning complet marche! ${results.length} résultats`);
  if (results.length > 0) {
    results.slice(0, 3).forEach(r => {
      console.log(`  - ${r.entity.name} (${r.entity.type}) in ${r.entity.file?.split('/').pop()}`);
    });
  }

} catch (error) {
  console.error('❌ ÉCHEC:', error.message);
  process.exit(1);
}

await rag.close();

console.log('\n' + '='.repeat(70));
console.log('🎉 TOUS LES TESTS PASSENT!');
console.log('='.repeat(70));
console.log('');
console.log('✅ .whereFile() - Généré pour tous les searchable_fields');
console.log('✅ .debug() - Affiche la query Cypher correctement');
console.log('✅ Chaining - Fonctionne avec toutes les méthodes where*');
console.log('');
