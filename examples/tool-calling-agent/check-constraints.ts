import { createRagClient } from './client.js';

async function checkConstraints() {
  const rag = createRagClient();

  const result = await rag.client.run('SHOW CONSTRAINTS');

  console.log('Neo4j Constraints:');
  console.log('==================');
  for (const record of result.records) {
    const name = record.get('name');
    const type = record.get('type');
    const entityType = record.get('entityType');
    const labelsOrTypes = record.get('labelsOrTypes');
    const properties = record.get('properties');
    console.log(`${name}:`);
    console.log(`  Type: ${type}`);
    console.log(`  Entity: ${entityType} ${labelsOrTypes}`);
    console.log(`  Properties: ${properties}`);
    console.log('');
  }

  await rag.close();
}

checkConstraints();
