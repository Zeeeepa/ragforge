/**
 * Check CONSUMES relationships in the database
 */

import { getBrainManager } from '../packages/core/src/brain/brain-manager.js';

async function main() {
  const brain = await getBrainManager();

  // Count CONSUMES relationships
  const consumesCount = await brain.runQuery('MATCH ()-[r:CONSUMES]->() RETURN count(r) as count');
  console.log('CONSUMES relationships:', consumesCount[0]?.count);

  // Get some examples
  const examples = await brain.runQuery(`
    MATCH (a)-[r:CONSUMES]->(b)
    RETURN a.name as from_name, a.type as from_type, a.file as from_file,
           b.name as to_name, b.type as to_type, b.file as to_file
    LIMIT 10
  `);
  console.log('\nExamples:');
  for (const ex of examples) {
    const sameFile = ex.from_file === ex.to_file ? '(same file)' : '(CROSS-FILE)';
    console.log(`  ${ex.from_name} (${ex.from_type}) --CONSUMES--> ${ex.to_name} (${ex.to_type}) ${sameFile}`);
  }

  // Check cross-file CONSUMES (where files are different)
  const crossFile = await brain.runQuery(`
    MATCH (a)-[r:CONSUMES]->(b)
    WHERE a.file <> b.file
    RETURN count(r) as count
  `);
  console.log('\nCross-file CONSUMES:', crossFile[0]?.count);

  // Check same-file CONSUMES
  const sameFile = await brain.runQuery(`
    MATCH (a)-[r:CONSUMES]->(b)
    WHERE a.file = b.file
    RETURN count(r) as count
  `);
  console.log('Same-file CONSUMES:', sameFile[0]?.count);

  await brain.close();
}

main().catch(console.error);
