# 04 - Grep + Neo4j Integration

## Objectif

Quand l'agent fait un `grep_files` avec `analyze: true`:
1. Vérifier si les fichiers matchés sont dans Neo4j (état `schema-ready` ou `embedded`)
2. Si oui → utiliser les relations stockées pour `extract_hierarchy` (rapide)
3. Si non → fallback sur on-the-fly parsing (actuel) + persister en `schema-ready`
4. Queue les fichiers accédés pour embeddings (basse priorité)

## Architecture

```
grep_files --analyze
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Exécuter ripgrep (ou Node.js fallback)                      │
│     → Obtenir liste de matches (file:line)                      │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Pour chaque fichier matché:                                 │
│     Check Neo4j: MATCH (f:File {path: $path})                   │
│                  WHERE f.state IN ['schema-ready', 'embedded']  │
│                  RETURN f                                       │
└─────────────────────────────────────────────────────────────────┘
       │
       ├─── Fichier trouvé (schema-ready/embedded)
       │         │
       │         ▼
       │    ┌─────────────────────────────────────────────────────┐
       │    │  3a. Récupérer scopes et relations depuis Neo4j     │
       │    │      MATCH (f:File)-[:DEFINED_IN]-(s:Scope)         │
       │    │      MATCH (s)-[r:CONSUMES|CONSUMED_BY]->(other)    │
       │    │      RETURN s, r, other                             │
       │    └─────────────────────────────────────────────────────┘
       │
       └─── Fichier NON trouvé
                 │
                 ▼
           ┌─────────────────────────────────────────────────────┐
           │  3b. On-the-fly parsing (actuel)                    │
           │      + Persister dans Neo4j → schema-ready          │
           └─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Formater résultat (markdown avec ASCII tree)                │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Queue fichiers pour embeddings (async, basse priorité)      │
└─────────────────────────────────────────────────────────────────┘
```

## Implémentation

### 1. Vérifier Neo4j avant on-the-fly

```typescript
// packages/core/src/tools/fs-tools.ts

export function generateGrepFilesHandler(ctx: FsToolsContext) {
  return async (params: GrepFilesParams) => {
    const { analyze = false } = params;

    // ... exécuter ripgrep comme avant ...

    if (analyze && matches.length > 0) {
      // Grouper les matches par fichier
      const matchesByFile = groupMatchesByFile(matches);
      const filePaths = [...matchesByFile.keys()];

      // Vérifier quels fichiers sont déjà dans Neo4j
      const neo4jFiles = await checkFilesInNeo4j(ctx.brain, filePaths);

      // Séparer: fichiers indexés vs non-indexés
      const indexedFiles = filePaths.filter(f => neo4jFiles.has(f));
      const nonIndexedFiles = filePaths.filter(f => !neo4jFiles.has(f));

      let analysisResult: AnalysisResult;

      if (indexedFiles.length > 0) {
        // Récupérer les infos depuis Neo4j (rapide!)
        const neo4jAnalysis = await fetchAnalysisFromNeo4j(
          ctx.brain,
          indexedFiles,
          matchesByFile
        );
        analysisResult = neo4jAnalysis;
      }

      if (nonIndexedFiles.length > 0) {
        // Fallback on-the-fly pour fichiers non-indexés
        const onTheFlyAnalysis = await analyzeFilesOnTheFly(
          nonIndexedFiles,
          matchesByFile
        );

        // Persister les résultats → schema-ready
        await persistToNeo4j(ctx.brain, onTheFlyAnalysis);

        // Merger avec résultats Neo4j
        analysisResult = mergeAnalysis(analysisResult, onTheFlyAnalysis);
      }

      // Queue fichiers pour embeddings (async, ne pas attendre)
      queueFilesForEmbedding(ctx.brain, filePaths);

      // Formatter en markdown
      return formatAsMarkdown(matches, analysisResult);
    }

    return { matches, ... };
  };
}
```

### 2. Récupérer les infos depuis Neo4j

```typescript
// packages/core/src/tools/fs-tools.ts

async function fetchAnalysisFromNeo4j(
  brain: BrainManager,
  filePaths: string[],
  matchesByFile: Map<string, MatchInfo[]>
): Promise<AnalysisResult> {
  const neo4j = brain.getNeo4jClient();

  // Query optimisée: récupérer scopes + relations en une seule requête
  const result = await neo4j.run(`
    UNWIND $filePaths AS filePath
    MATCH (f:File {path: filePath})
    WHERE f.state IN ['schema-ready', 'embedded']
    OPTIONAL MATCH (f)<-[:DEFINED_IN]-(s:Scope)
    OPTIONAL MATCH (s)-[r:CONSUMES]->(consumed:Scope)
    OPTIONAL MATCH (s)<-[r2:CONSUMES]-(consumer:Scope)
    OPTIONAL MATCH (s)-[:USES_LIBRARY]->(lib:ExternalLibrary)
    RETURN f.path AS file,
           collect(DISTINCT {
             name: s.name,
             type: s.type,
             startLine: s.startLine,
             endLine: s.endLine,
             consumes: collect(DISTINCT {
               name: consumed.name,
               file: consumed.file
             }),
             consumedBy: collect(DISTINCT {
               name: consumer.name,
               file: consumer.file
             }),
             libraries: collect(DISTINCT lib.name)
           }) AS scopes
  `, { filePaths });

  // Transformer en format AnalysisResult
  return transformNeo4jResult(result.records, matchesByFile);
}
```

### 3. Persister on-the-fly → Neo4j

