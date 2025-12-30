/**
 * Test script to check what codeparsers returns for identifier references
 *
 * Usage:
 *   npx tsx scripts/test-parser-refs.ts                    # Run with default test code
 *   npx tsx scripts/test-parser-refs.ts path/to/file.ts    # Parse a specific file
 *   npx tsx scripts/test-parser-refs.ts --code "const x = 1"  # Parse inline code
 */

import { TypeScriptLanguageParser, PythonLanguageParser } from '@luciformresearch/codeparsers';
import * as fs from 'fs';
import * as path from 'path';

const defaultTestCode = `
import { formatAsMarkdown, BrainSearchOutput } from './brain-search-formatter';
import { someExternal } from 'external-package';

export function testFunction(output: BrainSearchOutput): string {
  const result = formatAsMarkdown(output, 'test query');
  console.log(result);
  return result;
}
`;

async function main() {
  const args = process.argv.slice(2);

  let code: string;
  let filePath: string;
  let language: 'typescript' | 'python' = 'typescript';

  if (args.length === 0) {
    // Default test code
    code = defaultTestCode;
    filePath = 'test-file.ts';
    console.log('📝 Using default test code\n');
  } else if (args[0] === '--code') {
    // Inline code
    code = args.slice(1).join(' ');
    filePath = 'inline-code.ts';
    console.log('📝 Using inline code\n');
  } else {
    // File path
    const inputPath = args[0];
    if (!fs.existsSync(inputPath)) {
      console.error(`❌ File not found: ${inputPath}`);
      process.exit(1);
    }
    code = fs.readFileSync(inputPath, 'utf-8');
    filePath = inputPath;

    // Detect language from extension
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === '.py') {
      language = 'python';
    }
    console.log(`📝 Parsing file: ${inputPath} (${language})\n`);
  }

  // Initialize parser
  const parser = language === 'python'
    ? new PythonLanguageParser()
    : new TypeScriptLanguageParser();
  await parser.initialize();

  const analysis = await parser.parseFile(filePath, code);

  console.log('\n=== FILE IMPORTS ===');
  console.log(JSON.stringify(analysis.imports, null, 2));

  console.log('\n=== FILE EXPORTS ===');
  console.log(JSON.stringify(analysis.exports, null, 2));

  console.log('\n=== SCOPES ===');
  for (const scope of analysis.scopes) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📦 ${scope.type}: ${scope.name} (lines ${scope.startLine}-${scope.endLine})`);

    if (scope.imports.length > 0) {
      console.log('\n  🔗 imports:');
      for (const imp of scope.imports) {
        const local = imp.isLocal ? '📁' : '📦';
        console.log(`     ${local} ${imp.imported} from "${imp.source}" (${imp.kind})`);
      }
    }

    if (scope.references.length > 0) {
      console.log('\n  🔍 references:');
      for (const ref of scope.references) {
        const kindIcon = ref.kind === 'import' ? '🔗' : ref.kind === 'local_scope' ? '📍' : '❓';
        const source = ref.source ? ` from "${ref.source}"` : '';
        const target = ref.targetScope ? ` → ${ref.targetScope}` : '';
        console.log(`     ${kindIcon} ${ref.identifier} [${ref.kind || 'unknown'}]${source}${target} (line ${ref.line})`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log(`   Total scopes: ${analysis.scopes.length}`);
  console.log(`   Total imports: ${analysis.imports.length}`);
  console.log(`   Total exports: ${analysis.exports.length}`);

  const importRefs = analysis.scopes.flatMap(s => s.references.filter(r => r.kind === 'import'));
  const localRefs = analysis.scopes.flatMap(s => s.references.filter(r => r.kind === 'local_scope'));
  const unknownRefs = analysis.scopes.flatMap(s => s.references.filter(r => !r.kind || r.kind === 'unknown'));

  console.log(`   Import references: ${importRefs.length}`);
  console.log(`   Local scope references: ${localRefs.length}`);
  console.log(`   Unknown references: ${unknownRefs.length}`);
}

main().catch(console.error);
