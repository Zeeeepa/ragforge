# Roadmap : Système de Mémoire Conversationnelle avec BDD et Recherche Sémantique

Date: 2025-12-09

## Objectifs

1. **Résumer chaque tour individuellement** (pas après 5 tours)
2. **Résumé en parallèle** après chaque réponse de l'agent (non-bloquant)
3. **Limite de caractères** : Si l'historique brut dépasse 5k caractères, déclencher résumé hiérarchique
4. **Ingestion en BDD** : Stocker les turns (niveau 0), résumés, et tool calls en Neo4j par niveau
5. **Embeddings pour turns** : Générer embeddings pour chaque turn (niveau 0) pour recherche sémantique
6. **Recherche sémantique** : Effectuer une recherche sémantique sur turns ET résumés à chaque appel
7. **Contexte parfait** : Combiner contenu brut récent + recherche sémantique (turns + résumés) pour l'agent
8. **Sessions par CWD** : Lier les sessions au répertoire de travail (CWD) et proposer au rechargement

## Architecture Cible

```
Tour individuel (user → tools → assistant)
  ↓ (résumé immédiat en parallèle)
Résumé Niveau 1 (ingéré en BDD avec embeddings)
  ↓ (si historique brut > 5k chars)
Résumé Niveau 2 (résumé des résumés niveau 1)
  ↓ (si résumés niveau 2 > 10k chars)
Résumé Niveau 3...
```

## Phase 1 : Résumé par Tour Individuel

### 1.1 Modifier le déclencheur de résumé
- **Fichier** : `packages/cli/src/tui/hooks/useAgent.ts`
- **Changement** : Résumer chaque tour individuellement au lieu d'attendre 5 tours
- **Action** : Après chaque réponse de l'agent, lancer `summarizeTurns([completedTurn])` en parallèle

### 1.2 Résumé non-bloquant
- **Fichier** : `packages/cli/src/tui/hooks/useAgent.ts`
- **Changement** : Le résumé ne bloque pas la réponse à l'utilisateur
- **Action** : Utiliser `.then()` sans `await` pour lancer en arrière-plan

### 1.3 Limite de caractères pour historique brut
- **Fichier** : `packages/cli/src/tui/hooks/useAgent.ts`
- **Changement** : Vérifier si l'historique brut (turns non résumés) dépasse 5k caractères
- **Action** : Si oui, déclencher résumé hiérarchique des résumés niveau 1

**Estimation** : 2-3 heures

## Phase 2 : Stockage en BDD (Neo4j)

### 2.1 Schéma de données

#### Node Types
- `ConversationTurn` : Tour individuel (niveau 0)
  - Properties: `userMessage`, `assistantMessage`, `timestamp`, `turnIndex`, `charCount`, `embedding` (vector)
  - Relationships: `HAS_TOOL_CALL` → `ToolCall`
  - **Note** : Niveau 0 = contenu brut (user + outils + assistant)
  
- `ToolCall` : Appel d'outil
  - Properties: `toolName`, `toolArgs` (JSON), `toolResult` (JSON), `success`, `durationMs`, `timestamp`
  - Relationships: `PART_OF` → `ConversationTurn`
  
- `ConversationSummary` : Résumé par niveau (1, 2, 3...)
  - Properties: `summary`, `level`, `charCount`, `turnCount`, `filesMentioned` (array), `keyFindings` (array), `toolsUsed` (array), `topics` (array), `timestamp`, `embedding` (vector)
  - Relationships: `SUMMARIZES` → `ConversationTurn` (si level 1) ou `ConversationSummary` (si level 2+)
  
- `ConversationSession` : Session de conversation
  - Properties: `sessionId`, `startTime`, `lastActivity`, `cwd` (current working directory), `projectPath`
  - Relationships: `HAS_TURN` → `ConversationTurn`, `HAS_SUMMARY` → `ConversationSummary`

### 2.2 Créer le Storage Manager
- **Fichier** : `packages/core/src/runtime/conversation/conversation-storage.ts` (nouveau)
- **Responsabilités** :
  - Stocker les turns (niveau 0) avec leurs tool calls
  - Utiliser `EmbeddingService` existant pour générer embeddings (3072 dimensions)
  - Pour turns : combiner userMessage + assistantMessage + toolResults pour texte embedding
  - Stocker les résumés par niveau avec embeddings
  - Utiliser `EmbeddingService.getQueryEmbedding()` pour recherche sémantique
  - Créer les relations entre nodes
  - Gérer les sessions liées au CWD

