"use client";

import { useState, useEffect } from "react";
import { GlitchHeading } from "@/components/GlitchText";

interface Category {
  id: string;
  name: string;
  slug: string;
}

export default function UploadPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [uploadType, setUploadType] = useState<"github" | "file">("github");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    // Fetch categories
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => setCategories(data.categories || []))
      .catch(console.error);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatus({ type: null, message: "" });

    try {
      if (uploadType === "github") {
        const res = await fetch("/api/ingest/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            description,
            categoryId,
            githubUrl,
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");

        setStatus({
          type: "success",
          message: `Repository added successfully! ID: ${data.documentId}`,
        });
      } else {
        if (!file) throw new Error("Please select a file");

        const formData = new FormData();
        formData.append("title", title);
        formData.append("description", description);
        formData.append("categoryId", categoryId);
        formData.append("file", file);

        const res = await fetch("/api/ingest/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload failed");

        setStatus({
          type: "success",
          message: `File uploaded successfully! ID: ${data.documentId}`,
        });
      }

      // Reset form
      setTitle("");
      setDescription("");
      setGithubUrl("");
      setFile(null);
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">
          <GlitchHeading as="span" gradient="from-cyan-400 to-purple-500">
            Upload Documentation
          </GlitchHeading>
        </h1>
        <p className="text-slate-400">
          Share your projects and resources with the community
        </p>
      </div>

      {/* Status message */}
      {status.type && (
        <div
          className={`mb-6 p-4 rounded-lg border ${
            status.type === "success"
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >
          <div className="flex items-center gap-2">
            {status.type === "success" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {status.message}
          </div>
        </div>
      )}

      {/* Upload type toggle */}
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => setUploadType("github")}
          className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all duration-300 border ${
            uploadType === "github"
              ? "bg-cyan-400/10 border-cyan-400/50 text-cyan-400 shadow-[0_0_15px_rgba(0,255,255,0.1)]"
              : "bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600"
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub Repository
          </div>
        </button>
        <button
          type="button"
          onClick={() => setUploadType("file")}
          className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all duration-300 border ${
            uploadType === "file"
              ? "bg-purple-400/10 border-purple-400/50 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.1)]"
              : "bg-slate-800/50 border-slate-700 text-slate-400 hover:border-slate-600"
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17,8 12,3 7,8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            File / ZIP
          </div>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-300">Title</label>
          <input
            type="text"
            value={title || ""}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg
              focus:border-cyan-400/50 focus:shadow-[0_0_15px_rgba(0,255,255,0.1)]
              transition-all duration-300 text-white placeholder-slate-500"
            placeholder="Project or documentation name"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-300">
            Description (optional)
          </label>
          <textarea
            value={description || ""}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg
              focus:border-cyan-400/50 focus:shadow-[0_0_15px_rgba(0,255,255,0.1)]
              transition-all duration-300 text-white placeholder-slate-500 resize-none"
            placeholder="Short description..."
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-300">Category</label>
          <select
            value={categoryId || ""}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg
              focus:border-cyan-400/50 focus:shadow-[0_0_15px_rgba(0,255,255,0.1)]
              transition-all duration-300 text-white"
          >
            <option value="" className="bg-slate-900">Select a category</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id} className="bg-slate-900">
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        {/* GitHub URL input - always rendered but hidden */}
        <div style={{ display: uploadType === "github" ? "block" : "none" }}>
          <label className="block text-sm font-medium mb-2 text-slate-300">
            GitHub URL
          </label>
          <input
            type="url"
            value={githubUrl || ""}
            onChange={(e) => setGithubUrl(e.target.value)}
            required={uploadType === "github"}
            className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg
              focus:border-cyan-400/50 focus:shadow-[0_0_15px_rgba(0,255,255,0.1)]
              transition-all duration-300 text-white placeholder-slate-500"
            placeholder="https://github.com/user/repo"
          />
        </div>

        {/* File input - always rendered but hidden */}
        <div style={{ display: uploadType === "file" ? "block" : "none" }}>
          <label className="block text-sm font-medium mb-2 text-slate-300">File</label>
          <div className="relative">
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required={uploadType === "file"}
              accept=".zip,.md,.pdf"
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg
                focus:border-purple-400/50 focus:shadow-[0_0_15px_rgba(168,85,247,0.1)]
                transition-all duration-300 text-white
                file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                file:bg-purple-500/20 file:text-purple-400 file:font-medium
                file:hover:bg-purple-500/30 file:transition-colors file:cursor-pointer"
            />
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Accepted formats: .zip, .md, .pdf
          </p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full px-4 py-4 rounded-lg font-medium transition-all duration-300
            ${uploadType === "github"
              ? "bg-cyan-400/10 border border-cyan-400/50 text-cyan-400 hover:bg-cyan-400/20 hover:shadow-[0_0_30px_rgba(0,255,255,0.2)]"
              : "bg-purple-400/10 border border-purple-400/50 text-purple-400 hover:bg-purple-400/20 hover:shadow-[0_0_30px_rgba(168,85,247,0.2)]"
            }
            disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Uploading...
            </span>
          ) : (
            "Upload"
          )}
        </button>
      </form>
    </div>
  );
}
