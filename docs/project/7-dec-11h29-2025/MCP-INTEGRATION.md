# MCP Integration - RagForge

## Vue d'ensemble

Intégration bidirectionnelle avec le **Model Context Protocol (MCP)** :

1. **MCP Server** : Exposer les outils RagForge comme serveur MCP
2. **MCP Client** : Permettre à l'agent de se connecter à des serveurs MCP externes

```
┌────────────────────────────────────────────────────────────────┐
│                         CLAUDE CODE                             │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   MCP CLIENT                             │   │
│  │  (Claude Code se connecte aux serveurs MCP)              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │ RAGFORGE      │ │ FILESYSTEM    │ │ OTHER         │         │
│  │ MCP SERVER    │ │ MCP SERVER    │ │ MCP SERVERS   │         │
│  │               │ │               │ │               │         │
│  │ - RAG tools   │ │ - read_file   │ │ - git         │         │
│  │ - Brain tools │ │ - write_file  │ │ - database    │         │
│  │ - Web tools   │ │ - list_dir    │ │ - etc.        │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                       RAGFORGE AGENT                            │
│                              │                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   MCP CLIENT TOOLS                       │   │
│  │  connect_mcp_server, call_mcp_tool, list_mcp_tools      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │ SLACK         │ │ NOTION        │ │ CUSTOM        │         │
│  │ MCP SERVER    │ │ MCP SERVER    │ │ MCP SERVERS   │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
└────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 : MCP Server (Exposer RagForge)

### Objectif

Permettre à Claude Code (ou tout client MCP) de se connecter à RagForge et utiliser ses outils.

### Architecture

```
packages/cli/src/mcp/
├── server.ts           # Point d'entrée MCP server
├── tool-adapter.ts     # Convertit GeneratedToolDefinition → MCP Tool
└── handler-bridge.ts   # Bridge entre MCP requests et nos handlers
```

### Implémentation

#### 1. Dépendances

```bash
npm install @modelcontextprotocol/sdk
```

#### 2. Conversion des outils

```typescript
// tool-adapter.ts
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { GeneratedToolDefinition } from '@luciformresearch/ragforge';

export function convertToMcpTool(tool: GeneratedToolDefinition): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