```typescript
// packages/core/src/tools/fs-tools.ts

async function persistToNeo4j(
  brain: BrainManager,
  analysis: OnTheFlyAnalysis
): Promise<void> {
  const neo4j = brain.getNeo4jClient();
  const stateMachine = brain.getFileStateMachine();

  for (const file of analysis.files) {
    // 1. Créer le node File s'il n'existe pas
    await neo4j.run(`
      MERGE (f:File {path: $path})
      ON CREATE SET
        f.uuid = randomUUID(),
        f.name = $name,
        f.state = 'schema-ready',
        f.createdAt = datetime()
      ON MATCH SET
        f.state = 'schema-ready',
        f.updatedAt = datetime()
    `, {
      path: file.path,
      name: path.basename(file.path),
    });

    // 2. Créer les scopes
    for (const scope of file.scopes) {
      await neo4j.run(`
        MATCH (f:File {path: $filePath})
        MERGE (s:Scope {
          file: $filePath,
          name: $name,
          startLine: $startLine
        })
        ON CREATE SET
          s.uuid = randomUUID(),
          s.type = $type,
          s.endLine = $endLine,
          s.state = 'schema-ready'
        MERGE (s)-[:DEFINED_IN]->(f)
      `, {
        filePath: file.path,
        name: scope.name,
        type: scope.type,
        startLine: scope.startLine,
        endLine: scope.endLine,
      });
    }

    // 3. Créer les relations CONSUMES
    for (const rel of file.relationships) {
      await neo4j.run(`
        MATCH (s:Scope {file: $sourceFile, name: $sourceName})
        MATCH (t:Scope {file: $targetFile, name: $targetName})
        MERGE (s)-[:CONSUMES]->(t)
      `, {
        sourceFile: rel.source.file,
        sourceName: rel.source.name,
        targetFile: rel.target.file,
        targetName: rel.target.name,
      });
    }
  }
}
```

### 4. Queue pour embeddings (async)

```typescript
// packages/core/src/tools/fs-tools.ts

function queueFilesForEmbedding(brain: BrainManager, filePaths: string[]): void {
  // Fire-and-forget - ne pas bloquer le grep
  brain.getEmbeddingQueue().addFiles(filePaths, {
    priority: 'high',  // Fichiers accédés = haute priorité
    source: 'grep-access',
  }).catch(err => {
    console.warn('[grep_files] Failed to queue files for embedding:', err.message);
  });
}
```

## Optimisations

### Batch Query pour vérifier les fichiers

```typescript
async function checkFilesInNeo4j(
  brain: BrainManager,
  filePaths: string[]
): Promise<Set<string>> {
  const neo4j = brain.getNeo4jClient();

  const result = await neo4j.run(`
    UNWIND $filePaths AS path
    MATCH (f:File {path: path})
    WHERE f.state IN ['schema-ready', 'embedded']
    RETURN f.path AS path
  `, { filePaths });

  return new Set(result.records.map(r => r.get('path')));
}
```

### Cache local pour éviter répétition

```typescript
// Cache des fichiers déjà vérifiés dans la session
const neo4jFileCache = new Map<string, boolean>();

async function isFileInNeo4j(brain: BrainManager, filePath: string): Promise<boolean> {
  if (neo4jFileCache.has(filePath)) {
    return neo4jFileCache.get(filePath)!;
  }

  const exists = await checkFileInNeo4j(brain, filePath);
  neo4jFileCache.set(filePath, exists);
  return exists;
}
```

## Comparaison: Avant vs Après

### Avant (on-the-fly uniquement)

```
grep_files --analyze
  → Parse chaque fichier (AST)
  → Extract scopes
  → Résoudre relations cross-file
  → Générer markdown
  → RIEN n'est persisté
  → Prochaine requête = re-parse tout
```

### Après (Neo4j hybride)

```
grep_files --analyze
  → Check Neo4j (1 query batch)
  → Pour fichiers indexés: récupérer relations (1 query)
  → Pour fichiers non-indexés: parse + persist
  → Générer markdown
  → Queue pour embeddings (async)
  → Prochaine requête = instant (depuis Neo4j)
```

## Métriques attendues

| Scénario | Avant | Après |
|----------|-------|-------|
| Premier grep (fichiers non-indexés) | ~5s | ~5s + persist |
| Deuxième grep (mêmes fichiers) | ~5s | ~100ms (Neo4j) |
| Grep sur projet ingéré | N/A | ~100ms |
| Overhead persist | 0 | ~200ms/fichier |

## Étapes d'implémentation

1. **Ajouter `checkFilesInNeo4j`** - Vérifier existence en batch
2. **Ajouter `fetchAnalysisFromNeo4j`** - Récupérer scopes/relations
3. **Ajouter `persistToNeo4j`** - Persister on-the-fly analysis
4. **Modifier `generateGrepFilesHandler`** - Intégrer le flow hybride
5. **Ajouter queue embedding** - Fire-and-forget
6. **Cache local** - Éviter re-check dans même session
7. **Tests** - Vérifier performance et exactitude

## Questions

### Q1: Faut-il toujours persister on-the-fly?

Options:
- Oui, toujours (enrichit la DB progressivement)
- Non, seulement si le projet est déjà découvert
- Configurable

**Recommandation:** Oui, toujours - c'est gratuit et enrichit le graphe.

### Q2: Comment gérer les fichiers modifiés?

Si un fichier était `schema-ready` mais a été modifié:
- Le hash de contenu ne match plus
- Options: re-parse automatique ou marquer dirty

**Recommandation:** Comparer hash, si différent → re-parse et update.

### Q3: Quel projet associer aux fichiers orphelins?

Si grep trouve un fichier hors de tout projet connu:
- Créer un projet "orphans" ou "touched-files"
- Associer au projet le plus proche

**Recommandation:** Projet "touched-files" comme actuellement.
