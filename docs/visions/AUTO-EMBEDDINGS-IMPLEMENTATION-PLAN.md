# Auto-Embeddings Implementation Plan

## 🎯 Goal
Make `watch` auto-generate embeddings for **only dirty scopes**, not all scopes.

## ✅ What Already Exists

1. **Config support**: `watch.auto_embed` in ragforge.config.yaml
2. **Generator support**: Code generator already includes auto_embed logic (line 3997-4005)
3. **Dirty marking**: IncrementalIngestionManager marks scopes as `embeddingsDirty=true`

## ❌ Current Problem

When `auto_embed: true`, it spawns:
```bash
npm run embeddings:generate
```

This regenerates **ALL** embeddings, not just dirty ones.

For a large codebase:
- 1000 scopes total
- 3 scopes changed
- ❌ Regenerates 1000 embeddings (expensive, slow)
- ✅ Should regenerate 3 embeddings only

---

## 📋 Implementation Steps

### Step 1: Add CLI flag to generate-embeddings script

**File**: `/packages/core/templates/scripts/generate-embeddings.ts`

**Changes**:
```typescript
import { parseArgs } from 'node:util';

async function main(): Promise<void> {
  // Parse CLI args
  const { values } = parseArgs({
    options: {
      'only-dirty': {
        type: 'boolean',
        default: false,
      },
    },
  });

  const onlyDirty = values['only-dirty'];

  // ... existing setup ...

  try {
    for (const entity of EMBEDDINGS_CONFIG.entities) {
      console.log(`🔄 Generating embeddings for ${entity.entity}${onlyDirty ? ' (dirty only)' : ''}`);
      for (const pipeline of entity.pipelines) {
        const provider = getProvider(pipeline.model, pipeline.dimension);
        await runEmbeddingPipelines({
          neo4j: client,
          entity: { entity: entity.entity, pipelines: [pipeline] },
          provider,
          defaults: EMBEDDINGS_CONFIG.defaults,
          onlyDirty,  // NEW parameter
        });
      }
    }
    // ... rest
  }
}
```

---

### Step 2: Add `onlyDirty` support to runtime

**File**: `/packages/runtime/src/embedding/pipeline.ts`

**Changes**:
```typescript
export interface RunEmbeddingPipelinesConfig {
  neo4j: Neo4jClient;
  entity: { entity: string; pipelines: EmbeddingPipeline[] };
  provider: EmbeddingProvider;
  defaults?: EmbeddingsDefaults;
  onlyDirty?: boolean;  // NEW
}

export async function runEmbeddingPipelines(config: RunEmbeddingPipelinesConfig): Promise<void> {
  const { neo4j, entity, provider, defaults, onlyDirty } = config;

  for (const pipeline of entity.pipelines) {
    // Build filter for dirty scopes
    const dirtyFilter = onlyDirty ? '{embeddingsDirty: true}' : '';

    // Query scopes (with optional dirty filter)
    const query = `
      MATCH (n:${entity.entity} ${dirtyFilter})
      RETURN n, id(n) as nodeId
      LIMIT 1000
    `;

    const result = await neo4j.run(query);

    console.log(`   Found ${result.records.length} scope(s) to process`);

    for (const record of result.records) {
      const node = record.get('n');
      const nodeId = record.get('nodeId');

      // Generate embedding
      const text = buildEmbeddingText(node, pipeline);
      const embedding = await provider.generateEmbedding(text);

      // Store embedding + mark as clean
      await neo4j.run(
        `MATCH (n:${entity.entity})
         WHERE id(n) = $nodeId
         SET n.\`${pipeline.name}\` = $embedding,
             n.embeddingsDirty = false`,  // Mark clean!
        { nodeId, embedding }
      );
    }

    console.log(`   ✅ Generated ${result.records.length} embeddings for ${pipeline.name}`);
  }
}
```

---

### Step 3: Update generated watch script

**File**: `/packages/core/src/generator/code-generator.ts` (line 3997-4005)

**Changes**:
```typescript
${config.watch?.auto_embed ? `
    if (stats.created + stats.updated > 0) {
      // Auto-generate embeddings for dirty scopes only
      console.log('🔢 Generating embeddings for modified scopes...');
      spawn('npm', ['run', 'embeddings:generate', '--', '--only-dirty'], {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: true
      });
    }
` : ''}
```

**Note**: The `--` is important - it passes flags to the script, not to npm.

---

### Step 4: Add debouncing (Optional but recommended)

**Problem**: If you save 10 files in 5 seconds, it triggers embeddings 10 times.

**Solution**: Debounce embedding generation

```typescript
// In generated watch.ts
let embeddingTimeout: NodeJS.Timeout | null = null;

