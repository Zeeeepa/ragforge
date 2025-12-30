#!/usr/bin/env npx tsx
/**
 * Test GenericCodeParser with LucieCode bundle
 * Run: npx tsx scripts/test-large-file-parsing.ts
 */

import { GenericCodeParser } from '@luciformresearch/codeparsers';
import * as fs from 'fs';

async function testLargeFile() {
  const parser = new GenericCodeParser();
  await parser.initialize();

  const bundlePath = '/home/luciedefraiteur/LR_CodeRag/ragforge/LucieCode/bundle/gemini.js';
  const content = fs.readFileSync(bundlePath, 'utf-8');
  const lines = content.split('\n');

  console.log('\n=== LucieCode bundle: gemini.js ===');
  console.log(`Size: ${(content.length / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Lines: ${lines.length}`);

  console.log('\nParsing (this may take a while)...');
  const start = Date.now();
  const result = await parser.parseFile('gemini.js', content);
  const elapsed = Date.now() - start;

  console.log(`\nParsed in ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`Scopes found: ${result.scopes.length}`);
  console.log(`Functions: ${result.scopes.filter(s => s.type === 'function').length}`);
  console.log(`Classes: ${result.scopes.filter(s => s.type === 'class').length}`);
  console.log(`Chunks: ${result.scopes.filter(s => s.type === 'chunk').length}`);

  // Scope size stats
  const scopeSizes = result.scopes.map(s => s.source.length);
  const totalChars = scopeSizes.reduce((a, b) => a + b, 0);
  console.log(`\nScope sizes (chars):`);
  console.log(`  Min: ${Math.min(...scopeSizes)}`);
  console.log(`  Max: ${Math.max(...scopeSizes)}`);
  console.log(`  Avg: ${Math.round(totalChars / scopeSizes.length)}`);
  console.log(`  Total: ${(totalChars / 1024 / 1024).toFixed(1)} MB`);

  // Line counts
  const linesCounts = result.scopes.map(s => s.endLine - s.startLine + 1);
  console.log(`\nScope sizes (lines):`);
  console.log(`  Min: ${Math.min(...linesCounts)}`);
  console.log(`  Max: ${Math.max(...linesCounts)}`);
  console.log(`  Avg: ${Math.round(linesCounts.reduce((a, b) => a + b, 0) / linesCounts.length)}`);

  console.log('\n✅ Done!');
}

testLargeFile().catch(console.error);
