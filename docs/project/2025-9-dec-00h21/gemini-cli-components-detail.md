# Gemini CLI - Détail des Composants

## Messages (`components/messages/`)

### UserMessage.tsx
Affiche un message utilisateur avec:
- Préfixe/icône utilisateur
- Formatage texte
- Timestamp optionnel

### GeminiMessage.tsx / GeminiMessageContent.tsx
Affiche la réponse de l'AI:
- Streaming text
- Markdown rendering
- Code blocks avec syntax highlighting
- Citations/sources

### ToolMessage.tsx
Affiche l'exécution d'un tool:
- Nom du tool
- Paramètres (collapsible)
- Status (pending/running/done/error)
- Durée d'exécution

### ToolConfirmationMessage.tsx
Demande confirmation avant exécution:
- Description de l'action
- Boutons Approve/Deny
- Option "Always approve this tool"

### ToolResultDisplay.tsx
Affiche le résultat d'un tool:
- Output formaté
- Truncation si trop long
- Expand/collapse

### DiffRenderer.tsx
Affiche les diffs de fichiers:
- Side-by-side ou unified
- Syntax highlighting
- Line numbers
- Collapse hunks

### ErrorMessage.tsx / WarningMessage.tsx / InfoMessage.tsx
Messages de status avec:
- Icône appropriée
- Couleur thématique
- Stack trace optionnel (errors)

### ShellToolMessage.tsx
Spécifique aux commandes shell:
- Command display
- Working directory
- Output streaming
- Exit code

### CompressionMessage.tsx
Affiché quand le contexte est compressé:
- Tokens before/after
- Reason for compression

## Shared (`components/shared/`)

### TextInput.tsx
Input texte avancé:
```tsx
interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  multiline?: boolean;
  // VIM mode support
  vimMode?: boolean;
  onVimModeChange?: (mode: VimMode) => void;
}
```

### text-buffer.ts
Gestion du buffer texte:
```typescript
class TextBuffer {
  private lines: string[];
  private cursor: { line: number; column: number };

  insert(text: string): void;
  delete(range: Range): string;
  getContent(): string;
  getCursorPosition(): Position;
  setCursorPosition(pos: Position): void;
  // Selection
  getSelection(): Range | null;
  setSelection(range: Range): void;
}
```

### vim-buffer-actions.ts
Actions VIM sur le buffer:
```typescript
// Movement
moveCursorLeft(buffer: TextBuffer): void;
moveCursorRight(buffer: TextBuffer): void;
moveCursorUp(buffer: TextBuffer): void;
moveCursorDown(buffer: TextBuffer): void;
moveToLineStart(buffer: TextBuffer): void;
moveToLineEnd(buffer: TextBuffer): void;
moveWordForward(buffer: TextBuffer): void;
moveWordBackward(buffer: TextBuffer): void;

// Editing
deleteChar(buffer: TextBuffer): string;
deleteLine(buffer: TextBuffer): string;
deleteWord(buffer: TextBuffer): string;
yank(buffer: TextBuffer): string;
paste(buffer: TextBuffer, register: string): void;

// Mode
enterInsertMode(): void;
enterNormalMode(): void;
enterVisualMode(): void;
```

### Scrollable.tsx
Container scrollable basique:
```tsx
interface ScrollableProps {
  children: React.ReactNode;
  height: number | string;
  onScroll?: (scrollTop: number) => void;
}
```

### ScrollableList.tsx
Liste avec scroll:
```tsx
interface ScrollableListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  height: number;
  itemHeight: number;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
}
```

### VirtualizedList.tsx
Liste virtualisée pour grandes collections:
```tsx
interface VirtualizedListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  height: number;
  itemHeight: number;
  overscan?: number; // Items rendered outside viewport
}
```

### MaxSizedBox.tsx
Box avec contraintes de taille:
```tsx
interface MaxSizedBoxProps {
  children: React.ReactNode;
  maxWidth?: number;
  maxHeight?: number;
  overflow?: 'hidden' | 'scroll' | 'ellipsis';
}
```

### RadioButtonSelect.tsx
Sélection radio:
```tsx
interface RadioButtonSelectProps<T> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  direction?: 'horizontal' | 'vertical';
}
```

### EnumSelector.tsx
Sélecteur d'enum avec navigation clavier:
```tsx
interface EnumSelectorProps<T extends string> {
  values: T[];
  value: T;
  onChange: (value: T) => void;
  labels?: Record<T, string>;
}
```

## Hooks Identifiés

### useKittyKeyboardProtocol
Active le protocole clavier Kitty pour meilleure détection:
- Modifiers (Ctrl, Alt, Shift)
- Keys spéciales
- Key release events

### useVimMode (probable)
Gère l'état du mode VIM:
```typescript
const { mode, setMode, executeCommand } = useVimMode();
// mode: 'normal' | 'insert' | 'visual' | 'command'
```

### useScroll (probable)
Gère le scroll global:
```typescript
const { scrollTop, scrollTo, scrollBy } = useScroll();
```

### useKeypress (probable)
Hook pour écouter les touches:
```typescript
useKeypress((key, modifiers) => {
  if (key === 'q' && modifiers.ctrl) {
    quit();
  }
});
```

### useTheme (probable)
Accès au thème courant:
```typescript
const theme = useTheme();
// theme.colors.primary, theme.colors.error, etc.
```

## Patterns de Rendu

### Conditional Rendering avec Ink
```tsx
// Afficher seulement si focused
{isFocused && <Cursor />}

// Afficher seulement en mode debug
{debugMode && <DebugInfo />}
```

### Layout avec Box (Flexbox)
```tsx
<Box flexDirection="column" height="100%">
  <Header />
  <Box flexGrow={1}>
    <MainContent />
  </Box>
  <Footer />
</Box>
```

### Text Styling
```tsx
<Text color="green" bold>Success!</Text>
<Text color="red" dimColor>Error occurred</Text>
<Text wrap="wrap">Long text that wraps...</Text>
```
