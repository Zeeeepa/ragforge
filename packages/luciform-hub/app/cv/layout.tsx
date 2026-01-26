import type { Metadata } from "next";
import { PersonStructuredData } from "../components/StructuredData";

export const metadata: Metadata = {
  title: "CV - Lucie Defraiteur | RAG Systems Engineer & 3D Developer",
  description: "Lucie Defraiteur - RAG Systems Engineer & 3D Graphics Developer. Creator of RagForge, CodeParsers, XMLParser. Specialized in Neo4j knowledge graphs, semantic search, WebGL/Three.js.",
  keywords: [
    "Lucie Defraiteur",
    "Lucie Defraiteur CV",
    "RAG engineer",
    "3D developer",
    "RagForge creator",
    "Neo4j developer",
    "TypeScript developer",
    "WebGL developer",
    "Three.js",
    "42 Paris",
  ],
  openGraph: {
    title: "CV - Lucie Defraiteur | RAG Systems Engineer",
    description: "RAG Systems Engineer & 3D Graphics Developer. Creator of RagForge, CodeParsers, XMLParser.",
    type: "profile",
    url: "https://www.luciformresearch.com/cv",
    images: [
      {
        url: "/photos_lucie/1766757772036.png",
        width: 400,
        height: 520,
        alt: "Lucie Defraiteur",
      },
    ],
  },
};

export default function CVLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PersonStructuredData />
      {children}
    </>
  );
}
