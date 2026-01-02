# 06 - Questions Ouvertes

## Questions de Design

### Q1: Faut-il supprimer l'état `linked`?

**Contexte:** Avec `schema-ready` comme nouvel état terminal, `linked` devient potentiellement redondant.

| Option | Description | Pour | Contre |
|--------|-------------|------|--------|
| A | Supprimer `linked` | Plus simple | Breaking change |
| B | Garder comme transitoire | Compatibilité | Complexité |
| C | Merger `linked` et `schema-ready` | Clean | Migration DB |

**Recommandation:** Option B pour faciliter la migration, puis Option A plus tard.

Lucie: Garder linked car c'est un état transitoire pour dire qu'il va etre forcément traité en embedding par l'ingestion incrementale.
---

### Q2: Comment gérer les monorepos?

**Contexte:** Un monorepo peut avoir 10-100+ package.json.

```
/project
├── package.json           (root)
├── packages/
│   ├── core/
│   │   └── package.json   (1)
│   ├── cli/
│   │   └── package.json   (2)
│   └── ... (x50)
```

| Option | Description | Pour | Contre |
|--------|-------------|------|--------|
| A | 1 projet par package.json | Granulaire | Beaucoup de projets |
| B | 1 projet pour le monorepo | Simple | Perd la structure |
| C | Projet parent + sous-projets liés | Meilleur des deux | Plus complexe |
| D | Lazy discovery (projet créé mais pas ingéré) | Économe | Delay au premier accès |

**Recommandation:** Option D avec priorisation quand accédé.

Lucie: Option D, projets ingérés petit a petit en background mais priorité à ceux accédés en premier.

---

### Q3: Quand générer des embeddings?

**Contexte:** Les embeddings sont coûteux (API calls, temps).

| Trigger | Priority | Justification |
|---------|----------|---------------|
| `read_file` | HIGH | Fichier explicitement consulté |
| `grep_files --analyze` | HIGH | Fichiers dans les résultats |
| `brain_search` résultats | MEDIUM | L'agent s'y intéresse |
| Schema ingestion terminée | NONE | Pas encore accédé |
| Watcher détecte changement | LOW | Fichier modifié |

**Questions dérivées:**
- Faut-il un seuil min d'accès avant embedding? (ex: 2 accès)
- Faut-il expirer les embeddings si fichier pas accédé depuis X temps?

Lucie: Si le provider est ollama, générer les embedding petit a petit quand meme avec priorisation sur ce qui est accédé, et contamination sur leurs relations pour prioriser la suite.
---

### Q4: Comment prioriser les projets au scan?

**Contexte:** Au lancement, on découvre N projets. Lequel ingérer en premier?

| Stratégie | Description |
|-----------|-------------|
| FIFO | Premier découvert, premier ingéré |
| Taille croissante | Petits projets d'abord (résultats rapides) |
| Taille décroissante | Gros projets d'abord (plus importants?) |
| Proximité au cwd | Projet le plus proche du répertoire courant |
| Dernier modifié | Projets récemment touchés d'abord |

**Recommandation:** Proximité au cwd + boost quand accédé.

Lucie: oui, priorité au cwd + boost quand accédé.

---

### Q5: Que faire des fichiers hors projet?

**Contexte:** L'agent peut grep/read des fichiers qui ne sont dans aucun projet découvert.

| Option | Description |
|--------|-------------|
| A | Projet "touched-files" (actuel) | Tous les orphelins ensemble |
| B | Ignorer | Pas de persistance |
| C | Créer projet "ad-hoc" par répertoire | Granulaire |

**Recommandation:** Option A, c'est ce qui existe déjà.

Lucie: Gardons A pour l'instant, sauf si un package.json relatif aux fichiers touchés est trouvé dans le repertoire courant, en ce cas les liés a ce projet la.

---

### Q6: Comment gérer les gros fichiers?

**Contexte:** Certains fichiers générés peuvent être énormes (bundle.js, etc).

| Stratégie | Seuil |
|-----------|-------|
| Skip parsing | > 1 MB |
| Skip embeddings | > 500 KB |
| Warn but process | > 100 KB |

**Recommandation:** Configurable via exclude patterns + seuil de taille.

Lucie: Déja ignorés par l'ingestion incrementale et les watchers je crois normalement, a vérifier, mais il faudrait protéger aussi le grep contre le parsing de ces fichiers lourds.

---

### Q7: Faut-il persister la queue d'embeddings?

**Contexte:** Si le daemon restart, la queue est perdue.

| Option | Description | Pour | Contre |
|--------|-------------|------|--------|
| A | En mémoire seulement | Simple | Perte au restart |
| B | Flag Neo4j (`embeddingQueued`) | Persistant | Plus de writes |
| C | Fichier local JSON | Simple | Sync issues |

**Recommandation:** Option B - flag Neo4j, cohérent avec le reste.

Lucie: ok pour flag neo4j.

---

## Questions Techniques

### Q8: Comment éviter le re-parsing inutile?

