import { config } from 'dotenv';
import { resolve } from 'path';
import { createRagClient } from './client.js';

config({ path: resolve(process.cwd(), '.env') });

const rag = createRagClient();

async function debug() {
  const query = rag
    .get('Scope')
    .semanticSearch('scopeSourceEmbeddings', 'functions that handle authentication', {
      topK: 2,
      minScore: 0.7
    });

  const results = await query.execute();
  console.log('Number of results:', results.length);
  console.log('\nFirst result structure:');
  console.log(JSON.stringify(results[0], null, 2));
  console.log('\nKeys in first result:', Object.keys(results[0]));
  
  await rag.close();
}

debug();
