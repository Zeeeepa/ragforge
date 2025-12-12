# Debugging Agent Context - Issues & Improvements

## Date: 2025-12-12

## Context

Testing the `debug_context` tool to verify the initial context enrichment for the agent. The goal is to ensure the agent receives relevant code context based on user queries.

---

## Issues Identified

### 1. Semantic Search Not Triggered

**Symptom:** The `debug_context` results show only fuzzy search results, no semantic search results.

**Test Query:** `"je me rappelle plus ou on en était sur les tests, quels outils de debug sont dispo déja?"`

**Expected:** Should find `debug-tools.ts`, `DebugToolsContext`, debug tool implementations.

**Actual:** Found 117 fuzzy matches on the word "test" in random test files.

**Possible Causes:**
- Conversation is empty (no conversation context to enrich)
- Embedding/Ingestion locks not available
- Project not recognized as "known" project
- `searchCodeSemantic` conditions not met (cwd vs projectRoot check)

**Location:** `packages/core/src/runtime/conversation/storage.ts` - `buildEnrichedContext()` method

---

### 2. Fuzzy Search Agent Prompt Issues

**Symptom:** The LLM-guided fuzzy search finds superficial keyword matches instead of semantically relevant code.

**Problem:** The prompt tells the agent to search for text patterns, but:
- It uses a single query string instead of extracted keywords
- The agent matches on common words like "test" appearing anywhere
- Results are single-line matches (e.g., `Line 18 (matched: Test)`)

**Current Behavior:**
```
[test-extract-prompt.mjs:18-18] Line 18 (matched: Test) (Relevance: 80%)
[test-documents/test-tika.ts:7-7] Line 7 (matched: Test) (Relevance: 80%)
```

**Expected Behavior:** Should extract meaningful keywords and search for code structures, not random occurrences of common words.

**Location:** `packages/core/src/runtime/conversation/storage.ts` - `searchCodeFuzzyWithLLM()` method

---

### 3. Fuzzy Search Tool Should Accept Multiple Keywords

**Current:** `search_files` takes a single `query` string parameter.

**Proposed:** Should accept an array of keywords with options:
```typescript
{
  keywords: string[];        // ["debug", "tools", "context"]
  match_mode: "all" | "any"; // Require all keywords or any
  proximity?: number;        // Keywords within N lines of each other
}
```

**Benefits:**
- More precise matches
- Avoids matching on common words in isolation
- Better for multi-concept queries like "debug tools for conversation"

---

### 4. Low Confidence Scores

**Symptom:** All results have `confidence: 0.3` (30%) which is the minimum threshold.

**Problem:** The confidence scoring doesn't differentiate between:
- Exact semantic matches
- Fuzzy keyword matches
- Random occurrences

**Impact:** Can't prioritize truly relevant results over noise.

---

## Proposed Fixes

### Fix 1: Ensure Semantic Search Activation

- [ ] Log when semantic search is skipped and why
- [ ] Check lock availability before `buildEnrichedContext`
- [ ] Add fallback when project is not "known" but cwd is valid

### Fix 2: Improve Fuzzy Search Agent Prompt

- [ ] Extract meaningful keywords from user query before searching
- [ ] Filter out common words ("test", "the", "is", etc.)
- [ ] Search for code structures (function names, class names) not just text
- [ ] Require multiple keyword matches for relevance

### Fix 3: Multi-Keyword Fuzzy Search

- [ ] Update `search_files` tool to accept `keywords: string[]`
- [ ] Add `match_mode` parameter ("all" | "any")
- [ ] Add proximity matching option
- [ ] Update agent prompt to use keyword extraction

### Fix 4: Better Confidence Scoring

- [ ] Differentiate semantic vs fuzzy match confidence
- [ ] Higher confidence for multi-keyword matches
- [ ] Lower confidence for single common word matches
- [ ] Factor in code structure type (function > variable > comment)

---

## Test Cases to Validate Fixes

1. **Query:** "debug tools for conversation"
   - **Expected:** `debug-tools.ts`, `DebugToolsContext`, `generateDebugContextHandler`

2. **Query:** "embedding service chunking"
   - **Expected:** `embedding-service.ts`, `chunkText`, `CHUNKING_THRESHOLD`

3. **Query:** "how does the watcher detect file changes"
   - **Expected:** `file-watcher.ts`, `IngestionQueue`, chokidar usage

4. **Query:** "conversation memory summarization"
   - **Expected:** `summarizer.ts`, `ConversationSummarizer`, L1/L2 summary logic

---

## Debug Tools Available

For reference, these are the debug tools that should be found:

| Tool | Purpose |
|------|---------|
| `debug_context` | Inspect enriched context for a query |
| `debug_conversation_search` | Test semantic search on conversation history |
| `debug_inject_turn` | Inject test turns into a conversation |
| `debug_list_summaries` | List L1/L2 summaries for a conversation |
| `debug_message` | Inspect a specific message and metadata |

---

## Related Files

- `packages/core/src/tools/debug-tools.ts` - Debug tool definitions and handlers
- `packages/core/src/runtime/conversation/storage.ts` - Context enrichment logic
- `packages/core/src/runtime/conversation/cwd-file-cache.ts` - Directory type detection
