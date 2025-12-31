# Plan: Réécriture du Système d'Ingestion

**Date**: 30 décembre 2025
**Statut**: À faire

## Contexte

Le fichier `incremental-ingestion.ts` (~2350 lignes) est devenu trop complexe:
- Mélange parsing, ingestion, hash checking, state machine, references
- Logique de capture/restore embeddings inutile
- Modes d'ingestion confus (`true`, `'both'`, `'files'`, `'content'`, `false`)
- Pattern "delete + recreate + restore" fragile
- Définitions éparpillées (`FIELD_MAPPING`, `MULTI_EMBED_CONFIGS`) faciles à oublier

## Objectifs

1. **Séparation des responsabilités** - Un fichier = une responsabilité
2. **Update in place** - MERGE au lieu de delete/recreate
3. **State machine** - `_state` au lieu de `embeddingsDirty`
4. **Interface parser unifiée** - Force les conventions pour tous les types de fichiers
5. **Simplicité** - Moins de code, moins de bugs

---

## Architecture: Interface Parser Unifiée

### Problème actuel

Les définitions sont éparpillées et faciles à oublier:
- `UniversalSourceAdapter` → route vers les parsers
- `FIELD_MAPPING` (node-schema.ts) → extraction de contenu
- `MULTI_EMBED_CONFIGS` (embedding-service.ts) → queries d'embedding
- `text-chunker.ts` → chunking du texte

Si on ajoute un nouveau parser, on doit penser à modifier 3-4 fichiers différents.

### Solution: Interface `ContentParser`

Chaque parser **DOIT** implémenter cette interface, qui inclut la définition
de comment extraire le contenu embeddable:

```typescript
// packages/core/src/ingestion/parser-types.ts

/**
 * Interface que tous les parsers doivent implémenter.
 * Force la définition des champs pour l'embedding.
 */
interface ContentParser {
  /** Nom unique du parser */
  readonly name: string;

  /** Extensions supportées (ex: ['.md', '.mdx']) */
  readonly supportedExtensions: string[];

  /** Définition des types de nodes créés par ce parser */
  readonly nodeTypes: NodeTypeDefinition[];

  /** Parse un fichier et retourne les nodes */
  parse(input: ParseInput): Promise<ParseOutput>;
}

/**
 * Définition d'un type de node avec ses champs d'extraction.
 * OBLIGATOIRE pour chaque type de node créé par le parser.
 */
interface NodeTypeDefinition {
  /** Label Neo4j (ex: 'Scope', 'MarkdownSection') */
  label: string;

  /**
   * Extraction des champs pour embedding.
   * Ces fonctions sont utilisées par EmbeddingService.
   */
  fields: {
    /** Nom/titre/signature - pour embedding_name */
    name: (node: any) => string;
    /** Contenu principal - pour embedding_content */
    content: (node: any) => string | null;
    /** Description/docstring - pour embedding_description */
    description?: (node: any) => string | null;
    /** Localisation (fichier, URL) */
    location: (node: any) => string;
  };

  /** Propriétés requises sur ce type de node */
  requiredProps: string[];

  /** Propriété utilisée pour le hash de contenu */
  contentHashField: string;

  /** Configuration de chunking (optionnel) */
  chunking?: {
    enabled: boolean;
    maxSize: number;
    strategy: 'paragraph' | 'sentence' | 'code';
  };
}
```

### Exemple: MarkdownParser

```typescript
class MarkdownParser implements ContentParser {
  readonly name = 'markdown';
  readonly supportedExtensions = ['.md', '.mdx'];

  readonly nodeTypes: NodeTypeDefinition[] = [
    {
      label: 'MarkdownDocument',
      fields: {
        name: (n) => n.title || n.file,
        content: () => null,  // Pas de contenu propre au document
        description: (n) => n.frontMatter ? JSON.stringify(n.frontMatter) : null,
        location: (n) => n.file,
      },
      requiredProps: ['uuid', 'file'],
      contentHashField: 'rawContent',
    },
    {
      label: 'MarkdownSection',
      fields: {
        name: (n) => n.title || `Section level ${n.level}`,
        content: (n) => n.ownContent || n.content,
        description: () => null,
        location: (n) => n.file,
      },
      requiredProps: ['uuid', 'title', 'level', 'content'],
      contentHashField: 'content',
      chunking: { enabled: true, maxSize: 4000, strategy: 'paragraph' },
    },
  ];

  async parse(input: ParseInput): Promise<ParseOutput> {
    // Implémentation...
  }
}
```

