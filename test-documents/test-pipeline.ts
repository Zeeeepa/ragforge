/**
 * Test du pipeline TikaParser + Chunker
 */
import * as path from 'path';
import { TikaParser } from '../packages/runtime/src/adapters/document/tika-parser';
import { Chunker } from '../packages/runtime/src/adapters/document/chunker';

const DATA_DIR = path.join(__dirname, 'data');

// Config OCR pour Tika
const TIKA_CONFIG = path.join(__dirname, 'tika-config-ocr.xml');

async function testPipeline() {
  console.log('='.repeat(60));
  console.log('TEST PIPELINE: TikaParser + Chunker');
  console.log('='.repeat(60));

  // 1. Initialiser le parser avec config OCR
  const parser = new TikaParser({
    configPath: TIKA_CONFIG,
    debug: false,
  });

  // 2. Initialiser le chunker
  const chunker = new Chunker({
    chunkSize: 500,
    chunkOverlap: 100,
    strategy: 'sentence',
  });

  try {
    // Démarrer Tika
    console.log('\n[1] Démarrage de Tika...');
    await parser.start();
    console.log('    ✓ Tika démarré');

    // Test sur différents fichiers
    const testFiles = [
      'file.pdf',
      'libreoffice/sample.odt',
      'epub/sample.epub',
      'ocr/simple.jpg',
    ];

    for (const file of testFiles) {
      const filePath = path.join(DATA_DIR, file);

      console.log(`\n[2] Parsing: ${file}`);

      try {
        // Parser le document
        const doc = await parser.parse(filePath);

        console.log(`    ✓ Extrait ${doc.content.length} caractères`);
        console.log(`    ✓ Métadonnées:`, {
          title: doc.metadata.title || '(none)',
          author: doc.metadata.author || '(none)',
          type: doc.metadata.contentType || '(none)',
        });

        // Chunker le contenu
        console.log(`\n[3] Chunking: ${file}`);
        const chunks = chunker.chunk(doc.content, doc.filePath);

        console.log(`    ✓ ${chunks.length} chunks créés`);

        // Afficher les premiers chunks
        if (chunks.length > 0) {
          console.log(`\n    Premier chunk (${chunks[0].wordCount} mots):`);
          console.log(`    "${chunks[0].content.slice(0, 100)}..."`);
        }

        if (chunks.length > 1) {
          console.log(`\n    Dernier chunk (${chunks[chunks.length - 1].wordCount} mots):`);
          console.log(`    "${chunks[chunks.length - 1].content.slice(0, 100)}..."`);
        }

      } catch (err: any) {
        console.log(`    ✗ Erreur: ${err.message}`);
      }

      console.log('\n' + '-'.repeat(60));
    }

  } finally {
    // Toujours arrêter Tika
    console.log('\n[4] Arrêt de Tika...');
    await parser.stop();
    console.log('    ✓ Tika arrêté');
  }

  console.log('\n' + '='.repeat(60));
  console.log('TEST TERMINÉ');
  console.log('='.repeat(60));
}

// Run
testPipeline().catch(console.error);
