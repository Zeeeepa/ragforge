import { createRagClient } from './generated/client.js';

const rag = createRagClient();

console.log('🔍 Test 1: Chercher les enfants de "AddRelationshipConfig"...');
try {
  const filtered = await rag.scope()
    .whereParentScope('AddRelationshipConfig')
    .execute();
  console.log(`Found ${filtered.length} items`);
  filtered.slice(0, 5).forEach(r => {
    console.log('  - ' + r.entity.name);
  });
} catch (err) {
  console.error('Erreur:', err.message);
}

console.log('\n🔍 Test 2: Chercher les enfants de "CodeSourceAdapter"...');
try {
  const filtered2 = await rag.scope()
    .whereParentScope('CodeSourceAdapter')
    .execute();
  console.log(`Found ${filtered2.length} items`);
  filtered2.slice(0, 10).forEach(r => {
    console.log('  - ' + r.entity.name);
  });
} catch (err) {
  console.error('Erreur:', err.message);
}

console.log('\n🔍 Test 3: Expand HAS_PARENT depuis "buildGraph"...');
try {
  const expanded = await rag.scope()
    .whereName('buildGraph')
    .withHasParent(2)
    .execute();
  console.log(`Found ${expanded.length} items`);
  expanded.slice(0, 5).forEach(r => {
    console.log('  - ' + r.entity.name);
  });
} catch (err) {
  console.error('Erreur:', err.message);
}

await rag.close();
