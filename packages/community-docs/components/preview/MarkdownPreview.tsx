"use client";

import { useState, useEffect } from "react";

interface MarkdownPreviewProps {
  documentId: string;
}

export function MarkdownPreview({ documentId }: MarkdownPreviewProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/preview/markdown/${documentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setHtml(data.html);
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

  return (
    <article
      className="prose prose-invert max-w-none
        prose-headings:text-[var(--foreground)]
        prose-p:text-[var(--foreground)]
        prose-a:text-[var(--primary)]
        prose-strong:text-[var(--foreground)]
        prose-code:text-[var(--primary)] prose-code:bg-[var(--secondary)] prose-code:px-1 prose-code:rounded
        prose-pre:bg-[var(--secondary)] prose-pre:border prose-pre:border-[var(--border)]
        prose-blockquote:border-l-[var(--primary)]
        prose-li:text-[var(--foreground)]
        prose-img:rounded-lg
      "
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
