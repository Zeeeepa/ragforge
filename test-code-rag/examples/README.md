# Examples

This directory contains functional examples for using the generated test-code-rag client.

## Running Examples

```bash
# Make sure you have your .env file configured
npx tsx examples/01-basic-query.mjs
```

## Available Examples

- **01-basic-query.mjs** - Simple query with limit
- **02-semantic-search.mjs** - Vector similarity search
- **03-llm-reranking.mjs** - LLM-based reranking of results
- **04-with-summaries.mjs** - Using field summaries for better reranking

## Configuration

Update the following in each example:
- Entity name (e.g., `.scope()`)
- Vector index name (e.g., `'scopeSourceEmbeddings'`)
- Search queries
