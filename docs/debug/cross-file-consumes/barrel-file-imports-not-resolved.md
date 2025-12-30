# Debug: Cross-file CONSUMES via Barrel Files Not Working

**Date**: 2025-12-22
**Status**: ✅ FIXED - All 4 issues resolved
**Severity**: Medium - affects dependency graph completeness

## Problem Summary

Cross-file CONSUMES relationships were NOT being created when imports go through barrel files (index.ts re-exports). This meant `brain_search` reports didn't show "who consumes" a function when that consumer imports via a barrel file.

**Root Cause Found and Fixed**: The parser (codeparsers package) correctly detected imports but did NOT generate identifier references when imported symbols were used in code. Without these references, `buildImportReferences()` could not create CONSUMES relationships.

## Specific Edge Case: `formatAsMarkdown`

### The Import Chain

```
brain-tools.ts
  └── import { formatAsMarkdown } from '../brain/index.js'
        └── brain/index.ts: export { formatAsMarkdown } from './formatters/index.js'
              └── formatters/index.ts: export { formatAsMarkdown } from './brain-search-formatter.js'
                    └── brain-search-formatter.ts: export function formatAsMarkdown(...)
```

### Before Fix
```cypher
MATCH (a)-[:CONSUMES]->(b {name: 'formatAsMarkdown'}) WHERE a.file CONTAINS 'brain-tools'
-- Result: EMPTY (0 rows) ❌
```

### After Fix
```cypher
MATCH (a)-[:CONSUMES]->(b {name: 'formatAsMarkdown'}) WHERE a.file CONTAINS 'brain-tools'
-- Result: 2 rows ✅
-- file_scope_01 (module) -> formatAsMarkdown
-- generateBrainSearchHandler (function) -> formatAsMarkdown
```

---

## Issues Found and Fixed

### Issue 1: `followReExports` not handling multi-line exports ✅ FIXED

**File**: `/packages/core/src/runtime/utils/ImportResolver.ts`

**Problem**: The old code processed exports line-by-line, which couldn't match multi-line export statements like:
```typescript
export {
  formatAsMarkdown,
  otherFunc,
} from './brain-search-formatter.js';
```

**Root Cause**: Used regex `[^}]` which doesn't match newlines:
```typescript
// OLD (broken):
const namedExportMatch = trimmed.match(/^export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
```

**Fix**: Changed to process entire file content with regex that matches across lines:
```typescript
// NEW (works):
const namedExportRegex = /export\s+\{([\s\S]*?)\}\s*from\s+['"]([^'"]+)['"]/g;
```

Also added handling for `type` prefix in exports:
```typescript
const cleaned = e.trim().replace(/^type\s+/, '');
```

---

### Issue 2: `globalUUIDMapping` empty during single-file re-ingestion ✅ FIXED

**Files Modified**:
- `/packages/core/src/runtime/adapters/types.ts`
- `/packages/core/src/runtime/adapters/code-source-adapter.ts`
- `/packages/core/src/runtime/adapters/incremental-ingestion.ts`

**Problem**: When re-ingesting a single file (via watcher or mark_file_dirty), `globalUUIDMapping` only contained scopes from the file being parsed, not from the rest of the project.

**Root Cause**: `buildGlobalUUIDMapping()` only uses files in the current parse batch. For incremental single-file ingestion, this means no cross-file symbols are available.

**Fix**:
1. Added `existingUUIDMapping` field to `ParseOptions` interface (types.ts)
2. Query DB for all project scopes before parsing (incremental-ingestion.ts)
3. Merge `existingUUIDMapping` with `globalUUIDMapping` (code-source-adapter.ts)

```typescript
// In incremental-ingestion.ts - query existing scopes
if (projectId) {
  const projectScopesResult = await this.client.run(`
    MATCH (s:Scope) WHERE s.projectId = $projectId
    RETURN s.uuid AS uuid, s.name AS name, s.file AS file, s.type AS type
  `, { projectId });
  // Build existingUUIDMapping...
}

// In code-source-adapter.ts - merge mappings
if (existingUUIDMapping) {
  for (const [name, candidates] of existingUUIDMapping) {
    // Merge with globalUUIDMapping...
  }
}
```

---

### Issue 3: Cross-file CONSUMES not persisted due to wrong label in MATCH ✅ FIXED

**File**: `/packages/core/src/runtime/adapters/incremental-ingestion.ts`

**Problem**: Even though cross-file CONSUMES relationships were created in the graph (16 found), they weren't being persisted to Neo4j.

**Root Cause**: In `ingestNodes()`, the code builds a `uuidToLabel` map from parsed nodes, then uses labels in MATCH queries:
```typescript
const fromLabel = uuidToLabel.get(rel.from) || 'Node';  // Fallback to 'Node'
const toLabel = uuidToLabel.get(rel.to) || 'Node';      // Fallback to 'Node'
// ...
MATCH (to:${toLabel} {uuid: relData.to})  // MATCH (to:Node {...}) - FAILS!
```

For cross-file relationships, the target UUID isn't in the parsed nodes, so `toLabel` becomes `'Node'`. But the actual node has label `Scope`, so the MATCH silently fails!

**Fix**: Use unlabeled MATCH when label is unknown:
```typescript
const fromLabel = uuidToLabel.get(rel.from) || null;  // null = unknown
const toLabel = uuidToLabel.get(rel.to) || null;

// Use unlabeled MATCH for cross-file refs
const fromMatch = fromLabel ? `(from:${fromLabel} {uuid: relData.from})` : `(from {uuid: relData.from})`;
const toMatch = toLabel ? `(to:${toLabel} {uuid: relData.to})` : `(to {uuid: relData.to})`;
```

