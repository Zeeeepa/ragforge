# Amélioration de la Proactivité de l'Agent

## Vue d'ensemble

Ce document décrit les améliorations à apporter au système d'agent pour le rendre plus proactif et autonome, passant d'un comportement réactif ("attendre les ordres") à un comportement de "Senior Engineer" autonome.

> **📋 Roadmaps Détaillées** : Ce document fournit une vue d'ensemble. Pour les détails d'implémentation de chaque groupe de fonctionnalités, voir les roadmaps dans le dossier [`proactivity-roadmaps/`](./proactivity-roadmaps/README.md).

## Objectifs

- **Auto-vérification** : L'agent vérifie automatiquement ses propres actions
- **Auto-correction** : L'agent corrige ses erreurs sans intervention utilisateur
- **Anticipation** : L'agent identifie et résout les dépendances implicites
- **Résilience** : L'agent récupère automatiquement des échecs

---

## 1. Self-Healing : Double-Check Automatique

### Concept

Quand l'agent modifie un fichier, il doit automatiquement vérifier que la modification est valide avant de considérer la tâche terminée.

### Implémentation

Ajouter une logique de "Post-Hook" dans le `GeneratedToolExecutor` pour les outils de modification de fichiers.

```typescript
// Dans generatedToolExecutor.ts ou équivalent
const FILE_MODIFICATION_TOOLS = new Set(['write_file', 'edit_file', 'create_file']);

if (FILE_MODIFICATION_TOOLS.has(toolCall.tool_name)) {
    // 1. Exécuter la modification
    const result = await handler(toolCall.arguments);
    
    // 2. PROACTIVITÉ : Validation automatique pour les fichiers de code
    if (toolCall.arguments.path.match(/\.(ts|js|tsx|jsx)$/)) {
        try {
            // Validation syntaxique (ex: via TypeScript compiler API)
            const syntaxErrors = await validateSyntax(toolCall.arguments.path);
            if (syntaxErrors.length > 0) {
                return {
                    ...result,
                    warning: `ATTENTION : Le fichier a été écrit mais contient des erreurs de syntaxe : ${syntaxErrors.join(', ')}. CORRIGE IMMÉDIATEMENT.`
                };
            }
        } catch (error) {
            // Si la validation échoue, on continue mais on log
            console.debug(`Syntax validation failed: ${error.message}`);
        }
    }
    
    return result;
}
```

### Impact

L'agent voit le warning dans le résultat de l'outil et se corrige automatiquement sans que l'utilisateur ait à intervenir.

---

## 2. Critic Mode : Auto-Critique dans le System Prompt

### Concept

Ajouter un protocole de qualité obligatoire dans le system prompt qui force l'agent à s'auto-évaluer avant de conclure.

### Implémentation

Modifier `buildSystemPrompt()` dans `rag-agent.ts` :

```typescript
const PROACTIVE_CRITIC_PROMPT = `
**PROTOCOL DE QUALITÉ (CRITIC MODE)**:
Avant de donner une réponse finale ou de marquer une tâche comme terminée :

1. **Auto-Critique** : Relis ton propre code généré.
   - Y a-t-il des imports inutilisés ?
   - Des types 'any' paresseux ?
   - Des variables non utilisées ?

2. **Gestion d'Erreur** : As-tu englobé les appels risqués dans des try/catch ?
   - Les appels réseau sont-ils protégés ?
   - Les opérations fichiers ont-elles une gestion d'erreur ?

3. **Dépendances** : Si tu modifies un fichier de config, as-tu vérifié les fichiers qui en dépendent ?
   - Les imports sont-ils à jour ?
   - Les exports sont-ils corrects ?

SI TU TROUVES UNE FAILLE DANS TON PROPRE PLAN : 
Ne demande pas pardon. Corrige-la et mentionne "J'ai auto-corrigé X pour éviter Y".
`;

// Concaténer à basePrompt
basePrompt += PROACTIVE_CRITIC_PROMPT;
```

---

## 3. Replanning : Gestion Automatique des Échecs

### Concept

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

---

## 4. Context Pruning Intelligent : Mémoire Glissante

### Concept

Au lieu de couper brutalement l'historique après N messages, garder le contexte initial (définition du problème) + les messages récents.

### Implémentation

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

---

## 5. Manifeste de Proactivité : Changer la Posture de l'Agent

### Concept

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

---

## 6. Thought-Loop Forcé : Schema Injection

### Concept

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

