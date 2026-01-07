# Plan: RagForge Integration for Community-Docs

## Objectif
Intégrer RagForge dans community-docs pour l'ingestion et la recherche sémantique de documents, avec filtrage efficace par utilisateur/catégorie directement dans Neo4j.

---

## Architecture Proposée

```
┌─────────────────────────────────────────────────────────────┐
│                    @ragforge/core                           │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────────┐   │
│  │   Parsers   │  │  Embeddings │  │  Neo4j Abstracted │   │
│  │ (unchanged) │  │   Service   │  │     Client        │   │
│  └─────────────┘  └─────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────┘
              │                              │
              ▼                              ▼
┌──────────────────────┐        ┌────────────────────────────┐
│   RagForge CLI/MCP   │        │    community-docs          │
│                      │        │                            │
│ Source: FileSystem   │        │ Source: VFSAdapter         │
│ Neo4j: ~/.ragforge   │        │ Neo4j: community_docs_neo4j│
│ Watcher: chokidar    │        │ Trigger: API/Webhooks      │
│                      │        │ Metadata: userId,          │
│                      │        │   categoryId, documentId   │
└──────────────────────┘        └────────────────────────────┘
```

---

## Phase 1: Infrastructure Neo4j Dédiée

### 1.1 Docker Compose pour community-docs
**Fichier:** `packages/community-docs/docker-compose.yml`

```yaml
services:
  neo4j:
    image: neo4j:5.15.0
    container_name: community-docs-neo4j
    ports:
      - "7475:7474"  # Browser (différent de 7474 CLI)
      - "7688:7687"  # Bolt (différent de 7687 CLI)
    environment:
      - NEO4J_AUTH=neo4j/communitydocs
      - NEO4J_PLUGINS=["apoc"]
      - NEO4J_apoc_export_file_enabled=true
      - NEO4J_apoc_import_file_enabled=true
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
volumes:
  neo4j_data:
  neo4j_logs:
```

### 1.2 Variables d'environnement
**Fichier:** `packages/community-docs/.env`
```
# Neo4j dédié (différent du CLI RagForge)
COMMUNITY_NEO4J_URI=bolt://localhost:7688
COMMUNITY_NEO4J_USER=neo4j
COMMUNITY_NEO4J_PASSWORD=communitydocs

# Embeddings (peut être partagé)
GEMINI_API_KEY=...
```

---

## Phase 2: Extension du Schéma Neo4j

### 2.1 Propriétés additionnelles sur tous les nœuds
```typescript
interface CommunityNodeMetadata {
  // Identité document
  documentId: string;      // UUID du Document Postgres
  documentTitle: string;   // Pour affichage

  // Filtrage utilisateur
  userId: string;          // ID de l'uploader
  userUsername: string;    // Pour affichage

  // Filtrage catégorie
  categoryId: string;      // ID catégorie
  categorySlug: string;    // Pour URLs
  categoryName: string;    // Pour affichage

  // Permissions
  isPublic: boolean;       // Visible par tous (défaut: true)

  // Tags (futur)
  tags?: string[];
}
```

### 2.2 Index additionnels
```cypher
-- Index pour filtrage rapide
CREATE INDEX node_documentId FOR (n:Scope) ON (n.documentId)
CREATE INDEX node_userId FOR (n:Scope) ON (n.userId)
CREATE INDEX node_categoryId FOR (n:Scope) ON (n.categoryId)
CREATE INDEX node_categorySlug FOR (n:Scope) ON (n.categorySlug)

-- Index composite pour requêtes courantes
CREATE INDEX node_category_user FOR (n:Scope) ON (n.categoryId, n.userId)
```

---

## Phase 3: VFS Adapter pour Ingestion

### 3.1 Interface Source Adapter
**Fichier:** `packages/community-docs/lib/ragforge/source-adapter.ts`

```typescript
interface SourceAdapter {
  // Lister les fichiers à ingérer
  listFiles(options: ListOptions): AsyncGenerator<FileEntry>;

  // Lire le contenu d'un fichier
  readFile(path: string): Promise<Buffer>;

  // Métadonnées du document
  getMetadata(): CommunityNodeMetadata;
}

// Implémentation pour VFS Local
class LocalVFSAdapter implements SourceAdapter {
  constructor(
    private document: Document,
    private uploadDir: string
  ) {}

  async *listFiles(): AsyncGenerator<FileEntry> {
    const filePath = join(this.uploadDir, this.document.storageRef);

    if (this.document.type === 'ZIP_ARCHIVE') {
      // Extraire et lister récursivement
      yield* this.listZipContents(filePath);
    } else {
      // Fichier unique
      yield { path: filePath, type: this.document.type };
    }
  }

  getMetadata(): CommunityNodeMetadata {
    return {
      documentId: this.document.id,
      documentTitle: this.document.title,
      userId: this.document.uploadedById,
      categoryId: this.document.categoryId,
      categorySlug: this.document.category.slug,
      // ...
    };
  }
}

// Implémentation pour GitHub (futur)
class GitHubSourceAdapter implements SourceAdapter {
  // Clone temp → liste fichiers → cleanup
}
```

