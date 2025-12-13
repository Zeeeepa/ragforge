# Plan: Migration intelligente des fichiers orphelins et projets enfants

## Contexte

### Problème actuel
1. **Orphan → Project**: Quand `ingest_directory` est appelé sur un répertoire contenant des fichiers orphelins (touched-files), ces fichiers sont ignorés puis ré-ingérés from scratch, perdant les embeddings déjà calculés.

2. **Child → Parent**: Quand `ingest_directory` est appelé sur un répertoire parent contenant des sous-projets, ces projets enfants sont **supprimés** puis tout est ré-ingéré (voir `registerProject()` lignes 1309-1333).

### Coût de la réingestion
- Embeddings Gemini API: ~$0.001/1K tokens
- Temps de parsing: ~100ms/fichier
- Temps d'embedding: ~50ms/fichier (batch)
- Pour 1000 fichiers: ~2-3 minutes perdues + coût API

## Solution proposée

### Principe: Migration au lieu de suppression

Au lieu de supprimer les nodes existants et ré-ingérer, on **migre** les nodes vers le nouveau projet:
1. Change `projectId` sur les nodes
2. Convertit les paths absolus en relatifs (pour orphelins)
3. Préserve les embeddings et leurs hashes
4. Met à jour les relationships si nécessaire

---

## Architecture

### Nouveaux fichiers/méthodes

```
packages/core/src/brain/
├── brain-manager.ts
│   ├── migrateOrphansToProject()     # Migre orphelins vers projet
│   ├── migrateChildProjectToParent() # Fusionne projet enfant dans parent
│   └── registerProject() (modifié)   # Appelle migration au lieu de deletion
└── node-migration.ts (nouveau)
    ├── migrateNodes()                # Migration générique de nodes
    ├── updateNodeProjectId()         # Change projectId
    ├── convertAbsoluteToRelative()   # Convertit paths
    └── preserveEmbeddings()          # S'assure que embeddings sont préservés
```

---

## Étapes d'implémentation

### Étape 1: Créer `migrateOrphansToProject()`

**Fichier**: `brain-manager.ts`

```typescript
async migrateOrphansToProject(
  projectId: string,
  projectPath: string
): Promise<{ migratedFiles: number; migratedScopes: number }> {
  // 1. Trouver tous les fichiers orphelins dans le répertoire du projet
  const orphansInPath = await this.neo4jClient.run(`
    MATCH (f:File {projectId: $orphanProjectId})
    WHERE f.absolutePath STARTS WITH $projectPathPrefix
    RETURN f.uuid, f.absolutePath, f.state
  `, { orphanProjectId: TOUCHED_FILES_PROJECT_ID, projectPathPrefix: projectPath + '/' });

  // 2. Pour chaque fichier orphelin:
  for (const record of orphansInPath.records) {
    const absolutePath = record.get('absolutePath');
    const relativePath = path.relative(projectPath, absolutePath);

    // 2a. Mettre à jour le File node
    await this.neo4jClient.run(`
      MATCH (f:File {absolutePath: $absolutePath, projectId: $orphanProjectId})
      SET f.projectId = $newProjectId,
          f.file = $relativePath,
          f.path = $relativePath
      REMOVE f.state  // Plus besoin de state machine
    `, { absolutePath, orphanProjectId, newProjectId: projectId, relativePath });

    // 2b. Mettre à jour les Scopes associés
    await this.neo4jClient.run(`
      MATCH (s:Scope)-[:DEFINED_IN]->(f:File {absolutePath: $absolutePath})
      SET s.projectId = $newProjectId,
          s.file = $relativePath
    `, { absolutePath, newProjectId: projectId, relativePath });
  }

  // 3. Mettre à jour les relationships PENDING_IMPORT si nécessaire
  // (ceux qui pointent vers des fichiers maintenant dans le projet)

  return { migratedFiles, migratedScopes };
}
```

### Étape 2: Créer `migrateChildProjectToParent()`

**Fichier**: `brain-manager.ts`

