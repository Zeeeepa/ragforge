# Comparaison : Recherche Native vs Framework RAG

## 🎯 Scenario 1: "Trouve toutes les fonctions qui utilisent EntityContext"

### Avec mes outils natifs (Grep)
```bash
grep -r "EntityContext" --include="*.ts" | grep "function\|class\|const"
```
**Résultat**: 50+ lignes instantanément, code brut visible

### Avec le framework RAG
```javascript
const results = await rag.scope()
  .whereSource({ contains: 'EntityContext' })
  .limit(50)
  .execute();
```
**Résultat**: 5 scopes structurés, mais limité à ce qui est indexé

**❌ Problème**: Pas trouvé tout, seulement les "Scopes" (fonctions/classes), pas les imports, types, etc.

---

## 🎯 Scenario 2: "Trouve le code exact qui instancie LLMReranker"

### Avec Read + Grep
```bash
grep -r "new LLMReranker" --include="*.ts" -B 2 -A 5
```
**Résultat**: Code exact avec contexte (lignes avant/après)

### Avec le framework RAG
```javascript
const results = await rag.scope()
  .whereSource({ contains: 'new LLMReranker' })
  .execute();
```
**Résultat**: Seulement les fonctions/méthodes qui contiennent ça, pas le code exact

**❌ Problème**:
- Je vois pas les lignes exactes
- Je vois pas le contexte immédiat
- Le champ `source` peut être tronqué ou résumé

---

## 🎯 Scenario 3: "Quels fichiers utilisent l'import X ?"

### Avec Glob + Read
```bash
find . -name "*.ts" -exec grep -l "import.*EntityContext" {} \;
```
**Résultat**: Liste de tous les fichiers

### Avec le framework RAG
```javascript
// ❌ Pas possible directement !
// Workaround:
const results = await rag.scope()
  .whereSource({ contains: 'import' })
  .whereSource({ contains: 'EntityContext' })  // ← ne marche pas, écrase le premier
  .execute();
```

**❌ Problème**:
- Pas de filtres AND composés
- Les imports ne sont pas des "Scopes"

---

## 🎯 Scenario 4: "Quelle est la signature exacte de cette fonction ?"

### Avec Read
```javascript
// Je lis directement le fichier, je vois tout
const content = await read('/path/to/file.ts');
```

### Avec le framework RAG
```javascript
const results = await rag.scope()
  .whereName('myFunction')
  .execute();
console.log(results[0].entity.signature);  // ✅ Ça c'est mieux !
```

**✅ Avantage**: Métadonnées structurées (signature, type, file, etc.)

---

## 📊 Ce qui me MANQUE dans le framework

### 1. **Accès au code source brut**
```javascript
// Ce que je voudrais :
const result = await rag.scope().whereName('myFunction').execute();
console.log(result[0].entity.source);  // ← Le code COMPLET, pas résumé
console.log(result[0].entity.sourceLines);  // ← Lignes de début/fin
```

### 2. **Recherche multi-champs avec AND/OR**
```javascript
// Ce que je voudrais :
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

### 3. **Filtres sur les relationships**
```javascript
// Ce que je voudrais :
await rag.scope()
  .where({ hasRelationship: 'CONSUMES', relationshipCount: { gt: 5 } })
  .execute();
```

### 4. **Aggregations**
```javascript
// Ce que je voudrais :
const stats = await rag.scope()
  .groupBy('type')
  .count()
  .execute();
// Résultat: { function: 150, class: 30, method: 200 }
```

### 5. **Recherche dans les commentaires/JSDoc**
```javascript
// Ce que je voudrais :
await rag.scope()
  .whereDocumentation({ contains: 'deprecated' })
  .execute();
```

### 6. **Navigation inversée facile**
```javascript
// Ce que je voudrais :
// "Qui utilise cette fonction ?"
await rag.scope()
  .whereName('myFunction')
  .whoConsumesMe()  // ← Inverse de withConsumes
  .execute();
```

### 7. **Recherche par ligne de code**
```javascript
// Ce que je voudrais :
await rag.scope()
  .whereFile('query-builder.ts')
  .whereLine({ gte: 100, lte: 200 })
  .execute();
```

---

## 🔧 Ce qui était DIFFICILE dans mes scripts custom

### Problème 1: **Découvrabilité des méthodes**
```javascript
// J'ai essayé :
.whereSourceContains('X')  // ❌ n'existe pas
.whereType('class')        // ❌ n'existe pas

// En vrai c'est :
.whereSource({ contains: 'X' })  // ✅
.where({ type: 'class' })        // ✅
```

**Solution**: Documentation inline + Types TypeScript explicites

### Problème 2: **Pas de découverte des champs disponibles**
```javascript
// Je savais pas que "signature" existait
console.log(result.entity.signature);

