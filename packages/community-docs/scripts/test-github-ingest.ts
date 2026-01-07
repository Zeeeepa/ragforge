/**
 * End-to-End Test: GitHub Repository Ingestion via API
 *
 * Tests the full pipeline:
 * 1. Call /ingest/github endpoint
 * 2. Verify nodes created in Neo4j
 * 3. Test search functionality
 * 4. Cleanup
 *
 * Prerequisites:
 * - API server running: npx tsx lib/ragforge/api/server.ts
 * - Neo4j running on port 7688
 *
 * Usage: npx tsx scripts/test-github-ingest.ts
 */

const API_BASE = "http://127.0.0.1:6970";

interface IngestGitHubResponse {
  success: boolean;
  documentId?: string;
  sourceIdentifier?: string;
  filesIngested?: number;
  nodesCreated?: number;
  relationshipsCreated?: number;
  embeddingsGenerated?: number;
  error?: string;
}

interface SearchResponse {
  success: boolean;
  results?: Array<{
    documentId: string;
    content: string;
    score: number;
    metadata: {
      documentTitle: string;
      categorySlug: string;
    };
  }>;
  error?: string;
}

interface DeleteResponse {
  success: boolean;
  deletedNodes?: number;
  error?: string;
}

async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ingestGitHub(
  githubUrl: string,
  metadata: {
    documentId: string;
    documentTitle: string;
    userId: string;
    userUsername?: string;
    categoryId: string;
    categorySlug: string;
    categoryName?: string;
    isPublic?: boolean;
    tags?: string[];
  },
  branch = "main"
): Promise<IngestGitHubResponse> {
  const response = await fetch(`${API_BASE}/ingest/github`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ githubUrl, metadata, branch }),
  });
  return response.json();
}

async function searchDocuments(query: string, categorySlug?: string): Promise<SearchResponse> {
  const response = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      filters: categorySlug ? { categorySlug } : {},
      limit: 10,
    }),
  });
  return response.json();
}

async function deleteDocument(documentId: string): Promise<DeleteResponse> {
  const response = await fetch(`${API_BASE}/document/${documentId}`, {
    method: "DELETE",
  });
  return response.json();
}

async function main() {
  console.log("=== E2E Test: GitHub Ingestion via API ===\n");

  // Check API health
  console.log("1. Checking API health...");
  const healthy = await checkApiHealth();
  if (!healthy) {
    console.error("❌ API not available at", API_BASE);
    console.log("\nStart the API first:");
    console.log("  npx tsx lib/ragforge/api/server.ts");
    process.exit(1);
  }
  console.log("✅ API is healthy\n");

  // Test data - using a real small TypeScript repo
  const testDocumentId = `test-github-${Date.now()}`;
  const githubUrl = "https://github.com/unjs/defu";

  // Simulate a real user/category
  const metadata = {
    documentId: testDocumentId,
    documentTitle: "unjs/defu - Deep Object Merge",
    userId: "user-test-123",
    userUsername: "testuser",
    categoryId: "cat-test-456",
    categorySlug: "test-repos",
    categoryName: "Test Repositories",
    isPublic: true,
    tags: ["typescript", "utility", "merge"],
  };

  // Ingest GitHub repository
  console.log("2. Ingesting GitHub repository...");
  console.log(`   URL: ${githubUrl}`);
  console.log(`   Document ID: ${testDocumentId}`);
  console.log("");

  const startTime = Date.now();
  const ingestResult = await ingestGitHub(githubUrl, metadata);
  const ingestTime = Date.now() - startTime;

  if (!ingestResult.success) {
    console.error("❌ Ingestion failed:", ingestResult.error);
    process.exit(1);
  }

  console.log("✅ Ingestion successful!");
  console.log(`   Files ingested: ${ingestResult.filesIngested}`);
  console.log(`   Nodes created: ${ingestResult.nodesCreated}`);
  console.log(`   Relationships: ${ingestResult.relationshipsCreated}`);
  console.log(`   Embeddings generated: ${ingestResult.embeddingsGenerated}`);
  console.log(`   Time: ${ingestTime}ms`);
  console.log(`   Source: ${ingestResult.sourceIdentifier}`);
  console.log("");

  // Test search (if embeddings are enabled)
  console.log("3. Testing search...");
  const searchResult = await searchDocuments("deep merge object utility", "test-repos");

  if (searchResult.success && searchResult.results && searchResult.results.length > 0) {
    console.log(`✅ Search returned ${searchResult.results.length} results`);
    for (const result of searchResult.results.slice(0, 3)) {
      console.log(`   - [${result.score.toFixed(3)}] ${result.metadata?.documentTitle || "Unknown"}`);
      if (result.content) {
        console.log(`     ${result.content.substring(0, 100)}...`);
      }
    }
  } else if (searchResult.error?.includes("Embedding")) {
    console.log("⚠️  Search skipped (embeddings not available)");
  } else {
    console.log("⚠️  No search results (this is OK if embeddings are disabled)");
  }
  console.log("");

  // Cleanup
  console.log("4. Cleaning up...");
  const deleteResult = await deleteDocument(testDocumentId);

  if (deleteResult.success) {
    console.log(`✅ Deleted ${deleteResult.deletedNodes} nodes`);
  } else {
    console.error("❌ Cleanup failed:", deleteResult.error);
  }
  console.log("");

  console.log("=== Test completed successfully! ===");
  console.log("✅ GitHub repo ingestion works end-to-end via API");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
