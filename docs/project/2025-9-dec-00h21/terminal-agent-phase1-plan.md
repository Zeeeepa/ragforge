# Terminal Agent - Plan Phase 1

> Basé sur l'analyse de gemini-cli et l'architecture RagForge existante

## Objectif Phase 1

Créer une interface terminal interactive minimale mais fonctionnelle pour interagir avec le RagAgent.

## Stack Technique

- **Ink 6** - React pour terminal
- **React 19** - Compatible avec Ink 6
- **TypeScript**
- Package: `@luciformresearch/ragforge-terminal` (nouveau)

## Structure Proposée

```
packages/terminal/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Point d'entrée CLI
│   ├── app.tsx               # Composant racine
│   │
│   ├── providers/
│   │   ├── SettingsProvider.tsx
│   │   ├── KeypressProvider.tsx
│   │   └── AgentProvider.tsx    # Context pour RagAgent
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppContainer.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── MainContent.tsx
│   │   │   └── Footer.tsx
│   │   │
│   │   ├── messages/
│   │   │   ├── MessageList.tsx
│   │   │   ├── UserMessage.tsx
│   │   │   ├── AssistantMessage.tsx
│   │   │   └── ToolMessage.tsx
│   │   │
│   │   ├── input/
│   │   │   └── InputPrompt.tsx
│   │   │
│   │   └── shared/
│   │       ├── Scrollable.tsx
│   │       └── Spinner.tsx
│   │
│   ├── hooks/
│   │   ├── useKeypress.ts
│   │   ├── useAgent.ts
│   │   └── useScroll.ts
│   │
│   └── utils/
│       └── terminal.ts
│
└── test/
    └── *.test.tsx
```

## Composants Phase 1

### 1. AppContainer (layout principal)

```tsx
export const AppContainer: React.FC = () => {
  return (
    <Box flexDirection="column" height="100%">
      <Header />
      <Box flexGrow={1}>
        <MainContent />
      </Box>
      <InputPrompt />
      <Footer />
    </Box>
  );
};
```

### 2. Header (minimal)

```tsx
export const Header: React.FC = () => {
  const { projectName } = useSettings();
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold color="blue">RagForge</Text>
      <Text dimColor> | {projectName}</Text>
    </Box>
  );
};
```

### 3. MessageList

```tsx
export const MessageList: React.FC = () => {
  const { messages } = useAgent();
  return (
    <Scrollable>
      {messages.map((msg, i) => (
        <MessageItem key={i} message={msg} />
      ))}
    </Scrollable>
  );
};
```

### 4. InputPrompt (simplifié)

```tsx
export const InputPrompt: React.FC = () => {
  const [input, setInput] = useState('');
  const { sendMessage, isLoading } = useAgent();

  const handleSubmit = () => {
    if (input.trim() && !isLoading) {
      sendMessage(input);
      setInput('');
    }
  };

  return (
    <Box borderStyle="single" borderColor={isLoading ? 'gray' : 'green'}>
      <Text color="green">{'> '}</Text>
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        placeholder={isLoading ? 'Thinking...' : 'Ask something...'}
      />
    </Box>
  );
};
```

### 5. Footer (status bar)

```tsx
export const Footer: React.FC = () => {
  const { tokenCount, isConnected } = useAgent();
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text dimColor>Tokens: {tokenCount}</Text>
      <Text dimColor>Ctrl+C: quit | Ctrl+L: clear</Text>
      <Text color={isConnected ? 'green' : 'red'}>
        {isConnected ? '●' : '○'} Neo4j
      </Text>
    </Box>
  );
};
```

## Providers Phase 1

### AgentProvider

```tsx
interface AgentContextValue {
  messages: Message[];
  isLoading: boolean;
  tokenCount: number;
  sendMessage: (content: string) => Promise<void>;
  clearHistory: () => void;
}

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const agentRef = useRef<RagAgent | null>(null);

  // Initialize RagAgent
  useEffect(() => {
    const init = async () => {
      const brain = await BrainManager.getInstance();
      agentRef.current = await createRagAgent({ brain });
    };
    init();
  }, []);

  const sendMessage = async (content: string) => {
    setMessages(prev => [...prev, { role: 'user', content }]);
    setIsLoading(true);
    try {
      // Stream response from agent
      const response = await agentRef.current?.chat(content);
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AgentContext.Provider value={{ messages, isLoading, sendMessage, ... }}>
      {children}
    </AgentContext.Provider>
  );
};
```

## Fonctionnalités Phase 1

### Inclus:
- [x] Affichage messages user/assistant
- [x] Input texte basique (single-line)
- [x] Streaming réponses
- [x] Status bar (tokens, connexion)
- [x] Ctrl+C pour quitter
- [x] Ctrl+L pour clear

### Exclus (Phases futures):
- [ ] Mode VIM
- [ ] Multi-line input
- [ ] Tool confirmations interactives
- [ ] Session browser
- [ ] Settings dialog
- [ ] Themes
- [ ] Mouse support

## Dépendances

```json
{
  "dependencies": {
    "ink": "^6.0.0",
    "react": "^19.0.0",
    "@luciformresearch/ragforge": "workspace:*"
  },
  "devDependencies": {
    "ink-testing-library": "^4.0.0",
    "@types/react": "^19.0.0"
  }
}
```

## Options Ink

```typescript
render(<App />, {
  exitOnCtrlC: false,        // Gestion manuelle
  patchConsole: true,        // Rediriger console.log
  // Phase 1: pas de alternate buffer
  // alternateBuffer: false,
});
```

## Intégration avec RagAgent Existant

Le RagAgent actuel (`packages/core/src/runtime/agents/rag-agent.ts`) expose:
- `chat(prompt)` - Envoyer un message
- `getHistory()` - Historique conversation
- `clearHistory()` - Reset

On wrappera ces méthodes dans le `AgentProvider` pour exposer un state React réactif.

## Tests

```typescript
import { render } from 'ink-testing-library';

describe('InputPrompt', () => {
  it('should render placeholder when empty', () => {
    const { lastFrame } = render(<InputPrompt />);
    expect(lastFrame()).toContain('Ask something...');
  });

  it('should show loading state', () => {
    const { lastFrame } = render(
      <AgentContext.Provider value={{ isLoading: true, ... }}>
        <InputPrompt />
      </AgentContext.Provider>
    );
    expect(lastFrame()).toContain('Thinking...');
  });
});
```

## Estimation

- Setup package + config: 2h
- Providers (Settings, Agent): 3h
- Layout components: 2h
- Message components: 2h
- Input component: 3h
- Hooks + utils: 2h
- Tests basiques: 2h

**Total Phase 1: ~16h**
