import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile } from "fs/promises";
import { join } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const DATA_TYPES = ["JSON_FILE", "YAML"];

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

  if (!DATA_TYPES.includes(document.type)) {
    return NextResponse.json(
      { error: "Ce document n'est pas un fichier de données" },
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

    // Try to parse the content
    let parsed: unknown = null;

    if (document.type === "JSON_FILE") {
      try {
        parsed = JSON.parse(content);
      } catch {
        // Return raw content if parsing fails
      }
    } else if (document.type === "YAML") {
      // Simple YAML parsing (basic key-value only)
      // For production, use a proper YAML parser like js-yaml
      try {
        parsed = parseSimpleYaml(content);
      } catch {
        // Return raw content if parsing fails
      }
    }

    return NextResponse.json({ content, parsed });
  } catch (error) {
    console.error("Data preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la lecture du fichier" },
      { status: 500 }
    );
  }
}

// Simple YAML parser for basic structures
// In production, use js-yaml or yaml packages
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");
  const stack: { indent: number; obj: Record<string, unknown> }[] = [
    { indent: -1, obj: result },
  ];

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const match = line.match(/^(\s*)([^:]+):\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const key = match[2].trim();
    let value: unknown = match[3].trim();

    // Pop stack until we find the right parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (value === "") {
      // Nested object
      const newObj: Record<string, unknown> = {};
      parent[key] = newObj;
      stack.push({ indent, obj: newObj });
    } else {
      // Parse value
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (/^-?\d+$/.test(value as string)) value = parseInt(value as string, 10);
      else if (/^-?\d+\.\d+$/.test(value as string)) value = parseFloat(value as string);
      else if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
        value = (value as string).slice(1, -1);
      } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
        value = (value as string).slice(1, -1);
      }

      parent[key] = value;
    }
  }

  return result;
}
