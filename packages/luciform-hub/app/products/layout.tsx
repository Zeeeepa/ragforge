import type { Metadata } from "next";
import { SoftwareApplicationStructuredData } from "../components/StructuredData";

export const metadata: Metadata = {
  title: "Products - RagForge, CodeParsers, XMLParser",
  description: "Open source AI tools by Luciform Research. RagForge: RAG agent with Neo4j knowledge graph. CodeParsers: multi-language tree-sitter parser. XMLParser: fault-tolerant XML parser for LLM outputs.",
  keywords: [
    "RagForge",
    "CodeParsers",
    "XMLParser",
    "RAG framework",
    "Neo4j RAG",
    "tree-sitter parser",
    "code parser",
    "XML parser",
    "LLM tools",
    "AI developer tools",
    "npm packages",
    "@luciformresearch",
  ],
  openGraph: {
    title: "Products - RagForge, CodeParsers, XMLParser | Luciform Research",
    description: "Open source AI tools: RagForge (RAG + Neo4j), CodeParsers (tree-sitter), XMLParser (LLM outputs).",
    type: "website",
    url: "https://www.luciformresearch.com/products",
  },
};

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SoftwareApplicationStructuredData
        name="RagForge"
        description="Universal RAG agent with persistent local brain. Neo4j-powered knowledge graph, semantic search, MCP server integration."
        url="https://www.npmjs.com/package/@luciformresearch/ragforge"
      />
      <SoftwareApplicationStructuredData
        name="CodeParsers"
        description="Multi-language code parser using tree-sitter WASM. Unified API for TypeScript, Python, Vue, Svelte."
        url="https://www.npmjs.com/package/@luciformresearch/codeparsers"
      />
      <SoftwareApplicationStructuredData
        name="XMLParser"
        description="Fault-tolerant XML parser for AI pipelines. Streaming SAX API with namespace support."
        url="https://www.npmjs.com/package/@luciformresearch/xmlparser"
      />
      {children}
    </>
  );
}
