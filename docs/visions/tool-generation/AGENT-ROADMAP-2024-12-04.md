# Agent Roadmap - 4 Décembre 2024 (12h28)

> Suite de HYBRID-AGENT-SYSTEM.md - Ce qui fonctionne, ce qui reste à faire, optimisations proposées

## Ce qui fonctionne maintenant

### Outils implémentés

| Outil | Description | Status |
|-------|-------------|--------|
| `get_schema` | Découverte du schéma (entités, relations, indexes) | ✅ |
| `describe_entity` | Détails d'une entité spécifique | ✅ |
| `semantic_search` | Recherche vectorielle, retourne snippets | ✅ |
| `get_entities_by_ids` | Fetch complet avec `with_children` option | ✅ |
| `query_entities` | Filtres structurés (WHERE, IN, CONTAINS, etc.) | ✅ |
| `explore_relationships` | Traversée de graphe | ✅ |

### Configuration supportée

```yaml
entities:
  - name: Scope
    unique_field: uuid
    display_name_field: name
    query_field: name
    content_field: source              # ← NEW: champ contenu complet
    hierarchical_content:              # ← NEW: config hiérarchique
      children_relationship: HAS_PARENT
      include_children: true
```

### Workflow qui fonctionne

```
Question: "What is the purpose of StructuredLLMExecutor?"

1. get_schema()
   → L'agent apprend: content_field=source, hierarchical_content configuré

2. semantic_search({ query: "StructuredLLMExecutor", top_k: 5 })
   → Résultat: [{uuid, name, snippet}]

3. get_entities_by_ids({ ids: [...], with_children: true })
   → Résultat: classe + 50 méthodes enfants avec source complet

4. Agent répond avec "high" confidence basé sur code lu
```

**Test validé:** L'agent utilise `with_children: true` quand `hierarchical_content` est configuré et répond correctement.

---

## Ce qu'il reste à faire

### 1. Batch LLM Analysis Tool (Priorité haute)

**Problème:** Quand l'agent récupère 50+ méthodes enfants, il doit tout analyser lui-même. Pour de gros contenus, ça peut dépasser le contexte ou être inefficace.

**Ce qui existe déjà:** `StructuredLLMExecutor.executeLLMBatch()` dans `packages/runtime/src/llm/structured-llm-executor.ts`

Cette classe fait déjà tout:
- Batching intelligent avec token budget
- Exécution parallèle
- Parsing XML/JSON/YAML
- Output schema structuré
- Support tool calling intégré

**Solution:** Créer un tool `batch_analyze` qui expose `executeLLMBatch` à l'agent

```typescript
// Tool definition dans tool-generator.ts
{
  name: 'batch_analyze',
  description: 'Run LLM analysis on multiple items in parallel. Use when you have many items to analyze.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Items to analyze (each must have id + content fields)'
      },
      prompt: {
        type: 'string',
        description: 'What to extract/analyze from each item'
      },
      output_fields: {
        type: 'object',
        description: 'Fields to extract: { fieldName: "description" }'
      }
    },
    required: ['items', 'prompt', 'output_fields']
  }
}

// Handler - juste un wrapper autour de StructuredLLMExecutor
async function handleBatchAnalyze(args, context) {
  const executor = new StructuredLLMExecutor();

  // Convertir output_fields en OutputSchema
  const outputSchema = Object.fromEntries(
    Object.entries(args.output_fields).map(([name, desc]) => [
      name,
      { type: 'string', description: desc, required: true }
    ])
  );

  return executor.executeLLMBatch(args.items, {
    inputFields: ['id', 'content'],
    userTask: args.prompt,
    outputSchema,
  });
}
```

**Effort estimé:** ~50 lignes de code (wrapper simple)

### 2. Outils composés (streamlined)

**Idée de HYBRID-AGENT-SYSTEM.md:** Combiner plusieurs étapes en un seul appel.

#### Option A: `search_and_analyze`

```typescript
search_and_analyze({
  entity_type: 'Scope',
  query: 'authentication logic',
  top_k: 5,
  include_children: true,
  analysis_prompt: 'Extract main purpose and dependencies',
  output_schema: {
    purpose: 'string',
    dependencies: 'string[]'
  }
})
```