### Auto-génération depuis les définitions

Le système génère automatiquement:

```typescript
// ParserRegistry collecte tous les parsers
class ParserRegistry {
  private parsers: Map<string, ContentParser> = new Map();

  register(parser: ContentParser) {
    this.parsers.set(parser.name, parser);
  }

  // Génère FIELD_MAPPING depuis tous les nodeTypes
  getFieldMapping(): Record<string, NodeFieldMapping> {
    const mapping: Record<string, NodeFieldMapping> = {};
    for (const parser of this.parsers.values()) {
      for (const nodeDef of parser.nodeTypes) {
        mapping[nodeDef.label] = {
          title: nodeDef.fields.name,
          content: nodeDef.fields.content,
          description: nodeDef.fields.description || (() => null),
          location: nodeDef.fields.location,
        };
      }
    }
    return mapping;
  }

  // Génère les configs d'embedding depuis tous les nodeTypes
  getEmbedConfigs(): EmbedConfig[] {
    // ...
  }

  // Trouve le parser pour une extension
  getParserForFile(filePath: string): ContentParser | null {
    const ext = path.extname(filePath).toLowerCase();
    for (const parser of this.parsers.values()) {
      if (parser.supportedExtensions.includes(ext)) {
        return parser;
      }
    }
    return null;
  }
}
```

### Avantages

| Avant | Après |
|-------|-------|
| 3-4 fichiers à modifier pour un nouveau type | 1 seul fichier (le parser) |
| Facile d'oublier `FIELD_MAPPING` | TypeScript force la définition |
| Documentation séparée | La définition EST la documentation |
| Validation manuelle | Validation automatique des props |

---

## Nouvelle Architecture

### Structure des fichiers

```
packages/core/src/ingestion/
├── index.ts                    # Re-exports publics
├── types.ts                    # ✅ Types partagés (existe)
├── state-types.ts              # ✅ Types state machine (existe)
├── node-state-machine.ts       # ✅ Gestion états nodes (existe)
├── change-queue.ts             # ✅ Batching changements (existe)
├── orphan-watcher.ts           # ✅ Watch fichiers hors projet (existe)
│
├── parser-types.ts             # 🆕 Interface ContentParser + NodeTypeDefinition
├── parser-registry.ts          # 🆕 Registry des parsers, auto-génère configs
├── content-extractor.ts        # 🆕 Extraction + chunking unifié
│
├── orchestrator.ts             # 🔄 Point d'entrée principal (simplifier)
├── graph-merger.ts             # 🆕 MERGE nodes dans Neo4j
└── reference-linker.ts         # 🆕 Création relations CONSUMES

packages/core/src/parsers/      # 🆕 Nouveau dossier pour les parsers
├── index.ts                    # Re-exports + enregistrement auto
├── code-parser.ts              # 🔄 Refacto depuis CodeSourceAdapter
├── markdown-parser.ts          # 🔄 Refacto depuis MarkdownParser
├── document-parser.ts          # 🔄 Refacto depuis DocumentFileParser
├── media-parser.ts             # 🔄 Refacto depuis MediaFileParser
├── data-parser.ts              # 🔄 Refacto depuis DataFileParser
└── web-parser.ts               # 🔄 Pour WebPage
```

### Responsabilités

#### `orchestrator.ts` (simplifié)
Point d'entrée unique. Orchestre le flux sans logique métier.

```typescript
class IngestionOrchestrator {
  // Ingestion initiale d'un projet
  async ingestProject(projectPath: string, options?: IngestOptions): Promise<IngestStats>

  // Ré-ingestion de fichiers modifiés
  async reingestFiles(files: FileChange[], projectId: string): Promise<IngestStats>

  // Marquer un fichier comme modifié (pour le watcher)
  async markFileChanged(filePath: string, projectId: string): Promise<void>
}
```