### 3.2 Modification des Parsers
Les parsers existants de RagForge restent inchangés. On injecte les métadonnées après le parsing:

```typescript
async function ingestDocument(document: Document) {
  const adapter = createSourceAdapter(document);
  const metadata = adapter.getMetadata();

  // Parser standard RagForge
  const parseResult = await parser.parse(await adapter.readFile(path));

  // Injection métadonnées sur tous les nœuds
  for (const node of parseResult.nodes) {
    Object.assign(node, metadata);
  }

  // Merge dans Neo4j
  await graphMerger.mergeGraph(parseResult);
}
```

---

## Phase 4: Service d'Ingestion

### 4.1 CommunityIngestionService
**Fichier:** `packages/community-docs/lib/ragforge/ingestion-service.ts`

```typescript
class CommunityIngestionService {
  private neo4j: Neo4jClient;
  private embeddingService: EmbeddingService;

  constructor(config: CommunityIngestionConfig) {
    // Connexion Neo4j dédiée
    this.neo4j = new Neo4jClient({
      uri: process.env.COMMUNITY_NEO4J_URI,
      // ...
    });
  }

  async ingestDocument(documentId: string): Promise<IngestionResult> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { category: true, uploadedBy: true }
    });

    // 1. Créer adapter selon storageType
    const adapter = this.createAdapter(document);

    // 2. Parser les fichiers
    const nodes = await this.parseFiles(adapter);

    // 3. Injecter métadonnées
    const metadata = adapter.getMetadata();
    nodes.forEach(n => Object.assign(n, metadata));

    // 4. Merge dans Neo4j
    await this.graphMerger.mergeGraph({ nodes, relationships });

    // 5. Générer embeddings
    await this.embeddingService.embedNodes(nodes);

    // 6. Mettre à jour status Postgres
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'READY',
        nodeCount: nodes.length,
        projectId: `doc-${documentId}`
      }
    });

    return { success: true, nodeCount: nodes.length };
  }

  async deleteDocument(documentId: string): Promise<void> {
    // Supprimer tous les nœuds avec ce documentId
    await this.neo4j.run(`
      MATCH (n {documentId: $documentId})
      DETACH DELETE n
    `, { documentId });
  }

  async updateDocumentMetadata(documentId: string, updates: Partial<CommunityNodeMetadata>): Promise<void> {
    // Mettre à jour métadonnées sur tous les nœuds
    await this.neo4j.run(`
      MATCH (n {documentId: $documentId})
      SET n += $updates
    `, { documentId, updates });
  }
}
```

---

## Phase 5: Service de Recherche

### 5.1 CommunitySearchService
**Fichier:** `packages/community-docs/lib/ragforge/search-service.ts`

```typescript
interface SearchFilters {
  categoryIds?: string[];
  categorySlug?: string;
  userIds?: string[];
  documentIds?: string[];
  isPublic?: boolean;
  tags?: string[];
}

class CommunitySearchService {
  async search(
    query: string,
    filters: SearchFilters,
    options: SearchOptions
  ): Promise<SearchResult[]> {

    // Construire WHERE clause depuis filtres
    const whereClauses: string[] = [];
    const params: Record<string, any> = { query };

    if (filters.categoryIds?.length) {
      whereClauses.push('n.categoryId IN $categoryIds');
      params.categoryIds = filters.categoryIds;
    }

    if (filters.categorySlug) {
      whereClauses.push('n.categorySlug = $categorySlug');
      params.categorySlug = filters.categorySlug;
    }

    if (filters.userIds?.length) {
      whereClauses.push('n.userId IN $userIds');
      params.userIds = filters.userIds;
    }

    // Recherche vectorielle avec filtres PRE-appliqués
    const results = await this.neo4j.run(`
      CALL db.index.vector.queryNodes('scope_embedding_content_vector', $topK, $embedding)
      YIELD node, score
      WHERE ${whereClauses.join(' AND ')}
        AND score >= $minScore
      RETURN node, score
      ORDER BY score DESC
      LIMIT $limit
    `, params);

    return results;
  }
}
```

---

## Phase 6: API Routes

