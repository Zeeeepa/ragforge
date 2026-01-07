# Analyse du Pipeline d'Ingestion RagForge

> Date: 3 janvier 2025
> Objectif: Comprendre l'architecture existante pour l'adapter à community-docs

---

## 1. Vue d'ensemble de l'architecture

Le pipeline d'ingestion RagForge est un système sophistiqué conçu pour l'ingestion incrémentale avec préservation des embeddings.

```
┌─────────────────────────────────────────────────────────────────┐
│                         INPUT LAYER                              │
│   Files │ Documents │ Media │ Web Pages │ APIs                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│              UniversalSourceAdapter                              │
│   Auto-détecte le type de fichier, route vers le bon parser     │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                   ParserRegistry                                 │
│  ┌────────────┬──────────────┬─────────────┬───────────────┐    │
│  │ CodeParser │MarkdownParser│DocumentParser│ MediaParser   │    │
│  │ (TS, JS,   │ (MD, MDX)    │(PDF, DOCX,  │ (PNG, 3D)     │    │
│  │  Python)   │              │ XLSX)       │               │    │
│  └────────────┴──────────────┴─────────────┴───────────────┘    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│              IngestionOrchestrator                               │
│  - Capture métadonnées (embeddings, UUIDs) AVANT suppression    │
│  - Supprime anciens nodes                                        │
│  - Parse et ingère nouveaux fichiers                             │
│  - Restaure métadonnées si contenu inchangé                      │
│  - Génère embeddings pour nodes "dirty"                          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    Neo4j Database                                │
│  - Nodes: Scope, File, MarkdownSection, WebPage, etc.           │
│  - Relationships: DEFINES, CONSUMES, HAS_SECTION, LINKS_TO      │
│  - Vector indexes pour recherche sémantique                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Composants clés

### 2.1 IngestionOrchestrator
**Location:** `packages/core/src/ingestion/orchestrator.ts`

Point d'entrée unique pour toutes les opérations d'ingestion.

```typescript
const stats = await orchestrator.reingest(fileChanges, {
  projectId: 'my-project',
  generateEmbeddings: true
});
```

**Responsabilités:**
- Coordonne le flow complet d'ingestion
- Gère le batching via `ChangeQueue`
- Délègue aux composants spécialisés

### 2.2 MetadataPreserver
**Location:** `packages/core/src/ingestion/metadata-preserver.ts`

**Fonction critique:** Préserve les embeddings pendant la ré-ingestion.

- **Phase capture:** Query Neo4j pour tous les embeddings AVANT suppression
- **Phase restauration:** Restaure les embeddings si:
  - Hash du contenu identique (pas de changement)
  - Provider/model compatibles
  - UUID correspond

**Économie:** 60-80% de réduction des appels API embeddings sur des éditions typiques.

### 2.3 NodeStateMachine
**Location:** `packages/core/src/ingestion/node-state-machine.ts`

**Cycle de vie des nodes:**
```
pending → parsing → parsed → linking → linked → embedding → ready
   ↑                            ↑
   └─── error (avec retry) ─────┘
```

**Propriétés persistées:**
```typescript
{
  state: 'linked',
  stateChangedAt: datetime(),
  errorType?: 'parse' | 'relations' | 'embed',
  errorMessage?: string,
  retryCount: number,
  contentHash: string,
  embeddingProvider: 'ollama',
  embeddingModel: 'mxbai-embed-large'
}
```

### 2.4 EmbeddingService
**Location:** `packages/core/src/brain/embedding-service.ts`

**Stratégie multi-embedding (3 vecteurs par node):**

| Type | Usage | Source | Dimensions |
|------|-------|--------|------------|
| `embedding_name` | "find auth function" | Nom, signature | 1024-3072 |
| `embedding_content` | "code that validates JWT" | Contenu complet | 1024-3072 |
| `embedding_description` | "documented as auth" | Docstrings | 1024-3072 |

**Chunking pour grands contenus:**
- `CHUNKING_THRESHOLD`: 3000 chars
- `EMBEDDING_CHUNK_SIZE`: 2000 chars
- `EMBEDDING_CHUNK_OVERLAP`: 200 chars

### 2.5 Providers d'embeddings existants
**Location:** `packages/core/src/runtime/embedding/`

| Provider | Fichier | Dimensions | Usage |
|----------|---------|------------|-------|
| Gemini | `embedding-provider.ts` | 3072 | Cloud (payant) |
| Ollama | `ollama-embedding-provider.ts` | 768-1024 | Local (gratuit) |

---

## 3. Parsers disponibles

### 3.1 Vue d'ensemble
**Location:** `packages/core/src/ingestion/parsers/`

| Parser | Extensions | Output Node Type |
|--------|-----------|------------------|
| CodeParser | .ts, .js, .py, .vue, .svelte | Scope |
| MarkdownParser | .md, .mdx | MarkdownDocument, MarkdownSection |
| DocumentParser | .pdf, .docx, .xlsx | DocumentFile, Scope |
| MediaParser | .png, .jpg, .gif, .webp, .glb | ImageFile, ThreeDFile |
| DataParser | .json, .yaml, .xml, .csv | DataFile |
| WebParser | HTML crawlé | WebPage |

### 3.2 Détail des Parsers

#### DocumentParser (`document-parser.ts`)
**Extensions:** `.pdf`, `.docx`, `.xlsx`, `.xls`, `.csv`

| Node Type | Champs principaux | Chunking |
|-----------|-------------------|----------|
| PDFDocument | pageCount, textContent, outline | maxSize: 4000, overlap: 400, strategy: paragraph |
| WordDocument | content, styles | idem |
| SpreadsheetDocument | sheets[], rowCount, colCount | idem |
| DocumentFile | path, type (wrapper) | non |

**Relationships:** `(File)-[:IN_FILE]->(DocumentFile)`

**Field extractors pour embeddings:**
- `name`: title ou filename
- `content`: textContent (fulltext du document)
- `description`: null (pas de docstring)

---

#### MarkdownParser (`markdown-parser.ts`)
**Extensions:** `.md`, `.mdx`, `.markdown`

| Node Type | Champs principaux | Chunking |
|-----------|-------------------|----------|
| MarkdownDocument | title, frontMatter, textContent, toc | non (contient sections) |
| MarkdownSection | title, level, content, ownContent, headingId | maxSize: 4000, overlap: 400, paragraph |
| CodeBlock | language, source, inSection | maxSize: 3000, overlap: 300, code |

**Relationships:**
- `(MarkdownDocument)-[:HAS_SECTION]->(MarkdownSection)`
- `(MarkdownSection)-[:HAS_SUBSECTION]->(MarkdownSection)`
- `(MarkdownSection)-[:HAS_CODE_BLOCK]->(CodeBlock)`

**Note importante:** `ownContent` = contenu sans enfants, `content` = contenu avec enfants

---

#### MediaParser (`media-parser.ts`)
**Extensions:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`, `.bmp`, `.tiff`, `.gltf`, `.glb`