#### `graph-merger.ts` (nouveau)
Fusionne un ParsedGraph dans Neo4j avec update in place.

```typescript
class GraphMerger {
  constructor(neo4j: Neo4jClient, stateMachine: NodeStateMachine)

  // Merge nodes et relationships
  // - MERGE par UUID (pas de delete)
  // - Compare _contentHash pour détecter changements
  // - Set _state = 'linked' si contenu changé
  // - Supprime nodes orphelins (dans DB mais pas dans graph)
  async merge(graph: ParsedGraph, projectId: string): Promise<MergeStats>
}

interface MergeStats {
  created: number;      // Nouveaux nodes
  updated: number;      // Nodes avec contenu changé
  unchanged: number;    // Nodes identiques
  deleted: number;      // Nodes orphelins supprimés
}
```

#### `content-hasher.ts` (nouveau)
Utilitaires pour le hashing et la comparaison.

```typescript
// Hash d'un fichier (SHA-256 du contenu brut)
function hashFile(filePath: string): Promise<string>

// Hash d'un contenu (pour nodes)
function hashContent(content: string): string

// Comparer avec les hashes existants en DB
async function getChangedFiles(
  files: string[],
  projectId: string,
  neo4j: Neo4jClient
): Promise<{ changed: string[]; unchanged: string[] }>
```

#### `reference-linker.ts` (nouveau)
Création des relations CONSUMES entre nodes.

```typescript
class ReferenceLinker {
  // Créer les relations CONSUMES pour un projet
  async linkReferences(projectId: string, options?: LinkOptions): Promise<LinkStats>

  // Créer les relations pour des fichiers spécifiques
  async linkFilesReferences(files: string[], projectId: string): Promise<LinkStats>
}
```

---

## Nouveau Flux d'Ingestion

### Ingestion initiale

```
1. orchestrator.ingestProject(path)
   │
   ├─► Parser tous les fichiers → ParsedGraph
   │   (UniversalSourceAdapter.parse())
   │
   ├─► graphMerger.merge(graph, projectId)
   │   - MERGE tous les nodes
   │   - Set _state = 'linked' (nouveaux nodes)
   │
   ├─► referenceLinker.linkReferences(projectId)
   │   - Créer relations CONSUMES
   │
   └─► Return stats
```

### Ré-ingestion (fichier modifié)

```
1. orchestrator.reingestFiles(changes, projectId)
   │
   ├─► Filtrer fichiers inchangés (via rawContentHash)
   │   - contentHasher.getChangedFiles()
   │
   ├─► Parser seulement les fichiers changés
   │   - UniversalSourceAdapter.parse(changedFiles)
   │
   ├─► graphMerger.merge(graph, projectId)
   │   - MERGE nodes (update in place)
   │   - Compare _contentHash:
   │     - Changé → _state = 'linked'
   │     - Inchangé → pas de modification
   │   - Supprime nodes orphelins du fichier
   │
   ├─► referenceLinker.linkFilesReferences(changedFiles)
   │   - Mettre à jour relations CONSUMES
   │
   └─► Return stats
```

### Traitement des embeddings (async)

```
// Séparé du flux d'ingestion
EmbeddingService.generateMultiEmbeddings()
  - Query: WHERE _state = 'linked'
  - Génère embeddings
  - Set _state = 'ready'
```

---

## GraphMerger - Détails

### Query MERGE avec state machine

```cypher
// Pour chaque type de node (Scope, MarkdownSection, etc.)
UNWIND $nodes AS nodeData
MERGE (n:Scope {uuid: nodeData.uuid})
SET n += nodeData.props,
    // Si le hash a changé, marquer pour re-embedding
    n._state = CASE
      WHEN n._contentHash IS NULL THEN 'linked'           // Nouveau node
      WHEN n._contentHash <> nodeData.props.hash THEN 'linked'  // Contenu changé
      ELSE COALESCE(n._state, 'linked')                   // Inchangé, garder état
    END,
    n._stateChangedAt = CASE
      WHEN n._contentHash IS NULL OR n._contentHash <> nodeData.props.hash
      THEN datetime()
      ELSE n._stateChangedAt
    END,
    n._contentHash = nodeData.props.hash
```

