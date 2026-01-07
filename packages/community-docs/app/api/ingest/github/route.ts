import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const githubIngestSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  categoryId: z.string().cuid(),
  githubUrl: z
    .string()
    .url()
    .refine(
      (url) => url.includes("github.com"),
      "L'URL doit être un repository GitHub"
    ),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const user = session.user as { id: string; role?: string };

  // Check write permission
  if (user.role === "READ") {
    return NextResponse.json(
      { error: "Permission insuffisante" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { title, description, categoryId, githubUrl } =
      githubIngestSchema.parse(body);

    // Verify category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      return NextResponse.json(
        { error: "Catégorie non trouvée" },
        { status: 404 }
      );
    }

    // Extract repo info from URL
    const urlParts = new URL(githubUrl).pathname.split("/").filter(Boolean);
    const repoOwner = urlParts[0];
    const repoName = urlParts[1]?.replace(".git", "");

    if (!repoOwner || !repoName) {
      return NextResponse.json(
        { error: "URL GitHub invalide" },
        { status: 400 }
      );
    }

    // Generate project ID for Neo4j
    const projectId = `github-${repoOwner}-${repoName}`.toLowerCase();

    // Create document record
    const document = await prisma.document.create({
      data: {
        title,
        description,
        type: "GITHUB_REPO",
        storageType: "GITHUB",
        storageRef: githubUrl,
        virtualPath: `/${category.slug}/${repoOwner}/${repoName}`,
        sourceUrl: githubUrl,
        categoryId,
        uploadedById: user.id,
        projectId,
        status: "PENDING",
      },
    });

    // TODO: Trigger background job for GitHub clone + RagForge ingestion
    // For now, just mark as pending

    return NextResponse.json({
      success: true,
      documentId: document.id,
      projectId,
      message: "Repository ajouté à la file d'ingestion",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Paramètres invalides", details: error.errors },
        { status: 400 }
      );
    }
    console.error("GitHub ingest error:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'ajout du repository" },
      { status: 500 }
    );
  }
}
