# Beautification du Terminal : Animations ASCII pour l'Agent

## Vue d'ensemble

Ce document décrit les améliorations visuelles à apporter au terminal lors des temps d'attente de l'agent, transformant les moments de réflexion en une expérience visuelle engageante avec des animations ASCII de style "daemon summoning".

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

### Intégration

Utiliser les callbacks `onToolCall` et `onToolResult` dans `rag-agent.ts` pour déclencher les animations appropriées.

---

## Option 1 : Le Cercle (Rotation)

### Description

Animation rotative avec des runes autour d'un centre fixe. Style calme et méditatif, adapté aux opérations de lecture et d'analyse.

### Caractéristiques

- **Vitesse** : 150ms par frame
- **Style** : Méditatif, calme
- **Usage** : `read_file`, `list_directory`, analyse de code

### Implémentation

```typescript
class CircleAnimation {
    private runes = ["᚛", "ᚨ", "ᛒ", "ᛟ", "᚜", "⸸", "‡"];
    private center = "⛧";
    private index = 0;
    private intervalId?: NodeJS.Timeout;

    start(message: string = "INVOCATION DU CODE..."): void {
        this.intervalId = setInterval(() => {
            // Rotation du tableau
            const rotated = [...this.runes.slice(this.index), ...this.runes.slice(0, this.index)];
            const left = rotated.slice(0, 3).join("");
            const right = rotated.slice(rotated.length - 3).join("");
            
            process.stdout.write(`\r⟪ ${left} ${this.center} ${right} ⟫ ${message}`);
            
            this.index = (this.index + 1) % this.runes.length;
        }, 150);
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            process.stdout.write('\r' + ' '.repeat(80) + '\r'); // Clear line
        }
    }
}
```

### Exemple de sortie

```
⟪ ᚛ ᚨ ᛒ ⛧ ᚜ ⸸ ‡ ⟫ INVOCATION DU CODE...
```

---

## Option 2 : Transmutation (Focus Central)

### Description

Animation avec symboles alchimiques qui changent au centre. Style modéré, adapté aux opérations de recherche et d'analyse.

### Caractéristiques

- **Vitesse** : 200ms par frame
- **Style** : Modéré, focalisé
- **Usage** : `grep_files`, `brain_search`, `search_files`

### Implémentation

```typescript
class TransmutationAnimation {
    private symbols = ["⍟", "🜂", "☿", "☉", "♄", "🜄", "∮"];
    private index = 0;
    private intervalId?: NodeJS.Timeout;

    start(message: string = "ANALYSE EN COURS..."): void {
        this.intervalId = setInterval(() => {
            const sym = this.symbols[this.index];
            process.stdout.write(`\r⁅ ⸸ ⁆—[ ${sym} ]—⁅ ⸸ ⁆ ${message}`);
            
            this.index = (this.index + 1) % this.symbols.length;
        }, 200);
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            process.stdout.write('\r' + ' '.repeat(80) + '\r');
        }
    }
}
```

### Exemple de sortie

```
⁅ ⸸ ⁆—[ ⍟ ]—⁅ ⸸ ⁆ ANALYSE EN COURS...
```

---

## Option 3 : Le Glitch (Chaos Mathématique)

### Description

Animation chaotique avec symboles mathématiques aléatoires. Style intense, adapté aux opérations critiques de modification.

### Caractéristiques

- **Vitesse** : 100ms par frame
- **Style** : Intense, chaotique
- **Usage** : `write_file`, `edit_file`, `run_command`, `delete_path`

### Implémentation

```typescript
class GlitchAnimation {
    private techRunes = ["∇", "∫", "∃", "∀", "∴", "∵", "⊕", "⊗", "⌇"];
    private core = "⛧";
    private messages = [
        "...COMPILING CURSE...",
        "...SUMMONING COMPILER...",
        "...PARSING SOULS...",
        "...EXECUTING RITUAL...",
        "...BINDING ENTITIES..."
    ];
    private intervalId?: NodeJS.Timeout;

    start(): void {
        this.intervalId = setInterval(() => {
            const r1 = this.techRunes[Math.floor(Math.random() * this.techRunes.length)];
            const r2 = this.techRunes[Math.floor(Math.random() * this.techRunes.length)];
            const r3 = this.techRunes[Math.floor(Math.random() * this.techRunes.length)];
            const message = this.messages[Math.floor(Math.random() * this.messages.length)];
            
            const variants = [
                `[${r1} ${this.core} ${r2}] ${message}`,
                `❬${r1}${r2} ${this.core} ${r3}❭ ${message}`,
                ` ${r1} ⸢${this.core}⸣ ${r2}  ${message}`
            ];
            
            const variant = variants[Math.floor(Math.random() * variants.length)];
            process.stdout.write(`\r${variant}`);
        }, 100);
    }

    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            process.stdout.write('\r' + ' '.repeat(80) + '\r');
        }
    }
}
```

