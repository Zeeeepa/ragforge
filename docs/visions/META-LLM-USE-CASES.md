# Meta-LLM Tool - Real Use Cases

Cas pratiques réels où `batch_analyze` nous serait utile **maintenant**.

---

## 1. Documentation Gap Analysis 📚

**Problème**: Beaucoup de fonctions dans `packages/runtime/src/` sans docstrings

**Workflow**:
```typescript
1. search_functions({ missing: 'docstring' })
   → 50+ fonctions sans documentation

2. batch_analyze({
     items: <functions>,
     task: "Generate JSDoc comment for this function based on its code and usage",
     outputSchema: {
       docstring: { type: 'string', description: 'Full JSDoc comment' },
       params_description: { type: 'array', description: 'Each param documented' },
       return_description: { type: 'string' },
       examples: { type: 'array', description: 'Usage examples' }
     }
   })
   → 50 docstrings structurées

3. Generate PR or apply directly
```

**Valeur**:
- Améliore la DX pour les utilisateurs de RagForge
- Base pour auto-générer la documentation
- Identifie les fonctions mal nommées (si doc != comportement)

---

## 2. Impact Analysis Before Refactor 🔍 ⭐

**Problème**: Avant de modifier `StructuredLLMExecutor` ou autre scope central, connaître l'impact

**Workflow**:
```typescript
1. get_dependents("StructuredLLMExecutor")
   → 15 scopes qui l'utilisent

2. batch_analyze({
     items: <dependents>,
     task: "Analyze how this code uses StructuredLLMExecutor. Which methods? What patterns? What would break if signature changes?",
     outputSchema: {
       methods_used: { type: 'array', description: 'Methods called' },
       usage_pattern: { type: 'string', description: 'How it's used' },
       coupling_level: { type: 'string', enum: ['tight','medium','loose'] },
       breaking_change_risk: { type: 'string', enum: ['high','medium','low'] },
       migration_effort: { type: 'string', enum: ['trivial','moderate','significant'] }
     }
   })

3. Decision report:
   - "Safe to refactor: 12 loose coupling"
   - "High risk: 3 tight coupling, need migration plan"
```

**Valeur**:
- Décisions de refacto data-driven
- Anticiper les breaking changes
- Planifier les migrations
- **Brique essentielle pour refacto autonome**

---

## 3. Test Coverage Gap Analysis 🧪

**Problème**: Identifier quelles fonctions manquent de tests

**Workflow**:
```typescript
1. search_functions()
   → Toutes les fonctions

2. batch_analyze({
     items: <functions>,
     task: "Analyze test coverage for this function. Does it have tests? What scenarios are tested? What's missing?",
     outputSchema: {
       has_tests: { type: 'boolean' },
       test_file_path: { type: 'string' },
       tested_scenarios: { type: 'array' },
       missing_scenarios: { type: 'array', description: 'Edge cases not tested' },
       test_priority: { type: 'string', enum: ['critical','high','medium','low'] }
     }
   })

3. Generate test roadmap by priority
```

**Valeur**:
- Roadmap de tests manquants
- Priorisation automatique (critical = fonctions publiques complexes)
- Base pour auto-générer des squelettes de tests

---

## 4. API Usage Patterns Discovery 🔌

**Problème**: Comprendre comment notre API générée est utilisée dans les exemples

**Workflow**:
```typescript
1. search_in_files({ contains: "rag.scope()", path: "examples/" })
   → 12 exemples d'usage

2. batch_analyze({
     items: <examples>,
     task: "Extract the usage pattern. What is this code trying to accomplish? What's the query pattern?",
     outputSchema: {
       intent: { type: 'string', description: 'What user wants to do' },
       pattern_name: { type: 'string', description: 'Name this pattern' },
       query_type: { type: 'string', enum: ['simple','filtered','with_relationships','semantic','aggregated'] },
       common_mistakes: { type: 'array', description: 'Anti-patterns detected' },
       best_practice_score: { type: 'number', description: '1-10' }
     }
   })

3. Documentation:
   - "Top 5 patterns utilisés"
   - "Common mistakes à éviter"
   - Améliorer les exemples
```

