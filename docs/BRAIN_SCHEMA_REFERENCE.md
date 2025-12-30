# Brain Schema Reference

Documentation du schéma Neo4j pour RagForge Brain.

## Types de Nœuds

### Code (Scope)

Représente les éléments de code: fonctions, classes, méthodes, interfaces, variables, etc.

| Champ | Required | Description |
|-------|----------|-------------|
| `name` | ✓ | Nom de l'élément |
| `type` | ✓ | Type: `function`, `class`, `method`, `interface`, `variable`, `enum`, `type_alias`, `namespace`, `module` |
| `file` | ✓ | Chemin relatif du fichier |
| `language` | ✓ | Langage (auto-détecté) |
| `startLine` | ✓ | Ligne de début |
| `endLine` | ✓ | Ligne de fin |
| `linesOfCode` | ✓ | Nombre de lignes |
| `source` | ✓ | Code source complet |
| `signature` | ✓ | Signature (ex: `async function foo(x: number): Promise<void>`) |
| `docstring` | | Documentation/commentaire JSDoc |
| `returnType` | | Type de retour |
| `parameters` | | Paramètres (JSON) |
| `parent` | | Nom du parent |
| `parentUUID` | | UUID du parent |
| `extends` | | Classes étendues |
| `implements` | | Interfaces implémentées |
| `decorators` | | Décorateurs |

### CodeBlock

Blocs de code dans les documents Markdown.

| Champ | Required | Description |
|-------|----------|-------------|
| `file` | ✓ | Fichier Markdown source |
| `language` | ✓ | Langage du bloc |
| `code` | ✓ | Contenu du code |
| `rawText` | ✓ | Texte brut |
| `startLine` | ✓ | Ligne de début |
| `endLine` | ✓ | Ligne de fin |

### MarkdownDocument

Document Markdown complet.

| Champ | Required | Description |
|-------|----------|-------------|
| `file` | ✓ | Chemin du fichier |
| `type` | ✓ | Type (toujours `markdown`) |
| `title` | ✓ | Titre du document |
| `sectionCount` | ✓ | Nombre de sections |
| `codeBlockCount` | ✓ | Nombre de blocs de code |
| `linkCount` | ✓ | Nombre de liens |
| `imageCount` | ✓ | Nombre d'images |
| `wordCount` | ✓ | Nombre de mots |
| `frontMatter` | | YAML front matter (JSON) |

### MarkdownSection

Section (heading) dans un document Markdown.

| Champ | Required | Description |
|-------|----------|-------------|
| `title` | ✓ | Titre de la section |
| `level` | ✓ | Niveau (1-6) |
| `content` | ✓ | Contenu complet (avec enfants) |
| `file` | ✓ | Fichier source |
| `startLine` | ✓ | Ligne de début |
| `endLine` | ✓ | Ligne de fin |
| `slug` | ✓ | Slug pour ancre |
| `ownContent` | | Contenu propre (sans enfants) |
| `rawText` | | Texte brut pour recherche |
| `parentTitle` | | Titre de la section parente |

### WebPage

Page web crawlée.

| Champ | Required | Description |
|-------|----------|-------------|
| `url` | ✓ | URL de la page |
| `title` | ✓ | Titre de la page |
| `textContent` | ✓ | Contenu texte extrait |
| `headingCount` | ✓ | Nombre de headings |
| `linkCount` | ✓ | Nombre de liens |
| `depth` | ✓ | Profondeur de crawl |
| `crawledAt` | ✓ | Date de crawl |
| `description` | | Meta description |
| `headingsJson` | | Structure des headings (JSON) |

### MediaFile / ImageFile

Fichiers média (images, etc.).

| Champ | Required | Description |
|-------|----------|-------------|
| `file` | ✓ | Nom du fichier |
| `path` | ✓ | Chemin complet |
| `format` | ✓ | Format (png, jpg, etc.) |
| `category` | ✓ | Catégorie (`image`, `video`, etc.) |
| `sizeBytes` | ✓ | Taille en bytes |
| `width` | | Largeur (pixels) |
| `height` | | Hauteur (pixels) |
| `analyzed` | | Si analysé par IA |
| `description` | | Description visuelle (IA) |
| `ocrText` | | Texte extrait (OCR) |

### ThreeDFile

Fichiers 3D (GLTF, GLB).

| Champ | Required | Description |
|-------|----------|-------------|
| `file` | ✓ | Nom du fichier |
| `path` | ✓ | Chemin complet |
| `format` | ✓ | Format (gltf, glb) |
| `category` | ✓ | Catégorie (`3d`) |
| `sizeBytes` | ✓ | Taille en bytes |
| `meshCount` | | Nombre de meshes |
| `materialCount` | | Nombre de matériaux |
| `textureCount` | | Nombre de textures |
| `animationCount` | | Nombre d'animations |
| `description` | | Description (IA) |
| `renderedViews` | | Chemins des rendus |

