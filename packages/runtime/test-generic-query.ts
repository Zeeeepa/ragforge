/**
 * Test the new generic query API
 *
 * This demonstrates the fluent query interface that can be used
 * as tools for conversational agents.
 */

import { createClient } from './src/index.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../../.env') });

async function testGenericQuery() {
  console.log('🧪 Testing Generic Query API\n');

  // Create client
  const client = createClient({
    neo4j: {
      uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
      username: process.env.NEO4J_USERNAME || 'neo4j',
      password: process.env.NEO4J_PASSWORD || 'password'
    }
  });

  try {
    // Test 1: Basic query with where condition
    console.log('Test 1: Basic query with where condition');
    console.log('---------------------------------------');
    const query1 = client.get('Scope')
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
    const query2 = client.get('Scope')
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
    client.registerFilter('hasComplexity', 'EXISTS(n.complexity)');

    const query3 = client.get('Scope')
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
    const query4 = client.get('Scope')
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
    const query5 = client.get('Scope')
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
    const query6 = client.get('Scope')
      .semanticSearch('scope_code_embeddings', 'functions that handle authentication', {
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
    await client.close();
  }
}

testGenericQuery();
