# Gestion des Sessions de Conversation

Date: 2025-12-09

## Vue d'Ensemble

Les sessions de conversation sont liées au **Current Working Directory (CWD)** pour permettre :
- Reprendre des conversations précédentes dans le même projet
- Séparer les conversations par projet/répertoire
- Proposer les sessions au démarrage de ragforge

## Flux au Démarrage

```
┌─────────────────────────────────────┐
│  RagForge démarre                   │
│  CWD détecté                        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Vérifier sessions pour CWD          │
│  getSessionsByCwd(cwd)               │
└──────────────┬──────────────────────┘
               │
        ┌──────┴──────┐
        │              │
        ▼              ▼
┌──────────┐    ┌──────────────┐
│ Sessions │    │ Pas de       │
│ trouvées │    │ sessions     │
└────┬─────┘    └──────┬───────┘
     │                  │
     ▼                  ▼
┌──────────┐    ┌──────────────┐
│ Afficher │    │ Créer nouvelle│
│ liste    │    │ session       │
│ sessions │    └───────────────┘
└────┬─────┘
     │
     ▼
┌──────────┐
│ User     │
│ choisit  │
└────┬─────┘
     │
  ┌──┴──┐
  │     │
  ▼     ▼
┌───┐ ┌──────────┐
│   │ │ Créer    │
│   │ │ nouvelle │
│   │ └──────────┘
│   │
│   ▼
│ ┌──────────┐
│ │ Charger  │
│ │ session  │
│ └──────────┘
```

## Interface de Sélection

### Option 1 : Modal au Démarrage

```
┌─────────────────────────────────────────────┐
│  📚 Sessions de Conversation                │
│                                             │
│  CWD: /home/user/my-project                │
│                                             │
│  [1] Session du 2025-12-09 14:30           │
│      15 tours • Dernier: "regarde les..."  │
│                                             │
│  [2] Session du 2025-12-08 10:15           │
│      8 tours • Dernier: "comment faire..."  │
│                                             │
│  [3] Créer nouvelle session                 │
│                                             │
│  Sélection: [1]                            │
└─────────────────────────────────────────────┘
```

### Option 2 : Commande `/sessions`

```
User: /sessions

Assistant: Sessions disponibles pour /home/user/my-project:

1. Session du 2025-12-09 14:30 (15 tours)
   Dernier message: "regarde les commandes set-persona"
   Utiliser: /load-session <sessionId>

2. Session du 2025-12-08 10:15 (8 tours)
   Dernier message: "comment faire..."
   Utiliser: /load-session <sessionId>

Créer nouvelle session: /new-session
```

## Structure de Données

### Session Node

```cypher
CREATE (s:ConversationSession {
  sessionId: "uuid",
  cwd: "/home/user/my-project",  // Normalisé (résolu)
  projectPath: "/home/user/my-project/.ragforge",  // Optionnel
  startTime: datetime(),
  lastActivity: datetime(),
  turnCount: 15,
  lastMessage: "regarde les commandes..."
})
```

### Requête pour Sessions par CWD

```cypher
MATCH (s:ConversationSession {cwd: $cwd})
RETURN s
ORDER BY s.lastActivity DESC
LIMIT 10
```

## Normalisation du CWD

```typescript
import * as path from 'path';
import * as fs from 'fs';

function normalizeCwd(cwd: string): string {
  // Résoudre les chemins relatifs
  const resolved = path.resolve(cwd);
  
  // Résoudre les symlinks
  const realPath = fs.realpathSync(resolved);
  
  // Normaliser les séparateurs (Unix style)
  return path.normalize(realPath);
}
```

## Intégration dans useAgent

```typescript
// Au démarrage
useEffect(() => {
  const currentCwd = process.cwd();
  const normalizedCwd = normalizeCwd(currentCwd);
  
  conversationStorage.getSessionsByCwd(normalizedCwd).then(sessions => {
    if (sessions.length > 0) {
      // Afficher interface de sélection
      setShowSessionSelector(true);
      setAvailableSessions(sessions);
    } else {
      // Créer nouvelle session automatiquement
      conversationStorage.createSession(normalizedCwd).then(sessionId => {
        setCurrentSessionId(sessionId);
      });
    }
  });
}, []);
```

## Commandes Slash

- `/sessions` : Lister sessions pour CWD actuel
- `/load-session <sessionId>` : Charger une session
- `/new-session` : Créer nouvelle session
- `/current-session` : Afficher info session actuelle
