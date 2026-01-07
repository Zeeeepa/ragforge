import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile, stat } from "fs/promises";
import { join, extname } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

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
    select: {
      type: true,
      storageType: true,
      storageRef: true,
      title: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  if (document.type !== "IMAGE") {
    return NextResponse.json(
      { error: "Ce document n'est pas une image" },
      { status: 400 }
    );
  }

  try {
    if (document.storageType !== "LOCAL") {
      return NextResponse.json(
        { error: "Type de stockage non supporté pour les images" },
        { status: 400 }
      );
    }

    const filePath = join(UPLOAD_DIR, document.storageRef);

    // Check file exists
    await stat(filePath);

    const buffer = await readFile(filePath);
    const ext = extname(document.storageRef).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Image preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la lecture de l'image" },
      { status: 500 }
    );
  }
}
