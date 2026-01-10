import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

const API_URL = 'http://127.0.0.1:6970';

async function testFullIngestion() {
  console.log('============================================================');
  console.log('TEST: Full Document Ingestion from ZIP');
  console.log('============================================================\n');

  const zipPath = path.join(__dirname, '../../../docs/community-docs/ingestion-tests/zip-files/test-all-documents.zip');

  if (!fs.existsSync(zipPath)) {
    console.error(`ZIP file not found: ${zipPath}`);
    process.exit(1);
  }

  // Extract ZIP and prepare files for batch ingestion
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory);

  console.log(`ZIP contains ${entries.length} files:\n`);

  const files = entries.map(entry => {
    const buffer = entry.getData();
    console.log(`  - ${entry.entryName} (${buffer.length} bytes)`);
    return {
      filePath: path.basename(entry.entryName),
      content: buffer.toString('base64'),
    };
  });

  console.log('\nIngesting via /ingest/batch...\n');
  const startTime = Date.now();

  const response = await fetch(`${API_URL}/ingest/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files,
      metadata: {
        documentId: 'test-all-documents',
        documentTitle: 'Test All Document Types',
        authorId: 'test-user',
        categoryId: 'test-category',
        categorySlug: 'test',
      },
      generateEmbeddings: true,
      enableVision: true,
      extractEntities: true,
    }),
  });

  const result = await response.json();
  const elapsed = Date.now() - startTime;

  console.log('Result:', JSON.stringify(result, null, 2));
  console.log(`\nTotal time: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);

  if (result.success) {
    console.log('\n============================================================');
    console.log('Ingestion Summary:');
    console.log(`  - Files processed: ${result.filesProcessed}`);
    console.log(`  - Nodes created: ${result.nodesCreated}`);
    console.log(`  - Relationships: ${result.relationshipsCreated}`);
    console.log(`  - Embeddings: ${result.embeddingsGenerated}`);
    if (result.entityStats) {
      console.log(`  - Entities: ${result.entityStats.entitiesExtracted}`);
      console.log(`  - Tags: ${result.entityStats.tagsExtracted}`);
      console.log(`  - Canonical entities: ${result.entityStats.canonicalEntitiesCreated}`);
    }
    console.log('============================================================');
  }

  // Now verify what's in the database
  console.log('\n\n============================================================');
  console.log('Database Verification:');
  console.log('============================================================\n');

  const countResponse = await fetch(`${API_URL}/cypher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `MATCH (n) RETURN labels(n)[0] as type, count(n) as count ORDER BY count DESC`
    }),
  });
  const countResult = await countResponse.json();

  console.log('Node counts by type:');
  for (const record of countResult.records) {
    const count = typeof record.count === 'object' ? record.count.low : record.count;
    console.log(`  - ${record.type}: ${count}`);
  }
}

testFullIngestion().catch(console.error);
