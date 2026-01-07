import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile, stat } from "fs/promises";
import { join, extname } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const MIME_TYPES: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "text/plain",
  ".fbx": "application/octet-stream",
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
  const { searchParams } = new URL(request.url);
  const download = searchParams.get("download") === "true";

  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      type: true,
      title: true,
      storageType: true,
      storageRef: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  if (document.type !== "THREE_D_MODEL") {
    return NextResponse.json(
      { error: "Ce document n'est pas un modèle 3D" },
      { status: 400 }
    );
  }

  try {
    if (document.storageType !== "LOCAL") {
      return NextResponse.json(
        { error: "Type de stockage non supporté pour les modèles 3D" },
        { status: 400 }
      );
    }

    const filePath = join(UPLOAD_DIR, document.storageRef);

    // Check file exists
    await stat(filePath);

    const buffer = await readFile(filePath);
    const ext = extname(document.storageRef).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    const headers: HeadersInit = {
      "Content-Type": contentType,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    // Add download header if requested
    if (download) {
      const fileName = document.title
        ? `${document.title}${ext}`
        : document.storageRef.split("/").pop() || "model.glb";
      headers["Content-Disposition"] = `attachment; filename="${fileName}"`;
    }

    return new NextResponse(buffer, { headers });
  } catch (error) {
    console.error("3D model preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la lecture du modèle 3D" },
      { status: 500 }
    );
  }
}
