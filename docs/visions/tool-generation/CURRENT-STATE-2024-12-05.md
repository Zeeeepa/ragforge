# RagForge Tool Generation - Current State

**Date**: 2024-12-05
**Status**: Production Ready for Agent Testing

---

## Quick Reference for Code Agents

### Project Structure

```
ragforge/                          # Monorepo root
├── packages/
│   ├── core/                      # Tool definitions, code generator, types
│   │   └── src/tools/tool-generator.ts   # Main tool generation logic
│   ├── runtime/                   # Neo4j client, query execution, embeddings
│   │   └── src/index.ts           # createClient(), raw() method
│   └── cli/                       # CLI commands (ragforge init, generate)
│
└── examples/
    └── langchainjs-analysis/      # Working example project
        ├── ragforge.config.yaml   # Main config (points to source code)
        └── generated/             # Generated client code
            ├── client.ts          # RagClient class
            ├── scripts/           # Utility scripts
            │   ├── test-agent.ts          # Test the RAG agent
            │   ├── generate-embeddings.ts # Generate vector embeddings
            │   ├── ingest-from-source.ts  # Parse & ingest code to Neo4j
            │   └── create-vector-indexes.ts
            └── tools/             # Generated tool definitions
```

---

## Common Operations

### 1. Rebuild Packages (after modifying ragforge source)

```bash
# From ragforge root
cd /home/luciedefraiteur/LR_CodeRag/ragforge

# Build all packages
npm run build

# Or build specific packages
npm run build -w @luciformresearch/ragforge-core
npm run build -w @luciformresearch/ragforge-runtime
npm run build -w @luciformresearch/ragforge-cli
```

### 2. Reinstall Dependencies in Example Project

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/examples/langchainjs-analysis/generated
npm install
```

### 3. Test the RAG Agent

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/examples/langchainjs-analysis/generated

# Run a test query
npx tsx scripts/test-agent.ts "How does BaseChain work?"

# More examples
npx tsx scripts/test-agent.ts "Find all classes that extend BaseChain"
npx tsx scripts/test-agent.ts "Find all scopes in files matching **/chains/*.ts"
```

### 4. Generate/Update Embeddings

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/examples/langchainjs-analysis/generated

# Generate all embeddings (full)
npx tsx scripts/generate-embeddings.ts

# Generate only for changed/new entities
npx tsx scripts/generate-embeddings.ts --only-dirty
```

### 5. Re-ingest Source Code (after source changes)

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge/examples/langchainjs-analysis/generated

# Parse source code and update Neo4j
npx tsx scripts/ingest-from-source.ts
```

### 6. Regenerate Client Code (after config changes)

```bash
cd /home/luciedefraiteur/LR_CodeRag/ragforge

# Using CLI
npx ragforge generate --config examples/langchainjs-analysis/ragforge.config.yaml --output examples/langchainjs-analysis/generated
```

---

## Available Agent Tools (9 tools)

The RagAgent currently has access to these tools:

| Tool | Description |
|------|-------------|
| `get_schema` | Get the graph schema (entities, fields, relationships) |
| `describe_entity` | Get detailed info about a specific entity type |
| `query_entities` | Query entities with filters (=, !=, CONTAINS, REGEX, GLOB, etc.) |
| `semantic_search` | Vector similarity search on embeddings |
| `explore_relationships` | Navigate graph relationships |
| `get_entity_by_id` | Get single entity by unique ID |
| `get_entities_by_ids` | Get multiple entities by IDs |
| `glob_search` | Pattern matching on any string field (NEW) |
| `batch_analyze` | Batch analysis of multiple entities |

### glob_search Tool (New)

Added 2024-12-05. Allows glob pattern matching on any string field:

```typescript
// Example: Find scopes in chain files
glob_search({
  entity_type: "Scope",
  field: "file",
  pattern: "**/chains/*.ts"
})

// Pattern syntax:
// * = any characters except /
// ** = any characters including /
// ? = single character
```

---

## Key Files to Know

### Configuration