onBatchComplete: (stats) => {
  console.log(\`✅ Batch complete: \${stats.created + stats.updated} scope(s) updated\`);

  if (stats.created + stats.updated > 0) {
    // Clear existing timeout
    if (embeddingTimeout) {
      clearTimeout(embeddingTimeout);
    }

    // Schedule embedding generation after 5s of inactivity
    embeddingTimeout = setTimeout(() => {
      console.log('🔢 Generating embeddings for modified scopes...');
      spawn('npm', ['run', 'embeddings:generate', '--', '--only-dirty'], {
        cwd: projectRoot,
        stdio: 'inherit',
        shell: true
      });
      embeddingTimeout = null;
    }, 5000);  // 5s debounce
  }
},
```

---

## 🧪 Testing Plan

### Test 1: Enable auto-embed in existing project

```bash
# In tool-calling-agent
cd /home/luciedefraiteur/LR_CodeRag/ragforge/examples/tool-calling-agent

# Edit ragforge.config.yaml
# Add:
# watch:
#   enabled: true
#   auto_embed: true

# Regenerate with new feature
npm run regen

# Test
npm run watch

# In another terminal, modify a file
echo "// test" >> ../packages/runtime/src/index.ts

# Watch should:
# 1. Detect change
# 2. Ingest
# 3. Auto-generate embeddings (only for that file's scopes)
```

### Test 2: Verify only dirty scopes processed

```bash
# Before change
npm run embeddings:generate -- --only-dirty
# Should say: "Found 0 scope(s) to process"

# Modify file
echo "// test" >> src/some-file.ts

# After watch ingests
npm run embeddings:generate -- --only-dirty
# Should say: "Found N scope(s) to process" (N = scopes in that file)

# Run again
npm run embeddings:generate -- --only-dirty
# Should say: "Found 0 scope(s) to process" (all clean now)
```

---

## 📦 Files to Modify

1. ✅ `/packages/core/templates/scripts/generate-embeddings.ts` - Add `--only-dirty` flag
2. ✅ `/packages/runtime/src/embedding/pipeline.ts` - Support `onlyDirty` param
3. ✅ `/packages/core/src/generator/code-generator.ts` - Update watch template (line 3997)
4. ⏳ Build packages
5. ⏳ Test in tool-calling-agent
6. ⏳ Update docs

---

## 🎁 Bonus Features

### Feature 1: Show dirty count before generating

```typescript
// In generated watch script
if (stats.created + stats.updated > 0) {
  // Check how many scopes need embeddings
  const checkDirty = spawn('npx', ['tsx', 'scripts/count-dirty-scopes.ts'], {
    cwd: projectRoot,
    stdio: 'pipe'
  });

  checkDirty.stdout.on('data', (data) => {
    const count = parseInt(data.toString());
    if (count > 0) {
      console.log(`🔢 Generating embeddings for ${count} modified scope(s)...`);
      // ... spawn embeddings:generate
    }
  });
}
```

### Feature 2: Smart batching

```typescript
// Only generate embeddings if:
// - More than 5 scopes dirty OR
// - Last generation was >5 minutes ago
if (dirtyCount >= 5 || timeSinceLastGen > 300000) {
  // Generate
}
```

---

## ✅ Benefits

1. **Performance**: Only process changed scopes
2. **Cost**: Lower API costs (fewer embeddings generated)
3. **Speed**: Faster feedback loop during development
4. **Automatic**: Zero manual intervention
5. **Meta-framework**: Works for ALL generated projects

---

## 🚀 Rollout Plan

### Phase 1: Core Implementation (30 min)
- Modify template + runtime
- Build packages
- Test manually

### Phase 2: Testing (15 min)
- Regenerate tool-calling-agent
- Enable auto_embed
- Verify workflow

### Phase 3: Documentation (15 min)
- Update quickstart docs
- Add example to ragforge.config.yaml
- Document best practices

### Phase 4: Iterate (optional)
- Add debouncing
- Add smart batching
- Add progress indicators
