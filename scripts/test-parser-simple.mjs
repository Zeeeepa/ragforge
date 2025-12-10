#!/usr/bin/env node
/**
 * Test Parser Script (Simple version using compiled code)
 * 
 * Usage: node scripts/test-parser-simple.mjs <file-or-directory> [--verbose] [--json]
 */

import { UniversalSourceAdapter } from '../packages/core/dist/esm/runtime/adapters/universal-source-adapter.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testParser(target, options = {}) {
  const { verbose = false, json = false, adapter = 'auto' } = options;

  // Resolve target path
  const targetPath = path.resolve(target);
  const stat = await fs.stat(targetPath);
  const isDirectory = stat.isDirectory();

  // Build source config
  const sourceConfig = {
    type: 'code',
    adapter: adapter,
    root: isDirectory ? targetPath : path.dirname(targetPath),
    include: isDirectory 
      ? ['**/*'] 
      : [path.basename(targetPath)],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/*.pdf', // Exclude PDFs to avoid parsing errors
      '**/*.docx', // Exclude Word docs
      '**/*.xlsx', // Exclude Excel files
    ],
  };

  if (verbose && !json) {
    console.log('🔍 Parser Test Configuration:');
    console.log(`   Target: ${targetPath}`);
    console.log(`   Type: ${isDirectory ? 'directory' : 'file'}`);
    console.log(`   Adapter: ${adapter}`);
    console.log(`   Root: ${sourceConfig.root}`);
    console.log('');
  }

  // Create adapter
  const adapter_instance = new UniversalSourceAdapter();

  // Validate config
  const validation = await adapter_instance.validate(sourceConfig);
  if (!validation.valid) {
    console.error('❌ Configuration validation failed:');
    validation.errors?.forEach((err) => console.error(`   - ${err}`));
    process.exit(1);
  }

  // Parse with progress
  const startTime = Date.now();

  try {
    const parseResult = await adapter_instance.parse({
      source: sourceConfig,
      onProgress: (progress) => {
        if (json) return;
        
        if (progress.phase === 'parsing') {
          const percent = progress.totalFiles > 0 
            ? Math.round((progress.filesProcessed / progress.totalFiles) * 100) 
            : 0;
          
          if (verbose) {
            console.log(`📄 Parsing ${progress.filesProcessed}/${progress.totalFiles} files (${percent}%)`);
          } else {
            process.stdout.write(`\r📄 Parsing ${progress.filesProcessed}/${progress.totalFiles} files (${percent}%)`);
          }
        }
      },
    });

    if (!json && !verbose) {
      process.stdout.write('\n');
    }

    const duration = Date.now() - startTime;
    const { graph } = parseResult;

    if (json) {
      console.log(JSON.stringify({
        success: true,
        duration: `${duration}ms`,
        metadata: graph.metadata,
        stats: {
          filesProcessed: graph.metadata.filesProcessed,
          nodesGenerated: graph.metadata.nodesGenerated,
          relationshipsGenerated: graph.metadata.relationshipsGenerated,
        },
      }, null, 2));
    } else {
      console.log('\n✅ Parsing completed successfully!\n');
      console.log('📊 Results:');
      console.log(`   Files processed: ${graph.metadata.filesProcessed}`);
      console.log(`   Nodes generated: ${graph.metadata.nodesGenerated}`);
      console.log(`   Relationships generated: ${graph.metadata.relationshipsGenerated}`);
      console.log(`   Duration: ${duration}ms`);
      
      if (verbose) {
        console.log('\n📦 Node Types Breakdown:');
        const nodeTypes = new Map();
        graph.nodes.forEach((node) => {
          const labels = node.labels.join(':');
          nodeTypes.set(labels, (nodeTypes.get(labels) || 0) + 1);
        });
        
        Array.from(nodeTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
          });

        console.log('\n🔗 Relationship Types Breakdown:');
        const relTypes = new Map();
        graph.relationships.forEach((rel) => {
          relTypes.set(rel.type, (relTypes.get(rel.type) || 0) + 1);
        });
        
        Array.from(relTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
          });
      }
    }
  } catch (error) {
    if (json) {
      console.error(JSON.stringify({
        success: false,
        error: error.message,
      }, null, 2));
    } else {
      console.error('\n❌ Parsing failed:');
      console.error(`   ${error.message}`);
      if (verbose) {
        console.error('\nStack trace:');
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log(`
Usage: node scripts/test-parser-simple.mjs <file-or-directory> [options]

Options:
  --verbose    Show detailed output
  --json       Output as JSON
  --adapter    Parser adapter (typescript, python, html, auto)

Examples:
  node scripts/test-parser-simple.mjs docs/ --verbose
  node scripts/test-parser-simple.mjs docs/ --json
`);
  process.exit(0);
}

const target = args[0];
const options = {
  verbose: args.includes('--verbose'),
  json: args.includes('--json'),
  adapter: args.find(a => a.startsWith('--adapter='))?.split('=')[1] || 'auto',
};

testParser(target, options).catch(console.error);