- **`ragforge.config.yaml`**: Main project config
  - `source.root`: Path to source code being analyzed
  - `entities`: Entity definitions with searchable fields
  - `embeddings`: Vector embedding configuration
  - `neo4j`: Database connection settings

### Runtime

- **`packages/runtime/src/index.ts`**:
  - `createClient()`: Creates RagClient
  - `raw()`: Execute raw Cypher (auto-converts integers with `neo4j.int()`)

### Tool Generation

- **`packages/core/src/tools/tool-generator.ts`**:
  - `generateToolsFromConfig()`: Main entry point
  - `generateGlobSearchTool()`: glob_search definition
  - `generateGlobSearchHandler()`: glob_search execution

### Agent

- **`packages/runtime/src/agents/rag-agent.ts`**:
  - `RagAgent` class
  - Imports tools from `@luciformresearch/ragforge-core`

---

## Environment Variables

Required in `.env` file:

```bash
# Neo4j connection
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your_password
NEO4J_DATABASE=neo4j

# Embeddings (Gemini)
GEMINI_API_KEY=your_api_key

# Agent LLM (optional, for different providers)
GOOGLE_API_KEY=your_api_key
```

---

## Recent Changes (2024-12-05)

### 1. Added `glob_search` Tool

- Location: `packages/core/src/tools/tool-generator.ts`
- Glob to regex conversion with case-insensitive matching
- Works on any string field (file, name, signature, etc.)

### 2. Fixed Neo4j Integer Issue

- Location: `packages/runtime/src/index.ts`
- `raw()` method now auto-converts whole numbers to `neo4j.int()`
- Fixes "LIMIT: Invalid input '20.0'" errors

### 3. Consolidated Tool Generator

- Runtime now imports `generateToolsFromConfig` from `@luciformresearch/ragforge-core`
- Single source of truth for tool definitions

### 4. Added File Tools (NEW!)

**Location**: `packages/core/src/tools/file-tools.ts`

**Packages installés**:
```bash
npm install diff fastest-levenshtein -w @luciformresearch/ragforge-core
```

**Outils**:
| Outil | Description |
|-------|-------------|
| `read_file` | Lire un fichier avec numéros de ligne, pagination (offset/limit) |
| `write_file` | Créer/écraser un fichier avec tracking des changements |
| `edit_file` | Search/replace avec fuzzy matching (5 stratégies dont Levenshtein) |

**Usage dans RagAgent**:
```typescript
const agent = await createRagAgent({
  configPath: './ragforge.config.yaml',
  ragClient: rag,
  apiKey: process.env.GEMINI_API_KEY,

  // Enable file tools
  includeFileTools: true,
  projectRoot: '/path/to/project',
  onFileModified: async (path, type) => {
    console.log(`File ${type}: ${path}`);
    // Re-ingest file here if needed
  },
});
```

**Test des file tools**:
```bash
npx tsx packages/core/templates/scripts/test-file-tools.ts /path/to/project
```

### 5. Added `ragforge create` Command

Crée un nouveau projet TypeScript avec RAG intégré:
```bash
node packages/cli/dist/esm/index.js create my-project --dev
```

Structure générée:
```
my-project/
├── package.json, tsconfig.json, src/index.ts
└── .ragforge/
    ├── ragforge.config.yaml
    └── generated/
```

---

## Architecture Notes

### Package Dependencies

```
@luciformresearch/ragforge-cli
    └── @luciformresearch/ragforge-core (tool definitions, code generator)
    └── @luciformresearch/ragforge-runtime (execution, neo4j, embeddings)
            └── @luciformresearch/ragforge-core (types)
```

### Why Tool Generator is in Core (not Runtime)

The tool generator serves two purposes:
1. **Code Generation** (CLI): Generates `tools/database-tools.ts` for projects
2. **Runtime Tools** (Agent): Generates live tools for RagAgent

Both need the same tool definitions, so it lives in `core`. The handlers use `rag.raw()` which auto-handles Neo4j types.

---

## Troubleshooting

### "rag.raw is not a function"

The generated `client.ts` needs a `raw()` method. Add:

```typescript
async raw(cypher: string, params?: Record<string, any>) {
  return this.runtime.raw(cypher, params);
}
```

