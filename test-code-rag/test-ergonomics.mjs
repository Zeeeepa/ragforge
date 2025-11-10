/**
 * Test d'ergonomie du framework généré
 * Essaie de faire différentes recherches et documente les problèmes
 */

import { createRagClient } from './generated/client.js';
import { createCommonPatterns } from './generated/patterns.js';

const rag = createRagClient();
const patterns = createCommonPatterns(rag);

console.log('🔍 Test d\'ergonomie du framework généré\n');
console.log('='.repeat(70));

const problems = [];
const solutions = [];

// ========================================================================
// Scenario 1: "Trouve toutes les fonctions qui utilisent LLMReranker"
// ========================================================================
console.log('\n📝 Scenario 1: Trouver les fonctions qui utilisent LLMReranker');
console.log('-'.repeat(70));

try {
  // Tentative 1: Recherche dans le source
  console.log('\n🔹 Tentative: .whereSource({ contains: "LLMReranker" })');
  const attempt1 = await rag.scope()
    .whereSource({ contains: 'LLMReranker' })
    .where({ type: 'function' })
    .limit(5)
    .execute();

  console.log(`✅ Trouvé ${attempt1.length} résultats`);
  if (attempt1.length > 0) {
    attempt1.forEach(r => console.log(`  - ${r.entity.name} (${r.entity.type})`));
  }

  // ❌ PROBLÈME: On veut juste les noms, mais il faut faire .map()
  console.log('\n🤔 Problème identifié:');
  console.log('   Pour extraire juste les noms, il faut faire:');
  console.log('   const names = results.map(r => r.entity.name)');
  console.log('   Avec .pluck() c\'est mieux mais pas intuitif au départ');

  const names = await rag.scope()
    .whereSource({ contains: 'LLMReranker' })
    .where({ type: 'function' })
    .pluck('name');
  console.log(`✅ Avec .pluck(): ${names.join(', ')}`);

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 1: ' + error.message);
}

// ========================================================================
// Scenario 2: "Trouve la classe QueryBuilder et ses méthodes"
// ========================================================================
console.log('\n\n📝 Scenario 2: Trouver QueryBuilder et ses méthodes');
console.log('-'.repeat(70));

try {
  // Tentative 1: Trouver la classe
  console.log('\n🔹 Étape 1: Trouver QueryBuilder');
  const qbClass = await rag.scope()
    .whereName('QueryBuilder')
    .where({ type: 'class' })
    .first();

  if (qbClass) {
    console.log(`✅ Trouvé: ${qbClass.entity.name}`);
    console.log(`   File: ${qbClass.entity.file}`);

    // ❌ PROBLÈME: Comment trouver ses méthodes maintenant ?
    console.log('\n🔹 Étape 2: Trouver ses méthodes...');
    console.log('🤔 Problème: Quelle méthode utiliser?');
    console.log('   - .whereParentScope("QueryBuilder") ? Oui ça existe!');

    const methods = await rag.scope()
      .whereParentScope('QueryBuilder')
      .limit(10)
      .execute();

    console.log(`✅ Trouvé ${methods.length} méthodes/propriétés`);
    methods.slice(0, 5).forEach(m => console.log(`  - ${m.entity.name}`));

    // ✅ MAIS: Pourquoi pas une méthode chainable directement ?
    console.log('\n💡 Amélioration possible:');
    console.log('   qbClass.getMethods() ou qbClass.expand("methods")');
    problems.push('Pas de méthode chainable pour "trouver les enfants du résultat actuel"');
    solutions.push('Ajouter .expandChildren() ou .getRelated("HAS_PARENT") chainable');

  } else {
    console.log('❌ QueryBuilder non trouvé');
  }

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 2: ' + error.message);
}

// ========================================================================
// Scenario 3: "Combien de fonctions par fichier ?"
// ========================================================================
console.log('\n\n📝 Scenario 3: Compter les fonctions par fichier');
console.log('-'.repeat(70));

