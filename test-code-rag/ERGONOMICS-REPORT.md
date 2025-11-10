# Rapport d'Ergonomie - Framework Généré

Test effectué: 2025-11-10

## 🔴 PROBLÈMES CRITIQUES

### 1. `.whereFile()` n'existe pas
**Gravité**: 🔴 BLOQUANT

```javascript
// ❌ ÉCHOUE
await rag.scope()
  .where({ type: 'function' })
  .whereName({ startsWith: 'create' })
  .whereFile({ contains: 'client' })  // ← N'EXISTE PAS
  .execute();
```

**Cause**: Seules certaines méthodes `where*` sont générées. Le champ `file` existe dans `searchable_fields` mais pas de méthode `whereFile()`.

**Solution**: Générer automatiquement `where<Field>()` pour TOUS les `searchable_fields` dans la config.

---

### 2. `.debug()` ne montre pas la query Cypher
**Gravité**: 🔴 URGENT

```javascript
const query = rag.scope().whereName({ startsWith: 'Query' }).limit(5);
console.log(query.debug());
// Output: "Cypher Query: undefined"
```

**Cause**: La query Cypher n'est construite qu'au moment de `execute()`, pas avant.

**Solution**: Appeler `buildCypher()` dans `.debug()` pour construire la query même sans execute().

---

## 🟠 PROBLÈMES MAJEURS

### 3. Pas de `.whereNameIn()` pour batch queries
**Gravité**: 🟠 HIGH

```javascript
// ❌ WORKAROUND: 3 queries séparées
const [a, b, c] = await Promise.all([
  rag.scope().whereName('QueryBuilder').first(),
  rag.scope().whereName('CodeSourceAdapter').first(),
  rag.scope().whereName('LLMReranker').first()
]);

// ✅ DÉSIRÉ: Une seule query
const results = await rag.scope()
  .whereNameIn(['QueryBuilder', 'CodeSourceAdapter', 'LLMReranker'])
  .execute();
```

**Impact**: Performance - 3 roundtrips vers Neo4j au lieu d'1.

**Solution**: Ajouter `.whereNameIn(array)` et `where<Field>In(array)` pour tous les champs.

---

### 4. Pas de navigation inversée
**Gravité**: 🟠 HIGH

```javascript
// ❌ PAS POSSIBLE
const consumers = await rag.scope()
  .whereName('createClient')
  .whoConsumesMe()  // ← N'EXISTE PAS
  .execute();

// Workaround: Query manuelle ou recherche dans l'autre sens
```

**Impact**: Impossibilité de répondre à "qui utilise cette fonction?" facilement.

**Solution**: Générer méthodes inversées pour chaque relationship:
- `.withCONSUMES()` → générer aussi `.whoConsumesMe()` (inverse)
- `.withHAS_PARENT()` → générer aussi `.getChildren()` (inverse)

---

## 🟡 PROBLÈMES MOYENS

### 5. Pas d'aggregations
**Gravité**: 🟡 MEDIUM

```javascript
// ❌ PAS POSSIBLE
const statsByType = await rag.scope()
  .groupBy('type')
  .count()
  .execute();

// ✅ WORKAROUND: Tout récupérer et grouper en mémoire
const all = await rag.scope().execute();
const grouped = {};
all.forEach(r => {
  grouped[r.entity.type] = (grouped[r.entity.type] || 0) + 1;
});
```

**Impact**: Performance - doit tout charger en mémoire. Impossible pour gros datasets.

**Solution**: Ajouter support pour aggregations Cypher:
```javascript
.groupBy('field')
.count()
.sum('field')
.avg('field')
```

---

### 6. Pas de filtres numériques avancés
**Gravité**: 🟡 MEDIUM

```javascript
// ❌ PAS POSSIBLE
const bigFunctions = await rag.scope()
  .where({ linesOfCode: { gt: 50 } })  // ← gt/lt non supportés
  .execute();

// ✅ WORKAROUND: Filter client-side
const all = await rag.scope().execute();
const filtered = all.filter(r => r.entity.linesOfCode > 50);
```

**Impact**: Performance - ne peut pas filtrer dans Neo4j.

**Solution**: Ajouter support pour comparaisons:
```javascript
.where({
  linesOfCode: {
    gt: 50,      // >
    gte: 50,     // >=
    lt: 100,     // <
    lte: 100     // <=
  }
})
```

---

### 7. Pas de méthode chainable pour "enfants du résultat"
**Gravité**: 🟡 MEDIUM

```javascript
// ❌ PAS CHAINABLE
const qbClass = await rag.scope().whereName('QueryBuilder').first();
// Comment trouver ses méthodes maintenant sans refaire une query ?

// ✅ WORKAROUND: Nouvelle query
const methods = await rag.scope()
  .whereParentScope('QueryBuilder')
  .execute();

// 💡 DÉSIRÉ:
const qbWithMethods = await rag.scope()
  .whereName('QueryBuilder')
  .expandChildren()  // ou .withChildren()
  .first();
```

**Impact**: Ergonomie - pas intuitif de devoir faire 2 queries.

**Solution**: Ajouter `.expandChildren()` qui expand automatiquement la relationship HAS_PARENT inverse.

---

## ✅ CE QUI MARCHE BIEN

✅ **`.first()`** - Très pratique, évite `.execute()[0]`
✅ **`.pluck()`** - Évite les `.map(r => r.entity.field)`
✅ **`.count()`** - Simple et direct
✅ **Chaining de `.where()`** - Intuitif et flexible
✅ **`.wherePattern()`** - Pattern matching regex fonctionne
✅ **Patterns module** - Découvrabilité améliorée
✅ **Types générés** - Autocomplete fonctionne
✅ **Accès au source** - Le champ `source` est disponible

---

## 🎯 PRIORITÉS D'IMPLÉMENTATION

### Phase 2 - Quick Wins (1 jour)
1. 🔴 **Fix `.debug()`** - Afficher la query Cypher avant execute()
2. 🔴 **Générer `where<Field>()`** pour TOUS les searchable_fields
3. 🟠 **Ajouter `.whereNameIn()`** - Batch queries

### Phase 3 - Features (2-3 jours)
4. 🟠 **Navigation inversée** - `.whoConsumesMe()`, `.getChildren()`
5. 🟡 **Filtres numériques** - `gt`, `lt`, `gte`, `lte`
6. 🟡 **Aggregations simples** - `.groupBy().count()`

### Phase 4 - Polish (1 semaine)
7. 🟢 **Aggregations avancées** - `.sum()`, `.avg()`, `.min()`, `.max()`
8. 🟢 **`.expandChildren()`** - Expansion chainable
9. 🟢 **Filtres OR composés** - Support pour OR dans `.where()`

---

## 📊 Métriques

- **Scénarios testés**: 10
- **Problèmes critiques**: 2
- **Problèmes majeurs**: 2
- **Problèmes moyens**: 3
- **Fonctionnalités OK**: 8

**Taux de réussite**: 53% des scénarios sans workaround

---

## 💡 Recommandations

1. **Priorité immédiate**: Corriger les 2 problèmes critiques (`.whereFile()` et `.debug()`)
2. **Phase 2**: Implémenter les quick wins pour améliorer l'ergonomie de base
3. **Documentation**: Ajouter des exemples pour les workarounds actuels dans QUICKSTART.md

**Objectif**: Atteindre 80%+ de scénarios sans workaround après Phase 2.
