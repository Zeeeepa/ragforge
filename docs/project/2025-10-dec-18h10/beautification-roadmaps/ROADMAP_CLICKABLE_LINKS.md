# Roadmap : Système de Liens Clickables dans le Terminal

## Vue d'ensemble

Cette roadmap couvre l'implémentation d'un système de liens clickables dans le terminal, permettant d'ouvrir les fichiers directement depuis le TUI avec Ctrl+Click.

## Objectifs

- **Navigation rapide** : Ouvrir les fichiers directement depuis le terminal
- **Support Ctrl+Click** : Compatible avec les terminaux modernes
- **Liens trimmés** : Affichage compact avec lien complet au click
- **Universalité** : Fonctionne pour tous les types de références de fichiers

---

## Contexte

Les terminaux modernes (VS Code Integrated Terminal, iTerm2, Windows Terminal, etc.) supportent les liens clickables via des séquences d'échappement spéciales. On peut utiliser cette fonctionnalité pour rendre les chemins de fichiers clickables.

---

## Feature 1 : Composant FileLink

### Description

Composant React/Ink qui affiche un lien clickable vers un fichier, avec support du trimming pour l'affichage.

### Format de Lien Terminal

Les terminaux modernes supportent les liens via :
- **OSC 8** : `\x1b]8;;<url>\x1b\\<text>\x1b]8;;\x1b\\`
- **Format file://** : `file:///absolute/path/to/file`

### Implémentation

```typescript
import React from 'react';
import { Text } from 'ink';
import * as path from 'path';
import * as os from 'os';

interface FileLinkProps {
  filePath: string;
  lineNumber?: number;
  columnNumber?: number;
  displayText?: string;
  maxLength?: number;
  projectRoot?: string;
}

export const FileLink: React.FC<FileLinkProps> = ({
  filePath,
  lineNumber,
  columnNumber,
  displayText,
  maxLength = 60,
  projectRoot
}) => {
  // Normaliser le chemin
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.resolve(projectRoot || process.cwd(), filePath);
  
  // Construire l'URL file://
  const fileUrl = `file://${absolutePath}${lineNumber ? `:${lineNumber}` : ''}${columnNumber ? `:${columnNumber}` : ''}`;
  
  // Préparer le texte d'affichage
  const textToDisplay = displayText || formatPath(absolutePath, maxLength, projectRoot);
  
  // Générer la séquence OSC 8 pour le lien clickable
  const linkSequence = `\x1b]8;;${fileUrl}\x1b\\${textToDisplay}\x1b]8;;\x1b\\`;
  
  return (
    <Text>
      {linkSequence}
    </Text>
  );
};

function formatPath(absolutePath: string, maxLength: number, projectRoot?: string): string {
  // Si on a un projectRoot, utiliser un chemin relatif
  if (projectRoot && absolutePath.startsWith(projectRoot)) {
    const relativePath = path.relative(projectRoot, absolutePath);
    if (relativePath.length <= maxLength) {
      return relativePath;
    }
    // Trimmer le chemin relatif
    return trimPath(relativePath, maxLength);
  }
  
  // Sinon, utiliser le chemin absolu
  if (absolutePath.length <= maxLength) {
    return absolutePath;
  }
  
  // Trimmer le chemin absolu
  return trimPath(absolutePath, maxLength);
}

