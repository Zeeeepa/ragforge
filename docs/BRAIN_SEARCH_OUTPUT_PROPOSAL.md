# Proposition: Format de Sortie Optimisé pour brain_search

## Problème Actuel

Un brain_search avec `explore_depth=2` et `limit=5` génère un fichier de **112K** (2913 lignes).

Causes:
- Données redondantes: `absolutePath`, `file`, `filePath` (3x le même path)
- Champs internes exposés: `schemaVersion`, `hash`, `rrfDetails`
- `source` complet pour chaque nœud exploré
- Pas de format lisible pour humains

## Proposition: Nouveau Format

### 1. Option `format: 'compact' | 'full' | 'markdown'`

```typescript
brain_search({
  query: "...",
  format: "markdown",  // Nouveau paramètre
  explore_depth: 2,
  include_source: false,  // Optionnel: exclure le code source
})
```

### 2. Format Markdown Proposé

```markdown
# Brain Search: "OAuthCredentialStorage loadCredentials"

**Query:** OAuthCredentialStorage loadCredentials saveCredentials
**Projects:** ragforge-LucieCode-spnt
**Explore Depth:** 2
**Results:** 5

---

## Results

### 1. OAuthCredentialStorage (class) ★ 1.21
📍 `packages/core/src/code_assist/oauth-credential-storage.ts:20-139`
📝 Main class for OAuth credential management

### 2. saveCredentials (method) ★ 1.08
📍 `packages/core/src/code_assist/oauth-credential-storage.ts:65-84`
📝 Save OAuth credentials
```typescript
static async saveCredentials(credentials: Credentials): Promise<void>
```

### 3. loadCredentials (method) ★ 0.99
📍 `packages/core/src/code_assist/oauth-credential-storage.ts:28-60`
📝 Load cached OAuth credentials

---

## Dependency Graph (explore_depth=2)

```
OAuthCredentialStorage (class)
├── USES_LIBRARY
│   ├── google-auth-library
│   ├── node:path
│   └── node:fs
├── CONSUMES (imports)
│   ├── HybridTokenStorage ← mcp/token-storage/hybrid-token-storage.ts:15
│   ├── OAUTH_FILE ← config/storage.ts:12
│   └── coreEvents ← utils/events.ts:8
├── CONTAINS (children)
│   ├── loadCredentials (method) :28-60
│   ├── saveCredentials (method) :65-84
│   ├── clearCredentials (method) :89-104
│   └── migrateFromFileStorage (method) :109-138
└── CONSUMED_BY (used by)
    ├── oauth2.ts:initOauthClient :150
    ├── oauth2.ts:fetchCachedCredentials :580
    └── brain-manager-provider.ts:exportOAuthForDaemon :52

saveCredentials (method)
├── CALLS
│   ├── this.storage.setCredentials
│   └── Date.now
└── USES_TYPE
    ├── Credentials
    └── OAuthCredentials
```

---

## Nodes Summary (106 total)

| Type | Count | Examples |
|------|-------|----------|
| class | 12 | OAuthCredentialStorage, HybridTokenStorage, ... |
| method | 45 | loadCredentials, saveCredentials, ... |
| function | 18 | initOauthClient, fetchCachedCredentials, ... |
| interface | 8 | Credentials, OAuthCredentials, ... |
| variable | 23 | MAIN_ACCOUNT_KEY, OAUTH_FILE, ... |

---

## Raw Data (if needed)

<details>
<summary>Full JSON (click to expand)</summary>

```json
{ ... }
```
</details>
```

### 3. Format Compact JSON

Pour les cas où on veut du JSON mais compressé:

```json
{
  "query": "OAuthCredentialStorage",
  "results": [
    {
      "id": "611A96E6-...",
      "name": "OAuthCredentialStorage",
      "type": "class",
      "file": "code_assist/oauth-credential-storage.ts",
      "lines": [20, 139],
      "score": 1.21,
      "sig": "class OAuthCredentialStorage()"
    }
  ],
  "graph": {
    "nodes": ["611A96E6:OAuthCredentialStorage:class", ...],
    "edges": ["611A96E6→USES→76F0BAB4", ...]
  }
}
```

## Implémentation

### Fichiers à modifier

1. **`packages/core/src/tools/brain-tools.ts`**
   - Ajouter paramètre `format` au schéma
   - Créer `formatBrainSearchResult(result, format)`

2. **Nouveau: `packages/core/src/brain/formatters/brain-search-formatter.ts`**
   - `formatAsMarkdown(result): string`
   - `formatAsCompact(result): object`
   - `buildAsciiTree(graph): string`

### Exemple d'arbre ASCII

```typescript
function buildAsciiTree(
  graph: { nodes: Node[], edges: Edge[] },
  rootId: string,
  maxDepth: number = 2
): string {
  const nodeMap = new Map(graph.nodes.map(n => [n.uuid, n]));
  const edgesByFrom = new Map<string, Edge[]>();

  for (const edge of graph.edges) {
    if (!edgesByFrom.has(edge.from)) edgesByFrom.set(edge.from, []);
    edgesByFrom.get(edge.from)!.push(edge);
  }

  function renderNode(id: string, prefix: string, isLast: boolean, depth: number): string[] {
    if (depth > maxDepth) return [];

    const node = nodeMap.get(id);
    if (!node) return [];

    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = prefix + (isLast ? '    ' : '│   ');

    const lines = [`${prefix}${connector}${node.name} (${node.type})`];

    const edges = edgesByFrom.get(id) || [];
    const grouped = groupBy(edges, e => e.type);

    // ... render children grouped by relationship type

    return lines;
  }

  return renderNode(rootId, '', true, 0).join('\n');
}
```

## Gains Estimés

| Format | Taille | Lisibilité |
|--------|--------|------------|
| JSON actuel | 112K | ⭐ |
| JSON compact | ~15K | ⭐⭐ |
| Markdown | ~8K | ⭐⭐⭐⭐⭐ |

## Questions Ouvertes

1. Faut-il inclure le `source` dans le markdown ou juste la signature?
2. Limite de profondeur pour l'arbre ASCII? (2-3 niveaux?)
3. Faut-il supporter un format "diff-friendly" pour comparaisons?
