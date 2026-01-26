'use client';

import React from 'react';
import Link from 'next/link';
import { CodeBlock } from '../components/CodeBlock';
import { GlitchText } from '../components/GlitchText';

// Code snippets
const brainSearchCode = `// Hybrid search combining vector similarity + BM25 keyword matching
const results = await brain.search({
  query: "authentication middleware",
  semantic: true,           // Use embeddings for meaning
  embedding_type: "all",    // Search name, content, description
  boost_keywords: ["AuthService", "validateToken"],
  explore_depth: 2,         // Follow relationships
  summarize: true           // LLM-powered result synthesis
});`;

const researchAgentCode = `// Agent with tool access and iterative reasoning
const agent = new ResearchAgent({
  tools: [brainSearch, readFile, grepFiles, fetchWeb],
  maxIterations: 15,
  summarizeToolContext: true,  // Compress large results
  onToolCall: (name, args) => console.log(\`Using \${name}\`)
});

const report = await agent.research(
  "How does the auth system handle JWT refresh?"
);
// Returns: { report, confidence, sourcesUsed, toolCallDetails }`;

const structuredLLMCode = `// Type-safe LLM calls with Zod schema validation
const executor = new StructuredLLMExecutor({ model: "gemini-2.0-flash" });

const analysis = await executor.execute({
  prompt: "Analyze this function for bugs",
  context: sourceCode,
  outputSchema: z.object({
    bugs: z.array(z.object({
      severity: z.enum(["low", "medium", "high"]),
      line: z.number(),
      description: z.string()
    })),
    suggestions: z.array(z.string())
  })
});
// Returns typed object matching schema`;

const incrementalIngestionCode = `// Pre-parsing hash check skips unchanged files entirely
const { changedFiles, unchangedFiles, newHashes } =
  await ingestion.filterChangedFiles(config, projectId);

// Only parse files that actually changed
if (changedFiles.length === 0) {
  console.log("All files unchanged - skipping parsing entirely!");
  return { unchanged: unchangedFiles.size, updated: 0, created: 0 };
}

// Delete nodes for changed files, then re-ingest
await ingestion.deleteNodesForFiles(changedFiles);
const stats = await ingestion.ingestIncremental(graph, { projectId });

// Update hashes AFTER successful ingestion (atomicity)
await ingestion.updateFileHashes(newHashes, projectId);`;

const batchEmbeddingsCode = `// Multi-embedding generation with batch processing
const result = await embeddingService.generateMultiEmbeddings({
  projectId,
  incrementalOnly: true,      // Only dirty nodes
  embeddingTypes: ["name", "content", "description"],
  batchSize: 50               // Neo4j batch updates
});

// Returns: { totalNodes, embeddedByType, skippedCount, durationMs }
// Each node gets 3 embeddings for different search strategies:
//   embedding_name    → search by function signatures
//   embedding_content → search by actual source code
//   embedding_description → search by docstrings`;

const researchReportCode = `# ResearchAgent Class Purpose

## Summary
The \`ResearchAgent\` class is designed for information gathering
within a codebase. It leverages LLMs and tools to search the
knowledge base, read files, and generate comprehensive reports.

\`\`\`typescript
// /packages/core/src/runtime/agents/research-agent.ts:661
export class ResearchAgent {
  async research(question: string): Promise<ResearchResult> {
    // Step 1: Get recent context (fast, no search)
    const recentContext = await this.getRecentContext();

    // Step 2: Decide what context is needed
    const contextNeeds = await this.decideContextNeeds(question);

    // Step 3: Build enriched context only if needed
    const enrichedContext = await this.buildEnrichedContext(...);

    // Step 4: Execute with tools until finalize_report
    return this.executor.executeSingle({ ... });
  }
}
\`\`\``;

