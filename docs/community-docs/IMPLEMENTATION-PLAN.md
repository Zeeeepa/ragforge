# Plan d'Implémentation: Community Docs Hub + RagForge Integration

> Consolidation de PLAN.md et ragforge-pipeline-analysis.md
> Date: 3 janvier 2025

---

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMMUNITY DOCS HUB                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Next.js    │    │  PostgreSQL  │    │    Neo4j     │                  │
│  │   Frontend   │◄──►│   (Prisma)   │    │  (port 7688) │                  │
│  │   + API      │    │   Users,     │    │  Documents,  │                  │
│  │              │    │   Categories │    │  Embeddings  │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│         │                                       ▲                           │
│         │                                       │                           │
│         ▼                                       │                           │
│  ┌──────────────────────────────────────────────┴──────────────────────┐   │
│  │                    Community Ingestion Service                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ Community   │  │ Document    │  │   Global    │  │  Ollama    │  │   │
│  │  │ Orchestrator│  │ Enrichment  │  │  Entity     │  │ Embeddings │  │   │
│  │  │ (RagForge)  │  │ Service     │  │ Resolution  │  │            │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Étape 0: Infrastructure (Pré-requis)

### 0.1 Docker Compose pour Neo4j dédié
**Fichier:** `packages/community-docs/docker-compose.yml`

```yaml
services:
  neo4j:
    image: neo4j:5.15.0
    container_name: community-docs-neo4j
    ports:
      - "7475:7474"  # Browser (différent de CLI: 7474)
      - "7688:7687"  # Bolt (différent de CLI: 7687)
    environment:
      - NEO4J_AUTH=neo4j/communitydocs
      - NEO4J_PLUGINS=["apoc"]
    volumes:
      - neo4j_data:/data

  postgres:
    image: postgres:16
    container_name: community-docs-postgres
    ports:
      - "5433:5432"
    environment:
      - POSTGRES_USER=community
      - POSTGRES_PASSWORD=community
      - POSTGRES_DB=community_docs
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  neo4j_data:
  postgres_data:
```

### 0.2 Variables d'environnement
**Fichier:** `packages/community-docs/.env`

```env
# PostgreSQL
DATABASE_URL="postgresql://community:community@localhost:5433/community_docs"

# Neo4j dédié (ISOLÉ du CLI RagForge)
COMMUNITY_NEO4J_URI=bolt://localhost:7688
COMMUNITY_NEO4J_USER=neo4j
COMMUNITY_NEO4J_PASSWORD=communitydocs

# Ollama (local embeddings)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBEDDING_MODEL=mxbai-embed-large

# Claude (LLM enrichment)
ANTHROPIC_API_KEY=...

# Discord OAuth
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3001
```

### 0.3 Démarrer l'infrastructure
```bash
cd packages/community-docs
docker compose up -d
npx prisma db push
```

**Checklist:**
- [x] Docker Compose créé *(4 janv 2025)*
- [x] .env configuré *(3 janv 2025)*
- [x] Neo4j accessible sur port 7688 *(4 janv 2025)*
- [ ] PostgreSQL accessible sur port 5433
- [x] Ollama running avec mxbai-embed-large *(3 janv 2025)*

---

## Étape 1: Foundation Next.js

### 1.1 Structure de base
- [ ] `app/layout.tsx` - Layout principal avec navigation
- [ ] `app/page.tsx` - Landing page
- [ ] `app/(auth)/login/page.tsx` - Page login Discord
- [ ] `app/(dashboard)/layout.tsx` - Layout dashboard
- [ ] `components/ui/` - Composants shadcn/ui de base

### 1.2 Authentification Discord
- [ ] `lib/auth.ts` - Configuration NextAuth.js v5
- [ ] `app/api/auth/[...nextauth]/route.ts` - Route handler
- [ ] `middleware.ts` - Protection des routes
- [ ] Prisma schema User avec rôles (READ/WRITE/ADMIN)

### 1.3 Prisma Schema complet
**Fichier:** `prisma/schema.prisma`

