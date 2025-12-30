#!/usr/bin/env npx tsx
/**
 * Migration Script: Add missing cross-file CONSUMES relationships
 *
 * This script re-parses all projects and adds missing CONSUMES relationships
 * for cross-file imports (imports via barrel files, etc.) WITHOUT modifying
 * the nodes themselves, so embeddings are preserved.
 *
 * Usage:
 *   npx tsx scripts/migrate-cross-file-consumes.ts [--dry-run] [--project <id>]
 *
 * Options:
 *   --dry-run     Show what would be done without making changes
 *   --project     Only process a specific project ID
 *   --verbose     Show detailed progress
 */

import { ensureDaemonRunning, callToolViaDaemon } from '../packages/core/dist/esm/daemon/daemon-client.js';
import { CodeSourceAdapter } from '../packages/core/dist/esm/runtime/adapters/code-source-adapter.js';

interface MigrationStats {
  projectsProcessed: number;
  relationshipsCreated: number;
  relationshipsSkipped: number;
  errors: string[];
}

async function runCypher(query: string, params: Record<string, any> = {}): Promise<any[]> {
  const result = await callToolViaDaemon('run_cypher', { query, params }, { ensureRunning: false });
  if (!result.success) {
    throw new Error(result.error || 'Cypher query failed');
  }
  return result.result || [];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');
  const projectIdArg = args.includes('--project')
    ? args[args.indexOf('--project') + 1]
    : null;

  console.log('🔄 Cross-file CONSUMES Migration Script');
  console.log('========================================');
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - no changes will be made\n');
  }

  // Ensure daemon is running (starts Neo4j if needed)
  console.log('⏳ Ensuring daemon is running...');
  const daemonReady = await ensureDaemonRunning(verbose);
  if (!daemonReady) {
    console.error('❌ Failed to start daemon. Make sure ragforge is properly installed.');
    process.exit(1);
  }
  console.log('✓ Daemon ready\n');

  const stats: MigrationStats = {
    projectsProcessed: 0,
    relationshipsCreated: 0,
    relationshipsSkipped: 0,
    errors: []
  };

  try {
    // Get all projects via daemon
    const projectsResult = await callToolViaDaemon('list_brain_projects', {}, { ensureRunning: false });
    if (!projectsResult.success) {
      console.error('❌ Failed to list projects:', projectsResult.error);
      process.exit(1);
    }

    const projects = projectsResult.result || [];

    if (projects.length === 0) {
      console.log('No projects found in database.');
      return;
    }

    console.log(`Found ${projects.length} project(s)\n`);

    // Filter to specific project if requested
    const projectsToProcess = projectIdArg
      ? projects.filter((p: any) => p.id === projectIdArg)
      : projects;

    if (projectIdArg && projectsToProcess.length === 0) {
      console.error(`Project not found: ${projectIdArg}`);
      process.exit(1);
    }

    for (const project of projectsToProcess) {
      console.log(`\n📁 Processing project: ${project.name}`);
      console.log(`   Root: ${project.root}`);
      console.log(`   ID: ${project.id}`);

      try {
        await migrateProject(project, stats, { dryRun, verbose });
        stats.projectsProcessed++;
      } catch (error: any) {
        const errorMsg = `Error processing ${project.name}: ${error.message}`;
        console.error(`   ❌ ${errorMsg}`);
        stats.errors.push(errorMsg);
      }
    }

    // Print summary
    console.log('\n========================================');
    console.log('📊 Migration Summary');
    console.log('========================================');
    console.log(`Projects processed: ${stats.projectsProcessed}`);
    console.log(`Relationships created: ${stats.relationshipsCreated}`);
    console.log(`Relationships skipped (already exist): ${stats.relationshipsSkipped}`);
    if (stats.errors.length > 0) {
      console.log(`Errors: ${stats.errors.length}`);
      for (const err of stats.errors) {
        console.log(`  - ${err}`);
      }
    }

    if (dryRun) {
      console.log('\n⚠️  This was a dry run. Run without --dry-run to apply changes.');
    }

  } catch (error: any) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

