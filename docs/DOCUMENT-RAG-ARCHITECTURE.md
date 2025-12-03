# Document RAG with Dynamic Topics Architecture

**Design document for Document RAG system with LLM-based topic extraction and merging**

---

## Overview

A RAG system for documents (PDFs, DOCX, Markdown, etc.) with:
- **LlamaIndex-based document parsing**
- **Intelligent chunking**
- **LLM-extracted topics** (dynamic, changeable)
- **Topic hierarchy** (parent/child relationships)
- **Topic merging** (LLM-based consolidation)
- **Extensible for chat sessions** (future)

---

## Entity Model

### Graph Structure

```
Document
  ├─ CONTAINS → Chunk
  │             ├─ HAS_TOPIC → Topic
  │             ├─ NEXT_CHUNK → Chunk (sequential ordering)
  │             └─ embedding (vector)
  │
  └─ HAS_MAIN_TOPIC → Topic

Topic
  ├─ PARENT_TOPIC → Topic (hierarchy)
  ├─ MERGED_INTO → Topic (merge history)
  ├─ RELATED_TO → Topic (semantic similarity)
  └─ embedding (vector for topic clustering)

ChatSession (future)
  └─ DISCUSSES → Topic
```

### Entities

#### 1. Document
```yaml
- name: Document
  unique_field: path
  searchable_fields:
    - name: title
      type: string
      description: Document title
    - name: path
      type: string
      description: File path
      indexed: true
    - name: type
      type: string
      description: Document type (pdf, docx, md, txt, html)
    - name: content_hash
      type: string
      description: Content hash for change detection
    - name: author
      type: string
    - name: created_at
      type: datetime
    - name: modified_at
      type: datetime
    - name: word_count
      type: number
    - name: page_count
      type: number
    - name: language
      type: string
    - name: summary
      type: string
      description: LLM-generated summary

  computed_fields:
    - name: chunk_count
      type: number
      cypher: |
        OPTIONAL MATCH (n)-[:CONTAINS]->(c:Chunk)
        RETURN count(c)

    - name: topic_count
      type: number
      cypher: |
        OPTIONAL MATCH (n)-[:CONTAINS]->(c:Chunk)-[:HAS_TOPIC]->(t:Topic)
        RETURN count(DISTINCT t)

  vector_indexes:
    - name: document_summary_embedding
      source_field: summary
      field: embedding
      dimension: 768

  relationships:
    - type: REFERENCES
      target: Document
      direction: both
      description: Cross-references between documents
    - type: CONTAINS
      target: Chunk
      direction: outgoing
    - type: HAS_MAIN_TOPIC
      target: Topic
      direction: outgoing
```

#### 2. Chunk
```yaml
- name: Chunk
  unique_field: uuid
  searchable_fields:
    - name: content
      type: string
      description: Chunk text content
    - name: chunk_index
      type: number
      description: Position in document (0-based)
    - name: start_char
      type: number
      description: Character offset in source document
    - name: end_char
      type: number
      description: End character offset
    - name: word_count
      type: number
    - name: document_path
      type: string
      description: Parent document path (for filtering)

  computed_fields:
    - name: topic_names
      type: array<string>
      cypher: |
        OPTIONAL MATCH (n)-[:HAS_TOPIC]->(t:Topic)
        RETURN collect(t.name)

  vector_indexes:
    - name: chunk_content_embedding
      source_field: content
      field: embedding
      dimension: 768

  relationships:
    - type: HAS_TOPIC
      target: Topic
      direction: outgoing
      description: Topics extracted from this chunk
    - type: NEXT_CHUNK
      target: Chunk
      direction: outgoing
      description: Sequential ordering within document
    - type: IN_DOCUMENT
      target: Document
      direction: outgoing
```

