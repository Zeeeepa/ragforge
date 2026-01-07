import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readdir, stat } from "fs/promises";
import { join, relative } from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNode[];
}

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
      projectId: true,
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  try {
    let tree: FileNode;

    if (document.type === "GITHUB_REPO") {
      // For GitHub repos, try to get tree from RagForge brain
      // TODO: Query Neo4j for file structure
      tree = {
        name: document.title,
        path: "",
        type: "directory",
        children: [
          {
            name: "Loading from RagForge...",
            path: "placeholder",
            type: "file",
          },
        ],
      };
    } else if (document.storageType === "LOCAL") {
      // For local ZIP files, read extracted directory or use placeholder
      const extractedPath = join(UPLOAD_DIR, "extracted", document.storageRef.replace(/\.[^.]+$/, ""));

      try {
        tree = await buildFileTree(extractedPath, document.title);
      } catch {
        // If not extracted, show placeholder
        tree = {
          name: document.title,
          path: "",
          type: "directory",
          children: [
            {
              name: "(Archive non extraite - contenu en cours d'indexation)",
              path: "placeholder",
              type: "file",
            },
          ],
        };
      }
    } else {
      tree = {
        name: document.title,
        path: "",
        type: "directory",
        children: [],
      };
    }

    return NextResponse.json({ tree });
  } catch (error) {
    console.error("Tree error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la génération de l'arborescence" },
      { status: 500 }
    );
  }
}

async function buildFileTree(dirPath: string, name: string): Promise<FileNode> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const children: FileNode[] = [];

  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    const relativePath = relative(dirPath, entryPath);

    if (entry.isDirectory()) {
      // Skip common ignored directories
      if (["node_modules", ".git", "__pycache__", ".next", "dist"].includes(entry.name)) {
        children.push({
          name: entry.name,
          path: relativePath,
          type: "directory",
          children: [
            { name: "(contenu ignoré)", path: `${relativePath}/ignored`, type: "file" },
          ],
        });
        continue;
      }

      const subTree = await buildFileTree(entryPath, entry.name);
      children.push({
        ...subTree,
        path: relativePath,
      });
    } else {
      const fileStat = await stat(entryPath);
      children.push({
        name: entry.name,
        path: relativePath,
        type: "file",
        size: fileStat.size,
      });
    }
  }

  return {
    name,
    path: "",
    type: "directory",
    children,
  };
}
