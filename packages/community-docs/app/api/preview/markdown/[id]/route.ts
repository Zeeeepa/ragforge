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

  if (document.type !== "MARKDOWN") {
    return NextResponse.json(
      { error: "Ce document n'est pas un fichier Markdown" },
      { status: 400 }
    );
  }

  try {
    let markdown: string;

    if (document.storageType === "LOCAL") {
      const filePath = join(UPLOAD_DIR, document.storageRef);
      markdown = await readFile(filePath, "utf-8");
    } else if (document.storageType === "INLINE") {
      markdown = document.storageRef; // Content stored directly
    } else {
      return NextResponse.json(
        { error: "Type de stockage non supporté" },
        { status: 400 }
      );
    }

    // Simple markdown to HTML conversion
    // In production, use a proper markdown parser like marked or remark
    const html = simpleMarkdownToHtml(markdown);

    return NextResponse.json({ html, raw: markdown });
  } catch (error) {
    console.error("Markdown preview error:", error);
    return NextResponse.json(
      { error: "Erreur lors de la lecture du fichier" },
      { status: 500 }
    );
  }
}

function simpleMarkdownToHtml(markdown: string): string {
  let html = markdown
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headers
    .replace(/^######\s+(.*)$/gm, "<h6>$1</h6>")
    .replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>")
    .replace(/^####\s+(.*)$/gm, "<h4>$1</h4>")
    .replace(/^###\s+(.*)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.*)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.*)$/gm, "<h1>$1</h1>")
    // Bold and italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    // Blockquotes
    .replace(/^>\s+(.*)$/gm, "<blockquote>$1</blockquote>")
    // Horizontal rules
    .replace(/^---$/gm, "<hr />")
    // Unordered lists
    .replace(/^\s*[-*]\s+(.*)$/gm, "<li>$1</li>")
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br />");

  // Wrap in paragraphs
  html = "<p>" + html + "</p>";

  // Fix nested blockquotes
  html = html.replace(/<\/blockquote><br \/><blockquote>/g, "<br />");

  // Wrap lists (using [\s\S]* instead of 's' flag for compatibility)
  html = html.replace(/(<li>[\s\S]*<\/li>)/, "<ul>$1</ul>");

  return html;
}
