"use client";

import { useState, useEffect } from "react";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNode[];
}

interface ZipPreviewProps {
  documentId: string;
  isGitHub?: boolean;
}

export function ZipPreview({ documentId, isGitHub }: ZipPreviewProps) {
  const [tree, setTree] = useState<FileNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set([""]));

  useEffect(() => {
    fetch(`/api/preview/tree/${documentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setTree(data.tree);
        // Auto-expand first level
        if (data.tree?.children) {
          setExpandedPaths(new Set(["", ...data.tree.children.slice(0, 5).map((c: FileNode) => c.path)]));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [documentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-400 py-4">
        Error: {error}
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="text-[var(--muted-foreground)] py-4">
        No files to display.
      </div>
    );
  }

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="font-mono text-sm">
      <div className="flex items-center gap-2 mb-4 text-[var(--muted-foreground)]">
        {isGitHub ? <GithubIcon /> : <ArchiveIcon />}
        <span>{tree.name}</span>
      </div>
      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <FileTree
          nodes={tree.children || []}
          expandedPaths={expandedPaths}
          onToggle={toggleExpand}
          depth={0}
        />
      </div>
    </div>
  );
}

function FileTree({
  nodes,
  expandedPaths,
  onToggle,
  depth,
}: {
  nodes: FileNode[];
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
}) {
  // Sort: directories first, then files, alphabetically
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <ul className="divide-y divide-[var(--border)]">
      {sorted.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          depth={depth}
        />
      ))}
    </ul>
  );
}

function FileTreeNode({
  node,
  expandedPaths,
  onToggle,
  depth,
}: {
  node: FileNode;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const hasChildren = node.type === "directory" && node.children && node.children.length > 0;

  return (
    <li>
      <div
        className={`flex items-center gap-2 px-3 py-2 hover:bg-[var(--secondary)] transition-colors ${
          node.type === "directory" ? "cursor-pointer" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => hasChildren && onToggle(node.path)}
      >
        {/* Expand/collapse icon for directories */}
        {node.type === "directory" ? (
          <span className="w-4 text-[var(--muted-foreground)]">
            {hasChildren ? (isExpanded ? "▼" : "▶") : ""}
          </span>
        ) : (
          <span className="w-4" />
        )}

        {/* File/folder icon */}
        <FileIcon filename={node.name} isDirectory={node.type === "directory"} />

        {/* Name */}
        <span className={node.type === "directory" ? "font-medium" : ""}>
          {node.name}
        </span>

        {/* Size for files */}
        {node.type === "file" && node.size !== undefined && (
          <span className="ml-auto text-xs text-[var(--muted-foreground)]">
            {formatSize(node.size)}
          </span>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <FileTree
          nodes={node.children!}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

function FileIcon({ filename, isDirectory }: { filename: string; isDirectory: boolean }) {
  if (isDirectory) {
    return <span className="text-yellow-400">📁</span>;
  }

  const ext = filename.split(".").pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: "📘",
    tsx: "📘",
    js: "📒",
    jsx: "📒",
    json: "📋",
    md: "📝",
    css: "🎨",
    scss: "🎨",
    html: "🌐",
    vue: "💚",
    svelte: "🧡",
    py: "🐍",
    rs: "🦀",
    go: "🔵",
    java: "☕",
    rb: "💎",
    php: "🐘",
    sql: "🗃️",
    yaml: "⚙️",
    yml: "⚙️",
    toml: "⚙️",
    lock: "🔒",
    gitignore: "🙈",
    env: "🔐",
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    gif: "🖼️",
    svg: "🖼️",
    pdf: "📕",
    doc: "📄",
    docx: "📄",
    txt: "📄",
  };

  return <span>{icons[ext || ""] || "📄"}</span>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 8v13H3V8" />
      <path d="M1 3h22v5H1z" />
      <path d="M10 12h4" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}
