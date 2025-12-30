#!/usr/bin/env npx tsx
/**
 * Debug script for import resolution issues
 *
 * This script forces re-ingestion of a specific file and shows debug output
 * for how import references are resolved.
 *
 * Usage:
 *   DEBUG_IMPORT_SYMBOL=formatAsMarkdown npx tsx scripts/debug-import-resolution.ts [file_path]
 *
 * Environment:
 *   DEBUG_IMPORT_SYMBOL - Symbol to debug (e.g., 'formatAsMarkdown')
 *
 * What it does:
 *   1. Marks the file as dirty in the database (schemaDirty=true)
 *   2. Triggers re-ingestion of the project containing the file
 *   3. Shows debug output for buildImportReferences
 */

import { getBrainManager } from '../packages/core/src/brain/brain-manager.js';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  const filePath = process.argv[2];
  const debugSymbol = process.env.DEBUG_IMPORT_SYMBOL;

  if (!filePath) {
    console.log(`
Usage: DEBUG_IMPORT_SYMBOL=<symbol> npx tsx scripts/debug-import-resolution.ts <file_path>

Example:
  DEBUG_IMPORT_SYMBOL=formatAsMarkdown npx tsx scripts/debug-import-resolution.ts packages/core/src/tools/brain-tools.ts
`);
    process.exit(1);
  }

  if (!debugSymbol) {
    console.log('⚠️  No DEBUG_IMPORT_SYMBOL set. Debug logging will not appear.');
    console.log('   Set it to the symbol you want to trace, e.g.:');
    console.log('   DEBUG_IMPORT_SYMBOL=formatAsMarkdown npx tsx scripts/debug-import-resolution.ts ...');
    console.log('');
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ File not found: ${absolutePath}`);
    process.exit(1);
  }

  console.log(`📁 File: ${absolutePath}`);
  console.log(`🔍 Debug symbol: ${debugSymbol || '(none)'}`);
  console.log('');

  const brain = await getBrainManager();

  // Step 1: Find the project containing this file
  console.log('Step 1: Finding project...');
  const projects = await brain.listProjects();
  let targetProject: { id: string; root: string } | undefined;

  for (const project of projects) {
    if (absolutePath.startsWith(project.root)) {
      targetProject = { id: project.id, root: project.root };
      break;
    }
  }

  if (!targetProject) {
    console.error('❌ File not in any registered project');
    console.log('   Registered projects:');
    for (const p of projects) {
      console.log(`   - ${p.name}: ${p.root}`);
    }
    await brain.close();
    process.exit(1);
  }

  console.log(`   Found project: ${targetProject.id}`);
  console.log(`   Project root: ${targetProject.root}`);
  console.log('');

  // Step 2: Mark file as dirty
  console.log('Step 2: Marking file as dirty...');
  const relativePath = path.relative(targetProject.root, absolutePath);

  const markResult = await brain.runQuery(`
    MATCH (n)
    WHERE (n.file = $relativePath OR n.absolutePath = $absolutePath) AND n.projectId = $projectId
    SET n.schemaDirty = true, n.embeddingsDirty = true
    RETURN count(n) as marked
  `, { relativePath, absolutePath, projectId: targetProject.id });

  const markedCount = markResult[0]?.marked || 0;
  console.log(`   Marked ${markedCount} nodes as dirty`);
  console.log('');

  // Step 3: Check current CONSUMES edges for reference
  console.log('Step 3: Checking current CONSUMES edges from this file...');
  const currentConsumes = await brain.runQuery(`
    MATCH (a)-[:CONSUMES]->(b)
    WHERE a.file = $relativePath AND a.projectId = $projectId
    RETURN a.name as from_name, a.type as from_type, b.name as to_name, b.type as to_type, b.file as to_file
    LIMIT 20
  `, { relativePath, projectId: targetProject.id });

  if (currentConsumes.length === 0) {
    console.log('   No CONSUMES edges from this file currently');
  } else {
    console.log(`   Found ${currentConsumes.length} CONSUMES edges:`);
    for (const c of currentConsumes) {
      console.log(`   - ${c.from_name} -> ${c.to_name} (${c.to_type}) @ ${c.to_file}`);
    }
  }
  console.log('');

  // Step 4: Trigger re-ingestion
  console.log('Step 4: Triggering re-ingestion...');
  console.log('   (This will show DEBUG output if DEBUG_IMPORT_SYMBOL is set)');
  console.log('');

  try {
    // Get the watcher for this project and queue the file
    const watcher = brain.getWatcher(targetProject.id);
    if (watcher) {
      // Queue the specific file
      watcher.queueFile(absolutePath);
      console.log('   Queued file for watcher processing');

      // Wait for processing
      console.log('   Waiting for processing...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    } else {
      console.log('   No watcher found, using direct ingest...');

      // Use the ingestion directly via quick ingest with force
      await brain.quickIngest({
        root: targetProject.root,
        include: [relativePath],
        incremental: 'content', // Force content re-parse
        verbose: true
      });
    }
  } catch (error: any) {
    console.error(`   Error during ingestion: ${error.message}`);
  }

  console.log('');

  // Step 5: Check CONSUMES edges after re-ingestion
  console.log('Step 5: Checking CONSUMES edges after re-ingestion...');
  const afterConsumes = await brain.runQuery(`
    MATCH (a)-[:CONSUMES]->(b)
    WHERE a.file = $relativePath AND a.projectId = $projectId
    RETURN a.name as from_name, a.type as from_type, b.name as to_name, b.type as to_type, b.file as to_file
    LIMIT 20
  `, { relativePath, projectId: targetProject.id });

  if (afterConsumes.length === 0) {
    console.log('   Still no CONSUMES edges from this file');
  } else {
    console.log(`   Found ${afterConsumes.length} CONSUMES edges:`);
    for (const c of afterConsumes) {
      console.log(`   - ${c.from_name} -> ${c.to_name} (${c.to_type}) @ ${c.to_file}`);
    }
  }

  // Check specifically for the debug symbol
  if (debugSymbol) {
    console.log('');
    console.log(`Step 6: Checking edges specifically for "${debugSymbol}"...`);
    const symbolEdges = await brain.runQuery(`
      MATCH (a)-[:CONSUMES]->(b {name: $symbolName})
      WHERE a.file = $relativePath AND a.projectId = $projectId
      RETURN a.name as from_name, b.name as to_name, b.file as to_file
    `, { symbolName: debugSymbol, relativePath, projectId: targetProject.id });

    if (symbolEdges.length === 0) {
      console.log(`   No CONSUMES edge to "${debugSymbol}" found`);
    } else {
      for (const e of symbolEdges) {
        console.log(`   ✅ ${e.from_name} -> ${e.to_name} @ ${e.to_file}`);
      }
    }
  }

  await brain.close();
  console.log('');
  console.log('Done!');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