async function migrateProject(
  project: { id: string; name: string; root: string },
  stats: MigrationStats,
  options: { dryRun: boolean; verbose: boolean }
): Promise<void> {
  const { dryRun, verbose } = options;

  // Step 1: Get existing scope UUIDs from database
  console.log('   Loading existing scopes from database...');
  const existingScopes = await runCypher(`
    MATCH (s:Scope)
    WHERE s.projectId = $projectId
    RETURN s.uuid AS uuid, s.name AS name, s.file AS file, s.type AS type
  `, { projectId: project.id });

  const existingUUIDMapping = new Map<string, Array<{ uuid: string; file: string; type: string }>>();
  for (const record of existingScopes) {
    const name = record.name;
    const entry = {
      uuid: record.uuid,
      file: record.file,
      type: record.type
    };
    const existing = existingUUIDMapping.get(name) || [];
    existing.push(entry);
    existingUUIDMapping.set(name, existing);
  }
  console.log(`   Found ${existingUUIDMapping.size} unique symbols in database`);

  // Step 2: Parse all project files
  console.log('   Parsing project files...');
  const adapter = new CodeSourceAdapter('auto');

  const parseResult = await adapter.parse({
    source: {
      type: 'code',
      root: project.root,
      adapter: 'auto'
    },
    projectId: project.id,
    existingUUIDMapping
  });

  // Step 3: Extract cross-file CONSUMES relationships
  const nodeIds = new Set(parseResult.graph.nodes.map(n => n.id));
  const crossFileConsumes = parseResult.graph.relationships.filter(rel =>
    rel.type === 'CONSUMES' && !nodeIds.has(rel.to)
  );

  console.log(`   Found ${crossFileConsumes.length} cross-file CONSUMES relationships`);

  if (crossFileConsumes.length === 0) {
    console.log('   ✅ No cross-file relationships to add');
    return;
  }

  // Step 4: Check which relationships already exist
  console.log('   Checking for existing relationships...');
  const fromUuids = [...new Set(crossFileConsumes.map(r => r.from))];
  const toUuids = [...new Set(crossFileConsumes.map(r => r.to))];

  const existingRels = await runCypher(`
    MATCH (a)-[r:CONSUMES]->(b)
    WHERE a.uuid IN $fromUuids AND b.uuid IN $toUuids
    RETURN a.uuid AS fromUuid, b.uuid AS toUuid
  `, { fromUuids, toUuids });

  const existingRelSet = new Set(existingRels.map((r: any) => `${r.fromUuid}|${r.toUuid}`));

  // Filter to only new relationships
  const newRelationships = crossFileConsumes.filter(rel =>
    !existingRelSet.has(`${rel.from}|${rel.to}`)
  );

  const skipped = crossFileConsumes.length - newRelationships.length;
  stats.relationshipsSkipped += skipped;

  if (verbose && skipped > 0) {
    console.log(`   Skipping ${skipped} relationships that already exist`);
  }

  if (newRelationships.length === 0) {
    console.log('   ✅ All relationships already exist');
    return;
  }

  console.log(`   Adding ${newRelationships.length} new relationships...`);

  if (dryRun) {
    if (verbose) {
      for (const rel of newRelationships.slice(0, 10)) {
        const fromNode = parseResult.graph.nodes.find(n => n.id === rel.from);
        console.log(`     ${fromNode?.properties?.name || rel.from} -> ${rel.to}`);
      }
      if (newRelationships.length > 10) {
        console.log(`     ... and ${newRelationships.length - 10} more`);
      }
    }
    stats.relationshipsCreated += newRelationships.length;
    return;
  }

  // Step 5: Insert relationships directly via Cypher (without touching nodes)
  const batchSize = 500;
  let created = 0;

  for (let i = 0; i < newRelationships.length; i += batchSize) {
    const batch = newRelationships.slice(i, i + batchSize).map(rel => ({
      from: rel.from,
      to: rel.to,
      props: rel.properties || {}
    }));

    // Use unlabeled MATCH since we don't know the target's label
    await runCypher(`
      UNWIND $rels AS relData
      MATCH (from {uuid: relData.from})
      MATCH (to {uuid: relData.to})
      MERGE (from)-[r:CONSUMES]->(to)
      SET r += relData.props
    `, { rels: batch });

    created += batch.length;
    if (verbose) {
      console.log(`     Created ${created}/${newRelationships.length} relationships`);
    }
  }

  stats.relationshipsCreated += created;
  console.log(`   ✅ Created ${created} cross-file CONSUMES relationships`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
