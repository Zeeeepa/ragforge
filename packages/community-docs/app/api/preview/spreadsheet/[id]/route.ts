import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFile } from "fs/promises";
import { join } from "path";
import * as XLSX from "xlsx";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const SPREADSHEET_TYPES = ["XLSX", "CSV"];

interface SheetData {
  name: string;
  rows: number;
  columns: number;
  headers?: string[];
  data?: unknown[][];
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
    },
  });

  if (!document) {
    return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });
  }

  if (!SPREADSHEET_TYPES.includes(document.type)) {
    return NextResponse.json(
      { error: "Ce document n'est pas un fichier tableur" },
      { status: 400 }
    );
  }

  try {
    let buffer: Buffer;

    if (document.storageType === "LOCAL") {
      const filePath = join(UPLOAD_DIR, document.storageRef);
      buffer = await readFile(filePath);
    } else {
      return NextResponse.json(
        { error: "Type de stockage non supporté pour les tableurs" },
        { status: 400 }
      );
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheets: SheetData[] = [];

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

      const rows = jsonData.length;
      const columns = rows > 0 ? Math.max(...jsonData.map(row => (row as unknown[]).length)) : 0;

      // Get headers from first row
      const headers = rows > 0 ? (jsonData[0] as unknown[]).map(h => String(h || "")) : [];

      sheets.push({
        name: sheetName,
        rows,
        columns,
        headers,
        data: jsonData.slice(0, 101), // Limit to 100 rows + header
      });
    }

    return NextResponse.json({ sheets });
  } catch (error) {
    console.error("Spreadsheet preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la lecture du tableur" },
      { status: 500 }
    );
  }
}