```typescript
async migrateChildProjectToParent(
  childProjectId: string,
  parentProjectId: string,
  parentPath: string
): Promise<{ migratedFiles: number; migratedScopes: number }> {
  // 1. Récupérer info du projet enfant
  const childProject = this.registeredProjects.get(childProjectId);
  if (!childProject) return { migratedFiles: 0, migratedScopes: 0 };

  // 2. Calculer le préfixe de path relatif
  const childRelativeToParent = path.relative(parentPath, childProject.path);

  // 3. Migrer tous les File nodes
  await this.neo4jClient.run(`
    MATCH (f:File {projectId: $childProjectId})
    SET f.projectId = $parentProjectId,
        f.file = $prefix + '/' + f.file,
        f.path = $prefix + '/' + f.path
  `, { childProjectId, parentProjectId, prefix: childRelativeToParent });

  // 4. Migrer tous les Scope nodes
  await this.neo4jClient.run(`
    MATCH (s:Scope {projectId: $childProjectId})
    SET s.projectId = $parentProjectId,
        s.file = $prefix + '/' + s.file
  `, { childProjectId, parentProjectId, prefix: childRelativeToParent });

  // 5. Migrer les autres types de nodes (MarkdownDocument, DataFile, etc.)
  const nodeTypes = ['MarkdownDocument', 'MarkdownSection', 'CodeBlock',
                     'DataFile', 'MediaFile', 'Stylesheet', 'WebDocument'];
  for (const nodeType of nodeTypes) {
    await this.neo4jClient.run(`
      MATCH (n:${nodeType} {projectId: $childProjectId})
      SET n.projectId = $parentProjectId,
          n.file = CASE WHEN n.file IS NOT NULL
                        THEN $prefix + '/' + n.file
                        ELSE n.file END
    `, { childProjectId, parentProjectId, prefix: childRelativeToParent });
  }

  // 6. Supprimer le Project node enfant
  await this.neo4jClient.run(`
    MATCH (p:Project {projectId: $childProjectId})
    DELETE p
  `, { childProjectId });

  // 7. Retirer du cache
  this.registeredProjects.delete(childProjectId);

  return { migratedFiles, migratedScopes };
}
```

### Étape 3: Modifier `registerProject()` pour utiliser la migration

**Fichier**: `brain-manager.ts` (lignes ~1309-1333)

```typescript
// AVANT (suppression):
if (childProjects.length > 0) {
  console.log(`[Brain] New project is parent of ${childProjects.length} existing project(s), cleaning up children...`);
  for (const childId of childProjects) {
    await this.neo4jClient.run(`MATCH (n {projectId: $childId}) DETACH DELETE n`, { childId });
    this.registeredProjects.delete(childId);
  }
}

// APRÈS (migration):
if (childProjects.length > 0) {
  console.log(`[Brain] New project is parent of ${childProjects.length} existing project(s), migrating children...`);
  for (const childId of childProjects) {
    const stats = await this.migrateChildProjectToParent(childId, projectId, absolutePath);
    console.log(`[Brain] Migrated ${stats.migratedFiles} files, ${stats.migratedScopes} scopes from ${childId}`);
  }
}
```

### Étape 4: Intégrer migration orphelins dans `quickIngest()`

**Fichier**: `brain-manager.ts` (dans `quickIngest()` ou `startWatching()`)

```typescript
async quickIngest(dirPath: string, options: QuickIngestOptions = {}): Promise<QuickIngestResult> {
  // ... existing code ...

  // NOUVEAU: Migrer les orphelins avant l'ingestion
  const orphanStats = await this.migrateOrphansToProject(finalProjectId, absolutePath);
  if (orphanStats.migratedFiles > 0) {
    console.log(`[QuickIngest] Migrated ${orphanStats.migratedFiles} orphan files to project`);
  }

  // ... continue with normal ingestion (skips already-indexed files via hash check) ...
}
```

### Étape 5: S'assurer que l'ingestion incrémentale détecte les fichiers déjà migrés