**Valeur**:
- Meilleure documentation basée sur l'usage réel
- Identifier les patterns à promouvoir
- Détecter les anti-patterns à documenter

---

## 5. Error Handling Audit ⚠️

**Problème**: Cohérence du error handling dans la codebase

**Workflow**:
```typescript
1. search_functions()
   → Toutes les fonctions

2. batch_analyze({
     items: <functions>,
     task: "Audit error handling in this function. Is it robust? What could fail?",
     outputSchema: {
       has_error_handling: { type: 'boolean' },
       error_handling_type: { type: 'string', enum: ['try-catch','if-error','none'] },
       error_types_handled: { type: 'array' },
       unhandled_edge_cases: { type: 'array' },
       recommendation: { type: 'string' },
       severity: { type: 'string', enum: ['critical','high','medium','low'] }
     }
   })

3. Security/reliability report
```

**Valeur**:
- Identifier les fonctions fragiles
- Améliorer la robustesse
- Prévenir les bugs en production

---

## 6. Code Duplication Detection 🔄

**Problème**: Détecter le code dupliqué pour l'extraire

**Workflow**:
```typescript
1. search_functions()
   → Toutes fonctions

2. batch_analyze({
     items: <functions>,
     task: "Describe what this function does in abstract terms (ignore implementation details)",
     outputSchema: {
       abstract_purpose: { type: 'string' },
       key_operations: { type: 'array' },
       input_output_pattern: { type: 'string' }
     }
   })

3. Group by similar abstract_purpose
4. batch_analyze({
     items: <similar_groups>,
     task: "Are these functions duplicates? Could they share code?",
     outputSchema: {
       is_duplicate: { type: 'boolean' },
       shared_logic: { type: 'string' },
       refactoring_suggestion: { type: 'string' }
     }
   })
```

**Valeur**:
- Réduction de la dette technique
- DRY principle enforcement
- Base pour extraction de fonctions communes

---

## 7. Breaking Change Detection (CI/CD) 🚨

**Problème**: Détecter automatiquement les breaking changes avant release

**Workflow**:
```typescript
1. get_changed_scopes_since_last_release()
   → Scopes modifiés

2. batch_analyze({
     items: <changed_scopes>,
     task: "Compare current signature with previous. Is this a breaking change?",
     outputSchema: {
       is_breaking: { type: 'boolean' },
       change_type: { type: 'string', enum: ['signature','behavior','removal'] },
       affected_users: { type: 'string', enum: ['all','some','internal-only'] },
       migration_guide: { type: 'string' },
       semver_recommendation: { type: 'string', enum: ['major','minor','patch'] }
     }
   })

3. Block PR if breaking without migration guide
```

**Valeur**:
- Automated semver decisions
- Force migration guides
- Protect users from surprise breaks

---

## 🎯 Recommandation: Commencer par #2 (Impact Analysis)

**Pourquoi**:
1. **Besoin immédiat**: On modifie souvent du code, besoin de connaître l'impact
2. **Brique vers la vision**: L'analyse d'impact est essentielle pour la refacto récursive
3. **Démonstration claire**: Résultats actionnables et compréhensibles
4. **Utilisable maintenant**: Pas besoin d'infrastructure supplémentaire

**Premier test concret**:
```
Question: "Si je modifie executeLLMBatch pour ajouter un paramètre, quel est l'impact?"

Résultat attendu:
- Liste des 12 endroits qui l'appellent
- Pour chacun: tight/loose coupling
- Risk assessment
- Recommendation: "Safe si optionnel" ou "Breaking change, voici comment migrer"
```

---

## 🔄 Prochaines étapes

1. ✅ Implémenter `batch_analyze` (fait)
2. 🔄 Vérifier que watch + embeddings auto fonctionne
3. ⏳ Créer Impact Analysis comme premier use case complet
4. ⏳ Stocker les résultats dans Neo4j (nodes RefactoringAnalysis)
5. ⏳ Créer dashboard de visualisation
