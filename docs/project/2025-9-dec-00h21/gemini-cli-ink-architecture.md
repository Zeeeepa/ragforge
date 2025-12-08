# Gemini CLI - Architecture Ink (React Terminal)

> Analyse du repo `google-gemini/gemini-cli` - Apache 2.0
> Référence ingérée: `references-gemini-cli-v0qx` (24,562 fichiers, 7,437 embeddings)

## Stack Technique

- **React 19** + **Ink 6** pour le rendu terminal
- **Yoga** (Flexbox) pour les layouts
- **TypeScript**
- **esbuild** pour le bundling
- **Vitest** + `ink-testing-library` pour les tests

## Point d'Entrée Principal

Fichier: `packages/cli/src/gemini.tsx`

### Fonction `startInteractiveUI()`

```typescript
async function startInteractiveUI(
  config: Config,
  settings: LoadedSettings,
  startupWarnings: string[],
  workspaceRoot: string,
  resumedSessionData: ResumedSessionData | undefined,
  initializationResult: InitializationResult,
) {
  // Configuration alternate buffer (plein écran)
  const useAlternateBuffer = shouldEnterAlternateScreen(
    isAlternateBufferEnabled(settings),
    config.getScreenReader(),
  );

  // Mouse events
  const mouseEventsEnabled = useAlternateBuffer;
  if (mouseEventsEnabled) {
    enableMouseEvents();
    registerCleanup(() => disableMouseEvents());
  }

  // Console patching pour capturer logs
  const consolePatcher = new ConsolePatcher({
    onNewMessage: (msg) => coreEvents.emitConsoleLog(msg.type, msg.content),
    debugMode: config.getDebugMode(),
  });
  consolePatcher.patch();

  // Render Ink
  const instance = render(
    <AppWrapper />,
    {
      stdout: inkStdout,
      stderr: inkStderr,
      stdin: process.stdin,
      exitOnCtrlC: false,  // Gestion manuelle Ctrl+C
      isScreenReaderEnabled: config.getScreenReader(),
      onRender: ({ renderTime }) => {
        if (renderTime > SLOW_RENDER_MS) {
          recordSlowRender(config, renderTime);
        }
        profiler.reportFrameRendered();
      },
      patchConsole: false,
      alternateBuffer: useAlternateBuffer,
      incrementalRendering: settings.merged.ui?.incrementalRendering !== false,
    },
  );
}
```

## Pattern de Providers (Context React)

Architecture en oignon avec providers imbriqués:

```tsx
const AppWrapper = () => {
  useKittyKeyboardProtocol();
  return (
    <SettingsContext.Provider value={settings}>
      <KeypressProvider config={config} debugKeystrokeLogging={...}>
        <MouseProvider mouseEventsEnabled={...} debugKeystrokeLogging={...}>
          <ScrollProvider>
            <SessionStatsProvider>
              <VimModeProvider settings={settings}>
                <AppContainer
                  config={config}
                  startupWarnings={startupWarnings}
                  version={version}
                  resumedSessionData={resumedSessionData}
                  initializationResult={initializationResult}
                />
              </VimModeProvider>
            </SessionStatsProvider>
          </ScrollProvider>
        </MouseProvider>
      </KeypressProvider>
    </SettingsContext.Provider>
  );
};
```

### Providers Identifiés

| Provider | Responsabilité |
|----------|---------------|
| `SettingsContext` | Configuration utilisateur |
| `KeypressProvider` | Gestion clavier, raccourcis |
| `MouseProvider` | Events souris (scroll, click) |
| `ScrollProvider` | État de scroll global |
| `SessionStatsProvider` | Statistiques session (tokens, etc.) |
| `VimModeProvider` | Mode VIM (normal/insert/visual) |

## Structure des Composants