```prisma
model User {
  id            String    @id @default(cuid())
  discordId     String    @unique
  username      String
  avatar        String?
  role          Role      @default(READ)
  documents     Document[]
  createdAt     DateTime  @default(now())
}

enum Role {
  READ
  WRITE
  ADMIN
}

model Category {
  id          String      @id @default(cuid())
  name        String      @unique
  slug        String      @unique
  description String?
  icon        String?
  documents   Document[]
  createdAt   DateTime    @default(now())
}

model Document {
  id            String      @id @default(cuid())
  title         String
  description   String?
  type          DocType

  // Storage
  storageType   StorageType @default(LOCAL)
  storageRef    String
  virtualPath   String
  sourceUrl     String?

  // Relations
  category      Category    @relation(fields: [categoryId], references: [id])
  categoryId    String
  uploadedBy    User        @relation(fields: [uploadedById], references: [id])
  uploadedById  String

  // Neo4j link
  projectId     String?

  // LLM Enrichment results
  llmTitle      String?
  llmDescription String?
  llmTags       String[]
  suggestedCategoryId String?

  // Status
  status        DocStatus   @default(PENDING)
  nodeCount     Int         @default(0)
  createdAt     DateTime    @default(now())
  ingestedAt    DateTime?
  enrichedAt    DateTime?
}

enum StorageType {
  LOCAL
  S3
  GITHUB
  INLINE
}

enum DocType {
  GITHUB_REPO
  ZIP_ARCHIVE
  MARKDOWN
  PDF
  DOCX
  XLSX
  IMAGE
}

enum DocStatus {
  PENDING
  INGESTING
  ENRICHING
  READY
  ERROR
}
```

**Checklist:**
- [ ] Next.js 16 + App Router configuré
- [ ] Tailwind CSS v4 configuré
- [ ] NextAuth.js v5 avec Discord
- [ ] Prisma schema créé et migré
- [ ] UI login/logout fonctionnel

---

## Étape 2: RagForge Integration Layer

### 2.1 Community Orchestrator (Isolation garantie)
**Fichier:** `lib/ragforge/community-orchestrator.ts`

Créer l'orchestrator avec notre propre driver Neo4j (port 7688), complètement isolé du CLI.

```typescript
import neo4j from 'neo4j-driver';
import {
  IngestionOrchestrator,
  UniversalSourceAdapter,
  IncrementalIngestionManager,
  type OrchestratorDependencies,
} from '@ragforge/core';

export function createCommunityOrchestrator() {
  const driver = neo4j.driver(
    process.env.COMMUNITY_NEO4J_URI!,
    neo4j.auth.basic(
      process.env.COMMUNITY_NEO4J_USER!,
      process.env.COMMUNITY_NEO4J_PASSWORD!
    )
  );
  // ... (voir ragforge-pipeline-analysis.md section 5.3)
}
```

### 2.2 Embedding Service (Ollama)
**Fichier:** `lib/ragforge/embedding-service.ts`

Réutiliser `OllamaEmbeddingProvider` de @ragforge/core avec notre config.

### 2.3 Neo4j Client
**Fichier:** `lib/ragforge/neo4j-client.ts`

Client wrapper pour les opérations Neo4j (search, delete, update metadata).

### 2.4 Types
**Fichier:** `lib/ragforge/types.ts`

```typescript
export interface CommunityNodeMetadata {
  documentId: string;
  documentTitle: string;
  userId: string;
  userUsername?: string;
  categoryId: string;
  categorySlug: string;
  categoryName?: string;
  isPublic: boolean;
}

export interface EnrichmentOptions {
  enableLLMEnrichment: boolean;
  generateDescriptions: boolean;
  extractEntities: boolean;
  suggestCategory: boolean;
  extractTags: boolean;
  enableVision: boolean;
  analyzeImages: boolean;
  analyze3D: boolean;
  enableOCR: boolean;
}
```

**Checklist:**
- [ ] `community-orchestrator.ts` créé *(remplacé par API server)*
- [x] `embedding-service.ts` créé (OllamaEmbeddingService) *(3 janv 2025)*
- [x] `neo4j-client.ts` créé *(3 janv 2025)*
- [x] `types.ts` créé *(3 janv 2025)*
- [x] Test: ingestion simple fonctionne sur port 7688 *(4 janv 2025)*

---

## Étape 3: Document Enrichment Service (LLM)

### 3.1 Enrichment Service
**Fichier:** `lib/ragforge/enrichment-service.ts`

Service qui enrichit les documents parsés avec:
- Descriptions per-node
- Extraction d'entités (personnes, organisations, lieux, dates)
- Tags thématiques
- Synthèse globale (titre, description, catégorie suggérée)

Utilise `StructuredLLMExecutor.executeLLMBatch()` de @ragforge/core.

### 3.2 Entity Types
**Fichier:** `lib/ragforge/entity-types.ts`

Types pour Person, Organization, Location, Concept, etc.

### 3.3 Vision Enrichment (optionnel)
**Fichier:** `lib/ragforge/vision-enrichment.ts`

