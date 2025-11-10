import { createClient } from '@luciformresearch/ragforge-runtime';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const client = createClient({
  neo4j: {
    uri: process.env.NEO4J_URI,
    username: process.env.NEO4J_USERNAME,
    password: process.env.NEO4J_PASSWORD,
    database: process.env.NEO4J_DATABASE
  }
});

// Check if "AddRelationshipConfig" exists
const addRelConfig = await client.raw('MATCH (n:Scope {name: "AddRelationshipConfig"}) RETURN count(n) as count');
console.log('🔍 "AddRelationshipConfig" exists:', addRelConfig.records[0].get('count').toInt());

// Check any scope with HAS_PARENT
const anyHasParent = await client.raw('MATCH (n:Scope)-[:HAS_PARENT]->(parent:Scope) RETURN n.name as child, parent.name as parent LIMIT 10');
console.log('\n📊 Exemples de HAS_PARENT:');
anyHasParent.records.forEach(r => {
  console.log(`  - ${r.get('child')} → ${r.get('parent')}`);
});

// Check if "CodeSourceAdapter" exists for INHERITS_FROM example
const codeSourceAdapter = await client.raw('MATCH (n:Scope {name: "CodeSourceAdapter"}) RETURN count(n) as count');
console.log('\n🔍 "CodeSourceAdapter" exists:', codeSourceAdapter.records[0].get('count').toInt());

// Check any scope with INHERITS_FROM
const anyInheritsFrom = await client.raw('MATCH (n:Scope)-[:INHERITS_FROM]->(parent:Scope) RETURN n.name as child, parent.name as parent LIMIT 10');
console.log('\n📊 Exemples de INHERITS_FROM:');
anyInheritsFrom.records.forEach(r => {
  console.log(`  - ${r.get('child')} extends ${r.get('parent')}`);
});

await client.close();
