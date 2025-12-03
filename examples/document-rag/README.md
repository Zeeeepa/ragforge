# Document RAG Example

Turn your documents into a searchable knowledge base.

## Quick Start

```bash
# 1. Put your documents in ./docs/
cp ~/my-documents/*.pdf ./docs/

# 2. Run quickstart
ragforge quickstart

# 3. Done! Query your documents
```

## What happens

1. **Docker starts** - Neo4j + Tika (for parsing & OCR)
2. **Documents parsed** - PDF, Word, Excel, images with text...
3. **Chunks created** - Split into searchable pieces
4. **Embeddings generated** - For semantic search

## Supported formats

- PDF, DOCX, PPTX, XLSX
- Markdown, TXT, HTML, RTF
- EPUB (ebooks)
- JPG, PNG (OCR extracts text from images)

## Requirements

- Docker
- Node.js 18+
- `GEMINI_API_KEY` for embeddings