### Exemple de sortie

```
[∇ ⛧ ∫] ...COMPILING CURSE...
❬∃∀ ⛧ ∴❭ ...SUMMONING COMPILER...
 ⊕ ⸢⛧⸣ ⊗  ...PARSING SOULS...
```

---

## Intégration dans RagAgent

### Mapping Outils → Animations

```typescript
// Dans rag-agent.ts
private getAnimationForTool(toolName: string): AnimationType {
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
}
```

### Utilisation dans les Callbacks

```typescript
// Dans le constructeur de RagAgent
this.onToolCall = (toolName: string, args: Record<string, any>) => {
    const animationType = this.getAnimationForTool(toolName);
    this.startAnimation(animationType, toolName);
};

this.onToolResult = (toolName: string, result: any, success: boolean, durationMs: number) => {
    this.stopAnimation();
    
    if (this.verbose) {
        const icon = success ? '✅' : '❌';
        console.log(`   ${icon} ${toolName} (${durationMs}ms)`);
    }
};
```

### Gestionnaire d'Animations

```typescript
class AnimationManager {
    private circle = new CircleAnimation();
    private transmutation = new TransmutationAnimation();
    private glitch = new GlitchAnimation();
    private current?: AnimationType;

    start(type: AnimationType, toolName: string): void {
        this.stop(); // Stop any running animation
        
        this.current = type;
        const message = this.getMessageForTool(toolName);
        
        switch (type) {
            case 'circle':
                this.circle.start(message);
                break;
            case 'transmutation':
                this.transmutation.start(message);
                break;
            case 'glitch':
                this.glitch.start();
                break;
        }
    }

    stop(): void {
        this.circle.stop();
        this.transmutation.stop();
        this.glitch.stop();
        this.current = undefined;
    }

    private getMessageForTool(toolName: string): string {
        const messages: Record<string, string> = {
            'read_file': 'LECTURE DU CODE...',
            'grep_files': 'RECHERCHE DE PATTERNS...',
            'brain_search': 'CONSULTATION DE LA BASE DE CONNAISSANCE...',
            'write_file': 'ÉCRITURE DU CODE...',
            'run_command': 'EXÉCUTION DE LA COMMANDE...'
        };
        
        return messages[toolName] || 'TRAITEMENT EN COURS...';
    }
}
```

---

## Personnalisation

### Couleurs (si supportées)

```typescript
// Utiliser chalk ou colors pour le terminal
import chalk from 'chalk';

// Option 1 : Rouge démon
const style = (text: string) => chalk.redBright(text);

// Option 2 : Effet glow (si supporté)
const glowStyle = (text: string) => 
    chalk.redBright(text) + chalk.red.dim('█');
```

### Messages Personnalisés

Permettre la personnalisation des messages selon le contexte :

```typescript
interface AnimationConfig {
    message?: string;
    speed?: number;
    style?: 'calm' | 'moderate' | 'intense';
}
```

---

## Recommandations d'Usage

### Par Type d'Opération

| Opération | Animation | Raison |
|-----------|-----------|--------|
| `read_file` | Circle | Lecture passive, calme |
| `list_directory` | Circle | Exploration, calme |
| `grep_files` | Transmutation | Recherche active, modérée |
| `brain_search` | Transmutation | Consultation base, modérée |
| `write_file` | Glitch | Modification critique, intense |
| `edit_file` | Glitch | Modification critique, intense |
| `run_command` | Glitch | Exécution système, intense |
| `delete_path` | Glitch | Opération destructive, intense |

### Par Contexte

- **Mode silencieux** : Désactiver les animations si `verbose: false`
- **Mode batch** : Utiliser une animation unique pour toute la séquence
- **Mode interactif** : Animations individuelles par outil

---