### "LIMIT: Invalid input '20.0'"

Fixed in runtime. Rebuild:
```bash
npm run build -w @luciformresearch/ragforge-runtime
```

### Agent shows fewer tools than expected

Rebuild core and reinstall in example:
```bash
npm run build -w @luciformresearch/ragforge-core
cd examples/langchainjs-analysis/generated && npm install
```

### Embeddings not found

```bash
cd examples/langchainjs-analysis/generated
npx tsx scripts/create-vector-indexes.ts
npx tsx scripts/generate-embeddings.ts
```

---

## Full Rebuild Sequence

When in doubt, do a full rebuild:

```bash
# 1. Build all packages
cd /home/luciedefraiteur/LR_CodeRag/ragforge
npm run build

# 2. Reinstall in example
cd examples/langchainjs-analysis/generated
rm -rf node_modules package-lock.json
npm install

# 3. Test
npx tsx scripts/test-agent.ts "What is BaseChain?"
```

---

## Testing Local CLI (Development)

**IMPORTANT**: The global `ragforge` command uses the npm-published version.
To test local changes, run the CLI directly from dist:

```bash
# Run local CLI (after npm run build)
node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js <command>

# Examples:
node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js --help
node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js create my-app --path ~/projects
node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js quickstart --dev

# Or create an alias in your shell:
alias ragforge-dev="node /home/luciedefraiteur/LR_CodeRag/ragforge/packages/cli/dist/esm/index.js"
ragforge-dev create my-app
```

**The `--dev` flag** (for quickstart/init/generate):
- Uses local `file:` dependencies instead of npm packages
- For RagForge contributors testing changes to runtime/core packages
- Example: `ragforge-dev quickstart --dev`

---

## What's Working

- Semantic search with vector embeddings
- Graph relationship exploration
- Query entities with filters (=, !=, CONTAINS, REGEX, GLOB)
- glob_search for pattern matching on any field
- Change tracking (track_changes: true in config)
- Aggregations (COUNT, AVG, SUM, MIN, MAX)
- Code summarization with LLM

## What's Not Yet Implemented

- Full-text search tools (requires Neo4j full-text indexes)
- Graph analytics (PageRank, community detection)
- Multi-entity join queries

---

## Ideas for Future Improvements

### Levenshtein Distance for Fuzzy Matching

Package installé: `fastest-levenshtein` (dans core)

**Usages potentiels dans les outils RAG:**

1. **query_entities avec fuzzy matching**:
   - Ajouter un opérateur `FUZZY` ou `SIMILAR` pour les string fields
   - Ex: `{ field: "name", operator: "FUZZY", value: "AuthService", threshold: 0.8 }`
   - Utile quand l'agent ne connaît pas le nom exact

2. **semantic_search + Levenshtein reranking**:
   - Après semantic search, re-rank par similarité Levenshtein du nom
   - Combine semantic similarity (meaning) + lexical similarity (spelling)

3. **Suggestions "Did you mean?"**:
   - Quand query_entities retourne 0 résultats
   - Suggérer les entités avec noms similaires (Levenshtein < threshold)

4. **Auto-correction des noms d'entités**:
   - Si l'agent demande "AuthServce" (typo), trouver "AuthService"
   - Seuil configurable (ex: distance < 3 ou similarity > 0.85)

**Exemple d'implémentation:**
```typescript
import { distance, closest } from 'fastest-levenshtein';

// Trouver l'entité la plus proche
const allNames = await rag.get('Scope').select(['name']).execute();
const bestMatch = closest(userQuery, allNames.map(n => n.name));

// Calculer la similarité (0-1)
const similarity = 1 - distance(a, b) / Math.max(a.length, b.length);
```

### Real-time File Sync Architecture (À IMPLÉMENTER)