---

## 7. Détection de "Lazy Response" : Auto-Relance

### Concept

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

---

## 8. Dynamic Planning pour Sub-Agent

### Concept

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

---

## 9. Recommandations pour Gemini Flash 2.0

### Pourquoi Flash 2.0 est adapté

- **Vitesse** : Latence faible, critique pour les boucles d'agent
- **Coût** : Permet d'envoyer des contextes de 100k tokens sans se ruiner
- **Function Calling** : Optimisé pour l'extraction de données structurées

### Technique : Few-Shot Prompting

Pour compenser la nécessité de prompts plus explicites avec Flash, utiliser des exemples concrets plutôt que des instructions abstraites.

**Exemple à ajouter dans le System Prompt :**

```text
*** EXEMPLES DE COMPORTEMENT ATTENDU ***

USER: "Le login ne marche plus."
BAD AGENT: "Je vais chercher le fichier login." (Trop passif)
GOOD AGENT: 
{
  "thought_process": "Login cassé ? Je dois vérifier les routes d'auth, le contrôleur et si la BDD est accessible.",
  "tools": ["read_file(auth.controller.ts)", "read_file(routes.ts)", "check_db_status()"]
}

USER: "Ajoute une colonne 'age' à l'utilisateur."
BAD AGENT: Executes SQL query directly. (Dangereux)
GOOD AGENT:
{
  "thought_process": "Modification de schéma détectée. Je dois créer une migration, mettre à jour le modèle TypeORM et vérifier les DTOs.",
  "tools": ["create_migration(add_age_to_user)", "edit_file(user.entity.ts)"]
}
```

**Avec Flash, les exemples battent les instructions.** Ça ancre son comportement.

---

## Résumé des Changements

| Amélioration | Fichier | Impact |
|--------------|---------|--------|
| Self-Healing | `generatedToolExecutor.ts` | Auto-vérification des modifications |
| Critic Mode | `rag-agent.ts` (buildSystemPrompt) | Auto-critique avant conclusion |
| Replanning | `rag-agent.ts` (executeSubAgent) | Récupération automatique des échecs |
| Context Pruning | `rag-agent.ts` (buildHistoryContext) | Mémoire intelligente |
| Manifeste | `rag-agent.ts` (buildSystemPrompt) | Posture proactive |
| Thought-Loop | `rag-agent.ts` (ask) | Analyse forcée avant action |
| Lazy Detection | `rag-agent.ts` (buildSystemPrompt) | Interdiction d'abandon facile |
| Dynamic Planning | `rag-agent.ts` (buildTaskPrompt) | Autorisation d'improvisation |

---

## Ordre d'Implémentation Recommandé

1. **Manifeste de Proactivité** (impact immédiat, facile à implémenter)
2. **Thought-Loop Schema** (force l'analyse avant action)
3. **Self-Healing** (améliore la qualité du code généré)
4. **Replanning** (améliore la résilience)
5. **Context Pruning** (optimise la mémoire)
6. **Critic Mode** (affine la qualité)
7. **Lazy Detection** (réduit les échecs)
8. **Dynamic Planning** (permet la flexibilité)

---

## Notes Finales

Ces changements transforment l'agent d'un "stagiaire qui attend les ordres" en un "Tech Lead autonome". Le prompt engineering est crucial avec Gemini Flash 2.0, mais les résultats en valent la peine : un agent plus intelligent, plus rapide, et moins cher.

---

## Roadmaps Détaillées

Pour une implémentation guidée, chaque groupe de fonctionnalités a sa propre roadmap détaillée :

- **[Auto-Vérification](./proactivity-roadmaps/ROADMAP_AUTO_VERIFICATION.md)** : Self-Healing, Critic Mode
- **[Résilience](./proactivity-roadmaps/ROADMAP_RESILIENCE.md)** : Replanning, Dynamic Planning
- **[Mémoire](./proactivity-roadmaps/ROADMAP_MEMORY.md)** : Context Pruning Intelligent
- **[Prompt Engineering](./proactivity-roadmaps/ROADMAP_PROMPT_ENGINEERING.md)** : Manifeste, Thought-Loop, Lazy Detection
- **[Configuration](./proactivity-roadmaps/ROADMAP_CONFIGURATION.md)** : Optimisations Gemini Flash 2.0

Voir le [README des roadmaps](./proactivity-roadmaps/README.md) pour l'ordre d'implémentation recommandé et une vue d'ensemble.
