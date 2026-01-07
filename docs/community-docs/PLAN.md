# Plan: Community Docs Hub

## Objectif
Créer un site web Next.js pour une communauté Discord de développeurs permettant:
- Authentification avec rôles (read/write) via Discord OAuth
- Upload de documentation par catégorie
- Ingestion de repos GitHub
- Recherche sémantique avec filtres

**Phase 2 (post-MVP)**: Research Agent avec Claude native tool calling

---

## Décisions Techniques

| Question | Choix |
|----------|-------|
| **Hébergement** | Serveur dédié avec Docker Compose |
| **Modèle Claude** | claude-sonnet-4 (pour phase 2) |
| **MVP Scope** | Auth + Upload + Search |
| **Nom projet** | Community Docs Hub |

---

## Architecture Technique

### Stack
| Composant | Technologie | Justification |
|-----------|-------------|---------------|
| Frontend | Next.js 16 + App Router | Déjà utilisé dans luciform-hub |
| Styling | Tailwind CSS v4 | Cohérence avec l'existant |
| Auth | NextAuth.js v5 | Discord OAuth natif |
| Database | PostgreSQL + Prisma | Users, catégories, metadata |
| Graph DB | Neo4j (Docker) | Ingestion RagForge existante |
| File Storage | Local filesystem (MVP) | Simplicité, avec abstraction VFS prévue |
| Deployment | Docker Compose | Tout-en-un sur serveur dédié |

### Abstraction de Stockage (VFS)

Pour faciliter une future migration vers S3/R2, on prévoit dès maintenant une couche d'abstraction:

```
┌─────────────────────────────────────────────────────┐
│                   Application                        │
├─────────────────────────────────────────────────────┤
│              StorageService (abstrait)              │
├──────────┬──────────┬──────────┬───────────────────┤
│  LOCAL   │    S3    │  GITHUB  │      INLINE       │
│ (MVP)    │ (future) │ (ref)    │   (small files)   │
└──────────┴──────────┴──────────┴───────────────────┘
```

**Principe**: Le contenu est déjà stocké dans Neo4j (`source`, `textContent`), donc le stockage physique n'est nécessaire que pour l'ingestion initiale. Le `virtualPath` permet de découpler l'affichage du stockage réel.

### Structure du Projet
```
packages/community-docs/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── callback/
│   ├── (dashboard)/
│   │   ├── search/           # Recherche avec filtres
│   │   ├── browse/           # Navigation par catégorie
│   │   ├── ask/              # Research Agent Q&A
│   │   └── upload/           # Upload docs (write only)
│   ├── api/
│   │   ├── auth/[...nextauth]/
│   │   ├── ingest/
│   │   │   ├── github/       # Clone + ingest repo
│   │   │   ├── upload/       # Upload ZIP/docs
│   │   │   └── status/       # Job status
│   │   ├── search/           # Recherche sémantique
│   │   └── ask/              # Research Agent endpoint
│   ├── layout.tsx
│   └── page.tsx              # Landing page
├── components/
│   ├── ui/                   # Composants shadcn/ui
│   ├── search/
│   ├── upload/
│   └── chat/
├── lib/
│   ├── auth.ts               # NextAuth config
│   ├── db.ts                 # Prisma client
│   ├── ragforge.ts           # Wrapper RagForge
│   └── claude.ts             # Claude API client
├── prisma/
│   └── schema.prisma
└── package.json
```

---

## Phase 1: Foundation (Semaine 1)

### 1.1 Setup Projet
- [ ] Créer le package `community-docs` dans le monorepo
- [ ] Configurer Next.js 16 + Tailwind v4
- [ ] Setup Prisma + PostgreSQL
- [ ] Configurer ESLint/TypeScript

### 1.2 Authentification Discord
- [ ] NextAuth.js v5 avec Discord provider
- [ ] Prisma schema pour User avec rôle:
```prisma
model User {
  id            String    @id @default(cuid())
  discordId     String    @unique
  username      String
  avatar        String?
  role          Role      @default(READ)
  createdAt     DateTime  @default(now())
  uploads       Upload[]
}

enum Role {
  READ
  WRITE
  ADMIN
}
```
- [ ] Middleware de protection des routes
- [ ] UI login/logout

### 1.3 Layout de Base
- [ ] Navigation header avec auth status
- [ ] Sidebar catégories
- [ ] Footer
- [ ] Dark theme (style luciform-hub)

---

## Phase 2: Système de Catégories & Upload (Semaine 2)

### 2.1 Modèle de Données
```prisma
model Category {
  id          String    @id @default(cuid())
  name        String    @unique
  slug        String    @unique
  description String?
  icon        String?
  documents   Document[]
  createdAt   DateTime  @default(now())
}

model Document {
  id          String      @id @default(cuid())
  title       String
  description String?
  type        DocType

  // Storage abstraction (VFS)
  storageType StorageType @default(LOCAL)
  storageRef  String      // UUID fichier ou path relatif
  virtualPath String      // "/category/project/README.md" (affichage)
  sourceUrl   String?     // GitHub URL (pour GITHUB type)

  // Relations
  categoryId  String
  category    Category    @relation(...)
  uploadedBy  String
  user        User        @relation(...)

  // Neo4j link
  projectId   String      // ID Neo4j project

  // Status
  status      DocStatus   @default(PENDING)
  nodeCount   Int         @default(0)
  createdAt   DateTime    @default(now())
  ingestedAt  DateTime?
}

// Storage backend abstraction
enum StorageType {
  LOCAL       // Filesystem local (MVP)
  S3          // S3/R2 (future)
  GITHUB      // Référence GitHub (pas de stockage, juste URL)
  INLINE      // Petit contenu directement en BDD
}

enum DocType {
  GITHUB_REPO
  ZIP_ARCHIVE
  MARKDOWN
  PDF
}

enum DocStatus {
  PENDING
  INGESTING
  READY
  ERROR
}
```