### 6.1 Endpoint d'ingestion
**Fichier:** `app/api/ingest/process/route.ts`

```typescript
// POST /api/ingest/process
// Appelé après upload pour lancer l'ingestion
export async function POST(req: Request) {
  const { documentId } = await req.json();

  // Lancer ingestion en background
  await ingestionQueue.add({ documentId });

  return Response.json({ queued: true });
}
```

### 6.2 Endpoint de recherche amélioré
**Fichier:** `app/api/search/route.ts`

```typescript
// POST /api/search
export async function POST(req: Request) {
  const { query, filters, limit = 20 } = await req.json();

  const results = await searchService.search(query, filters, { limit });

  return Response.json({ results });
}
```

---

## Phase 7: Hooks et Incrémental

### 7.1 Triggers Prisma/API
```typescript
// Après création document → queue ingestion
// Après suppression document → supprimer nœuds Neo4j
// Après modification catégorie → mettre à jour métadonnées
```

### 7.2 Re-ingestion sélective
```typescript
async function reindexDocument(documentId: string) {
  // 1. Marquer nœuds existants dirty
  await neo4j.run(`
    MATCH (n {documentId: $documentId})
    SET n.__state__ = 'pending'
  `, { documentId });

  // 2. Re-parser et merger (préserve embeddings si contenu inchangé)
  await ingestionService.ingestDocument(documentId);
}
```

---

## Fichiers à Créer/Modifier

### Nouveaux fichiers:
1. `packages/community-docs/docker-compose.yml` - Neo4j dédié
2. `packages/community-docs/lib/ragforge/source-adapter.ts` - Adaptateurs VFS
3. `packages/community-docs/lib/ragforge/ingestion-service.ts` - Service ingestion
4. `packages/community-docs/lib/ragforge/search-service.ts` - Service recherche
5. `packages/community-docs/lib/ragforge/neo4j-client.ts` - Client Neo4j
6. `packages/community-docs/lib/ragforge/index.ts` - Exports

### Fichiers à modifier:
1. `packages/community-docs/.env` - Variables Neo4j
2. `packages/community-docs/app/api/search/route.ts` - Utiliser SearchService
3. `packages/community-docs/app/api/ingest/upload/route.ts` - Trigger ingestion
4. `packages/community-docs/app/api/ingest/github/route.ts` - Trigger ingestion
5. `packages/community-docs/app/api/docs/[id]/route.ts` - DELETE supprime Neo4j

---

## Questions Ouvertes

1. **Job Queue**: Utiliser une vraie queue (BullMQ) ou simple async?
2. **Partage parsers**: Importer depuis @ragforge/core ou copier?
3. **Permissions**: Documents privés visibles seulement par l'owner?

---

## Ajouts: Claude Provider (2025-01-03)

### Providers créés dans @ragforge/core:

1. **ClaudeAPIProvider** (`runtime/reranking/claude-api-provider.ts`)
   - Implémente `LLMProvider` pour StructuredLLMExecutor
   - Rate limiting avec retry logic
   - Batch processing avec concurrence limitée
   - Modèle par défaut: `claude-3-5-haiku-20241022`

2. **ClaudeNativeToolProvider** (`runtime/llm/native-tool-calling/providers/claude.ts`)
   - Implémente `NativeToolCallingProvider` pour tool calling natif
   - Support streaming
   - Conversion automatique OpenAI-style → Claude format

3. **ClaudeOCRProvider** (`runtime/ocr/ClaudeOCRProvider.ts`)
   - Vision/OCR avec Claude
   - Fallback quand Tesseract échoue
   - Description d'images et modèles 3D
   - Batch processing pour multiples images

### Configuration:
```env
# Embeddings (Ollama local)
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_EMBEDDING_MODEL="mxbai-embed-large"

# Claude LLM
ANTHROPIC_API_KEY="..."
```

---

## Ordre d'implémentation

1. [x] Setup Docker Neo4j dédié (port 7688)
2. [x] Créer Neo4jClient pour community-docs
3. [x] Créer Community API Server (port 6970) - **NOUVELLE ARCHITECTURE**
4. [x] Créer OllamaEmbeddingService (mxbai-embed-large, 1024 dims)
5. [x] Créer index vectoriel Neo4j
6. [x] Tester ingestion/search/delete via API
7. [x] Intégrer API avec routes Next.js (upload → POST /ingest) ✅ **4 janv 2025**
8. [ ] Implémenter LocalVFSAdapter pour fichiers uploadés (parsing binaires)
9. [x] Modifier search route pour utiliser l'API ✅ **4 janv 2025**
10. [ ] Ajouter GitHubSourceAdapter
11. [x] Configurer builds monorepo indépendants ✅ **4 janv 2025**

