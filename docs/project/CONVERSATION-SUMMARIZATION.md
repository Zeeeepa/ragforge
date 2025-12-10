# Système de Résumé de Conversation

Date: 2025-12-09

## Vue d'ensemble

Le système de résumé automatique permet de :
1. Stocker les résultats d'outils dans un tableau séparé des messages
2. Résumer automatiquement les tours de conversation (user → outils → assistant) quand ils dépassent un seuil
3. Extraire des informations structurées (fichiers mentionnés, découvertes clés, outils utilisés, etc.)

## Architecture

### ConversationTurn

Chaque tour de conversation est stocké comme un objet `ConversationTurn` :

```typescript
interface ConversationTurn {
  userMessage: string;
  assistantMessage: string;
  toolResults: Array<{
    toolName: string;
    toolArgs?: Record<string, any>;
    toolResult: any;
    success: boolean;
    timestamp: number;
  }>;
  timestamp: number;
}
```

Les résultats d'outils sont stockés **séparément** dans `toolResults`, pas mélangés avec les messages.

### ConversationSummarizer

La classe `ConversationSummarizer` :
- Surveille le nombre de tours non résumés
- Quand le seuil est atteint (par défaut: 5 tours), résume automatiquement
- Utilise un LLM pour créer un résumé structuré avec extraction de fichiers

### Résumé Structuré

Chaque résumé contient :

```typescript
interface ConversationSummary {
  summary: string;              // Résumé textuel (3-4 phrases)
  filesMentioned: string[];      // Tous les fichiers mentionnés
  keyFindings: string[];         // Découvertes importantes (3-5 items)
  toolsUsed: string[];           // Liste des outils utilisés
  topics: string[];              // Sujets principaux (2-4 topics)
  turnCount: number;             // Nombre de tours résumés
}
```

## Fonctionnement Hiérarchique

### Niveau 1 : Résumé des Tours
1. **Stockage des tours** : Chaque échange user → outils → assistant est stocké comme un `ConversationTurn`
2. **Suivi du seuil** : Quand il y a 5+ tours non résumés, le système déclenche un résumé de niveau 1
3. **Résumé en arrière-plan** : Le résumé est généré de manière asynchrone (non-bloquant)
4. **Conservation récente** : Les 2 derniers tours restent toujours non résumés pour le contexte immédiat

### Niveau 2+ : Résumé des Résumés
5. **Accumulation** : Les résumés de niveau 1 s'accumulent jusqu'à atteindre ~10k caractères
6. **Résumé hiérarchique** : Quand la limite est atteinte, les résumés de niveau 1 sont résumés en un résumé de niveau 2
7. **Récursif** : Le processus continue : les résumés de niveau 2 s'accumulent jusqu'à 10k caractères, puis sont résumés en niveau 3, etc.
8. **Conservation** : Le dernier résumé de chaque niveau reste toujours non résumé pour le contexte

### Intégration dans l'Historique
9. **Sélection intelligente** : Seuls les résumés de plus haut niveau sont inclus dans le contexte (plus agrégés)
10. **Contexte optimisé** : L'agent reçoit les résumés de niveau le plus élevé + les 2-3 derniers tours non résumés

## Avantages

- **Séparation claire** : Les résultats d'outils sont dans un tableau séparé, pas mélangés avec les messages
- **Pas de limite artificielle** : Plus besoin de "40 derniers messages pour capturer les outils"
- **Résumé intelligent** : Extraction automatique de fichiers, découvertes, outils utilisés
- **Hiérarchie automatique** : Les résumés se résument automatiquement quand ils atteignent 10k caractères
- **Contexte optimisé** : Seulement les résumés de plus haut niveau + 2-3 tours récents sont passés à l'agent
- **Scalable** : Fonctionne pour des conversations très longues sans problème de tokens grâce à la hiérarchie
- **Récursif** : Le système peut créer plusieurs niveaux de résumés selon la longueur de la conversation

## Fichiers

- `packages/cli/src/tui/hooks/conversation-summarizer.ts` - Classe de résumé
- `packages/cli/src/tui/hooks/useAgent.ts` - Intégration dans le hook

## Configuration

Les seuils de résumé peuvent être configurés lors de l'initialisation :

```typescript
summarizerRef.current = new ConversationSummarizer({
  maxTurnsBeforeSummarize: 5,              // Résumer les tours après 5 échanges
  maxCharsBeforeSummarizeSummaries: 10000, // Résumer les résumés après 10k caractères
  llmProvider,
  executor,
});
```

## Structure Hiérarchique

```
Tours (non résumés)
  ↓ (après 5 tours)
Résumés Niveau 1 (résumés de tours)
  ↓ (après 10k caractères)
Résumés Niveau 2 (résumés de résumés niveau 1)
  ↓ (après 10k caractères)
Résumés Niveau 3 (résumés de résumés niveau 2)
  ...
```

Chaque niveau conserve toujours son dernier résumé non résumé pour le contexte.

## Exemple d'utilisation

Quand l'agent voit l'historique, il reçoit :

```
[Previous conversation summary]: L'utilisateur a demandé de regarder les commandes 
set-persona et d'utiliser le wizard de create-persona...

Key findings: set-persona existe, create-persona a un wizard, les deux sont dans useAgent.ts
Files mentioned: packages/cli/src/tui/hooks/useAgent.ts, packages/core/src/runtime/agents/rag-agent.ts
```

Puis les 2-3 derniers tours complets pour le contexte immédiat.
