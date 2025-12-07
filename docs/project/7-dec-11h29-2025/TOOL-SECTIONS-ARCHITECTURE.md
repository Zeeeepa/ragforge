# Architecture en Sections d'Outils

**Date**: 2025-12-07
**Status**: À implémenter
**Priorité**: Haute - Amélioration UX agent

---

## Motivation

L'agent a maintenant **~30+ outils** disponibles, ce qui peut :
- Surcharger le contexte LLM
- Rendre difficile le choix du bon outil
- Augmenter la latence (plus de tokens à traiter)

**Solution**: Organiser les outils en **sections** et utiliser des **sous-agents spécialisés**.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENT PRINCIPAL                           │
│  (Coordinateur avec outils minimaux)                         │
├─────────────────────────────────────────────────────────────┤
│  Outils toujours disponibles:                                │
│  • list_tool_sections  - Liste les sections disponibles     │
│  • plan_actions        - Lance sous-agent avec sections     │
│  • get_working_directory                                    │
│  • get_project_info                                         │
└─────────────────────────────────────────────────────────────┘
                              │
            plan_actions({ sections: [...] })
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SOUS-AGENT                                │
│  Outils: sections demandées + list_tool_sections            │
│          + plan_actions (si depth < max_depth)              │
└─────────────────────────────────────────────────────────────┘
```

---

## Sections d'outils

### `file_ops` - Opérations fichiers

| Outil | Description |
|-------|-------------|
| `read_file` | Lire un fichier |
| `write_file` | Créer/écraser un fichier |
| `edit_file` | Modifier un fichier |
| `list_directory` | Lister un répertoire |
| `glob_files` | Recherche par pattern |
| `file_exists` | Vérifier existence |
| `get_file_info` | Métadonnées |
| `delete_path` | Supprimer |
| `move_file` | Déplacer/renommer |
| `copy_file` | Copier |
| `create_directory` | Créer répertoire |
| `install_package` | npm install |

### `shell_ops` - Commandes shell

| Outil | Description |
|-------|-------------|
| `run_command` | Exécuter commande (whitelist) |
| `run_npm_script` | npm run <script> |
| `git_status` | État git |
| `git_diff` | Diff git |
| `list_safe_commands` | Liste whitelist |

### `rag_ops` - Knowledge graph

| Outil | Description |
|-------|-------------|
| `get_schema` | Schéma Neo4j |
| `query_entities` | Requête entités |
| `semantic_search` | Recherche sémantique |
| `explore_relationships` | Explorer relations |
| `brain_search` | Recherche cross-project |

### `project_ops` - Gestion projets

| Outil | Description |
|-------|-------------|
| `create_project` | Créer projet |
| `setup_project` | Setup quickstart |
| `load_project` | Charger projet |
| `ingest_code` | Ingérer code |
| `generate_embeddings` | Générer embeddings |
| `list_projects` | Lister projets |
| `switch_project` | Changer projet actif |
| `unload_project` | Décharger projet |
| `ingest_directory` | Quick ingest |
| `forget_path` | Oublier un path |

### `web_ops` - Web

| Outil | Description |
|-------|-------------|
| `search_web` | Recherche web |
| `fetch_web_page` | Récupérer page (avec depth) |
| `ingest_web_page` | Ingérer page dans brain |

### `media_ops` - Images & 3D

| Outil | Description |
|-------|-------------|
| `read_image` | OCR |
| `describe_image` | Description visuelle |
| `list_images` | Lister images |
| `generate_image` | Générer image |
| `generate_multiview_images` | 4 vues pour 3D |
| `render_3d_asset` | Rendu 3D → images |
| `generate_3d_from_image` | Image → 3D |
| `generate_3d_from_text` | Texte → 3D |

### `context_ops` - Contexte (toujours disponible)

| Outil | Description |
|-------|-------------|
| `get_working_directory` | Contexte actuel |
| `get_environment_info` | Environnement |
| `get_project_info` | Info projet |

---

## API

### `list_tool_sections`

```typescript
list_tool_sections()

