'use client';

import Link from "next/link";
import { useEffect, useState } from "react";

export default function HomePage() {
  const [glitchText, setGlitchText] = useState('Community Docs Hub');

  // Glitch effect on title
  useEffect(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%';
    const originalText = 'Community Docs Hub';
    let interval: NodeJS.Timeout;

    const glitch = () => {
      let iterations = 0;
      interval = setInterval(() => {
        setGlitchText(
          originalText
            .split('')
            .map((char, index) => {
              if (index < iterations || char === ' ') return char;
              return chars[Math.floor(Math.random() * chars.length)];
            })
            .join('')
        );
        iterations += 1 / 3;
        if (iterations >= originalText.length) {
          clearInterval(interval);
          setGlitchText(originalText);
        }
      }, 30);
    };

    glitch();
    const repeatInterval = setInterval(glitch, 8000);

    return () => {
      clearInterval(interval);
      clearInterval(repeatInterval);
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full">
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-slate-950/80 backdrop-blur-md border-b border-cyan-400/10 z-50 flex justify-center">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
        <div className="w-full max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center
              group-hover:shadow-[0_0_15px_rgba(0,255,255,0.5)] transition-all duration-300">
              <span className="text-black font-bold text-sm">CD</span>
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              Community Docs
            </span>
          </Link>
          <Link
            href="/login"
            className="group relative px-6 py-3 bg-transparent border border-cyan-400/50 rounded-lg font-medium
              overflow-hidden transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(0,255,255,0.3)]"
          >
            <span className="relative z-10 text-cyan-400 group-hover:text-white transition-colors">
              Sign In
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 opacity-0
              group-hover:opacity-100 transition-opacity" />
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-16 relative">
        {/* Scanlines overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
          }}
        />

        {/* Logo */}
        <div className="mb-8 relative">
          <div className="w-24 h-24 relative">
            <div className="w-full h-full rounded-2xl bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 flex items-center justify-center
              shadow-[0_0_60px_rgba(0,255,255,0.4)]">
              <span className="text-black font-bold text-4xl">CD</span>
            </div>
            {/* Glow ring */}
            <div className="absolute inset-0 rounded-2xl border-2 border-cyan-400/30 animate-pulse" />
          </div>
        </div>

        {/* Title with glitch */}
        <h1 className="text-5xl md:text-7xl font-bold mb-6 text-center relative">
          <span className="bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 bg-clip-text text-transparent
            drop-shadow-[0_0_30px_rgba(0,255,255,0.5)]">
            {glitchText}
          </span>
        </h1>

        {/* Tagline */}
        <p className="text-xl md:text-2xl text-cyan-100/80 mb-4 text-center font-light tracking-wide">
          Collaborative Documentation
        </p>
        <p className="text-lg text-slate-400 mb-12 max-w-2xl text-center">
          Search through all community documentation with the power of
          AI-driven semantic search.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-wrap gap-4 justify-center mb-16">
          <Link
            href="/login"
            className="group relative px-8 py-4 bg-transparent border border-cyan-400/50 rounded-lg font-medium
              overflow-hidden transition-all duration-300 hover:border-cyan-400 hover:shadow-[0_0_30px_rgba(0,255,255,0.3)]"
          >
            <span className="relative z-10 text-cyan-400 group-hover:text-white transition-colors">
              Get Started
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 opacity-0
              group-hover:opacity-100 transition-opacity" />
          </Link>
          <Link
            href="/browse"
            className="group relative px-8 py-4 bg-transparent border border-purple-400/50 rounded-lg font-medium
              overflow-hidden transition-all duration-300 hover:border-purple-400 hover:shadow-[0_0_30px_rgba(168,85,247,0.3)]"
          >
            <span className="relative z-10 text-purple-400 group-hover:text-white transition-colors">
              Explore
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 opacity-0
              group-hover:opacity-100 transition-opacity" />
          </Link>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-cyan-400/50">
          <span className="text-xs uppercase tracking-widest">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-cyan-400/50 to-transparent animate-pulse" />
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 px-6 w-full flex justify-center">
        <div className="w-full max-w-6xl">
          {/* Section header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-cyan-400/30
              bg-cyan-400/5 text-cyan-400 text-sm mb-4">
              <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
              Features
            </div>
            <h2 className="text-4xl md:text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
                Everything You Need
              </span>
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              A complete platform to share and discover resources
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid md:grid-cols-3 gap-6">
            {/* Search */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/20 to-transparent rounded-2xl
                opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6
                transition-all duration-300 group-hover:border-cyan-400/50 group-hover:shadow-[0_0_30px_rgba(0,255,255,0.1)]">
                <div className="w-12 h-12 rounded-xl bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center mb-4
                  group-hover:border-cyan-400/60 transition-colors">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-cyan-400 transition-colors mb-2">
                  Semantic Search
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Find exactly what you're looking for with AI that understands the context of your queries.
                </p>
              </div>
            </div>

            {/* Upload */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-b from-purple-500/20 to-transparent rounded-2xl
                opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6
                transition-all duration-300 group-hover:border-purple-400/50 group-hover:shadow-[0_0_30px_rgba(168,85,247,0.1)]">
                <div className="w-12 h-12 rounded-xl bg-purple-400/10 border border-purple-400/30 flex items-center justify-center mb-4
                  group-hover:border-purple-400/60 transition-colors">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-400">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17,8 12,3 7,8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-purple-400 transition-colors mb-2">
                  Easy Upload
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Share your GitHub projects, ZIP files, PDFs or Markdown in just a few clicks.
                </p>
              </div>
            </div>

            {/* Preview */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-b from-green-500/20 to-transparent rounded-2xl
                opacity-0 group-hover:opacity-100 transition-opacity blur-xl" />
              <div className="relative bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6
                transition-all duration-300 group-hover:border-green-400/50 group-hover:shadow-[0_0_30px_rgba(0,255,136,0.1)]">
                <div className="w-12 h-12 rounded-xl bg-green-400/10 border border-green-400/30 flex items-center justify-center mb-4
                  group-hover:border-green-400/60 transition-colors">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14,2 14,8 20,8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white group-hover:text-green-400 transition-colors mb-2">
                  Built-in Preview
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  View code, markdown, images, PDFs and even 3D models directly in the browser.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-24 px-6 border-t border-slate-800/50 w-full flex justify-center">
        <div className="w-full max-w-6xl">
          <div className="grid md:grid-cols-4 gap-8 text-center">
            <div className="p-6">
              <div className="text-4xl font-bold text-cyan-400 mb-2">RAG</div>
              <div className="text-slate-400 text-sm">Augmented Retrieval</div>
            </div>
            <div className="p-6">
              <div className="text-4xl font-bold text-purple-400 mb-2">AI</div>
              <div className="text-slate-400 text-sm">Powered by Claude</div>
            </div>
            <div className="p-6">
              <div className="text-4xl font-bold text-green-400 mb-2">VFS</div>
              <div className="text-slate-400 text-sm">Virtual Storage</div>
            </div>
            <div className="p-6">
              <div className="text-4xl font-bold text-pink-400 mb-2">3D</div>
              <div className="text-slate-400 text-sm">Three.js Preview</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/50 py-8 px-6 w-full flex justify-center">
        <div className="w-full max-w-6xl text-center text-slate-500 text-sm">
          Powered by <span className="text-cyan-400">RagForge</span> - Luciform Research
        </div>
      </footer>
    </div>
  );
}
