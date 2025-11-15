# Generic Chat Example

This example demonstrates RagForge's generic chat framework working with **ANY** domain.

## What's Generic About It?

- ✅ Works with code, products, documents, or any entities
- ✅ Tools auto-generated from your config
- ✅ No domain-specific logic
- ✅ Same API for all use cases

## Quick Start

```bash
# 1. Setup database
npx tsx scripts/setup-chat-schema.ts

# 2. Run example
npx tsx examples/chat-generic/basic-example.ts
```

## Examples Included

### 1. Code Domain Example
Chat with an agent that searches code using semantic search.

**Config:**
```yaml
entities:
  - name: Scope
    # ...

chat:
  agents:
    - id: code-assistant
      domain: code
      tools:
        - generated.scope.semanticSearchBySource
```

**Usage:**
```typescript
User: "Explain how authentication works"
Agent: [Uses semanticSearchBySource] "Authentication is handled in..."
```

---

### 2. E-commerce Domain Example
Chat with a shopping assistant that searches products.

**Config:**
```yaml
entities:
  - name: Product
    # ...

chat:
  agents:
    - id: shopping-assistant
      domain: products
      tools:
        - generated.product.semanticSearchByDescription
```

**Usage:**
```typescript
User: "Find me a red sweater"
Agent: [Uses semanticSearchByDescription] "I found these products..."
```

---

## Architecture

```
User Message
    ↓
ChatSessionManager (generic Neo4j storage)
    ↓
AgentRuntime (generic agent logic)
    ↓
ToolRegistry (auto-generated from config)
    ↓
Generated Client (domain-specific queries)
    ↓
Neo4j (domain entities + chat entities)
```

## Key Files

- `basic-example.ts` - Complete working example
- `setup-chat-schema.ts` - Database schema setup
- `test-tool-registry.ts` - Test tool auto-generation

## What Gets Generated?

For this config:
```yaml
entities:
  - name: Scope
    searchable_fields:
      - name: source
```

The tool registry auto-generates:
- `generated.scope.semanticSearchBySource`
- `generated.scope.whereName`
- `generated.scope.whereFile`
- `generated.scope.withConsumes`
- `generated.scope.withConsumedBy`
- etc. (ALL query methods become tools!)

## Next Steps

1. Try the basic example
2. Modify the agent config
3. Add more tools
4. Test with your own domain