#### 3. Topic
```yaml
- name: Topic
  unique_field: uuid
  searchable_fields:
    - name: name
      type: string
      description: Topic name (e.g., "Authentication", "API Design")
      indexed: true
    - name: description
      type: string
      description: LLM-generated topic description
    - name: keywords
      type: array<string>
      description: Key terms associated with this topic
    - name: confidence
      type: number
      description: LLM confidence score (0-1)
    - name: extraction_prompt
      type: string
      description: Prompt used for extraction (for reproducibility)
    - name: extracted_at
      type: datetime
    - name: is_merged
      type: boolean
      description: Whether this topic was merged into another
    - name: merge_reason
      type: string
      description: Why this topic was merged

  computed_fields:
    - name: chunk_count
      type: number
      cypher: |
        OPTIONAL MATCH (c:Chunk)-[:HAS_TOPIC]->(n)
        RETURN count(c)

    - name: document_count
      type: number
      cypher: |
        OPTIONAL MATCH (d:Document)-[:CONTAINS]->(c:Chunk)-[:HAS_TOPIC]->(n)
        RETURN count(DISTINCT d)

  vector_indexes:
    - name: topic_description_embedding
      source_field: description
      field: embedding
      dimension: 768

  relationships:
    - type: PARENT_TOPIC
      target: Topic
      direction: outgoing
      description: Parent in topic hierarchy
    - type: CHILD_TOPIC
      target: Topic
      direction: incoming
      description: Children topics
    - type: MERGED_INTO
      target: Topic
      direction: outgoing
      description: This topic was merged into another
    - type: RELATED_TO
      target: Topic
      direction: both
      description: Semantically related topics
```

---

## LLM-Based Pipelines

### 1. Topic Extraction Pipeline

**Purpose**: Extract topics from document chunks using LLM

**Process**:
```typescript
// For each chunk
TopicExtractor.extract(chunk: Chunk): Promise<ExtractedTopics>

// 1. Generate extraction prompt
const prompt = `
Analyze this text chunk and extract 1-3 main topics.
For each topic provide:
- name (2-4 words, concise)
- description (1 sentence)
- keywords (3-5 key terms)
- confidence (0-1, how confident are you this is a main topic)

Text chunk:
"""
${chunk.content}
"""

Context (previous chunk topics): ${previousTopics}

Return JSON:
{
  "topics": [
    {
      "name": "API Authentication",
      "description": "Discusses authentication mechanisms for REST APIs",
      "keywords": ["OAuth", "JWT", "token", "authentication"],
      "confidence": 0.95
    }
  ]
}
`;

// 2. Call LLM with structured output
const result = await llm.generateStructured(prompt, TopicSchema);

// 3. Create Topic nodes
// 4. Link: Chunk -[:HAS_TOPIC]-> Topic
// 5. Check for existing similar topics (embedding similarity)
// 6. Either reuse or create new Topic
```

**Configuration**:
```yaml
topic_extraction:
  enabled: true
  llm:
    provider: gemini
    model: gemini-1.5-flash  # Fast for extraction
    temperature: 0.3

  extraction:
    min_chunk_length: 100      # Skip very short chunks
    max_topics_per_chunk: 3
    min_confidence: 0.6
    context_window: 2          # Include N previous chunks for context

  similarity:
    threshold: 0.85            # Merge if topics are >85% similar
    use_embeddings: true       # Use embeddings for similarity
```

**Smart features**:
- **Context awareness**: Use previous chunk topics for continuity
- **Deduplication**: Detect similar topics using embeddings
- **Confidence filtering**: Only keep high-confidence topics
- **Batch processing**: Process multiple chunks in parallel

### 2. Topic Merging Pipeline

**Purpose**: Consolidate similar/redundant topics using LLM

**Process**:
```typescript
TopicMerger.merge(topics: Topic[]): Promise<MergedTopics>

// 1. Cluster topics by embedding similarity
const clusters = clusterBySimilarity(topics, threshold: 0.85);

// 2. For each cluster, generate merge prompt
const prompt = `
These topics appear to be related. Decide if they should be merged.

Topics to analyze:
${cluster.map(t => `
- ${t.name}
  Description: ${t.description}
  Keywords: ${t.keywords.join(', ')}
  Used in ${t.chunk_count} chunks
`).join('\n')}

Should these be merged? If yes:
1. Provide merged topic name (best representative name)
2. Provide merged description (comprehensive)
3. Provide merged keywords (union of important keywords)
4. Explain merge reasoning

