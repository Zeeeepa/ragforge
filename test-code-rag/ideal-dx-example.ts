/**
 * EXEMPLE : Ce que devrait être l'expérience développeur idéale
 * avec le framework RAG généré
 */

import { createRagClient } from './generated/client.js';
import { commonPatterns } from './generated/patterns.js';  // ← À générer !

const rag = createRagClient();

// =============================================================================
// ✅ AMÉLIORATION 1: Common Patterns (helpers pré-définis)
// =============================================================================

console.log('🎯 Utilisation de patterns communs:');

// Au lieu de :
// const funcs = await rag.scope()
//   .where({ type: 'function' })
//   .whereName({ startsWith: 'create' })
//   .execute();

// On aurait :
const createFuncs = await commonPatterns.findFunctionsStartingWith('create').execute();
console.log(`Found ${createFuncs.length} create* functions`);

// =============================================================================
// ✅ AMÉLIORATION 2: Méthodes helper intuitives
// =============================================================================

console.log('\n🎯 Méthodes helper:');

// .first() pour éviter [0]
const queryBuilder = await rag.scope()
  .whereName('QueryBuilder')
  .first();  // ← Au lieu de .execute()[0]

console.log(`Found: ${queryBuilder?.entity.name}`);

// .pluck() pour extraire juste un champ
const functionNames = await rag.scope()
  .where({ type: 'function' })
  .limit(10)
  .pluck('name');  // ← Retourne string[] au lieu de SearchResult[]

console.log(`Functions: ${functionNames.join(', ')}`);

// .count() pour compter
const totalFunctions = await rag.scope()
  .where({ type: 'function' })
  .count();  // ← Au lieu de .execute().length

console.log(`Total functions: ${totalFunctions}`);

// =============================================================================
// ✅ AMÉLIORATION 3: Filtres composés (AND/OR)
// =============================================================================

console.log('\n🎯 Filtres composés:');

const complexQuery = await rag.scope()
  .where({
    type: 'function',
    OR: [
      { name: { startsWith: 'create' } },
      { name: { startsWith: 'build' } }
    ],
    AND: {
      file: { contains: 'client' }
    }
  })
  .execute();

console.log(`Complex query: ${complexQuery.length} results`);

// =============================================================================
// ✅ AMÉLIORATION 4: Aggregations
// =============================================================================

console.log('\n🎯 Aggregations:');

const statsByType = await rag.scope()
  .groupBy('type')
  .count()
  .execute();

console.log('Stats by type:', statsByType);
// → { function: 150, class: 30, method: 200, ... }

const statsByFile = await rag.scope()
  .where({ type: 'function' })
  .groupBy('file')
  .count()
  .orderBy('count', 'DESC')
  .limit(5)
  .execute();

console.log('Top 5 files with most functions:', statsByFile);

// =============================================================================
// ✅ AMÉLIORATION 5: Navigation inversée
// =============================================================================

console.log('\n🎯 Navigation inversée:');

// "Qui utilise cette fonction ?"
const consumers = await rag.scope()
  .whereName('createClient')
  .whoConsumesMe()  // ← Direction inversée automatique
  .execute();

console.log(`${consumers.length} scopes use createClient`);

// "Quelles sont les sous-classes ?"
const subclasses = await rag.scope()
  .whereName('SourceAdapter')
  .whoInheritsFromMe()  // ← Direction inversée
  .execute();

console.log(`${subclasses.length} classes extend SourceAdapter`);

// =============================================================================
// ✅ AMÉLIORATION 6: Accès au code source complet
// =============================================================================

console.log('\n🎯 Accès au code source:');

const func = await rag.scope()
  .whereName('createClient')
  .includeFullSource()  // ← Force l'inclusion du code complet (pas résumé)
  .first();

if (func) {
  console.log(`Source (${func.entity.linesOfCode} lines):`);
  console.log(func.entity.source);  // ← Code complet garanti
  console.log(`Lines ${func.entity.startLine}-${func.entity.endLine} in ${func.entity.file}`);
}

// =============================================================================
// ✅ AMÉLIORATION 7: Debug / Introspection
// =============================================================================

console.log('\n🎯 Debug:');

const query = rag.scope()
  .whereName({ startsWith: 'create' })
  .where({ type: 'function' })
  .limit(10);

// Voir la query Cypher qui sera exécutée
console.log('Generated Cypher:');
console.log(query.debug());  // ← Affiche la query Cypher

// Voir le plan d'exécution
const plan = await query.explain();  // ← Retourne le query plan
console.log('Query plan:', plan);

// =============================================================================
// ✅ AMÉLIORATION 8: Recherche par plage de lignes
// =============================================================================

console.log('\n🎯 Recherche par lignes:');

const scopesInRange = await rag.scope()
  .whereFile('query-builder.ts')
  .whereLine({ gte: 100, lte: 200 })  // ← Lignes 100-200
  .execute();

console.log(`Found ${scopesInRange.length} scopes in lines 100-200`);

// =============================================================================
// ✅ AMÉLIORATION 9: Batch operations
// =============================================================================

console.log('\n🎯 Batch operations:');

// Récupérer plusieurs scopes par nom en une seule query
const multiple = await rag.scope()
  .whereNameIn(['createClient', 'QueryBuilder', 'LLMReranker'])
  .execute();

console.log(`Batch fetch: ${multiple.length} scopes`);

// =============================================================================
// ✅ AMÉLIORATION 10: Recherche full-text flexible
// =============================================================================

console.log('\n🎯 Full-text search:');

// Chercher dans TOUS les champs (name, source, signature, etc.)
const fullText = await rag.scope()
  .search('entity context')  // ← Cherche partout
  .execute();

console.log(`Full-text: ${fullText.length} results`);

// Avec contrôle fin
const targeted = await rag.scope()
  .searchIn(['name', 'signature', 'source'], 'entity context')
  .execute();

console.log(`Targeted search: ${targeted.length} results`);

// =============================================================================
// ✅ AMÉLIORATION 11: TypeScript types explicites
// =============================================================================

console.log('\n🎯 Types explicites:');

// Au lieu de :
// const result: SearchResult<any>

// On aurait :
const typedResult = await rag.scope().whereName('test').first();

// Autocomplete complet sur :
if (typedResult) {
  typedResult.entity.name;        // ✅ string
  typedResult.entity.type;        // ✅ 'function' | 'class' | 'method' | ...
  typedResult.entity.signature;   // ✅ string | undefined
  typedResult.entity.source;      // ✅ string | undefined
  typedResult.entity.linesOfCode; // ✅ number | undefined
  // ... tous les champs avec types corrects
}

// =============================================================================
// ✅ AMÉLIORATION 12: Chaining intelligent
// =============================================================================

console.log('\n🎯 Chaining:');

// Pipeline avec transformation
const pipeline = await rag.scope()
  .where({ type: 'class' })
  .limit(5)
  .expandConsumes(1)           // ← Expand pour chacun
  .filterBy(r => r.entity.linesOfCode > 100)  // ← Filtre client-side
  .sortBy('linesOfCode', 'DESC')              // ← Tri
  .execute();

console.log(`Pipeline: ${pipeline.length} results`);

await rag.close();
console.log('\n✅ Terminé!');

export {};