// Retourne:
{
  sections: [
    {
      id: "file_ops",
      name: "File Operations",
      description: "Read, write, edit, list, delete, move, copy files",
      tools: ["read_file", "write_file", "edit_file", ...],
      tool_count: 12
    },
    {
      id: "shell_ops",
      name: "Shell Operations",
      description: "Run commands, git, npm scripts",
      tools: ["run_command", "git_status", ...],
      tool_count: 5
    },
    // ...
  ],
  always_available: ["get_working_directory", "get_project_info", "list_tool_sections"]
}
```

### `plan_actions` (étendu)

```typescript
plan_actions({
  goal: "Add authentication feature and test it",

  // NOUVEAU: Sections d'outils pour le sous-agent
  sections: ["file_ops", "rag_ops", "shell_ops"],

  // Existant
  actions: [
    { description: "Search for existing auth code", complexity: "simple" },
    { description: "Create new auth middleware", complexity: "moderate" },
    { description: "Update routes to use middleware", complexity: "moderate" },
    { description: "Run tests", complexity: "simple" }
  ],
  strategy: "sequential"
})
```

---

## Gestion de la profondeur

### Règles

1. Agent principal: `depth = 0`
2. Sous-agent: `depth = parent_depth + 1`
3. À `depth >= max_depth`: `plan_actions` n'est PAS exposé

### Configuration

```typescript
const MAX_SUBAGENT_DEPTH = 3; // Configurable

// Dans le contexte du sous-agent
interface SubAgentContext {
  depth: number;
  maxDepth: number;
  parentGoal?: string;
}
```

### Comportement

```
depth=0: plan_actions ✅ (peut créer sous-agent depth=1)
depth=1: plan_actions ✅ (peut créer sous-agent depth=2)
depth=2: plan_actions ✅ (peut créer sous-agent depth=3)
depth=3: plan_actions ❌ (max atteint, outil pas exposé)
```

Si un sous-agent à depth=3 a besoin de déléguer, il doit résoudre la tâche lui-même ou retourner une erreur explicative.

---

## Exemple de flux

### Requête utilisateur
```
"Ajoute une fonction d'authentification JWT et vérifie que les tests passent"
```

### Agent principal
```typescript
// 1. Analyse la requête
// 2. Décide des sections nécessaires
plan_actions({
  goal: "Add JWT authentication and run tests",
  sections: ["file_ops", "rag_ops", "shell_ops"],
  actions: [
    { description: "Find existing auth patterns in codebase" },
    { description: "Create JWT auth middleware" },
    { description: "Update routes" },
    { description: "Run tests and fix any failures" }
  ]
})
```

### Sous-agent (depth=1)
```typescript
// Reçoit: file_ops + rag_ops + shell_ops + list_tool_sections + plan_actions
//
// Exécute les actions une par une
// Si tâche trop complexe, peut appeler plan_actions avec d'autres sections
```

---

## Implémentation

### Fichiers à créer

| Fichier | Description |
|---------|-------------|
| `tool-sections.ts` | Définition des sections et mapping outils |
| `section-tools.ts` | `list_tool_sections` tool |

### Fichiers à modifier

| Fichier | Modification |
|---------|--------------|
| `planning-tools.ts` | Ajouter param `sections` à `plan_actions` |
| `rag-agent.ts` | Support du depth tracking et filtrage outils |

### Types

```typescript
// tool-sections.ts

export interface ToolSection {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export const TOOL_SECTIONS: Record<string, ToolSection> = {
  file_ops: {
    id: 'file_ops',
    name: 'File Operations',
    description: 'Read, write, edit, list, delete, move, copy files',
    tools: [
      'read_file', 'write_file', 'edit_file', 'list_directory',
      'glob_files', 'file_exists', 'get_file_info', 'delete_path',
      'move_file', 'copy_file', 'create_directory', 'install_package'
    ]
  },
  shell_ops: {
    id: 'shell_ops',
    name: 'Shell Operations',
    description: 'Run commands, git, npm scripts',
    tools: [
      'run_command', 'run_npm_script', 'git_status',
      'git_diff', 'list_safe_commands'
    ]
  },
  // ...
};

export const ALWAYS_AVAILABLE_TOOLS = [
  'get_working_directory',
  'get_project_info',
  'list_tool_sections'
];

export function getToolsForSections(sectionIds: string[]): string[] {
  const tools = new Set<string>(ALWAYS_AVAILABLE_TOOLS);
  for (const sectionId of sectionIds) {
    const section = TOOL_SECTIONS[sectionId];
    if (section) {
      section.tools.forEach(t => tools.add(t));
    }
  }
  return Array.from(tools);
}
```

---

## Liens

- [AGENT-MISSING-TOOLS.md](../AGENT-MISSING-TOOLS.md) - Outils implémentés cette session
- [planning-tools.ts](../../../packages/core/src/tools/planning-tools.ts) - Outil plan_actions actuel
- [rag-agent.ts](../../../packages/core/src/runtime/agents/rag-agent.ts) - Agent principal