**Objectifs:**
1. **Agent modifie fichier** → Re-ingestion ciblée (pas full scan)
2. **User modifie à la main** → File watcher détecte, calcule diff, notifie l'agent
3. **Sync bidirectionnel** → RAG toujours à jour, agent toujours informé

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                     RagAgent                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ File Tools  │  │ RAG Tools   │  │ FileChangeNotifier  │  │
│  │ read/write  │  │ query/search│  │ (receives diffs)    │  │
│  └──────┬──────┘  └─────────────┘  └──────────▲──────────┘  │
└─────────┼─────────────────────────────────────┼─────────────┘
          │ onFileModified                      │ notifyExternalChange
          ▼                                     │
┌─────────────────────────────────────────────────────────────┐
│                  FileWatcherService                         │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │  chokidar       │  │  IncrementalIngestionManager    │   │
│  │  file watcher   │  │  reIngestFile() - single file   │   │
│  └────────┬────────┘  └────────────────▲────────────────┘   │
│           │                            │                    │
│           │ external change            │                    │
│           ▼                            │                    │
│  ┌─────────────────────────────────────┴─────────────────┐  │
│  │  DiffCalculator (compute unified diff)                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Flux - Agent modifie:**
```
edit_file("src/utils.ts") → fs.writeFile() → onFileModified()
  → reIngestFile("src/utils.ts")  // Ciblé, rapide
  → Neo4j updated → Agent peut query RAG immédiatement
```

**Flux - User modifie à la main:**
```
User edits in VSCode → chokidar detects → compute diff
  → FileChangeEvent { source: 'external', diff: "..." }
  → notifyAgent() → Agent voit le diff en temps réel
  → reIngestFile() → RAG à jour
```

**API à implémenter:**
```typescript
interface FileWatcherService {
  start(projectRoot: string): void;
  stop(): void;
  onFileChanged(cb: (event: FileChangeEvent) => void): void;
}

interface FileChangeEvent {
  path: string;
  changeType: 'created' | 'updated' | 'deleted';
  source: 'agent' | 'external';
  diff?: string;
}

// Nouvelle méthode dans IncrementalIngestionManager
async reIngestFile(filePath: string): Promise<{
  scopesUpdated: number;
  scopesCreated: number;
  scopesDeleted: number;
}>;
```

**Package:** `npm install chokidar`

---

## Existing Infrastructure for Code Manipulation

### Change Tracker

**Location**: `packages/runtime/src/adapters/change-tracker.ts`

Tracks code modifications with unified diffs:

```typescript
interface Change {
  uuid: string;
  timestamp: Date;
  entityType: string;      // 'Scope', 'Document', etc.
  entityUuid: string;
  changeType: 'created' | 'updated' | 'deleted';
  diff: string;            // Unified diff format
  oldHash?: string;
  newHash: string;
  linesAdded: number;
  linesRemoved: number;
  metadata: Record<string, any>;
}
```

**Capabilities**:
- `trackEntityChange()` - Record a change with diff
- `createDiff()` - Generate unified diff between old/new content
- Stores changes as `(:Change)` nodes linked to entities via `HAS_CHANGE` relationship
- Used by watch mode for incremental updates

### Code Source Adapter

**Location**: `packages/runtime/src/adapters/code-source-adapter.ts`

Parses codebases into Neo4j graph:

```typescript
class CodeSourceAdapter extends SourceAdapter {
  // Supported languages
  adapterName: 'typescript' | 'python';

  // Parses files into graph structure
  async parse(options: ParseOptions): Promise<ParseResult>;

  // Detects project info (git, package.json)
  async detectProjectInfo(root: string): Promise<ProjectInfo>;
}
```

**Uses**: `@luciformresearch/codeparsers` for AST parsing

### File Watcher

**Location**: `packages/runtime/src/adapters/file-watcher.ts`

Watches for file changes and triggers re-ingestion:
- Debounced batch processing
- Incremental updates (only changed files)
- Auto-embed option for new/modified entities

---

## Vision: RAG-Augmented Code Agent

### Inspiration: OpenCode

