# HTML Parser Design - Hybrid Approach

**Last Updated**: 2025-12-05
**Status**: Design Phase
**Author**: Lucie Defraiteur

---

## Problem Statement

HTML is structurally different from TypeScript/Python:

| Aspect | TypeScript/Python | HTML |
|--------|-------------------|------|
| Structure | Scopes (functions, classes) | DOM elements |
| Typical count | 10-100 scopes per file | 100-1000+ elements per file |
| Semantic value | High (each scope = logic unit) | Low (many `<div>` = layout) |
| Relationships | Imports, calls, extends | Parent/child, references |

**Risk of naive approach**: Treating every `<div>`, `<span>`, `<p>` as a scope would:
- Explode Neo4j node count
- Create noise in semantic search
- Provide little value

---

## Proposed Solution: Hybrid Approach

### Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     LAYER 1: BDD (Neo4j)                    │
│                     Persisted, Searchable                   │
├─────────────────────────────────────────────────────────────┤
│  WebDocument (HTML, Vue, Svelte, Astro)                     │
│  ├── file: "login.vue"                                      │
│  ├── type: "vue-sfc" | "html"                               │
│  ├── hash: "abc123..."                                      │
│  └── metadata: { template: true, script: true, style: true }│
│                                                             │
│  Scope (extracted from <script>)                            │
│  ├── name: "handleLogin"                                    │
│  ├── type: "function"                                       │
│  ├── signature: "async function handleLogin()"              │
│  └── embedding: [0.1, 0.2, ...]                             │
│                                                             │
│  Relationships:                                             │
│  WebDocument ──SCRIPT_OF──> Scope (scripts in document)     │
│  WebDocument ──HAS_IMAGE──> Image (images in document)      │
│  Scope ──USES_COMPONENT──> WebDocument (Vue components)     │
│                                                             │
│  Note: Document reserved for Tika (PDF, Word, etc.)         │
│        MarkupDocument reserved for Markdown                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  LAYER 2: Memory (On-Demand)                │
│                  Parsed by tree-sitter at runtime           │
├─────────────────────────────────────────────────────────────┤
│  DOM Tree (not persisted)                                   │
│  ├── <template>                                             │
│  │   ├── <div class="login-form">                           │
│  │   │   ├── <input v-model="email">                        │
│  │   │   ├── <input v-model="password">                     │
│  │   │   └── <button @click="handleLogin">                  │
│  │   └── ...                                                │
│  └── Parsed on-demand (~5ms with tree-sitter)               │
└─────────────────────────────────────────────────────────────┘
```

### What Gets Persisted (Layer 1)

1. **WebDocument node**: Represents the HTML/Vue file
   - File path, hash, type
   - Metadata (has template, script, style)
   - Component name, imports, used components

2. **Scope nodes**: Code extracted from `<script>` tags
   - Functions, classes, components
   - Full TypeScript parsing
   - Embeddings for semantic search

3. **Image nodes**: Images referenced in document
   - Source path, alt text, line number
   - OCR text (extracted separately in ragforge-runtime)

4. **Relationships**:
   - `WebDocument BELONGS_TO Project`
   - `Scope SCRIPT_OF WebDocument` - Scripts defined in file
   - `WebDocument HAS_IMAGE Image` - Images in document
   - `Scope USES_COMPONENT WebDocument` - Component usage

### What Stays in Memory (Layer 2)

1. **Full DOM tree**: Parsed on-demand
   - All HTML elements
   - Attributes, classes, IDs
   - Event bindings

2. **Template analysis**: Computed at query time
   - Component usage patterns
   - Directive bindings
   - Slot content

---

## Advantages

### 1. Light Database

- No thousands of `<div>` nodes
- Only meaningful code in Neo4j
- Fast queries on Scope entities

### 2. Fast On-Demand Parsing

- tree-sitter parses HTML in ~5ms
- No sync needed for DOM structure
- Always fresh from disk

### 3. Semantic Search Where It Matters

- Embeddings on actual code (functions, logic)
- Not on layout markup
- Meaningful search results

### 4. Full Access When Needed

```typescript
// Query persisted data
const scopes = await rag.query_entities({
  entity_type: 'Scope',
  conditions: [{ field: 'file', operator: 'CONTAINS', value: 'login.vue' }]
});