L'ingestion incrémentale utilise déjà le hash pour détecter les fichiers inchangés. Les fichiers migrés:
- Ont déjà un hash (de l'ingestion orpheline)
- Ce hash sera comparé au hash du fichier actuel
- Si identique → skip (pas de re-parsing ni re-embedding)

**Vérifier dans**: `IncrementalIngestionManager.ts`

```typescript
// Déjà implémenté - vérifie si le node existe avec le même hash
MATCH (existing:Scope {projectId: $projectId, file: $file})
WHERE existing.hash = $newHash
RETURN existing  // Si trouvé, skip
```

---

## Flux de données

### Scénario 1: Orphan → Project

```
Avant:
  File {projectId: "touched-files", absolutePath: "/home/user/proj/src/utils.ts", state: "embedded"}
  Scope {projectId: "touched-files", file: "/home/user/proj/src/utils.ts", embedding_content: [...]}

Après migration:
  File {projectId: "proj-abc1", file: "src/utils.ts", path: "src/utils.ts"}
  Scope {projectId: "proj-abc1", file: "src/utils.ts", embedding_content: [...]}  // PRÉSERVÉ!

Ingestion incrémentale:
  - Trouve File avec hash matching → SKIP (pas de re-parsing)
  - Trouve Scope avec embeddings → SKIP (pas de re-embedding)
```

### Scénario 2: Child → Parent Project

```
Avant:
  Project {projectId: "src-abc1", rootPath: "/home/user/proj/src"}
  File {projectId: "src-abc1", file: "utils.ts"}
  Scope {projectId: "src-abc1", file: "utils.ts", embedding_content: [...]}

Après migration vers parent "proj-xyz9":
  File {projectId: "proj-xyz9", file: "src/utils.ts"}  // path préfixé
  Scope {projectId: "proj-xyz9", file: "src/utils.ts", embedding_content: [...]}  // PRÉSERVÉ!

Ingestion incrémentale du parent:
  - Trouve les fichiers déjà migrés → SKIP
  - Parse seulement les nouveaux fichiers du parent
```

---

## Considérations

### Embeddings préservés automatiquement
- Les propriétés `embedding_*` restent sur les nodes
- Les `embedding_*_hash` restent identiques
- Les `EmbeddingChunk` nodes gardent leur `parentUuid` (doit être mis à jour si UUID change)

### Décisions de design

**Conversion des paths**: Les fichiers orphelins migrés auront leurs paths convertis en relatifs (supprimer `absolutePath`, utiliser `file`/`path` relatifs comme les fichiers de projet normaux).

### Cas particuliers à gérer

1. **PENDING_IMPORT entre orphelins**: Si un orphelin A importe un orphelin B, et les deux sont migrés, la relation PENDING_IMPORT doit être convertie en CONSUMES.

2. **Directory hierarchy**: Les Directory nodes des orphelins utilisent des paths absolus. On peut les ignorer (le projet créera sa propre hiérarchie) ou les supprimer.

3. **EmbeddingChunks**: Si les chunks référencent `parentUuid`, vérifier que les UUIDs sont préservés lors de la migration.

4. **File watcher**: Après migration, le watcher du nouveau projet doit surveiller les fichiers migrés.

5. **Suppression de absolutePath**: Lors de la migration, on retire `absolutePath` et on met à jour `file`/`path` avec le chemin relatif.

---

## Tests à prévoir

1. **Test migration orphelin simple**:
   - Créer orphelin avec embeddings
   - `ingest_directory` sur le répertoire
   - Vérifier que embeddings sont préservés

2. **Test migration projet enfant**:
   - `ingest_directory` sur `/proj/src`
   - `ingest_directory` sur `/proj` (parent)
   - Vérifier que fichiers de src ont embeddings préservés

3. **Test relationships PENDING_IMPORT**:
   - Orphelin A importe orphelin B (PENDING_IMPORT)
   - Migration des deux
   - Vérifier conversion en CONSUMES

4. **Test hash matching**:
   - Vérifier que fichiers migrés non modifiés sont skippés à l'ingestion

---

## Estimation

- Étape 1 (migrateOrphansToProject): ~50 lignes
- Étape 2 (migrateChildProjectToParent): ~80 lignes
- Étape 3 (modifier registerProject): ~10 lignes
- Étape 4 (intégrer dans quickIngest): ~10 lignes
- Étape 5 (vérifications): ~20 lignes
- Tests: ~100 lignes

**Total**: ~270 lignes de code

---

## Fichiers à modifier

1. `packages/core/src/brain/brain-manager.ts`
   - Ajouter `migrateOrphansToProject()`
   - Ajouter `migrateChildProjectToParent()`
   - Modifier `registerProject()` (section child projects)
   - Modifier `quickIngest()` (appeler migration)

2. `packages/core/src/brain/index.ts`
   - Exporter nouveaux types si nécessaire
