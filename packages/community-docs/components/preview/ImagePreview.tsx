"use client";

import { useState } from "react";
import Image from "next/image";

interface ImagePreviewProps {
  documentId: string;
  title?: string;
}

export function ImagePreview({ documentId, title }: ImagePreviewProps) {
  const [isZoomed, setIsZoomed] = useState(false);
  const [error, setError] = useState(false);

  const imageUrl = `/api/preview/image/${documentId}`;

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-[var(--muted-foreground)] mb-4">
          Unable to load image.
        </p>
        <a
          href={imageUrl}
          download
          className="text-[var(--primary)] hover:underline"
        >
          Download image
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Image container */}
      <div
        className={`relative cursor-zoom-in ${isZoomed ? "cursor-zoom-out" : ""}`}
        onClick={() => setIsZoomed(!isZoomed)}
      >
        <div className={`transition-all duration-300 ${isZoomed ? "max-w-none" : "max-w-2xl mx-auto"}`}>
          <Image
            src={imageUrl}
            alt={title || "Document image"}
            width={800}
            height={600}
            className="w-full h-auto rounded-lg border border-[var(--border)]"
            style={{ objectFit: "contain" }}
            onError={() => setError(true)}
            unoptimized // Since we're serving from our own API
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex justify-center gap-4 mt-4">
        <button
          onClick={() => setIsZoomed(!isZoomed)}
          className="px-4 py-2 bg-[var(--secondary)] rounded-lg hover:bg-[var(--muted)] transition-colors text-sm"
        >
          {isZoomed ? "Reduce" : "Enlarge"}
        </button>
        <a
          href={imageUrl}
          download
          className="px-4 py-2 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg hover:opacity-90 transition-opacity text-sm"
        >
          Download
        </a>
      </div>

      {/* Zoom overlay */}
      {isZoomed && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center cursor-zoom-out p-4"
          onClick={() => setIsZoomed(false)}
        >
          <Image
            src={imageUrl}
            alt={title || "Document image"}
            width={1920}
            height={1080}
            className="max-w-full max-h-full object-contain"
            unoptimized
          />
        </div>
      )}
    </div>
  );
}
