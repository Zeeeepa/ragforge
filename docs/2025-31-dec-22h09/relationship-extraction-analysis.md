# Analyse des Relations de Code - État Actuel et Améliorations

**Date**: 31 décembre 2025  
**Contexte**: Amélioration de l'extraction de relations dans `analyze_files` et ingestion

---

## 0. Tableau Récapitulatif

| Relation | `analyze_files` | Ingestion BDD | À faire |
|----------|----------------|---------------|---------|
| **CONSUMES** | ✅ (intra + cross-file) | ✅ | Ajouter refs sans appel `()` |
| **INHERITS_FROM** | ✅ (mais inclut implements) | ✅ | - |
| **IMPLEMENTS** | ❌ (traité comme INHERITS_FROM) | ✅ | Distinguer dans analyze_files |
| **USES_LIBRARY** | ✅ | ✅ | - |
| **DECORATED_BY** | ❌ | ❌ | Créer dans les deux |
| **USES_TYPE** | ❌ | ❌ | Créer dans les deux |

**Fichiers clés :**
- `brain-tools.ts` → `analyze_files` (on-the-fly, pas de BDD)
- `code-source-adapter.ts` → Ingestion (persisté dans Neo4j)

---

## 1. État Actuel

### 1.1 Parseur (`codeparsers/src/scope-extraction/ScopeExtractionParser.ts`)

Le parseur extrait actuellement :

| Donnée | Champ | Description |
|--------|-------|-------------|
| **Identifier References** | `identifierReferences[]` | Identifiants utilisés dans le code avec ligne, colonne, qualifier |
| **Heritage Clauses** | `heritageClauses[]` | Clauses `extends` et `implements` |
| **Decorator Details** | `decoratorDetails[]` | Décorateurs avec nom, arguments, ligne |
| **Imports** | `importReferences[]` | Imports structurés avec source, symboles, isLocal |

### 1.2 Relations Construites (`brain-tools.ts`)

| Relation | Source | Description |
|----------|--------|-------------|
| **CONSUMES** | `identifierReferences` où `kind='local_scope'` | Appels de fonctions locales |
| **CONSUMES** (cross-file) | `extractReferences` + regex appel `symbol(` | Appels de fonctions importées |
| **INHERITS_FROM** | `heritageClauses` (extends + implements) | Héritage de classes/interfaces |
| **USES_LIBRARY** | `importReferences` où `!isLocal` | Usage de librairies externes |

---

## 2. Problèmes Identifiés

### 2.1 IMPLEMENTS traité comme INHERITS_FROM

**Problème**: Les clauses `extends` et `implements` sont toutes deux stockées dans `heritageClauses` avec un champ `clause: 'extends' | 'implements'`, mais lors de la création des relations, les deux sont converties en `INHERITS_FROM`.

**Impact**: On perd la distinction sémantique entre héritage et implémentation d'interface.

**Solution**: Créer deux types de relations distincts :
- `INHERITS_FROM` pour `clause: 'extends'`
- `IMPLEMENTS` pour `clause: 'implements'`

**Fichier à modifier**: `brain-tools.ts:3112-3122`

```typescript
// Actuel
relationships.push({
  type: 'INHERITS_FROM',
  target: typeName,
});

// Proposé
relationships.push({
  type: clause.clause === 'implements' ? 'IMPLEMENTS' : 'INHERITS_FROM',
  target: typeName,
});
```

---

### 2.2 USES_TYPE non extrait

**Problème**: Les types utilisés dans les signatures (paramètres, retours) ne génèrent pas de relations explicites.

**Exemple**:
```typescript
function process(input: MyType): ResultType { }
// MyType et ResultType ne génèrent pas de USES_TYPE
```

**Impact**: On ne voit pas les dépendances de types dans le graphe.

**Solution**: Ajouter extraction des types depuis :
- `returnTypeInfo.type`
- `parameters[].type`
- `genericParameters[].constraint`

**Fichier à modifier**: `ScopeExtractionParser.ts` - méthode `attachSignatureReferences` (lignes 2196+)

Le parseur extrait déjà les types dans les signatures. Il faudrait :
1. Parser les identifiants de types (ex: `Promise<MyType>` → `MyType`)
2. Les ajouter à `identifierReferences` avec un `kind: 'type_reference'`
3. Dans `brain-tools.ts`, créer des relations `USES_TYPE`

---

### 2.3 Références sans appel de fonction

**Problème**: Seuls les appels de fonctions `symbol(` sont détectés pour les relations cross-file. Les références à des constantes/variables ne le sont pas.

**Exemple**:
```typescript
import { SOME_CONSTANT, SomeClass } from './module';

const x = SOME_CONSTANT;           // Non détecté
const instance = new SomeClass();  // Non détecté (pas d'appel avec ())
```

