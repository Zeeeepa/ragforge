import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile } from "fs/promises";
import { join } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

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

  try {
    if (document.storageType !== "LOCAL") {
      return NextResponse.json(
        { error: "Type de stockage non supporté pour DOCX" },
        { status: 400 }
      );
    }

    const filePath = join(UPLOAD_DIR, document.storageRef);
    const buffer = await readFile(filePath);

    // Use mammoth for DOCX conversion
    // Note: mammoth needs to be imported dynamically or the package added
    let mammoth;
    try {
      mammoth = await import("mammoth");
    } catch {
      return NextResponse.json(
        { error: "Mammoth.js non disponible - installez le package" },
        { status: 500 }
      );
    }

    const result = await mammoth.convertToHtml({ buffer });
    const html = result.value;
    const messages = result.messages;

    return NextResponse.json({
      html,
      warnings: messages.filter((m: { type: string }) => m.type === "warning"),
    });
  } catch (error) {
    console.error("DOCX preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la conversion du document" },
      { status: 500 }
    );
  }
}
