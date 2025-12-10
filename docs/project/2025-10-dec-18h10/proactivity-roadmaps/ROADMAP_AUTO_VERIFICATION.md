# Roadmap : Auto-Vérification et Auto-Correction

## Vue d'ensemble

Cette roadmap couvre les fonctionnalités permettant à l'agent de vérifier et corriger automatiquement ses propres actions, réduisant les erreurs et améliorant la qualité du code généré.

## Objectifs

- **Auto-vérification** : L'agent vérifie automatiquement ses modifications
- **Auto-correction** : L'agent corrige ses erreurs sans intervention utilisateur
- **Qualité** : Amélioration continue de la qualité du code généré

---

## Feature 1 : Self-Healing - Double-Check Automatique

### Description

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

### Fichiers à modifier

- `packages/core/src/tools/tool-generator.ts` (ou équivalent)
- `packages/core/src/runtime/agents/rag-agent.ts` (pour intégrer la validation)

### Dépendances

- TypeScript Compiler API pour la validation syntaxique
- Système de validation extensible pour d'autres types de fichiers

### Tests

- Test avec fichier TypeScript valide → pas de warning
- Test avec fichier TypeScript invalide → warning retourné
- Test avec fichier non-code → pas de validation

---

## Feature 2 : Critic Mode - Auto-Critique dans le System Prompt

### Description

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

### Impact

L'agent s'auto-évalue systématiquement avant de conclure, améliorant la qualité du code généré.

### Fichiers à modifier

- `packages/core/src/runtime/agents/rag-agent.ts` (méthode `buildSystemPrompt`)

### Dépendances

- Aucune (modification de prompt uniquement)

### Tests

- Vérifier que le prompt contient bien le Critic Mode
- Tester que l'agent mentionne les auto-corrections dans ses réponses

---

## Ordre d'Implémentation

1. **Critic Mode** (facile, impact immédiat)
2. **Self-Healing** (nécessite infrastructure de validation)

---

## Métriques de Succès

- Réduction des erreurs de syntaxe dans le code généré
- Augmentation des mentions d'auto-correction dans les réponses
- Réduction des interventions utilisateur pour corriger les erreurs

---

## Notes

Ces deux features travaillent ensemble : le Critic Mode force l'auto-évaluation au niveau du prompt, tandis que le Self-Healing ajoute une vérification technique automatique. L'implémentation du Critic Mode est plus rapide et peut être déployée immédiatement, tandis que le Self-Healing nécessite une infrastructure de validation plus robuste.