### Suppression des orphelins

```cypher
// Après MERGE, supprimer les nodes du fichier qui ne sont plus dans le parse
MATCH (n:Scope {projectId: $projectId, file: $filePath})
WHERE NOT n.uuid IN $parsedUuids
DETACH DELETE n
RETURN count(n) AS deleted
```

---

## Ce qui disparaît

### Fichiers à supprimer/archiver
- `runtime/adapters/incremental-ingestion.ts` (2350 lignes → remplacé)
- `brain/file-state-machine.ts` (fusionné avec node-state-machine)
- `ingestion/metadata-preserver.ts` (plus nécessaire)

### Concepts supprimés
- `embeddingsDirty` / `schemaDirty` → remplacé par `_state`
- Modes d'ingestion (`'both'`, `'files'`, `'content'`) → un seul mode
- Capture/restore embeddings → plus nécessaire (MERGE préserve)
- Delete + recreate → update in place

---

## Plan d'implémentation

### Phase 1: Interface Parser et Registry
- [ ] `parser-types.ts` - Interfaces ContentParser, NodeTypeDefinition, ParseInput/Output
- [ ] `parser-registry.ts` - Registry avec auto-génération FIELD_MAPPING
- [ ] `content-extractor.ts` - Extraction unifiée avec chunking (utilise text-chunker.ts)

### Phase 2: Refactoriser les parsers existants
- [ ] `parsers/code-parser.ts` - Depuis CodeSourceAdapter
- [ ] `parsers/markdown-parser.ts` - Depuis MarkdownParser
- [ ] `parsers/document-parser.ts` - Depuis DocumentFileParser
- [ ] `parsers/media-parser.ts` - Depuis MediaFileParser
- [ ] `parsers/data-parser.ts` - Depuis DataFileParser
- [ ] `parsers/index.ts` - Auto-registration de tous les parsers

### Phase 3: Nouveau système d'ingestion
- [ ] `graph-merger.ts` - MERGE nodes avec state machine
- [ ] `reference-linker.ts` - Création relations CONSUMES
- [ ] Réécrire `orchestrator.ts` pour utiliser les nouveaux composants

### Phase 4: Migration EmbeddingService
- [ ] Modifier EmbeddingService pour utiliser ParserRegistry.getEmbedConfigs()
- [ ] Supprimer MULTI_EMBED_CONFIGS hardcodé
- [ ] Supprimer FIELD_MAPPING hardcodé (remplacé par auto-génération)

### Phase 5: Intégration
- [ ] Mettre à jour `brain-manager.ts` pour utiliser le nouveau système
- [ ] Mettre à jour `file-watcher.ts`
- [ ] Mettre à jour `brain-tools.ts`

### Phase 6: Nettoyage
- [ ] Supprimer `incremental-ingestion.ts` (~2350 lignes)
- [ ] Supprimer `file-state-machine.ts`
- [ ] Supprimer `metadata-preserver.ts`
- [ ] Supprimer `UniversalSourceAdapter` (remplacé par ParserRegistry)
- [ ] Supprimer tous les `embeddingsDirty` / `schemaDirty` restants

### Phase 7: Tests
- [ ] Tests unitaires pour chaque parser
- [ ] Tests d'intégration: ingestion initiale
- [ ] Tests d'intégration: ré-ingestion fichier modifié
- [ ] Tests d'intégration: génération embeddings

---

## Questions ouvertes

1. **Garder `rawContentHash` sur File nodes?**
   - Pro: Permet skip rapide si fichier inchangé
   - Con: Ajoute complexité
   - Décision: Garder pour l'optimisation

2. **Où mettre les fonctions de parsing?**
   - Garder dans `UniversalSourceAdapter` (runtime/adapters/)
   - L'orchestrator appelle le parser

3. **Gestion des erreurs?**
   - Utiliser `_state = 'error'` avec `_errorType` et `_errorMessage`
   - Retry automatique via state machine

---

## System Props Unifiées

Toutes les propriétés système utilisent le préfixe `__name__` pour être clairement distinctes des props métier.

