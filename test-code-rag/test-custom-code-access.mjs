import { createRagClient } from './generated/client.js';

const rag = createRagClient();

console.log('🎯 Test 1: Trouver toutes les fonctions "create*"');
console.log('='.repeat(60));
const createFunctions = await rag.scope()
  .wherePattern('name', /^create/)
  .limit(10)
  .execute();

console.log(`Trouvé ${createFunctions.length} fonctions:`);
createFunctions.forEach(r => {
  const e = r.entity;
  console.log(`  - ${e.name} (${e.type}) dans ${e.file}`);
});

console.log('\n🎯 Test 2: Chercher du code qui contient "EntityContext"');
console.log('='.repeat(60));
const entityContextCode = await rag.scope()
  .whereSource({ contains: 'EntityContext' })
  .limit(5)
  .execute();

console.log(`Trouvé ${entityContextCode.length} scopes:`);
entityContextCode.forEach(r => {
  const e = r.entity;
  console.log(`  - ${e.name} (${e.type}) dans ${e.file}`);
  console.log(`    Signature: ${e.signature?.substring(0, 80)}...`);
});

console.log('\n🎯 Test 3: Trouver les classes et leurs méthodes (HAS_PARENT)');
console.log('='.repeat(60));
const classes = await rag.scope()
  .where({ type: 'class' })
  .limit(3)
  .execute();

console.log(`Trouvé ${classes.length} classes:`);
for (const r of classes) {
  const e = r.entity;
  console.log(`\n  📦 ${e.name} dans ${e.file}`);

  // Trouver les méthodes de cette classe
  const methods = await rag.scope()
    .whereParentScope(e.name)
    .limit(5)
    .execute();

  console.log(`    └─ ${methods.length} méthodes:`);
  methods.forEach(m => {
    console.log(`       - ${m.entity.name}()`);
  });
}

console.log('\n🎯 Test 4: Recherche sémantique + expansion des dépendances');
console.log('='.repeat(60));
const semantic = await rag.scope()
  .semanticSearchBySource('query builder for database')
  .limit(3)
  .execute();

console.log(`Trouvé ${semantic.length} résultats sémantiques:`);
for (const r of semantic) {
  const e = r.entity;
  console.log(`\n  🔍 ${e.name} (score: ${r.score.toFixed(3)})`);
  console.log(`     Type: ${e.type}`);
  console.log(`     File: ${e.file}`);

  // Voir ce que ce scope consomme
  const withDeps = await rag.scope()
    .whereName(e.name)
    .withConsumes(1)
    .execute();

  if (withDeps.length > 0 && withDeps[0].context?.related) {
    const related = withDeps[0].context.related;
    if (related.length > 0) {
      console.log(`     Utilise: ${related.slice(0, 3).map(r => r.entity.name).join(', ')}`);
    }
  }
}

console.log('\n🎯 Test 5: Trouver les classes qui héritent (INHERITS_FROM)');
console.log('='.repeat(60));
const inherited = await rag.scope()
  .where({ type: 'class' })
  .limit(20)
  .execute();

let count = 0;
for (const r of inherited) {
  // Check if this class inherits from something
  const expanded = await rag.scope()
    .whereName(r.entity.name)
    .withInheritsFrom(1)
    .execute();

  if (expanded.length > 0 && expanded[0].context?.related && expanded[0].context.related.length > 0) {
    const parent = expanded[0].context.related[0];
    console.log(`  - ${r.entity.name} extends ${parent.entity.name}`);
    count++;
    if (count >= 5) break;
  }
}

await rag.close();
console.log('\n✅ Tests terminés !');
