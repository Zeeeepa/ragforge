/**
 * Test what the parser actually returns for a file with decorators and implements
 */
import { TypeScriptLanguageParser } from '@luciformresearch/codeparsers';
import * as fs from 'fs/promises';

async function main() {
  const parser = new TypeScriptLanguageParser();
  await parser.initialize();

  const filePath = '/home/luciedefraiteur/LR_CodeRag/ragforge/test-relationships/services.ts';
  const content = await fs.readFile(filePath, 'utf-8');

  const analysis = await parser.parseFile(filePath, content);

  console.log(`\n=== ${filePath} ===`);

  for (const scope of analysis.scopes) {
    if (scope.type === 'class') {
      console.log(`\nClass: ${scope.name}`);
      console.log('  languageSpecific:', JSON.stringify(scope.languageSpecific, null, 2));
    }
  }
}

main().catch(console.error);
