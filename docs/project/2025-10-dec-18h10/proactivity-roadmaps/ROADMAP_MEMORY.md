# Roadmap : Mémoire et Gestion du Contexte

## Vue d'ensemble

Cette roadmap couvre les améliorations de la gestion de la mémoire et du contexte de conversation, permettant à l'agent de maintenir une compréhension cohérente sur de longues conversations.

## Objectifs

- **Mémoire intelligente** : Conserver le contexte important même dans de longues conversations
- **Compression efficace** : Optimiser l'utilisation du contexte sans perdre d'information critique
- **Cohérence** : Maintenir la compréhension du but global de la conversation

---

## Feature : Context Pruning Intelligent - Mémoire Glissante

### Description

Au lieu de couper brutalement l'historique après N messages, garder le contexte initial (définition du problème) + les messages récents.

### Problème Actuel

Ligne 988 : `const recentHistory = history.slice(-10);`

C'est brutal. Si tu as une conversation complexe, tu perds le début (le contexte du projet) au bout de 10 tours.

### Solution

Modifier `buildHistoryContext()` dans `rag-agent.ts` :

```typescript
private buildHistoryContext(history: Array<Message>): string {
    if (history.length <= 10) {
        // Comportement standard pour les conversations courtes
        return this.formatHistory(history);
    }

    // Garde le contexte initial (très important pour que l'agent n'oublie pas le but global)
    const initialPrompt = history[0];
    
    // Garde les échanges récents
    const recentMessages = history.slice(-9);
    
    // Insère un marqueur de compression
    const bridge: Message = {
        role: 'system',
        content: '... [Mémoire intermédiaire compressée] ...'
    };

    return this.formatHistory([initialPrompt, bridge, ...recentMessages]);
}
```

### Impact

L'agent conserve le contexte initial (définition du problème, but global) même dans de très longues conversations, tout en gardant accès aux échanges récents.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildHistoryContext`)

### Dépendances

- Système de messages/historique fonctionnel
- Formatage de l'historique pour affichage

### Tests

- Test avec conversation courte (< 10 messages) → comportement standard
- Test avec conversation longue (> 10 messages) → garde le premier + 9 derniers
- Vérifier que le marqueur de compression est présent

### Améliorations Futures

- Compression intelligente du contexte intermédiaire (résumé L1/L2)
- Détection automatique des messages "critiques" à conserver
- Adaptation dynamique du nombre de messages récents selon la taille du contexte

---

## Métriques de Succès

- Amélioration de la cohérence dans les conversations longues
- Réduction des cas où l'agent "oublie" le contexte initial
- Optimisation de l'utilisation du contexte (tokens)

---

## Notes

Cette feature est particulièrement importante pour les conversations longues où l'utilisateur travaille sur un projet complexe. Le contexte initial contient souvent la définition du problème et les objectifs, qui sont cruciaux pour maintenir la cohérence tout au long de la conversation.
