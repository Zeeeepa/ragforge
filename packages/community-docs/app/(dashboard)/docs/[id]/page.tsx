import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ZipPreview } from "@/components/preview/ZipPreview";
import { MarkdownPreview } from "@/components/preview/MarkdownPreview";
import { DocxPreview } from "@/components/preview/DocxPreview";
import { PdfPreview } from "@/components/preview/PdfPreview";
import { CodePreview } from "@/components/preview/CodePreview";
import { SpreadsheetPreview } from "@/components/preview/SpreadsheetPreview";
import { ImagePreview } from "@/components/preview/ImagePreview";
import { JsonYamlPreview } from "@/components/preview/JsonYamlPreview";
import { ThreeDPreview } from "@/components/preview/ThreeDPreview";
import { DeleteDocumentButton } from "@/components/preview/DeleteDocumentButton";

type Role = "READ" | "WRITE" | "ADMIN";

interface ExtendedUser {
  id?: string;
  role?: Role;
  username?: string;
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const currentUser = session?.user as ExtendedUser | undefined;

  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      category: true,
      uploadedBy: {
        select: {
          id: true,
          username: true,
          avatar: true,
        },
      },
    },
  });

  if (!document) {
    notFound();
  }

  const isOwner = currentUser?.id === document.uploadedBy.id;
  const isAdmin = currentUser?.role === "ADMIN";
  const canEdit = isOwner || isAdmin;

  // Format date
  const uploadDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(document.createdAt);

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-[var(--muted-foreground)] mb-6">
        <Link href="/browse" className="hover:text-[var(--foreground)]">
          Browse
        </Link>
        {" / "}
        <Link
          href={`/browse/${document.category.slug}`}
          className="hover:text-[var(--foreground)]"
        >
          {document.category.name}
        </Link>
        {" / "}
        <span className="text-[var(--foreground)]">{document.title}</span>
      </nav>

      {/* Header */}
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">{document.title}</h1>
            {document.description && (
              <p className="text-[var(--muted-foreground)] text-lg">
                {document.description}
              </p>
            )}
          </div>

          {/* Actions for owner/admin */}
          {canEdit && (
            <div className="flex gap-2">
              <Link
                href={`/docs/${document.id}/edit`}
                className="px-4 py-2 bg-[var(--secondary)] rounded-lg hover:bg-[var(--muted)] transition-colors"
              >
                Edit
              </Link>
              <DeleteDocumentButton documentId={document.id} />
            </div>
          )}
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-4 text-sm text-[var(--muted-foreground)]">
          {/* Author */}
          <div className="flex items-center gap-2">
            {document.uploadedBy.avatar && (
              <Image
                src={document.uploadedBy.avatar}
                alt={document.uploadedBy.username}
                width={24}
                height={24}
                className="rounded-full"
              />
            )}
            <span>By {document.uploadedBy.username}</span>
          </div>

          <span>•</span>

          {/* Date */}
          <span>{uploadDate}</span>

          <span>•</span>

          {/* Type badge */}
          <span className="px-2 py-0.5 bg-[var(--secondary)] rounded text-xs">
            {document.type.replace("_", " ")}
          </span>

          {/* Status badge */}
          <span
            className={`px-2 py-0.5 rounded text-xs ${
              document.status === "READY"
                ? "bg-green-500/20 text-green-400"
                : document.status === "ERROR"
                  ? "bg-red-500/20 text-red-400"
                  : "bg-yellow-500/20 text-yellow-400"
            }`}
          >
            {document.status}
          </span>

          {document.nodeCount > 0 && (
            <>
              <span>•</span>
              <span>{document.nodeCount} indexed nodes</span>
            </>
          )}
        </div>

        {/* Source URL if GitHub */}
        {document.sourceUrl && (
          <a
            href={document.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mt-4 text-[var(--primary)] hover:underline"
          >
            <GithubIcon />
            View on GitHub
          </a>
        )}
      </header>

      {/* Content preview */}
      <section className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="border-b border-[var(--border)] px-4 py-3 bg-[var(--secondary)]">
          <h2 className="font-medium">Content</h2>
        </div>
        <div className="p-4">
          <DocumentPreview
            document={{
              id: document.id,
              type: document.type,
              title: document.title,
              storageType: document.storageType,
              storageRef: document.storageRef,
            }}
          />
        </div>
      </section>

      {/* Search within this document */}
      {document.status === "READY" && (
        <section className="mt-8">
          <h2 className="text-xl font-semibold mb-4">
            Search in this document
          </h2>
          <form action="/search" method="get" className="flex gap-2">
            <input type="hidden" name="project" value={document.projectId} />
            <input
              type="text"
              name="q"
              placeholder="Search..."
              className="flex-1 px-4 py-2 bg-[var(--input)] border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg hover:opacity-90"
            >
              Search
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

// Map DocType to highlight.js language
const LANGUAGE_MAP: Record<string, string> = {
  TYPESCRIPT: "typescript",
  JAVASCRIPT: "javascript",
  PYTHON: "python",
  VUE: "vue",
  SVELTE: "svelte",
  HTML: "html",
  CSS: "css",
};

// Document preview component based on type
function DocumentPreview({
  document,
}: {
  document: {
    id: string;
    type: string;
    title?: string;
    storageType: string;
    storageRef: string;
  };
}) {
  switch (document.type) {
    // Archives & Repositories
    case "ZIP_ARCHIVE":
      return <ZipPreview documentId={document.id} />;
    case "GITHUB_REPO":
      return <ZipPreview documentId={document.id} isGitHub />;

    // Documents
    case "MARKDOWN":
      return <MarkdownPreview documentId={document.id} />;
    case "PDF":
      return <PdfPreview documentId={document.id} />;
    case "DOCX":
      return <DocxPreview documentId={document.id} />;

    // Spreadsheets
    case "XLSX":
    case "CSV":
      return <SpreadsheetPreview documentId={document.id} />;

    // Code files
    case "TYPESCRIPT":
    case "JAVASCRIPT":
    case "PYTHON":
    case "VUE":
    case "SVELTE":
    case "HTML":
    case "CSS":
      return (
        <CodePreview
          documentId={document.id}
          language={LANGUAGE_MAP[document.type] || "typescript"}
        />
      );

    // Data files
    case "JSON_FILE":
      return <JsonYamlPreview documentId={document.id} format="json" />;
    case "YAML":
      return <JsonYamlPreview documentId={document.id} format="yaml" />;

    // Images
    case "IMAGE":
      return <ImagePreview documentId={document.id} title={document.title} />;

    // 3D Models
    case "THREE_D_MODEL":
      return <ThreeDPreview documentId={document.id} />;

    default:
      return (
        <p className="text-[var(--muted-foreground)]">
          Preview not available for this document type ({document.type}).
        </p>
      );
  }
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
