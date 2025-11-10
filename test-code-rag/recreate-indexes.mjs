import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'neo4j123')
);

try {
  const session = driver.session({ database: 'neo4j' });
  
  console.log('Dropping test index...');
  await session.run('DROP INDEX test_vector_idx IF EXISTS');
  
  console.log('Creating scopeSourceEmbeddings index...');
  await session.run(`
    CREATE VECTOR INDEX scopeSourceEmbeddings IF NOT EXISTS
    FOR (n:Scope)
    ON (n.source_embedding)
    OPTIONS {
      indexConfig: {
        \`vector.dimensions\`: 768,
        \`vector.similarity_function\`: 'cosine'
      }
    }
  `);
  
  console.log('✅ Vector index created successfully!');
  
  await session.close();
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  await driver.close();
}
