# RagForge Vision - 4 Décembre 2024

> De "search & read" vers "understand, analyze & transform"

## La Big Picture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RAGFORGE AGENT                                     │
│                                                                             │
│   Question → Discover → Search → Read → Analyze → Transform → Answer        │
│                                                                             │
│   "What does X do?"     →  READ MODE   →  Precise answer                   │
│   "Find security bugs"  →  ANALYZE MODE →  List of issues + locations      │
│   "Add types to module" →  EDIT MODE   →  Modified files + PR              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Showcase Project: Analyser LangChain.js

**Pourquoi langchainjs?**
- Gros projet TypeScript réel (~500+ fichiers)
- Concurrent indirect - le flex ultime
- Bien documenté = facile de vérifier nos réponses
- Structure complexe (monorepo, packages multiples)
- Path: `/home/luciedefraiteur/LR_CodeRag/ragforge/langchainjs`

**Demo narrative:**
> "Regardez RagForge analyser LangChain.js en 5 minutes et répondre à des questions
> que même leur doc ne couvre pas clairement"

---

## Phase 1: READ MODE (En cours) ✅

Ce qu'on a:
- `get_schema` - découverte
- `semantic_search` - trouver
- `get_entities_by_ids` + `with_children` - lire en profondeur
- `explore_relationships` - naviguer le graphe

**Status:** Fonctionne! L'agent répond avec "high confidence" sur du code réel.

---

## Phase 2: ANALYZE MODE (Prochaine)

### 2.1 Tool: `batch_analyze`

Expose `StructuredLLMExecutor.executeLLMBatch` à l'agent.

```typescript
batch_analyze({
  items: [...entities from get_entities_by_ids],
  prompt: "For each function, identify: purpose, complexity (1-10), potential bugs",
  output_fields: {
    purpose: "One sentence description",
    complexity: "Score 1-10",
    potential_bugs: "List of potential issues"
  }
})
```

**Use cases:**
- "Find all functions that might have SQL injection"
- "Rate complexity of all methods in AuthService"
- "Summarize what each module does"

### 2.2 Tool: `aggregate_analysis`

Combine batch results into insights.

```typescript
aggregate_analysis({
  analyses: [...results from batch_analyze],
  question: "Which modules are most complex and why?",
  output: {
    summary: "string",
    top_items: "array",
    recommendations: "array"
  }
})
```

### 2.3 Predefined Analysis Patterns

Config-driven analysis templates:

```yaml
analysis_patterns:
  security_audit:
    prompt: "Check for: SQL injection, XSS, command injection, hardcoded secrets"
    severity_levels: [critical, high, medium, low]

  dead_code:
    prompt: "Is this code reachable? Check for: unused exports, unreachable branches"

  api_surface:
    prompt: "Extract: exported functions, parameters, return types, deprecations"
```

Agent peut appeler: `run_analysis({ pattern: 'security_audit', scope: 'src/auth/**' })`

---

## Phase 3: EDIT MODE (Future)

### 3.1 Architecture: Edit Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   ANALYZE    │ ──▶ │    PLAN      │ ──▶ │   EXECUTE    │ ──▶ │   VERIFY     │
│              │     │              │     │              │     │              │
│ Find what to │     │ Generate     │     │ Apply edits  │     │ Run tests    │
│ change       │     │ edit plan    │     │ to files     │     │ Type check   │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
```

### 3.2 Tool: `plan_edits`

```typescript
plan_edits({
  scope: "src/services/*.ts",
  task: "Add JSDoc comments to all exported functions",
  constraints: {
    max_files: 10,
    require_review: true
  }
})

// Returns:
{
  edit_plan: [
    { file: "src/services/auth.ts", edits: [...], reason: "..." },
    { file: "src/services/user.ts", edits: [...], reason: "..." }
  ],
  estimated_changes: 45,
  risk_level: "low"
}
```

### 3.3 Tool: `batch_edit`

```typescript
batch_edit({
  plan_id: "...",  // From plan_edits
  dry_run: false,
  create_branch: "feature/add-jsdoc"
})