Enrichissement des images et modèles 3D via Gemini Vision.

**Checklist:**
- [ ] `enrichment-service.ts` créé
- [ ] `entity-types.ts` créé
- [ ] `vision-enrichment.ts` créé (stub pour l'instant)
- [ ] Test: enrichment génère descriptions et tags

---

## Étape 4: Global Entity Resolution Service

### 4.1 Resolution Service
**Fichier:** `lib/ragforge/entity-resolution-service.ts`

Service asynchrone qui:
1. Query toutes les entités non-résolues de Neo4j
2. Utilise LLM pour identifier les duplicats cross-documents
3. Merge dans Neo4j (alias → canonical)
4. Normalise les tags

### 4.2 API Endpoint
**Fichier:** `app/api/admin/resolve-entities/route.ts`

Endpoint admin pour déclencher la résolution manuellement.

### 4.3 Cron Job (optionnel)
Résolution périodique automatique après batch uploads.

**Checklist:**
- [ ] `entity-resolution-service.ts` créé
- [ ] API endpoint `/api/admin/resolve-entities` créé
- [ ] Test: résolution merge correctement les duplicats

---

## Étape 5: Upload & Ingestion API

### 5.1 Upload Route
**Fichier:** `app/api/ingest/upload/route.ts`

```typescript
export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file');
  const options = JSON.parse(formData.get('options') as string);

  // 1. Créer Document en PENDING
  // 2. Sauvegarder fichier
  // 3. Lancer ingestion (async)
  // 4. Retourner documentId
}
```

### 5.2 GitHub Route
**Fichier:** `app/api/ingest/github/route.ts`

Clone repo → ingest → cleanup.

### 5.3 Community Ingestion Service
**Fichier:** `lib/ragforge/ingestion-service.ts`

Orchestre le flow complet:
1. Parse avec CommunityOrchestrator
2. Injecte CommunityNodeMetadata
3. Enrichit avec DocumentEnrichmentService (si options.enableLLMEnrichment)
4. Crée entités dans Neo4j
5. Génère embeddings
6. Met à jour Document status dans Postgres

### 5.4 Status Route
**Fichier:** `app/api/ingest/status/[id]/route.ts`

Retourne le status d'ingestion d'un document.

**Checklist:**
- [x] `ingestion-service.ts` créé → `api/server.ts` + `api-client.ts` *(4 janv 2025)*
- [x] `app/api/ingest/upload/route.ts` créé + triggerIngestion *(4 janv 2025)*
- [ ] `app/api/ingest/github/route.ts` créé *(stub existant)*
- [ ] `app/api/ingest/status/[id]/route.ts` créé
- [ ] Test: upload → ingestion → READY *(need parsers for PDF/DOCX)*

---

## Étape 6: Search API & UI

### 6.1 Search Service
**Fichier:** `lib/ragforge/search-service.ts`

Recherche sémantique avec filtres (categoryId, userId, tags, etc.).

### 6.2 Search API
**Fichier:** `app/api/search/route.ts`

```typescript
export async function POST(req: Request) {
  const { query, filters, limit } = await req.json();
  const results = await searchService.search(query, filters, { limit });
  return Response.json({ results });
}
```

### 6.3 Search UI
**Fichier:** `app/(dashboard)/search/page.tsx`

- Barre de recherche
- Filtres (catégories, types, tags extraits)
- Résultats avec snippets et scores
- Navigation vers le document source

### 6.4 Browse UI
**Fichier:** `app/(dashboard)/browse/page.tsx`

- Liste des catégories
- Documents par catégorie
- Preview des métadonnées LLM

**Checklist:**
- [x] `search-service.ts` créé → via `api/server.ts` *(3 janv 2025)*
- [x] `app/api/search/route.ts` intégré avec API client *(4 janv 2025)*
- [ ] `app/(dashboard)/search/page.tsx` créé
- [ ] `app/(dashboard)/browse/page.tsx` créé
- [ ] Test: recherche retourne des résultats pertinents

---

## Étape 7: Upload UI avec Options d'Enrichissement

### 7.1 Upload Form
**Fichier:** `app/(dashboard)/upload/page.tsx`

Formulaire avec:
- Sélection catégorie
- Titre + description
- Type (GitHub URL / fichier)
- **Checkboxes d'enrichissement:**

```tsx
<fieldset>
  <legend>LLM Enrichment</legend>
  <Checkbox name="enableLLMEnrichment" label="Enable AI analysis" />

  {enableLLMEnrichment && (
    <>
      <Checkbox name="generateDescriptions" label="Generate descriptions" />
      <Checkbox name="extractEntities" label="Extract entities (people, places...)" />
      <Checkbox name="suggestCategory" label="Suggest category" />
      <Checkbox name="extractTags" label="Extract tags" />
    </>
  )}
</fieldset>

<fieldset>
  <legend>Vision Analysis</legend>
  <Checkbox name="enableVision" label="Enable vision for media" />

  {enableVision && (
    <>
      <Checkbox name="analyzeImages" label="Describe images" />
      <Checkbox name="analyze3D" label="Analyze 3D models" />
      <Checkbox name="enableOCR" label="OCR on scanned docs" />
    </>
  )}
</fieldset>
```

### 7.2 Upload Progress
Afficher le status en temps réel (PENDING → INGESTING → ENRICHING → READY).

**Checklist:**
- [ ] `app/(dashboard)/upload/page.tsx` créé
- [ ] Checkboxes d'enrichissement fonctionnels
- [ ] Progress indicator en temps réel
- [ ] Test: upload avec enrichissement LLM activé

---

## Étape 8: Entities & Tags UI

### 8.1 Document Detail Page
**Fichier:** `app/(dashboard)/docs/[id]/page.tsx`

Affiche:
- Métadonnées LLM (titre, description générée)
- Entités extraites (personnes, organisations, lieux)
- Tags
- Contenu chunké

### 8.2 Entities API
**Fichier:** `app/api/docs/[id]/entities/route.ts`

Retourne les entités liées à un document.

### 8.3 Tags Browser
**Fichier:** `app/(dashboard)/tags/page.tsx`

Navigation par tags avec compteurs.

**Checklist:**
- [ ] `app/(dashboard)/docs/[id]/page.tsx` créé
- [ ] `app/api/docs/[id]/entities/route.ts` créé
- [ ] `app/(dashboard)/tags/page.tsx` créé
- [ ] Affichage des entités et tags fonctionnel

---

## Étape 9: Admin Dashboard

### 9.1 Admin Layout
**Fichier:** `app/(admin)/layout.tsx`

Protection ADMIN role.

### 9.2 Entity Resolution UI
**Fichier:** `app/(admin)/entities/page.tsx`

- Bouton "Run Entity Resolution"
- Log des merges effectués
- Stats (entités mergées, tags normalisés)

### 9.3 Users Management
**Fichier:** `app/(admin)/users/page.tsx`

Gérer les rôles des utilisateurs.

### 9.4 Categories Management
**Fichier:** `app/(admin)/categories/page.tsx`

CRUD catégories.

**Checklist:**
- [ ] Layout admin protégé
- [ ] UI resolution d'entités
- [ ] Gestion users
- [ ] Gestion catégories

---

## Étape 10: Polish & Deploy

### 10.1 UI/UX
- [ ] Loading states (skeletons)
- [ ] Error handling (toast notifications)
- [ ] Responsive design
- [ ] Dark theme

### 10.2 Sécurité
- [ ] Rate limiting API
- [ ] Validation inputs (zod)
- [ ] Sanitization uploads
- [ ] CORS configuration

### 10.3 Production Docker Compose
**Fichier:** `docker-compose.prod.yml`

Ajouter:
- Next.js build
- Nginx reverse proxy
- SSL/TLS

### 10.4 CI/CD
- [ ] GitHub Actions pour build/test
- [ ] Deploy automatique

---

## Résumé des Fichiers à Créer

### Infrastructure
```
packages/community-docs/
├── docker-compose.yml
├── .env
└── prisma/schema.prisma
```

### RagForge Integration
```
lib/ragforge/
├── index.ts                      # Exports
├── community-orchestrator.ts     # Orchestrator avec notre driver
├── embedding-service.ts          # Wrapper OllamaEmbeddingProvider
├── neo4j-client.ts               # Client Neo4j
├── types.ts                      # Types (CommunityNodeMetadata, etc.)
├── ingestion-service.ts          # Flow complet d'ingestion
├── enrichment-service.ts         # LLM extraction (descriptions, entities)
├── entity-resolution-service.ts  # Résolution globale cross-docs
├── search-service.ts             # Recherche sémantique
└── vision-enrichment.ts          # Vision pour images/3D
```

### API Routes
```
app/api/
├── auth/[...nextauth]/route.ts
├── ingest/
│   ├── upload/route.ts
│   ├── github/route.ts
│   └── status/[id]/route.ts
├── search/route.ts
├── docs/[id]/
│   ├── route.ts                  # GET, DELETE, PATCH
│   └── entities/route.ts
└── admin/
    └── resolve-entities/route.ts
```

### Pages
```
app/
├── (auth)/login/page.tsx
├── (dashboard)/
│   ├── search/page.tsx
│   ├── browse/page.tsx
│   ├── upload/page.tsx
│   ├── docs/[id]/page.tsx
│   └── tags/page.tsx
└── (admin)/
    ├── entities/page.tsx
    ├── users/page.tsx
    └── categories/page.tsx
```

---

## Priorités

| Étape | Priorité | Dépendances |
|-------|----------|-------------|
| 0. Infrastructure | P0 | - |
| 1. Foundation Next.js | P0 | Étape 0 |
| 2. RagForge Integration | P0 | Étape 0, 1 |
| 3. Enrichment Service | P1 | Étape 2 |
| 4. Entity Resolution | P1 | Étape 3 |
| 5. Upload API | P0 | Étape 2 |
| 6. Search API & UI | P0 | Étape 2 |
| 7. Upload UI | P0 | Étape 5 |
| 8. Entities UI | P1 | Étape 3, 4 |
| 9. Admin Dashboard | P2 | Étape 4 |
| 10. Polish & Deploy | P1 | All |

**MVP (P0):** Étapes 0, 1, 2, 5, 6, 7
**V1 (P0+P1):** + Étapes 3, 4, 8, 10
**V2 (All):** + Étape 9, Research Agent

---

## Notes Importantes

### Isolation des Bases de Données
- CLI RagForge: `localhost:7687` (ne pas toucher)
- Community-Docs: `localhost:7688` (notre instance dédiée)
- L'orchestrator utilise l'injection de dépendances → aucun risque de collision

### LLM Calls
- **Ingestion:** 2 appels LLM par document (extraction + synthèse)
- **Résolution:** 1 appel LLM pour N entités (batch efficient)
- Provider: Claude via `StructuredLLMExecutor`

### Embeddings
- Provider: Ollama local (mxbai-embed-large, 1024 dims)
- Gratuit et rapide
- Réutilise `OllamaEmbeddingProvider` de @ragforge/core

---

## Historique des Mises à Jour

### 4 janvier 2025 - Intégration Next.js + API

**Fichiers créés:**
- `lib/ragforge/api-client.ts` - Client HTTP pour appeler l'API RagForge depuis Next.js
- `.claude/CLAUDE.md` - Documentation des préférences d'outils

**Fichiers modifiés:**
- `lib/ragforge/index.ts` - Ajout exports pour api-client
- `lib/ragforge/api/server.ts` - Fix imports (suppression extensions .js)
- `app/api/ingest/upload/route.ts` - Ajout triggerIngestion async
- `app/api/search/route.ts` - Intégration API client
- `app/api/docs/[id]/route.ts` - Ajout cascade delete Neo4j

**Configuration Monorepo:**
- `turbo.json` - Pipeline avec inputs/outputs explicites
- `package.json` (root) - Scripts indépendants: `core:build`, `cli:build`, `hub:build`
- `packages/community-docs/package.json` - Utilisation `--webpack` (Turbopack incompatible monorepo npm)

**Architecture API:**
```
Community Docs API (port 6970)
├── POST /ingest        - Ingestion document complet
├── POST /ingest/chunks - Ingestion par chunks
├── POST /search        - Recherche sémantique avec filtres
├── DELETE /document/:id - Suppression avec cascade
├── PATCH /document/:id - Update métadonnées
├── POST /indexes/ensure-vector - Création index
├── GET /health, /status
└── POST /shutdown
```

**Limitations connues:**
- PDF/DOCX/images ingérés avec placeholder (besoin parsers @ragforge/core)
- GitHub adapter non implémenté

### 3 janvier 2025 - API Server Initial

**Fichiers créés:**
- `lib/ragforge/api/server.ts` - Serveur Fastify port 6970
- `lib/ragforge/neo4j-client.ts` - Client Neo4j port 7688
- `lib/ragforge/embedding-service.ts` - OllamaEmbeddingService (mxbai-embed-large)
- `lib/ragforge/types.ts` - CommunityNodeMetadata, SearchResult, etc.
- `docker-compose.yml` - Neo4j dédié port 7688

---

## Prochaines Étapes Prioritaires

1. **LocalVFSAdapter** - Parser binaires (PDF, DOCX, images) via @ragforge/core
2. **UI Search/Browse** - Pages `app/(dashboard)/search` et `browse`
3. **GitHubSourceAdapter** - Ingestion repos GitHub
4. **LLM Enrichment** - Extraction entités, génération descriptions
