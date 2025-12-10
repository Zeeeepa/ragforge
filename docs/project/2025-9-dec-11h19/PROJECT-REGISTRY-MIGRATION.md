# Migration Project Registry: YAML → Neo4j

## Contexte
On migre le système de registry des projets de `~/.ragforge/projects.yaml` vers Neo4j directement.
Le fichier YAML était source de désynchronisation (ex: `nodeCount: 0` alors que le projet avait des milliers de nodes en DB).

## Problème initial
- `brain_search` vérifiait `registeredProjects.nodeCount` pour décider de skip l'initial sync
- `ragforge-packages-lveh` avait `nodeCount: 0` dans le YAML
- Résultat: ré-ingestion complète à chaque redémarrage du daemon

## Solution
Tout stocker sur le node `Project` en Neo4j:
- `projectId` - ID unique (généré depuis le path)
- `rootPath` - Chemin absolu
- `name` / `displayName` - Nom pour l'UI
- `type` - 'quick-ingest', 'ragforge-project', 'web-crawl'
- `excluded` - Boolean pour exclure de brain_search
- `lastAccessed` - Timestamp
- `autoCleanup` - Boolean
- `nodeCount` - Calculé dynamiquement via COUNT()

## Changements effectués

### 1. `startWatching()` - FAIT
```typescript
// Avant: vérifiait registeredProjects.nodeCount
const projectHasNodes = existingProject && existingProject.nodeCount > 0;

// Après: vérifie directement en DB
const nodeCountInDb = await this.countProjectNodes(projectId);
const projectHasNodes = nodeCountInDb > 0;
```

### 2. Nouvelles méthodes privées - FAIT
- `updateProjectMetadataInDb(projectId, metadata)` - Met à jour type/excluded/lastAccessed sur le node Project
- `getProjectFromDb(projectId)` - Récupère un projet depuis Neo4j
- `listProjectsFromDb()` - Liste tous les projets depuis Neo4j
- `refreshProjectsCache()` - Remplit le cache depuis Neo4j

### 3. `initialize()` - FAIT
- Supprimé `loadProjectsRegistry()` (qui chargeait le YAML)
- Ajouté `refreshProjectsCache()` qui charge depuis Neo4j

### 4. `registerProject()` - FAIT
- Ne sauvegarde plus dans YAML
- Appelle `updateProjectMetadataInDb()` pour persister les métadonnées

### 5. `excludeProject()`, `includeProject()`, `toggleProjectExclusion()` - FAIT
- Appellent `updateProjectMetadataInDb()` au lieu de `saveProjectsRegistry()`

### 6. `clearProjectsRegistry()`, `unregisterProject()` - FAIT
- Ne font plus que vider le cache (les nodes restent en DB)

## Reste à faire

### 7. Supprimer les derniers appels à `saveProjectsRegistry()` - FAIT
- `registerWebProject()` → remplacé par `updateProjectMetadataInDb()`
- `forgetPath()` → ligne supprimée (Project node supprimé avec autres nodes)
- `dispose()` → ligne supprimée (pas besoin de sauvegarder, tout est en DB)

### 8. Supprimer `loadProjectsRegistry()` et `saveProjectsRegistry()` - DÉJÀ FAIT
Ces méthodes avaient déjà été supprimées dans une session précédente.

### 9. Supprimer l'interface `ProjectsRegistry` - FAIT
Supprimée de `brain-manager.ts` et de l'export dans `index.ts`.

### 10. Mettre à jour `code-source-adapter.ts` - NON REQUIS
Les métadonnées sont ajoutées via `updateProjectMetadataInDb()` qui fait un MERGE sur le node Project.

### 11. Tester
- Redémarrer le daemon
- Vérifier que `brain_search` ne relance pas d'initial sync
- Vérifier que `list_brain_projects` fonctionne

## Notes
- Le cache `registeredProjects` Map est gardé pour les méthodes sync comme `listProjects()`
- Le cache est rafraîchi au démarrage depuis Neo4j
- Les modifications (exclude, etc.) mettent à jour cache + DB
