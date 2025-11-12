# Multi-Provider Support - Usage Guide

RagForge now supports 15+ LLM providers and 12+ embedding providers via LlamaIndex integration, without requiring provider-specific code.

## Table of Contents

- [Configuration](#configuration)
- [Supported Providers](#supported-providers)
- [Usage Examples](#usage-examples)
- [Migration from Gemini-only](#migration-from-gemini-only)
- [Local & Free Options](#local--free-options)

---

## Configuration

### YAML Configuration (ragforge.config.yaml)

Add `llm` and/or `embedding` sections to your config:

```yaml
name: my-project
version: 1.0.0

# Multi-provider LLM configuration
llm:
  provider: gemini              # gemini, openai, anthropic, ollama, groq, etc.
  model: models/gemini-1.5-pro  # Model name (optional, uses smart defaults)
  temperature: 0.7              # Generation temperature (optional)
  max_tokens: 2000              # Max tokens to generate (optional)
  # api_key: xxx                # API key (optional, can use env var)

# Multi-provider embedding configuration
embedding:
  provider: gemini                     # gemini, openai, cohere, ollama, etc.
  model: models/text-embedding-004     # Model name (optional, uses smart defaults)
  dimensions: 768                      # Embedding dimensions (optional, if customizable)
  # api_key: xxx                       # API key (optional, can use env var)

# Standard RagForge config follows...
neo4j:
  uri: bolt://localhost:7687
  database: neo4j
  username: neo4j
  password: password

entities:
  # ...
```

### Environment Variables

API keys are automatically read from environment variables:

```bash
# Gemini (Google)
export GEMINI_API_KEY="your-key-here"

# OpenAI
export OPENAI_API_KEY="your-key-here"

# Anthropic (Claude)
export ANTHROPIC_API_KEY="your-key-here"

# Cohere
export COHERE_API_KEY="your-key-here"

# Ollama (local, no key needed)
# Just ensure ollama is running: ollama serve
```

### TypeScript/JavaScript Usage

```typescript
import { ProviderRegistry } from '@luciformresearch/ragforge-runtime';

// Initialize providers at startup
ProviderRegistry.init({
  llm: {
    provider: 'gemini',
    model: 'models/gemini-1.5-pro',
    temperature: 0.7,
    apiKey: process.env.GEMINI_API_KEY,
  },
  embedding: {
    provider: 'gemini',
    model: 'models/text-embedding-004',
    apiKey: process.env.GEMINI_API_KEY,
  },
});

// Use anywhere in your code
const llm = ProviderRegistry.getLLM();
const response = await llm.generate('Explain what this code does: ...');

const embedder = ProviderRegistry.getEmbedding();
const embedding = await embedder.embed('function calculateTotal() { ... }');
```

---

## Supported Providers

### LLM Providers (15+)

| Provider | Config Key | Default Model | API Key Env Var |
|----------|-----------|---------------|----------------|
| **Gemini** (Google) | `gemini` | `models/gemini-1.5-pro` | `GEMINI_API_KEY` |
| **OpenAI** | `openai` | `gpt-4-turbo-preview` | `OPENAI_API_KEY` |
| **Anthropic** (Claude) | `anthropic` | `claude-3-5-sonnet-20241022` | `ANTHROPIC_API_KEY` |
| **Ollama** (Local) | `ollama` | `llama3.1:8b` | None (local) |
| **Groq** | `groq` | `mixtral-8x7b-32768` | `GROQ_API_KEY` |
| **Together.ai** | `together-ai` | `mistralai/Mixtral-8x7B-Instruct-v0.1` | `TOGETHER_AI_API_KEY` |

More providers supported by LlamaIndex:
- Azure OpenAI
- Cohere
- Hugging Face
- Mistral AI
- Perplexity
- Replicate
- And more...

### Embedding Providers (12+)

| Provider | Config Key | Default Model | Dimensions | API Key Env Var |
|----------|-----------|---------------|------------|----------------|
| **Gemini** | `gemini` | `models/text-embedding-004` | 768 | `GEMINI_API_KEY` |
| **OpenAI** | `openai` | `text-embedding-3-small` | 1536 | `OPENAI_API_KEY` |
| **Cohere** | `cohere` | `embed-english-v3.0` | 1024 | `COHERE_API_KEY` |
| **Ollama** (Local) | `ollama` | `nomic-embed-text` | 768 | None (local) |
| **Together.ai** | `together-ai` | `togethercomputer/m2-bert-80M-8k-retrieval` | 768 | `TOGETHER_AI_API_KEY` |

More providers supported by LlamaIndex:
- Azure OpenAI
- Hugging Face
- Jina AI
- Voyage AI
- And more...

---

## Usage Examples

### Example 1: Gemini (Backward Compatible)

**No changes needed!** Existing RagForge projects continue to work:

```yaml
# ragforge.config.yaml
llm:
  provider: gemini
  model: models/gemini-1.5-pro

embedding:
  provider: gemini
  model: models/text-embedding-004
```

```bash
export GEMINI_API_KEY="your-key-here"
ragforge generate
ragforge ingest
```

### Example 2: OpenAI (GPT-4 + OpenAI Embeddings)

```yaml
# ragforge.config.yaml
llm:
  provider: openai
  model: gpt-4-turbo-preview
  temperature: 0.5
  max_tokens: 4000

embedding:
  provider: openai
  model: text-embedding-3-small
  dimensions: 1536
```

```bash
export OPENAI_API_KEY="your-key-here"
ragforge generate
ragforge ingest
```

### Example 3: Anthropic Claude (with Cohere Embeddings)

Mix and match providers! Use Claude for LLM, Cohere for embeddings:

```yaml
# ragforge.config.yaml
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022
  temperature: 0.3

embedding:
  provider: cohere
  model: embed-english-v3.0
```

```bash
export ANTHROPIC_API_KEY="your-claude-key"
export COHERE_API_KEY="your-cohere-key"
ragforge generate
ragforge ingest
```

### Example 4: Ollama (100% Local, 100% Free)

Run everything locally with Ollama:

```yaml
# ragforge.config.yaml
llm:
  provider: ollama
  model: llama3.1:8b
  # No API key needed!

embedding:
  provider: ollama
  model: nomic-embed-text
  # No API key needed!
```

```bash
# Install Ollama: https://ollama.ai
ollama pull llama3.1:8b
ollama pull nomic-embed-text
ollama serve

# Run RagForge (no API keys needed!)
ragforge generate
ragforge ingest
```

### Example 5: Programmatic Usage

```typescript
import {
  ProviderRegistry,
  LLMProviderAdapter,
  EmbeddingProviderAdapter,
} from '@luciformresearch/ragforge-runtime';

// Option 1: Global initialization (recommended)
ProviderRegistry.init({
  llm: {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.7,
  },
  embedding: {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
});

// Use anywhere
const llm = ProviderRegistry.getLLM();
const result = await llm.generate('Summarize this code: ...');

// Option 2: Direct adapter usage
const claudeLLM = new LLMProviderAdapter({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const response = await claudeLLM.chat([
  { role: 'system', content: 'You are a code analysis expert.' },
  { role: 'user', content: 'Explain this function: ...' },
]);

// Option 3: Multiple specialized LLMs
const fastLLM = new LLMProviderAdapter({
  provider: 'groq',
  model: 'mixtral-8x7b-32768', // Very fast
});

const smartLLM = new LLMProviderAdapter({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022', // Very smart
});

// Use fastLLM for simple tasks, smartLLM for complex analysis
```

---

## Migration from Gemini-only

### Before (Gemini-only)

```typescript
import { GoogleGenerativeAI } from '@google/generativeai';

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-1.5-pro' });
const result = await model.generateContent('...');
```

### After (Multi-provider)

```typescript
import { ProviderRegistry } from '@luciformresearch/ragforge-runtime';

ProviderRegistry.initLLM({
  provider: 'gemini', // or 'openai', 'anthropic', etc.
  model: 'models/gemini-1.5-pro',
});

const llm = ProviderRegistry.getLLM();
const result = await llm.generate('...');
```

**Benefits:**
- Same code works with any provider
- Switch providers by changing 1 line
- No vendor lock-in
- Test multiple providers easily

---

## Local & Free Options

### Ollama (Recommended for Local Development)

**Advantages:**
- 100% free
- 100% private (runs locally)
- No API keys needed
- No rate limits
- Works offline

**Setup:**

```bash
# 1. Install Ollama
# Visit https://ollama.ai or:
curl -fsSL https://ollama.ai/install.sh | sh

# 2. Pull models
ollama pull llama3.1:8b          # LLM (8GB)
ollama pull nomic-embed-text     # Embeddings (768d)

# 3. Start Ollama server
ollama serve

# 4. Configure RagForge
cat > ragforge.config.yaml <<EOF
llm:
  provider: ollama
  model: llama3.1:8b

embedding:
  provider: ollama
  model: nomic-embed-text
EOF

# 5. Run RagForge (no API keys!)
ragforge generate
ragforge ingest
```

**Available Ollama Models:**
- **LLMs:** llama3.1, llama3, mistral, mixtral, codellama, phi, gemma, qwen
- **Embeddings:** nomic-embed-text, all-minilm, bge-large

### Other Free Options

1. **Groq** - Free tier with very fast inference
2. **Together.ai** - Free tier with many open-source models
3. **Hugging Face** - Free inference API

---

## Best Practices

### 1. **Use Environment Variables for API Keys**

```yaml
# ragforge.config.yaml (no keys!)
llm:
  provider: gemini
  # api_key is read from GEMINI_API_KEY env var
```

```bash
# .env (gitignored!)
GEMINI_API_KEY=your-key-here
OPENAI_API_KEY=your-other-key
```

### 2. **Mix and Match Providers**

Choose the best provider for each task:

```yaml
# Use Claude for analysis (smart)
llm:
  provider: anthropic
  model: claude-3-5-sonnet-20241022

# Use Ollama for embeddings (free)
embedding:
  provider: ollama
  model: nomic-embed-text
```

### 3. **Test Multiple Providers**

Create multiple config files:

```bash
# Test with Gemini
ragforge generate --config ragforge.gemini.yaml

# Test with Claude
ragforge generate --config ragforge.claude.yaml

# Test with local Ollama
ragforge generate --config ragforge.ollama.yaml
```

### 4. **Fallback Strategy**

```typescript
async function generateWithFallback(prompt: string) {
  try {
    // Try primary provider (smart but expensive)
    const smartLLM = new LLMProviderAdapter({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
    });
    return await smartLLM.generate(prompt);
  } catch (error) {
    // Fallback to local provider (free but slower)
    const localLLM = new LLMProviderAdapter({
      provider: 'ollama',
      model: 'llama3.1:8b',
    });
    return await localLLM.generate(prompt);
  }
}
```

---

## Adding New Providers

RagForge automatically supports any provider that LlamaIndex supports. To add a new provider:

1. **Check LlamaIndex docs** for the provider class name
2. **Add to provider-adapter.ts** (optional, for default model)
3. **Use immediately** in your config

Example - adding Mistral AI:

```typescript
// packages/runtime/src/llm/provider-adapter.ts
const DEFAULT_LLM_MODELS: Record<string, string> = {
  // ... existing providers
  mistral: 'mistral-large-latest', // Add default model
};

// In createLLM switch:
case 'mistral':
  const { MistralAI } = require('llamaindex');
  return new MistralAI({
    apiKey: config.apiKey || process.env.MISTRAL_API_KEY,
    ...baseOptions,
  });
```

Then use it:

```yaml
llm:
  provider: mistral
  model: mistral-large-latest
```

---

## Performance Comparison

| Provider | Speed | Quality | Cost | Local |
|----------|-------|---------|------|-------|
| Gemini 1.5 Pro | Fast | Excellent | Low | ❌ |
| GPT-4 Turbo | Medium | Excellent | High | ❌ |
| Claude 3.5 Sonnet | Medium | Excellent | Medium | ❌ |
| Ollama (Llama 3.1) | Slow* | Good | Free | ✅ |
| Groq (Mixtral) | Very Fast | Good | Free† | ❌ |

*Depends on hardware
†Free tier with limits

---

## Troubleshooting

### "Unsupported provider" error

The provider may not be implemented yet. Add it to `provider-adapter.ts`:

```typescript
case 'your-provider':
  const { YourProvider } = require('llamaindex');
  return new YourProvider({ ...config });
```

### API key not found

Ensure environment variable matches the provider:

```bash
# Check loaded env vars
printenv | grep API_KEY

# Set if missing
export GEMINI_API_KEY="your-key"
```

### Ollama connection refused

Ensure Ollama server is running:

```bash
ollama serve
# In another terminal:
ollama list  # Should show installed models
```

---

## Next Steps

- Read the [Chat Adapter Roadmap](./roadmaps/CHAT-ADAPTER-ROADMAP-V2.md) for multi-agent systems
- Explore [LlamaIndex Document Loaders](./LLAMAINDEX-INTEGRATION-SUMMARY.md) for non-code documents
- Check [Neo4j GDS Integration](./LLAMAINDEX-GDS-INTEGRATION-ANALYSIS.md) for graph algorithms
