# Refactoring du Parsing de Documents (PDF, DOCX, etc.)

**Date:** 10 janvier 2026
**Statut:** Planification

## Problème actuel

### Situation dans community-docs
1. Upload d'un PDF `paper.pdf`
2. Conversion en markdown via Vision API
3. Création d'un fichier virtuel `paper.pdf.md`
4. Parsing comme markdown → `MarkdownDocument`, `MarkdownSection`
5. **Pas de File node** avec le chemin original

### Situation dans ragforge core (DocumentParser)
1. Parse `paper.pdf` directement
2. Crée `PDFDocument` node avec `textContent` (texte brut)
3. Crée `File` node wrapper
4. **Pas de structure sections/headings**

### Problèmes identifiés
- Incohérence entre les deux approches
- Pas de File node pour les documents convertis en markdown
- `sourceFormat` doit être extrait du frontmatter ou du path pattern
- Le contenu des PDFs n'est pas structuré en sections

## Architecture proposée

### Objectif
Tous les documents binaires (PDF, DOCX, etc.) sont:
1. Parsés avec leur extension originale (`paper.pdf`)
2. Convertis en structure markdown (sections, headings)
3. Stockés avec un `File` node ayant le chemin original

### Nodes créés pour un PDF

```
File (path: "paper.pdf", extension: ".pdf")
  └── MarkdownDocument (dérivé du PDF)
        ├── MarkdownSection (Abstract)
        ├── MarkdownSection (I. Introduction)
        │     └── MarkdownSection (A. Background)
        │     └── MarkdownSection (B. Related Work)
        ├── MarkdownSection (II. Methods)
        └── ...
```

### Relations
- `MarkdownDocument -[:DERIVED_FROM]-> File`
- `MarkdownSection -[:IN_DOCUMENT]-> MarkdownDocument`
- `MarkdownSection -[:CHILD_OF]-> MarkdownSection` (hiérarchie)

## Changements dans ragforge core

### 1. DocumentParser refactoré

```typescript
// Options du parser
interface DocumentParseOptions {
  // Mode Vision pour analyser les images dans le document
  enableVision?: boolean;
  visionProvider?: 'gemini' | 'claude';

  // Détection des titres de sections
  sectionTitles?: 'none' | 'detect' | 'llm';

  // Nombre max de pages (pour les gros documents)
  maxPages?: number;
}
```

### 2. Flux de parsing

```
paper.pdf (binaire)
    ↓
DocumentParser.parse(filePath, options)
    ↓
┌─────────────────────────────────────────┐
│ 1. Extraction texte (pdfjs-dist)        │
│ 2. Détection paragraphes (Y-position)   │
│ 3. Classification titres (heuristique)  │
│ 4. [Option] Vision pour images          │
│ 5. Conversion en structure markdown     │
└─────────────────────────────────────────┘
    ↓
Nodes: File + MarkdownDocument + MarkdownSections
```

### 3. Option Vision (désactivée par défaut)

Dans **core**: `enableVision: false` par défaut
```typescript
const result = await documentParser.parse(filePath, {
  enableVision: false, // défaut
});
```

Dans **community-docs**: activée
```typescript
const result = await documentParser.parse(filePath, {
  enableVision: true,
  visionProvider: 'claude',
  sectionTitles: 'detect',
});
```

### 4. Support des fichiers virtuels (binaires)

Pour permettre de passer un contenu binaire directement:

```typescript
interface ParseInput {
  filePath: string;
  projectId: string;

  // NOUVEAU: contenu binaire optionnel
  content?: Buffer;
}
```

Si `content` est fourni, le parser l'utilise au lieu de lire le fichier.

## Changements dans community-docs

### 1. Upload simplifié

```typescript
// Avant
const mdContent = await convertPdfToMarkdown(pdfBuffer);
virtualFiles.push({ path: 'paper.pdf.md', content: mdContent });

// Après
virtualFiles.push({
  path: 'paper.pdf',
  content: pdfBuffer,  // binaire directement
  parseOptions: { enableVision: true }
});
```

### 2. Pas besoin de pattern `.pdf.md`

Le File node aura directement `path: "paper.pdf"` et `extension: ".pdf"`.

## Propriétés sur les nodes

### File node
```typescript
{
  uuid: "file:paper.pdf",
  path: "paper.pdf",
  name: "paper",
  extension: ".pdf",
  sizeBytes: 4669744,
  // ... autres métadonnées
}
```

### MarkdownDocument node
```typescript
{
  uuid: "doc:paper.pdf",
  file: "paper.pdf",
  title: "Foundation Models for SoM",
  sourceFormat: "pdf",        // extrait automatiquement
  parsedWith: "vision",       // ou "text-only"
  pageCount: 21,
  sectionCount: 15,
  // frontMatter si présent
}
```

### MarkdownSection node
```typescript
{
  uuid: "section:paper.pdf:intro",
  file: "paper.pdf",
  title: "I. Introduction",
  titleLevel: 1,              // ## = level 1
  content: "...",
  startLine: 42,
  endLine: 87,
  pageNum: 1,                 // pour les PDFs
}
```

## Recherche et filtrage

### Par format source
```cypher
MATCH (f:File)-[:HAS_DOCUMENT]->(d:MarkdownDocument)
WHERE f.extension = '.pdf'
RETURN d
```

### Par type de parsing
```cypher
MATCH (d:MarkdownDocument)
WHERE d.parsedWith = 'vision'
RETURN d
```

## TODO

- [x] Refactorer DocumentParser pour créer File + MarkdownDocument/Section
- [x] Ajouter option `enableVision` dans DocumentParseOptions
- [x] Ajouter support `binaryContent: Buffer` dans ParseInput
- [x] Mettre à jour les relations (DERIVED_FROM, etc.)
- [x] Adapter community-docs pour utiliser le nouveau flux (`ingestBinaryDocument`)
- [ ] Tests avec PDF et DOCX
- [ ] Documentation API

## Implémentation (10 janvier 2026)

### Core (`packages/core`)
- `src/ingestion/parser-types.ts`: Ajouté `binaryContent?: Buffer` dans `ParseInput`, et `DocumentParseOptions`
- `src/ingestion/parsers/document-parser.ts`: Refactoré pour créer File + MarkdownDocument + MarkdownSection
- `src/index.ts`: Exporté `DocumentParseOptions` et `documentParser`

### Community-docs (`packages/community-docs`)
- `lib/ragforge/orchestrator-adapter.ts`: Ajouté `ingestBinaryDocument()` qui utilise le nouveau `documentParser`
- `lib/ragforge/api/server.ts`: Modifié `/ingest/file` pour détecter les fichiers binaires et utiliser `ingestBinaryDocument`
- `lib/ragforge/api-client.ts`: Ajouté `enableVision` et `sectionTitles` options à `ingestFile`
- `app/api/ingest/upload/route.ts`: Modifié pour utiliser `ingestFile` pour PDF/DOCX au lieu de placeholder

## Questions ouvertes

1. **DOCX avec images**: Comment gérer la position des images dans le flux?
   - Mammoth ne donne pas la position exacte des images
   - Option: analyser le HTML généré par mammoth

2. **Gros documents**: Limiter les pages analysées avec Vision (coût API)

3. **Cache**: Garder le résultat du parsing Vision pour éviter de refaire l'appel API?
