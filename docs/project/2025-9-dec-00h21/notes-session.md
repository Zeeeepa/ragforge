# Notes de Session - 9 Dec 2025 00h21

## Travail Effectué

### 1. Feature: Exclusion de Projets du Brain Search

Implémenté la possibilité d'exclure temporairement des projets de `brain_search`:

**Fichiers modifiés:**
- `packages/core/src/brain/brain-manager.ts`
  - Ajout `excluded?: boolean` à `RegisteredProject`
  - Méthodes `excludeProject()`, `includeProject()`, `toggleProjectExclusion()`
  - Modification de `search()` pour filtrer les projets exclus

- `packages/core/src/tools/brain-tools.ts`
  - Nouveaux outils MCP: `exclude_project`, `include_project`
  - Mise à jour `list_brain_projects` pour afficher le status `excluded`

**Comportement:**
- Les projets exclus ne sont pas inclus dans `brain_search` par défaut
- On peut toujours chercher dans un projet exclu en le spécifiant explicitement via `projects: ["project-id"]`
- Persiste dans `~/.ragforge/projects.yaml`

### 2. Recherche de Référence Terminal/CLI

**OpenCode** (exclu comme référence):
- Utilise **Go** pour le TUI, pas Ink
- Architecture TypeScript serveur + Go TUI via SDK
- Pas adapté pour notre cas

**Gemini CLI** (retenu comme référence):
- **Apache 2.0** - vraiment open source
- **React 19 + Ink 6** - exactement notre stack cible
- Repo: `github.com/google-gemini/gemini-cli`
- Ingéré: `references-gemini-cli-v0qx` (24,562 fichiers)

**Claude Code**:
- "Source-available" mais pas open source
- Le repo GitHub ne contient que des .md, pas le code source

### 3. Observations sur le Web Search Tool

Le tool `search_web` de RagForge fonctionne bien mais retourne des URLs de redirect Google:
```
https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQ...
```

Au lieu des vraies URLs. Le titre du site est disponible mais pas l'URL directe.

**Amélioration possible:**
- Extraire le domaine du titre quand l'URL est un redirect
- Ou résoudre les redirects pour obtenir l'URL finale

## Projets Ingérés

| Project ID | Path | Nodes | Embeddings |
|------------|------|-------|------------|
| `docs-project-d9nj` | `ragforge/docs/project` | 1,326 | ~2,634 |
| `references-opencode-usmw` | `references/opencode` | 6,657 | ~4,667 |
| `references-gemini-cli-v0qx` | `references/gemini-cli` | 24,562 | 7,437 |

## Prochaines Étapes

1. **Exclure opencode** - pas utile comme référence Ink
2. **Planifier Phase 1 Terminal Agent** basé sur gemini-cli
3. Commencer implémentation avec structure minimale
