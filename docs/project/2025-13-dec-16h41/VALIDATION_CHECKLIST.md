# Validation Checklist - Incremental Ingestion & Lock System

Date: 2025-12-13

## Prerequisites

- [ ] Neo4j container running
- [ ] Build passes (`npm run build`)

## Phase 1: Clean State & Initial Ingestion

### 1.1 Clear Database
```bash
# Option A: Use cleanup_brain tool
# Option B: Direct Cypher
MATCH (n) DETACH DELETE n
```
- [ ] Database cleared successfully
- [ ] `list_brain_projects` returns empty list

### 1.2 Initial Ingestion
```bash
# Ingest packages directory
ingest_directory({ path: "packages" })
```
- [ ] Ingestion completes without errors
- [ ] Projects registered in brain (`list_brain_projects`)
- [ ] Nodes created (check with `run_cypher({ query: "MATCH (n) RETURN labels(n)[0] as label, count(n) as cnt ORDER BY cnt DESC LIMIT 20" })`)

### 1.3 Verify brain_search Works
```bash
brain_search({ query: "IngestionLock", semantic: false })
brain_search({ query: "file operations", semantic: true })
```
- [ ] Text search returns results
- [ ] Semantic search returns results (if embeddings generated)

## Phase 2: File Modification - Manual

### 2.1 Modify a File Manually (Outside Tools)
1. Edit a file directly (e.g., add a comment to `packages/core/src/tools/ingestion-lock.ts`)
2. Wait for FileWatcher to detect change

Expected behavior:
- [ ] FileWatcher logs detection
- [ ] Ingestion lock acquired for parsing
- [ ] File re-parsed
- [ ] Lock released
- [ ] brain_search reflects new content

### 2.2 Verify Lock Waiting
1. Start a long operation (e.g., large ingest)
2. Immediately call `brain_search`

Expected behavior:
- [ ] brain_search waits for lock
- [ ] Returns results only after lock released
- [ ] No stale data returned

## Phase 3: File Modification - Via Tools

### 3.1 Edit File via edit_file Tool
```bash
edit_file({
  path: "packages/core/src/tools/ingestion-lock.ts",
  old_string: "// test marker",
  new_string: "// test marker updated"
})
```
- [ ] Edit succeeds
- [ ] `onFileModified` callback triggered
- [ ] File queued for re-ingestion
- [ ] brain_search shows updated content

### 3.2 Create File via create_file Tool
```bash
create_file({
  path: "packages/core/src/test-validation-file.ts",
  content: "// Validation test file\nexport const VALIDATION_MARKER = 'test-123';"
})
```
- [ ] File created
- [ ] File tracked (either via FileWatcher if in project, or TouchedFilesWatcher)
- [ ] brain_search finds "VALIDATION_MARKER"

### 3.3 Copy File via copy_file Tool
```bash
copy_file({
  source: "packages/core/src/test-validation-file.ts",
  destination: "packages/core/src/test-validation-file-copy.ts"
})
```
- [ ] Copy succeeds
- [ ] `onFileCopied` callback triggered
- [ ] Destination file tracked
- [ ] brain_search finds both files

### 3.4 Move File via move_file Tool
```bash
move_file({
  source: "packages/core/src/test-validation-file-copy.ts",
  destination: "packages/core/src/test-validation-file-moved.ts"
})
```
- [ ] Move succeeds
- [ ] `onFileMoved` callback triggered
- [ ] Source file removed from brain
- [ ] Destination file tracked
- [ ] brain_search finds only moved file (not copy)

### 3.5 Delete File via delete_path Tool
```bash
delete_path({ path: "packages/core/src/test-validation-file-moved.ts" })
delete_path({ path: "packages/core/src/test-validation-file.ts" })
```
- [ ] Delete succeeds
- [ ] `onFileDeleted` callback triggered
- [ ] Files removed from brain
- [ ] brain_search no longer finds "VALIDATION_MARKER"

## Phase 4: Orphan Files (Outside Projects)

### 4.1 Touch Orphan File
```bash
# Create/edit a file outside of any registered project
write_file({
  path: "/tmp/ragforge-test/orphan-test.ts",
  content: "// Orphan test file\nexport const ORPHAN_MARKER = 'orphan-456';"
})
```
- [ ] File created
- [ ] `brainManager.touchFile()` called
- [ ] TouchedFilesWatcher picks up file
- [ ] File parsed and stored in brain
- [ ] brain_search finds "ORPHAN_MARKER"

### 4.2 Orphan File Lock Behavior
- [ ] TouchedFilesWatcher acquires ingestionLock during parsing
- [ ] brain_search waits if lock active
- [ ] Embedding generation uses embeddingLock

## Phase 5: Edge Cases

### 5.1 Concurrent Operations
1. Start multiple file edits simultaneously
2. Verify lock handles concurrent acquisitions
- [ ] Multiple operations tracked in lock
- [ ] All operations complete
- [ ] No data corruption

### 5.2 Timeout Handling
- [ ] Long operations eventually timeout (default 30s)
- [ ] Timeout releases lock gracefully
- [ ] Warning logged

### 5.3 Error Recovery
1. Simulate parsing error (malformed file)
- [ ] Error logged
- [ ] Lock released despite error
- [ ] System continues functioning

## Cleanup

After validation:
```bash
# Remove test files
delete_path({ path: "packages/core/src/test-validation-file.ts" })
delete_path({ path: "/tmp/ragforge-test", recursive: true })
```

## Results Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Clean State | | |
| Phase 2: Manual Modification | | |
| Phase 3: Tool Modification | | |
| Phase 4: Orphan Files | | |
| Phase 5: Edge Cases | | |

---

## Related Documentation

- [FILE_PROCESSOR_UNIFICATION.md](./FILE_PROCESSOR_UNIFICATION.md)
- [REFERENCE_EXTRACTION_AND_STATE_MACHINE.md](./REFERENCE_EXTRACTION_AND_STATE_MACHINE.md)
