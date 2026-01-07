import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { getRagForgeClient, buildNodeMetadata } from "@/lib/ragforge";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Map file extensions to DocType
type DocType =
  | "GITHUB_REPO"
  | "ZIP_ARCHIVE"
  | "PDF"
  | "DOCX"
  | "XLSX"
  | "CSV"
  | "TYPESCRIPT"
  | "JAVASCRIPT"
  | "PYTHON"
  | "VUE"
  | "SVELTE"
  | "HTML"
  | "CSS"
  | "MARKDOWN"
  | "JSON_FILE"
  | "YAML"
  | "IMAGE"
  | "THREE_D_MODEL";

const EXTENSION_TO_TYPE: Record<string, DocType> = {
  // Archives
  ".zip": "ZIP_ARCHIVE",
  // Documents
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".doc": "DOCX",
  // Spreadsheets
  ".xlsx": "XLSX",
  ".xls": "XLSX",
  ".csv": "CSV",
  // Code files
  ".ts": "TYPESCRIPT",
  ".tsx": "TYPESCRIPT",
  ".js": "JAVASCRIPT",
  ".jsx": "JAVASCRIPT",
  ".py": "PYTHON",
  ".vue": "VUE",
  ".svelte": "SVELTE",
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".scss": "CSS",
  ".sass": "CSS",
  // Data files
  ".md": "MARKDOWN",
  ".markdown": "MARKDOWN",
  ".json": "JSON_FILE",
  ".yaml": "YAML",
  ".yml": "YAML",
  // Images
  ".png": "IMAGE",
  ".jpg": "IMAGE",
  ".jpeg": "IMAGE",
  ".gif": "IMAGE",
  ".webp": "IMAGE",
  ".svg": "IMAGE",
  ".bmp": "IMAGE",
  // 3D Models
  ".glb": "THREE_D_MODEL",
  ".gltf": "THREE_D_MODEL",
  ".obj": "THREE_D_MODEL",
  ".fbx": "THREE_D_MODEL",
};

function getDocTypeFromExtension(ext: string): DocType | null {
  return EXTENSION_TO_TYPE[ext.toLowerCase()] || null;
}

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
    const formData = await request.formData();
    const title = formData.get("title") as string;
    const description = formData.get("description") as string | null;
    const categoryId = formData.get("categoryId") as string;
    const file = formData.get("file") as File | null;

    // Validate inputs
    if (!title || !categoryId || !file) {
      return NextResponse.json(
        { error: "Champs requis manquants" },
        { status: 400 }
      );
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Fichier trop volumineux (max 50MB)" },
        { status: 400 }
      );
    }

    // Get file extension
    const fileExt = "." + file.name.split(".").pop()?.toLowerCase();

    // Map extension to document type
    const extensionToType = getDocTypeFromExtension(fileExt);
    if (!extensionToType) {
      return NextResponse.json(
        { error: `Type de fichier non autorisé: ${fileExt}` },
        { status: 400 }
      );
    }

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

    // Generate unique file reference
    const fileId = randomUUID();
    const fileName = `${fileId}${fileExt}`;

    // Ensure upload directory exists
    await mkdir(UPLOAD_DIR, { recursive: true });

    // Save file to disk
    const filePath = join(UPLOAD_DIR, fileName);
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, fileBuffer);

    // Generate project ID for Neo4j
    const projectId = `upload-${fileId}`;

    // Get user for metadata
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { username: true },
    });

    // Create document record
    const document = await prisma.document.create({
      data: {
        title,
        description,
        type: extensionToType,
        storageType: "LOCAL",
        storageRef: fileName,
        virtualPath: `/${category.slug}/${title.toLowerCase().replace(/\s+/g, "-")}`,
        categoryId,
        uploadedById: user.id,
        projectId,
        status: "PENDING",
      },
      include: {
        category: true,
        uploadedBy: true,
      },
    });

    // Trigger RagForge ingestion (async, don't block response)
    triggerIngestion(document, filePath, fileBuffer).catch((err) => {
      console.error("Ingestion error:", err);
    });

    return NextResponse.json({
      success: true,
      documentId: document.id,
      projectId,
      message: "Fichier uploadé avec succès",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Erreur lors de l'upload" },
      { status: 500 }
    );
  }
}

// Types that can be ingested as text
const TEXT_TYPES: DocType[] = [
  "TYPESCRIPT", "JAVASCRIPT", "PYTHON", "VUE", "SVELTE",
  "HTML", "CSS", "MARKDOWN", "JSON_FILE", "YAML", "CSV",
];

/**
 * Trigger async ingestion to RagForge API
 * For text files, extracts content and sends to API
 * For binary files (PDF, DOCX, etc.), will need parsing (TODO)
 */
async function triggerIngestion(
  document: {
    id: string;
    title: string;
    type: DocType;
    categoryId: string;
    uploadedById: string;
    category: { slug: string; name: string };
    uploadedBy: { username: string };
  },
  filePath: string,
  fileBuffer: Buffer
): Promise<void> {
  const client = getRagForgeClient();

  // Check if API is available
  const healthy = await client.isHealthy();
  if (!healthy) {
    console.warn("RagForge API not available, skipping ingestion");
    await prisma.document.update({
      where: { id: document.id },
      data: { status: "ERROR", errorMessage: "RagForge API unavailable" },
    });
    return;
  }

  // Update status to INGESTING
  await prisma.document.update({
    where: { id: document.id },
    data: { status: "INGESTING" },
  });

  try {
    const metadata = buildNodeMetadata(document);
    let result;

    if (TEXT_TYPES.includes(document.type)) {
      // Text files: read and ingest directly
      const content = fileBuffer.toString("utf-8");
      result = await client.ingestDocument({
        documentId: document.id,
        content,
        metadata,
        generateEmbeddings: true,
      });
    } else {
      // Binary files (PDF, DOCX, images, etc.): placeholder for now
      // TODO: Use RagForge parsers to extract content
      result = await client.ingestDocument({
        documentId: document.id,
        content: `[Document: ${document.title}] (type: ${document.type})`,
        metadata,
        generateEmbeddings: true,
      });
    }

    if (result.success) {
      await prisma.document.update({
        where: { id: document.id },
        data: {
          status: "READY",
          nodeCount: result.nodeCount || 1,
          ingestedAt: new Date(),
        },
      });
    } else {
      await prisma.document.update({
        where: { id: document.id },
        data: { status: "ERROR", errorMessage: result.error },
      });
    }
  } catch (err: any) {
    await prisma.document.update({
      where: { id: document.id },
      data: { status: "ERROR", errorMessage: err.message },
    });
  }
}