export default function CVPage() {
  const [isExporting, setIsExporting] = React.useState(false);

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      // Use Playwright API route for PDF with clickable links
      const baseUrl = window.location.origin;
      const response = await fetch(`/api/cv-pdf?baseUrl=${encodeURIComponent(baseUrl)}`);

      if (!response.ok) {
        throw new Error('PDF generation failed');
      }

      // Download the PDF
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Lucie_Defraiteur_CV.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      // Fallback to browser print
      window.print();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="py-12 px-6 print:py-0 print:px-0">
      <div className="max-w-4xl mx-auto print-content">

        {/* Header with photo */}
        <div className="flex flex-col md:flex-row gap-8 mb-16 print:flex-row">
          {/* Photo with glow effect */}
          <div className="flex-shrink-0 relative group">
            <div className="absolute -inset-1 bg-gradient-to-b from-cyan-500/30 to-purple-500/30 rounded-2xl blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />
            <div className="relative">
              <img
                src="/photos_lucie/1766757772036.png"
                alt="Lucie Defraiteur"
                className="w-40 h-52 rounded-xl object-cover border-2 border-cyan-400/30 group-hover:border-cyan-400/50 transition-colors"
              />
              {/* Scanline overlay */}
              <div className="absolute inset-0 pointer-events-none opacity-10 rounded-xl"
                style={{
                  backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
                }}
              />
            </div>
          </div>

          <div className="flex-1">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-4xl font-bold mb-2">
                  <GlitchText
                    text="Lucie Defraiteur"
                    gradient="from-cyan-400 to-purple-400"
                    glowColor="rgba(0,255,255,0.3)"
                    repeatInterval={15000}
                  />
                </h1>
                <p className="text-cyan-400 text-xl mb-4">AI Agent Engineer & 3D Graphics Developer</p>
                <div className="text-slate-400 space-y-1">
                  <p className="flex items-center gap-2">
                    <span className="text-pink-400/60">▹</span>
                    <a href="https://www.luciformresearch.com" target="_blank" rel="noopener noreferrer" className="hover:text-pink-400 transition-colors">
                      luciformresearch.com
                    </a>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="text-cyan-400/60">▹</span>
                    <a href="mailto:luciedefraiteur@luciformresearch.com" className="hover:text-cyan-400 transition-colors">
                      luciedefraiteur@luciformresearch.com
                    </a>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="text-purple-400/60">▹</span>
                    <a href="https://github.com/LuciformResearch" target="_blank" rel="noopener noreferrer" className="hover:text-purple-400 transition-colors">
                      github.com/LuciformResearch
                    </a>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="text-blue-400/60">▹</span>
                    <a href="https://www.linkedin.com/in/lucie-defraiteur-8b3ab6b2/" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
                      linkedin.com/in/lucie-defraiteur
                    </a>
                  </p>
                </div>
              </div>
              <button
                onClick={handleExportPDF}
                disabled={isExporting}
                data-export-pdf
                className="relative px-4 py-2 rounded-lg text-sm font-medium transition-all print:hidden
                  bg-cyan-500/10 border border-cyan-400/50 text-cyan-400
                  hover:bg-cyan-500/20 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(0,255,255,0.3)]
                  disabled:opacity-50 disabled:cursor-wait"
              >
                {isExporting ? 'Generating...' : 'Export PDF'}
              </button>
            </div>
          </div>
        </div>

        {/* Profile */}
        <section className="mb-12 relative group">
          <div className="absolute -inset-2 bg-gradient-to-r from-cyan-500/5 to-purple-500/5 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <h2 className="text-xl font-bold mb-4 pb-2 border-b border-cyan-400/20 flex items-center gap-3">
              <span className="w-1 h-5 bg-cyan-400 rounded-full" />
              <GlitchText
                text="Profile"
                gradient="from-white to-slate-300"
                glowColor="rgba(0,255,255,0.2)"
                repeatInterval={20000}
              />
            </h2>
            <p className="text-slate-300 leading-relaxed">
              AI engineer specialized in agentic systems, multi-provider LLM orchestration, and RAG architectures.
              I build autonomous agents with tool calling, intent classification, and persistent knowledge graph memory (Neo4j).
              Expertise in hybrid search (vector + BM25), incremental ingestion, and multi-level summarization for infinite context.
              Also 10 years of experience in real-time 3D with WebGPU/WebGL engines.
            </p>
          </div>
        </section>

        {/* Skills */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6 pb-2 border-b border-purple-400/20 flex items-center gap-3">
            <span className="w-1 h-5 bg-purple-400 rounded-full" />
            <GlitchText
              text="Technical Skills"
              gradient="from-white to-slate-300"
              glowColor="rgba(168,85,247,0.2)"
              repeatInterval={21000}
            />
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-b from-cyan-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-4 rounded-xl bg-slate-900/50 border border-cyan-400/20 group-hover:border-cyan-400/40 transition-colors">
                <h3 className="font-semibold text-cyan-400 mb-2 flex items-center gap-2">
                  <span className="text-lg">{ }</span> Languages & Frameworks
                </h3>
                <p className="text-slate-400">TypeScript, JavaScript, Python, C++, C#, React, Next.js, Node.js</p>
              </div>
            </div>
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-b from-purple-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-4 rounded-xl bg-slate-900/50 border border-purple-400/20 group-hover:border-purple-400/40 transition-colors">
                <h3 className="font-semibold text-purple-400 mb-2 flex items-center gap-2">
                  <span className="text-lg">*</span> AI & Data
                </h3>
                <p className="text-slate-400">LangChain, LangGraph, GLiNER, TEI, Google Gemini, Neo4j, PostgreSQL, pgVector, RAG, Embeddings, Twilio</p>
              </div>
            </div>
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-b from-pink-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-4 rounded-xl bg-slate-900/50 border border-pink-400/20 group-hover:border-pink-400/40 transition-colors">
                <h3 className="font-semibold text-pink-400 mb-2 flex items-center gap-2">
                  <span className="text-lg">3D</span> Graphics
                </h3>
                <p className="text-slate-400">WebGPU, WebGL, Three.js, GLSL, WGSL, OpenGL, Unity</p>
                <Link href="/demos" className="text-pink-400 hover:text-pink-300 text-sm mt-2 inline-flex items-center gap-1 print:hidden
                  hover:underline transition-colors">
                  View interactive demos <span>&rarr;</span>
                </Link>
              </div>
            </div>
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-b from-green-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-4 rounded-xl bg-slate-900/50 border border-green-400/20 group-hover:border-green-400/40 transition-colors">
                <h3 className="font-semibold text-green-400 mb-2 flex items-center gap-2">
                  <span className="text-lg">@</span> Tools & Platforms
                </h3>
                <p className="text-slate-400">Git, Docker, Vercel, Electron, MCP, Houdini</p>
              </div>
            </div>
          </div>
        </section>

        {/* Experience */}
        <section className="mb-12 cv-page-break">
          <h2 className="text-xl font-bold mb-6 pb-2 border-b border-green-400/20 flex items-center gap-3">
            <span className="w-1 h-5 bg-green-400 rounded-full" />
            <GlitchText
              text="Professional Experience"
              gradient="from-white to-slate-300"
              glowColor="rgba(0,255,136,0.2)"
              repeatInterval={22000}
            />
          </h2>
          <div className="space-y-4">

            {/* Luciform Research */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative border-l-2 border-cyan-400 pl-4 py-2">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-slate-200">Founder & Lead Developer</h3>
                  <span className="text-cyan-400/60 text-sm px-2 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/20">Jul 2024 - Present</span>
                </div>
                <p className="text-cyan-400 text-sm mb-2">Luciform Research · Lille</p>
                <p className="text-slate-400 text-sm">
                  Independent software research initiative. Created RagForge (RAG agent framework with Neo4j knowledge graphs),
                  CodeParsers (multi-language tree-sitter parser), XMLParser (fault-tolerant XML parser), and Lucie Agent
                  (LangGraph-based conversational AI with intent classification, tool calling, and Twilio WhatsApp integration).
                  All packages published on npm under @luciformresearch scope.
                </p>
              </div>
            </div>

            {/* Entre Potes - Freelance */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-pink-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative border-l-2 border-pink-400 pl-4 py-2">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-slate-200">Fullstack Developer (Freelance)</h3>
                  <span className="text-pink-400/60 text-sm px-2 py-0.5 rounded bg-pink-400/10 border border-pink-400/20">Oct - Nov 2025</span>
                </div>
                <p className="text-pink-400 text-sm mb-2">Entre Potes · Remote</p>
                <p className="text-slate-400 text-sm">
                  Feature development for social platform. Header visual fixes, custom react-joyride vendor fork
                  for CSS transform handling, badge components with tooltips, premium subscription modal.
                  <span className="text-pink-400/80"> React.js, TypeScript</span>
                </p>
              </div>
            </div>

            {/* Designhubz */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-green-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative border-l-2 border-green-400 pl-4 py-2">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-slate-200">3D/Tools Developer (Freelance)</h3>
                  <span className="text-green-400/60 text-sm px-2 py-0.5 rounded bg-green-400/10 border border-green-400/20">Feb 2023 - Jan 2024</span>
                </div>
                <p className="text-green-400 text-sm mb-2">Designhubz · Remote</p>
                <p className="text-slate-400 text-sm">
                  3D tools and mobile development for AR/VR e-commerce platform.
                  <span className="text-green-400/80"> React Native, TypeScript</span>
                </p>
              </div>
            </div>

            {/* Verizon */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative border-l-2 border-purple-400 pl-4 py-2">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-slate-200">Babylon.js / WebGL / 3D Expert</h3>
                  <span className="text-purple-400/60 text-sm px-2 py-0.5 rounded bg-purple-400/10 border border-purple-400/20">Feb 2021 - Feb 2023</span>
                </div>
                <p className="text-purple-400 text-sm mb-2">Verizon / Smartcom / Altersis · Remote</p>
                <p className="text-slate-400 text-sm">
                  Real-time 3D visualization and WebGL development for enterprise clients.
                  <span className="text-purple-400/80"> TypeScript, React, Babylon.js, Three.js, GLSL, C++, OpenGL</span>
                </p>
              </div>
            </div>

            {/* A2Mac1 */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-orange-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative border-l-2 border-orange-400 pl-4 py-2">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-slate-200">3D/Tools Developer</h3>
                  <span className="text-orange-400/60 text-sm px-2 py-0.5 rounded bg-orange-400/10 border border-orange-400/20">Oct 2019 - Nov 2020</span>
                </div>
                <p className="text-orange-400 text-sm mb-2">A2Mac1 - Automotive Benchmarking</p>
                <p className="text-slate-400 text-sm">
                  3D visualization tools for automotive industry benchmarking platform.
                  <span className="text-orange-400/80"> TypeScript, Unreal Engine 4, Angular, Three.js, WebGL, C++, GLSL</span>
                </p>
              </div>
            </div>

            {/* Game Dev Era */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative border-l-2 border-blue-400 pl-4 py-2">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-slate-200">Game Developer</h3>
                  <span className="text-blue-400/60 text-sm px-2 py-0.5 rounded bg-blue-400/10 border border-blue-400/20">2015 - 2019</span>
                </div>
                <p className="text-blue-400 text-sm mb-2">Multiple Studios</p>
                <p className="text-slate-400 text-sm">
                  <strong className="text-slate-300">Flashbreak</strong> (2019) - Real-time multiplayer WebGL games for streaming platform with cash prizes.
                  <strong className="text-slate-300"> GameBuilt</strong> (2018) - Three.js/TypeScript game development.
                  <strong className="text-slate-300"> Eden Games</strong> (2018) - Unity developer on Gear Club 2 racing game.
                  <strong className="text-slate-300"> AddSome</strong> (2017-18) - Lead Unity developer for professional 3D/2D applications.
                  <strong className="text-slate-300"> Nectar de Code</strong> (2015-16) - Lead developer of tower defense game.
                  <span className="text-blue-400/80"> Unity, Three.js, TypeScript, GLSL, WebGL</span>
                </p>
              </div>
            </div>

            {/* Education */}
            <div className="group relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-yellow-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative border-l-2 border-yellow-400 pl-4 py-2">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-semibold text-slate-200">42 Paris</h3>
                  <span className="text-yellow-400/60 text-sm px-2 py-0.5 rounded bg-yellow-400/10 border border-yellow-400/20">2013 - 2015</span>
                </div>
                <p className="text-yellow-400 text-sm mb-2">Computer Science</p>
                <p className="text-slate-400 text-sm">
                  Peer-to-peer coding school founded by Xavier Niel. Notable projects:
                  <strong className="text-slate-300"> wolf3D</strong> (raycasting engine),
                  <strong className="text-slate-300"> RT</strong> (raytracer),
                  <strong className="text-slate-300"> Corewar</strong> (VM + assembler),
                  <strong className="text-slate-300"> Lem-in</strong> (pathfinding with Dijkstra/A*),
                  <strong className="text-slate-300"> 42sh</strong> (shell),
                  <strong className="text-slate-300"> Zappy</strong>.
                  <span className="text-yellow-400/80"> C, Algorithms, System Programming</span>
                </p>
              </div>
            </div>

          </div>
        </section>

        {/* Source Available Projects */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6 pb-2 border-b border-pink-400/20 flex items-center gap-3">
            <span className="w-1 h-5 bg-pink-400 rounded-full" />
            <GlitchText
              text="Source Available Projects"
              gradient="from-white to-slate-300"
              glowColor="rgba(236,72,153,0.2)"
              repeatInterval={23000}
            />
          </h2>
          <div className="space-y-4">
            <a
              href="https://www.npmjs.com/package/@luciformresearch/ragforge"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/10 to-purple-500/10 rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative flex gap-4 p-4 rounded-xl bg-slate-900/50 border border-cyan-400/20 group-hover:border-cyan-400/40 transition-colors">
                <img
                  src="/ragforge-logos/LR_LOGO_BLACK_BACKGROUND.png"
                  alt="RagForge Logo"
                  className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-cyan-400/30 group-hover:border-cyan-400/60 transition-colors"
                />
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-cyan-400 group-hover:text-cyan-300 transition-colors">RagForge</h3>
                    <code className="text-xs text-cyan-400/80 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/20">@luciformresearch/ragforge</code>
                  </div>
                  <p className="text-slate-400 text-sm">
                    Universal RAG agent with persistent local brain. Neo4j-powered knowledge graph,
                    MCP server integration, and Electron desktop app.
                  </p>
                </div>
              </div>
            </a>
            <a
              href="https://www.npmjs.com/package/@luciformresearch/codeparsers"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-green-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-4 rounded-xl bg-slate-900/50 border border-green-400/20 group-hover:border-green-400/40 transition-colors">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-green-400 group-hover:text-green-300 transition-colors">CodeParsers</h3>
                  <code className="text-xs text-green-400/80 bg-green-400/10 px-2 py-0.5 rounded border border-green-400/20">@luciformresearch/codeparsers</code>
                </div>
                <p className="text-slate-400 text-sm">
                  Multi-language code parser (13 languages: TS, Python, C, C++, C#, Go, Rust, etc.) with cross-file dependency graph extraction.
                </p>
              </div>
            </a>
            <a
              href="https://www.npmjs.com/package/@luciformresearch/xmlparser"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block"
            >
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/10 to-transparent rounded-xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative p-4 rounded-xl bg-slate-900/50 border border-purple-400/20 group-hover:border-purple-400/40 transition-colors">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-purple-400 group-hover:text-purple-300 transition-colors">XMLParser</h3>
                  <code className="text-xs text-purple-400/80 bg-purple-400/10 px-2 py-0.5 rounded border border-purple-400/20">@luciformresearch/xmlparser</code>
                </div>
                <p className="text-slate-400 text-sm">
                  Fault-tolerant XML parser for AI pipelines. Streaming SAX API with namespace support.
                </p>
              </div>
            </a>
          </div>
        </section>

        {/* Code Samples */}
        <section className="mb-12 print:hidden">
          <h2 className="text-xl font-bold mb-4 pb-2 border-b border-cyan-400/20 flex items-center gap-3">
            <span className="w-1 h-5 bg-cyan-400 rounded-full" />
            <GlitchText
              text="Code Samples"
              gradient="from-white to-slate-300"
              glowColor="rgba(0,255,255,0.2)"
              repeatInterval={24000}
            />
          </h2>
          <p className="text-slate-400 text-sm mb-6">
            Representative snippets from RagForge showing key architectural patterns.
          </p>

          <CodeBlock
            code={brainSearchCode}
            title="Semantic Brain Search"
            titleColor="bg-cyan-500"
          />

          <CodeBlock
            code={researchAgentCode}
            title="Autonomous Research Agent"
            titleColor="bg-green-500"
          />

          <CodeBlock
            code={structuredLLMCode}
            title="Structured LLM Executor"
            titleColor="bg-purple-500"
          />

          <CodeBlock
            code={incrementalIngestionCode}
            title="Incremental Ingestion"
            titleColor="bg-yellow-500"
          />

          <CodeBlock
            code={batchEmbeddingsCode}
            title="Multi-Embedding Batch Processing"
            titleColor="bg-cyan-500"
          />

          <CodeBlock
            code={researchReportCode}
            title="Research Agent Report (auto-generated)"
            titleColor="bg-pink-500"
          />
        </section>

        {/* Links */}
        <section className="print:hidden">
          <h2 className="text-xl font-bold mb-6 pb-2 border-b border-purple-400/20 flex items-center gap-3">
            <span className="w-1 h-5 bg-purple-400 rounded-full" />
            <GlitchText
              text="Links"
              gradient="from-white to-slate-300"
              glowColor="rgba(168,85,247,0.2)"
              repeatInterval={25000}
            />
          </h2>
          <div className="flex flex-wrap gap-4">
            <a
              href="https://github.com/LuciformResearch"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-slate-900/50 border border-cyan-400/30 text-cyan-400
                hover:bg-cyan-500/10 hover:border-cyan-400/60 hover:shadow-[0_0_15px_rgba(0,255,255,0.2)] transition-all"
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/~luciformresearch"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-slate-900/50 border border-pink-400/30 text-pink-400
                hover:bg-pink-500/10 hover:border-pink-400/60 hover:shadow-[0_0_15px_rgba(236,72,153,0.2)] transition-all"
            >
              npm
            </a>
            <a
              href="mailto:luciedefraiteur@luciformresearch.com"
              className="px-4 py-2 rounded-lg bg-slate-900/50 border border-purple-400/30 text-purple-400
                hover:bg-purple-500/10 hover:border-purple-400/60 hover:shadow-[0_0_15px_rgba(168,85,247,0.2)] transition-all"
            >
              Email
            </a>
            <Link
              href="/demos"
              className="px-4 py-2 rounded-lg bg-slate-900/50 border border-green-400/30 text-green-400
                hover:bg-green-500/10 hover:border-green-400/60 hover:shadow-[0_0_15px_rgba(0,255,136,0.2)] transition-all"
            >
              Playable Demos
            </Link>
          </div>
        </section>

      </div>
    </div>
  );
}
