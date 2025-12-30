# Roadmap: Intégration RagForge dans LucieCode (Gemini CLI)

> Date: 2025-12-20
> Objectif: Remplacer/augmenter les outils natifs de Gemini CLI avec les outils RagForge

---

## 1. Architecture Actuelle

### 1.1 LucieCode - Système de Tools

```
Config.createToolRegistry()
    ↓
ToolRegistry.registerTool(DeclarativeTool)
    ↓
GeminiChat.setTools(tools)
    ↓
Model → tool_call → DeclarativeTool.build() → ToolInvocation.execute()
```

**Fichiers clés:**

| Fichier | Rôle |
|---------|------|
| `packages/core/src/config/config.ts:1553` | `createToolRegistry()` - Factory qui instancie et enregistre tous les tools |
| `packages/core/src/tools/tool-registry.ts:189` | `ToolRegistry` - Stocke et gère tous les DeclarativeTool |
| `packages/core/src/tools/tools.ts:333` | `DeclarativeTool` - Classe abstraite de base |
| `packages/core/src/tools/tools.ts:463` | `BaseDeclarativeTool` - Helper avec validation intégrée |

**Pattern DeclarativeTool:**
```typescript
// packages/core/src/tools/tools.ts:333-455
export abstract class DeclarativeTool<TParams, TResult> {
  constructor(
    readonly name: string,
    readonly displayName: string,
    readonly description: string,
    readonly kind: Kind,
    readonly parameterSchema: unknown,  // JSON Schema
  ) {}

  get schema(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parametersJsonSchema: this.parameterSchema,
    };
  }

  validateToolParams(params: TParams): string | null { return null; }
  
  abstract build(params: TParams): ToolInvocation<TParams, TResult>;
}
```

**Enregistrement actuel des tools (config.ts:1553-1656):**
```typescript
async createToolRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry(this);
  
  registerCoreTool(LSTool, this);
  registerCoreTool(ReadFileTool, this);
  registerCoreTool(GrepTool, this);
  registerCoreTool(GlobTool, this);
  registerCoreTool(EditTool, this);
  registerCoreTool(WriteFileTool, this);
  registerCoreTool(WebFetchTool, this);
  registerCoreTool(ShellTool, this);
  registerCoreTool(MemoryTool);
  registerCoreTool(WebSearchTool, this);
  // ...
  
  await registry.discoverAllTools();  // MCP discovery
  return registry;
}
```

### 1.2 RagForge - Système de Tools

```
BrainManager.getInstance()
    ↓
generateToolHandlers(brain) → { tools[], handlers{} }
    ↓
MCP Server expose les tools
```

**Fichiers clés:**

| Fichier | Rôle |
|---------|------|
| `packages/core/src/brain/brain-manager.ts:383` | `BrainManager` - Singleton, gère Neo4j, search, ingest |
| `packages/core/src/tools/brain-tools.ts` | Génère les tools brain_search, ingest_directory, etc. |
| `packages/core/src/tools/fs-tools.ts` | Tools read_file, write_file, etc. |
| `packages/core/src/tools/image-tools.ts` | Tools generate_image, edit_image, etc. |

**API BrainManager (brain-manager.ts):**
```typescript
// Singleton
const brain = await BrainManager.getInstance();

// Initialisation
await brain.initialize();

// Search (hybride: semantic + BM25)
const results = await brain.search(query, {
  semantic: true,
  limit: 20,
  projects: ['project-id'],
});

// Ingest
await brain.quickIngest('/path', { projectName: 'my-project' });

// Neo4j direct
const neo4j = brain.getNeo4jClient();
await neo4j.run('MATCH (n) RETURN n LIMIT 10');
```

---

## 2. Tools à Intégrer

### Priorité 1 - Brain (Core RAG)

| Tool RagForge | Description | Handler source |
|---------------|-------------|----------------|
| `brain_search` | Recherche sémantique/hybride dans le knowledge graph | `brain-tools.ts:514` |
| `ingest_directory` | Ingère un répertoire dans le brain | `brain-tools.ts:333` |
| `explore_node` | Explore les relations d'un node par UUID | `brain-tools.ts:1650` |
| `run_cypher` | Exécute une requête Cypher directe | `brain-tools.ts:2100` |

### Priorité 2 - Files (Enhanced)

| Tool RagForge | Description | Remplace |
|---------------|-------------|----------|
| `read_file` | Lit fichiers + images + PDFs + 3D | `ReadFileTool` |
| `read_files` | Lecture batch optimisée | - |
| `write_file` | Écrit + sync brain | `WriteFileTool` |
| `edit_file` | Edit + sync brain | `EditTool` |

