# Roadmap : Prompt Engineering pour la Proactivité

## Vue d'ensemble

Cette roadmap couvre les améliorations du prompt engineering pour transformer l'agent d'un comportement réactif ("attendre les ordres") à un comportement proactif ("Senior Engineer" autonome).

## Objectifs

- **Posture proactive** : L'agent prend des initiatives sans attendre les ordres
- **Anticipation** : L'agent identifie et résout les dépendances implicites
- **Persistance** : L'agent ne abandonne pas facilement face aux obstacles

---

## Feature 1 : Manifeste de Proactivité - Changer la Posture de l'Agent

### Description

Remplacer le rôle passif par une directive d'initiative qui transforme l'agent en "Senior Architect" autonome.

### Implémentation

Modifier l'introduction du `buildSystemPrompt()` :

```typescript
let basePrompt = `You are an AUTONOMOUS SENIOR SOFTWARE ARCHITECT (The Daemon).
Your goal is not just to answer, but to SOLVE the underlying engineering problem completely.

**🛑 PROACTIVITY MANIFESTO (MANDATORY)**:

1. **ANTICIPATE DEPENDENCIES**: 
   If the user asks to "Add a React Component", you MUST automatically check if you need to:
   - Update the index export
   - Update the routing file
   - Install a package
   DO NOT ASK—JUST DO IT (or plan it).

2. **IMPLICIT CONTEXT**: 
   If the user says "Fix the bug in auth", do not just grep "bug". 
   - READ the auth controller
   - Understand the flow
   - LOOK for potential causes before answering

3. **FULL COMPLETION**: 
   Never leave a task half-finished. 
   If you create a file, you MUST verify it builds or is imported correctly.

4. **DEFENSIVE CODING**: 
   If you see the user asking for something dangerous (e.g., "delete all logs"), 
   you must first:
   - Search for side effects
   - Warn the user
   - Execute only if safe

**Available capabilities**:
... (le reste de ton prompt existant)
`;
```

### Impact

L'agent adopte une posture proactive, anticipant les besoins et complétant les tâches sans demander de confirmation pour chaque étape.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildSystemPrompt`)

### Dépendances

- Aucune (modification de prompt uniquement)

### Tests

- Vérifier que le manifeste est présent dans le prompt
- Tester que l'agent anticipe les dépendances
- Vérifier que l'agent complète les tâches sans demander de confirmation

---

## Feature 2 : Thought-Loop Forcé - Schema Injection

### Description

Forcer l'agent à analyser le contexte avant d'agir en modifiant le schéma de sortie pour inclure une étape d'analyse obligatoire.

### Implémentation

Modifier `outputSchema` dans la méthode `ask()` :

```typescript
const outputSchema = this.outputSchema || {
    // 1. FORCER L'ANALYSE D'ABORD
    context_analysis: {
        type: 'string',
        description: 'Analyze what the user REALLY wants vs what they said. Identify implicit dependencies.',
        prompt: 'Start here. What files might break? What is the missing context? Does this require multiple steps?',
        required: true,
    },
    
    // 2. PLAN D'ATTAQUE
    planned_actions: {
        type: 'string',
        description: 'Short bullet points of what you are about to do proactively.',
        required: false,
    },
    
    // 3. LA RÉPONSE (seulement après avoir réfléchi)
    answer: {
        type: 'string',
        description: 'Your final answer or the result of your actions.',
        prompt: 'Only provide this once you have executed the necessary actions.',
        required: true,
    },
    
    confidence: {
        type: 'number',
        description: 'Confidence level (0-1)',
        required: false,
    },
};
```

### Pourquoi ça marche ?

Le LLM génère le JSON dans l'ordre. En l'obligeant à remplir `context_analysis` en premier, il "réalise" qu'il manque des infos ou qu'il doit vérifier un autre fichier **avant** de générer l'action ou la réponse.

### Impact

L'agent analyse systématiquement le contexte avant d'agir, réduisant les actions précipitées et améliorant la qualité des réponses.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `ask`, définition de `outputSchema`)

### Dépendances

- Système de schéma de sortie structuré (StructuredLLMExecutor)

### Tests

- Vérifier que `context_analysis` est toujours rempli
- Tester que l'analyse précède l'action
- Vérifier que l'agent identifie les dépendances implicites

---

## Feature 3 : Détection de "Lazy Response" - Auto-Relance

### Description

Intercepter les réponses passives ("Je ne trouve pas", "Je ne sais pas") et forcer l'agent à essayer d'autres stratégies.

### Implémentation

Ajouter dans `buildSystemPrompt()` :

```typescript
basePrompt += `
**WHEN YOU ARE STUCK OR FIND NOTHING**:
If your search (grep/brain_search) returns 0 results, DO NOT GIVE UP.

1. Broaden your search (remove keywords, search only for filenames).
2. Check the parent directory with list_directory.
3. Assume you made a typo and try fuzzy searching.
4. Check related files or imports.

*A response of "I couldn't find it" is considered a FAILURE unless you have tried at least 3 different search strategies.*
`;
```

### Impact

L'agent persiste face aux obstacles, essayant plusieurs stratégies avant d'abandonner, réduisant les faux négatifs.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildSystemPrompt`)

### Dépendances

- Aucune (modification de prompt uniquement)

### Tests

- Test avec recherche qui échoue → l'agent essaie d'autres stratégies
- Test avec recherche qui réussit → comportement normal
- Vérifier que l'agent mentionne les stratégies essayées

---

## Ordre d'Implémentation

1. **Manifeste de Proactivité** (impact immédiat, facile à implémenter)
2. **Détection de Lazy Response** (modification de prompt, simple)
3. **Thought-Loop Forcé** (nécessite modification du schéma, plus complexe)

---

## Métriques de Succès

- Augmentation des actions proactives (anticipation de dépendances)
- Réduction des réponses "Je ne sais pas" ou "Je ne trouve pas"
- Amélioration de la qualité des analyses de contexte
- Augmentation du taux de complétion des tâches sans intervention

---

## Notes

Ces trois features travaillent ensemble pour transformer la posture de l'agent :
- Le **Manifeste** donne la permission et l'ordre d'être proactif
- Le **Thought-Loop** force l'analyse avant l'action
- La **Détection de Lazy Response** interdit l'abandon facile

L'implémentation du Manifeste et de la Détection de Lazy Response est simple (modification de prompt) et peut être déployée rapidement, tandis que le Thought-Loop nécessite une modification plus profonde du système de schéma.
