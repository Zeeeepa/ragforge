# Comparaison Agents & Tools: LucieCode vs RagForge

> Objectif: Intégrer les outils RagForge dans LucieCode (Gemini CLI)

## LucieCode (Gemini CLI)

### Architecture Agents

| Fichier | Élément | Description |
|---------|---------|-------------|
| `packages/core/src/agents/registry.ts:45` | `AgentRegistry.initialize()` | Découvre et charge les agents (built-in, user-level ~/.gemini/agents/, project-level .gemini/agents/) |
| `packages/core/src/agents/types.ts:125` | `ToolConfig` interface | Configure les outils disponibles pour l'agent |
| `packages/core/src/agents/delegate-to-agent-tool.ts:26` | `DelegateToAgentTool` | Wrapper pour déléguer à un sous-agent comme un outil standard |
| `packages/core/src/agents/subagent-tool-wrapper.ts:24` | `SubagentToolWrapper` | Expose dynamiquement un subagent comme `DeclarativeTool` |

### Points d'intégration identifiés

- **Discovery**: `tools.discoveryCommand` dans `settings.json` - output JSON array de `FunctionDeclaration`
- **Execution**: `tools.callCommand` pour exécuter les outils custom
- **MCP Servers**: Configuration via `mcpServers` dans `settings.json` (préfixe `serverAlias__toolName`)

---

## RagForge

### Architecture Agents

| Fichier | Élément | Description |
|---------|---------|-------------|
| `core/src/runtime/agents/research-agent.ts:1544` | `createResearchAgent()` | Factory pour créer un ResearchAgent avec tous les outils brain/fs/web |
| `core/src/runtime/agents/agent-runtime.ts:788` | `AgentRuntime.executeTools()` | Exécution parallèle des tools avec logging |
| `core/src/runtime/agents/rag-agent.ts:849` | `RagAgent` class | Agent principal avec tool calling structuré |
| `core/src/tools/agent-tools.ts:77` | `generateAgentTools()` | Génère les définitions d'outils (call_agent, extract_agent_prompt, etc.) |
| `core/src/tools/agent-tools.ts:34` | `AgentToolsContext` | Context pour création d'agent et gestion conversation |

### Catégories d'outils RagForge

| Catégorie | Outils |
|-----------|--------|
| **Brain** | `brain_search`, `ingest_directory`, `ingest_web_page`, `forget_path` |
| **Files** | `read_file`, `write_file`, `edit_file`, `create_file`, `delete_path` |
| **Shell** | `run_command`, `run_npm_script`, `git_status`, `git_diff` |
| **Media** | `generate_image`, `edit_image`, `read_image`, `describe_image` |
| **3D** | `generate_3d_from_text`, `generate_3d_from_image`, `render_3d_asset`, `analyze_3d_model` |
| **Web** | `fetch_web_page`, `search_web` |
| **Project** | `create_project`, `list_projects`, `switch_project`, `exclude_project` |

---

## Stratégie d'intégration

### Option 1: MCP Server (Recommandé)
RagForge expose déjà un MCP server. Configurer dans LucieCode:
```json
{
  "mcpServers": {
    "ragforge": {
      "command": "npx",
      "args": ["@luciformresearch/ragforge", "mcp"]
    }
  }
}
```

### Option 2: Discovery Command
Créer un script qui génère les `FunctionDeclaration` depuis RagForge tools.

### Option 3: Intégration native
Adapter `generateAgentTools()` de RagForge pour retourner des `DeclarativeTool` compatibles LucieCode.

---

## Prochaines étapes

1. [ ] Analyser le format exact de `FunctionDeclaration` attendu par LucieCode
2. [ ] Vérifier la compatibilité MCP entre les deux projets
3. [ ] Identifier les outils prioritaires à intégrer (brain_search, ingest_directory)
4. [ ] Créer un adaptateur tool format RagForge → LucieCode