// Parse DOM on-demand
const dom = await htmlParser.parseFile('login.vue');
const buttons = dom.findElements('button');
```

---

## Implementation Plan

### Phase 1: WebDocument Entity ✅

Create new entity type `WebDocument` (Document reserved for Tika):

```typescript
interface DocumentInfo {
  uuid: string;
  file: string;
  type: 'html' | 'vue-sfc' | 'svelte' | 'astro';
  hash: string;

  // Metadata
  hasTemplate: boolean;
  hasScript: boolean;
  hasStyle: boolean;

  // Extracted info
  componentName?: string;  // For Vue SFC
  scriptLang?: string;     // 'ts' | 'js'
  isScriptSetup?: boolean; // Vue 3 script setup
  imports: string[];
  usedComponents: string[];
  images: ImageReference[];
}

interface ImageReference {
  src: string;
  alt?: string;
  line: number;
}
```

### Phase 2: HTML/Vue Parser ✅

Create `HTMLDocumentParser` (in codeparsers):

```typescript
class HTMLDocumentParser {
  // Parse and extract Document + Scopes
  async parseFile(filePath: string, content: string, options?: {
    parseScripts?: boolean;
  }): Promise<HTMLParseResult>;

  // On-demand DOM parsing (not persisted)
  async parseTemplate(content: string): Promise<DOMTree>;
}

interface HTMLParseResult {
  document: DocumentInfo;
  scopes: ScopeInfo[];      // From <script>
  relationships: DocumentRelationship[];
  domTree: DOMNode;         // In-memory DOM tree
}
```

### Phase 3: Vue SFC Support

Special handling for `.vue` files:

```vue
<template>
  <!-- Parsed on-demand, not stored -->
  <LoginForm @submit="handleLogin" />
</template>

<script setup lang="ts">
// Extracted as Scope nodes
import { ref } from 'vue';
import LoginForm from './LoginForm.vue';

const email = ref('');
const password = ref('');

async function handleLogin() {
  // ...
}
</script>

<style scoped>
/* Ignored or basic extraction */
</style>
```

Extracted:
- `WebDocument(login.vue, type='vue-sfc')`
- `Scope(handleLogin, type='function')`
- `Scope(email, type='variable')`
- `Scope(password, type='variable')`
- `Scope SCRIPT_OF WebDocument` (scripts in document)

---

## Query Patterns

### Find Components Using a Specific Prop

```typescript
// 1. Find component scopes
const components = await rag.query_entities({
  entity_type: 'Scope',
  conditions: [{ field: 'type', operator: '=', value: 'component' }]
});

// 2. Parse DOM on-demand to find usage
for (const comp of components) {
  const dom = await htmlParser.parseDOMTree(await fs.readFile(comp.file));
  const usages = dom.findElements(comp.name);
  // Check props...
}
```

### Find All Event Handlers in a Vue File

```typescript
// 1. Get document
const doc = await rag.get_entity_by_id({ uuid: 'doc-123' });

// 2. Parse DOM
const dom = await htmlParser.parseDOMTree(await fs.readFile(doc.file));
const handlers = dom.findElementsWithAttribute('@click');

// 3. Match to scopes
const handlerNames = handlers.map(h => h.getAttribute('@click'));
const scopes = await rag.query_entities({
  entity_type: 'Scope',
  conditions: [{ field: 'name', operator: 'IN', value: handlerNames }]
});
```

---

## File Structure

```
packages/codeparsers/src/
├── html/                              # NEW
│   ├── HTMLDocumentParser.ts          # Main parser
│   ├── VueSFCParser.ts                # Vue-specific handling
│   ├── DOMTree.ts                     # In-memory DOM representation
│   └── types.ts                       # Document, DOMNode types
│
├── wasm/
│   ├── WasmLoader.ts                  # Already updated with 'html'
│   └── types.ts                       # SupportedLanguage includes 'html'
│
└── scope-extraction/
    └── ScopeExtractionParser.ts       # Used for <script> content
