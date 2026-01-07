/**
 * Test script for Virtual Files support
 *
 * Tests parsing TypeScript from memory (no disk I/O)
 *
 * Usage: npx tsx scripts/test-virtual-files.ts
 */

import { CodeSourceAdapter, type VirtualFile } from "@luciformresearch/ragforge";

async function main() {
  console.log("=== Test Virtual Files ===\n");

  // Create virtual file content
  const tsContent = `
/**
 * User management module
 */
export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export function createUser(name: string, email: string): User {
  return {
    id: crypto.randomUUID(),
    name,
    email,
    createdAt: new Date()
  };
}

export class UserRepository {
  private users: Map<string, User> = new Map();

  save(user: User): void {
    this.users.set(user.id, user);
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  findByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find(u => u.email === email);
  }

  delete(id: string): boolean {
    return this.users.delete(id);
  }
}
`;

  // Create virtual files array
  const virtualFiles: VirtualFile[] = [
    {
      path: "/virtual-project/src/users.ts",
      content: tsContent,
    },
    {
      path: "/virtual-project/src/index.ts",
      content: `
export { User, createUser, UserRepository } from './users';

export function main() {
  const repo = new UserRepository();
  const user = createUser('John', 'john@example.com');
  repo.save(user);
  console.log('User created:', user.id);
}
`,
    },
  ];

  console.log(`Virtual files: ${virtualFiles.length}`);
  virtualFiles.forEach((f) => console.log(`  - ${f.path}`));

  // Create adapter and parse
  const adapter = new CodeSourceAdapter("auto");

  console.log("\nParsing virtual files...");
  const result = await adapter.parse({
    source: {
      type: "virtual",
      virtualFiles,
      root: "/virtual-project",
    },
    projectId: "test-virtual-project",
  });

  console.log("\n=== Parse Results ===");
  console.log(`Files processed: ${result.graph.metadata.filesProcessed}`);
  console.log(`Nodes generated: ${result.graph.metadata.nodesGenerated}`);
  console.log(`Relationships: ${result.graph.metadata.relationshipsGenerated}`);
  console.log(`Parse time: ${result.graph.metadata.parseTimeMs}ms`);

  console.log("\n=== Nodes ===");
  const nodesByLabel: Record<string, number> = {};
  for (const node of result.graph.nodes) {
    const label = node.labels[0];
    nodesByLabel[label] = (nodesByLabel[label] || 0) + 1;
  }
  for (const [label, count] of Object.entries(nodesByLabel)) {
    console.log(`  ${label}: ${count}`);
  }

  // Show some specific nodes
  console.log("\n=== Sample Nodes ===");
  const scopes = result.graph.nodes.filter((n) => n.labels.includes("Scope"));
  for (const scope of scopes.slice(0, 6)) {
    console.log(
      `  - [${scope.properties.type}] ${scope.properties.name} (line ${scope.properties.line})`
    );
  }

  // Show relationships
  console.log("\n=== Relationships ===");
  const relByType: Record<string, number> = {};
  for (const rel of result.graph.relationships) {
    relByType[rel.type] = (relByType[rel.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(relByType)) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\n=== Test completed successfully! ===");
  console.log("✅ Virtual files parsing works without disk I/O");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
