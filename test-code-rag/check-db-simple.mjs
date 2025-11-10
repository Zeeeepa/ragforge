import neo4j from 'neo4j-driver';

const driver = neo4j.driver(
  'bolt://localhost:7687',
  neo4j.auth.basic('neo4j', 'neo4j123')
);

const session = driver.session({ database: 'neo4j' });

try {
  // Check File nodes
  console.log('📁 Files in database:');
  const files = await session.run('MATCH (f:File) RETURN f.name LIMIT 5');
  files.records.forEach(r => console.log('  -', r.get('f.name')));

  // Check DEFINED_IN relationships for createClient
  console.log('\n🔗 DEFINED_IN relationships for createClient:');
  const rels = await session.run(`
    MATCH (s:Scope {name: 'createClient'})-[:DEFINED_IN]->(f:File)
    RETURN s.name, f.name
  `);
  console.log('Result:', rels.records.length, 'relationships');
  rels.records.forEach(r => {
    console.log(`  ${r.get('s.name')} -> ${r.get('f.name')}`);
  });

  // Check if expansion returns File in properties
  console.log('\n🔍 Check File properties:');
  const fileProps = await session.run(`
    MATCH (f:File)
    RETURN f LIMIT 1
  `);
  if (fileProps.records.length > 0) {
    const file = fileProps.records[0].get('f').properties;
    console.log('File properties:', Object.keys(file));
    console.log('File data:', file);
  }

} catch (error) {
  console.error('Error:', error.message);
} finally {
  await session.close();
  await driver.close();
}