## Performance

### Optimisations

1. **Désactivation conditionnelle** : Ne pas démarrer d'animation si l'opération est très rapide (< 100ms)
2. **Throttling** : Limiter la fréquence d'update si nécessaire
3. **Cleanup** : Toujours nettoyer les intervals à la fin

### Code de Cleanup

```typescript
// Dans RagAgent
private cleanup(): void {
    this.animationManager.stop();
    // ... autres cleanups
}

// Appeler cleanup dans finally blocks
try {
    // ... opération
} finally {
    this.cleanup();
}
```

---

## Exemple Complet d'Intégration

```typescript
// Dans rag-agent.ts
export class RagAgent {
    private animationManager = new AnimationManager();

    constructor(...) {
        // ...
        this.onToolCall = (toolName: string, args: Record<string, any>) => {
            if (this.verbose) {
                const animationType = this.getAnimationForTool(toolName);
                this.animationManager.start(animationType, toolName);
            }
        };

        this.onToolResult = (toolName: string, result: any, success: boolean, durationMs: number) => {
            this.animationManager.stop();
            
            if (this.verbose) {
                const icon = success ? '✅' : '❌';
                console.log(`   ${icon} ${toolName} (${durationMs}ms)`);
            }
        };
    }

    private getAnimationForTool(toolName: string): AnimationType {
        // ... mapping logic
    }
}
```

---

## Animation Spéciale : Ingestion de Répertoire

### Contexte