---

## Changement d'Architecture (3 janv 2025)

### API Séparée au lieu d'accès direct Neo4j

Plutôt que d'accéder directement à Neo4j depuis Next.js, on utilise une **API HTTP dédiée** inspirée du daemon RagForge CLI:

- **Port 6970** (séparé du daemon CLI sur 6969)
- **Fastify** pour les routes HTTP
- **Ollama** pour les embeddings (local, gratuit)
- **Neo4j dédié** sur port 7688

### Endpoints implémentés

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/health` | GET | Vérification santé |
| `/status` | GET | Status détaillé (Neo4j, Ollama) |
| `/ingest` | POST | Ingérer un document avec métadonnées |
| `/ingest/chunks` | POST | Ingérer des chunks de document |
| `/search` | POST | Recherche sémantique avec filtres |
| `/document/:id` | GET | Info sur un document |
| `/document/:id` | DELETE | Supprimer document et chunks |
| `/document/:id` | PATCH | Mettre à jour métadonnées |
| `/document/:id/regenerate-embeddings` | POST | Regénérer embeddings |
| `/indexes/ensure-vector` | POST | Créer index vectoriel |
| `/shutdown` | POST | Arrêter le serveur |

### Démarrage

```bash
# Démarrer Neo4j dédié
cd packages/community-docs
docker compose up -d

# Démarrer l'API
npm run api

# Ou en mode watch
npm run api:dev
```

### Fichiers créés

- `lib/ragforge/api/server.ts` - Serveur Fastify
- `lib/ragforge/embedding-service.ts` - Service Ollama
- `lib/ragforge/neo4j-client.ts` - Client Neo4j
- `lib/ragforge/types.ts` - Types TypeScript
- `lib/ragforge/index.ts` - Exports

---

## Intégration Next.js (4 janv 2025)

### Fichiers créés

- `lib/ragforge/api-client.ts` - Client HTTP pour appeler l'API RagForge depuis Next.js

### Fichiers modifiés

- `lib/ragforge/index.ts` - Export du nouveau client API
- `app/api/ingest/upload/route.ts` - Trigger automatique de l'ingestion après upload
- `app/api/search/route.ts` - Recherche sémantique via l'API RagForge
- `app/api/docs/[id]/route.ts` - Suppression cascade dans Neo4j

### Fichiers supprimés

- `lib/ragforge.ts` - Ancien stub qui masquait le dossier `lib/ragforge/`
- `app/api/search/route.js` - Doublon

### Flux d'ingestion

```
Upload fichier → POST /api/ingest/upload
                      ↓
              Sauvegarde fichier sur disque
                      ↓
              Création Document en Postgres (status: PENDING)
                      ↓
              triggerIngestion() async
                      ↓
              POST http://localhost:6970/ingest
                      ↓
              Neo4j + Embeddings Ollama
                      ↓
              Update Document (status: READY)
```

### Limitations actuelles

1. **Parsing binaires** - PDF/DOCX/images ingérés avec placeholder texte
   - TODO: Utiliser les parsers de @ragforge/core
2. **GitHub adapter** - Non implémenté pour `app/api/ingest/github/route.ts`

---

## Configuration Monorepo (4 janv 2025)

### Problème résolu

Next.js 16 avec Turbopack avait des problèmes de résolution de modules dans le monorepo npm workspaces.

### Solution

- Utilisation de `--webpack` au lieu de Turbopack pour le build production
- Scripts de build indépendants dans le root `package.json`

### Nouveaux scripts (root)

| Commande | Package | Description |
|----------|---------|-------------|
| `npm run core:build` | @ragforge/core | Build TypeScript ESM + types |
| `npm run cli:build` | @ragforge/cli | Build CLI |
| `npm run hub:build` | community-docs | Build Next.js (webpack) |
| `npm run hub:dev` | community-docs | Dev server port 3001 |
| `npm run hub:api` | community-docs | API server port 6970 |

### Fichiers modifiés

- `turbo.json` - Ajout inputs/outputs pour cache, task `build:standalone`
- `package.json` (root) - Scripts groupés par package
- `packages/community-docs/package.json` - `--webpack` pour le build

---

## Prochaines étapes

1. [ ] **LocalVFSAdapter** - Parsing des fichiers binaires (PDF, DOCX, images)
2. [ ] **GitHubSourceAdapter** - Ingestion de repos GitHub
3. [ ] **LLM Enrichment** - Extraction d'entités, génération de descriptions
4. [ ] **Entity Resolution** - Déduplication globale des tags/personnes
