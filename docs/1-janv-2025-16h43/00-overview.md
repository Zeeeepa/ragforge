# Plan: Schema-Ready Architecture

## Objectif

Permettre une ingestion automatique et légère au lancement de LucieCode, avec génération d'embeddings uniquement pour les fichiers réellement accédés par l'agent.

## Problème actuel

```
discovered → parsing → parsed → relations → linked → embedding → embedded
                                                         ↑
                                                  Automatique via afterIngestion callback
                                                  Pas de contrôle, pas de priorité
```

- L'ingestion complète (avec embeddings) est lente (~30s-2min par projet)
- L'agent doit manuellement décider d'ingérer
- Pas de priorisation des fichiers accédés
- On-the-fly parsing ne persiste pas les résultats
- **Pas de limite de taille de fichier** (gros fichiers peuvent bloquer)
- **Pas de gestion des monorepos**
- **Documents ignorés** (docs/, *.md, *.pdf)

## Solution proposée

### Nouveaux états

```
                    ┌─→ linked → embedding → embedded  (ingest_directory explicite)
relations ──────────┤
                    └─→ schema-ready ─────────────────→ embedding → embedded
                              ↑                              ↑
                         (auto-discovery)              (on-demand, accès)
```

- `linked` = comportement actuel préservé (va forcément vers embedding)
- `schema-ready` = nouveau terminal state (embeddings seulement si accédé)

### Flow complet

```
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 1: DÉCOUVERTE (au lancement LucieCode)                   │
│  ─────────────────────────────────────────────                  │
│  • Scan récursif depuis cwd                                     │
│  • Détecte monorepos (workspaces)                               │
│  • Détecte package.json → projets code                          │
│  • Détecte dossiers docs/ → documents                           │
│  • Tout est "discovered", rien n'est ingéré encore              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 2: PRIORISATION                                          │
│  ─────────────────────────────────────────                      │
│  Priorité = proximité au cwd + boost si accédé                  │
│                                                                 │
│  Exemple monorepo ragforge (cwd=/ragforge):                     │
│    1. ragforge (root) - HIGH                                    │
│    2. packages/core - MEDIUM (souvent importé)                  │
│    3. Autres packages - LOW                                     │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 3: INGESTION BACKGROUND (schema-only)                    │
│  ─────────────────────────────────────────────                  │
│  • Parse AST, extrait scopes, crée relations                    │
│  • **Skip fichiers > 500KB** (protection)                       │
│  • Stocke dans Neo4j                                            │
│  • État final: schema-ready (pas d'embeddings)                  │
│  • Documents: parse structure (sections, titres)                │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 4: ACCÈS PAR L'AGENT                                     │
│  ─────────────────────────────────────────                      │
│  grep_files, read_file, brain_search:                           │
│    1. Check Neo4j pour fichier (schema-ready?)                  │
│    2. Si oui → utiliser relations stockées                      │
│    3. Si non → on-the-fly parsing + persist                     │
│    4. **Skip parsing si fichier > 500KB**                       │
│    5. Queue fichiers accédés pour embeddings                    │
│    6. Queue relations (contamination) pour embeddings           │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  PHASE 5: EMBEDDING QUEUE (provider-aware)                      │
│  ─────────────────────────────────────────                      │
│  Si Ollama (local, gratuit):                                    │
│    • Embeddings en continu, background                          │
│    • Fichiers accédés = HIGH                                    │
│    • Relations des accédés = MEDIUM (contamination)             │
│    • Reste = LOW (on finit par tout faire)                      │
│                                                                 │
│  Si Gemini (API, payant):                                       │
│    • Embeddings seulement si accédé                             │
│    • Projet accédé 2+ fois → embed le projet entier             │
│    • Sinon → seulement fichiers touchés                         │
└─────────────────────────────────────────────────────────────────┘
```

## Protections

### Limite de taille fichier

```typescript
const MAX_FILE_SIZE_FOR_PARSING = 500 * 1024; // 500 KB

async function shouldParseFile(filePath: string): Promise<boolean> {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_FILE_SIZE_FOR_PARSING) {
    console.warn(`Skipping large file: ${filePath} (${(stats.size/1024).toFixed(0)}KB)`);
    return false;
  }
  return true;
}
```

Appliqué à:
- Ingestion incrémentale
- grep_files --analyze
- read_file --analyze
- analyze_files

## Bénéfices

| Aspect | Avant | Après |
|--------|-------|-------|
| Temps au lancement | Minutes (embeddings) | Secondes (schema-only) |
| Travail inutile | Tout est indexé | Seulement ce qui est accédé |
| Dependency trees | On-the-fly ou full ingest | Toujours disponible |
| brain_search | Tout ou rien | Progressif, sur demande |
| Mémoire agent | Doit penser à ingérer | Automatique |
| Monorepos | Non géré | Projets liés |
| Documents | Ignorés | Intégrés |
| Gros fichiers | Bloquent | Skippés |

## Fichiers de ce plan

1. `01-state-machine-changes.md` - Modifications de la machine à états
2. `02-schema-only-ingestion.md` - Implémentation ingestion schema-only
3. `03-daemon-auto-discovery.md` - Auto-découverte des projets
4. `04-grep-neo4j-integration.md` - Intégration grep avec Neo4j
5. `05-embedding-priority-queue.md` - Queue de priorité pour embeddings
6. `06-questions-ouvertes.md` - Questions à trancher (avec réponses Lucie)
7. `07-monorepo-et-documents.md` - Gestion monorepos et documents

## Ordre d'implémentation révisé

### Phase 1: Foundation (1-2 jours)
- [ ] Ajouter état `schema-ready` dans FileStateMachine
- [ ] Ajouter limite taille fichier (500KB)
- [ ] Modifier FileProcessor pour transition vers `schema-ready`
- [ ] Protéger grep/read contre gros fichiers

### Phase 2: Auto-Discovery (2-3 jours)
- [ ] Détection monorepos (workspaces)
- [ ] Détection dossiers docs
- [ ] Création projets hiérarchiques
- [ ] Priorisation (cwd + accès)

### Phase 3: Grep + Neo4j (1 jour)
- [ ] Check Neo4j avant on-the-fly
- [ ] Persist résultats on-the-fly
- [ ] Cache session

### Phase 4: Embedding Queue (1-2 jours)
- [ ] Queue avec priorités
- [ ] Contamination par relations
- [ ] Logique provider-aware (Ollama vs Gemini)
- [ ] Persistance Neo4j

### Phase 5: Polish (1 jour)
- [ ] Async callback pour LucieCode (pas de timeout)
- [ ] Tools MCP de monitoring
- [ ] Tests E2E

**Total estimé: 6-9 jours**