### DocumentFile / PDFDocument / WordDocument

Documents (PDF, Word, etc.).

| Champ | Required | Description |
|-------|----------|-------------|
| `file` | ✓ | Nom du fichier |
| `path` | ✓ | Chemin complet |
| `format` | ✓ | Format (pdf, docx) |
| `category` | ✓ | Catégorie (`document`) |
| `sizeBytes` | ✓ | Taille en bytes |
| `pageCount` | | Nombre de pages |
| `title` | | Titre du document |
| `author` | | Auteur |
| `extractedText` | | Texte extrait |

### DataFile

Fichiers de données (JSON, YAML, XML, etc.).

| Champ | Required | Description |
|-------|----------|-------------|
| `file` | ✓ | Nom du fichier |
| `type` | ✓ | Type (json, yaml, xml) |
| `format` | ✓ | Format |
| `keyCount` | | Nombre de clés |
| `structure` | | Structure (JSON) |
| `preview` | | Aperçu du contenu |

### Nœuds Structurels

| Type | Required | Description |
|------|----------|-------------|
| **File** | path, name, directory, extension | Fichier dans le système |
| **Directory** | path, depth | Répertoire |
| **Project** | name, rootPath | Projet racine |
| **ExternalLibrary** | name | Dépendance externe |
| **PackageJson** | file, name, version | package.json |

---

## Relations

### Hiérarchie de Code
```
(Scope)-[:DEFINED_IN]->(File)           # Scope défini dans un fichier
(Scope)-[:HAS_PARENT]->(Scope)          # Scope enfant (méthode dans classe)
(Scope)-[:INHERITS_FROM]->(Scope)       # Héritage de classe
(Scope)-[:IMPLEMENTS]->(Scope)          # Implémentation d'interface
(Scope)-[:CONSUMES]->(Scope)            # Utilise/appelle
(Scope)-[:USES_LIBRARY]->(ExternalLibrary) # Utilise une lib externe
```

### Hiérarchie de Fichiers
```
(File)-[:IN_DIRECTORY]->(Directory)     # Fichier dans répertoire
(File)-[:BELONGS_TO]->(Project)         # Fichier appartient au projet
(Directory)-[:IN_DIRECTORY]->(Directory) # Sous-répertoire
```

### Documents Markdown
```
(MarkdownDocument)-[:DEFINED_IN]->(File)
(MarkdownSection)-[:HAS_SECTION]->(MarkdownDocument)
(MarkdownSection)-[:CHILD_OF]->(MarkdownSection)
(CodeBlock)-[:IN_SECTION]->(MarkdownSection)
```

### Web
```
(WebPage)-[:LINKS_TO]->(WebPage)        # Lien entre pages
(WebPage)-[:HAS_PAGE]->(Website)        # Page appartient à un site
```

### Références Cross-Type
```
(*)-[:REFERENCES_ASSET]->(File)         # Référence un asset (image, font)
(*)-[:REFERENCES_DOC]->(File)           # Référence un document
(*)-[:REFERENCES_STYLE]->(File)         # Référence une stylesheet
(*)-[:REFERENCES_DATA]->(File)          # Référence un fichier de données
```

---

## Mapping Unifié des Champs

Pour normaliser l'accès aux champs textuels selon le type de nœud:

```typescript
/**
 * Mapping des champs textuels par type de nœud.
 * Permet d'accéder uniformément au contenu principal, description et titre.
 */
export const FIELD_MAPPING: Record<string, {
  content: string;      // Contenu principal (texte/code)
  description: string;  // Description/documentation
  title: string;        // Titre/signature/nom
  location?: string;    // Champ de localisation (file, url, path)
}> = {
  // === CODE ===
  Scope: {
    content: 'source',
    description: 'docstring',
    title: 'signature',
    location: 'file',
  },
  CodeBlock: {
    content: 'code',
    description: 'language',  // pas de description, on met le langage
    title: 'language',
    location: 'file',
  },

  // === MARKDOWN ===
  MarkdownDocument: {
    content: 'title',         // pas de contenu inline, juste le titre
    description: 'frontMatter',
    title: 'title',
    location: 'file',
  },
  MarkdownSection: {
    content: 'ownContent',    // préférer ownContent à content (sans enfants)
    description: 'rawText',
    title: 'title',
    location: 'file',
  },

  // === WEB ===
  WebPage: {
    content: 'textContent',
    description: 'description',
    title: 'title',
    location: 'url',
  },

  // === MEDIA ===
  MediaFile: {
    content: 'ocrText',       // texte OCR si disponible
    description: 'description',
    title: 'file',
    location: 'path',
  },
  ImageFile: {
    content: 'ocrText',
    description: 'description',
    title: 'file',
    location: 'path',
  },
  ThreeDFile: {
    content: 'description',   // pas de texte, juste la description
    description: 'description',
    title: 'file',
    location: 'path',
  },

  // === DOCUMENTS ===
  DocumentFile: {
    content: 'extractedText',
    description: 'title',
    title: 'title',
    location: 'path',
  },
  PDFDocument: {
    content: 'extractedText',
    description: 'title',
    title: 'title',
    location: 'path',
  },
  WordDocument: {
    content: 'extractedText',
    description: 'title',
    title: 'title',
    location: 'path',
  },
  SpreadsheetDocument: {
    content: 'extractedText',
    description: 'sheetNames',
    title: 'file',
    location: 'path',
  },

  // === DATA ===
  DataFile: {
    content: 'preview',
    description: 'structure',
    title: 'file',
    location: 'file',
  },

  // === STRUCTURE ===
  File: {
    content: 'source',        // si disponible (fichiers code)
    description: 'name',
    title: 'name',
    location: 'path',
  },
  Project: {
    content: 'name',
    description: 'gitRemote',
    title: 'name',
    location: 'rootPath',
  },
  ExternalLibrary: {
    content: 'name',
    description: 'name',
    title: 'name',
    location: 'name',
  },
};

/**
 * Récupère le contenu principal d'un nœud selon son type.
 */
export function getNodeContent(node: Record<string, any>, nodeType: string): string | undefined {
  const mapping = FIELD_MAPPING[nodeType];
  if (!mapping) return node.source || node.content || node.textContent;
  return node[mapping.content];
}

/**
 * Récupère la description d'un nœud selon son type.
 */
export function getNodeDescription(node: Record<string, any>, nodeType: string): string | undefined {
  const mapping = FIELD_MAPPING[nodeType];
  if (!mapping) return node.docstring || node.description;
  return node[mapping.description];
}

/**
 * Récupère le titre/signature d'un nœud selon son type.
 */
export function getNodeTitle(node: Record<string, any>, nodeType: string): string | undefined {
  const mapping = FIELD_MAPPING[nodeType];
  if (!mapping) return node.signature || node.title || node.name;
  return node[mapping.title] || node.name;
}

/**
 * Récupère la localisation (fichier/url/path) d'un nœud.
 */
export function getNodeLocation(node: Record<string, any>, nodeType: string): string | undefined {
  const mapping = FIELD_MAPPING[nodeType];
  if (!mapping) return node.file || node.path || node.url;
  return node[mapping.location];
}
```

---

## Exemples d'Utilisation

### Affichage unifié d'un résultat de recherche

```typescript
function formatSearchResult(node: any, nodeType: string): string {
  const title = getNodeTitle(node, nodeType) || node.name || 'Untitled';
  const location = getNodeLocation(node, nodeType);
  const lines = node.startLine && node.endLine
    ? `:${node.startLine}-${node.endLine}`
    : '';

  return `${title} (${nodeType}) @ ${location}${lines}`;
}

// Scope: "async function getUser(id: string): Promise<User> (Scope) @ src/users.ts:45-67"
// MarkdownSection: "Installation (MarkdownSection) @ README.md:12-45"
// WebPage: "Getting Started (WebPage) @ https://docs.example.com/start"
// ImageFile: "logo.png (ImageFile) @ assets/images/logo.png"
```

### Déterminer si un nœud a du contenu textuel

```typescript
function hasTextContent(node: any, nodeType: string): boolean {
  const content = getNodeContent(node, nodeType);
  return !!content && content.length > 0;
}
```

---

## Notes Importantes

1. **`source` vs `content`**: Pour les Scope, c'est `source`. Pour MarkdownSection, c'est `content` ou `ownContent`.

2. **Champs optionnels**: `docstring`, `description`, `ocrText` ne sont pas toujours présents.

3. **Types de Scope**: Le champ `type` des Scope indique le sous-type:
   - `function`, `method`, `class`, `interface`, `enum`, `variable`, `constant`, `type_alias`, `namespace`, `module`

4. **Embeddings**: Les nœuds ont jusqu'à 3 embeddings:
   - `embedding_name`: pour rechercher par nom/signature
   - `embedding_content`: pour rechercher par contenu
   - `embedding_description`: pour rechercher par documentation

---

## Source Unique de Vérité

Le mapping des champs est défini dans `packages/core/src/utils/node-schema.ts`:
- `FIELD_MAPPING`: Mapping pour l'affichage (brain_search output)
- `getEmbeddingExtractors()`: Extracteurs pour la génération d'embeddings

`embedding-service.ts` utilise `getRecordEmbeddingExtractors()` qui appelle `FIELD_MAPPING` en interne.
Cela garantit une cohérence entre l'affichage et l'embedding.

### Différences Display vs Embedding

| Type | Display (title) | Embedding (name) |
|------|-----------------|------------------|
| File | `name \|\| path` | `path` (full path for search) |
| MediaFile | `file` | `path` (full path for search) |
| WebPage | `title` | `${title} ${url}` (includes URL) |

Pour ces types, l'embedding utilise plus de contexte que l'affichage pour améliorer la recherche.
