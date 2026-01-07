"use client";

import { useState } from "react";

interface SearchResult {
  id: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
  file: string;
  line?: number;
  projectId: string;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Search</h1>

      {/* Search form */}
      <form onSubmit={handleSearch} className="mb-8">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in documentation..."
            className="flex-1 px-4 py-3 bg-[var(--input)] border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="px-6 py-3 bg-[var(--primary)] text-[var(--primary-foreground)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isLoading ? "..." : "Search"}
          </button>
        </div>
      </form>

      {/* Results */}
      <div className="space-y-4">
        {results.length === 0 && query && !isLoading && (
          <p className="text-[var(--muted-foreground)] text-center py-8">
            No results found for "{query}"
          </p>
        )}

        {results.map((result) => (
          <div
            key={result.id}
            className="p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg"
          >
            <div className="flex items-start justify-between gap-4 mb-2">
              <h3 className="font-medium">{result.title}</h3>
              <span className="text-xs px-2 py-1 bg-[var(--secondary)] rounded">
                {result.type}
              </span>
            </div>
            <p className="text-sm text-[var(--muted-foreground)] mb-2">
              {result.snippet}
            </p>
            <div className="flex items-center gap-4 text-xs text-[var(--muted-foreground)]">
              <span>{result.file}</span>
              {result.line && <span>Line {result.line}</span>}
              <span>Score: {(result.score * 100).toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
