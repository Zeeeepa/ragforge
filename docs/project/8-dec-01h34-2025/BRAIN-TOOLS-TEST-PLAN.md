# Brain Tools Test Plan

**Date:** 8 décembre 2025, 01:34
**Objectif:** Valider tous les outils du brain et types de fichiers supportés

---

## 1. Types de Fichiers à Tester

### Code (via CodeSourceAdapter)
| Type | Extension | Parser | Status |
|------|-----------|--------|--------|
| TypeScript | `.ts`, `.tsx` | TypeScriptLanguageParser | ⬜ |
| JavaScript | `.js`, `.jsx` | TypeScriptLanguageParser | ⬜ |
| Python | `.py` | PythonLanguageParser | ⬜ |
| Vue SFC | `.vue` | VueParser | ⬜ |
| Svelte | `.svelte` | SvelteParser | ⬜ |
| HTML | `.html` | HTMLDocumentParser | ⬜ |
| CSS | `.css` | CSSParser | ⬜ |
| SCSS | `.scss` | SCSSParser | ⬜ |

### Markdown (via MarkdownParser)
| Type | Extension | Nodes créés | Status |
|------|-----------|-------------|--------|
| Markdown | `.md` | MarkupDocument, MarkdownSection, CodeBlock | ✅ Testé |

### Data Files (via data-file-parser)
| Type | Extension | Status |
|------|-----------|--------|
| JSON | `.json` | ⬜ |
| YAML | `.yaml`, `.yml` | ⬜ |
| XML | `.xml` | ⬜ |
| TOML | `.toml` | ⬜ |
| ENV | `.env` | ⬜ |

### Media Files (via media-file-parser)
| Type | Extension | Status |
|------|-----------|--------|
| Images | `.png`, `.jpg`, `.gif`, `.webp`, `.svg` | ⬜ |
| 3D Models | `.glb`, `.gltf`, `.obj`, `.fbx` | ⬜ |
| PDF | `.pdf` | ⬜ |

### Documents (via document-file-parser)
| Type | Extension | Status |
|------|-----------|--------|
| Word | `.docx` | ⬜ |
| Excel | `.xlsx` | ⬜ |
| PowerPoint | `.pptx` | ⬜ |

---

## 2. Outils Brain à Tester

### Ingestion
| Outil | Params | Status |
|-------|--------|--------|
| `ingest_directory` | path, project_name, watch, generate_embeddings | ✅ Testé |
| `ingest_web_page` | url, depth, max_pages | ⬜ |

### Recherche
| Outil | Params | Status |
|-------|--------|--------|
| `brain_search` | query, limit, types, projects, semantic, embedding_type | ✅ Testé (text) |
| `brain_search` (semantic) | semantic=true | ⬜ |

### Gestion
| Outil | Params | Status |
|-------|--------|--------|
| `list_brain_projects` | - | ⬜ |
| `forget_path` | path | ⬜ |
| `cleanup_brain` | mode, confirm | ✅ Testé |
| `cleanup_brain` | mode, confirm, project_id | ✅ Implémenté et testé |

### Configuration
| Outil | Params | Status |
|-------|--------|--------|
| `get_brain_status` | - | ✅ Testé |
| `set_api_key` | key_name, key_value | ⬜ |

---

## 3. Embeddings à Tester

### Types d'Embeddings (multi-embeddings)
| Type | Champ | Description | Status |
|------|-------|-------------|--------|
| Name | `embedding_name` | Noms, signatures | ⬜ |
| Content | `embedding_content` | Code, texte | ⬜ |
| Description | `embedding_description` | Docstrings, descriptions | ⬜ |

### Recherche Sémantique
| Test | Query | embedding_type | Status |
|------|-------|----------------|--------|
| Par nom | "find the auth function" | name | ⬜ |
| Par contenu | "code that validates JWT" | content | ⬜ |
| Par description | "documented as authentication" | description | ⬜ |
| Tous | "authentication logic" | all | ⬜ |

---

## 4. Features à Implémenter

### Priorité Haute
- [x] `cleanup_brain --project_id=X` : Supprimer un projet spécifique ✅ FAIT
- [ ] Test de la recherche sémantique avec embeddings
- [ ] Bug: CodeBlocks dans markdown n'ont pas de `projectId` (326 nodes orphelins)

### Priorité Moyenne
- [ ] Test ingestion de chaque type de fichier
- [ ] Vérifier que les nodes sont bien créés pour chaque type

### Priorité Basse
- [ ] Tests des media files (images, 3D, PDF)
- [ ] Tests des documents Office

---

## 5. Commandes de Test

```bash
# Cleanup total
npx tsx packages/cli/src/index.ts test-tool cleanup_brain --mode=data_only --confirm=true

# Cleanup d'un projet spécifique (À IMPLÉMENTER)
npx tsx packages/cli/src/index.ts test-tool cleanup_brain --mode=project --project_id=ragforge-docs --confirm=true

# Ingestion
npx tsx packages/cli/src/index.ts test-tool ingest_directory --path=./docs/project --project_name=ragforge-docs

# Recherche textuelle
npx tsx packages/cli/src/index.ts test-tool brain_search --query "embedding" --limit 10

# Recherche sémantique
npx tsx packages/cli/src/index.ts test-tool brain_search --query "embedding" --limit 10 --semantic=true

# Recherche par type d'embedding
npx tsx packages/cli/src/index.ts test-tool brain_search --query "function" --embedding_type=name --semantic=true

# Liste des projets
npx tsx packages/cli/src/index.ts test-tool list_brain_projects

# Status du brain
npx tsx packages/cli/src/index.ts test-tool get_brain_status
```

---

## 6. Résultats des Tests

### 8 décembre 2025

| Heure | Test | Résultat | Notes |
|-------|------|----------|-------|
| 01:28 | cleanup_brain (data_only) | ✅ | Fonctionne, registry aussi nettoyé |
| 01:28 | ingest_directory (markdown) | ✅ | 849 MarkdownSections créées |
| 01:30 | brain_search (texte) | ✅ | Trouve le contenu des sections |
| 01:37 | ingest_directory (code) | ✅ | 326 scopes créés |
| 01:38 | cleanup_brain (project) | ✅ | Supprime 359 nodes, garde l'autre projet |
| 01:38 | list_brain_projects | ✅ | 1 projet restant après suppression |
