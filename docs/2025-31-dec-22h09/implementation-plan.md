# Plan d'Implémentation - Relations de Code

**Date**: 31 décembre 2025  
**Objectif**: Améliorer l'extraction des relations dans `analyze_files` et l'ingestion BDD

---

## Ordre d'Implémentation

### 1. IMPLEMENTS distinct dans analyze_files ⏱️ 5min
**Fichier**: `packages/core/src/tools/brain-tools.ts`  
**Ligne**: ~3112-3122  
**Changement**: Utiliser `clause.clause` pour distinguer extends/implements

```typescript
// AVANT
relationships.push({
  type: 'INHERITS_FROM',
  target: typeName,
});

// APRÈS
relationships.push({
  type: clause.clause === 'implements' ? 'IMPLEMENTS' : 'INHERITS_FROM',
  target: typeName,
});
```

**Test**: `analyze_files` sur une classe qui implémente une interface

---

### 2. DECORATED_BY dans analyze_files ⏱️ 10min
**Fichier**: `packages/core/src/tools/brain-tools.ts`  
**Après**: Section INHERITS_FROM (~ligne 3123)

```typescript
// Extract DECORATED_BY from decoratorDetails
if (tsSpecific?.decoratorDetails) {
  for (const decorator of tsSpecific.decoratorDetails) {
    relationships.push({
      type: 'DECORATED_BY',
      target: decorator.name,
    });
  }
}
```

**Aussi**: Ajouter `'DECORATED_BY'` au type `ScopeRelationship` (ligne ~2944)

**Test**: `analyze_files` sur une classe avec décorateurs

---

### 3. DECORATED_BY dans ingestion BDD ⏱️ 15min
**Fichier**: `packages/core/src/runtime/adapters/code-source-adapter.ts`  
**Après**: Section heritage clauses (~ligne 1360)

```typescript
// Create DECORATED_BY relationships from decoratorDetails
if (tsMetadata?.decoratorDetails && tsMetadata.decoratorDetails.length > 0) {
  for (const decorator of tsMetadata.decoratorDetails) {
    // Try to find decorator in local scopes
    let decoratorUuid: string | undefined;
    
    // Check in same file first
    for (const s of analysis.scopes) {
      if (s.name === decorator.name) {
        decoratorUuid = this.generateUUID(s, filePath);
        break;
      }
    }
    
    // Check in other files
    if (!decoratorUuid) {
      for (const [otherPath, otherAnalysis] of codeFiles) {
        if (otherPath === filePath) continue;
        for (const s of otherAnalysis.scopes) {
          if (s.name === decorator.name) {
            decoratorUuid = this.generateUUID(s, otherPath);
            break;
          }
        }
        if (decoratorUuid) break;
      }
    }
    
    if (decoratorUuid) {
      relationships.push({
        type: 'DECORATED_BY',
        from: sourceUuid,
        to: decoratorUuid
      });
    }
    // TODO: Si pas trouvé localement, créer relation vers ExternalLibrary?
  }
}
```

**Test**: Ingérer un projet avec décorateurs, vérifier dans Neo4j

---

### 4. Références sans appel (new Class) ⏱️ 15min
**Fichier**: `packages/core/src/tools/brain-tools.ts`  
**Ligne**: ~3550 (cross-file CONSUMES)

```typescript
// AVANT - seulement appels de fonction
const callPattern = new RegExp(`\\b${symbol}\\s*(<[^>]*>)?\\s*\\(`, 'g');
if (callPattern.test(scopeSource)) {

// APRÈS - appels + new + usage simple
const patterns = [
  new RegExp(`\\b${symbol}\\s*(<[^>]*>)?\\s*\\(`),      // Appel: fn() ou fn<T>()
  new RegExp(`\\bnew\\s+${symbol}\\s*(<[^>]*>)?\\s*\\(`), // new Class() ou new Class<T>()
];

const isUsed = patterns.some(p => p.test(scopeSource));
if (isUsed) {
```

**Test**: `analyze_files` sur du code avec `new ImportedClass()`

---

### 5. Références sans appel dans ingestion ⏱️ 20min
**Fichier**: `packages/core/src/runtime/adapters/code-source-adapter.ts`  
**Méthode**: Améliorer la détection dans la boucle identifierReferences

Similaire à #4, mais dans le contexte de l'adapter.

---

### 6. (Futur) USES_TYPE ⏱️ 1h+
**Complexité**: Haute  
**Fichiers**: 
- `codeparsers/.../ScopeExtractionParser.ts` - extraire types des signatures
- `brain-tools.ts` - créer relations
- `code-source-adapter.ts` - créer relations

**À planifier séparément**

---

## Checklist

- [x] 1. IMPLEMENTS dans analyze_files ✅
- [x] 2. DECORATED_BY dans analyze_files ✅
- [x] 3. DECORATED_BY dans ingestion ✅
- [x] 4. new Class() dans analyze_files ✅
- [x] 5. new Class() dans ingestion (déjà géré par le parseur AST) ✅
- [ ] 6. USES_TYPE (futur)

---

## Tests de Validation

### Fichier de test suggéré
```typescript
// test-relationships.ts
import { Injectable } from '@nestjs/common';
import { BaseService, ILogger } from './base';

@Injectable()
@Deprecated()
class MyService extends BaseService implements ILogger {
  private instance = new SomeClass();
  
  constructor() {
    super();
    const x = SOME_CONSTANT;
  }
}
```

### Vérifications
1. `analyze_files` montre:
   - `INHERITS_FROM BaseService`
   - `IMPLEMENTS ILogger`
   - `DECORATED_BY Injectable`
   - `DECORATED_BY Deprecated`
   - `CONSUMES SomeClass` (via new)
   - `CONSUMES SOME_CONSTANT`

2. Après ingestion, query Neo4j:
   ```cypher
   MATCH (s:Scope {name: 'MyService'})-[r]->(t)
   RETURN type(r), t.name
   ```
