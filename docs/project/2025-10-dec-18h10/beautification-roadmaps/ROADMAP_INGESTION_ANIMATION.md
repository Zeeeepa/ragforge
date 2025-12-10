# Roadmap : Animation Spéciale pour l'Ingestion de Répertoire

## Vue d'ensemble

Cette roadmap couvre l'implémentation d'une animation spéciale pour l'ingestion initiale de répertoires, une opération longue (jusqu'à 4 minutes) qui nécessite un feedback visuel particulier.

## Objectifs

- **Informer** : Expliquer que c'est une ingestion initiale (pas systématique)
- **Rassurer** : Indiquer le temps estimé (jusqu'à 4 minutes)
- **Engager** : Utiliser une animation démoniaque mais élégante
- **Optimiser** : Utiliser les animations HTML existantes adaptées pour Ink/React

---

## Contexte

L'ingestion initiale d'un répertoire (`ingest_directory`) est une opération longue qui nécessite :
1. Un message clair expliquant que c'est une opération initiale unique
2. Une estimation de temps pour rassurer l'utilisateur
3. Une animation engageante pour maintenir l'attention
4. Des phases différentes selon le temps écoulé

---

## Feature : Animation Multi-Phases pour Ingestion

### Description

Animation qui change selon le temps écoulé, utilisant les trois types d'animations existantes :
- **Phase 1 (0-30s)** : Transmutation (scan initial)
- **Phase 2 (30s-2min)** : Glitch (traitement actif)
- **Phase 3 (2min+)** : Circle (finalisation)

### Message Principal

```
⛧ INGESTING DIRECTORY INTO THE BRAIN ⛧
   Initial ingestion may take up to 4 minutes, please be patient...
   This is a one-time process. Future searches will be instant.
```

### Implémentation

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { CircleAnimation } from './CircleAnimation';
import { TransmutationAnimation } from './TransmutationAnimation';
import { GlitchAnimation } from './GlitchAnimation';

interface IngestionAnimationProps {
  directoryPath: string;
  isActive: boolean;
}

type IngestionPhase = 'scan' | 'processing' | 'finalizing';

export const IngestionAnimation: React.FC<IngestionAnimationProps> = ({ 
  directoryPath, 
  isActive 
}) => {
  const [phase, setPhase] = useState<IngestionPhase>('scan');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  
  useEffect(() => {
    if (!isActive) return;
    
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);
      
      // Déterminer la phase
      if (elapsed < 30) {
        setPhase('scan');
      } else if (elapsed < 120) {
        setPhase('processing');
      } else {
        setPhase('finalizing');
      }
    }, 1000); // Update chaque seconde
    
    return () => clearInterval(interval);
  }, [isActive]);
  
  const renderAnimation = () => {
    switch (phase) {
      case 'scan':
        return <TransmutationAnimation message="SCANNING FILES..." isActive={isActive} />;
      case 'processing':
        return <GlitchAnimation isActive={isActive} />;
      case 'finalizing':
        return <CircleAnimation message="FINALIZING INGESTION..." isActive={isActive} />;
    }
  };
  
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>
        <Text color="redBright" bold>
          ⛧ INGESTING DIRECTORY INTO THE BRAIN ⛧
        </Text>
      </Box>
      <Box marginTop={1}>
        {renderAnimation()}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Initial ingestion may take up to 4 minutes, please be patient...
        </Text>
      </Box>
      <Box>
        <Text color="gray" dimColor>
          This is a one-time process. Future searches will be instant.
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="cyan" dimColor>
          Directory: {directoryPath}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="yellow" dimColor>
          Elapsed: {formatTime(elapsedSeconds)}
        </Text>
      </Box>
    </Box>
  );
};
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/animations/IngestionAnimation.tsx`

---

## Intégration dans le TUI

### Détection de l'Ingestion

Dans `useAgent.ts` ou `App.tsx`, détecter quand `ingest_directory` est appelé :

```typescript
// Dans useAgent.ts
const [isIngesting, setIsIngesting] = useState(false);
const [ingestionPath, setIngestionPath] = useState<string | null>(null);

useEffect(() => {
  const handleToolCall = (toolName: string, args: Record<string, any>) => {
    if (toolName === 'ingest_directory') {
      setIsIngesting(true);
      setIngestionPath(args.path);
    }
  };
  
  const handleToolResult = (toolName: string) => {
    if (toolName === 'ingest_directory') {
      setIsIngesting(false);
      setIngestionPath(null);
    }
  };
  
  // Attacher les handlers
  agent.onToolCall = handleToolCall;
  agent.onToolResult = handleToolResult;
  
  return () => {
    // Cleanup
  };
}, [agent]);
```

### Affichage dans App.tsx

```typescript
// Dans App.tsx
{isIngesting && ingestionPath && (
  <Box marginY={2}>
    <IngestionAnimation 
      directoryPath={ingestionPath} 
      isActive={isIngesting} 
    />
  </Box>
)}
```

---

## Optimisations

### Performance

1. **Update fréquence** : Mettre à jour le temps écoulé chaque seconde (pas chaque frame)
2. **Cleanup** : Nettoyer les intervals quand l'ingestion se termine
3. **Conditional Rendering** : Ne rendre que si `isIngesting === true`

### Expérience Utilisateur

1. **Progression** : Optionnellement afficher un pourcentage si disponible depuis le backend
2. **Interruption** : Permettre Ctrl+C avec message de confirmation
3. **Feedback Final** : Afficher un message de succès avec statistiques

---

## Messages Alternatifs (Plus Démoniaques)

### Option 1 : Style Modéré

```
⛧ INGESTING DIRECTORY INTO THE BRAIN ⛧
   Initial ingestion may take up to 4 minutes, please be patient...
   This is a one-time process. Future searches will be instant.
```

### Option 2 : Style Démoniaque

```
⛧ ⛧ ⛧  INVOCATION DU RÉPERTOIRE  ⛧ ⛧ ⛧
   Le démon scelle les fichiers dans sa mémoire...
   Première invocation : jusqu'à 4 minutes de patience requise.
   Les invocations suivantes seront instantanées.
```

### Option 3 : Style Rituel

```
⟪ ᚛ ᚨ ᛒ ⛧ ᚜ ⸸ ‡ ⟫  INGESTING DIRECTORY INTO THE BRAIN
   Initial ritual may take up to 4 minutes...
   This is a one-time binding. Future queries will be instant.
```

---

## Tests

### Scénarios de Test

1. **Animation longue** : Tester l'animation sur une ingestion de 4 minutes
2. **Phases multiples** : Vérifier les transitions entre phases
3. **Cleanup** : Vérifier que l'animation s'arrête correctement
4. **Interruption** : Tester l'interruption avec Ctrl+C

---

## Métriques de Succès

- Animation fluide sur toute la durée
- Transitions de phases visibles et cohérentes
- Message clair et rassurant pour l'utilisateur
- Pas d'impact sur les performances de l'ingestion