```
packages/cli/src/ui/
├── components/
│   ├── messages/          # Affichage messages
│   │   ├── UserMessage.tsx
│   │   ├── GeminiMessage.tsx
│   │   ├── ToolMessage.tsx
│   │   ├── ToolConfirmationMessage.tsx
│   │   ├── ToolResultDisplay.tsx
│   │   ├── DiffRenderer.tsx
│   │   ├── ErrorMessage.tsx
│   │   ├── WarningMessage.tsx
│   │   └── InfoMessage.tsx
│   │
│   ├── shared/            # Composants réutilisables
│   │   ├── TextInput.tsx
│   │   ├── Scrollable.tsx
│   │   ├── ScrollableList.tsx
│   │   ├── VirtualizedList.tsx
│   │   ├── MaxSizedBox.tsx
│   │   ├── RadioButtonSelect.tsx
│   │   ├── EnumSelector.tsx
│   │   ├── text-buffer.ts
│   │   └── vim-buffer-actions.ts
│   │
│   ├── InputPrompt.tsx    # 40KB - Entrée utilisateur principale
│   ├── MainContent.tsx    # Contenu principal
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── Composer.tsx       # Composition messages
│   ├── DialogManager.tsx  # Gestion dialogues modaux
│   ├── SettingsDialog.tsx # 37KB - Settings complet
│   ├── SessionBrowser.tsx # 27KB - Navigation sessions
│   ├── Help.tsx
│   └── ...
│
└── hooks/                 # Hooks React custom
```

## Composants Clés

### InputPrompt.tsx (40KB)

Le composant le plus complexe - gère:
- Entrée texte multi-ligne
- Mode VIM (normal/insert)
- Historique commandes
- Auto-complétion
- Raccourcis clavier
- Validation entrée

### DialogManager.tsx

Gère l'affichage des dialogues modaux:
- Settings
- Model selection
- Session browser
- Confirmations

### Shared Components

#### TextInput
Input texte custom avec:
- Support VIM bindings
- Buffer management
- Cursor handling

#### Scrollable / ScrollableList / VirtualizedList
Trois niveaux de scrolling:
1. `Scrollable` - scroll basique
2. `ScrollableList` - liste scrollable
3. `VirtualizedList` - virtualisation pour grandes listes

#### MaxSizedBox
Contrainte de taille avec overflow handling.

## Options Ink Importantes

```typescript
render(<App />, {
  // Sortie
  stdout: inkStdout,
  stderr: inkStderr,
  stdin: process.stdin,

  // Comportement
  exitOnCtrlC: false,           // Gestion manuelle du Ctrl+C
  patchConsole: false,          // Console patchée manuellement

  // Accessibilité
  isScreenReaderEnabled: boolean,

  // Performance
  alternateBuffer: boolean,      // Mode plein écran (escape sequences)
  incrementalRendering: boolean, // Rendu différentiel

  // Monitoring
  onRender: ({ renderTime }) => {
    // Track slow renders
  },
});
```

## Gestion du Clavier

### Kitty Keyboard Protocol
Support du protocole Kitty pour une meilleure gestion clavier:
```typescript
useKittyKeyboardProtocol();
```

### VIM Mode
Support complet du mode VIM:
- `vim-buffer-actions.ts` - Actions buffer (yank, paste, delete, etc.)
- `text-buffer.ts` - Gestion buffer texte
- `VimModeProvider` - État mode (normal/insert/visual)

## Tests avec Ink

```typescript
import { render } from 'ink-testing-library';

// Render component
const { lastFrame } = render(
  <Context.Provider value={mockContext}>
    <MyComponent />
  </Context.Provider>
);

// Assert output
expect(lastFrame()).toContain('expected text');
```

## Points d'Attention pour RagForge

### Ce qu'on peut reprendre:
1. **Pattern Providers** - Architecture modulaire
2. **Composants shared/** - TextInput, Scrollable, MaxSizedBox
3. **VIM mode** - vim-buffer-actions.ts
4. **DialogManager** - Gestion modals
5. **Options Ink** - alternateBuffer, incrementalRendering

### Différences avec notre cas:
1. Gemini CLI est plus complexe (auth Google, extensions, etc.)
2. Notre agent est plus simple pour commencer
3. On a déjà un système de tools via BrainManager

### Phase 1 suggérée:
1. Setup Ink basique avec AppContainer
2. Providers minimaux: Settings, Keypress
3. Composants: Header, MainContent, InputPrompt (simplifié), MessageList
4. Pas de VIM mode en Phase 1
