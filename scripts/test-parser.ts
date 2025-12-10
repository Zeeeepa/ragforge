#!/usr/bin/env tsx
/**
 * Test Parser Script
 * 
 * Debug tool to test parsing without watcher or Neo4j ingestion.
 * 
 * Usage:
 *   tsx scripts/test-parser.ts <file-or-directory> [--adapter=auto] [--verbose] [--json]
 */

// Use relative imports from source (works with tsx)
import { UniversalSourceAdapter } from '../packages/core/src/runtime/adapters/universal-source-adapter.js';
import type { ParsedNode, ParsedRelationship } from '../packages/core/src/runtime/adapters/types.js';
import * as path from 'path';
import * as fs from 'fs/promises';

interface Options {
  target: string;
  adapter?: 'typescript' | 'python' | 'html' | 'auto';
  verbose?: boolean;
  json?: boolean;
}

async function testParser(options: Options): Promise<void> {
  const { target, adapter = 'auto', verbose = false, json = false } = options;

  // Resolve target path
  const targetPath = path.resolve(target);
  const stat = await fs.stat(targetPath);
  const isDirectory = stat.isDirectory();

  // Build source config
  const sourceConfig = {
    type: 'code' as const,
    adapter: adapter as 'typescript' | 'python' | 'html' | 'auto',
    root: isDirectory ? targetPath : path.dirname(targetPath),
    include: isDirectory 
      ? ['**/*'] 
      : [path.basename(targetPath)],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
    ],
  };

  if (verbose && !json) {
    console.log('🔍 Parser Test Configuration:');
    console.log(`   Target: ${targetPath}`);
    console.log(`   Type: ${isDirectory ? 'directory' : 'file'}`);
    console.log(`   Adapter: ${adapter}`);
    console.log(`   Root: ${sourceConfig.root}`);
    console.log(`   Include: ${sourceConfig.include.join(', ')}`);
    console.log('');
  }

  // Create adapter
  const adapter_instance = new UniversalSourceAdapter();

  // Validate config
  const validation = await adapter_instance.validate(sourceConfig);
  if (!validation.valid) {
    console.error('❌ Configuration validation failed:');
    validation.errors?.forEach((err: string) => console.error(`   - ${err}`));
    process.exit(1);
  }

  if (validation.warnings && validation.warnings.length > 0 && !json) {
    validation.warnings.forEach((warning: string) => console.warn(`⚠️  ${warning}`));
  }

  // Parse with progress
  const startTime = Date.now();
  let filesProcessed = 0;
  let totalFiles = 0;

  try {
    const parseResult = await adapter_instance.parse({
      source: sourceConfig,
      onProgress: (progress: any) => {
        if (json) return; // Skip progress in JSON mode
        
        if (progress.phase === 'discovering') {
          totalFiles = progress.totalFiles || 0;
          if (verbose) {
            console.log(`🔎 Discovering files...`);
          }
        } else if (progress.phase === 'parsing') {
          filesProcessed = progress.filesProcessed || 0;
          totalFiles = progress.totalFiles || 0;
          const percent = totalFiles > 0 
            ? Math.round((filesProcessed / totalFiles) * 100) 
            : 0;
          
          if (verbose) {
            console.log(`📄 Parsing ${filesProcessed}/${totalFiles} files (${percent}%)`);
          } else {
            process.stdout.write(`\r📄 Parsing ${filesProcessed}/${totalFiles} files (${percent}%)`);
          }
        } else if (progress.phase === 'building_graph') {
          if (verbose) {
            console.log(`🏗️  Building graph structure...`);
          }
        }
      },
    });

    if (!json && !verbose) {
      process.stdout.write('\n'); // New line after progress
    }

    const duration = Date.now() - startTime;
    const { graph } = parseResult;

    if (json) {
      // JSON output mode
      console.log(JSON.stringify({
        success: true,
        duration: `${duration}ms`,
        metadata: graph.metadata,
        stats: {
          filesProcessed: graph.metadata.filesProcessed,
          nodesGenerated: graph.metadata.nodesGenerated,
          relationshipsGenerated: graph.metadata.relationshipsGenerated,
        },
        nodes: graph.nodes.slice(0, 100), // Limit to first 100 nodes
        relationships: graph.relationships.slice(0, 100), // Limit to first 100 relationships
      }, null, 2));
    } else {
      // Human-readable output
      console.log('\n✅ Parsing completed successfully!\n');
      console.log('📊 Results:');
      console.log(`   Files processed: ${graph.metadata.filesProcessed}`);
      console.log(`   Nodes generated: ${graph.metadata.nodesGenerated}`);
      console.log(`   Relationships generated: ${graph.metadata.relationshipsGenerated}`);
      console.log(`   Duration: ${duration}ms`);
      
      if (verbose) {
        console.log('\n📦 Node Types Breakdown:');
        const nodeTypes = new Map<string, number>();
        graph.nodes.forEach((node: ParsedNode) => {
          const labels = node.labels.join(':');
          nodeTypes.set(labels, (nodeTypes.get(labels) || 0) + 1);
        });
        
        Array.from(nodeTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
          });

        console.log('\n🔗 Relationship Types Breakdown:');
        const relTypes = new Map<string, number>();
        graph.relationships.forEach((rel: ParsedRelationship) => {
          relTypes.set(rel.type, (relTypes.get(rel.type) || 0) + 1);
        });
        
        Array.from(relTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
          });

        // Show sample nodes
        console.log('\n📄 Sample Nodes (first 5):');
        graph.nodes.slice(0, 5).forEach((node: ParsedNode, i: number) => {
          console.log(`   ${i + 1}. [${node.labels.join(':')}] ${node.properties.name || node.properties.uuid || node.id}`);
          if (node.properties.file) {
            console.log(`      File: ${node.properties.file}`);
          }
          if (node.properties.type) {
            console.log(`      Type: ${node.properties.type}`);
          }
        });

        // Show sample relationships
        console.log('\n🔗 Sample Relationships (first 5):');
        graph.relationships.slice(0, 5).forEach((rel: ParsedRelationship, i: number) => {
          console.log(`   ${i + 1}. ${rel.type}`);
          console.log(`      From: ${rel.from}`);
          console.log(`      To: ${rel.to}`);
        });
      }
    }
  } catch (error: any) {
    if (json) {
      console.error(JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
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

// CLI entry point
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage: tsx scripts/test-parser.ts <file-or-directory> [options]

Test parsing without watcher or Neo4j ingestion.

Arguments:
  <file-or-directory>    File or directory to parse

Options:
  --adapter <type>       Parser adapter: typescript, python, html, auto (default: auto)
  --verbose              Show detailed parsing output
  --json                 Output results as JSON

Examples:
  tsx scripts/test-parser.ts src/index.ts
  tsx scripts/test-parser.ts src/ --adapter typescript --verbose
  tsx scripts/test-parser.ts docs/ --json
`);
    process.exit(0);
  }

  const target = args[0];
  const options: Options = {
    target,
  };

  // Parse options
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--adapter' && i + 1 < args.length) {
      options.adapter = args[i + 1] as any;
      i++;
    } else if (args[i] === '--verbose') {
      options.verbose = true;
    } else if (args[i] === '--json') {
      options.json = true;
    } else if (args[i].startsWith('--adapter=')) {
      options.adapter = args[i].split('=')[1] as any;
    }
  }

  await testParser(options);
}

main().catch(console.error);