L'ingestion initiale d'un répertoire (`ingest_directory`) est une opération longue (jusqu'à 4 minutes) qui nécessite un feedback visuel spécial. Contrairement aux animations rapides des outils, cette animation doit :

1. **Informer** : Expliquer que c'est une ingestion initiale (pas systématique)
2. **Rassurer** : Indiquer le temps estimé (jusqu'à 4 minutes)
3. **Engager** : Utiliser une animation démoniaque mais élégante
4. **Optimiser** : Utiliser les animations HTML existantes adaptées pour Ink/React

### Design Proposé

#### Message Principal

```
⛧ INGESTING DIRECTORY INTO THE BRAIN ⛧
   Initial ingestion may take up to 4 minutes, please be patient...
   This is a one-time process. Future searches will be instant.
```

#### Animation Visuelle

Utiliser une combinaison des animations existantes avec une intensité modérée à élevée :

- **Phase 1 (0-30s)** : Animation "Transmutation" (modérée) - Scan initial
- **Phase 2 (30s-2min)** : Animation "Glitch" (intense) - Traitement actif
- **Phase 3 (2min+)** : Animation "Circle" (calme) - Finalisation

### Adaptation HTML → Ink/React

#### Analyse des Animations HTML

Les animations HTML utilisent :
- `setInterval()` pour les boucles d'animation
- Rotation de tableaux de symboles
- Random pour les variantes (Glitch)
- `innerText` pour mettre à jour le DOM

#### Conversion pour Ink/React

**Principe** : Utiliser `useState` + `useEffect` avec `setInterval` pour gérer l'état de l'animation.

**Composant React pour Ink** :

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface IngestionAnimationProps {
  directoryPath: string;
  isActive: boolean;
}

export const IngestionAnimation: React.FC<IngestionAnimationProps> = ({ 
  directoryPath, 
  isActive 
}) => {
  const [frame, setFrame] = useState(0);
  const [phase, setPhase] = useState<'scan' | 'processing' | 'finalizing'>('scan');
  
  // Calculer la phase basée sur le temps écoulé
  useEffect(() => {
    if (!isActive) return;
    
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      
      if (elapsed < 30000) {
        setPhase('scan');
      } else if (elapsed < 120000) {
        setPhase('processing');
      } else {
        setPhase('finalizing');
      }
      
      setFrame(prev => prev + 1);
    }, 150); // Même vitesse que les animations HTML
    
    return () => clearInterval(interval);
  }, [isActive]);
  
  // Rendu selon la phase
  const renderAnimation = () => {
    switch (phase) {
      case 'scan':
        return <TransmutationFrame frame={frame} />;
      case 'processing':
        return <GlitchFrame frame={frame} />;
      case 'finalizing':
        return <CircleFrame frame={frame} />;
    }
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
    </Box>
  );
};
```

#### Composants d'Animation (Adaptation HTML)

**TransmutationFrame** (Phase Scan) :

```typescript
const TransmutationFrame: React.FC<{ frame: number }> = ({ frame }) => {
  const alchSymbols = ["⍟", "🜂", "☿", "☉", "♄", "🜄", "∮"];
  const idx = frame % alchSymbols.length;
  const sym = alchSymbols[idx];
  
  return (
    <Text color="yellowBright">
      ⁅ ⸸ ⁆—[ {sym} ]—⁅ ⸸ ⁆ SCANNING FILES...
    </Text>
  );
};
```

**GlitchFrame** (Phase Processing) :

```typescript
const GlitchFrame: React.FC<{ frame: number }> = ({ frame }) => {
  const techRunes = ["∇", "∫", "∃", "∀", "∴", "∵", "⊕", "⊗", "⌇"];
  const core = "⛧";
  
  // Utiliser frame pour pseudo-random (déterministe mais varié)
  const r1 = techRunes[(frame * 3) % techRunes.length];
  const r2 = techRunes[(frame * 7) % techRunes.length];
  const r3 = techRunes[(frame * 11) % techRunes.length];
  
  const variants = [
    `[${r1} ${core} ${r2}] ...PROCESSING FILES...`,
    `❬${r1}${r2} ${core} ${r3}❭ ...GENERATING EMBEDDINGS...`,
    ` ${r1} ⸢${core}⸣ ${r2}  ...STORING IN BRAIN...`
  ];
  
  const variant = variants[frame % variants.length];
  
  return (
    <Text color="redBright" bold>
      {variant}
    </Text>
  );
};
```

**CircleFrame** (Phase Finalizing) :

```typescript
const CircleFrame: React.FC<{ frame: number }> = ({ frame }) => {
  const runes = ["᚛", "ᚨ", "ᛒ", "ᛟ", "᚜", "⸸", "‡"];
  const center = "⛧";
  const idx = frame % runes.length;
  
  // Rotation du tableau
  const rotated = [...runes.slice(idx), ...runes.slice(0, idx)];
  const left = rotated.slice(0, 3).join("");
  const right = rotated.slice(rotated.length - 3).join("");
  
  return (
    <Text color="greenBright">
      ⟪ {left} {center} {right} ⟫ FINALIZING INGESTION...
    </Text>
  );
};
```

### Intégration dans le TUI

#### Détection de l'Ingestion

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

#### Affichage dans App.tsx

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

### Optimisations

#### Performance

1. **Throttling** : Limiter les updates à 150-200ms (comme les animations HTML)
2. **Cleanup** : Toujours nettoyer les intervals dans `useEffect` cleanup
3. **Conditional Rendering** : Ne rendre que si `isIngesting === true`

#### Expérience Utilisateur

1. **Progression** : Optionnellement afficher un pourcentage si disponible
2. **Interruption** : Permettre Ctrl+C avec message de confirmation
3. **Feedback Final** : Afficher un message de succès avec statistiques

### Faisabilité

#### ✅ Avantages

- **Ink Support** : Ink supporte bien les animations avec `useState` + `useEffect`
- **Performance** : Les animations sont légères (juste du texte qui change)
- **Compatibilité** : Les symboles Unicode fonctionnent bien dans les terminaux modernes
- **Réutilisabilité** : Les composants d'animation peuvent être réutilisés ailleurs

#### ⚠️ Considérations

1. **Terminal Compatibility** : Certains terminaux peuvent ne pas supporter tous les symboles Unicode
   - **Solution** : Fallback vers des symboles ASCII simples si détecté

2. **Performance avec Longues Ingestion** : 4 minutes d'animation = beaucoup de re-renders
   - **Solution** : Utiliser `useMemo` pour optimiser les calculs de frame

3. **Concurrence** : Que se passe-t-il si plusieurs ingests sont lancés ?
   - **Solution** : Gérer une queue d'animations ou afficher la dernière

4. **Couleurs** : Certains terminaux peuvent ne pas supporter les couleurs
   - **Solution** : Détecter le support et utiliser du texte simple si nécessaire

### Message Alternatif (Plus Démoniaque)

Si on veut quelque chose de plus "daemon" :

```
⛧ ⛧ ⛧  INVOCATION DU RÉPERTOIRE  ⛧ ⛧ ⛧
   Le démon scelle les fichiers dans sa mémoire...
   Première invocation : jusqu'à 4 minutes de patience requise.
   Les invocations suivantes seront instantanées.