### 2.3 Intégration avec BrainManager
- **Fichier** : `packages/core/src/brain/brain-manager.ts`
- **Changement** : Ajouter méthodes pour conversation storage
- **Actions** :
  - `storeConversationTurn(sessionId, turn, toolCalls)` : Stocker un tour avec embeddings (niveau 0)
  - `storeConversationSummary(sessionId, summary, level, parentIds)` : Stocker un résumé avec embeddings
  - `getRecentTurns(sessionId, limit, maxChars)` : Récupérer tours récents
  - `getLevel1SummariesNotSummarized(sessionId, limit)` : Récupérer résumés L1 non résumés en L2
  - `searchConversationHistory(sessionId, query, semantic=true, includeTurns=true)` : Recherche sémantique sur turns ET résumés
  - `createSession(cwd, projectPath)` : Créer une nouvelle session liée au CWD
  - `getSessionsByCwd(cwd)` : Récupérer sessions pour un CWD donné
  - `loadSession(sessionId)` : Charger une session existante

**Estimation** : 4-6 heures

## Phase 3 : Recherche Sémantique

### 3.1 Génération d'embeddings
- **Fichier** : `packages/core/src/runtime/conversation/conversation-storage.ts`
- **Changement** : Générer embeddings pour chaque turn (niveau 0) ET chaque résumé
- **Action** : 
  - Utiliser directement `GeminiEmbeddingProvider` (pas `EmbeddingService` qui est pour code)
  - Provider utilise **3072 dimensions** (meilleure qualité)
  - Pour turns : combiner `userMessage + assistantMessage + toolResults` pour embedding
  - Pour résumés : utiliser le champ `summary` + fichiers + découvertes pour embedding
  - Gérer le cache avec hash manuellement (comme référence dans `EmbeddingService`)

### 3.2 Index vectoriel
- **Fichier** : `packages/core/src/runtime/conversation/conversation-storage.ts`
- **Changement** : Créer index vectoriel dans Neo4j pour recherche sémantique
- **Action** : Utiliser `db.index.vector.createNodeIndex()` ou équivalent

### 3.3 Recherche hybride
- **Fichier** : `packages/core/src/runtime/conversation/conversation-storage.ts`
- **Changement** : Combiner recherche sémantique (turns + résumés) + contenu brut récent
- **Action** :
  - Recherche sémantique sur turns (niveau 0) ET résumés (tous niveaux)
  - Contenu brut récent (derniers 2-3 tours)
  - Fusionner les résultats par score de pertinence

**Estimation** : 3-4 heures

## Phase 4 : Gestion des Sessions par CWD

### 4.1 Créer/Charger sessions
- **Fichier** : `packages/core/src/runtime/conversation/conversation-storage.ts`
- **Changement** : Lier sessions au CWD
- **Actions** :
  - `createSession(cwd, projectPath)` : Créer session avec CWD
  - `getSessionsByCwd(cwd)` : Lister sessions pour CWD
  - `loadSession(sessionId)` : Charger session complète

### 4.2 Interface de sélection au démarrage
- **Fichier** : `packages/cli/src/tui/App.tsx` ou nouveau composant
- **Changement** : Proposer sessions au démarrage si CWD a des sessions
- **Actions** :
  - Au démarrage de ragforge, vérifier si CWD actuel a des sessions
  - Afficher liste des sessions avec : date, nombre de tours, dernier message
  - Permettre de charger une session ou créer nouvelle session

**Estimation** : 2-3 heures

## Phase 5 : Intégration dans l'Agent

### 5.1 Modifier useAgent.ts
- **Fichier** : `packages/cli/src/tui/hooks/useAgent.ts`
- **Changements** :
  - Au démarrage : proposer sessions pour CWD actuel
  - Après chaque réponse : résumer le tour en parallèle
  - Stocker le tour (avec embeddings niveau 0) + tool calls en BDD
  - Vérifier limite de 5k caractères pour historique brut
  - Effectuer recherche sémantique (turns + résumés) avant chaque appel agent

### 5.2 Modifier RagAgent.ask()
- **Fichier** : `packages/core/src/runtime/agents/rag-agent.ts`
- **Changements** :
  - Accepter résultats de recherche sémantique (turns + résumés)
  - Accepter résumés niveau 1 non résumés
  - Combiner : contenu brut récent + résultats recherche sémantique (turns + résumés) + résumés L1 non résumés
  - Passer contexte enrichi au LLM

### 5.3 Contexte enrichi
- **Format** :
  ```
  ## Recent Conversation (brut)
  [2-3 derniers tours complets]
  
  ## Relevant Past Context (Semantic Search - Turns)
  [Turns pertinents trouvés par recherche sémantique - niveau 0]
  
  ## Relevant Past Context (Semantic Search - Summaries)
  [Résumés pertinents trouvés par recherche sémantique - tous niveaux]
  
  ## Recent Level 1 Summaries (Not Yet Summarized to Level 2)
  [Résumés niveau 1 qui n'ont pas encore été résumés en niveau 2]
  ```

**Estimation** : 3-4 heures

## Phase 6 : Optimisations et Tests