### Priorité 3 - Media

| Tool RagForge | Description |
|---------------|-------------|
| `generate_image` | Génère une image via Gemini |
| `edit_image` | Édite une image existante |
| `describe_image` | Décrit le contenu d'une image |
| `generate_3d_from_text` | Génère un modèle 3D depuis texte |
| `render_3d_asset` | Rend un asset 3D en images |

---

## 3. Plan d'Implémentation

### Phase 1: Setup (1-2h)

#### 1.1 Ajouter RagForge comme dépendance

```bash
# Dans LucieCode/packages/core
npm install @luciformresearch/ragforge
```

**Fichier:** `packages/core/package.json`
```json
{
  "dependencies": {
    "@luciformresearch/ragforge": "^0.3.3"
  }
}
```

#### 1.2 Créer le dossier des tools RagForge

```
packages/core/src/tools/ragforge/
├── index.ts                 # Export all + registerRagForgeTools()
├── brain-manager-provider.ts # Singleton provider for BrainManager
├── brain-search-tool.ts
├── ingest-directory-tool.ts
├── explore-node-tool.ts
├── cypher-tool.ts
├── read-file-tool.ts        # Override du ReadFileTool natif
├── read-files-tool.ts
└── image-tools.ts           # generate, edit, describe
```

---

### Phase 2: BrainManager Provider (30min)

#### 2.1 Créer le provider singleton

**Fichier:** `packages/core/src/tools/ragforge/brain-manager-provider.ts`

```typescript
import { BrainManager } from '@luciformresearch/ragforge';

let brainInstance: BrainManager | null = null;
let initPromise: Promise<BrainManager> | null = null;

export async function getBrainManager(): Promise<BrainManager> {
  if (brainInstance) return brainInstance;
  
  if (!initPromise) {
    initPromise = (async () => {
      const brain = await BrainManager.getInstance();
      await brain.initialize();
      brainInstance = brain;
      return brain;
    })();
  }
  
  return initPromise;
}

export function hasBrainManager(): boolean {
  return brainInstance !== null;
}
```

---

### Phase 3: Implémenter BrainSearchTool (1h)

#### 3.1 Créer le DeclarativeTool wrapper

**Fichier:** `packages/core/src/tools/ragforge/brain-search-tool.ts`

```typescript
import { BaseDeclarativeTool, ToolInvocation, ToolResult, Kind } from '../tools.js';
import { getBrainManager } from './brain-manager-provider.js';

// Schema réutilisé de RagForge (brain-tools.ts:429-513)
const BRAIN_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'What to search for',
    },
    semantic: {
      type: 'boolean',
      description: 'Use semantic search (recommended: true)',
      default: true,
    },
    limit: {
      type: 'number',
      description: 'Maximum results (default: 20)',
      default: 20,
    },
    projects: {
      type: 'array',
      items: { type: 'string' },
      description: 'Limit to specific project IDs',
    },
    types: {
      type: 'array',
      items: { type: 'string' },
      description: 'Node types: function, method, class, interface, file',
    },
    glob: {
      type: 'string',
      description: 'Filter by file path glob (e.g., "**/*.ts")',
    },
    base_path: {
      type: 'string',
      description: 'Filter to files under this path',
    },
    explore_depth: {
      type: 'number',
      description: 'Explore relationships (0-3)',
    },
    summarize: {
      type: 'boolean',
      description: 'Summarize results with LLM',
    },
  },
  required: ['query'],
};

interface BrainSearchParams {
  query: string;
  semantic?: boolean;
  limit?: number;
  projects?: string[];
  types?: string[];
  glob?: string;
  base_path?: string;
  explore_depth?: number;
  summarize?: boolean;
}

class BrainSearchInvocation implements ToolInvocation<BrainSearchParams, ToolResult> {
  constructor(readonly params: BrainSearchParams) {}

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const brain = await getBrainManager();
    
    const results = await brain.search(this.params.query, {
      semantic: this.params.semantic ?? true,
      limit: this.params.limit ?? 20,
      projects: this.params.projects,
      nodeTypes: this.params.types,
      glob: this.params.glob,
      basePath: this.params.base_path,
      hybrid: this.params.semantic === true,
    });

    // Format pour le LLM
    const formatted = results.results.map((r, i) => {
      const node = r.node;
      return `${i + 1}. [${r.score.toFixed(2)}] ${node.name} (${node.type})
   File: ${r.filePath}:${node.startLine || '?'}
   ${node.docstring ? `Doc: ${node.docstring.substring(0, 100)}...` : ''}`;
    }).join('\n\n');

    return {
      llmContent: `Found ${results.totalCount} results:\n\n${formatted}`,
      returnDisplay: `${results.totalCount} results`,
    };
  }
}

export class BrainSearchTool extends BaseDeclarativeTool<BrainSearchParams, ToolResult> {
  static readonly Name = 'brain_search';

  constructor() {
    super(
      'brain_search',
      'Brain Search',
      'Search across all knowledge in the agent\'s persistent brain using semantic and keyword search.',
      Kind.NATIVE,
      BRAIN_SEARCH_SCHEMA,
    );
  }

  createInvocation(params: BrainSearchParams): ToolInvocation<BrainSearchParams, ToolResult> {
    return new BrainSearchInvocation(params);
  }
}
```