**Contexte:** Si un fichier est déjà `schema-ready`, pas besoin de re-parser.

```typescript
// Vérifier avant parsing
const fileState = await stateMachine.getState(filePath);
if (['schema-ready', 'embedded'].includes(fileState)) {
  // Skip parsing, utiliser les données Neo4j
  return fetchFromNeo4j(filePath);
}
```

Lucie: oui d'accord, sauf biensur si le fichier est modifié.

---

### Q9: Comment détecter les changements de fichiers?

**Options:**
1. **Hash de contenu** - Comparer SHA256
2. **Mtime du fichier** - Plus rapide mais moins fiable
3. **Watcher chokidar** - Temps réel mais consomme ressources

**Recommandation:** Watcher pour temps réel + hash pour validation.

Lucie: Déja prévu normalement par l'ingestion incrementale et les watchers, a vérifier.

---

### Q10: Comment gérer la concurrence?

**Contexte:** Plusieurs clients peuvent accéder au même daemon.

| Ressource | Stratégie |
|-----------|-----------|
| Queue d'embeddings | Shared, une seule |
| Ingestion schema | Lock par projet |
| Neo4j writes | Transaction per operation |

Lucie: à voir.
---

### Q11: Rate limiting API embeddings?

**Contexte:** Gemini a des limites de rate.

```typescript
// Configuration suggérée
const rateLimiter = {
  maxRequestsPerMinute: 60,
  maxTokensPerMinute: 1_000_000,
  batchSize: 50,
  pauseBetweenBatches: 2000,  // ms
};
```

Lucie: Oui mais en ce moment on fonctionne avec Ollama, et c'est déja prévu normalement ces rate limit avec des retry, à vérifier.

---

## Questions UX

### Q12: Feedback utilisateur pendant l'ingestion?

**Options:**
- Logs dans le terminal
- Notification quand projet prêt
- Barre de progression
- Rien (silencieux)

**Recommandation:** Logs minimal + notification quand terminé.

Lucie: Voir d'abord le coté daemon, on réfléchira a l'interface et LucieCode plus tard.

---

### Q13: Comment exposer le statut à l'agent?

**Tools MCP proposés:**

```typescript
// Statut de découverte
discovery_status() → { projects: [...], queue: {...} }

// Statut d'un projet
project_status(projectId) → { state, filesCount, schemaReady, embedded }

// Statut de la queue d'embeddings
embedding_queue_status() → { pending, processing, byPriority }
```

---

### Q14: Faut-il un mode "eager" pour les embeddings?

**Contexte:** Certains utilisateurs veulent tout indexer immédiatement.

```typescript
// Option dans ingest_directory
await brain.ingest(path, {
  embeddings: 'eager' | 'lazy' | 'none',  // default: 'lazy'
});
```

Lucie: oui d'accord, mais si on veut donner le ingest directory à LucieCode, il faudrait s'assurer que ça ne timeout pas avant la fin, pour pas que l'agent croit a une erreur.

---

## Ordre d'implémentation suggéré

### Phase 1: Foundation (1-2 jours)
1. [ ] Ajouter état `schema-ready` dans FileStateMachine
2. [ ] Modifier FileProcessor pour transition vers `schema-ready`
3. [ ] Supprimer auto-embed dans startWatching callback
4. [ ] Tests unitaires

### Phase 2: Schema-Only Ingestion (1 jour)
5. [ ] Créer méthode `schemaIngest` dans BrainManager
6. [ ] Modifier tool `ingest_directory` (schema-only par défaut)
7. [ ] Tests intégration

### Phase 3: Auto-Discovery (1-2 jours)
8. [ ] Créer AutoDiscoveryService
9. [ ] Créer SchemaIngestionQueue
10. [ ] Intégrer dans daemon (hook connexion client)
11. [ ] Modifier client CLI (passer cwd)
12. [ ] Tests

### Phase 4: Grep + Neo4j (1 jour)
13. [ ] Ajouter checkFilesInNeo4j
14. [ ] Ajouter fetchAnalysisFromNeo4j
15. [ ] Ajouter persistToNeo4j
16. [ ] Modifier generateGrepFilesHandler
17. [ ] Tests

### Phase 5: Embedding Queue (1 jour)
18. [ ] Créer EmbeddingPriorityQueue
19. [ ] Intégrer dans BrainManager
20. [ ] Connecter grep_files et read_file
21. [ ] Ajouter persistance Neo4j
22. [ ] Tests

### Phase 6: Polish (0.5 jour)
23. [ ] Tools MCP de monitoring
24. [ ] Documentation
25. [ ] Tests E2E

**Total estimé: 5-7 jours**

---

## Risques identifiés

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Performance dégradée grep | Medium | Cache local, batch queries |
| Rate limit API embeddings | Low | Queue avec pause, batching |
| DB corruption si crash | Medium | Transactions, recovery |
| Monorepo avec 100+ packages | Low | Lazy discovery, priorisation |
| Fichiers modifiés pendant parsing | Low | Lock par fichier, retry |
