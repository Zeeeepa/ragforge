import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Navigation } from "./components/Navigation";
import { Footer } from "./components/Footer";
import { GraphBackground } from "./components/GraphBackground";
import { OrganizationStructuredData, WebSiteStructuredData } from "./components/StructuredData";
import { ChatWidget } from "./components/ChatWidget";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Luciform Research - AI Tools & RAG Systems by Lucie Defraiteur",
    template: "%s | Luciform Research",
  },
  description: "Luciform Research by Lucie Defraiteur. Building RagForge, CodeParsers, XMLParser - intelligent AI tools for developers. RAG architectures, Neo4j knowledge graphs, code parsing, and AI-powered solutions.",
  keywords: [
    "Lucie Defraiteur",
    "Luciform Research",
    "Luciform",
    "RagForge",
    "RAG",
    "Retrieval Augmented Generation",
    "CodeParsers",
    "XMLParser",
    "AI tools",
    "Neo4j",
    "knowledge graph",
    "code parsing",
    "tree-sitter",
    "TypeScript",
    "developer tools",
    "MCP server",
  ],
  authors: [{ name: "Lucie Defraiteur", url: "https://luciformresearch.com" }],
  creator: "Lucie Defraiteur",
  publisher: "Luciform Research",
  metadataBase: new URL("https://www.luciformresearch.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.luciformresearch.com",
    siteName: "Luciform Research",
    title: "Luciform Research - AI Tools & RAG Systems by Lucie Defraiteur",
    description: "RagForge, CodeParsers, XMLParser - intelligent AI tools for developers by Lucie Defraiteur. RAG architectures, Neo4j knowledge graphs, and AI-powered solutions.",
    images: [
      {
        url: "/description/LuciformResearchNewBanner.jpg",
        width: 1024,
        height: 535,
        alt: "Luciform Research - AI Tools & RAG Systems",
        type: "image/jpeg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Luciform Research - AI Tools by Lucie Defraiteur",
    description: "RagForge, CodeParsers, XMLParser - intelligent AI tools for developers.",
    images: ["/description/LuciformResearchNewBanner.jpg"],
    creator: "@LuciformResearch",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <OrganizationStructuredData />
        <WebSiteStructuredData />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-950 text-white min-h-screen flex flex-col`}
      >
        <GraphBackground />
        <Navigation />
        <main className="flex-1 pt-16">
          {children}
        </main>
        <Footer />
        {process.env.NEXT_PUBLIC_CHAT_WIDGET_ENABLED === 'true' && <ChatWidget />}
      </body>
    </html>
  );
}
