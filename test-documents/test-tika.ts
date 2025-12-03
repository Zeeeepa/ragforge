import TikaServer from '@nisyaban/tika-server';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, 'data');

// Test files to extract text from
const testFiles = [
  // Basic formats
  'file.pdf',
  'file.doc',
  'file.docx',
  'file.txt',
  'file.xml',

  // New formats
  'powerpoint/sample.pptx',
  'powerpoint/sample.ppt',
  'excel/sample.xlsx',
  'excel/sample.xls',
  'libreoffice/sample.odt',
  'libreoffice/sample.ods',
  'libreoffice/sample.odp',
  'rtf/sample.rtf',
  'epub/sample.epub',
  'html/sample.html',
  'email/sample.eml',
  'markdown/sample.md',

  // Edge cases
  'nonutf8/utf16-english.txt',
  'nonutf8/utf16-chinese.txt',
  'ocr/simple.jpg',
];

async function testTikaExtraction() {
  console.log('='.repeat(60));
  console.log('TIKA TEXT EXTRACTION TEST');
  console.log('='.repeat(60));
  console.log('');

  // Initialize Tika Server
  const tikaServer = new TikaServer();

  tikaServer.on('debug', (msg: string) => {
    // Uncomment to see debug messages
    // console.log(`[Tika Debug] ${msg}`);
  });

  console.log('Starting Tika Server...');
  await tikaServer.start();
  console.log('Tika Server started!\n');

  const results: { file: string; status: string; chars: number; preview: string }[] = [];

  for (const file of testFiles) {
    const filePath = path.join(DATA_DIR, file);

    if (!fs.existsSync(filePath)) {
      results.push({ file, status: 'NOT FOUND', chars: 0, preview: '' });
      continue;
    }

    try {
      process.stdout.write(`Extracting: ${file}...`);

      // Read file content as buffer
      const fileContent = fs.readFileSync(filePath);

      // Extract text using Tika with filename hint for better detection
      const text = await tikaServer.queryText(fileContent, {
        filename: path.basename(filePath)
      });

      const chars = text.length;
      const preview = text.slice(0, 100).replace(/\n/g, ' ').trim();

      results.push({ file, status: 'OK', chars, preview });
      console.log(` ✓ ${chars} chars`);
    } catch (error: any) {
      results.push({ file, status: `ERROR: ${error.message}`, chars: 0, preview: '' });
      console.log(` ✗ ${error.message}`);
    }
  }

  // Stop Tika Server
  console.log('\nStopping Tika Server...');
  await tikaServer.stop();

  // Summary
  console.log('\n');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  const ok = results.filter(r => r.status === 'OK').length;
  const errors = results.filter(r => r.status.startsWith('ERROR')).length;
  const notFound = results.filter(r => r.status === 'NOT FOUND').length;

  console.log(`Total: ${results.length} | OK: ${ok} | Errors: ${errors} | Not Found: ${notFound}`);
  console.log('');

  // Table output
  console.log('File'.padEnd(35) + 'Status'.padEnd(10) + 'Chars'.padEnd(10) + 'Preview');
  console.log('-'.repeat(100));

  for (const r of results) {
    const statusIcon = r.status === 'OK' ? '✓' : r.status === 'NOT FOUND' ? '?' : '✗';
    console.log(
      r.file.padEnd(35) +
      statusIcon.padEnd(10) +
      r.chars.toString().padEnd(10) +
      r.preview.slice(0, 45)
    );
  }
}

// Run the test
testTikaExtraction()
  .then(() => {
    console.log('\n\nTest completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
