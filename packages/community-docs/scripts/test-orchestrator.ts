/**
 * Test script for CommunityOrchestratorAdapter
 *
 * Tests the transformGraph hook with a TypeScript file
 *
 * Usage: npx tsx scripts/test-orchestrator.ts
 */

import { CommunityOrchestratorAdapter } from "../lib/ragforge/orchestrator-adapter";
import { getNeo4jClient } from "../lib/ragforge/neo4j-client";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = "/tmp/test-orchestrator";

async function main() {
  console.log("=== Test CommunityOrchestratorAdapter ===\n");

  // Create test directory
  mkdirSync(TEST_DIR, { recursive: true });

  // Create test file
  const testFile = join(TEST_DIR, "test-service.ts");
  writeFileSync(testFile, `
/**
 * Test Service for orchestrator
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): User {
  return {
    id: crypto.randomUUID(),
    name,
    email
  };
}

export class UserService {
  private users: Map<string, User> = new Map();

  add(user: User): void {
    this.users.set(user.id, user);
  }

  get(id: string): User | undefined {
    return this.users.get(id);
  }

  list(): User[] {
    return Array.from(this.users.values());
  }
}
`);
  console.log(`Created test file: ${testFile}`);

  // Initialize orchestrator
  const neo4j = getNeo4jClient();
  console.log("Neo4j client obtained");

  const adapter = new CommunityOrchestratorAdapter({
    neo4j,
    verbose: true,
  });

  console.log("\nInitializing adapter...");
  await adapter.initialize();
  console.log("Adapter initialized");

  // Test ingestion with metadata
  console.log("\nIngesting file with community metadata...");
  const stats = await adapter.ingest({
    files: [{ path: testFile, changeType: "created" }],
    metadata: {
      documentId: "test-doc-001",
      documentTitle: "Test Service Documentation",
      userId: "test-user-001",
      userUsername: "testuser",
      categoryId: "cat-001",
      categorySlug: "typescript",
      categoryName: "TypeScript",
      isPublic: true,
      tags: ["test", "typescript", "service"],
    },
    generateEmbeddings: false,
  });

  console.log("\n=== Ingestion Stats ===");
  console.log(`- Nodes created: ${stats.nodesCreated}`);
  console.log(`- Created: ${stats.created}`);
  console.log(`- Updated: ${stats.updated}`);
  console.log(`- Deleted: ${stats.deleted}`);

  // Verify nodes in Neo4j
  console.log("\n=== Verifying nodes in Neo4j ===");
  const result = await neo4j.run(`
    MATCH (n {documentId: 'test-doc-001'})
    RETURN labels(n) as labels, n.name as name, n.documentTitle as title, n.categorySlug as category, n.tags as tags
    LIMIT 10
  `);

  console.log(`Found ${result.records.length} nodes:`);
  for (const record of result.records) {
    console.log(`  - [${record.get("labels")}] ${record.get("name")} (category: ${record.get("category")}, tags: ${record.get("tags")})`);
  }

  // Cleanup
  console.log("\n=== Cleanup ===");
  const deletedCount = await adapter.deleteDocument("test-doc-001");
  console.log(`Deleted ${deletedCount} nodes`);

  rmSync(TEST_DIR, { recursive: true, force: true });
  console.log("Removed test directory");

  await adapter.stop();
  await neo4j.close();

  console.log("\n=== Test completed successfully! ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