Return JSON:
{
  "should_merge": true/false,
  "merged_topic": {
    "name": "...",
    "description": "...",
    "keywords": [...],
    "reasoning": "..."
  },
  "topics_to_merge": [uuid1, uuid2, ...]  // which to merge
}
`;

// 3. Call LLM
const decision = await llm.generateStructured(prompt, MergeDecisionSchema);

// 4. If should_merge:
//    - Create new merged Topic
//    - Update all Chunk -[:HAS_TOPIC]-> relationships
//    - Mark old topics: is_merged = true
//    - Create: OldTopic -[:MERGED_INTO]-> NewTopic
//    - Preserve merge history for rollback
```

**Configuration**:
```yaml
topic_merging:
  enabled: true
  llm:
    provider: gemini
    model: gemini-1.5-pro      # More capable for merge decisions
    temperature: 0.2           # Conservative

  clustering:
    similarity_threshold: 0.85
    min_cluster_size: 2
    max_cluster_size: 5        # Don't try to merge too many at once

  merge_criteria:
    min_chunk_overlap: 0.3     # At least 30% chunks in common
    require_keyword_overlap: true

  schedule:
    trigger: manual            # Or: auto_after_ingestion, periodic
    batch_size: 10             # Process N clusters at a time
```

**Smart features**:
- **Embedding-based clustering**: Find similar topics automatically
- **LLM validation**: Human-like merge decisions
- **Merge history**: Track what was merged (for rollback)
- **Usage-based decisions**: Consider chunk_count when merging
- **Iterative**: Can re-merge over time as corpus grows

### 3. Topic Hierarchy Builder

**Purpose**: Build parent-child topic relationships

**Process**:
```typescript
// After extraction/merging, detect hierarchies
TopicHierarchy.build(topics: Topic[]): Promise<void>

// Example hierarchy:
// Programming
//   ├─ API Design
//   │  ├─ REST APIs
//   │  └─ GraphQL
//   ├─ Authentication
//   └─ Testing

// Prompt LLM to organize topics hierarchically
const prompt = `
Organize these topics into a hierarchy (parent-child relationships).
Topics: ${topics.map(t => t.name).join(', ')}

Rules:
- Max 3 levels deep
- Parent topics are broader concepts
- Child topics are specific aspects

Return JSON tree structure.
`;
```

---

## Document Processing Flow

### Ingestion

```typescript
// 1. DocumentSourceAdapter parses file
const document = await adapter.parseDocument('docs/api-guide.pdf');

// 2. Create Document node
await neo4j.createDocument(document);

// 3. Chunk document (intelligent splitting)
const chunks = await chunker.split(document.content, {
  strategy: 'semantic',        // Or: fixed_size, sentence, paragraph
  chunk_size: 500,            // tokens
  chunk_overlap: 50,
  preserve_sentences: true
});

// 4. Create Chunk nodes + CONTAINS relationships
for (const chunk of chunks) {
  await neo4j.createChunk(chunk);
  await neo4j.link(document, 'CONTAINS', chunk);
}

// 5. Generate embeddings (batch)
await embeddingPipeline.generateForChunks(chunks);

// 6. Extract topics (parallel, with context)
await topicExtractor.extractForChunks(chunks);

// 7. Link sequential chunks (for context)
for (let i = 0; i < chunks.length - 1; i++) {
  await neo4j.link(chunks[i], 'NEXT_CHUNK', chunks[i + 1]);
}
```

### Query by Topic

```typescript
// Find all chunks about "Authentication"
query_entities({
  entity_type: 'Chunk',
  conditions: [
    {
      field: 'topic_names',
      operator: 'CONTAINS',
      value: 'Authentication'
    }
  ]
})

// Or via relationship
explore_relationships({
  entity_type: 'Topic',
  start_entity: {name: 'Authentication'},
  relationship: 'HAS_TOPIC',
  direction: 'incoming',  // Find chunks with this topic
  target_type: 'Chunk'
})
```

### Topic-Based Search