| Node Type | Champs principaux | Chunking |
|-----------|-------------------|----------|
| ImageFile | width, height, format, description, ocrText | non |
| ThreeDFile | gltfInfo, description, meshCount, materialCount | non |
| MediaFile | path, type (générique) | non |

**Note:** Pas de chunking pour les médias. `description` et `ocrText` sont générés via Gemini Vision si configuré.

---

#### DataParser (`data-parser.ts`)
**Extensions:** `.json`, `.yaml`, `.yml`, `.xml`, `.toml`, `.env`, `.env.*`

| Node Type | Champs principaux | Chunking |
|-----------|-------------------|----------|
| DataFile | format, schemaType, keyCount, source | non (contient sections) |
| DataSection | key, value, depth, valueType | maxSize: 2000, overlap: 200, paragraph |
| ExternalLibrary | name, version, isDev | non |

**Relationships:**
- `(DataFile)-[:CONTAINS]->(DataSection)` (récursif)
- `(DataFile)-[:USES_LIBRARY]->(ExternalLibrary)` (pour package.json)

---

#### CodeParser (`code-parser.ts`)
**Extensions:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.vue`, `.svelte`, `.css`, `.scss`, `.sass`, `.html`, `.htm`, `.astro`, `.go`, `.rs`, `.java`, `.kt`, `.rb`, `.php`, `.c`, `.cpp`, `.h`, `.hpp`

| Node Type | Champs principaux | Chunking |
|-----------|-------------------|----------|
| Scope | name, signature, source, docstring, type, startLine, endLine, linesOfCode | maxSize: 3000, overlap: 300, code |
| File | path, name, extension, source | non (contient Scopes) |
| VueSFC | componentName, templateSource, imports, usedComponents | maxSize: 3000, overlap: 300 |
| SvelteComponent | componentName, templateSource, imports | idem |
| Stylesheet | ruleCount, variableCount, source | idem |
| GenericFile | file, source | idem |

**Relationships:**
- `(File)-[:DEFINES]->(Scope)`
- `(Scope)-[:CONSUMES]->(Scope)` (dépendances cross-file)
- `(Scope)-[:INHERITS_FROM]->(Scope)`
- `(Scope)-[:IMPLEMENTS]->(Scope)`

**Field extractors pour embeddings (Scope):**
- `name`: signature (plus searchable que juste le nom)
- `content`: source code
- `description`: docstring/JSDoc

**Note:** Parsing délégué à `@luciformresearch/codeparsers` via `CodeSourceAdapter`

---

#### WebParser (`web-parser.ts`)
**Extensions:** `.html`, `.htm` + pages web crawlées

| Node Type | Champs principaux | Chunking |
|-----------|-------------------|----------|
| WebPage | url, title, textContent, metaDescription, headingCount, linkCount, depth, crawledAt | maxSize: 4000, overlap: 400, paragraph |
| WebDocument | file, title, textContent, source | idem |

**Relationships:**
- `(WebPage)-[:LINKS_TO]->(WebPage)`

**Note:** Crawling délégué à `WebAdapter`

---

### 3.3 Résumé des Node Types pour Community-Docs

Pour community-docs, les parsers les plus pertinents sont:

| Type de document | Parser | Nodes créés |
|------------------|--------|-------------|
| PDF | DocumentParser | PDFDocument |
| DOCX | DocumentParser | WordDocument |
| XLSX/CSV | DocumentParser | SpreadsheetDocument |
| Markdown | MarkdownParser | MarkdownDocument + MarkdownSection |
| Images | MediaParser | ImageFile |
| Code (optional) | CodeParser | Scope + File |

Chaque node aura les propriétés `CommunityNodeMetadata` injectées après parsing.

---

## 4. Schéma Neo4j

### 4.1 Types de nodes principaux

```cypher
// Code
(:File:CodeFile {uuid, path, absolutePath, state})
(:Scope {uuid, name, signature, source, docstring, type, embedding_*})

// Markdown
(:MarkdownDocument {uuid, file, title, frontMatter, textContent})
(:MarkdownSection {uuid, title, content, level, embedding_*})

// Documents
(:DocumentFile {uuid, path, type, pageCount})
(:PDFDocument {...})
(:WordDocument {...})

// Media
(:ImageFile {uuid, path, description, ocrText})
(:ThreeDFile {uuid, path, description})

// Web
(:WebPage {uuid, url, title, textContent, metaDescription})

// Project
(:Project {projectId, name, path, type})
```

### 4.2 Relationships

```cypher
(Project)-[:HAS_FILE]->(File)
(File)-[:DEFINES]->(Scope)
(Scope)-[:CONSUMES]->(Scope)  // cross-file dependencies

(MarkdownDocument)-[:HAS_SECTION]->(MarkdownSection)
(MarkdownSection)-[:HAS_SUBSECTION]->(MarkdownSection)

