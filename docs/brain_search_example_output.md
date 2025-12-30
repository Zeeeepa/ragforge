# Brain Search: "FIELD_MAPPING unified field extraction for node types"

**Results:** 5 / 5
**Projects:** ragforge-packages-lveh, ragforge-LucieCode-spnt

---

## Results

### 1. const FIELD_MAPPING: Record<string, NodeFieldMapping> (variable) ★ 1.26
📍 `core/src/utils/node-schema.ts:589-722`
📝 Field mappings for each node type.
Logic mirrors MULTI_EMBED_CONFIGS textExtractors from embedding-service.ts
Returns null for fields that don't exist or would duplicate another field.

### 2. function getNodeTitle(node: Record<string, any>, nodeType: string): string | ... (function) ★ 1.08
📍 `core/src/utils/node-schema.ts:728-735`
📝 Get the title/signature of a node according to its type.
Returns null if not available.

### 3. function getEmbeddingExtractors(label: string): EmbeddingExtractors (function) ★ 1.04
📍 `core/src/utils/node-schema.ts:852-873`
📝 Get embedding text extractors for a node type.
Uses FIELD_MAPPING as the source of truth but handles special cases
where embeddings need more context than display.

@param label - The node label (S...

### 4. interface NodeFieldMapping() (interface) ★ 1.03
📍 `core/src/utils/node-schema.ts:573-582`
📝 Configuration for extracting semantic fields from a node type.
Mirrors the 3-embedding pattern from embedding-service.ts:
- title: corresponds to embedding_name (signature, title, path)
- content: ...

### 5. function getNodeType(node: Record<string, any>): string (function) ★ 1.02
📍 `core/src/brain/formatters/brain-search-formatter.ts:263-276`
📝 Get the node type (label) from a node object.
Nodes have a 'labels' array, we use the first non-generic one.

---

## Dependency Graph

```
FIELD_MAPPING (variable) ★1.3 @ core/src/utils/node-schema.ts
├── [HAS_EMBEDDING_CHUNK]
│   ├── unnamed (EmbeddingChunk)
│   └── unnamed (EmbeddingChunk)
├── [DEFINED_IN]
│   └── node-schema.ts (File)
└── [BELONGS_TO]
    └── ragforge (Project)
getNodeTitle (function) ★1.1 @ core/src/utils/node-schema.ts
├── [CONSUMES]
├── [DEFINED_IN]
└── [BELONGS_TO]
getEmbeddingExtractors (function) ★1.0 @ core/src/utils/node-schema.ts
├── [CONSUMES]
│   ├── EMBEDDING_NAME_OVERRIDES (variable) @ core/src/utils/node-schema.ts
│   └── EmbeddingExtractors (interface) @ core/src/utils/node-schema.ts
├── [DEFINED_IN]
└── [BELONGS_TO]
NodeFieldMapping (interface) ★1.0 @ core/src/utils/node-schema.ts
├── [DEFINED_IN]
└── [BELONGS_TO]
getNodeType (function) ★1.0 @ core/src/brain/formatters/brain-search-formatter.ts
├── [DEFINED_IN]
│   └── brain-search-formatter.ts (File)
└── [BELONGS_TO]
```

---

## Node Types Summary

| Type | Count |
|------|-------|
| function | 3 |
| variable | 1 |
| interface | 1 |