Fait en interne:
1. semantic_search
2. get_entities_by_ids (with_children si demandé)
3. batch LLM analysis

#### Option B: `search_and_fetch`

Plus simple - pas d'analysis LLM:

```typescript
search_and_fetch({
  entity_type: 'Scope',
  query: 'authentication',
  top_k: 5,
  include_children: true
})
// → semantic_search + get_entities_by_ids en un appel
```

**Recommandation:** Commencer par Option B (plus simple), ajouter Option A ensuite.

### 3. Optimisation: Caching du schéma

L'agent appelle `get_schema()` à chaque question. Le schéma ne change jamais pendant une session.

**Options:**
1. Cache côté agent (in-memory)
2. Cache côté tool (memoization)
3. Inclure schéma dans system prompt (mais plus de tokens)

**Recommandation:** Option 2 - memoization dans le handler de `get_schema`.

### 4. Limite de contenu / Chunking

**Problème potentiel:** Si une méthode fait 10k lignes, `with_children` peut retourner énormément de données.

**Solutions possibles:**
1. Tronquer à N caractères avec indication `[truncated]`
2. Retourner seulement les N premiers enfants avec count total
3. Pagination: `get_entities_by_ids({ ..., offset: 10, limit: 10 })`

**Recommandation:** Option 2 - limiter + indiquer combien restent.

### 5. Agent Prompts (Phase 4 originale)

Améliorer les descriptions d'outils et le system prompt:

- Exemples dans chaque description d'outil
- Tips contextuels ("si content est court, essayez with_children")
- Workflow suggéré dans system prompt

---

## Nouvelle Roadmap

### Phase 1: Stabilisation (fait) ✅
- [x] get_schema avec content_field
- [x] get_entities_by_ids avec with_children
- [x] hierarchical_content config
- [x] Test validé sur StructuredLLMExecutor

### Phase 2: Batch Analysis (prochaine)
- [ ] Implémenter `batch_analyze` tool
- [ ] Définir output_schema flexible
- [ ] Test avec 50+ méthodes enfants
- [ ] Mesurer réduction tokens/latence

### Phase 3: Outils composés
- [ ] `search_and_fetch` (semantic_search + get_entities_by_ids)
- [ ] Option include_children dans search_and_fetch
- [ ] `search_and_analyze` (ajoute batch LLM)

### Phase 4: Optimisations
- [ ] Caching get_schema
- [ ] Limite/pagination pour gros contenus
- [ ] Amélioration descriptions outils

### Phase 5: Documentation & Tests
- [ ] Mettre à jour README avec nouveaux outils
- [ ] Tests automatisés pour chaque outil
- [ ] Exemples de config pour différents domaines

---

## Questions de design ouvertes

### 1. Où exécuter le batch LLM?

**Option A:** Dans le tool handler (côté serveur ragforge)
- Pros: L'agent voit juste le résultat analysé
- Cons: Dépendance à une API LLM côté serveur

**Option B:** L'agent gère lui-même le batching
- Pros: Flexibilité totale
- Cons: Plus de tokens, plus d'appels

**Recommandation:** Option A pour les gros volumes, Option B pour cas simples.

### 2. Comment structurer output_schema?

JSON Schema complet? Version simplifiée?

```typescript
// Simplifié (recommandé pour commencer)
output_schema: {
  purpose: 'string',
  complexity: 'number',
  tags: 'string[]'
}

// JSON Schema complet (plus tard)
output_schema: {
  type: 'object',
  properties: {
    purpose: { type: 'string' },
    complexity: { type: 'number', minimum: 1, maximum: 10 }
  }
}
```

### 3. Fallback quand hierarchical_content n'est pas configuré?

L'agent devrait-il toujours tenter d'explorer les relations même sans config?

**Proposition:** Non - si pas configuré, l'agent assume que content_field suffit. Évite les explorations inutiles.

---

## Métriques à suivre

Pour évaluer les optimisations:

1. **Nombre d'appels outils** par question
2. **Tokens consommés** par question
3. **Latence totale** (temps de réponse)
4. **Qualité des réponses** (confidence score)
5. **Taux de "likely/probably"** vs réponses concrètes

---

*Créé: 4 décembre 2024, 12h28*
*Basé sur: HYBRID-AGENT-SYSTEM.md*
*Status: Planification Phase 2*
