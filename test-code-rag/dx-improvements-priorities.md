# Améliorations DX : Priorités

## 🔴 PRIORITÉ HAUTE (Quick Wins)

### 1. **Générer `patterns.ts` avec Common Patterns**
```typescript
// generated/patterns.ts
export const commonPatterns = {
  findFunctionsStartingWith: (prefix: string) =>
    client.scope().where({ type: 'function' }).whereName({ startsWith: prefix }),

  findClassesWithMethods: (className: string) =>
    client.scope().whereParentScope(className),

  findCodeUsing: (importName: string) =>
    client.scope().whereSource({ contains: importName }),
};
```
**Impact**: 🚀🚀🚀 Réduit considérablement la courbe d'apprentissage
**Effort**: 🔧 Moyen (juste génération de code)

---

### 2. **Ajouter méthodes helper au QueryBuilder**
```typescript
// Dans le QueryBuilder généré, ajouter :

/** Get first result or undefined */
async first(): Promise<SearchResult<T> | undefined> {
  const results = await this.limit(1).execute();
  return results[0];
}

/** Extract single field from all results */
async pluck<K extends keyof T>(field: K): Promise<T[K][]> {
  const results = await this.execute();
  return results.map(r => r.entity[field]);
}

/** Count results without fetching them */
async count(): Promise<number> {
  const results = await this.execute();
  return results.length;
}

/** Show generated Cypher query (debug) */
debug(): string {
  return this.buildCypher().cypher;
}
```
**Impact**: 🚀🚀🚀 Rend le code beaucoup plus lisible
**Effort**: 🔧 Facile

---

### 3. **Générer QUICKSTART.md**
Un guide avec les 10 queries les plus courantes, basées sur la config.

**Impact**: 🚀🚀 Onboarding beaucoup plus rapide
**Effort**: 🔧 Facile (template + génération)

---

### 4. **Types TypeScript explicites pour l'entity**
```typescript
// Au lieu de :
SearchResult<any>

// Générer :
interface ScopeEntity {
  name: string;
  type: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type_alias';
  file: string;
  uuid: string;
  signature?: string;
  source?: string;
  linesOfCode?: number;
  startLine?: number;
  endLine?: number;
  // ... tous les champs du schema
}

SearchResult<ScopeEntity>
```
**Impact**: 🚀🚀🚀 Autocomplete parfait, moins d'erreurs
**Effort**: 🔧 Moyen (génération depuis schema)

---

## 🟡 PRIORITÉ MOYENNE (Nice to Have)

### 5. **Méthode `.raw()` pour Cypher direct**
```typescript
const results = await rag.scope()
  .raw('MATCH (n:Scope) WHERE n.name =~ "create.*" RETURN n')
  .execute();
```
**Impact**: 🚀🚀 Flexibilité totale pour cas avancés
**Effort**: 🔧🔧 Moyen

---

### 6. **Filtres AND/OR composés**
```typescript
await rag.scope()
  .where({
    type: 'function',
    OR: [
      { name: { startsWith: 'create' } },
      { name: { startsWith: 'build' } }
    ]
  })
  .execute();
```
**Impact**: 🚀🚀 Queries complexes plus faciles
**Effort**: 🔧🔧🔧 Difficile (refonte du système de filtres)

---

### 7. **Navigation inversée**
```typescript
// "Qui utilise cette fonction ?"
await rag.scope()
  .whereName('myFunc')
  .whoConsumesMe()
  .execute();
```
**Impact**: 🚀🚀 Exploration du graph plus intuitive
**Effort**: 🔧🔧 Moyen (générer méthodes inversées)

---

### 8. **Batch queries**
```typescript
// Au lieu de 3 queries :
const a = await rag.scope().whereName('a').execute();
const b = await rag.scope().whereName('b').execute();
const c = await rag.scope().whereName('c').execute();

// Une seule :
const all = await rag.scope()
  .whereNameIn(['a', 'b', 'c'])
  .execute();
```
**Impact**: 🚀 Performance
**Effort**: 🔧 Facile

---

## 🟢 PRIORITÉ BASSE (Future)

### 9. **Aggregations**
```typescript
const stats = await rag.scope()
  .groupBy('type')
  .count()
  .execute();
// → { function: 150, class: 30 }
```
**Impact**: 🚀 Analytics
**Effort**: 🔧🔧🔧 Difficile

---

### 10. **REPL interactif**
```bash
$ ragforge repl
> search "EntityContext"
> filter type=function
> show 0
```
**Impact**: 🚀 Exploration interactive
**Effort**: 🔧🔧🔧🔧 Très difficile

---

### 11. **Recherche full-text multi-champs**
```typescript
await rag.scope()
  .search('entity context')  // Cherche dans name, signature, source, etc.
  .execute();
```
**Impact**: 🚀 Flexibilité
**Effort**: 🔧🔧 Moyen (nécessite index full-text Neo4j)

---

## 📋 Plan d'implémentation recommandé

### Phase 1: Quick Wins (1-2 jours)
1. ✅ Générer `patterns.ts`
2. ✅ Ajouter helper methods (`.first()`, `.pluck()`, `.count()`, `.debug()`)
3. ✅ Générer `QUICKSTART.md`
4. ✅ Types TypeScript explicites

→ **Impact immédiat sur DX !**

### Phase 2: Nice to Have (3-5 jours)
5. ✅ `.raw()` pour Cypher direct
6. ✅ Navigation inversée (`.whoConsumesMe()`, etc.)
7. ✅ Batch queries (`.whereNameIn()`)

### Phase 3: Advanced (1-2 semaines)
8. ✅ Filtres AND/OR composés
9. ✅ Aggregations
10. ✅ Full-text search

### Phase 4: Tooling (optionnel)
11. ✅ REPL interactif

---

## 🎯 Mesures de succès

**Avant** (état actuel):
- ❌ Il faut lire le code généré pour savoir quelles méthodes existent
- ❌ 5-10 erreurs avant d'avoir une query qui marche
- ❌ Besoin de lire la doc pour chaque query

**Après** (avec améliorations Phase 1):
- ✅ Le QUICKSTART.md suffit pour 80% des cas
- ✅ Autocomplete guide l'utilisateur
- ✅ Patterns communs couvrent les use cases fréquents
- ✅ Types explicites évitent les erreurs

**Objectif**: **Un développeur peut écrire sa première query utile en < 2 minutes**

---

## 💡 Bonus: Documentation inline

Améliorer le JSDoc des méthodes générées :

```typescript
/**
 * Filter by source code content
 *
 * @param value - String to match or pattern object
 *
 * @example Search for exact string
 * ```ts
 * .whereSource('EntityContext')
 * ```
 *
 * @example Search with pattern
 * ```ts
 * .whereSource({ contains: 'EntityContext' })
 * .whereSource({ startsWith: 'import' })
 * .whereSource({ endsWith: '}' })
 * ```
 */
whereSource(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this
```

**Impact**: 🚀🚀 Découvrabilité dans l'IDE
**Effort**: 🔧 Facile (template + génération)