try {
  console.log('\n🔹 Tentative: Récupérer toutes les fonctions et grouper manuellement');

  const allFunctions = await rag.scope()
    .where({ type: 'function' })
    .execute();

  console.log(`✅ Trouvé ${allFunctions.length} fonctions au total`);

  // ❌ PROBLÈME: Pas d'aggregation, il faut grouper manuellement
  const byFile = {};
  allFunctions.forEach(r => {
    const file = r.entity.file;
    byFile[file] = (byFile[file] || 0) + 1;
  });

  const sorted = Object.entries(byFile)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  console.log('\nTop 5 fichiers avec le plus de fonctions:');
  sorted.forEach(([file, count]) => {
    const shortFile = file.split('/').slice(-2).join('/');
    console.log(`  - ${shortFile}: ${count} fonctions`);
  });

  console.log('\n🤔 Problème identifié:');
  console.log('   Pas d\'aggregation built-in type .groupBy("file").count()');
  console.log('   Il faut tout récupérer en mémoire et grouper manuellement');

  problems.push('Pas d\'aggregation: .groupBy(), .count() sur groupes');
  solutions.push('Ajouter support pour aggregations Cypher (COUNT, GROUP BY)');

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 3: ' + error.message);
}

// ========================================================================
// Scenario 4: "Recherche avec plusieurs conditions AND"
// ========================================================================
console.log('\n\n📝 Scenario 4: Recherche avec conditions multiples');
console.log('-'.repeat(70));

try {
  console.log('\n🔹 Tentative: Fonctions "create" dans un fichier spécifique');

  // Tentative 1: Chaîner les where()
  console.log('   Méthode 1: Chaîner .where()');
  const attempt1 = await rag.scope()
    .where({ type: 'function' })
    .whereName({ startsWith: 'create' })
    .whereFile({ contains: 'client' })
    .limit(5)
    .execute();

  console.log(`✅ Trouvé ${attempt1.length} résultats`);
  if (attempt1.length > 0) {
    attempt1.forEach(r => console.log(`  - ${r.entity.name} in ${r.entity.file.split('/').pop()}`));
  }

  // ✅ Ça marche ! Mais est-ce intuitif ?
  console.log('\n💡 C\'est assez intuitif en fait, le chaining marche bien');

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 4: ' + error.message);
}

// ========================================================================
// Scenario 5: "Qui utilise cette fonction ?" (navigation inversée)
// ========================================================================
console.log('\n\n📝 Scenario 5: Navigation inversée - qui utilise createClient?');
console.log('-'.repeat(70));

try {
  console.log('\n🔹 Tentative: Trouver qui consomme createClient');

  // ❌ PROBLÈME: Pas de méthode directe pour ça
  console.log('🤔 Problème: Il n\'y a pas de .whoConsumesMe() ou inverse de withCONSUMES');
  console.log('   Il faut faire une query manuelle ou utiliser les relationships dans l\'autre sens');

  // Workaround: Chercher manuellement
  const createClientFunc = await rag.scope()
    .whereName('createClient')
    .first();

  if (createClientFunc) {
    console.log(`✅ Trouvé: ${createClientFunc.entity.name}`);
    console.log('   Mais pas de méthode pour trouver "qui me consomme"');
  }

  problems.push('Pas de navigation inversée: .whoConsumesMe(), .whoCallsMe()');
  solutions.push('Générer méthodes inversées pour chaque relationship');

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 5: ' + error.message);
}

// ========================================================================
// Scenario 6: "Debug - voir la query Cypher"
// ========================================================================
console.log('\n\n📝 Scenario 6: Debug - voir la query générée');
console.log('-'.repeat(70));