**Impact**: Relations manquantes pour les constantes exportées et instanciations avec `new`.

**Solution**: Dans `brain-tools.ts`, étendre le pattern de détection :

```typescript
// Actuel - uniquement appels de fonction
const callPattern = new RegExp(`\\b${symbol}\\s*(<[^>]*>)?\\s*\\(`, 'g');

// Proposé - ajouter aussi :
// 1. Usage simple de variable/constante
const usagePattern = new RegExp(`\\b${symbol}\\b`, 'g');

// 2. Instanciation avec new
const newPattern = new RegExp(`\\bnew\\s+${symbol}\\s*(<[^>]*>)?\\s*\\(`, 'g');
```

**Attention**: Le pattern `usagePattern` pourrait être trop permissif. Il faut exclure :
- Les déclarations locales (`const ${symbol} =`)
- Les propriétés d'objet (`obj.${symbol}`)

---

### 2.4 Appels de méthodes sur objets

**Problème**: Les appels comme `this.logger.info()` ou `brain.search()` ne créent pas de relations car le symbole `info` ou `search` n'est pas un import direct.

**Exemple**:
```typescript
import { logger } from './logger';

logger.debug('message');  // debug n'est pas importé, donc pas de relation
```

**Impact**: Les méthodes appelées sur des objets importés ne sont pas trackées.

**Solution**: Le parseur extrait déjà le `qualifier` dans `identifierReferences`:

```typescript
{
  identifier: 'debug',
  qualifier: 'logger',  // L'objet sur lequel la méthode est appelée
  line: 42
}
```

Il faudrait :
1. Résoudre le `qualifier` vers son import
2. Créer une relation `CONSUMES` vers `logger.debug` ou au minimum vers le module `logger`

**Fichiers à modifier**:
- `ScopeExtractionParser.ts`: S'assurer que `qualifier` est bien extrait (déjà fait, lignes 1821-1830)
- `brain-tools.ts`: Utiliser le `qualifier` pour enrichir les relations

---

### 2.5 DECORATED_BY non créé

**Problème**: Les décorateurs sont extraits (`decoratorDetails`) mais aucune relation n'est créée.

**Exemple**:
```typescript
@Injectable()
class MyService { }
// decoratorDetails = [{ name: 'Injectable', arguments: '', line: 1 }]
// Mais pas de relation DECORATED_BY Injectable
```

**Solution**: Ajouter dans `extractScopeRelationships`:

```typescript
// Extract DECORATED_BY from decoratorDetails
if (scope.languageSpecific?.typescript?.decoratorDetails) {
  for (const decorator of scope.languageSpecific.typescript.decoratorDetails) {
    relationships.push({
      type: 'DECORATED_BY',
      target: decorator.name,
    });
  }
}
```

---

## 3. Résumé des Modifications

| Amélioration | Priorité | Fichier(s) | Complexité |
|--------------|----------|------------|------------|
| **IMPLEMENTS distinct** | Haute | `brain-tools.ts` | Faible |
| **Références sans appel** | Haute | `brain-tools.ts` | Moyenne |
| **Instanciation avec new** | Haute | `brain-tools.ts` | Faible |
| **DECORATED_BY** | Moyenne | `brain-tools.ts` | Faible |
| **USES_TYPE** | Moyenne | `ScopeExtractionParser.ts` + `brain-tools.ts` | Moyenne |
| **Méthodes sur objets** | Basse | `brain-tools.ts` | Haute |

---

## 4. Types de Relations Proposés

```typescript
type ScopeRelationship = 
  | 'CONSUMES'       // Appel de fonction/usage de variable
  | 'CONSUMED_BY'    // Inverse (calculé)
  | 'INHERITS_FROM'  // extends (classe/interface)
  | 'IMPLEMENTS'     // implements (interface) - NOUVEAU
  | 'USES_LIBRARY'   // Import de package externe
  | 'USES_TYPE'      // Usage de type dans signature - NOUVEAU
  | 'DECORATED_BY';  // Décorateur appliqué - NOUVEAU
```

---

## 5. Fichiers Clés

### Dans `codeparsers`

| Fichier | Rôle |
|---------|------|
| `src/scope-extraction/types.ts` | Définition de `ScopeInfo`, `HeritageClause`, `DecoratorInfo` |
| `src/scope-extraction/ScopeExtractionParser.ts` | Extraction TS avec tree-sitter |
| `src/scope-extraction/PythonScopeExtractionParser.ts` | Extraction Python |

### Dans `ragforge/packages/core`

| Fichier | Rôle |
|---------|------|
| `src/tools/brain-tools.ts` | Construction des relations pour `analyze_files` |
| `src/brain/reference-extractor.ts` | Extraction des imports (cross-file) |
| `src/brain/reference-linker.ts` | Création des relations Neo4j à l'ingestion |

---

## 6. Détails de l'Implémentation

### 6.1 `code-source-adapter.ts` (Ingestion BDD)

L'adapter crée les relations suivantes pendant l'ingestion :

```typescript
// Lignes 1316-1360 - Heritage clauses
for (const clause of tsMetadata.heritageClauses) {
  for (const typeName of clause.types) {
    const relType = clause.clause === 'extends' ? 'INHERITS_FROM' : 'IMPLEMENTS';
    relationships.push({ type: relType, from: sourceUuid, to: targetUuid });
  }
}

// Lignes 1388-1393 - External libraries
relationships.push({ type: 'USES_LIBRARY', from: sourceUuid, to: libId });

// Lignes 1267-1271 - CONSUMES (identifierReferences)
relationships.push({ type: 'CONSUMES', from: sourceUuid, to: targetUuid });
```

**Manque :**
- `DECORATED_BY` - Les `decoratorDetails` sont stockés en propriété mais aucune relation créée
- `USES_TYPE` - Les types dans les signatures ne génèrent pas de relations

### 6.2 `brain-tools.ts` (analyze_files)

Le handler `analyze_files` construit les relations en mémoire :

```typescript
// extractScopeRelationships() - Lignes 3097-3135
// CONSUMES from identifierReferences
if (ref.kind === 'local_scope') {
  relationships.push({ type: 'CONSUMES', target: ref.targetScope });
}

// INHERITS_FROM from heritageClauses (ne distingue pas IMPLEMENTS!)
for (const clause of heritageClauses) {
  relationships.push({ type: 'INHERITS_FROM', target: typeName });
}

// USES_LIBRARY from imports
if (!imp.isLocal) {
  relationships.push({ type: 'USES_LIBRARY', target: imp.source });
}
```

**Manque :**
- Distinction `IMPLEMENTS` vs `INHERITS_FROM`
- `DECORATED_BY`
- `USES_TYPE`
- Références sans appel `()` (constantes, `new Class()`)

---

## 7. Plan d'Implémentation

### Phase 1 : Quick Wins (analyze_files uniquement)

1. **IMPLEMENTS distinct** dans `brain-tools.ts:3112-3122`
   ```typescript
   // Changer
   type: 'INHERITS_FROM'
   // En
   type: clause.clause === 'implements' ? 'IMPLEMENTS' : 'INHERITS_FROM'
   ```

2. **DECORATED_BY** dans `brain-tools.ts:extractScopeRelationships`
   ```typescript
   if (tsSpecific?.decoratorDetails) {
     for (const decorator of tsSpecific.decoratorDetails) {
       relationships.push({ type: 'DECORATED_BY', target: decorator.name });
     }
   }
   ```

### Phase 2 : Détection améliorée (analyze_files + ingestion)

3. **Références sans appel** dans `brain-tools.ts:3550`
   ```typescript
   // Ajouter pattern pour new Class()
   const newPattern = new RegExp(`\\bnew\\s+${symbol}\\b`);
   // Ajouter pattern pour usage simple
   const usagePattern = new RegExp(`\\b${symbol}\\b(?!\\s*[:\\(])`);
   ```

4. **DECORATED_BY** dans `code-source-adapter.ts` après ligne 1360
   ```typescript
   // Create DECORATED_BY relationships from decoratorDetails
   if (tsMetadata?.decoratorDetails) {
     for (const decorator of tsMetadata.decoratorDetails) {
       // Find decorator scope or create reference
       relationships.push({ type: 'DECORATED_BY', from: sourceUuid, to: decoratorId });
     }
   }
   ```

### Phase 3 : USES_TYPE (plus complexe)

5. Parser les types dans `ScopeExtractionParser.ts:attachSignatureReferences`
6. Créer des `IdentifierReference` avec `kind: 'type_reference'`
7. Ajouter logique dans `brain-tools.ts` et `code-source-adapter.ts`

---

## 8. Cohérence Schéma Neo4j

Le schéma (`get_schema`) définit déjà :
- `(Scope)-[:INHERITS_FROM]->(Scope)`
- `(Scope)-[:IMPLEMENTS]->(Scope)` 
- `(Scope)-[:USES_LIBRARY]->(ExternalLibrary)`

Les nouvelles relations à ajouter au schéma :
- `(Scope)-[:DECORATED_BY]->(Scope|ExternalLibrary)`
- `(Scope)-[:USES_TYPE]->(Scope|ExternalLibrary)`