(WebPage)-[:LINKS_TO]->(WebPage)
```

---

## 5. Adaptation pour Community-Docs

### 5.1 Architecture des Adapters RagForge

```
┌─────────────────────────────────────────────────────────────┐
│                  UniversalSourceAdapter                      │
│    (dispatche selon source.type)                            │
├──────────────────────┬──────────────────────────────────────┤
│                      │                                      │
│    type: 'files'     │    type: 'web'                       │
│         ↓            │         ↓                            │
│  CodeSourceAdapter   │    WebAdapter                        │
│  (auto-detect ext)   │    (Playwright)                      │
│         │            │                                      │
│    ┌────┴────┐       │                                      │
│    ↓    ↓    ↓       │                                      │
│  .ts  .pdf  .md      │                                      │
│  .py  .docx .json    │                                      │
│  .vue .png  .yaml    │                                      │
└──────────────────────┴──────────────────────────────────────┘
```

**Fichiers clés:**
- `runtime/adapters/types.ts` - Interfaces `SourceConfig`, `ParseOptions`, `ParseResult`, `ParsedNode`
- `runtime/adapters/universal-source-adapter.ts` - Point d'entrée unique
- `runtime/adapters/code-source-adapter.ts` - Parsing réel via `@luciformresearch/codeparsers`

### 5.2 Point d'abstraction pour Community-Docs

```
CLI (FileSystem)              Community-Docs (Uploads)
      │                              │
      ▼                              ▼
  SourceConfig                 SourceConfig
  { type: 'files'              { type: 'files'
    root: '/project' }           root: tempDir }
      │                              │
      └──────────────┬───────────────┘
                     ▼
          UniversalSourceAdapter (inchangé)
                     │
                     ▼
          CodeSourceAdapter (inchangé)
                     │
                     ▼
            ParseResult { graph, nodes[] }
                     │
     ┌───────────────┴───────────────┐
     ↓                               ↓
CLI: Merge to Neo4j          Community: Inject metadata
                                    + Merge to Neo4j
```

### 5.3 Isolation des Bases de Données

**Question critique :** Est-ce que réutiliser `@ragforge/core` risque d'écrire dans la mauvaise BDD ?

**Réponse : NON** - L'architecture utilise l'injection de dépendances.

```typescript
// L'orchestrator NE SE CONNECTE PAS automatiquement à ~/.ragforge
// Il prend un driver Neo4j en paramètre explicite

interface OrchestratorDependencies {
  driver: Driver;  // ← On passe NOTRE driver (port 7688)
  parseFiles: ...;
  ingestGraph: ...;
  // ...
}

const orchestrator = new IngestionOrchestrator(deps, config);
```

**Comment community-docs crée ses propres dépendances :**

```typescript
// packages/community-docs/lib/ragforge/community-orchestrator.ts

import neo4j from 'neo4j-driver';
import {
  IngestionOrchestrator,
  UniversalSourceAdapter,
  IncrementalIngestionManager,
  type OrchestratorDependencies,
} from '@ragforge/core';

/**
 * Create orchestrator with community-docs Neo4j (port 7688)
 * COMPLETELY ISOLATED from CLI's ~/.ragforge (port 7687)
 */
export function createCommunityOrchestrator(): IngestionOrchestrator {
  // 1. Notre propre driver Neo4j (PAS celui du CLI)
  const driver = neo4j.driver(
    process.env.COMMUNITY_NEO4J_URI || 'bolt://localhost:7688',
    neo4j.auth.basic(
      process.env.COMMUNITY_NEO4J_USER || 'neo4j',
      process.env.COMMUNITY_NEO4J_PASSWORD || 'communitydocs'
    )
  );

  // 2. Adapter standard (pas de connexion BDD ici)
  const sourceAdapter = new UniversalSourceAdapter();

  // 3. Manager d'ingestion avec NOTRE driver
  const ingestionManager = new IncrementalIngestionManager(driver);

  // 4. Construire les dépendances
  const deps: OrchestratorDependencies = {
    driver,

    parseFiles: async (options) => {
      const result = await sourceAdapter.parse({
        source: {
          type: 'files',
          root: options.root,
          include: options.include,
        },
        projectId: options.projectId,
        existingUUIDMapping: options.existingUUIDMapping,
      });
      return {
        nodes: result.graph.nodes,
        relationships: result.graph.relationships,
        metadata: result.graph.metadata,
      };
    },

    ingestGraph: async (graph, options) => {
      await ingestionManager.ingestGraph(graph, options);
    },

    deleteNodesForFiles: async (files, projectId) => {
      return ingestionManager.deleteNodesForFiles(files, projectId);
    },

    // Embeddings via notre propre service Ollama
    generateEmbeddings: async (projectId) => {
      // Utilise notre OllamaEmbeddingService configuré pour port 7688
      return communityEmbeddingService.generateForProject(projectId);
    },
  };

  return new IngestionOrchestrator(deps);
}
```

**Résumé de l'isolation :**

| Composant | CLI RagForge | Community-Docs |
|-----------|--------------|----------------|
| Neo4j | `localhost:7687` | `localhost:7688` |
| Config | `~/.ragforge/.env` | `packages/community-docs/.env` |
| Container | `ragforge-brain-neo4j` | `community-docs-neo4j` |
| Driver | BrainManager.neo4jClient | Notre propre driver |

**Aucun risque de collision** car tous les composants reçoivent leurs dépendances explicitement.

### 5.4 Ce qu'on réutilise

- [x] `IngestionOrchestrator` - tel quel (avec notre driver)
- [x] `MetadataPreserver` - économies embeddings
- [x] `NodeStateMachine` - tracking état
- [x] `OllamaEmbeddingProvider` - embeddings locaux
- [x] `DocumentParser` - PDF, DOCX, XLSX
- [x] `MarkdownParser` - fichiers MD
- [x] Multi-embedding strategy

### 5.4 Ce qu'on crée

#### UploadSourceAdapter (Option A - Wrapper léger)

Au lieu de créer un adapter complexe, on réutilise `UniversalSourceAdapter` avec un wrapper:

```typescript
// packages/community-docs/lib/ragforge/upload-source-adapter.ts

import { UniversalSourceAdapter, ParseOptions, ParseResult, ParsedNode } from '@ragforge/core';
import type { Document, Category, User } from '@prisma/client';

interface CommunityMetadata {
  documentId: string;
  documentTitle: string;
  userId: string;
  userUsername?: string;
  categoryId: string;
  categorySlug: string;
  categoryName?: string;
  isPublic: boolean;
}

/**
 * Adapter pour les uploads community-docs
 *
 * Ne modifie PAS le parsing - juste:
 * 1. Prépare les fichiers (extrait ZIP si besoin, copie dans tempDir)
 * 2. Appelle UniversalSourceAdapter standard
 * 3. Injecte les métadonnées community sur tous les nodes
 */
export class CommunityUploadAdapter {
  private universalAdapter: UniversalSourceAdapter;

  constructor() {
    this.universalAdapter = new UniversalSourceAdapter();
  }