export function convertAllTools(tools: GeneratedToolDefinition[]): Tool[] {
  return tools.map(convertToMcpTool);
}
```

#### 3. Serveur MCP

```typescript
// server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export async function startMcpServer(options: {
  projectPath?: string;
  tools: GeneratedToolDefinition[];
  handlers: Record<string, Function>;
}) {
  const server = new Server(
    { name: 'ragforge', version: '0.3.0' },
    { capabilities: { tools: {} } }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: convertAllTools(options.tools),
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = options.handlers[name];

    if (!handler) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

#### 4. Commande CLI

```bash
# Nouvelle commande
ragforge mcp-server [--project <path>]

# Exemple dans claude_desktop_config.json
{
  "mcpServers": {
    "ragforge": {
      "command": "ragforge",
      "args": ["mcp-server", "--project", "/path/to/my-project"]
    }
  }
}
```

### Outils exposés via MCP

Par section (utilisant notre nouveau système de sections) :

| Section | Outils |
|---------|--------|
| `file_ops` | read_file, write_file, edit_file, list_directory, glob_files, file_exists, delete_path, move_file, copy_file, create_directory |
| `shell_ops` | run_command, run_npm_script, git_status, git_diff, list_safe_commands |
| `rag_ops` | get_schema, query_entities, semantic_search, explore_relationships, get_entity_by_id, get_entities_by_ids, glob_search |
| `project_ops` | create_project, setup_project, ingest_code, generate_embeddings, load_project, list_projects, switch_project |
| `web_ops` | search_web, fetch_web_page |
| `media_ops` | read_image, describe_image, generate_image, analyze_visual, render_3d_asset, generate_3d_from_image |
| `context_ops` | get_working_directory, get_environment_info, get_project_info |
| `planning_ops` | plan_actions |

### Configuration

```yaml
# ~/.ragforge/mcp-server.yaml (optionnel)
server:
  name: ragforge
  version: 0.3.0

# Sections à exposer (toutes par défaut)
sections:
  - file_ops
  - shell_ops
  - rag_ops
  - project_ops
  - web_ops
  - media_ops
  - context_ops

# Outils à exclure
exclude_tools:
  - delete_path  # Trop dangereux

# Confirmation requise pour certains outils
require_confirmation:
  - run_command
  - delete_path
```

---

## Phase 2 : MCP Client (Se connecter à d'autres serveurs)

### Objectif

Permettre à l'agent RagForge de se connecter à des serveurs MCP externes et utiliser leurs outils.

### Nouveaux outils (section: `mcp_ops`)

```typescript
// packages/core/src/tools/mcp-client-tools.ts

// 1. connect_mcp_server
{
  name: 'connect_mcp_server',
  section: 'mcp_ops',
  description: `Connect to an MCP server.

Parameters:
- name: Identifier for this connection (e.g., "slack", "notion")
- command: Command to run the server (e.g., "npx", "python")
- args: Arguments for the command
- env: Environment variables (optional)

Example:
  connect_mcp_server({
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
  })`,
}

// 2. list_mcp_connections
{
  name: 'list_mcp_connections',
  section: 'mcp_ops',
  description: 'List all active MCP server connections.',
}

// 3. list_mcp_tools
{
  name: 'list_mcp_tools',
  section: 'mcp_ops',
  description: `List tools available on a connected MCP server.

Parameters:
- server: Name of the connected server

Example: list_mcp_tools({ server: "filesystem" })`,
}

// 4. call_mcp_tool
{
  name: 'call_mcp_tool',
  section: 'mcp_ops',
  description: `Call a tool on a connected MCP server.

Parameters:
- server: Name of the connected server
- tool: Tool name to call
- arguments: Arguments to pass to the tool

Example:
  call_mcp_tool({
    server: "filesystem",
    tool: "read_file",
    arguments: { path: "/etc/hosts" }
  })`,
}

// 5. disconnect_mcp_server
{
  name: 'disconnect_mcp_server',
  section: 'mcp_ops',
  description: 'Disconnect from an MCP server.',
}
```

### Architecture interne

```typescript
// packages/core/src/mcp/client-manager.ts

export class McpClientManager {
  private connections: Map<string, Client> = new Map();

  async connect(name: string, config: McpServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });

    const client = new Client({ name: 'ragforge-agent', version: '0.3.0' }, {});
    await client.connect(transport);

    this.connections.set(name, client);
  }

  async listTools(serverName: string): Promise<Tool[]> {
    const client = this.connections.get(serverName);
    if (!client) throw new Error(`Not connected to: ${serverName}`);

    const result = await client.listTools();
    return result.tools;
  }

  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const client = this.connections.get(serverName);
    if (!client) throw new Error(`Not connected to: ${serverName}`);

    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async disconnect(serverName: string): Promise<void> {
    const client = this.connections.get(serverName);
    if (client) {
      await client.close();
      this.connections.delete(serverName);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [name] of this.connections) {
      await this.disconnect(name);
    }
  }
}
```

---

## Phase 3 : Intégration dans l'Agent

### Mise à jour de rag-agent.ts

```typescript
// Dans createRagAgent options
interface RagAgentOptions {
  // ... existing options ...

  /** Start as MCP server instead of interactive agent */
  mcpServerMode?: boolean;

  /** Pre-configured MCP connections */
  mcpConnections?: Array<{
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
  }>;
}
```

### Mise à jour de SECTION_INFO

```typescript
// tool-sections.ts - Ajouter nouvelle section
export type ToolSection =
  | 'file_ops'
  | 'shell_ops'
  | 'rag_ops'
  | 'project_ops'
  | 'web_ops'
  | 'media_ops'
  | 'context_ops'
  | 'planning_ops'
  | 'mcp_ops';  // NEW

export const SECTION_INFO: Record<ToolSection, SectionInfo> = {
  // ... existing sections ...

  mcp_ops: {
    id: 'mcp_ops',
    name: 'MCP Connections',
    description: 'Connect to and use external MCP servers',
  },
};
```

---

## Ordre d'implémentation

### Phase 1 : MCP Server (priorité)
1. [x] Installer `@modelcontextprotocol/sdk` dans cli
2. [x] Créer `packages/cli/src/mcp/tool-adapter.ts`
3. [x] Créer `packages/cli/src/mcp/server.ts`
4. [x] Créer commande `ragforge mcp-server`
5. [x] Tester avec Claude Code - **PARTIELLEMENT** (voir bugs ci-dessous)
6. [x] Ajouter filtrage par sections
7. [ ] Ajouter configuration YAML

### ✅ STATUS FINAL (7 déc 2025, 20h00)

**39 outils disponibles via MCP Server !**

---

## 📋 Liste exhaustive des tests par outil

### `file_ops` (15 outils) ✅ COMPLET

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `read_file` | ✅ | OK | Error claire si fichier inexistant |
| `write_file` | ✅ | OK | ⚠️ Écrase si existe ! Retourne diff + change_type |
| `create_file` | ✅ | OK | **NOUVEAU** - Error si fichier existe déjà |
| `edit_file` | ✅ | OK | Error claire si old_string pas trouvé |
| `list_directory` | ✅ | OK | Fallback sur cwd si pas de projet |
| `glob_files` | ✅ | OK | Fix ESM `import path` |
| `file_exists` | ✅ | OK | Retourne exists, type, path |
| `get_file_info` | ✅ | OK | Taille, dates, permissions |
| `delete_path` | ✅ | OK | Error si non-vide sans `recursive: true` |
| `move_file` | ✅ | OK | Error ENOENT si source inexistante |
| `copy_file` | ✅ | OK | Error si dest existe, `overwrite: true` pour forcer |
| `create_directory` | ✅ | OK | Crée récursivement si besoin |
| `change_directory` | ✅ | OK | **NOUVEAU** - cd, retourne previous/current |
| `grep_files` | ✅ | OK | **NOUVEAU** - Regex + glob + p-limit (7 matches/3092 files) |
| `search_files` | ✅ | OK | **NOUVEAU** - Fuzzy Levenshtein (trouve "authentication" avec "authentification" 88%) |

### `shell_ops` (5 outils)

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `run_command` | ✅ | OK | Whitelist de commandes sécurisées |
| `run_npm_script` | ✅ | OK | Passe les args correctement |
| `git_status` | ✅ | OK | Fonctionne bien |
| `git_diff` | ✅ | OK | Montre diff staged/unstaged |
| `list_safe_commands` | ✅ | OK | 66 commandes whitelistées par catégorie |

### `context_ops` (3 outils)

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `get_working_directory` | ✅ | OK | Retourne cwd + info projet |
| `get_environment_info` | ✅ | OK | Info Node, OS, etc. |
| `get_project_info` | ✅ | OK | Retourne null si pas de projet |

### `project_ops` (3 outils)

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `list_projects` | ✅ | OK | Liste vide si pas de projet |
| `switch_project` | ❌ | - | À tester avec projet chargé |
| `unload_project` | ❌ | - | À tester avec projet chargé |

### `brain_ops` (5 outils) - Nécessite NEO4J_*

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `ingest_directory` | ❌ | - | À tester |
| `ingest_web_page` | ❌ | - | À tester |
| `brain_search` | ❌ | - | À tester |
| `forget_path` | ❌ | - | À tester |
| `list_brain_projects` | ✅ | OK | Retourne liste vide si rien ingéré |

### `web_ops` (2 outils) - Nécessite GEMINI_API_KEY

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `search_web` | ✅ | OK | Recherche Google via Gemini |
| `fetch_web_page` | ✅ | OK | ⚠️ **Réponse très lourde** - besoin option `summary` |

**TODO `fetch_web_page`**: Ajouter option `summary: boolean` pour retourner un résumé au lieu du contenu complet. Actuellement retourne tout le HTML/texte ce qui surcharge le contexte.

### `media_ops` (6 outils)

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `read_image` | ✅ | OK | OCR via Gemini, extrait "HEAVY METAL" en 1s |
| `describe_image` | ✅ | OK | Gemini Vision, 1-3s, description générale |
| `list_images` | ✅ | OK | Liste récursive avec tailles (169 images trouvées) |
| `generate_image` | ❌ | - | Gemini image gen - coûteux, À tester |
| `generate_multiview_images` | ❌ | - | 4 vues pour 3D - coûteux, À tester |
| `analyze_visual` | ✅ | OK | Gemini Vision + prompt, détecte texte LUCIFORM_SONG |

**Différence `describe_image` vs `analyze_visual`:**
- `describe_image`: Description générale d'une image, prompt optionnel
- `analyze_visual`: Plus puissant, fonctionne aussi sur **PDF**, prompt requis, conçu pour quand OCR échoue ou analyse de documents

### `3d_ops` (3 outils)

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `render_3d_asset` | ✅ | OK | Three.js GLB→PNG, rendu duck en 2 vues (437KB+242KB) |
| `generate_3d_from_image` | ✅ | OK | Utilisé par generate_3d_from_text (Trellis) |
| `generate_3d_from_text` | ✅ | OK | **"Lucie demon queen"** → 2.1MB GLB, yeux rouges, ailes, couronne ! 😈 |

### `discovery_ops` (2 outils) - Nécessite projet chargé

| Outil | Testé | Résultat | Notes |
|-------|-------|----------|-------|
| `get_schema` | ❌ | - | Schéma Neo4j du projet |
| `describe_entity` | ❌ | - | Détails d'une entité |

---

## 📊 Résumé des tests (7 déc 2025, 19h10)

| Catégorie | Total | Testés | OK | À tester |
|-----------|-------|--------|-----|----------|
| `file_ops` | 11 | 5 | 5 | 6 |
| `shell_ops` | 5 | 5 | 5 | 0 |
| `context_ops` | 3 | 3 | 3 | 0 |
| `project_ops` | 3 | 1 | 1 | 2 |
| `brain_ops` | 5 | 1 | 1 | 4 |
| `web_ops` | 2 | 2 | 2 | 0 |
| `media_ops` | 6 | 4 | 4 | 2 |
| `3d_ops` | 3 | 3 | 3 | 0 |
| `discovery_ops` | 2 | 0 | 0 | 2 |
| **TOTAL** | **40** | **24** | **24** | **16** |

---

## Outils NON encore intégrés au MCP Server

| Fichier source | Outils | Raison |
|----------------|--------|--------|
| `project-tools.ts` | create_project, setup_project, load_project, ingest_code, embeddings | Complexité des callbacks - à faire via CLI |
| `database-tools.ts` | query_database, describe_table, list_tables | Nécessite connexions DB externes |
| `planning-tools.ts` | plan_actions | Dépend de l'agent loop |

---

## Bugs corrigés

- [x] `require('path')` → `import path` dans fs-tools.ts et shell-tools.ts (ESM compatibility)
- [x] `projectRoot` fallback vers `process.cwd()` pour mode standalone
- [x] Types corrigés pour getEnv (string[] vs string)
- [x] BrainConfig.neo4j.type manquant

## Variables d'environnement requises

| Variable | Outils concernés | Notes |
|----------|-----------------|-------|
| `GEMINI_API_KEY` | web_ops, media_ops (describe_image, analyze_visual, read_image, generate_image, generate_multiview) | Google AI Studio |
| `NEO4J_URI` | brain_ops, discovery_ops | Ex: `bolt://localhost:7687` |
| `NEO4J_USERNAME` | brain_ops, discovery_ops | ou `NEO4J_USER` |
| `NEO4J_PASSWORD` | brain_ops, discovery_ops | |
| `NEO4J_DATABASE` | brain_ops, discovery_ops | Défaut: `neo4j` |
| `REPLICATE_API_TOKEN` | 3d_ops (generate_3d_from_image, generate_3d_from_text) | ⚠️ **Non vérifié au démarrage** - échouera à l'exécution si manquant |

## TODO prioritaires

1. [ ] **`fetch_web_page`** : Ajouter option `summary` pour réduire la réponse
2. [ ] **3d_ops** : Vérifier `REPLICATE_API_TOKEN` au démarrage et désactiver si absent
3. [x] ~~Tester `generate_3d_from_text`~~ → **Lucie la démone générée avec succès !** 😈
4. [ ] Tester les outils restants : brain_ops (4), project_ops (2), discovery_ops (2), file_ops (6)
5. [ ] Documentation utilisateur avec exemples

### Phase 2 : MCP Client
1. [ ] Créer `packages/core/src/mcp/client-manager.ts`
2. [ ] Créer `packages/core/src/tools/mcp-client-tools.ts`
3. [ ] Ajouter section `mcp_ops` à SECTION_INFO
4. [ ] Intégrer dans rag-agent.ts
5. [ ] Tests avec serveurs MCP existants (filesystem, git)

### Phase 3 : Polish
1. [ ] Documentation utilisateur
2. [ ] Exemples de configuration
3. [ ] Error handling robuste
4. [ ] Reconnection automatique

---

## Exemples d'utilisation

### Claude Code → RagForge

```json
// ~/.config/claude/claude_desktop_config.json
{
  "mcpServers": {
    "ragforge": {
      "command": "ragforge",
      "args": ["mcp-server", "--project", "/home/user/my-project"]
    }
  }
}
```

Ensuite dans Claude Code :
```
User: Use RagForge to search for authentication code
Claude: *calls semantic_search via MCP*
```

### RagForge Agent → External MCP

```
User: Connect to the Notion MCP server and list my pages

Agent: *calls connect_mcp_server({ name: "notion", command: "npx", args: ["@notionhq/mcp-server"] })*
Agent: *calls list_mcp_tools({ server: "notion" })*
Agent: *calls call_mcp_tool({ server: "notion", tool: "list_pages", arguments: {} })*
```

---

## Références

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP SDK TypeScript](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Servers Registry](https://github.com/modelcontextprotocol/servers)
