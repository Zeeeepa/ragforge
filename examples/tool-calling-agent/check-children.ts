import { createRagClient } from './client.js';

async function main() {
  const rag = createRagClient();

  // Check class and its children
  const r = await rag.client.run(`
    MATCH (class:Scope {uuid: "DDC93BE3-1D1E-CDAD-B2BE-3F8B5D135AFF"})
    OPTIONAL MATCH (child:Scope)-[:HAS_PARENT]->(class)
    RETURN class.name as className,
           class.type as classType,
           size(class.source) as classSourceLen,
           collect({name: child.name, type: child.type, sourceLen: size(child.source)}) as children
  `);

  const record = r.records[0];
  console.log('Class:', record.get('className'), '- Type:', record.get('classType'));
  const classLen = record.get('classSourceLen');
  console.log('Class source length:', classLen?.low || classLen);
  console.log('\nChildren (methods/properties):');
  const children = record.get('children');
  for (const c of children) {
    if (c.name) {
      const len = c.sourceLen?.low || c.sourceLen;
      console.log(`  - ${c.name} (${c.type}) - ${len} chars`);
    }
  }

  await rag.close();
}
main();
