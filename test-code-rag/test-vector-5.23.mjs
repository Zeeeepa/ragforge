import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'neo4j123')
);

try {
  const session = driver.session({ database: 'neo4j' });
  
  // Check version
  const versionResult = await session.run('CALL dbms.components() YIELD name, versions RETURN name, versions');
  console.log('✅ Neo4j version:', versionResult.records[0].get('versions')[0]);
  
  // Try creating a vector index
  console.log('\nAttempting to create VECTOR INDEX...');
  
  try {
    await session.run('DROP INDEX test_vector_idx IF EXISTS');
  } catch (e) {
    console.log('(Drop failed, index might not exist)');
  }
  
  await session.run(`
    CREATE VECTOR INDEX test_vector_idx IF NOT EXISTS
    FOR (n:Scope)
    ON (n.source_embedding)
    OPTIONS {
      indexConfig: {
        \`vector.dimensions\`: 768,
        \`vector.similarity_function\`: 'cosine'
      }
    }
  `);
  
  console.log('✅ VECTOR INDEX created successfully!');
  
  await session.close();
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  await driver.close();
}
