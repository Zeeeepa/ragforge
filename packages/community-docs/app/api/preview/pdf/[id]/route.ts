import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile, stat } from "fs/promises";
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
      title: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  if (document.type !== "PDF") {
    return NextResponse.json(
      { error: "Ce document n'est pas un PDF" },
      { status: 400 }
    );
  }

  try {
    if (document.storageType !== "LOCAL") {
      return NextResponse.json(
        { error: "Type de stockage non supporté pour PDF" },
        { status: 400 }
      );
    }

    const filePath = join(UPLOAD_DIR, document.storageRef);
    const fileBuffer = await readFile(filePath);
    const fileStat = await stat(filePath);

    // Return the PDF file directly
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": fileStat.size.toString(),
        "Content-Disposition": `inline; filename="${encodeURIComponent(document.title)}.pdf"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("PDF preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la lecture du PDF" },
      { status: 500 }
    );
  }
}
