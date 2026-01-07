"use client";

import { useState, useEffect } from "react";

interface Sheet {
  name: string;
  rows: number;
  columns: number;
  headers?: string[];
  data?: unknown[][];
}

interface SpreadsheetPreviewProps {
  documentId: string;
}

export function SpreadsheetPreview({ documentId }: SpreadsheetPreviewProps) {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/preview/spreadsheet/${documentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSheets(data.sheets || []);
        if (data.sheets?.length > 0) {
          setActiveSheet(data.sheets[0].name);
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
    return <div className="text-red-400 py-4">Error: {error}</div>;
  }

  const currentSheet = sheets.find((s) => s.name === activeSheet);

  return (
    <div>
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-1 mb-4 border-b border-[var(--border)]">
          {sheets.map((sheet) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(sheet.name)}
              className={`px-4 py-2 text-sm transition-colors ${
                activeSheet === sheet.name
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] rounded-t-lg"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {sheet.name}
              <span className="ml-2 text-xs opacity-70">
                ({sheet.rows}×{sheet.columns})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Sheet content */}
      {currentSheet && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[var(--secondary)]">
                <th className="px-3 py-2 text-left text-xs text-[var(--muted-foreground)] border border-[var(--border)] w-10">
                  #
                </th>
                {currentSheet.headers?.map((header, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left font-medium border border-[var(--border)]"
                  >
                    {header || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentSheet.data?.slice(1, 101).map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-[var(--secondary)]/50">
                  <td className="px-3 py-2 text-xs text-[var(--muted-foreground)] border border-[var(--border)]">
                    {rowIndex + 2}
                  </td>
                  {(row as unknown[]).map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="px-3 py-2 border border-[var(--border)] max-w-xs truncate"
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {(currentSheet.data?.length || 0) > 101 && (
            <p className="text-sm text-[var(--muted-foreground)] mt-4 text-center">
              Showing first 100 rows of {currentSheet.rows}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (value instanceof Date) {
    return value.toLocaleDateString("en-US");
  }
  return String(value);
}
