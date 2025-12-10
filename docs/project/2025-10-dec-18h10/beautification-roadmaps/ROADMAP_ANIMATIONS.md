# Roadmap : Animations ASCII pour les Opérations

## Vue d'ensemble

Cette roadmap couvre l'implémentation des animations ASCII pour les différentes opérations de l'agent, adaptées depuis les animations HTML originales pour fonctionner avec Ink/React dans le terminal.

## Objectifs

- **Feedback visuel** : Indiquer clairement que l'agent travaille
- **Style cohérent** : Maintenir l'identité "daemon" de l'agent
- **Adaptabilité** : Différentes animations selon le type d'opération
- **Performance** : Animations légères qui n'impactent pas les performances

---

## Architecture

### Principe

Lier l'intensité et le type d'animation à la complexité de l'opération en cours :
- **Opérations simples** (lecture) → Animation calme
- **Opérations moyennes** (recherche) → Animation modérée
- **Opérations critiques** (écriture, exécution) → Animation intense

### Adaptation HTML → Ink/React

Les animations HTML utilisent `setInterval()` et `innerText`. Pour Ink/React, on utilise :
- `useState` + `useEffect` avec `setInterval` pour gérer l'état
- Composants React avec `Text` d'Ink pour l'affichage
- Cleanup automatique dans `useEffect`

---

## Feature 1 : Animation Circle (Rotation)

### Description

Animation rotative avec des runes autour d'un centre fixe. Style calme et méditatif, adapté aux opérations de lecture et d'analyse.

### Caractéristiques

- **Vitesse** : 150ms par frame
- **Style** : Méditatif, calme
- **Usage** : `read_file`, `list_directory`, analyse de code

### Implémentation React/Ink

```typescript
import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface CircleAnimationProps {
  message?: string;
  isActive: boolean;
}

export const CircleAnimation: React.FC<CircleAnimationProps> = ({ 
  message = "INVOCATION DU CODE...", 
  isActive 
}) => {
  const [frame, setFrame] = useState(0);
  const runes = ["᚛", "ᚨ", "ᛒ", "ᛟ", "᚜", "⸸", "‡"];
  const center = "⛧";
  
  useEffect(() => {
    if (!isActive) return;
    
    const interval = setInterval(() => {
      setFrame(prev => prev + 1);
    }, 150);
    
    return () => clearInterval(interval);
  }, [isActive]);
  
  const idx = frame % runes.length;
  const rotated = [...runes.slice(idx), ...runes.slice(0, idx)];
  const left = rotated.slice(0, 3).join("");
  const right = rotated.slice(rotated.length - 3).join("");
  
  return (
    <Text>
      ⟪ {left} {center} {right} ⟫ {message}
    </Text>
  );
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/animations/CircleAnimation.tsx`

---

## Feature 2 : Animation Transmutation (Focus Central)

### Description

Animation avec symboles alchimiques qui changent au centre. Style modéré, adapté aux opérations de recherche et d'analyse.

### Caractéristiques

- **Vitesse** : 200ms par frame
- **Style** : Modéré, focalisé
- **Usage** : `grep_files`, `brain_search`, `search_files`

### Implémentation React/Ink

```typescript
import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface TransmutationAnimationProps {
  message?: string;
  isActive: boolean;
}

export const TransmutationAnimation: React.FC<TransmutationAnimationProps> = ({ 
  message = "ANALYSE EN COURS...", 
  isActive 
}) => {
  const [frame, setFrame] = useState(0);
  const symbols = ["⍟", "🜂", "☿", "☉", "♄", "🜄", "∮"];
  
  useEffect(() => {
    if (!isActive) return;
    
    const interval = setInterval(() => {
      setFrame(prev => prev + 1);
    }, 200);
    
    return () => clearInterval(interval);
  }, [isActive]);
  
  const sym = symbols[frame % symbols.length];
  
  return (
    <Text>
      ⁅ ⸸ ⁆—[ {sym} ]—⁅ ⸸ ⁆ {message}
    </Text>
  );
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/animations/TransmutationAnimation.tsx`

---

## Feature 3 : Animation Glitch (Chaos Mathématique)

### Description

Animation chaotique avec symboles mathématiques aléatoires. Style intense, adapté aux opérations critiques de modification.

### Caractéristiques

- **Vitesse** : 100ms par frame
- **Style** : Intense, chaotique
- **Usage** : `write_file`, `edit_file`, `run_command`, `delete_path`

### Implémentation React/Ink