---

## Files Modified (Summary)

| File | Change |
|------|--------|
| `packages/core/src/runtime/utils/ImportResolver.ts` | Fixed `followReExports` for multi-line exports |
| `packages/core/src/runtime/adapters/types.ts` | Added `existingUUIDMapping` to ParseOptions |
| `packages/core/src/runtime/adapters/code-source-adapter.ts` | Merge existingUUIDMapping, add cross-file debug log |
| `packages/core/src/runtime/adapters/incremental-ingestion.ts` | Query DB for existing scopes, fix unlabeled MATCH |

---

## Issue 4: Parser doesn't generate identifier references for imported symbols ✅ FIXED

**Package**: `@luciformresearch/codeparsers`

**Problem**: The parser correctly identified imports in `scope.imports`, but did NOT create identifier references with `kind: 'import'` when imported symbols were used in function bodies.

**Root Cause**: The AST traversal in `extractIdentifierReferences()` was missing some identifier usages due to tree-sitter edge cases. The `classifyScopeReferences()` method only classified existing references, it didn't add missing ones.

**Fix**: Added `ensureImportReferencesTracked()` method in `ScopeExtractionParser.ts` that:
1. Scans scope content for imported symbol names (using regex word boundary matching)
2. Adds missing references to `identifierReferences` before classification
3. These references are then classified as `kind: 'import'` by the existing logic

**File Modified**: `/packages/codeparsers/src/scope-extraction/ScopeExtractionParser.ts`

```typescript
/**
 * Ensure imported symbols used in scope content are tracked as references.
 */
private ensureImportReferencesTracked(
  scope: ScopeInfo,
  fileImports: ImportReference[],
  aliasMap: Map<string, ImportReference>
): void {
  for (const imp of fileImports) {
    const symbolName = imp.alias ?? imp.imported;
    if (!symbolName || symbolName === '*' || imp.kind === 'side-effect') continue;

    // Check if already tracked
    const existingRef = scope.identifierReferences.find(
      ref => ref.identifier === symbolName || ref.qualifier === symbolName
    );
    if (existingRef) continue;

    // Check if symbol appears in scope content
    const regex = new RegExp(`\\b${this.escapeRegex(symbolName)}\\b`);
    const match = regex.exec(scope.content);
    if (match) {
      scope.identifierReferences.push({
        identifier: symbolName,
        line: scope.startLine + (beforeMatch.match(/\n/g) || []).length,
        // ... position details
      });
    }
  }
}
```

**Verification**: After fix, running `scripts/test-parser-refs.ts` shows:
```
🔗 formatAsMarkdown [import] from "../brain/index.js" (line 1402)
🔗 formatAsCompact [import] from "../brain/index.js" (line 1423)
```

---

## Verification (Current State - PASSING ✅)

After all 4 issues fixed and re-ingestion:

```cypher
-- Check cross-file CONSUMES to formatAsMarkdown
MATCH (a)-[:CONSUMES]->(b:Scope {name: 'formatAsMarkdown'})
WHERE a.file <> b.file
RETURN a.name, a.file, a.type, b.file
-- Result: 2 rows ✅
-- generateBrainSearchHandler (function) from brain-tools.ts → brain-search-formatter.ts
-- file_scope_01 (module) from brain-tools.ts → brain-search-formatter.ts
```

Daemon log during ingestion:
```
🔗 16 cross-file CONSUMES (target in other files)
✅ Graph built: 91 nodes, 325 relationships
🔗 16 CONSUMES (Scope→Node) [190/325]
```

---

## Migration of Existing Data

To apply the fix to existing projects, run:

**Script**: `scripts/migrate-cross-file-consumes.ts`

```bash
npx tsx scripts/migrate-cross-file-consumes.ts --dry-run  # Preview changes
npx tsx scripts/migrate-cross-file-consumes.ts            # Apply changes
```

Or mark all scopes as dirty to trigger re-ingestion:
```cypher
MATCH (s:Scope) WHERE s.projectId IS NOT NULL SET s.schemaDirty = true
```

---

## Debug Tools

### Test Parser References Script
```bash
# Test what imports and references the parser generates for a file
npx tsx scripts/test-parser-refs.ts packages/core/src/tools/brain-tools.ts
```

This shows `scope.imports` and `scope.references` for each scope, helping identify if the parser is generating the expected references.

### Log cross-file CONSUMES count
The code now logs cross-file CONSUMES count during buildGraph (but currently always shows 0):
```
🔗 0 cross-file CONSUMES (target in other files)
```

### MCP Tools for testing
```bash
# Mark file dirty and queue for re-ingestion
mcp__ragforge__mark_file_dirty({ file_path: "path/to/file.ts", queue_for_ingestion: true })

# Check CONSUMES edges
mcp__ragforge__run_cypher({ query: "MATCH (a)-[:CONSUMES]->(b {name: 'X'}) RETURN a.name, b.file" })

# Count cross-file CONSUMES for a file
mcp__ragforge__run_cypher({
  query: "MATCH (a:Scope)-[r:CONSUMES]->(b:Scope) WHERE a.file CONTAINS 'X' AND a.file <> b.file RETURN count(r)"
})
```

### Check Daemon Logs
```bash
tail -100 ~/.ragforge/logs/daemon.log | grep -E "cross-file|CONSUMES|Graph built"
```