### 5.1 Gestion des erreurs
- Gestion des échecs de résumé (ne pas bloquer)
- Gestion des échecs de stockage BDD
- Fallback si recherche sémantique échoue

### 5.2 Performance
- Cache des résultats de recherche sémantique
- Batch des insertions en BDD
- Optimisation des requêtes Neo4j

### 5.3 Tests
- Tests unitaires pour storage
- Tests d'intégration pour recherche sémantique
- Tests de charge pour conversations longues

**Estimation** : 2-3 heures

## Structure de Fichiers

```
packages/core/src/runtime/conversation/
  ├── conversation-storage.ts          # Nouveau : Storage en Neo4j
  ├── conversation-semantic-search.ts  # Nouveau : Recherche sémantique
  └── conversation-types.ts            # Nouveau : Types pour BDD

packages/cli/src/tui/hooks/
  ├── useAgent.ts                      # Modifié : Résumé par tour + BDD
  └── conversation-summarizer.ts       # Modifié : Résumé individuel

packages/core/src/brain/
  └── brain-manager.ts                 # Modifié : Méthodes conversation
```

## Schéma Neo4j Détaillé

```cypher
// Session
(session:ConversationSession {sessionId, startTime, lastActivity})

// Tour
(turn:ConversationTurn {
  userMessage, 
  assistantMessage, 
  timestamp, 
  turnIndex,
  charCount
})

// Tool Call
(toolCall:ToolCall {
  toolName,
  toolArgs,      // JSON string
  toolResult,    // JSON string
  success,
  durationMs,
  timestamp
})

// Résumé
(summary:ConversationSummary {
  summary,
  level,         // 1, 2, 3...
  charCount,
  turnCount,
  filesMentioned,  // JSON array
  keyFindings,     // JSON array
  toolsUsed,       // JSON array
  topics,          // JSON array
  timestamp,
  embedding        // Vector embedding
})

// Relations
(session)-[:HAS_TURN]->(turn)
(turn)-[:HAS_TOOL_CALL]->(toolCall)
(session)-[:HAS_SUMMARY]->(summary)
(summary)-[:SUMMARIZES]->(turn)        // Si level 1
(summary)-[:SUMMARIZES]->(summary)     // Si level 2+
```

## Ordre d'Implémentation Recommandé

1. **Phase 1** : Résumé par tour individuel (base)
2. **Phase 2** : Stockage en BDD avec embeddings pour turns (fondation)
3. **Phase 3** : Recherche sémantique sur turns ET résumés (amélioration)
4. **Phase 4** : Gestion sessions par CWD + interface de sélection (UX)
5. **Phase 5** : Intégration agent avec contexte enrichi (utilisation)
6. **Phase 6** : Optimisations (polish)

## Métriques de Succès

- ✅ Chaque tour est résumé individuellement
- ✅ Résumé lancé en parallèle (non-bloquant)
- ✅ Historique brut limité à 5k caractères
- ✅ Tous les turns (niveau 0) stockés en BDD avec embeddings
- ✅ Tous les tool calls stockés en BDD
- ✅ Recherche sémantique fonctionnelle sur turns ET résumés
- ✅ Agent reçoit contexte enrichi (brut + sémantique turns + sémantique résumés + L1 non résumés)
- ✅ Sessions liées au CWD et proposées au démarrage
- ✅ Performance acceptable (< 500ms pour recherche)

## Questions à Résoudre

1. **Session ID** : UUID généré au démarrage, lié au CWD
2. **Embeddings** : Utiliser Gemini text-embedding-004 (déjà utilisé dans le projet)
3. **Index vectoriel** : Vérifier support Neo4j natif ou utiliser extension/calcul manuel cosine similarity
4. **Limite historique brut** : 5k caractères semble raisonnable ? Ajustable ?
5. **Résumé hiérarchique** : Toujours 10k caractères pour résumer les résumés ?
6. **Embedding pour turns** : ✅ Combiner userMessage + assistantMessage + toolResults (noms d'outils + résultats tronqués) pour un seul embedding par turn
7. **Interface sessions** : Modal au démarrage ? Sidebar ? Commande `/sessions` ?

## Notes Techniques

- Utiliser `BrainManager` existant pour accès Neo4j
- **Utiliser `EmbeddingService` existant** (`BrainManager.getEmbeddingService()`) pour embeddings
  - Service déjà configuré avec GeminiEmbeddingProvider (3072 dimensions)
  - Gère automatiquement le cache avec hash
  - Méthodes disponibles : `embedSingleNode()`, `getQueryEmbedding()`
- S'inspirer de `conversation.ts` pour structure mais adapter pour stockage externe
- Garder compatibilité avec système actuel pendant transition
- Les embeddings sont de **3072 dimensions** (pas 768) - meilleure qualité