---

### Phase 4: Implémenter les autres tools (2-3h)

Même pattern pour:
- `IngestDirectoryTool` - appelle `brain.quickIngest()`
- `ExploreNodeTool` - appelle `brain.exploreNode()`
- `CypherTool` - appelle `brain.getNeo4jClient().run()`
- `RagForgeReadFileTool` - appelle le handler de RagForge (supporte images/PDFs)

---

### Phase 5: Enregistrer les tools (30min)

#### 5.1 Créer l'index

**Fichier:** `packages/core/src/tools/ragforge/index.ts`

```typescript
import { ToolRegistry } from '../tool-registry.js';
import { BrainSearchTool } from './brain-search-tool.js';
import { IngestDirectoryTool } from './ingest-directory-tool.js';
import { ExploreNodeTool } from './explore-node-tool.js';
import { CypherTool } from './cypher-tool.js';

export * from './brain-manager-provider.js';
export * from './brain-search-tool.js';
// ... autres exports

export function registerRagForgeTools(registry: ToolRegistry): void {
  registry.registerTool(new BrainSearchTool());
  registry.registerTool(new IngestDirectoryTool());
  registry.registerTool(new ExploreNodeTool());
  registry.registerTool(new CypherTool());
  // ... autres tools
}
```

#### 5.2 Modifier Config.createToolRegistry()

**Fichier:** `packages/core/src/config/config.ts` (ligne ~1650)

```typescript
import { registerRagForgeTools } from '../tools/ragforge/index.js';

async createToolRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry(this);
  
  // ... existing tools ...
  
  // Register RagForge tools (Brain, enhanced files, media)
  registerRagForgeTools(registry);
  
  await registry.discoverAllTools();
  return registry;
}
```

---

### Phase 6: Configuration (30min)

#### 6.1 Ajouter settings pour RagForge

**Fichier:** `packages/core/src/config/settings.ts` (ou settings.json schema)

```typescript
interface RagForgeSettings {
  enabled: boolean;
  neo4jAutoStart: boolean;  // Démarrer Neo4j automatiquement
  geminiApiKey?: string;    // Pour embeddings (ou réutiliser celui de Gemini CLI)
}
```

#### 6.2 Gérer l'initialisation lazy

Le BrainManager ne s'initialise que si un tool RagForge est appelé (lazy init via `getBrainManager()`).

---

## 4. Résumé des Modifications

| Fichier | Action |
|---------|--------|
| `package.json` | + dépendance `@luciformresearch/ragforge` |
| `src/tools/ragforge/*.ts` | NOUVEAU - tous les wrappers DeclarativeTool |
| `src/config/config.ts` | MODIFIER - appeler `registerRagForgeTools()` |
| `src/config/settings.ts` | MODIFIER - ajouter `ragforge` settings |

**Aucune modification dans RagForge** - on l'utilise comme une librairie.

---

## 5. Risques et Mitigations

| Risque | Mitigation |
|--------|------------|
| Neo4j Docker non disponible | Lazy init + message d'erreur clair |
| Conflit de noms de tools | Préfixer `rf_` si nécessaire |
| Performance (Neo4j startup) | Init async au premier appel |
| Gemini API key dupliquée | Réutiliser celle de Gemini CLI via Config |

---

## 6. Tests

```bash
# Après implémentation
gemini> brain_search "authentication handler"
gemini> ingest_directory /path/to/project
gemini> explore_node uuid-xxx
gemini> run_cypher "MATCH (n:Scope) RETURN n.name LIMIT 5"
```

---

## 7. Prochaines Étapes

1. [ ] **Phase 1**: Setup dépendance + structure dossiers
2. [ ] **Phase 2**: BrainManagerProvider
3. [ ] **Phase 3**: BrainSearchTool (prototype complet)
4. [ ] **Phase 4**: Autres tools prioritaires
5. [ ] **Phase 5**: Enregistrement dans Config
6. [ ] **Phase 6**: Tests E2E
7. [ ] **Phase 7**: Documentation utilisateur