[OpenCode](https://github.com/sst/opencode) is a Go-based AI coding agent with:
- **Build agent**: Full access for development (read/write/edit files, bash)
- **Plan agent**: Read-only for analysis
- LSP integration for code intelligence
- Undo/redo for modifications
- Custom commands via Markdown files

### Our Advantage: Deep Code Understanding

Unlike generic code agents, RagForge provides:
1. **Semantic Search**: Find code by meaning, not just keywords
2. **Graph Relationships**: Understand inheritance, imports, calls
3. **Change History**: See how code evolved over time
4. **Code Summaries**: LLM-generated explanations of complex code

### Proposed Tools for Code Agent

#### 1. File Operations (Basic)

```typescript
// Read file contents
read_file({ path: string }): string

// Write file (create or overwrite)
write_file({ path: string, content: string }): void

// Edit file with search/replace
edit_file({
  path: string,
  old_string: string,
  new_string: string,
  replace_all?: boolean
}): void
```

#### 2. Code-Aware Operations (RAG-Augmented)

```typescript
// Find where to add new code based on semantic context
find_insertion_point({
  description: string,  // "Add a method to handle authentication"
  entity_type?: string, // "class" | "function" | "file"
  near?: string         // UUID of related entity
}): { file: string, line: number, context: string }

// Generate code that fits existing patterns
generate_code({
  description: string,
  similar_to?: string,  // UUID of example entity
  context?: string[]    // UUIDs of related entities for context
}): string

// Refactor with full dependency awareness
refactor_entity({
  entity_uuid: string,
  transformation: 'extract_function' | 'inline' | 'rename' | 'move',
  new_name?: string,
  target_file?: string
}): { changes: FileChange[] }

// Find all usages before modifying
find_usages({
  entity_uuid: string,
  include_indirect?: boolean  // Follow call chains
}): { usages: Usage[], impact_analysis: string }
```

#### 3. Project Operations

```typescript
// Create new TypeScript project with RAG setup
create_project({
  name: string,
  template: 'typescript' | 'python',
  features: ('testing' | 'linting' | 'docker')[]
}): void

// Add dependency with usage examples from codebase
add_dependency({
  package: string,
  dev?: boolean,
  show_examples?: boolean  // Search codebase for similar usage
}): { installed: boolean, examples?: string[] }

// Run tests related to changed code
test_changes({
  since?: string,  // Commit SHA or timestamp
  scope?: string   // Entity UUID to find related tests
}): TestResult[]
```

#### 4. Bash Execution

```typescript
// Execute shell command
bash({
  command: string,
  cwd?: string,
  timeout?: number
}): { stdout: string, stderr: string, exitCode: number }
```

### Architecture for Code Agent

```
┌─────────────────────────────────────────────────────┐
│                   Code Agent                        │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │ Plan Mode   │  │ Build Mode  │  │ Review Mode│  │
│  │ (read-only) │  │ (full edit) │  │ (analysis) │  │
│  └─────────────┘  └─────────────┘  └────────────┘  │
└────────────────────────┬────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ RAG Tools   │  │ File Tools  │  │ Bash Tools  │
│ (search,    │  │ (read,      │  │ (npm, git,  │
│  analyze)   │  │  write,     │  │  tsc, etc.) │
│             │  │  edit)      │  │             │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       ▼                ▼                ▼
┌─────────────────────────────────────────────────────┐
│                 Neo4j + File System                 │
│  - Code graph (entities, relationships)            │
│  - Vector embeddings (semantic search)             │
│  - Change history (diffs, timestamps)              │
│  - Actual source files                             │
└─────────────────────────────────────────────────────┘
```

### Implementation Roadmap

#### Phase 1: Basic File Operations
- [ ] `read_file` tool
- [ ] `write_file` tool
- [ ] `edit_file` tool (search/replace)
- [ ] `bash` tool with sandboxing

#### Phase 2: Integration with RAG
- [ ] Auto-sync: File changes → Re-ingest → Update graph
- [ ] `find_usages` using graph relationships
- [ ] `find_insertion_point` using semantic search

#### Phase 3: Smart Code Generation
- [ ] `generate_code` with context from similar entities
- [ ] `refactor_entity` with dependency tracking
- [ ] Pattern learning from existing codebase

#### Phase 4: Project Management
- [ ] `create_project` with templates
- [ ] `add_dependency` with example lookup
- [ ] `test_changes` scoped to affected code

### Key Differentiators vs Generic Agents

| Feature | Generic Agent | RagForge Agent |
|---------|--------------|----------------|
| Find code | grep/ripgrep | Semantic search + graph |
| Understand impact | Manual search | `find_usages` with call chains |
| Generate code | Zero context | Similar code patterns from codebase |
| Refactor | String replace | AST-aware with dependency tracking |
| Navigate | File tree | Relationship graph (inherits, imports, calls) |
| History | git log | Per-entity change history with diffs |

### Example Workflow: Add Authentication

```
User: "Add JWT authentication to the UserService class"

Agent (Plan Mode):
1. semantic_search("authentication JWT") → Find existing auth code
2. get_entity_by_id(UserService) → Get class details
3. explore_relationships(UserService, "CONSUMES") → Find dependencies
4. find_usages(UserService) → Check what calls this service

Agent (Build Mode):
5. find_insertion_point("add JWT validation method") → Line 45 in UserService
6. generate_code("JWT token validation", similar_to: existingAuthCode)
7. edit_file(userservice.ts, insert at line 45)
8. bash("npm install jsonwebtoken")
9. bash("npm test -- --grep UserService")
```

### OpenCode Reference (Cloned)

**Location**: `~/LR_CodeRag/references/opencode` (gitignored)

**Key files to study**:
- `packages/opencode/src/tool/tool.ts` - Tool base class with Zod validation
- `packages/opencode/src/tool/edit.ts` - Edit with diff, fuzzy matching
- `packages/opencode/src/tool/write.ts` - Write with LSP diagnostics
- `packages/opencode/src/tool/bash.ts` - Shell with tree-sitter parsing
- `packages/opencode/src/tool/registry.ts` - Tool registry + permissions

**OpenCode's tools**:
| Tool | Lines | Key Features |
|------|-------|--------------|
| bash | 11K | Tree-sitter parsing, timeout, output truncation |
| edit | 21K | Fuzzy matching, diff generation, multi-match handling |
| write | 3K | LSP diagnostics after write |
| read | 7K | Line numbers, file tracking |
| glob/grep | 2-3K | Fast file discovery |

**Architecture patterns**:
- Permissions: `ask` / `deny` / `allow` per tool category
- Events: `Bus.publish(File.Event.Edited, {...})` for reactivity
- LSP: Diagnostics after file modifications
- FileTime: Track modifications for conflict detection

---

### Concrete Implementation Plan

#### Phase 0: Project Creation (Priority: HIGHEST) 🎯

**Goal**: Agent can create new TypeScript projects from scratch (safe sandbox!)

**Current State of `ragforge quickstart`**:
- Analyzes EXISTING codebases
- `ragforge quickstart --root /path/to/existing/code`
- Parses code → Neo4j → generates query client

**New Command: `ragforge create`**:
- Creates NEW TypeScript projects from scratch
- Automatically sets up RAG in `.ragforge/` subfolder
- `ragforge create my-project` or `ragforge create my-project --dev`

**Full Project Structure** (after create):

```
my-project/
├── package.json          # ESM, TypeScript, basic scripts
├── tsconfig.json         # Strict mode, ES2022, Node
├── src/
│   └── index.ts          # Entry point
├── .gitignore            # node_modules, dist, .env, .ragforge/
├── README.md             # Project name + description
│
└── .ragforge/            # RagForge workspace (clean separation)
    ├── ragforge.config.yaml   # Config pointing to parent as root
    ├── docker-compose.yml     # Neo4j container
    ├── .env                   # Neo4j credentials, API keys
    └── generated/             # Generated client
        ├── client.ts
        ├── package.json
        └── scripts/
            ├── test-agent.ts
            ├── generate-embeddings.ts
            └── ingest-from-source.ts
```

**Command Options**:
```bash
ragforge create <name> [options]

Options:
  --path <dir>    Parent directory (default: current directory)
  --dev           Development mode: use local file: dependencies
  --no-rag        Skip RAG setup (just create TypeScript project)
  -h, --help      Show help
```

**Flow**:
1. Create project directory with TypeScript structure
2. Create `.ragforge/` subfolder
3. Run `quickstart --root <project> --dev` (if --dev passed) with output in `.ragforge/`
4. Project is immediately RAG-enabled and searchable

**package.json** (generated):
```json
{
  "name": "my-project",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "tsx": "^4.7.0",
    "@types/node": "^20.0.0"
  }
}
```

**tsconfig.json** (generated):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**src/index.ts** (generated):
```typescript
console.log('Hello from my-project!');
```

**Implementation** in CLI:

```typescript
// packages/cli/src/commands/create.ts
export async function runCreate(name: string, parentDir: string): Promise<void> {
  const projectPath = path.join(parentDir, name);

  // 1. Create directory
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.join(projectPath, 'src'));

  // 2. Write package.json
  await fs.writeFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify(generatePackageJson(name), null, 2)
  );

  // 3. Write tsconfig.json
  await fs.writeFile(
    path.join(projectPath, 'tsconfig.json'),
    JSON.stringify(generateTsConfig(), null, 2)
  );

  // 4. Write src/index.ts
  await fs.writeFile(
    path.join(projectPath, 'src/index.ts'),
    `console.log('Hello from ${name}!');\n`
  );

  // 5. Write .gitignore
  await fs.writeFile(
    path.join(projectPath, '.gitignore'),
    'node_modules/\ndist/\n.env\n'
  );

  // 6. npm install
  await execAsync('npm install', { cwd: projectPath });

  console.log(`✅ Created ${name} at ${projectPath}`);
  console.log(`   cd ${name} && npm run dev`);
}
```

**Agent Workflow**:
```
User: "Crée-moi un projet TypeScript pour gérer des todos"

Agent:
1. bash({ command: "ragforge create todo-app --path ~/projects --dev" })
   → Creates project + .ragforge/ with RAG setup
   → Neo4j container started, code indexed

2. write_file({
     path: "~/projects/todo-app/src/types.ts",
     content: "export interface Todo { id: string; title: string; done: boolean; }"
   })

3. edit_file({
     path: "~/projects/todo-app/src/index.ts",
     old_string: "console.log('Hello from todo-app!');",
     new_string: "import { Todo } from './types.js';\n\nconst todos: Todo[] = [];\nconsole.log('Todo app ready!');"
   })

4. bash({ command: "cd ~/projects/todo-app && npm run dev" })

5. # Agent can now search its own code:
   semantic_search({ query: "todo interface", topK: 5 })
   → Finds the Todo interface it just created
```

**Testing locally** (for RagForge development):
```bash
# Build CLI first
cd /home/luciedefraiteur/LR_CodeRag/ragforge
npm run build -w @luciformresearch/ragforge-cli

# Create project with local CLI
node packages/cli/dist/esm/index.js create my-test --path examples --dev
```

**Safe by design**:
- Agent creates in user-specified directory (not in ragforge)
- Fresh project = nothing to break
- Can always `rm -rf` and start over
- User controls where projects are created

---

#### Phase 1: File Tools (Priority: HIGH) ✅ IMPLEMENTED

**Location**: `packages/core/src/tools/file-tools.ts`

**Packages installés**:
- `diff` - pour générer les unified diffs
- `fastest-levenshtein` - pour le fuzzy matching

**Outils créés**:
- `read_file` - Lire un fichier avec numéros de ligne, pagination (offset/limit)
- `write_file` - Créer/écraser un fichier avec tracking des changements
- `edit_file` - Search/replace avec fuzzy matching sophistiqué

**Fuzzy Matching Strategies** (inspiré d'OpenCode):
1. **Exact match** - Correspondance exacte
2. **Line-trimmed match** - Ignore leading/trailing whitespace par ligne
3. **Block anchor match** - Utilise Levenshtein sur les lignes du milieu, ancré par première/dernière ligne
4. **Whitespace-normalized match** - Normalise tous les espaces
5. **Indentation-flexible match** - Ignore l'indentation globale

**Intégration ChangeTracker**:
```typescript
const ctx: FileToolsContext = {
  projectRoot: '/path/to/project',
  changeTracker: myChangeTracker,  // Optional: track changes in Neo4j
  onFileModified: async (path, type) => {
    // Callback for re-ingestion
    await codeAdapter.parseFile(path);
  }
};

const { tools, handlers } = generateFileTools(ctx);
```

**Export depuis core**:
```typescript
import {
  generateFileTools,
  generateReadFileTool,
  generateWriteFileTool,
  generateEditFileTool,
} from '@luciformresearch/ragforge-core';
```

---

#### Phase 1 Original Design (for reference)

Create `packages/core/src/tools/file-tools.ts`:

```typescript
// Tool definitions
export const ReadFileTool = {
  name: 'read_file',
  description: 'Read file contents with line numbers',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute file path' },
      offset: { type: 'number', description: 'Start line (0-indexed)' },
      limit: { type: 'number', description: 'Max lines to read' }
    },
    required: ['path']
  }
};

export const WriteFileTool = {
  name: 'write_file',
  description: 'Create or overwrite file',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' }
    },
    required: ['path', 'content']
  }
};

export const EditFileTool = {
  name: 'edit_file',
  description: 'Search/replace in file',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean', default: false }
    },
    required: ['path', 'old_string', 'new_string']
  }
};
```

#### Phase 2: Auto-Sync with Graph

When files are modified:
1. Trigger `CodeSourceAdapter.parse()` for affected files
2. Update Neo4j entities incrementally
3. Mark embeddings as dirty
4. Optionally regenerate embeddings

```typescript
// In file tool handler
async function handleFileModified(filePath: string) {
  // 1. Re-parse the file
  const parsed = await codeAdapter.parseFile(filePath);

  // 2. Update graph (using existing ChangeTracker)
  await changeTracker.trackEntityChange(/* ... */);

  // 3. Mark embeddings dirty
  await markEmbeddingsDirty(parsed.entities);
}
```

#### Phase 3: RAG-Enhanced Operations

```typescript
// Find best place to add code
export const FindInsertionPointTool = {
  name: 'find_insertion_point',
  handler: async (params, rag) => {
    // 1. Semantic search for similar code
    const similar = await rag.semanticSearch({
      query: params.description,
      topK: 5
    });

    // 2. Get context from relationships
    const context = await rag.exploreRelationships({
      entityId: similar[0].uuid,
      types: ['DEFINED_IN', 'HAS_PARENT']
    });

    // 3. Return suggested location
    return {
      file: context.file,
      line: context.endLine + 1,
      context: similar[0].source
    };
  }
};
```

#### Phase 4: Bash Tool

```typescript
export const BashTool = {
  name: 'bash',
  description: 'Execute shell command',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'number', default: 60000 }
    },
    required: ['command']
  },
  handler: async (params) => {
    const { stdout, stderr, exitCode } = await execAsync(params.command, {
      cwd: params.cwd,
      timeout: params.timeout
    });
    return { stdout, stderr, exitCode };
  }
};
```

---

### File Structure After Implementation

```
packages/core/src/tools/
├── tool-generator.ts      # Existing RAG tools
├── file-tools.ts          # NEW: read, write, edit
├── bash-tool.ts           # NEW: shell execution
├── rag-enhanced-tools.ts  # NEW: find_insertion_point, etc.
├── tool-registry.ts       # NEW: unified registry
└── types/
    └── index.ts           # Existing types

packages/runtime/src/
├── adapters/
│   ├── code-source-adapter.ts  # Existing parser
│   ├── change-tracker.ts       # Existing diff tracking
│   └── file-sync.ts            # NEW: auto-sync handler
└── agents/
    └── code-agent.ts           # NEW: full code agent
```

---

### Test Plan

1. **Unit tests**: Each tool in isolation
2. **Integration test**: Agent modifies its own codebase
3. **Dogfooding**: Use RagForge agent to develop RagForge

```bash
# Test on ragforge itself
cd ~/LR_CodeRag/ragforge
ragforge init --adapter typescript
ragforge ingest
npx tsx test-code-agent.ts "Add a new tool called list_files"
```
