import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile } from "fs/promises";
import { join } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const CODE_TYPES = [
  "TYPESCRIPT",
  "JAVASCRIPT",
  "PYTHON",
  "VUE",
  "SVELTE",
  "HTML",
  "CSS",
];

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
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  if (!CODE_TYPES.includes(document.type)) {
    return NextResponse.json(
      { error: "Ce document n'est pas un fichier de code" },
      { status: 400 }
    );
  }

  try {
    let content: string;

    if (document.storageType === "LOCAL") {
      const filePath = join(UPLOAD_DIR, document.storageRef);
      content = await readFile(filePath, "utf-8");
    } else if (document.storageType === "INLINE") {
      content = document.storageRef;
    } else {
      return NextResponse.json(
        { error: "Type de stockage non supporté" },
        { status: 400 }
      );
    }

    return NextResponse.json({ content });
  } catch (error) {
    console.error("Code preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la lecture du fichier" },
      { status: 500 }
    );
  }
}
