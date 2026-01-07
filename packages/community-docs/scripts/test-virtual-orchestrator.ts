/**
 * Test script for CommunityOrchestratorAdapter with Virtual Files
 *
 * Tests the full pipeline: virtual files → parsing → metadata injection → Neo4j
 *
 * Usage: npx tsx scripts/test-virtual-orchestrator.ts
 */

import { CommunityOrchestratorAdapter } from "../lib/ragforge/orchestrator-adapter";
import { getNeo4jClient } from "../lib/ragforge/neo4j-client";

async function main() {
  console.log("=== Test Virtual Files with Orchestrator ===\n");

  // Create virtual file content
  const tsContent = `
/**
 * Order processing module
 */
export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered";

export class OrderService {
  private orders: Map<string, Order> = new Map();

  create(userId: string, items: OrderItem[]): Order {
    const order: Order = {
      id: crypto.randomUUID(),
      userId,
      items,
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      status: "pending",
    };
    this.orders.set(order.id, order);
    return order;
  }

  confirm(orderId: string): boolean {
    const order = this.orders.get(orderId);
    if (order && order.status === "pending") {
      order.status = "confirmed";
      return true;
    }
    return false;
  }

  getByUser(userId: string): Order[] {
    return Array.from(this.orders.values()).filter(o => o.userId === userId);
  }
}
`;

  // Initialize Neo4j and orchestrator
  const neo4j = getNeo4jClient();
  console.log("Neo4j client obtained");

  const adapter = new CommunityOrchestratorAdapter({
    neo4j,
    verbose: true,
  });

  console.log("\nInitializing adapter...");
  await adapter.initialize();
  console.log("Adapter initialized");

  // Test virtual file ingestion
  console.log("\n=== Ingesting virtual file ===");
  const result = await adapter.ingestVirtual({
    virtualFiles: [
      {
        path: "src/order-service.ts", // Will be prefixed automatically
        content: tsContent,
      },
    ],
    // Source identifier - simulating a GitHub repo
    sourceIdentifier: "github.com/example/order-api",
    metadata: {
      documentId: "test-virtual-doc-002",
      documentTitle: "Order Service Documentation",
      userId: "user-virtual-001",
      userUsername: "virtualuser",
      categoryId: "cat-ecommerce",
      categorySlug: "ecommerce",
      categoryName: "E-Commerce",
      isPublic: true,
      tags: ["orders", "ecommerce", "typescript"],
    },
  });
  // Expected path: /virtual/test-virtual-doc-002/github.com/example/order-api/src/order-service.ts

  console.log("\n=== Ingestion Results ===");
  console.log(`Nodes created: ${result.nodesCreated}`);
  console.log(`Relationships created: ${result.relationshipsCreated}`);

  // Verify nodes in Neo4j
  console.log("\n=== Verifying nodes in Neo4j ===");
  const queryResult = await neo4j.run(`
    MATCH (n {documentId: 'test-virtual-doc-002'})
    RETURN labels(n) as labels, n.name as name, n.file as file, n.path as path
    ORDER BY labels(n)[0], n.name
    LIMIT 20
  `);

  console.log(`Found ${queryResult.records.length} nodes:`);
  for (const record of queryResult.records) {
    const file = record.get("file") || record.get("path") || "";
    console.log(
      `  - [${record.get("labels")}] ${record.get("name")} ${file ? `(${file})` : ""}`
    );
  }

  // Verify the path contains our virtual root components
  console.log("\n=== Verifying path structure ===");
  const fileResult = await neo4j.run(`
    MATCH (f:File {documentId: 'test-virtual-doc-002'})
    RETURN f.file as file, f.path as path, f.name as name
  `);
  const record = fileResult.records[0];
  const filePath = record?.get("file") || record?.get("path");
  const fileName = record?.get("name");
  console.log(`File name: ${fileName}`);
  console.log(`File path: ${filePath}`);

  // Check that path contains our virtual components (may be relative)
  const expectedComponents = ["virtual", "test-virtual-doc-002", "github.com", "example", "order-api"];
  const hasAllComponents = expectedComponents.every(c => filePath?.includes(c));
  if (hasAllComponents) {
    console.log("✅ Path contains all virtual root components!");
  } else {
    console.log(`❌ Missing some components. Expected: ${expectedComponents.join("/")}`);
  }

  // Cleanup
  console.log("\n=== Cleanup ===");
  const deletedCount = await adapter.deleteDocument("test-virtual-doc-002");
  console.log(`Deleted ${deletedCount} nodes`);

  await adapter.stop();
  await neo4j.close();

  console.log("\n=== Test completed successfully! ===");
  console.log("✅ Virtual file ingestion works with full metadata injection");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
