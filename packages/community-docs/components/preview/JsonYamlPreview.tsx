"use client";

import { useState, useEffect } from "react";

interface JsonYamlPreviewProps {
  documentId: string;
  format: "json" | "yaml";
}

export function JsonYamlPreview({ documentId, format }: JsonYamlPreviewProps) {
  const [content, setContent] = useState<string>("");
  const [parsed, setParsed] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "raw">("tree");

  useEffect(() => {
    fetch(`/api/preview/data/${documentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setContent(data.content);
        setParsed(data.parsed);
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
    return <div className="text-red-400 py-4">Error: {error}</div>;
  }

  return (
    <div>
      {/* View mode toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setViewMode("tree")}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            viewMode === "tree"
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--secondary)] hover:bg-[var(--muted)]"
          }`}
        >
          Tree
        </button>
        <button
          onClick={() => setViewMode("raw")}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            viewMode === "raw"
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--secondary)] hover:bg-[var(--muted)]"
          }`}
        >
          Raw
        </button>
      </div>

      {viewMode === "tree" ? (
        <div className="font-mono text-sm">
          <JsonTree data={parsed} />
        </div>
      ) : (
        <pre className="font-mono text-sm p-4 bg-[var(--secondary)] rounded-lg overflow-x-auto">
          {content}
        </pre>
      )}
    </div>
  );
}

// Recursive JSON/YAML tree viewer
function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const indent = depth * 16;

  if (data === null) {
    return <span className="text-[var(--muted-foreground)]">null</span>;
  }

  if (data === undefined) {
    return <span className="text-[var(--muted-foreground)]">undefined</span>;
  }

  if (typeof data === "boolean") {
    return <span className="text-orange-400">{data ? "true" : "false"}</span>;
  }

  if (typeof data === "number") {
    return <span className="text-blue-400">{data}</span>;
  }

  if (typeof data === "string") {
    return <span className="text-green-400">"{data}"</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-[var(--muted-foreground)]">[]</span>;
    }

    return (
      <div style={{ paddingLeft: indent }}>
        <span
          onClick={() => setExpanded(!expanded)}
          className="cursor-pointer hover:text-[var(--primary)]"
        >
          {expanded ? "▼" : "▶"} Array ({data.length})
        </span>
        {expanded && (
          <div className="border-l border-[var(--border)] ml-2 pl-2">
            {data.slice(0, 50).map((item, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[var(--muted-foreground)]">{i}:</span>
                <JsonTree data={item} depth={depth + 1} />
              </div>
            ))}
            {data.length > 50 && (
              <div className="text-[var(--muted-foreground)]">
                ... {data.length - 50} more items
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (typeof data === "object") {
    const keys = Object.keys(data as Record<string, unknown>);
    if (keys.length === 0) {
      return <span className="text-[var(--muted-foreground)]">{"{}"}</span>;
    }

    return (
      <div style={{ paddingLeft: indent }}>
        <span
          onClick={() => setExpanded(!expanded)}
          className="cursor-pointer hover:text-[var(--primary)]"
        >
          {expanded ? "▼" : "▶"} Object ({keys.length} keys)
        </span>
        {expanded && (
          <div className="border-l border-[var(--border)] ml-2 pl-2">
            {keys.slice(0, 50).map((key) => (
              <div key={key} className="flex gap-2">
                <span className="text-purple-400">{key}:</span>
                <JsonTree
                  data={(data as Record<string, unknown>)[key]}
                  depth={depth + 1}
                />
              </div>
            ))}
            {keys.length > 50 && (
              <div className="text-[var(--muted-foreground)]">
                ... {keys.length - 50} more keys
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return <span>{String(data)}</span>;
}
