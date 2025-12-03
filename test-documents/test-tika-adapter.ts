/**
 * Test du TikaSourceAdapter complet
 */
import * as path from 'path';

// Import depuis le chemin relatif pour le test
import { TikaSourceAdapter, type TikaSourceConfig } from '../packages/runtime/src/adapters/document/tika-source-adapter';

async function testAdapter() {
  console.log('='.repeat(60));
  console.log('TEST: TikaSourceAdapter');
  console.log('='.repeat(60));

  const adapter = new TikaSourceAdapter();

  // Config de test
  const config: TikaSourceConfig = {
    type: 'document',
    adapter: 'tika',
    root: path.join(__dirname, 'data'),
    include: [
      '*.pdf',
      '*.txt',
      'libreoffice/*.odt',
      'epub/*.epub',
      'ocr/*.jpg',
    ],
    exclude: [],
    options: {
      ocr: {
        enabled: true,
      },
      chunking: {
        chunk_size: 500,
        chunk_overlap: 100,
        strategy: 'sentence',
      },
      tika_config_path: path.join(__dirname, 'tika-config-ocr.xml'),
    },
  };

  // Valider la config
  console.log('\n[1] Validation de la config...');
  const validation = await adapter.validate(config);
  console.log('    Valid:', validation.valid);
  if (validation.warnings) {
    console.log('    Warnings:', validation.warnings);
  }
  if (validation.errors) {
    console.log('    Errors:', validation.errors);
    return;
  }

  // Parser les documents
  console.log('\n[2] Parsing des documents...');
  const result = await adapter.parse({
    source: config,
    onProgress: (progress) => {
      if (progress.currentFile) {
        console.log(`    [${progress.percentComplete}%] ${progress.currentFile}`);
      }
    },
  });

  // Afficher les résultats
  console.log('\n[3] Résultats:');
  console.log(`    Fichiers traités: ${result.graph.metadata?.filesProcessed}`);
  console.log(`    Nodes créés: ${result.graph.metadata?.nodesGenerated}`);
  console.log(`    Relations créées: ${result.graph.metadata?.relationshipsGenerated}`);
  console.log(`    Temps: ${result.graph.metadata?.parseTimeMs}ms`);

  if (result.graph.metadata?.warnings) {
    console.log(`    Warnings: ${result.graph.metadata.warnings.join(', ')}`);
  }

  // Afficher quelques nodes
  console.log('\n[4] Documents trouvés:');
  const documents = result.graph.nodes.filter(n => n.labels.includes('Document'));
  for (const doc of documents) {
    console.log(`    - ${doc.properties.title} (${doc.properties.type})`);
    console.log(`      Words: ${doc.properties.word_count}, Author: ${doc.properties.author || 'N/A'}`);
  }

  console.log('\n[5] Chunks créés par document:');
  const chunks = result.graph.nodes.filter(n => n.labels.includes('Chunk'));
  const chunksByDoc = new Map<string, number>();
  for (const chunk of chunks) {
    const docPath = chunk.properties.document_path as string;
    chunksByDoc.set(docPath, (chunksByDoc.get(docPath) || 0) + 1);
  }
  for (const [docPath, count] of chunksByDoc) {
    console.log(`    - ${docPath}: ${count} chunks`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEST TERMINÉ');
  console.log('='.repeat(60));
}

testAdapter().catch(console.error);