### 2.2 Upload Interface (Write Users)
- [ ] Formulaire upload avec:
  - Sélection catégorie
  - Titre + description
  - Type: GitHub URL ou fichier
  - Validation des inputs
- [ ] Preview avant soumission
- [ ] Progress indicator pendant ingestion

### 2.3 API Ingestion
- [ ] `POST /api/ingest/github`
  - Clone repo dans temp dir
  - Appel RagForge `quickIngest()`
  - Cleanup après ingestion
- [ ] `POST /api/ingest/upload`
  - Save fichier (local/S3)
  - Dézip si nécessaire
  - Appel RagForge `quickIngest()`
- [ ] `GET /api/ingest/status/:id`
  - Status de l'ingestion
  - Node count, errors

### 2.4 Wrapper RagForge Simplifié
```typescript
// lib/ragforge.ts
import { BrainManager } from '@luciformresearch/ragforge';

export class CommunityBrain {
  private brain: BrainManager;

  async ingestGitHub(url: string, categorySlug: string): Promise<string> {
    const projectId = `github-${slugify(url)}`;
    const tempDir = await cloneRepo(url);
    await this.brain.quickIngest(tempDir, {
      projectId,
      generateEmbeddings: true
    });
    await cleanup(tempDir);
    return projectId;
  }

  async ingestUpload(filePath: string, categorySlug: string): Promise<string> {
    // Similar logic
  }

  async search(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
    return this.brain.search({
      query,
      semantic: true,
      projects: filters?.projectIds,
      types: filters?.nodeTypes
    });
  }
}
```

---

## Phase 3: Recherche & Navigation (Semaine 3)

### 3.1 Page Browse
- [ ] Liste des catégories avec icônes
- [ ] Documents par catégorie
- [ ] Filtres: type, date, auteur
- [ ] Pagination

### 3.2 Page Search
- [ ] Barre de recherche principale
- [ ] Filtres latéraux:
  - Catégories (checkboxes)
  - Types de nodes (Scope, MarkdownSection, etc.)
  - Date d'ingestion
- [ ] Résultats avec:
  - Score de pertinence
  - Snippet avec highlight
  - Source (fichier, ligne)
  - Lien vers le contenu complet

### 3.3 API Search
- [ ] `POST /api/search`
```typescript
interface SearchRequest {
  query: string;
  filters?: {
    categories?: string[];
    nodeTypes?: string[];
    dateRange?: { from: Date; to: Date };
  };
  limit?: number;
  offset?: number;
}
```

---

## Phase 4: Polish & Deploy (Semaine 4)

### 4.1 UI/UX
- [ ] Loading states
- [ ] Error handling
- [ ] Toast notifications
- [ ] Responsive design
- [ ] Animations (Framer Motion)

### 4.2 Admin Features
- [ ] Dashboard admin:
  - Gestion users (promouvoir/rétrograder)
  - Gestion catégories
  - Stats d'usage
  - Logs d'ingestion

### 4.3 Sécurité
- [ ] Rate limiting API
- [ ] Validation inputs (zod)
- [ ] CORS configuration
- [ ] Sanitization des uploads

### 4.4 Deployment
- [ ] Docker Compose:
  - App Next.js
  - PostgreSQL
  - Neo4j
- [ ] Variables d'environnement:
  - `DISCORD_CLIENT_ID/SECRET`
  - `CLAUDE_API_KEY`
  - `DATABASE_URL`
  - `NEO4J_URI/USER/PASSWORD`
- [ ] CI/CD (GitHub Actions)

---

## Estimation Effort (MVP)

| Phase | Durée | Priorité |
|-------|-------|----------|
| 1. Foundation | 3-4 jours | P0 |
| 2. Upload/Ingest | 4-5 jours | P0 |
| 3. Search | 3-4 jours | P0 |
| 4. Polish/Deploy | 3-4 jours | P0 |

**Total MVP: ~2-3 semaines**

---

## Phase 5 (Post-MVP): Research Agent avec Claude

À implémenter après le MVP:
- Claude Native Tool Calling Provider (`AnthropicNativeToolProvider`)
- Page Q&A avec interface chat
- API `/api/ask` avec streaming
- Intégration Research Agent avec claude-sonnet-4

---

## Fichiers Critiques à Créer (MVP)

### Nouveau package:
```
packages/community-docs/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (dashboard)/search/page.tsx
│   ├── (dashboard)/browse/page.tsx
│   ├── (dashboard)/upload/page.tsx      # Write users only
│   ├── api/auth/[...nextauth]/route.ts
│   ├── api/ingest/github/route.ts
│   ├── api/ingest/upload/route.ts
│   ├── api/search/route.ts
│   ├── layout.tsx
│   └── page.tsx
├── components/ui/                        # shadcn/ui
├── lib/
│   ├── auth.ts                          # NextAuth config
│   ├── db.ts                            # Prisma client
│   └── ragforge.ts                      # Wrapper simplifié
├── prisma/schema.prisma
├── docker-compose.yml
├── Dockerfile
└── package.json
```

### Fichiers existants à utiliser (lecture seule):
- `packages/core/src/brain/brain-manager.ts` - `quickIngest()`, `search()`
- `packages/core/src/brain/embedding-service.ts` - Génération embeddings
- `packages/core/src/utils/node-schema.ts` - Types de nodes

### Post-MVP (Phase 5):
- `packages/core/src/runtime/llm/native-tool-calling/providers/anthropic.ts` - À créer
- `packages/core/src/runtime/agents/research-agent.ts` - À adapter