  async parse(
    document: Document & { category: Category; uploadedBy: User },
    tempDir: string
  ): Promise<ParseResult> {
    // 1. Préparer les fichiers dans tempDir
    //    - Copie depuis S3/local storage
    //    - Extrait ZIP si document.type === 'ZIP_ARCHIVE'
    await this.prepareFiles(document, tempDir);

    // 2. Parser avec l'adapter standard
    const result = await this.universalAdapter.parse({
      source: {
        type: 'files',
        root: tempDir,
        include: ['**/*'],
        exclude: ['**/node_modules/**', '**/.git/**'],
      },
    });

    // 3. Injecter métadonnées sur tous les nodes
    const metadata = this.buildMetadata(document);
    for (const node of result.graph.nodes) {
      Object.assign(node.properties, metadata);
    }

    return result;
  }

  private buildMetadata(document: Document & { category: Category; uploadedBy: User }): CommunityMetadata {
    return {
      documentId: document.id,
      documentTitle: document.title,
      userId: document.uploadedById,
      userUsername: document.uploadedBy.name ?? undefined,
      categoryId: document.categoryId,
      categorySlug: document.category.slug,
      categoryName: document.category.name,
      isPublic: document.isPublic ?? true,
    };
  }

  private async prepareFiles(document: Document, tempDir: string): Promise<void> {
    // TODO: Implémenter extraction fichiers
  }
}
```

#### Sync Prisma ↔ Neo4j

- Chaque `ParsedNode` reçoit `documentId` qui lie au `Document` Prisma
- Suppression d'un Document → `DELETE (n {documentId: $id}) DETACH DELETE n`
- Mise à jour catégorie → `MATCH (n {documentId: $id}) SET n.categoryId = $newCatId`

#### Trigger d'ingestion (pas de watcher)

```typescript
// app/api/ingest/upload/route.ts - appelé après upload
export async function POST(req: Request) {
  const { documentId } = await req.json();

  // Ingestion synchrone ou async (BullMQ pour prod)
  await communityIngestionService.ingest(documentId);

  return Response.json({ success: true });
}
```

### 5.5 Métadonnées community-docs

Chaque node aura ces propriétés additionnelles:

```typescript
interface CommunityNodeMetadata {
  documentId: string;      // UUID du Document Postgres
  documentTitle: string;
  userId: string;          // ID de l'uploader
  categoryId: string;
  categorySlug: string;
  isPublic: boolean;
}
```

---

## 6. Enrichissement LLM des Documents

### 6.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Document Enrichment Pipeline                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ParseResult (nodes[])                                             │
│         │                                                           │
│         ▼                                                           │
│   ┌─────────────────┐                                               │
│   │ Per-Node        │   executeLLMBatch pour chaque chunk/section   │
│   │ Enrichment      │   → description, entities, tags               │
│   └────────┬────────┘                                               │
│            │                                                        │
│            ▼                                                        │
│   ┌─────────────────┐                                               │
│   │ Global Document │   Synthèse des sub-descriptions               │
│   │ Enrichment      │   → titre, description globale, catégorie     │
│   └────────┬────────┘                                               │
│            │                                                        │
│            ▼                                                        │
│   ┌─────────────────┐                                               │
│   │ Entity Graph    │   Création des nœuds entités + relations      │
│   │ Builder         │   (Person)-[:MENTIONED_IN]->(DocumentChunk)   │
│   └────────┬────────┘                                               │
│            │                                                        │
│            ▼                                                        │
│   EnrichedParseResult                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Options Utilisateur (UI)

```typescript
interface EnrichmentOptions {
  // LLM Enrichment (checkbox principal)
  enableLLMEnrichment: boolean;

  // Sub-options (si LLM activé)
  generateDescriptions: boolean;    // Titres et descriptions
  extractEntities: boolean;         // Personnes, lieux, dates, organisations
  suggestCategory: boolean;         // Suggestion auto de catégorie
  extractTags: boolean;             // Tags thématiques

  // Vision (checkbox séparé)
  enableVision: boolean;            // Analyse images avec vision
  analyzeImages: boolean;           // Description des images
  analyze3D: boolean;               // Rendu + description modèles 3D
  enableOCR: boolean;               // OCR sur images/scans
}
```

### 6.3 Schema d'Extraction d'Entités

```typescript
// Output schema pour executeLLMBatch
const entityExtractionSchema = {
  // Génération de description
  description: {
    type: 'string',
    description: 'A concise 2-3 sentence description of this content section',
    required: true,
  },

  // Personnes mentionnées
  people: {
    type: 'array',
    description: 'People mentioned in this content',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name of the person' },
        role: { type: 'string', description: 'Role or title if mentioned (e.g., "CEO", "Professor")' },
        context: { type: 'string', description: 'Brief context of why they are mentioned' },
      },
    },
  },

  // Organisations
  organizations: {
    type: 'array',
    description: 'Organizations, companies, institutions mentioned',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Organization name' },
        type: { type: 'string', description: 'Type: company, university, government, ngo, etc.' },
      },
    },
  },

  // Lieux
  locations: {
    type: 'array',
    description: 'Geographic locations mentioned',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Location name' },
        type: { type: 'string', description: 'Type: city, country, region, address, etc.' },
      },
    },
  },

  // Dates et événements
  dates: {
    type: 'array',
    description: 'Dates and events mentioned',
    items: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in ISO format if possible, or original text' },
        event: { type: 'string', description: 'What happened on this date' },
      },
    },
  },

  // Tags thématiques
  tags: {
    type: 'array',
    description: 'Relevant topic tags for this content (3-7 tags)',
    items: { type: 'string' },
  },

  // Concepts clés
  keyConcepts: {
    type: 'array',
    description: 'Key concepts, technologies, or methodologies mentioned',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Concept name' },
        definition: { type: 'string', description: 'Brief definition if provided in text' },
      },
    },
  },
};

