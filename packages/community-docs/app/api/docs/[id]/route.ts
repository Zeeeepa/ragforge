import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { unlink } from "fs/promises";
import { join } from "path";
import { getRagForgeClient } from "@/lib/ragforge";

type Role = "READ" | "WRITE" | "ADMIN";

interface ExtendedUser {
  id?: string;
  role?: Role;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

// GET - Get document details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      category: true,
      uploadedBy: {
        select: {
          id: true,
          username: true,
          avatar: true,
        },
      },
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  return NextResponse.json({ document });
}

// PATCH - Update document
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  categoryId: z.string().cuid().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const currentUser = session.user as ExtendedUser;

  // Fetch document to check ownership
  const document = await prisma.document.findUnique({
    where: { id },
    select: { uploadedById: true },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  // Check permission
  const isOwner = currentUser.id === document.uploadedById;
  const isAdmin = currentUser.role === "ADMIN";

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const data = updateSchema.parse(body);

    // If categoryId is provided, verify it exists
    if (data.categoryId) {
      const category = await prisma.category.findUnique({
        where: { id: data.categoryId },
      });
      if (!category) {
        return NextResponse.json(
          { error: "Catégorie non trouvée" },
          { status: 404 }
        );
      }
    }

    const updated = await prisma.document.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.categoryId && { categoryId: data.categoryId }),
      },
    });

    return NextResponse.json({ document: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Paramètres invalides", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Update error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la mise à jour" },
      { status: 500 }
    );
  }
}

// DELETE - Delete document
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const currentUser = session.user as ExtendedUser;

  // Fetch document to check ownership and get file info
  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      uploadedById: true,
      storageType: true,
      storageRef: true,
      projectId: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  // Check permission
  const isOwner = currentUser.id === document.uploadedById;
  const isAdmin = currentUser.role === "ADMIN";

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Permission refusée" }, { status: 403 });
  }

  try {
    // Delete file from storage if local
    if (document.storageType === "LOCAL" && document.storageRef) {
      try {
        const filePath = join(UPLOAD_DIR, document.storageRef);
        await unlink(filePath);
      } catch (err) {
        // File might not exist, continue anyway
        console.warn("Could not delete file:", err);
      }
    }

    // Delete from RagForge brain (async, don't block response)
    const client = getRagForgeClient();
    client.deleteDocument(id).catch((err) => {
      console.warn("Failed to delete from Neo4j:", err);
    });

    // Delete from database
    await prisma.document.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la suppression" },
      { status: 500 }
    );
  }
}
