# Roadmap : Résilience et Gestion des Échecs

## Vue d'ensemble

Cette roadmap couvre les fonctionnalités permettant à l'agent de récupérer automatiquement des échecs et d'adapter son plan dynamiquement, améliorant sa robustesse et sa capacité à résoudre des problèmes complexes.

## Objectifs

- **Récupération automatique** : L'agent répare automatiquement les erreurs
- **Replanning dynamique** : L'agent adapte son plan en cas d'échec
- **Résilience** : L'agent ne abandonne pas facilement face aux obstacles

---

## Feature 1 : Replanning - Gestion Automatique des Échecs

### Description

Quand une étape échoue, l'agent doit tenter de réparer automatiquement avant d'abandonner.

### Implémentation

Modifier `executeSubAgent()` dans `rag-agent.ts` :

```typescript
// Dans le catch block de executeSubAgent
console.log(`      ❌ Task failed: ${error.message}`);

// --- AJOUT DE LA PROACTIVITÉ ---
if (plan.strategy === 'sequential' && attempts < 2) {
    // On s'autorise une tentative de réparation
    console.log(`      🔄 Attempting automatic recovery...`);
    
    // On demande à l'agent comment fixer l'erreur
    const recoveryResult = await subAgent.ask(
        `L'action précédente a échoué avec l'erreur : "${error.message}".
         Analyse l'erreur et propose une correction immédiate ou une modification du plan.
         Utilise les outils nécessaires pour réparer.`
    );
    
    if (recoveryResult.toolsUsed && recoveryResult.toolsUsed.length > 0) {
        // Si l'agent a utilisé des outils pour réparer, on réessaie l'étape courante
        continue; // On ne 'break' pas, on boucle sur la même étape
    }
}
// -------------------------------
```

### Impact

L'agent récupère automatiquement des échecs au lieu d'abandonner, améliorant le taux de succès des tâches complexes.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `executeSubAgent`)

### Dépendances

- Système de sous-agents fonctionnel
- Gestion des tentatives multiples

### Tests

- Test avec erreur récupérable → l'agent réessaie
- Test avec erreur non-récupérable → l'agent abandonne après 2 tentatives
- Test avec stratégie parallèle → pas de replanning automatique

---

## Feature 2 : Dynamic Planning pour Sub-Agent

### Description

Donner au sous-agent la permission de modifier son propre plan si nécessaire.

### Implémentation

Modifier `buildTaskPrompt()` dans `executeSubAgent()` :

```typescript
const buildTaskPrompt = (taskIndex: number): string => {
    // ... code existant ...
    
    return `=== INSTRUCTIONS ===
    Execute the CURRENT TASK.
    
    ⚡ **DYNAMIC PLANNING**:
    If while doing this task, you discover a NEW required step 
    (e.g., "Oh, I need to create a utils file first"), DO NOT ASK.
    
    Just perform the extra step and mention it in your 'task_completed' summary.
    You have authority to deviate from the plan if it serves the Goal.
    `;
};
```

### Impact

Le sous-agent peut adapter son plan dynamiquement, évitant les blocages dus à des étapes manquantes.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildTaskPrompt`)

### Dépendances

- Système de sous-agents fonctionnel
- Gestion des tâches avec résumés

### Tests

- Test avec étape manquante → l'agent l'ajoute automatiquement
- Test avec plan complet → l'agent suit le plan normalement
- Vérifier que les étapes ajoutées sont mentionnées dans le résumé

---

## Ordre d'Implémentation

1. **Dynamic Planning** (modification de prompt, plus simple)
2. **Replanning** (nécessite logique de récupération plus complexe)

---

## Métriques de Succès

- Réduction du taux d'échec des tâches complexes
- Augmentation des récupérations automatiques réussies
- Réduction des interventions utilisateur pour débloquer l'agent

---

## Notes

Ces deux features travaillent ensemble pour améliorer la résilience : le Dynamic Planning permet d'éviter les blocages en adaptant le plan, tandis que le Replanning permet de récupérer des erreurs inattendues. L'implémentation du Dynamic Planning est plus simple (modification de prompt) et peut être déployée rapidement.