```typescript
interface SystemProps {
  // === IDENTITÉ (pas de préfixe - clés primaires) ===
  uuid: string;
  projectId: string;

  // === TIMESTAMPS ===
  __createdAt__: DateTime;          // Première création du node
  __updatedAt__: DateTime;          // Dernière modification du contenu
  __lastAccessedAt__?: DateTime;    // Dernier accès (null pour l'instant, prévu pour cleanup)

  // === STATE MACHINE ===
  __state__: 'pending' | 'parsing' | 'parsed' | 'linking' | 'linked' | 'embedding' | 'ready' | 'skip' | 'error';
  __stateChangedAt__: DateTime;
  __parsedAt__?: DateTime;
  __linkedAt__?: DateTime;
  __embeddedAt__?: DateTime;

  // === PROVENANCE ===
  __parserName__: string;           // 'code-parser', 'markdown-parser', etc.
  __schemaVersion__: number;        // Simple numéro incrémental (1, 2, 3...)
  __embeddingProvider__?: string;   // 'gemini', 'ollama'
  __embeddingModel__?: string;      // 'text-embedding-004'

  // === CONTENT VERSIONING ===
  __contentHash__: string;          // Hash actuel du contenu
  __previousContentHash__?: string; // Hash précédent (détection changements)
  __contentVersion__: number;       // Incrémenté à chaque changement (1, 2, 3...)

  // === SOURCE ===
  __sourceModifiedAt__?: DateTime;  // mtime du fichier source (pour détection rapide)

  // === ERREUR ===
  __errorType__?: 'parse' | 'link' | 'embed';
  __errorMessage__?: string;
  __errorAt__?: DateTime;
  __retryCount__?: number;          // Nombre de tentatives
}
```

### Règles de mise à jour

| Événement | Props mises à jour |
|-----------|-------------------|
| Création node | `__createdAt__`, `__state__='pending'`, `__stateChangedAt__`, `__contentHash__`, `__contentVersion__=1`, `__parserName__`, `__schemaVersion__` |
| Contenu modifié | `__updatedAt__`, `__previousContentHash__=ancien`, `__contentHash__=nouveau`, `__contentVersion__++`, `__state__='linked'`, `__stateChangedAt__` |
| Parsing terminé | `__parsedAt__`, `__state__='parsed'`, `__stateChangedAt__` |
| Linking terminé | `__linkedAt__`, `__state__='linked'`, `__stateChangedAt__` |
| Embedding terminé | `__embeddedAt__`, `__embeddingProvider__`, `__embeddingModel__`, `__state__='ready'`, `__stateChangedAt__` |
| Erreur | `__errorType__`, `__errorMessage__`, `__errorAt__`, `__retryCount__++`, `__state__='error'`, `__stateChangedAt__` |
| Accès (futur) | `__lastAccessedAt__` |

---

## Estimation

| Composant | Complexité | Lignes estimées |
|-----------|------------|-----------------|
| **Phase 1: Abstractions** | | |
| `parser-types.ts` | Faible | ~80 |
| `parser-registry.ts` | Moyenne | ~120 |
| `content-extractor.ts` | Faible | ~60 |
| **Phase 2: Parsers** | | |
| `parsers/code-parser.ts` | Haute | ~300 |
| `parsers/markdown-parser.ts` | Moyenne | ~150 |
| `parsers/document-parser.ts` | Moyenne | ~100 |
| `parsers/media-parser.ts` | Faible | ~80 |
| `parsers/data-parser.ts` | Faible | ~80 |
| **Phase 3: Ingestion** | | |
| `graph-merger.ts` | Moyenne | ~200 |
| `reference-linker.ts` | Moyenne | ~150 |
| `orchestrator.ts` (réécrit) | Moyenne | ~150 |
| **Total nouveau code** | | **~1470** |
| **Code supprimé** | | |
| `incremental-ingestion.ts` | | ~2350 |
| `UniversalSourceAdapter` | | ~400 |
| `FIELD_MAPPING` (node-schema) | | ~200 |
| `MULTI_EMBED_CONFIGS` (embedding-service) | | ~150 |
| Autres cleanups | | ~200 |
| **Total code supprimé** | | **~3300** |

**Gain net: ~1830 lignes de moins + architecture modulaire + conventions forcées**
