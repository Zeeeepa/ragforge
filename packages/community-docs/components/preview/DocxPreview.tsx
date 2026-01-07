"use client";

import { useState, useEffect } from "react";

interface DocxPreviewProps {
  documentId: string;
}

export function DocxPreview({ documentId }: DocxPreviewProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/preview/docx/${documentId}`)
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
        Error rendering document: {error}
      </div>
    );
  }

  return (
    <div className="bg-white text-black rounded-lg p-8 shadow-lg">
      <article
        className="prose max-w-none
          prose-headings:text-gray-900
          prose-p:text-gray-800
          prose-a:text-blue-600
          prose-strong:text-gray-900
          prose-table:border prose-table:border-gray-300
          prose-th:bg-gray-100 prose-th:p-2
          prose-td:p-2 prose-td:border prose-td:border-gray-200
        "
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
