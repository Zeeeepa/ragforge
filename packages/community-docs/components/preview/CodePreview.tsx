"use client";

import { useState, useEffect } from "react";
import hljs from "highlight.js/lib/core";
// Import languages we support
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";

// Register languages
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("vue", xml);
hljs.registerLanguage("svelte", xml);
hljs.registerLanguage("css", css);

interface CodePreviewProps {
  documentId: string;
  language?: string;
}

export function CodePreview({ documentId, language = "typescript" }: CodePreviewProps) {
  const [code, setCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedCode, setHighlightedCode] = useState<string>("");

  useEffect(() => {
    fetch(`/api/preview/code/${documentId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCode(data.content);

        // Highlight code
        try {
          const result = hljs.highlight(data.content, { language });
          setHighlightedCode(result.value);
        } catch {
          // Fallback to plain text if highlighting fails
          setHighlightedCode(escapeHtml(data.content));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [documentId, language]);

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

  const lines = code.split("\n");

  return (
    <div className="font-mono text-sm overflow-x-auto">
      <div className="flex">
        {/* Line numbers */}
        <div className="select-none pr-4 text-right text-[var(--muted-foreground)] border-r border-[var(--border)] mr-4">
          {lines.map((_, i) => (
            <div key={i} className="leading-6">
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code with syntax highlighting */}
        <pre className="flex-1 overflow-x-auto">
          <code
            className={`hljs language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightedCode }}
            style={{ background: "transparent" }}
          />
        </pre>
      </div>
      {/* Highlight.js dark theme styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        .hljs {
          color: #c9d1d9;
          background: transparent;
        }
        .hljs-keyword { color: #ff7b72; }
        .hljs-string { color: #a5d6ff; }
        .hljs-number { color: #79c0ff; }
        .hljs-function { color: #d2a8ff; }
        .hljs-title { color: #d2a8ff; }
        .hljs-params { color: #c9d1d9; }
        .hljs-comment { color: #8b949e; font-style: italic; }
        .hljs-built_in { color: #ffa657; }
        .hljs-type { color: #ffa657; }
        .hljs-attr { color: #79c0ff; }
        .hljs-variable { color: #ffa657; }
        .hljs-template-variable { color: #79c0ff; }
        .hljs-selector-class { color: #7ee787; }
        .hljs-selector-tag { color: #7ee787; }
        .hljs-tag { color: #7ee787; }
        .hljs-name { color: #7ee787; }
        .hljs-attribute { color: #79c0ff; }
      ` }} />
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