// Returns:
{
  files_modified: 8,
  branch: "feature/add-jsdoc",
  commit: "abc123",
  pr_url: "https://..."  // If configured
}
```

### 3.4 Edit Patterns (Config-driven)

```yaml
edit_patterns:
  add_types:
    analyze: "Find parameters and return values without types"
    transform: "Infer types from usage and add annotations"
    verify: ["tsc --noEmit"]

  modernize_imports:
    analyze: "Find require() calls"
    transform: "Convert to ES6 imports"
    verify: ["npm run build"]

  add_error_handling:
    analyze: "Find async functions without try/catch"
    transform: "Wrap in try/catch with appropriate error types"
    verify: ["npm test"]
```

### 3.5 Safety: Edit Constraints

```yaml
edit_safety:
  require_git_clean: true
  auto_branch: true
  max_files_per_batch: 20
  require_verification: true
  rollback_on_failure: true

  protected_patterns:
    - "*.config.*"
    - "package.json"
    - ".env*"
```

---

## Phase 4: MULTI-REPO MODE (Vision)

### 4.1 Cross-Project Analysis

```typescript
// Index multiple projects
const projects = {
  'langchainjs': '/path/to/langchainjs',
  'ragforge': '/path/to/ragforge',
  'my-app': '/path/to/my-app'
};

// Query across all
agent.ask("How does my-app use langchainjs differently than ragforge?")
```

### 4.2 Dependency Analysis

```typescript
analyze_dependencies({
  project: 'my-app',
  focus: 'langchainjs',
  questions: [
    "Which langchainjs APIs do we use most?",
    "Are we using deprecated APIs?",
    "What's our upgrade path to v0.3?"
  ]
})
```

### 4.3 Migration Assistant

```typescript
plan_migration({
  from: { package: 'langchainjs', version: '0.1' },
  to: { package: 'langchainjs', version: '0.3' },
  scope: 'my-app'
})

