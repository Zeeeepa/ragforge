# Plan d'amélioration du contexte agent

## Objectif
Rendre le RagAgent plus méthodique (chercher/lire avant d'éditer) tout en gardant sa confiance d'expert.

---

## 0. Migration & Ingestion lineCount ✅

Migration Cypher exécutée avec succès :
```cypher
MATCH (f:File)<-[:DEFINED_IN]-(s:Scope)
WITH f, max(s.endLine) as lineCount
SET f.lineCount = lineCount
```
→ 206 fichiers mis à jour

Ingestion incrémentale mise à jour :
- `code-source-adapter.ts:1059` : Ajout `lineCount` pour fichiers TS/JS via `analysis.totalLines`
- `incremental-ingestion.ts:787-803` : Query post-ingestion pour fichiers sans lineCount

---

## 1. Prompt système (rag-agent.ts) ✅

### Fait
- [x] Approche méthodique mais confiante
- [x] Instruction de lire avant d'éditer
- [x] Seuil 500 lignes pour petit/grand fichier
- [x] Hint `extract_dependency_hierarchy` pour comprendre les implications
- [x] Mention que le contexte contient la taille des fichiers (total lines)

---

## 2. Contexte enrichi initial (storage.ts - formatContextForAgent) ✅

### Fait
- [x] Scopes complets (plus de troncation à 500 chars)
- [x] Numéros de ligne start-end inclus
- [x] `fileLineCount` affiché : `[file:start-end] name (Relevance: X%, File: Y lines)`

---

## 3. brain_search (brain-manager.ts) ✅

### Fait
- [x] Interface `BrainSearchResult` : ajout `fileLineCount?: number`
- [x] Enrichissement post-recherche : query batch pour récupérer lineCount des File nodes
- [x] Propagation dans `searchCodeFuzzyWithLLM` (storage.ts)
- [x] Affichage dans `formatContextForAgent` : format `[file:start-end] name (Relevance: X%, File: Y lines)`

---

## 4. grep_files (fs-tools.ts) ✅

### Fait
- [x] Paramètre `context_lines` (0-5, défaut 0) avec option `-C` pour ripgrep
- [x] `totalLines` dans chaque match (taille du fichier)
- [x] Cache mémoire TTL pour les line counts (5 min, max 500 fichiers)
- [x] `context_before` et `context_after` arrays avec lignes numérotées
- [x] Fallback Node.js aussi mis à jour

---

## 4bis. Projet "touched-files" (NOUVEAU)

### Concept
Quand `read_file`, `edit_file`, ou `write_file` touche un fichier **hors projet connu** :
1. Créer/utiliser un projet spécial de type `"touched-files"`
2. Indexer ce fichier spécifique dans le brain (pas tout le dossier)
3. Watcher **uniquement ce fichier** (pas le dossier parent)
4. Pas de copie du fichier - référence directe au chemin original

### Avantages
- L'agent garde le contexte des fichiers qu'il a manipulés
- `lineCount` disponible pour ces fichiers "orphelins"
- Recherche sémantique possible sur ces fichiers
- Watch granulaire (fichier par fichier)

### Implémentation
- [ ] Nouveau type de projet : `"touched-files"`
- [ ] Dans `read_file` : si fichier hors projet → ajouter au projet touched-files
- [ ] Dans `edit_file` : idem
- [ ] Dans `write_file` : idem (création de nouveau fichier)
- [ ] Watcher spécial : liste de fichiers individuels au lieu d'un glob de dossier
- [ ] Ingestion : parser le fichier seul et créer les nœuds File/Scope
- [ ] Nettoyage : option pour retirer un fichier du projet touched-files

---

## 5. extract_dependency_hierarchy (brain-tools.ts) ✅

### Fait
- [x] Hint ajouté dans le prompt système : "For impactful changes: use extract_dependency_hierarchy..."
- [x] Outil déjà bien documenté avec description complète

---

## 6. searchCodeFuzzyWithLLM (storage.ts) ✅

### Fait
- [x] Propager `fileLineCount` depuis brain_search vers les résultats formatés
- [x] Interface `codeSemanticResults` : ajout champ `fileLineCount?: number`

---

## Ordre d'implémentation restant

1. ~~brain_search~~ ✅
2. ~~searchCodeFuzzyWithLLM~~ ✅
3. ~~formatContextForAgent~~ ✅
4. ~~grep_files~~ ✅
5. ~~Prompt système~~ ✅
6. **touched-files** - Nouveau type de projet (prochain chantier)
7. **Tests** - Vérifier avec extract_agent_prompt

---

## Notes techniques

### Où trouver totalLines ?
- Les nœuds `File` ont probablement `lineCount` ou on peut le calculer
- Les nœuds `Scope` ont `startLine` et `endLine` mais pas la taille totale du fichier
- Il faut faire une jointure `(Scope)-[:DEFINED_IN]->(File)` pour récupérer la taille

### grep_files context
- Utiliser l'option `-C` de ripgrep (déjà supporté dans le tool)
- Défaut: 3 lignes de contexte
- Max: 10 lignes pour éviter trop de bruit

### Performance
- Ajouter totalLines ne devrait pas impacter la perf (une propriété de plus)
- Context lines dans grep peut augmenter la taille des résultats
