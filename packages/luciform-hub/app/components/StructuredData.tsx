export function OrganizationStructuredData() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Luciform Research",
    "alternateName": ["Luciform", "LuciformResearch"],
    "url": "https://www.luciformresearch.com",
    "logo": "https://www.luciformresearch.com/ragforge-logos/LR_LOGO_BLACK_BACKGROUND.png",
    "description": "Building intelligent AI tools for developers. RAG architectures, knowledge graphs, and code parsing solutions.",
    "founder": {
      "@type": "Person",
      "name": "Lucie Defraiteur",
      "url": "https://www.luciformresearch.com/cv",
      "jobTitle": "RAG Systems Engineer & 3D Graphics Developer",
      "sameAs": [
        "https://github.com/LuciformResearch",
        "https://www.npmjs.com/~luciformresearch"
      ]
    },
    "sameAs": [
      "https://github.com/LuciformResearch",
      "https://www.npmjs.com/~luciformresearch"
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export function PersonStructuredData() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": "Lucie Defraiteur",
    "url": "https://www.luciformresearch.com/cv",
    "image": "https://www.luciformresearch.com/photos_lucie/1766757772036.png",
    "jobTitle": "RAG Systems Engineer & 3D Graphics Developer",
    "description": "Backend engineer specialized in data pipelines, knowledge graph indexation, and RAG architectures. Also experienced in 3D graphics with WebGPU/WebGL engines.",
    "email": "luciedefraiteur@luciformresearch.com",
    "worksFor": {
      "@type": "Organization",
      "name": "Luciform Research",
      "url": "https://lr-chat.vercel.app"
    },
    "alumniOf": {
      "@type": "EducationalOrganization",
      "name": "42 Paris"
    },
    "knowsAbout": [
      "RAG (Retrieval Augmented Generation)",
      "LangChain",
      "LangGraph",
      "Neo4j",
      "Knowledge Graphs",
      "TypeScript",
      "Python",
      "WebGL",
      "Three.js",
      "AI Development Tools"
    ],
    "sameAs": [
      "https://github.com/LuciformResearch",
      "https://www.npmjs.com/~luciformresearch"
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export function SoftwareApplicationStructuredData({
  name,
  description,
  url,
  applicationCategory = "DeveloperApplication"
}: {
  name: string;
  description: string;
  url: string;
  applicationCategory?: string;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": name,
    "description": description,
    "url": url,
    "applicationCategory": applicationCategory,
    "operatingSystem": "Cross-platform",
    "author": {
      "@type": "Person",
      "name": "Lucie Defraiteur"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Luciform Research"
    },
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    }
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export function WebSiteStructuredData() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Luciform Research",
    "alternateName": "Luciform",
    "url": "https://www.luciformresearch.com",
    "description": "AI Tools & RAG Systems by Lucie Defraiteur",
    "publisher": {
      "@type": "Organization",
      "name": "Luciform Research"
    },
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://lr-chat.vercel.app/?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