// Global schema pour le document entier
const documentGlobalSchema = {
  suggestedTitle: {
    type: 'string',
    description: 'A clear, descriptive title for the entire document',
    required: true,
  },
  globalDescription: {
    type: 'string',
    description: 'A comprehensive 3-5 sentence summary of the entire document',
    required: true,
  },
  suggestedCategoryId: {
    type: 'string',
    description: 'ID of the most appropriate existing category',
  },
  categoryConfidence: {
    type: 'number',
    description: 'Confidence in category suggestion (0-1)',
  },
  documentType: {
    type: 'string',
    description: 'Type of document: report, article, manual, presentation, research, etc.',
  },
  language: {
    type: 'string',
    description: 'Primary language of the document (ISO code)',
  },
  consolidatedTags: {
    type: 'array',
    description: 'Top 10 most relevant tags for the entire document',
    items: { type: 'string' },
  },
};
```

### 6.4 Service d'Enrichissement

```typescript
// packages/community-docs/lib/ragforge/enrichment-service.ts

import { StructuredLLMExecutor, LLMProvider } from '@ragforge/core';
import type { ParsedNode, ParseResult } from '@ragforge/core';

interface EnrichedNode extends ParsedNode {
  // LLM-generated
  llmDescription?: string;
  llmTags?: string[];

  // Extracted entities (stored as properties for search)
  extractedPeople?: string[];
  extractedOrganizations?: string[];
  extractedLocations?: string[];
  extractedDates?: string[];
  extractedConcepts?: string[];
}

interface ExtractedEntity {
  type: 'Person' | 'Organization' | 'Location' | 'Event' | 'Concept';
  name: string;
  properties: Record<string, any>;
  mentionedInNodes: string[]; // UUIDs des nodes qui mentionnent cette entité
}

interface EnrichmentResult {
  nodes: EnrichedNode[];
  entities: ExtractedEntity[];
  globalMetadata: {
    suggestedTitle: string;
    globalDescription: string;
    suggestedCategoryId?: string;
    categoryConfidence?: number;
    documentType?: string;
    language?: string;
    consolidatedTags: string[];
  };
}

export class DocumentEnrichmentService {
  private executor: StructuredLLMExecutor;
  private llmProvider: LLMProvider;

  constructor(llmProvider: LLMProvider) {
    this.executor = new StructuredLLMExecutor();
    this.llmProvider = llmProvider;
  }

  async enrichDocument(
    parseResult: ParseResult,
    options: EnrichmentOptions,
    existingCategories: Array<{ id: string; name: string; description: string }>
  ): Promise<EnrichmentResult> {
    const nodes = parseResult.graph.nodes;
    const entities: ExtractedEntity[] = [];

    // 1. Vision enrichment pour images/3D (si activé)
    if (options.enableVision) {
      await this.enrichWithVision(nodes, options);
    }

    // 2. Per-node LLM enrichment
    let enrichedNodes: EnrichedNode[] = nodes;
    if (options.enableLLMEnrichment) {
      enrichedNodes = await this.enrichNodes(nodes, options);

      // 3. Extract and deduplicate entities
      if (options.extractEntities) {
        const extracted = this.extractEntitiesFromNodes(enrichedNodes);
        entities.push(...extracted);
      }
    }

    // 4. Global document enrichment
    const globalMetadata = await this.generateGlobalMetadata(
      enrichedNodes,
      existingCategories,
      options
    );

    return {
      nodes: enrichedNodes,
      entities,
      globalMetadata,
    };
  }

  private async enrichNodes(
    nodes: ParsedNode[],
    options: EnrichmentOptions
  ): Promise<EnrichedNode[]> {
    // Filtrer les nodes qui ont du contenu textuel à enrichir
    const textNodes = nodes.filter(n =>
      n.properties.textContent ||
      n.properties.content ||
      n.properties.source
    );

    if (textNodes.length === 0) return nodes;

    // Préparer les items pour le batch
    const items = textNodes.map(node => ({
      nodeId: node.id,
      content: node.properties.textContent ||
               node.properties.content ||
               node.properties.source,
      nodeType: node.labels[0],
    }));

    // Exécuter le batch LLM
    const results = await this.executor.executeLLMBatch(items, {
      caller: 'DocumentEnrichmentService.enrichNodes',
      inputFields: ['content', 'nodeType'],
      outputSchema: entityExtractionSchema,
      systemPrompt: `You are an expert document analyst. Extract structured information from document content.
Be precise and only extract information that is explicitly mentioned in the text.
For tags, use lowercase single words or short phrases.`,
      userTask: 'Analyze this document section and extract relevant information.',
      llmProvider: this.llmProvider,
      batchSize: 10, // Process 10 nodes per LLM call
    });

    // Merger les résultats dans les nodes
    const enrichedNodes = [...nodes];
    for (const result of results) {
      const nodeIndex = enrichedNodes.findIndex(n => n.id === result.nodeId);
      if (nodeIndex >= 0) {
        const node = enrichedNodes[nodeIndex];
        node.properties.llmDescription = result.description;
        node.properties.llmTags = result.tags;
        node.properties.extractedPeople = result.people?.map(p => p.name);
        node.properties.extractedOrganizations = result.organizations?.map(o => o.name);
        node.properties.extractedLocations = result.locations?.map(l => l.name);
        // Stocker les données complètes pour création de relations
        node.properties._extractedEntities = {
          people: result.people,
          organizations: result.organizations,
          locations: result.locations,
          dates: result.dates,
          concepts: result.keyConcepts,
        };
      }
    }

    return enrichedNodes;
  }

  private async generateGlobalMetadata(
    nodes: EnrichedNode[],
    existingCategories: Array<{ id: string; name: string; description: string }>,
    options: EnrichmentOptions
  ): Promise<EnrichmentResult['globalMetadata']> {
    // Collecter les descriptions des nodes
    const subDescriptions = nodes
      .filter(n => n.properties.llmDescription)
      .map(n => `[${n.labels[0]}] ${n.properties.llmDescription}`)
      .join('\n\n');

    // Collecter tous les tags pour consolidation
    const allTags = nodes
      .flatMap(n => n.properties.llmTags || []);

    const categoryContext = options.suggestCategory
      ? `\n\nAvailable categories:\n${existingCategories.map(c =>
          `- ${c.id}: ${c.name} - ${c.description}`
        ).join('\n')}`
      : '';

    const result = await this.executor.executeLLMBatch(
      [{
        subDescriptions,
        allTags: [...new Set(allTags)].slice(0, 50), // Unique tags, max 50
        categoryContext,
      }],
      {
        caller: 'DocumentEnrichmentService.generateGlobalMetadata',
        inputFields: ['subDescriptions', 'allTags', 'categoryContext'],
        outputSchema: documentGlobalSchema,
        systemPrompt: `You are synthesizing information about a document from its sections.
Create a coherent title and description that captures the essence of the entire document.
${options.suggestCategory ? 'Suggest the most appropriate category from the provided list.' : ''}`,
        userTask: 'Generate global metadata for this document based on its sections.',
        llmProvider: this.llmProvider,
      }
    );

    return result[0];
  }

