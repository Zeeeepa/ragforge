# RagForge Roadmaps - 7 December 2025

Session de planning pour la prochaine phase de RagForge.

## Documents

| Roadmap | Description | Status |
|---------|-------------|--------|
| [Agent Integration](./ROADMAP-AGENT-INTEGRATION.md) | File tracking, incremental ingestion, multi-project | ✅ Done (Phase 1-5) |
| [Agent Brain](./ROADMAP-AGENT-BRAIN.md) | Architecture globale "cerveau persistant" | ✅ Done (Phase 1-4) |
| [Universal Source Adapter](./UNIVERSAL-SOURCE-ADAPTER.md) | Refonte SourceConfig, auto-détection, multi-sources | ✅ Done |
| [Tool Sections Architecture](./TOOL-SECTIONS-ARCHITECTURE.md) | Organisation outils en sections + sous-agents | ✅ Done |
| [MCP Integration](./MCP-INTEGRATION.md) | Serveur MCP + Client MCP pour l'agent | 🚧 À implémenter |
| [Points à Unifier](./additionnal_problems.md) | Dettes techniques identifiées | Reference |

## Vision

Transformer RagForge d'un outil CLI de RAG sur code en un **agent universel avec mémoire persistante**.

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT BRAIN                            │
│  ~/.ragforge/brain/                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Neo4j                             │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │Project A │ │Quick     │ │Web Crawl │            │   │
│  │  │(code)    │ │Ingest    │ │(docs)    │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  │       ↓            ↓            ↓                   │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │         Unified Semantic Search              │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↑                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   AGENT                              │   │
│  │  - brain_search: chercher dans tout                 │   │
│  │  - ingest_directory: ingérer n'importe quoi         │   │
│  │  - explore_web: crawler et ingérer le web           │   │
│  │  - write_file / generate_image / generate_3d        │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Ordre d'implémentation

1. **Agent Integration** (en cours)
   - Media ingestion dans les tools
   - File watcher auto-start
   - Logging visible
   - Embedding auto-trigger
   - Deletion cascade

2. **Agent Brain** (après)
   - Brain manager singleton
   - Context resolution (project vs quick-ingest)
   - Quick ingest CLI/tool
   - Unified cross-project search
   - Web crawler

## Prochaines étapes immédiates

### Agent Integration ✅ DONE
- [x] Phase 1: Media ingestion (image/3D tools)
- [x] Phase 2: File tracker auto-start & logging
- [x] Phase 3: Embedding auto-trigger
- [x] Phase 4: Deletion cascade
- [x] Phase 5: Multi-project registry

### Brain + Universal Source Adapter ✅ DONE
- [x] `BrainManager` créé (structure de base)
- [x] **Universal Source Adapter** - Refonte `SourceConfig`:
  - [x] Enlever `adapter` obligatoire
  - [x] `type: 'files' | 'database' | 'api' | 'web'`
  - [x] `UniversalSourceAdapter` avec dispatch par type
  - [x] Auto-détection du parser basé sur extension (via CodeSourceAdapter)
- [x] Quick ingest (`ingest_directory` tool)
- [x] `brain_search` tool (cross-project)
- [x] `forget_path` + `list_brain_projects` tools
- [x] DatabaseAdapter (placeholder - throws "not yet implemented")
- [x] WebAdapter (crawler avec Playwright) - créé mais non utilisé directement
- [x] APIAdapter (placeholder - throws "not yet implemented")

### Web Ingestion ✅ DONE
- [x] **LRU Cache** pour `fetch_web_page` (6 dernières pages)
- [x] Option `ingest: true` sur `fetch_web_page` pour ingérer direct
- [x] Option `force: true` pour bypass cache
- [x] Tool `ingest_web_page` dans brain-tools.ts
- [x] UUID déterministe basé sur URL (`UniqueIDHelper.GenerateDeterministicUUID`)
- [x] `BrainManager.ingestWebPage()` avec node WebPage + rawHtml stocké

### Recursive Web Crawling ✅ DONE
- [x] **Param `depth`** sur `fetch_web_page` (0=page unique, 1+=suivre les liens)
- [x] **Param `maxPages`** pour limiter le nombre de pages (défaut: 10)
- [x] **Params `includePatterns` / `excludePatterns`** (regex) pour filtrer les URLs
- [x] Résultat avec `children[]` contenant les pages enfants
- [x] Même params sur `ingest_web_page` pour ingestion récursive
- [x] Sécurité: reste sur le même domaine uniquement

### Tool Schema Improvements ✅ DONE
- [x] **`ToolPropertySchema.optional`** - champ pour marquer les params optionnels
- [x] **`processToolSchema()`** - enrichit les descriptions avec "(optional)"
- [x] **`processToolSchemas()`** - traitement par lot
- [x] Support `oneOf`/`anyOf` dans les schemas (type optionnel)

### Agent Autonomous Tools ✅ DONE (Session 16h)
- [x] **FS Tools** - `list_directory`, `glob_files`, `file_exists`, `get_file_info`, `delete_path`, `move_file`, `copy_file`, `create_directory`
- [x] **Shell Tools** - `run_command` (avec whitelist), `run_npm_script`, `git_status`, `git_diff`, `list_safe_commands`
- [x] **Context Tools** - `get_working_directory`, `get_environment_info`, `get_project_info`
- [x] Option `no_default_excludes` pour explorer node_modules, .git, etc.
- [x] Sécurité shell: whitelist + patterns dangereux + confirmation callback
- [x] Intégration dans `rag-agent.ts` (activés par défaut)

### Tool Sections Architecture ✅ DONE (Session 17h)
- [x] `ToolSection` type dans `types/index.ts` (8 sections)
- [x] `tool-sections.ts` créé avec :
  - [x] `SECTION_INFO` - descriptions (Record force compilation)
  - [x] `aggregateToolsBySection()` - grouper par section
  - [x] `getToolsForSections()` - filtrer par sections
  - [x] `getSectionSummary()` - résumé avec counts
  - [x] `SubAgentContext` + helpers pour profondeur
  - [x] `validateToolSection()` - validation runtime
- [x] `section` ajouté à TOUS les outils (~35 outils)
- [x] Exports dans `index.ts`

### MCP Integration 🚧 À FAIRE
Phase 1 - MCP Server (exposer RagForge) :
- [ ] Installer `@modelcontextprotocol/sdk`
- [ ] `packages/cli/src/mcp/tool-adapter.ts`
- [ ] `packages/cli/src/mcp/server.ts`
- [ ] Commande `ragforge mcp-server`
- [ ] Tester avec Claude Code
- [ ] Filtrage par sections
- [ ] Configuration YAML

Phase 2 - MCP Client (connecter à serveurs externes) :
- [ ] `packages/core/src/mcp/client-manager.ts`
- [ ] `packages/core/src/tools/mcp-client-tools.ts`
- [ ] Section `mcp_ops` dans SECTION_INFO
- [ ] Intégration rag-agent.ts

### À Faire
- [ ] DatabaseAdapter complet (PostgreSQL, MySQL, etc.)
- [ ] Tests end-to-end

### Résumé Phase 5
- `ProjectRegistry` dans `packages/core/src/runtime/projects/`
- Tools `list_projects`, `switch_project`, `unload_project`
- `AgentProjectContext` intégré avec le registry
- `syncContextFromRegistry()` synchronise l'état
- Cleanup via `registry.dispose()`