```typescript
import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface GlitchAnimationProps {
  isActive: boolean;
}

export const GlitchAnimation: React.FC<GlitchAnimationProps> = ({ isActive }) => {
  const [frame, setFrame] = useState(0);
  const techRunes = ["∇", "∫", "∃", "∀", "∴", "∵", "⊕", "⊗", "⌇"];
  const core = "⛧";
  const messages = [
    "...COMPILING CURSE...",
    "...SUMMONING COMPILER...",
    "...PARSING SOULS...",
    "...EXECUTING RITUAL...",
    "...BINDING ENTITIES..."
  ];
  
  useEffect(() => {
    if (!isActive) return;
    
    const interval = setInterval(() => {
      setFrame(prev => prev + 1);
    }, 100);
    
    return () => clearInterval(interval);
  }, [isActive]);
  
  // Utiliser frame pour pseudo-random (déterministe mais varié)
  const r1 = techRunes[(frame * 3) % techRunes.length];
  const r2 = techRunes[(frame * 7) % techRunes.length];
  const r3 = techRunes[(frame * 11) % techRunes.length];
  const message = messages[frame % messages.length];
  
  const variants = [
    `[${r1} ${core} ${r2}] ${message}`,
    `❬${r1}${r2} ${core} ${r3}❭ ${message}`,
    ` ${r1} ⸢${core}⸣ ${r2}  ${message}`
  ];
  
  const variant = variants[frame % variants.length];
  
  return (
    <Text color="redBright" bold>
      {variant}
    </Text>
  );
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/animations/GlitchAnimation.tsx`

---

## Feature 4 : Animation Manager

### Description

Gestionnaire centralisé pour démarrer/arrêter les animations selon le type d'outil.

### Implémentation

```typescript
import React from 'react';
import { CircleAnimation } from './CircleAnimation';
import { TransmutationAnimation } from './TransmutationAnimation';
import { GlitchAnimation } from './GlitchAnimation';

export type AnimationType = 'circle' | 'transmutation' | 'glitch';

interface AnimationManagerProps {
  type: AnimationType;
  toolName: string;
  isActive: boolean;
}

export const AnimationManager: React.FC<AnimationManagerProps> = ({ 
  type, 
  toolName, 
  isActive 
}) => {
  const getMessage = (toolName: string): string => {
    const messages: Record<string, string> = {
      'read_file': 'LECTURE DU CODE...',
      'grep_files': 'RECHERCHE DE PATTERNS...',
      'brain_search': 'CONSULTATION DE LA BASE DE CONNAISSANCE...',
      'write_file': 'ÉCRITURE DU CODE...',
      'run_command': 'EXÉCUTION DE LA COMMANDE...'
    };
    return messages[toolName] || 'TRAITEMENT EN COURS...';
  };

  switch (type) {
    case 'circle':
      return <CircleAnimation message={getMessage(toolName)} isActive={isActive} />;
    case 'transmutation':
      return <TransmutationAnimation message={getMessage(toolName)} isActive={isActive} />;
    case 'glitch':
      return <GlitchAnimation isActive={isActive} />;
    default:
      return null;
  }
};

// Helper pour mapper outils → animations
export const getAnimationForTool = (toolName: string): AnimationType => {
  const CALM_TOOLS = new Set(['read_file', 'list_directory', 'get_file_info']);
  const MODERATE_TOOLS = new Set(['grep_files', 'brain_search', 'search_files', 'read_image']);
  const INTENSE_TOOLS = new Set(['write_file', 'edit_file', 'create_file', 'delete_path', 'run_command']);
  
  if (CALM_TOOLS.has(toolName)) {
    return 'circle';
  } else if (MODERATE_TOOLS.has(toolName)) {
    return 'transmutation';
  } else if (INTENSE_TOOLS.has(toolName)) {
    return 'glitch';
  }
  
  return 'circle'; // Default
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/animations/AnimationManager.tsx`
- `packages/cli/src/tui/components/shared/animations/index.ts`

---

## Intégration dans le TUI

### Utilisation dans App.tsx

```typescript
// Dans App.tsx ou useAgent.ts
const [currentAnimation, setCurrentAnimation] = useState<{
  type: AnimationType;
  toolName: string;
} | null>(null);

// Dans les handlers
const handleToolCall = (toolName: string) => {
  const animationType = getAnimationForTool(toolName);
  setCurrentAnimation({ type: animationType, toolName });
};

const handleToolResult = () => {
  setCurrentAnimation(null);
};

// Dans le render
{currentAnimation && (
  <Box marginY={1}>
    <AnimationManager
      type={currentAnimation.type}
      toolName={currentAnimation.toolName}
      isActive={true}
    />
  </Box>
)}
```

---

## Optimisations

### Performance

1. **Désactivation conditionnelle** : Ne pas démarrer d'animation si l'opération est très rapide (< 100ms)
2. **Throttling** : Limiter la fréquence d'update si nécessaire
3. **Cleanup** : Toujours nettoyer les intervals dans `useEffect`

### Compatibilité Terminal

1. **Fallback ASCII** : Si les symboles Unicode ne s'affichent pas, utiliser des alternatives ASCII
2. **Détection de support** : Détecter le support Unicode et adapter

---

## Tests

### Scénarios de Test

1. **Animation simple** : Démarrer/arrêter chaque type d'animation
2. **Changement d'animation** : Passer d'un type à l'autre
3. **Cleanup** : Vérifier que les intervals sont bien nettoyés
4. **Performance** : Mesurer l'impact sur les temps d'exécution

---

## Métriques de Succès

- Animations fluides sans lag
- Cleanup correct (pas de fuites mémoire)
- Feedback visuel clair pour l'utilisateur
- Compatibilité avec différents terminaux
