"use client";

import { useState } from "react";

interface PdfPreviewProps {
  documentId: string;
}

export function PdfPreview({ documentId }: PdfPreviewProps) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-[var(--muted-foreground)] mb-4">
          Unable to display PDF in browser.
        </p>
        <a
          href={`/api/preview/pdf/${documentId}`}
          download
          className="px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg hover:opacity-90"
        >
          Download PDF
        </a>
      </div>
    );
  }

  return (
    <div className="w-full">
      <iframe
        src={`/api/preview/pdf/${documentId}`}
        className="w-full h-[600px] rounded-lg border border-[var(--border)]"
        onError={() => setError(true)}
        title="PDF Preview"
      />
      <div className="mt-4 text-center">
        <a
          href={`/api/preview/pdf/${documentId}`}
          download
          className="text-[var(--primary)] hover:underline"
        >
          Download PDF
        </a>
      </div>
    </div>
  );
}
