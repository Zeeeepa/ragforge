import { createRagClient } from './client.js';

async function checkEmbeddings() {
  const rag = createRagClient();

  const result = await rag.client.run(`
    MATCH (s:Scope)
    WHERE s.source_embedding IS NOT NULL
    RETURN count(s) as count
  `);

  console.log('Scopes with embeddings:', result.records[0].get('count').toNumber());

  const total = await rag.client.run('MATCH (s:Scope) RETURN count(s) as count');
  console.log('Total scopes:', total.records[0].get('count').toNumber());

  await rag.close();
}

checkEmbeddings();
