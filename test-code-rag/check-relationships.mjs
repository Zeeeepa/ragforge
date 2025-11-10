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

// Query pour voir tous les types de relationships
const result = await client.raw('MATCH ()-[r]->() RETURN DISTINCT type(r) as relType, count(*) as count ORDER BY count DESC');
console.log('📊 Relationships dans la base:');
result.records.forEach(r => {
  console.log(`  - ${r.get('relType')}: ${r.get('count')} occurrences`);
});

// Vérifier spécifiquement HAS_PARENT et INHERITS_FROM
const hasParent = await client.raw('MATCH ()-[r:HAS_PARENT]->() RETURN count(r) as count');
const inheritsFrom = await client.raw('MATCH ()-[r:INHERITS_FROM]->() RETURN count(r) as count');
console.log(`\n🔍 Vérification spécifique:`);
console.log(`  - HAS_PARENT: ${hasParent.records[0].get('count')} occurrences`);
console.log(`  - INHERITS_FROM: ${inheritsFrom.records[0].get('count')} occurrences`);

await client.close();
