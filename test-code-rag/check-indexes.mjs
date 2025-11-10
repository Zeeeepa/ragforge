import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'neo4j123')
);

try {
  const session = driver.session({ database: 'neo4j' });
  
  const result = await session.run('SHOW INDEXES');
  
  console.log('Available indexes:');
  result.records.forEach(r => {
    const name = r.get('name');
    const type = r.get('type');
    const entityType = r.get('entityType');
    const properties = r.get('properties');
    console.log(`- ${name} (${type}) on ${entityType}: ${properties}`);
  });
  
  await session.close();
} catch (error) {
  console.error('Error:', error.message);
} finally {
  await driver.close();
}