```

Ou encore plus stylé :

```
⟪ ᚛ ᚨ ᛒ ⛧ ᚜ ⸸ ‡ ⟫  INGESTING DIRECTORY INTO THE BRAIN
   Initial ritual may take up to 4 minutes...
   This is a one-time binding. Future queries will be instant.
```

### Recommandations Finales

1. **Utiliser les animations HTML** : Elles sont bien conçues et peuvent être facilement adaptées
2. **Phases multiples** : Changer d'animation selon le temps écoulé pour éviter la monotonie
3. **Message clair** : Expliquer que c'est une ingestion initiale, pas systématique
4. **Feedback progressif** : Si possible, afficher le nombre de fichiers traités
5. **Style cohérent** : Maintenir l'identité "daemon" tout en restant informatif

---

## Tests

### Scénarios de Test

1. **Animation simple** : Démarrer/arrêter une animation Circle
2. **Changement d'animation** : Passer de Circle à Glitch pendant une séquence
3. **Cleanup** : Vérifier que les intervals sont bien nettoyés
4. **Performance** : Mesurer l'impact sur les temps d'exécution
5. **Ingestion longue** : Tester l'animation sur une ingestion de 4 minutes
6. **Phases multiples** : Vérifier les transitions entre phases

### Exemple de Test

```typescript
describe('AnimationManager', () => {
    it('should start and stop circle animation', (done) => {
        const manager = new AnimationManager();
        manager.start('circle', 'read_file');
        
        setTimeout(() => {
            manager.stop();
            // Vérifier que l'animation s'est arrêtée
            done();
        }, 500);
    });
    
    it('should transition through phases during ingestion', async () => {
        const { render } = await import('ink-testing-library');
        const { IngestionAnimation } = await import('./IngestionAnimation');
        
        const { lastFrame } = render(
            <IngestionAnimation directoryPath="/test" isActive={true} />
        );
        
        // Attendre et vérifier les transitions
        await new Promise(resolve => setTimeout(resolve, 35000));
        // Vérifier que la phase a changé
    });
});
```

---

## Notes Finales

Ces animations transforment les moments d'attente en une expérience visuelle engageante, renforçant l'identité "daemon" de l'agent tout en fournissant un feedback clair sur l'activité en cours.

L'implémentation est légère et performante, avec un système de mapping flexible qui permet d'adapter l'intensité visuelle à la complexité de l'opération.

L'animation d'ingestion spéciale utilise les animations HTML existantes adaptées pour Ink/React, offrant une expérience visuelle riche tout en informant clairement l'utilisateur que c'est une opération initiale unique.

---

## Roadmaps Détaillées

Pour une implémentation guidée, chaque groupe de fonctionnalités a sa propre roadmap détaillée :

- **[Animations Générales](./beautification-roadmaps/ROADMAP_ANIMATIONS.md)** : Circle, Transmutation, Glitch
- **[Animation Ingestion](./beautification-roadmaps/ROADMAP_INGESTION_ANIMATION.md)** : Animation spéciale multi-phases
- **[Diff Preview](./beautification-roadmaps/ROADMAP_DIFF_PREVIEW.md)** : Preview et confirmation de diff
- **[Liens Clickables](./beautification-roadmaps/ROADMAP_CLICKABLE_LINKS.md)** : Système de liens Ctrl+Click

Voir le [README des roadmaps](./beautification-roadmaps/README.md) pour l'ordre d'implémentation recommandé et une vue d'ensemble.

---

## Notes Additionnelles (PS Lucie)

Les fonctionnalités suivantes sont également requises et couvertes dans les roadmaps détaillées :

1. **Système de diff preview** : Les tool calls qui affectent des fichiers doivent montrer la diff avant application
2. **Liens clickables** : Un lien Ctrl+Click vers le fichier doit être affiché avant chaque bloc de diff
3. **Historique de diff** : Une fois la modification effective, afficher la diff en historique avec lien clickable
4. **Liens dans les résultats** : Les lectures de fichiers via grep/search doivent afficher des liens clickables
5. **Trimming intelligent** : Même si on trim les liens pour l'affichage, le click doit ramener au fichier complet

Toutes ces fonctionnalités sont détaillées dans les roadmaps correspondantes.