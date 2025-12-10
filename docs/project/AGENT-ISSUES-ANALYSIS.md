# Analyse des Problèmes de l'Agent RagForge

Date: 2025-12-09

## Problèmes Identifiés

### 1. Agent Pas Assez Proactif

**Symptôme** : L'agent retourne une réponse alors qu'il devrait encore utiliser des outils.

**Exemple observé** :
```
User: "salut, dis moi, peux tu regarder les commandes du terminal de ragforge, 
genre set-persona, je voudrais que toutes les commandes se servent du wizard 
fait pour create persona, quand possible"

Agent: Fait un grep_fi, trouve quelques résultats, puis répond au lieu de continuer
à chercher plus d'informations sur le wizard et set-persona.
```

**Cause racine** :
- Dans `structured-llm-executor.ts:executeSingle()` (ligne 425-500), l'agent arrête dès qu'il a un output valide (ligne 487-490)
- Le système prompt dans `rag-agent.ts:buildSystemPrompt()` (ligne 1221) encourage la proactivité mais n'est pas assez strict
- Le LLM peut décider de retourner une réponse partielle avant d'avoir fait toutes les recherches nécessaires

**Fichiers concernés** :
- `packages/core/src/runtime/llm/structured-llm-executor.ts` (ligne 425-500)
- `packages/core/src/runtime/agents/rag-agent.ts` (ligne 1221-1294)

### 2. Perte de Connaissance Entre Appels

**Symptôme** : L'agent perd connaissance de ce qui a été dit précédemment entre deux appels.

**Exemple observé** :
```
Appel 1:
User: "salut, dis moi, peux tu regarder les commandes..."
Agent: Fait des recherches, répond

Appel 2:
User: "bah renseigne toi normalement tu as tout les outils pour..."
Agent: Répond comme si c'était la première fois, demande des clarifications
```

**Cause racine** :
- Chaque appel à `agent.ask()` dans `useAgent.ts` est indépendant
- Il n'y a pas de système de conversation persistante pour `RagAgent`
- Le système de conversation existe dans `conversation.ts` mais est utilisé pour un autre type d'agent (`ConversationAgent`), pas pour `RagAgent`
- `RagAgent` ne maintient pas d'historique entre les appels

**Fichiers concernés** :
- `packages/core/src/runtime/agents/rag-agent.ts` (pas de système de conversation)
- `packages/cli/src/tui/hooks/useAgent.ts` (chaque appel est indépendant)
- `packages/core/src/runtime/conversation/conversation.ts` (existe mais pas utilisé par RagAgent)

## Solutions Proposées

### Solution 1 : Améliorer la Proactivité

**Approche** :
1. Renforcer le système prompt pour être plus strict sur l'utilisation des outils
2. Modifier la logique d'arrêt dans `executeSingle()` pour être plus conservatrice
3. Ajouter des instructions explicites pour continuer à chercher si les résultats sont incomplets

**Modifications nécessaires** :
- `rag-agent.ts:buildSystemPrompt()` : Ajouter des instructions plus strictes
- `structured-llm-executor.ts:executeSingle()` : Ne pas arrêter si les résultats semblent incomplets

### Solution 2 : Ajouter un Système de Conversation

**Approche** :
1. Créer un système de conversation pour `RagAgent` similaire à celui de `ConversationAgent`
2. Maintenir un historique des messages dans `useAgent.ts`
3. Passer l'historique à chaque appel de `agent.ask()`
4. Utiliser `buildRecentContext()` pour inclure l'historique dans le prompt

**Modifications nécessaires** :
- `rag-agent.ts` : Ajouter un paramètre `conversationHistory` à `ask()`
- `useAgent.ts` : Maintenir un historique et le passer à chaque appel
- Modifier `buildSystemPrompt()` pour inclure l'historique récent

## Plan d'Implémentation

### Phase 1 : Améliorer la Proactivité (Priorité Haute)
1. Modifier `buildSystemPrompt()` pour être plus strict
2. Améliorer la logique d'arrêt dans `executeSingle()`
3. Tester avec l'exemple donné

### Phase 2 : Ajouter la Conversation (Priorité Haute)
1. Ajouter un système de stockage d'historique dans `useAgent.ts`
2. Modifier `RagAgent.ask()` pour accepter un historique
3. Modifier `buildSystemPrompt()` pour inclure l'historique
4. Tester avec plusieurs appels consécutifs

### Phase 3 : Optimisations (Priorité Moyenne)
1. Ajouter un système de résumé pour les longues conversations
2. Limiter la taille de l'historique pour éviter les coûts élevés
3. Ajouter des métriques pour suivre l'amélioration