  private async enrichWithVision(
    nodes: ParsedNode[],
    options: EnrichmentOptions
  ): Promise<void> {
    // Filtrer les nodes image/3D
    const mediaNodes = nodes.filter(n =>
      n.labels.includes('ImageFile') ||
      n.labels.includes('ThreeDFile')
    );

    for (const node of mediaNodes) {
      if (node.labels.includes('ImageFile') && options.analyzeImages) {
        // Utiliser Gemini Vision pour décrire l'image
        // node.properties.visionDescription = await this.describeImage(node.properties.path);
      }
      if (node.labels.includes('ThreeDFile') && options.analyze3D) {
        // Render + describe 3D model
        // node.properties.visionDescription = await this.describe3D(node.properties.path);
      }
    }
  }

  private extractEntitiesFromNodes(nodes: EnrichedNode[]): ExtractedEntity[] {
    const entityMap = new Map<string, ExtractedEntity>();

    for (const node of nodes) {
      const extracted = node.properties._extractedEntities;
      if (!extracted) continue;

      // Personnes
      for (const person of extracted.people || []) {
        const key = `Person:${person.name.toLowerCase()}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            type: 'Person',
            name: person.name,
            properties: { role: person.role },
            mentionedInNodes: [],
          });
        }
        entityMap.get(key)!.mentionedInNodes.push(node.id);
      }

      // Organisations
      for (const org of extracted.organizations || []) {
        const key = `Organization:${org.name.toLowerCase()}`;
        if (!entityMap.has(key)) {
          entityMap.set(key, {
            type: 'Organization',
            name: org.name,
            properties: { orgType: org.type },
            mentionedInNodes: [],
          });
        }
        entityMap.get(key)!.mentionedInNodes.push(node.id);
      }

      // Locations, Events, Concepts... (même pattern)
    }

    return Array.from(entityMap.values());
  }
}
```

### 6.5 Résolution Globale des Entités (Cross-Document Entity Resolution)

La résolution d'entités est un **processus séparé** qui s'exécute sur toute la base Neo4j, pas par document. Elle peut être déclenchée :
- Après un batch upload de plusieurs documents
- Périodiquement (cron job)
- Manuellement par un admin

```
┌─────────────────────────────────────────────────────────────────┐
│                    INGESTION (par document)                      │
│  Document A ──► Parse ──► Extract entities ──► Store in Neo4j   │
│  Document B ──► Parse ──► Extract entities ──► Store in Neo4j   │
│  Document C ──► Parse ──► Extract entities ──► Store in Neo4j   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Après batch ou périodiquement
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              RÉSOLUTION GLOBALE (sur toute la base)              │
│                                                                  │
│  1. Query toutes les entités non-résolues de Neo4j              │
│  2. Grouper par type (Person, Organization, etc.)               │
│  3. LLM identifie les duplicats cross-documents                 │
│  4. Merge dans Neo4j : alias → canonical                        │
│                                                                  │
│  "John Smith" (doc A) ─┐                                        │
│  "Dr. Smith" (doc B)   ├──► "Dr. John Smith" (canonical)        │
│  "J. Smith" (doc C)   ─┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

```typescript
// Schema pour la résolution d'entités
const entityResolutionSchema = {
  mergedEntities: {
    type: 'array',
    description: 'Groups of entities that refer to the same real-world entity',
    items: {
      type: 'object',
      properties: {
        canonicalName: {
          type: 'string',
          description: 'The best/most complete name to use as canonical form',
        },
        canonicalUuid: {
          type: 'string',
          description: 'UUID of the entity to keep as canonical (most mentions)',
        },
        type: {
          type: 'string',
          description: 'Entity type: Person, Organization, Location, Concept',
        },
        aliasUuids: {
          type: 'array',
          description: 'UUIDs of entities to merge INTO the canonical one',
          items: { type: 'string' },
        },
        mergedProperties: {
          type: 'object',
          description: 'Combined properties from all mentions',
        },
        confidence: {
          type: 'number',
          description: 'Confidence that these are the same entity (0-1)',
        },
      },
    },
  },
  mergedTags: {
    type: 'array',
    description: 'Deduplicated and normalized tags across all documents',
    items: {
      type: 'object',
      properties: {
        canonical: { type: 'string', description: 'Normalized tag form' },
        variants: { type: 'array', items: { type: 'string' }, description: 'Original variants to merge' },
      },
    },
  },
};

/**
 * Global Entity Resolution Service
 * Runs on entire Neo4j database to merge duplicates across all documents
 */
export class GlobalEntityResolutionService {
  private executor: StructuredLLMExecutor;
  private llmProvider: LLMProvider;
  private neo4j: Neo4jClient;

  constructor(neo4j: Neo4jClient, llmProvider: LLMProvider) {
    this.neo4j = neo4j;
    this.executor = new StructuredLLMExecutor();
    this.llmProvider = llmProvider;
  }

  /**
   * Run global entity resolution on all unresolved entities
   * Called after batch uploads or periodically
   */
  async runGlobalResolution(): Promise<ResolutionResult> {
    const result: ResolutionResult = {
      entitiesMerged: 0,
      tagsMerged: 0,
      mergeLog: [],
    };

    // 1. Query all unresolved entities from Neo4j (not yet merged)
    const unresolvedEntities = await this.queryUnresolvedEntities();
    const allTags = await this.queryAllTags();

    if (unresolvedEntities.length < 2 && allTags.length < 2) {
      return result; // Nothing to resolve
    }

    // 2. Group by type and prepare context for LLM
    const byType = this.groupByType(unresolvedEntities);

    const entitiesContext = Object.entries(byType)
      .map(([type, entities]) => {
        return `## ${type}s (${entities.length}):\n${entities.map(e =>
          `- [${e.uuid}] "${e.name}" (${e.mentionCount} mentions across ${e.documentCount} docs)${e.role ? ` - ${e.role}` : ''}`
        ).join('\n')}`;
      })
      .join('\n\n');

    const tagsContext = `## All Tags (${allTags.length}):\n${allTags.map(t =>
      `- "${t.name}" (${t.count} uses)`
    ).join('\n')}`;

    // 3. LLM identifies duplicates
    const llmResult = await this.executor.executeLLMBatch(
      [{ entitiesContext, tagsContext }],
      {
        caller: 'GlobalEntityResolutionService.runGlobalResolution',
        inputFields: ['entitiesContext', 'tagsContext'],
        outputSchema: entityResolutionSchema,
        systemPrompt: `You are an entity resolution expert analyzing a knowledge base.
Your task is to identify DUPLICATE entities that refer to the same real-world thing.

IMPORTANT: Each entity has a UUID in brackets [uuid]. Use these UUIDs in your response.

Rules for merging:
1. PEOPLE: Merge if clearly the same person
   - "J. Smith" + "John Smith" + "Dr. John Smith" → same person
   - Keep the MOST COMPLETE name as canonical
   - Choose the UUID with most mentions as canonicalUuid

2. ORGANIZATIONS: Merge if same org
   - "Google" + "Google Inc." + "Alphabet's Google" → same org

3. LOCATIONS: Merge if same place
   - "NYC" + "New York" + "New York City" → same place

4. TAGS: Normalize similar tags
   - "api" + "APIs" → "api"
   - "machine-learning" + "ML" → "machine-learning"

ONLY merge when confidence > 0.8. When in doubt, keep separate.
Include the UUIDs of entities to merge (aliasUuids) into the canonical one (canonicalUuid).`,
        userTask: 'Analyze these entities and tags from the knowledge base. Identify and group duplicates.',
        llmProvider: this.llmProvider,
      }
    );

    // 4. Apply merges in Neo4j
    await this.applyMerges(llmResult[0], result);

    return result;
  }

  private async queryUnresolvedEntities(): Promise<Neo4jEntity[]> {
    const query = `
      MATCH (e)
      WHERE e:Person OR e:Organization OR e:Location OR e:Concept
        AND NOT exists(e.mergedInto)  // Not already merged
      OPTIONAL MATCH (e)-[:MENTIONED_IN]->(chunk)
      WITH e, count(DISTINCT chunk) as mentionCount,
           count(DISTINCT chunk.documentId) as documentCount
      RETURN e.uuid as uuid,
             labels(e)[0] as type,
             e.name as name,
             e.role as role,
             mentionCount,
             documentCount
      ORDER BY type, mentionCount DESC
    `;
    return await this.neo4j.run(query);
  }

  private async queryAllTags(): Promise<Array<{name: string, count: number}>> {
    const query = `
      MATCH (n)
      WHERE n.llmTags IS NOT NULL
      UNWIND n.llmTags as tag
      RETURN tag as name, count(*) as count
      ORDER BY count DESC
    `;
    return await this.neo4j.run(query);
  }

  private async applyMerges(llmResult: any, result: ResolutionResult): Promise<void> {
    // Apply entity merges
    for (const merge of llmResult.mergedEntities || []) {
      if (merge.aliasUuids?.length > 0 && merge.confidence >= 0.8) {
        // Update canonical entity with merged properties
        await this.neo4j.run(`
          MATCH (canonical {uuid: $canonicalUuid})
          SET canonical.name = $canonicalName,
              canonical.aliases = $aliases,
              canonical += $mergedProperties
        `, {
          canonicalUuid: merge.canonicalUuid,
          canonicalName: merge.canonicalName,
          aliases: merge.aliasUuids,
          mergedProperties: merge.mergedProperties || {},
        });

        // Redirect all relationships from aliases to canonical
        for (const aliasUuid of merge.aliasUuids) {
          await this.neo4j.run(`
            MATCH (alias {uuid: $aliasUuid})-[r:MENTIONED_IN]->(chunk)
            MATCH (canonical {uuid: $canonicalUuid})
            MERGE (canonical)-[:MENTIONED_IN]->(chunk)
            DELETE r
          `, { aliasUuid, canonicalUuid: merge.canonicalUuid });

          // Mark alias as merged (soft delete)
          await this.neo4j.run(`
            MATCH (alias {uuid: $aliasUuid})
            SET alias.mergedInto = $canonicalUuid,
                alias.mergedAt = datetime()
          `, { aliasUuid, canonicalUuid: merge.canonicalUuid });
        }

        result.entitiesMerged += merge.aliasUuids.length;
        result.mergeLog.push({
          action: 'merge',
          type: merge.type,
          from: merge.aliasUuids,
          to: merge.canonicalUuid,
          canonicalName: merge.canonicalName,
          confidence: merge.confidence,
        });
      }
    }

    // Apply tag normalization (update on all nodes)
    for (const tagMerge of llmResult.mergedTags || []) {
      if (tagMerge.variants?.length > 1) {
        await this.neo4j.run(`
          MATCH (n)
          WHERE any(tag IN n.llmTags WHERE tag IN $variants)
          SET n.llmTags = [tag IN n.llmTags WHERE NOT tag IN $variants] + [$canonical]
        `, {
          variants: tagMerge.variants,
          canonical: tagMerge.canonical,
        });

        result.tagsMerged += tagMerge.variants.length - 1;
        result.mergeLog.push({
          action: 'normalize_tag',
          from: tagMerge.variants,
          to: tagMerge.canonical,
        });
      }
    }
  }

  private groupByType(entities: Neo4jEntity[]): Record<string, Neo4jEntity[]> {
    return entities.reduce((acc, entity) => {
      if (!acc[entity.type]) acc[entity.type] = [];
      acc[entity.type].push(entity);
      return acc;
    }, {} as Record<string, Neo4jEntity[]>);
  }
}

interface Neo4jEntity {
  uuid: string;
  type: string;
  name: string;
  role?: string;
  mentionCount: number;
  documentCount: number;
}

interface ResolutionResult {
  entitiesMerged: number;
  tagsMerged: number;
  mergeLog: Array<{
    action: 'merge' | 'normalize_tag';
    type?: string;
    from: string[];
    to: string;
    canonicalName?: string;
    confidence?: number;
  }>;
}
```

### 6.6 Pipeline Complet (Ingestion + Résolution)

```
═══════════════════════════════════════════════════════════════════════════════
                           PHASE 1: INGESTION (per document)
═══════════════════════════════════════════════════════════════════════════════

  Upload Document(s)
         │
         ▼
  ┌──────────────────┐
  │ Parse (RagForge) │  UniversalSourceAdapter
  │                  │  → nodes[], relationships[]
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Per-Node Extract │  executeLLMBatch #1 (if LLM enabled)
  │ - descriptions   │  → entities bruts, tags bruts
  │ - entities       │  → stored on each node
  │ - tags           │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Global Synthesis │  executeLLMBatch #2
  │ - title          │  → document metadata
  │ - summary        │
  │ - category       │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Create Entities  │  Neo4j: CREATE (Person), (Org), etc.
  │ + Relations      │  + MENTIONED_IN relationships
  └────────┬─────────┘
           │
           ▼
       Store in Neo4j ─────► Document ready ✓

═══════════════════════════════════════════════════════════════════════════════
                    PHASE 2: GLOBAL RESOLUTION (async, batched)
═══════════════════════════════════════════════════════════════════════════════

  Triggered by:
  - After batch upload completes
  - Cron job (e.g., every hour)
  - Admin action
         │
         ▼
  ┌──────────────────┐
  │ Query Neo4j      │  Get all unresolved entities + tags
  │ - Person nodes   │  WHERE NOT exists(mergedInto)
  │ - Org nodes      │
  │ - All llmTags    │
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ LLM Resolution   │  executeLLMBatch #3
  │ - Find duplicates│  "J. Smith" = "John Smith" = "Dr. Smith"
  │ - Normalize tags │  "api" = "APIs" = "Api"
  └────────┬─────────┘
           │
           ▼
  ┌──────────────────┐
  │ Apply Merges     │  Neo4j:
  │ - Redirect rels  │  - Move MENTIONED_IN to canonical
  │ - Soft delete    │  - Set mergedInto on aliases
  │ - Normalize tags │  - Update llmTags arrays
  └────────┬─────────┘
           │
           ▼
       Resolution complete ─────► Knowledge graph cleaned ✓
```

**Avantages de cette séparation :**
1. **Ingestion rapide** - Pas de blocage sur la résolution
2. **Batch efficace** - Résolution sur 100 entités = 1 appel LLM
3. **Cross-document** - Détecte duplicats entre documents différents
4. **Idempotent** - Peut être relancé sans risque

### 6.7 Création des Relations dans Neo4j

```cypher
-- Entités extraites (nodes séparés)
CREATE (p:Person {name: $name, role: $role})
CREATE (o:Organization {name: $name, type: $type})
CREATE (l:Location {name: $name, type: $type})

-- Relations MENTIONED_IN
MATCH (entity {name: $entityName})
MATCH (chunk {uuid: $chunkUuid})
MERGE (entity)-[:MENTIONED_IN {context: $context}]->(chunk)

-- Relations entre entités (si détectées)
MATCH (p:Person {name: $personName})
MATCH (o:Organization {name: $orgName})
MERGE (p)-[:WORKS_AT]->(o)
```

### 6.6 Index pour recherche sur entités

```cypher
-- Index sur les entités pour recherche rapide
CREATE INDEX entity_name FOR (n:Person) ON (n.name)
CREATE INDEX org_name FOR (n:Organization) ON (n.name)
CREATE INDEX location_name FOR (n:Location) ON (n.name)

-- Fulltext index pour recherche dans les tags/entities extraits
CREATE FULLTEXT INDEX node_extracted_entities FOR (n:Scope|MarkdownSection|PDFDocument)
ON EACH [n.extractedPeople, n.extractedOrganizations, n.extractedLocations, n.llmTags]
```

### 6.7 API Endpoints

```typescript
// POST /api/ingest/upload
// Body: { file, options: EnrichmentOptions }
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file');
  const options = JSON.parse(formData.get('options') as string);

  // 1. Upload file
  const document = await uploadDocument(file);

  // 2. Queue ingestion with enrichment options
  await ingestionQueue.add({
    documentId: document.id,
    enrichmentOptions: options,
  });

  return Response.json({ documentId: document.id, status: 'processing' });
}

// GET /api/docs/:id/entities
// Retourne les entités extraites d'un document
export async function GET(req: Request, { params }) {
  const entities = await neo4j.run(`
    MATCH (e)-[:MENTIONED_IN]->(chunk {documentId: $documentId})
    RETURN labels(e)[0] as type, e.name as name, count(chunk) as mentions
    ORDER BY mentions DESC
  `, { documentId: params.id });

  return Response.json({ entities });
}
```

---

## 7. Fichiers clés à étudier

### Architecture
- `packages/core/src/ingestion/orchestrator.ts`
- `packages/core/src/ingestion/types.ts`
- `packages/core/src/brain/brain-manager.ts`

### Parsers
- `packages/core/src/ingestion/parser-registry.ts`
- `packages/core/src/ingestion/parsers/document-parser.ts`
- `packages/core/src/ingestion/parsers/code-parser.ts`
- `packages/core/src/ingestion/parsers/markdown-parser.ts`

### State & Incremental
- `packages/core/src/ingestion/node-state-machine.ts`
- `packages/core/src/ingestion/metadata-preserver.ts`
- `packages/core/src/brain/touched-files-watcher.ts`

### Embeddings
- `packages/core/src/brain/embedding-service.ts`
- `packages/core/src/runtime/embedding/ollama-embedding-provider.ts`

### Adapters
- `packages/core/src/runtime/adapters/universal-source-adapter.ts`
- `packages/core/src/runtime/adapters/source-adapter.ts`

---

## 7. Prochaines étapes

1. **Explorer en détail chaque parser** pour comprendre:
   - Structure exacte des nodes créés
   - Champs utilisés pour embeddings
   - Comment injecter des métadonnées custom

2. **Créer UploadSourceAdapter** qui:
   - Lit les fichiers depuis Prisma (ou S3)
   - Délègue au bon parser via ParserRegistry
   - Injecte les métadonnées community-docs

3. **Intégrer avec l'API server** (port 6970):
   - Endpoint `/ingest` appelle UploadSourceAdapter
   - Endpoint `/search` utilise les embeddings générés