```typescript
// 1. Find relevant topic
const topics = await semanticSearch('How does authentication work?', {
  entity_type: 'Topic',
  top_k: 3
});

// 2. Get chunks for those topics
const chunks = await getChunksForTopics(topics);

// 3. Rerank by relevance
const ranked = await llmRerank(chunks, userQuery);

// 4. Generate answer with context
const answer = await llm.generate({
  context: ranked.slice(0, 5),
  question: userQuery
});
```

---

## File Structure

```
packages/runtime/src/adapters/
├── document-source-adapter.ts    # NEW: LlamaIndex integration
└── types.ts

packages/runtime/src/topics/      # NEW: Topic management
├── topic-extractor.ts
├── topic-merger.ts
├── topic-hierarchy.ts
└── types.ts

examples/document-rag/
├── ragforge.config.yaml
├── docs/                         # Sample documents
│   ├── api-guide.pdf
│   ├── user-manual.docx
│   └── architecture.md
├── scripts/
│   ├── 01-ingest-documents.ts
│   ├── 02-extract-topics.ts
│   ├── 03-merge-topics.ts
│   ├── 04-build-hierarchy.ts
│   └── 05-create-embeddings.ts
├── queries/
│   ├── search-by-topic.ts
│   ├── find-related-topics.ts
│   └── topic-statistics.ts
└── README.md
```

---

## Future: Chat Sessions with Topics

### ChatSession Entity

```yaml
- name: ChatSession
  searchable_fields:
    - name: title
    - name: user_id
    - name: created_at
    - name: message_count

  relationships:
    - type: DISCUSSES
      target: Topic
      description: Topics discussed in this session
    - type: CONTAINS
      target: Message
```

### Auto-detect chat topics

```typescript
// After each message, extract topics
await topicExtractor.extractFromMessage(message);

// Link: ChatSession -[:DISCUSSES]-> Topic
// Allows queries like:
// "Show me all conversations about Authentication"
```

---

## Configuration Example

```yaml
name: document-rag
version: 1.0.0

# Document processing
source:
  type: document
  adapter: llamaindex
  root: ./docs
  include:
    - "**/*.pdf"
    - "**/*.docx"
    - "**/*.md"
    - "**/*.txt"
  options:
    chunk_size: 500
    chunk_overlap: 50
    chunking_strategy: semantic

# Entities
entities:
  - name: Document
    # ... (see above)

  - name: Chunk
    # ... (see above)

  - name: Topic
    # ... (see above)

# Topic extraction
topic_extraction:
  enabled: true
  llm:
    provider: gemini
    model: gemini-1.5-flash
    temperature: 0.3
  extraction:
    min_chunk_length: 100
    max_topics_per_chunk: 3
    min_confidence: 0.6
    context_window: 2
  similarity:
    threshold: 0.85
    use_embeddings: true

# Topic merging
topic_merging:
  enabled: true
  llm:
    provider: gemini
    model: gemini-1.5-pro
    temperature: 0.2
  clustering:
    similarity_threshold: 0.85
    min_cluster_size: 2
  schedule:
    trigger: manual

# Embeddings
embeddings:
  provider: gemini
  defaults:
    model: text-embedding-004
    dimension: 768
  entities:
    - entity: Chunk
      pipelines:
        - name: content_embedding
          source: content
          target_property: embedding
    - entity: Topic
      pipelines:
        - name: description_embedding
          source: description
          target_property: embedding
```

---

## Benefits

### 1. **Dynamic Topics**
- No predefined taxonomy
- Topics emerge from content
- Easy to refine over time

### 2. **LLM-Powered Intelligence**
- Human-like topic extraction
- Smart merging decisions
- Context-aware processing

### 3. **Hierarchical Organization**
- Topics can have parent/child relationships
- Navigate from general to specific
- Build knowledge maps

### 4. **Extensible**
- Chat sessions can reuse topics
- Cross-reference between docs and chats
- Timeline of topic evolution

### 5. **Queryable**
- Find content by topic
- Discover related topics
- Analyze topic coverage

---

## Next Steps

1. ✅ Design architecture (this doc)
2. Create `DocumentSourceAdapter`
3. Create topic extraction pipeline
4. Create topic merging pipeline
5. Build complete example
6. Test with real documents