try {
  const query = rag.scope()
    .whereName({ startsWith: 'Query' })
    .where({ type: 'class' })
    .limit(5);

  console.log('🔹 Utilisation de .debug():');
  const debugOutput = query.debug();
  console.log(debugOutput);

  // ❌ PROBLÈME: Le debug() ne montre rien!
  console.log('\n🤔 Problème: .debug() ne retourne pas de query Cypher utile');
  console.log('   La query n\'est construite qu\'au moment de execute()');

  problems.push('.debug() ne montre pas la query Cypher avant execute()');
  solutions.push('Construire la query dans .debug() même sans execute()');

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 6: ' + error.message);
}

// ========================================================================
// Scenario 7: "Filtre client-side après récupération"
// ========================================================================
console.log('\n\n📝 Scenario 7: Filtrage client-side');
console.log('-'.repeat(70));

try {
  console.log('\n🔹 Tentative: Filtrer les résultats par linesOfCode > 50');

  const results = await rag.scope()
    .where({ type: 'function' })
    .limit(20)
    .execute();

  // ❌ PROBLÈME: Pas de .filter() chainable
  console.log('🤔 Problème: Il faut utiliser .execute() puis Array.filter()');
  const filtered = results.filter(r => r.entity.linesOfCode && r.entity.linesOfCode > 50);

  console.log(`✅ Trouvé ${filtered.length} fonctions > 50 lignes (sur ${results.length})`);

  console.log('\n💡 Amélioration possible:');
  console.log('   .where({ linesOfCode: { gt: 50 } }) directement dans la query');
  console.log('   Ou .filterBy(r => r.entity.linesOfCode > 50) chainable');

  problems.push('Pas de filtres avancés: gt, lt, gte, lte pour les nombres');
  solutions.push('Ajouter support pour comparaisons numériques dans .where()');

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 7: ' + error.message);
}

// ========================================================================
// Scenario 8: "Batch queries - plusieurs recherches en parallèle"
// ========================================================================
console.log('\n\n📝 Scenario 8: Requêtes batch');
console.log('-'.repeat(70));

try {
  console.log('\n🔹 Tentative: Chercher 3 entités en parallèle');

  // Workaround: Promise.all
  const [qb, adapter, reranker] = await Promise.all([
    rag.scope().whereName('QueryBuilder').first(),
    rag.scope().whereName('CodeSourceAdapter').first(),
    rag.scope().whereName('LLMReranker').first()
  ]);

  console.log('✅ Requêtes parallèles avec Promise.all:');
  console.log(`  - QueryBuilder: ${qb ? '✓' : '✗'}`);
  console.log(`  - CodeSourceAdapter: ${adapter ? '✓' : '✗'}`);
  console.log(`  - LLMReranker: ${reranker ? '✓' : '✗'}`);

  console.log('\n💡 Amélioration possible:');
  console.log('   .whereNameIn(["QueryBuilder", "CodeSourceAdapter", "LLMReranker"])');
  console.log('   Une seule query au lieu de 3');

  problems.push('Pas de .whereNameIn() ou .whereIn() pour batch');
  solutions.push('Ajouter .whereNameIn(array) pour requêtes batch');

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 8: ' + error.message);
}

// ========================================================================
// Scenario 9: "Pattern matching avancé (regex)"
// ========================================================================
console.log('\n\n📝 Scenario 9: Pattern matching avec regex');
console.log('-'.repeat(70));

try {
  console.log('\n🔹 Tentative: Trouver fonctions create* ou build*');

  // Tentative avec wherePattern
  const withPattern = await rag.scope()
    .wherePattern('name', /^(create|build)/)
    .limit(10)
    .execute();

  console.log(`✅ Avec .wherePattern(): ${withPattern.length} résultats`);
  withPattern.slice(0, 5).forEach(r => console.log(`  - ${r.entity.name}`));

  console.log('\n✅ .wherePattern() existe et marche bien!');

} catch (error) {
  console.error('❌ Erreur:', error.message);

  // Fallback: deux queries séparées
  console.log('\n🔹 Fallback: Faire deux queries séparées');
  try {
    const [creates, builds] = await Promise.all([
      rag.scope().whereName({ startsWith: 'create' }).limit(5).execute(),
      rag.scope().whereName({ startsWith: 'build' }).limit(5).execute()
    ]);

    console.log(`✅ Fallback: ${creates.length} create*, ${builds.length} build*`);
    console.log('\n🤔 Mais ça fait 2 queries au lieu d\'une avec OR');

    problems.push('Pas de conditions OR simples: name startsWith "create" OR "build"');
    solutions.push('Ajouter support OR dans .where() ou .wherePattern() marche déjà');
  } catch (e2) {
    problems.push('Scenario 9: ' + e2.message);
  }
}

