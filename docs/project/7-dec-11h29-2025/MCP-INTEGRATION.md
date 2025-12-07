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
1. [ ] Installer `@modelcontextprotocol/sdk` dans cli
2. [ ] Créer `packages/cli/src/mcp/tool-adapter.ts`
3. [ ] Créer `packages/cli/src/mcp/server.ts`
4. [ ] Créer commande `ragforge mcp-server`
5. [ ] Tester avec Claude Code
6. [ ] Ajouter filtrage par sections
7. [ ] Ajouter configuration YAML

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
