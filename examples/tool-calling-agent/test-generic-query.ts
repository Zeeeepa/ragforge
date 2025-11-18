/**
 * Test the new generic query API
 *
 * This demonstrates the fluent query interface that can be used
 * as tools for conversational agents.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createRagClient } from './client.js';

// Load environment
config({ path: resolve(process.cwd(), '.env') });

// Create RAG client
const rag = createRagClient();

async function testGenericQuery() {
  console.log('🧪 Testing Generic Query API\n');

  try {
    // Test 1: Basic query with where condition
    console.log('Test 1: Basic query with where condition');
    console.log('---------------------------------------');
    const query1 = rag
      .get('Scope')
      .where('type', '=', 'function')
      .limit(3);

    console.log('Natural language explanation:');
    console.log(query1.explain());
    console.log('\nGenerated Cypher:');
    console.log(query1.getCypher().cypher);

    const results1 = await query1.execute();
    console.log(`\nResults: ${results1.length} scopes found`);
    if (results1.length > 0) {
      console.log('First result:', {
        name: results1[0].name,
        type: results1[0].type,
        uuid: results1[0].uuid?.substring(0, 8) + '...'
      });
    }
    console.log('\n');

    // Test 2: Query with relationship traversal
    console.log('Test 2: Query with relationship traversal');
    console.log('---------------------------------------');
    const query2 = rag
      .get('Scope')
      .where('type', '=', 'function')
      .getRelationship('DEPENDS_ON', 'outgoing')
      .limit(3);

    console.log('Natural language explanation:');
    console.log(query2.explain());
    console.log('\nGenerated Cypher:');
    console.log(query2.getCypher().cypher);

    const results2 = await query2.execute();
    console.log(`\nResults: ${results2.length} dependencies found`);
    if (results2.length > 0) {
      console.log('First result:', {
        name: results2[0].name,
        uuid: results2[0].uuid?.substring(0, 8) + '...'
      });
    }
    console.log('\n');

    // Test 3: Register custom filter and use it
    console.log('Test 3: Custom filter');
    console.log('---------------------------------------');
    rag.registerFilter('hasComplexity', 'n.complexity IS NOT NULL');

    const query3 = rag
      .get('Scope')
      .filter('hasComplexity')
      .orderBy('complexity', 'DESC')
      .limit(5);

    console.log('Natural language explanation:');
    console.log(query3.explain());
    console.log('\nGenerated Cypher:');
    console.log(query3.getCypher().cypher);

    const results3 = await query3.execute();
    console.log(`\nResults: ${results3.length} scopes with complexity found`);
    if (results3.length > 0) {
      console.log('Most complex scope:', {
        name: results3[0].name,
        complexity: results3[0].complexity,
        type: results3[0].type
      });
    }
    console.log('\n');

    // Test 4: Multiple conditions
    console.log('Test 4: Multiple conditions');
    console.log('---------------------------------------');
    const query4 = rag
      .get('Scope')
      .where('type', '=', 'function')
      .where('complexity', '>', 5)
      .orderBy('complexity', 'DESC')
      .limit(5);

    console.log('Natural language explanation:');
    console.log(query4.explain());
    console.log('\nGenerated Cypher:');
    console.log(query4.getCypher().cypher);

    const results4 = await query4.execute();
    console.log(`\nResults: ${results4.length} complex functions found`);
    results4.forEach((scope, i) => {
      console.log(`  ${i + 1}. ${scope.name} (complexity: ${scope.complexity})`);
    });
    console.log('\n');

    // Test 5: Text operators
    console.log('Test 5: Text search operators');
    console.log('---------------------------------------');
    const query5 = rag
      .get('Scope')
      .where('name', 'CONTAINS', 'test')
      .limit(5);

    console.log('Natural language explanation:');
    console.log(query5.explain());
    console.log('\nGenerated Cypher:');
    console.log(query5.getCypher().cypher);

    const results5 = await query5.execute();
    console.log(`\nResults: ${results5.length} scopes with 'test' in name`);
    results5.forEach((scope, i) => {
      console.log(`  ${i + 1}. ${scope.name}`);
    });
    console.log('\n');

    // Test 6: Semantic search (if embeddings exist)
    console.log('Test 6: Semantic search');
    console.log('---------------------------------------');
    const query6 = rag
      .get('Scope')
      .semanticSearch('scopeSourceEmbeddings', 'functions that handle authentication', {
        topK: 5,
        minScore: 0.7
      });

    console.log('Natural language explanation:');
    console.log(query6.explain());
    console.log('\nNote: This will use vector search instead of Cypher');

    try {
      const results6 = await query6.execute();
      console.log(`\nResults: ${results6.length} semantically similar scopes found`);
      results6.forEach((scope, i) => {
        console.log(`  ${i + 1}. ${scope.name} (score: ${scope.score?.toFixed(3)})`);
      });
    } catch (err: any) {
      console.log(`\nSkipping semantic search: ${err.message}`);
    }
    console.log('\n');

    console.log('✅ Generic Query API tests completed!');

  } catch (error: any) {
    console.error('❌ Error during test:', error.message);
    console.error(error.stack);
  } finally {
    await rag.close();
  }
}

testGenericQuery();