// Je savais pas que "linesOfCode" existait
console.log(result.entity.linesOfCode);
```

**Solution**: Types générés + Documentation

### Problème 3: **Nomenclature inconsistante**
```javascript
// Pour les relationships :
.whereParentScope('X')      // ← Méthode dédiée
.whereConsumesScope('X')    // ← Méthode dédiée

// Mais pour les champs normaux :
.where({ type: 'X' })       // ← Méthode générique

// Pourquoi pas :
.whereType('X')             // ← Consistant ?
```

**Solution**: Choisir une convention et s'y tenir

### Problème 4: **Pas d'exemples inline**
```javascript
// Ce que je voudrais dans l'autocomplete :
/**
 * Filter by source code content
 * @example
 * .whereSource({ contains: 'EntityContext' })
 * .whereSource({ startsWith: 'import' })
 * .whereSource('exact match')
 */
whereSource(value: string | { contains?: string; startsWith?: string; endsWith?: string }): this
```

---

## 💡 Améliorations DX (Developer Experience)

### 1. **Fichier de "Common Patterns"**
```typescript
// generated/patterns.ts
export const commonPatterns = {
  // Find all functions starting with prefix
  findFunctionsStartingWith: (prefix: string) =>
    client.scope().where({ type: 'function' }).whereName({ startsWith: prefix }),

  // Find all classes with inheritance
  findClassesWithInheritance: () =>
    client.scope().where({ type: 'class' }).withInheritsFrom(1),

  // Find code using a specific import
  findCodeUsing: (importName: string) =>
    client.scope().whereSource({ contains: importName }),

  // Find all public methods of a class
  findPublicMethodsOf: (className: string) =>
    client.scope().whereParentScope(className).where({ type: 'method' })
      .whereSource({ contains: 'public' })
};
```

### 2. **REPL / CLI interactif**
```bash
$ ragforge repl

> search "EntityContext"
Found 5 results...

> filter type=function
Filtered to 3 results...

> show 0
Name: createClient
Type: function
File: index.ts
...

> expand consumes
Found 3 dependencies...
```

### 3. **Types explicites générés**
```typescript
// Au lieu de :
entity: any

// Générer :
entity: {
  name: string;
  type: 'function' | 'class' | 'method' | ...;
  file: string;
  signature?: string;
  source?: string;
  linesOfCode?: number;
  startLine?: number;
  endLine?: number;
  // ... tous les champs disponibles
}
```

### 4. **Méthodes helper intuitives**
```typescript
// Ajouter ces méthodes au QueryBuilder généré :

// .raw() pour passer du Cypher direct
.raw('MATCH (n:Scope) WHERE n.name =~ "create.*" RETURN n')

// .debug() pour voir la query Cypher
.whereName({ startsWith: 'create' }).debug()
// → Outputs: MATCH (n:Scope) WHERE n.name STARTS WITH 'create' ...

// .first() / .single() pour éviter [0]
const result = await rag.scope().whereName('myFunc').first();

// .pluck('field') pour extraire juste un champ
const names = await rag.scope().limit(10).pluck('name');
// → ['func1', 'func2', ...]

// .count() pour compter sans récupérer
const total = await rag.scope().where({ type: 'function' }).count();
```

### 5. **Guide Quick Start généré**
```markdown
// generated/docs/QUICKSTART.md

# Quick Start Guide

## Common Queries

### Find by name
\`\`\`typescript
await rag.scope().whereName('myFunction').execute();
await rag.scope().whereName({ startsWith: 'create' }).execute();
\`\`\`

### Find by content
\`\`\`typescript
await rag.scope().whereSource({ contains: 'EntityContext' }).execute();
\`\`\`

### Semantic search
\`\`\`typescript
await rag.scope().semanticSearchBySource('database query builder').execute();
\`\`\`

### Explore relationships
\`\`\`typescript
await rag.scope().whereName('myFunc').withConsumes(2).execute();
\`\`\`

## Available Fields
- `name`: Function/class/method name
- `type`: 'function' | 'class' | 'method' | ...
- `file`: Relative file path
- `signature`: Function signature
- `source`: Source code
- `linesOfCode`: Number of lines
```

---

## 🎯 Conclusion

**Ce qui est MIEUX avec le framework RAG:**
- ✅ Recherche sémantique (impossible avec grep)
- ✅ Relationships/Graph traversal
- ✅ Métadonnées structurées
- ✅ LLM reranking

**Ce qui est MIEUX avec mes outils natifs:**
- ✅ Vitesse (instantané vs quelques secondes)
- ✅ Flexibilité totale (regex, multi-fichiers, etc.)
- ✅ Accès au code brut complet
- ✅ Pas besoin d'indexation

**L'idéal:** Combiner les deux !
- Framework RAG pour exploration high-level
- Fallback vers code brut quand besoin du détail