```

---

## Technical Notes

### tree-sitter-html

Already installed:
```bash
npm ls tree-sitter-html
# tree-sitter-html@0.23.2
```

WasmLoader already updated:
```typescript
} else if (language === 'html') {
  wasmPath = require.resolve('tree-sitter-html/tree-sitter-html.wasm');
}
```

### Vue SFC Parsing Strategy

1. Parse as HTML with tree-sitter-html
2. Find `<script>` elements
3. Extract content
4. Parse with TypeScript parser
5. Return combined result

### Performance Considerations

- tree-sitter HTML parse: ~5ms for typical file
- TypeScript parse of script: ~10ms
- Total: ~15ms per Vue file
- Acceptable for on-demand parsing

---

## Image OCR Strategy

HTML documents often contain images (`<img>`) that may have textual content (screenshots, diagrams, scanned documents). We need OCR capabilities to extract this text.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Image in HTML                           │
│                     <img src="diagram.png">                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   OCR Provider                              │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │  Gemini Vision  │  │  DeepSeek-OCR (via Replicate)   │   │
│  │  (Primary)      │  │  (Alternative)                  │   │
│  │  - Semantic     │  │  - 97% accuracy                 │   │
│  │  - Context-aware│  │  - Layout understanding         │   │
│  │  - Already used │  │  - MIT license                  │   │
│  └─────────────────┘  └─────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Extracted Text                            │
│  - Stored in Document.imageTexts[]                          │
│  - Indexed for semantic search                              │
│  - Linked to source image path                              │
└─────────────────────────────────────────────────────────────┘
```

### OCR Options

| Provider | Type | Use Case | Notes |
|----------|------|----------|-------|
| **Gemini Vision** | API | Primary option | Already integrated, semantic understanding, context-aware |
| **DeepSeek-OCR** | Replicate API | Alternative | 97% accuracy, layout understanding, clé Replicate disponible |
| **Tesseract** | Local | Fallback | Gratuit, léger, mais basique |

### Implementation

```typescript
interface ImageOCRResult {
  imagePath: string;           // Original image path
  extractedText: string;       // OCR result
  confidence?: number;         // OCR confidence (0-1)
  provider: 'gemini' | 'deepseek' | 'tesseract';
}

interface DocumentWithImages extends Document {
  // ... existing fields

  // OCR results for images in the document
  imageTexts?: ImageOCRResult[];
}
```

### Gemini Vision Integration

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

async function extractTextFromImage(imagePath: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const imageData = await fs.readFile(imagePath);
  const base64 = imageData.toString('base64');

  const result = await model.generateContent([
    'Extract all text from this image. Return only the text, no explanations.',
    { inlineData: { mimeType: 'image/png', data: base64 } }
  ]);

  return result.response.text();
}
```

### DeepSeek-OCR via Replicate

```typescript
import Replicate from 'replicate';

async function extractTextWithDeepSeek(imagePath: string): Promise<string> {
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });

  const imageData = await fs.readFile(imagePath);
  const base64 = imageData.toString('base64');

  const output = await replicate.run(
    'deepseek-ai/deepseek-ocr:latest',
    { input: { image: `data:image/png;base64,${base64}` } }
  );

  return output as string;
}
```

### When to OCR

1. **During ingestion**: Extract text from all `<img>` with `src` pointing to local files
2. **On-demand**: For external images or lazy loading
3. **Skip**: Images with `alt` text that seems sufficient

### Storage

```cypher
// WebDocument with linked Image nodes
CREATE (d:WebDocument {
  file: 'page.html',
  type: 'html',
  imageCount: 2
})
CREATE (i1:Image {src: 'logo.png', alt: 'Logo', line: 15, ocrText: 'Company Name'})
CREATE (i2:Image {src: 'diagram.png', alt: 'Workflow', line: 42, ocrText: 'Step 1: ...'})
CREATE (d)-[:HAS_IMAGE]->(i1)
CREATE (d)-[:HAS_IMAGE]->(i2)
```

---

## Open Questions

1. **Svelte/Astro support?**
   - Similar SFC structure
   - Would need tree-sitter-svelte, etc.
   - Phase 2 consideration

2. **CSS extraction?**
   - Currently ignored
   - Could extract class names for cross-referencing
   - Low priority

3. **Template expressions?**
   - Vue: `{{ expression }}`
   - Should we extract referenced variables?
   - Could link to scopes

---

## Related Documents

- [CODEPARSERS.md](./CODEPARSERS.md) - Parser package overview
- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - Full project context
- [CURRENT-STATE-2025-12-05.md](../visions/tool-generation/CURRENT-STATE-2025-12-05.md) - Technical state