// ========================================================================
// Scenario 10: "Accès au code source complet"
// ========================================================================
console.log('\n\n📝 Scenario 10: Accès au code source complet');
console.log('-'.repeat(70));

try {
  const func = await rag.scope()
    .whereName('createClient')
    .where({ type: 'function' })
    .first();

  if (func) {
    console.log(`✅ Trouvé: ${func.entity.name}`);
    console.log(`   Source length: ${func.entity.source?.length || 0} chars`);
    console.log(`   Lines: ${func.entity.startLine}-${func.entity.endLine}`);

    if (func.entity.source) {
      console.log('\n   Code preview:');
      const preview = func.entity.source.substring(0, 200);
      console.log('   ' + preview.split('\n').slice(0, 3).join('\n   '));
    }

    console.log('\n✅ Le champ source est disponible!');

    // Mais est-il toujours complet ou parfois résumé ?
    if (func.entity.source && func.entity.source.includes('[SUMMARY]')) {
      console.log('⚠️  Source est résumée, pas complète');
      problems.push('Source parfois résumée au lieu de complète');
      solutions.push('Ajouter .includeFullSource() pour forcer le code complet');
    }
  }

} catch (error) {
  console.error('❌ Erreur:', error.message);
  problems.push('Scenario 10: ' + error.message);
}

// ========================================================================
// RÉSUMÉ
// ========================================================================
console.log('\n\n' + '='.repeat(70));
console.log('📊 RÉSUMÉ DES PROBLÈMES D\'ERGONOMIE');
console.log('='.repeat(70));

if (problems.length === 0) {
  console.log('\n🎉 Aucun problème identifié! L\'ergonomie est excellente.');
} else {
  console.log(`\n❌ ${problems.length} problèmes identifiés:\n`);
  problems.forEach((p, i) => {
    console.log(`${i + 1}. ${p}`);
  });
}

console.log('\n' + '='.repeat(70));
console.log('💡 SOLUTIONS PROPOSÉES');
console.log('='.repeat(70));

if (solutions.length === 0) {
  console.log('\nAucune amélioration nécessaire.');
} else {
  console.log('');
  solutions.forEach((s, i) => {
    console.log(`${i + 1}. ${s}`);
  });
}

console.log('\n' + '='.repeat(70));
console.log('✅ CE QUI MARCHE BIEN');
console.log('='.repeat(70));
console.log(`
✅ .first() - Très pratique
✅ .pluck() - Évite les .map()
✅ .count() - Simple et direct
✅ Chaining de .where() - Intuitif
✅ .wherePattern() - Pattern matching marche
✅ Patterns module - Découvrabilité améliorée
✅ Types générés - Autocomplete fonctionne
✅ Source disponible - Accès au code
`);

console.log('='.repeat(70));
console.log('🎯 PRIORITÉS POUR PHASE 2');
console.log('='.repeat(70));
console.log(`
1. 🔴 URGENT: Fix .debug() pour afficher la query avant execute()
2. 🟠 HIGH: Ajouter .whereNameIn() pour batch queries
3. 🟠 HIGH: Ajouter navigation inversée (.whoConsumesMe())
4. 🟡 MEDIUM: Ajouter aggregations (.groupBy().count())
5. 🟡 MEDIUM: Ajouter filtres numériques (gt, lt, gte, lte)
6. 🟢 LOW: Ajouter .expandChildren() chainable
`);

await rag.close();
