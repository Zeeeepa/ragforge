import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { getRagForgeClient } from "@/lib/ragforge";

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  filters: z
    .object({
      categoryId: z.string().optional(),
      categorySlug: z.string().optional(),
      userId: z.string().optional(),
      documentId: z.string().optional(),
    })
    .optional(),
  limit: z.number().min(1).max(100).default(20),
  minScore: z.number().min(0).max(1).default(0.3),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { query, filters, limit, minScore } = searchSchema.parse(body);

    const client = getRagForgeClient();

    // Check if API is available
    const healthy = await client.isHealthy();
    if (!healthy) {
      return NextResponse.json(
        { error: "Service de recherche indisponible" },
        { status: 503 }
      );
    }

    // Call RagForge API
    const response = await client.search({
      query,
      filters: filters || {},
      limit,
      minScore,
    });

    if (!response.success) {
      return NextResponse.json(
        { error: response.error || "Erreur de recherche" },
        { status: 500 }
      );
    }

    // Transform results for frontend
    const results = response.results.map((r) => ({
      documentId: r.documentId,
      chunkId: r.chunkId,
      title: r.metadata.documentTitle,
      categorySlug: r.metadata.categorySlug,
      snippet: r.content.length > 300 ? r.content.slice(0, 300) + "..." : r.content,
      score: r.score,
    }));

    return NextResponse.json({
      results,
      total: results.length,
      query,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Paramètres invalides", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la recherche" },
      { status: 500 }
    );
  }
}