function trimPath(filePath: string, maxLength: number): string {
  if (filePath.length <= maxLength) {
    return filePath;
  }
  
  // Garder le début et la fin, avec "..." au milieu
  const start = Math.floor((maxLength - 3) / 2);
  const end = filePath.length - Math.ceil((maxLength - 3) / 2);
  
  return `${filePath.substring(0, start)}...${filePath.substring(end)}`;
}
```

### Fichiers à créer

- `packages/cli/src/tui/components/shared/FileLink.tsx`

---

## Feature 2 : Intégration dans les Messages

### Description

Ajouter des liens clickables dans tous les messages qui mentionnent des fichiers.

### Cas d'Usage

1. **Tool calls de modification** : Afficher le lien avant le preview de diff
2. **Résultats de grep/search** : Chaque résultat avec numéro de ligne → lien clickable
3. **Historique de diff** : Lien vers le fichier modifié
4. **Messages d'erreur** : Lien vers le fichier contenant l'erreur
5. **Références de fichiers** : Toute mention de fichier dans les réponses

### Implémentation dans ToolMessage

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { FileLink } from '../shared/FileLink';

interface ToolMessageProps {
  toolName: string;
  args: Record<string, any>;
  result: any;
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  toolName,
  args,
  result
}) => {
  // Détecter les fichiers mentionnés
  const fileReferences = extractFileReferences(toolName, args, result);
  
  return (
    <Box flexDirection="column">
      <Text color="cyan">
        🔧 {toolName}
      </Text>
      
      {/* Afficher les liens vers les fichiers */}
      {fileReferences.map((ref, idx) => (
        <Box key={idx} marginY={1}>
          <FileLink
            filePath={ref.path}
            lineNumber={ref.lineNumber}
            columnNumber={ref.columnNumber}
            displayText={ref.displayText}
          />
        </Box>
      ))}
      
      {/* Résultat de l'outil */}
      <Box marginTop={1}>
        <Text dimColor>
          {JSON.stringify(result, null, 2)}
        </Text>
      </Box>
    </Box>
  );
};

function extractFileReferences(
  toolName: string,
  args: Record<string, any>,
  result: any
): Array<{
  path: string;
  lineNumber?: number;
  columnNumber?: number;
  displayText?: string;
}> {
  const references: Array<{
    path: string;
    lineNumber?: number;
    columnNumber?: number;
    displayText?: string;
  }> = [];
  
  // Pour les outils de modification de fichiers
  if (['write_file', 'edit_file', 'create_file', 'delete_path'].includes(toolName)) {
    if (args.path) {
      references.push({
        path: args.path,
        displayText: `File: ${args.path}`
      });
    }
  }
  
  // Pour les résultats de grep/search
  if (toolName === 'grep_files' && Array.isArray(result.matches)) {
    result.matches.forEach((match: any) => {
      references.push({
        path: match.file,
        lineNumber: match.line,
        displayText: `${match.file}:${match.line}`
      });
    });
  }
  
  // Pour les résultats de brain_search
  if (toolName === 'brain_search' && Array.isArray(result.results)) {
    result.results.forEach((item: any) => {
      if (item.file) {
        references.push({
          path: item.file,
          lineNumber: item.startLine,
          displayText: `${item.file}${item.startLine ? `:${item.startLine}` : ''}`
        });
      }
    });
  }
  
  return references;
}
```

### Fichiers à modifier

- `packages/cli/src/tui/components/messages/ToolMessage.tsx`
- `packages/cli/src/tui/components/messages/AssistantMessage.tsx` (pour les références dans les réponses)

---

## Feature 3 : Parsing des Références de Fichiers dans les Réponses

### Description

Détecter et rendre clickables les références de fichiers dans les réponses textuelles de l'agent.

### Implémentation

```typescript
import React from 'react';
import { Text } from 'ink';
import { FileLink } from '../shared/FileLink';

interface ParsedTextProps {
  content: string;
  projectRoot?: string;
}

export const ParsedText: React.FC<ParsedTextProps> = ({ content, projectRoot }) => {
  // Parser le contenu pour trouver les références de fichiers
  const parts = parseFileReferences(content, projectRoot);
  
  return (
    <>
      {parts.map((part, idx) => {
        if (part.type === 'file') {
          return (
            <FileLink
              key={idx}
              filePath={part.path}
              lineNumber={part.lineNumber}
              displayText={part.displayText}
              projectRoot={projectRoot}
            />
          );
        }
        return <Text key={idx}>{part.text}</Text>;
      })}
    </>
  );
};

function parseFileReferences(
  content: string,
  projectRoot?: string
): Array<{
  type: 'text' | 'file';
  text?: string;
  path?: string;
  lineNumber?: number;
  displayText?: string;
}> {
  const parts: Array<{
    type: 'text' | 'file';
    text?: string;
    path?: string;
    lineNumber?: number;
    displayText?: string;
  }> = [];
  
  // Patterns pour détecter les références de fichiers
  const patterns = [
    // Format: file:line ou file:line:column
    /([^\s]+):(\d+)(?::(\d+))?/g,
    // Format: `file.ts` ou `./file.ts`
    /`([^\s`]+\.(ts|tsx|js|jsx|py|vue|svelte|html|css|scss|md|json|yaml|yml))`/g,
    // Format: "file.ts" ou "./file.ts"
    /"([^\s"]+\.(ts|tsx|js|jsx|py|vue|svelte|html|css|scss|md|json|yaml|yml))"/g,
  ];
  
  let lastIndex = 0;
  
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Ajouter le texte avant le match
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          text: content.substring(lastIndex, match.index)
        });
      }
      
      // Ajouter le fichier
      const filePath = match[1];
      const lineNumber = match[2] ? parseInt(match[2], 10) : undefined;
      const columnNumber = match[3] ? parseInt(match[3], 10) : undefined;
      
      parts.push({
        type: 'file',
        path: filePath,
        lineNumber,
        columnNumber,
        displayText: match[0]
      });
      
      lastIndex = pattern.lastIndex;
    }
  });
  
  // Ajouter le texte restant
  if (lastIndex < content.length) {
    parts.push({
      type: 'text',
      text: content.substring(lastIndex)
    });
  }
  
  return parts;
}
```

### Fichiers à créer

- `packages/cli/src/tui/utils/fileParser.ts`
- `packages/cli/src/tui/components/shared/ParsedText.tsx`

---

## Feature 4 : Support Multi-Terminal

### Description

Détecter le terminal et adapter le format des liens selon le support.

### Implémentation

```typescript
import * as os from 'os';