// Returns migration plan with:
// - Breaking changes affecting us
// - Required code modifications
// - Risk assessment
// - Suggested order of changes
```

---

## Showcase Demos pour LangChain.js

### Demo 1: "Understand the Architecture"
```
Q: "Explain how LangChain.js chains work internally"
→ Agent discovers schema, finds Chain classes, reads implementations, explains
```

### Demo 2: "Security Audit"
```
Q: "Find potential security issues in langchainjs"
→ batch_analyze on all files, aggregate findings, report with locations
```

### Demo 3: "API Documentation Generator"
```
Q: "Generate API docs for the memory module"
→ Find all exports, analyze signatures, generate markdown
```

### Demo 4: "Refactoring Suggestions"
```
Q: "Find code duplication in langchainjs/langchain-core"
→ Analyze patterns, find similar code blocks, suggest extractions
```

### Demo 5: "The Flex Demo"
```
Q: "Compare how RagForge and LangChain approach tool calling"
→ Cross-analyze both codebases, produce comparison report
```

---

## Implementation Roadmap

### Sprint 1: Batch Analysis (1-2 jours)
- [ ] Indexer langchainjs avec TypeScript adapter
- [ ] Créer tool `batch_analyze` (wrapper StructuredLLMExecutor)
- [ ] Tester sur langchainjs: "summarize all chain implementations"

### Sprint 2: Analysis Patterns (2-3 jours)
- [ ] Config `analysis_patterns` dans ragforge.config.yaml
- [ ] Tool `run_analysis` avec patterns prédéfinis
- [ ] Demo: security audit sur langchainjs

### Sprint 3: Edit Foundation (3-4 jours)
- [ ] Tool `plan_edits` - génère plan sans exécuter
- [ ] Tool `preview_edit` - montre diff avant apply
- [ ] Safety constraints dans config
- [ ] Dry-run mode obligatoire au début

### Sprint 4: Batch Edit (2-3 jours)
- [ ] Tool `batch_edit` - applique plan
- [ ] Git integration (branch, commit)
- [ ] Verification hooks (tsc, tests)
- [ ] Rollback automatique si échec

### Sprint 5: Showcase (2-3 jours)
- [ ] Script de demo complet
- [ ] Screenshots / recordings
- [ ] Blog post ou README showcase
- [ ] Metrics: temps, précision, tokens

---

## Questions Ouvertes

### 1. Edit Safety
Comment gérer les edits qui cassent le build?
- Option A: Toujours dry-run d'abord, human approval
- Option B: Auto-rollback + rapport d'erreur
- Option C: Sandbox (copie du projet, test, puis merge)

### 2. LLM pour edits
Quel modèle pour les transformations de code?
- Gemini 2.0 Flash: rapide, bon pour batch
- Claude: meilleur raisonnement, plus cher
- Hybride: Gemini pour analyse, Claude pour edits critiques

### 3. Granularité des edits
Jusqu'où aller?
- Niveau fichier (remplacer tout le fichier)
- Niveau fonction (edit chirurgical)
- Niveau ligne (comme un diff)

**Recommandation:** Commencer niveau fonction, plus safe.

### 4. Versioning des analyses
Garder l'historique des analyses?
- Permet de comparer "avant/après refactoring"
- Tracking de la dette technique over time
- Storage: Neo4j ou fichiers JSON?

---

## Métriques de Succès

| Métrique | Target Phase 2 | Target Phase 3 |
|----------|----------------|----------------|
| Questions/min (read) | 10+ | 10+ |
| Analyses/min (batch) | 50+ items | 50+ items |
| Edit accuracy | N/A | 90%+ (no broken builds) |
| Rollback rate | N/A | <5% |
| Token efficiency | -30% vs naive | -50% vs naive |

---

## Projet Test: Setup LangChain.js

**LangChain.js est déjà cloné:** `/home/luciedefraiteur/LR_CodeRag/ragforge/langchainjs` (1901 fichiers TypeScript)

```bash
# 1. Créer un dossier VIDE pour le workspace RagForge
mkdir ~/langchainjs-analysis
cd ~/langchainjs-analysis

# 2. Lancer quickstart en pointant vers langchainjs
ragforge quickstart --root /home/luciedefraiteur/LR_CodeRag/ragforge/langchainjs --dev

# Le CLI va automatiquement:
# ✓ Détecter TypeScript (package.json + tsconfig.json)
# ✓ Créer ragforge.config.yaml avec patterns monorepo (**/src/**/*.ts)
# ✓ Lancer Neo4j via Docker Compose
# ✓ Parser les 1901 fichiers TypeScript
# ✓ Créer indexes vectoriels
# ✓ Générer embeddings (si GEMINI_API_KEY présent)

# 3. Tester avec l'agent
cd generated/langchainjs-rag
npm run query
# Q: "What chain implementations exist in langchainjs?"
```

**Temps estimé:** ~5-10 min pour parser + embeddings

---

## TODO Technique

### Mise à jour du modèle d'embedding (urgent)

**`text-embedding-004` sera deprecated le 14 janvier 2026**

Migrer vers **`gemini-embedding-001`**:
- 3072 dimensions (vs 768 actuellement)
- 2048 tokens max input
- 100+ langues supportées
- Support Matryoshka (dimensions réduites: 3072, 1536, ou 768)

**Action requise:**
1. Mettre à jour `packages/runtime/src/embeddings/` pour utiliser `gemini-embedding-001`
2. Option de config pour choisir les dimensions (768 pour compat, 3072 pour qualité)
3. Re-générer les embeddings existants (ou garder compat 768)

Sources:
- [Gemini Embedding announcement](https://developers.googleblog.com/en/gemini-embedding-available-gemini-api/)
- [Deprecation discussion](https://discuss.ai.google.dev/t/what-is-the-retirement-date-for-text-embedding-004-model/107445)

---

*Vision créée: 4 décembre 2024*
*Status: Planning*
*Next: Sprint 1 - Indexer langchainjs, implémenter batch_analyze*
