# RagForge - Instructions Claude

## Qu'est-ce que RagForge ?

RagForge est un outil de RAG (Retrieval-Augmented Generation) qui:
- **Ingère** du code et des documents dans une base Neo4j
- **Génère des embeddings** (via Ollama ou Gemini) pour la recherche sémantique
- **Analyse** les relations entre fichiers (imports, dépendances, héritage)
- **Permet** des recherches sémantiques via `brain_search`

## Utilisation des outils RagForge vs outils natifs Claude

### Pour l'édition de fichiers: UTILISER LES OUTILS NATIFS

**Ne pas utiliser** les outils RagForge pour:
- `mcp__ragforge__write_file` -> utiliser `Write` natif
- `mcp__ragforge__edit_file` -> utiliser `Edit` natif
- `mcp__ragforge__create_file` -> utiliser `Write` natif

Raison: Les outils RagForge remplissent le terminal avec beaucoup d'output et sont moins pratiques pour l'édition.

### Pour la lecture/recherche: UTILISER RAGFORGE

**Utiliser RagForge** pour:

1. **`mcp__ragforge__read_file`** - Lit un fichier ET l'ingère automatiquement dans Neo4j pour les futures `brain_search`. Utile avec l'option `analyze: true` pour voir les relations du code.

2. **`mcp__ragforge__grep_files`** - Recherche regex dans les fichiers. Avec `analyze: true`, retourne aussi les scopes et relations. Souvent plus complet que le grep natif.

3. **`mcp__ragforge__glob_files`** - Trouve des fichiers par pattern. Parfois trouve plus de résultats que le Glob natif de Claude.

4. **`mcp__ragforge__list_directory`** - Liste les fichiers/dossiers. Le mode `recursive: true` est très pratique pour explorer une arborescence.

5. **`mcp__ragforge__analyze_files`** - Analyse statique de fichiers TypeScript/Python sans les stocker en DB. Retourne les scopes et relations.

6. **`mcp__ragforge__brain_search`** - Recherche sémantique dans tout le code/docs ingérés. Utiliser `semantic: true` pour les meilleurs résultats.

### Bonnes pratiques

```
# Lire un fichier avec analyse des relations
mcp__ragforge__read_file({ path: "src/auth.ts", analyze: true })

# Grep avec analyse des scopes trouvés
mcp__ragforge__grep_files({ pattern: "**/*.ts", regex: "class.*Service", analyze: true })

# Explorer récursivement un dossier
mcp__ragforge__list_directory({ path: "src", recursive: true })

# Recherche sémantique
mcp__ragforge__brain_search({ query: "authentication logic", semantic: true })
```

## Architecture RagForge

```
packages/
├── core/               # Coeur de RagForge
│   ├── src/ingestion/  # Parsers (code, docs, media, data)
│   ├── src/runtime/    # LLM, embeddings, agents
│   └── src/brain/      # Neo4j, vector search
├── cli/                # CLI interactif
└── mcp/                # Serveur MCP pour Claude
```

## Projets liés

- **community-docs** (`packages/community-docs/`): Hub de documentation avec intégration RagForge
  - API dédiée sur port 6970
  - Neo4j dédié sur port 7688 (séparé du CLI sur 7687)
  - Embeddings via Ollama (mxbai-embed-large)