export function isLinkSupported(): boolean {
  // Détecter le terminal
  const term = process.env.TERM || '';
  const termProgram = process.env.TERM_PROGRAM || '';
  
  // Terminaux qui supportent les liens
  const supportedTerms = [
    'xterm', 'xterm-256color', 'screen', 'screen-256color',
    'tmux', 'tmux-256color', 'vscode', 'iterm', 'iterm2'
  ];
  
  const supportedPrograms = ['vscode', 'iTerm.app', 'WindowsTerminal'];
  
  return supportedTerms.some(t => term.includes(t)) ||
         supportedPrograms.includes(termProgram) ||
         process.env.VSCODE_INJECTION === '1';
}

export function generateFileLink(filePath: string, lineNumber?: number): string {
  if (!isLinkSupported()) {
    // Fallback : retourner juste le chemin
    return filePath;
  }
  
  const fileUrl = `file://${filePath}${lineNumber ? `:${lineNumber}` : ''}`;
  return `\x1b]8;;${fileUrl}\x1b\\${filePath}\x1b]8;;\x1b\\`;
}
```

### Fichiers à créer

- `packages/cli/src/tui/utils/terminal.ts`

---

## Feature 5 : Trimming Intelligent avec Click Complet

### Description

Même si on trim le lien pour l'affichage, le click doit ouvrir le fichier complet avec le bon numéro de ligne.

### Implémentation

Le composant `FileLink` gère déjà cela : le texte affiché peut être trimmé, mais l'URL dans la séquence OSC 8 contient toujours le chemin complet et le numéro de ligne.

```typescript
// Exemple d'utilisation
<FileLink
  filePath="/very/long/path/to/file.ts"
  lineNumber={42}
  maxLength={30} // Trim pour l'affichage
  displayText=".../file.ts" // Affichage trimmé
/>
// Le click ouvrira toujours file:///very/long/path/to/file.ts:42
```

---

## Tests

### Scénarios de Test

1. **Lien simple** : Vérifier qu'un lien s'affiche correctement
2. **Lien avec ligne** : Vérifier que le numéro de ligne est inclus
3. **Lien trimmé** : Vérifier que le click fonctionne même si trimmé
4. **Détection terminal** : Vérifier la détection du support
5. **Parsing** : Vérifier la détection des références dans le texte
6. **Multi-références** : Vérifier plusieurs liens dans un même message

---

## Métriques de Succès

- Liens clickables fonctionnels dans les terminaux supportés
- Fallback gracieux pour les terminaux non supportés
- Parsing précis des références de fichiers
- Performance acceptable (pas de lag lors du parsing)

---

## Dépendances

- Support des séquences OSC 8 dans le terminal
- Détection du terminal
- Parsing des références de fichiers

---

## Notes

Les liens clickables améliorent considérablement l'UX en permettant une navigation rapide vers les fichiers mentionnés. Le système doit être robuste et fonctionner même si le terminal ne supporte pas les liens (fallback vers texte simple).
