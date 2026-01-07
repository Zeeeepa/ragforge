import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GraphBackground } from "@/components/GraphBackground";

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
    default: "Community Docs Hub",
    template: "%s | Community Docs Hub",
  },
  description: "Collaborative documentation platform for Discord developers with AI-powered semantic search",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-white min-h-screen`}
      >
        <GraphBackground />
        <div className="relative z-10">
          {children}
        </div>
      </body>
    </html>
  );
}
