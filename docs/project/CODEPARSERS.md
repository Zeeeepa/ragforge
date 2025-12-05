# Codeparsers Package

**Last Updated**: 2025-12-05
**Package**: `@luciformresearch/codeparsers`
**Version**: 0.1.3
**Location**: `/home/luciedefraiteur/LR_CodeRag/packages/codeparsers/`

---

## Overview

Unified code parsers for TypeScript and Python using tree-sitter WASM bindings. Extracts rich metadata for code analysis and RAG systems.

---

## Supported Languages

| Language | Parser | Status | Lines of Code |
|----------|--------|--------|---------------|
| TypeScript | ScopeExtractionParser | Complete | ~2200 |
| TSX/JSX | Same as TypeScript | Complete | Included |
| Python | PythonScopeExtractionParser | Basic | ~400 |
| HTML | WasmLoader ready | In Progress | See HTML-PARSER-DESIGN.md |

---

## Installation

```bash
npm install @luciformresearch/codeparsers
```

---

## Quick Usage

### TypeScript/TSX

```typescript
import { TypeScriptLanguageParser } from '@luciformresearch/codeparsers/typescript';

const parser = new TypeScriptLanguageParser();
await parser.initialize();

const result = await parser.parseFile('/path/to/file.ts', fileContent);
// result.scopes: ScopeInfo[] - functions, classes, interfaces, etc.
```

### Python

```typescript
import { PythonLanguageParser } from '@luciformresearch/codeparsers/python';

const parser = new PythonLanguageParser();
await parser.initialize();

const result = await parser.parseFile('/path/to/file.py', fileContent);
```

### Low-Level API

```typescript
import { ScopeExtractionParser } from '@luciformresearch/codeparsers';

const parser = new ScopeExtractionParser('typescript');
await parser.initialize();

const analysis = await parser.parseFile('/path/to/file.ts', content);
// analysis: ScopeFileAnalysis
```

---

## Source Structure

```
src/
├── index.ts                          # Main exports
│
├── wasm/
│   ├── WasmLoader.ts                 # WASM loading for tree-sitter
│   ├── types.ts                      # SupportedLanguage: 'typescript' | 'python' | 'html'
│   └── index.ts
│
├── scope-extraction/
│   ├── ScopeExtractionParser.ts      # TypeScript parser (main implementation)
│   ├── PythonScopeExtractionParser.ts # Python-specific parser
│   ├── types.ts                      # ScopeInfo, ParameterInfo, etc.
│   └── index.ts
│
├── typescript/
│   ├── TypeScriptLanguageParser.ts   # High-level TypeScript API
│   └── index.ts
│
├── python/
│   ├── PythonLanguageParser.ts       # High-level Python API
│   └── index.ts
│
├── base/
│   ├── LanguageParser.ts             # Abstract base class
│   ├── ParserRegistry.ts             # Parser registration
│   ├── UniversalTypes.ts             # Universal type definitions
│   └── index.ts
│
├── syntax-highlighting/              # Experimental (not in main use)
│   └── ...
│
└── legacy/                           # Old implementations (deprecated)
    └── ...
```

---

## Key Types

### ScopeInfo

Represents a code scope (function, class, method, etc.):

```typescript
interface ScopeInfo {
  // Basic metadata
  name: string;
  type: 'class' | 'interface' | 'function' | 'method' | 'enum' | 'type_alias' | 'namespace' | 'variable';
  startLine: number;
  endLine: number;
  filePath: string;

  // Signature and interface
  signature: string;              // e.g., "function add(a: number, b: number): number"
  parameters: ParameterInfo[];
  returnType?: string;
  modifiers: string[];            // ['export', 'async', 'static', etc.]

  // Generic/Type parameters
  genericParameters?: GenericParameter[];
  heritageClauses?: HeritageClause[];  // extends/implements
  decoratorDetails?: DecoratorInfo[];

  // Content
  content: string;                // Raw code
  contentDedented: string;        // Code with normalized indentation

  // Class-specific
  members?: ClassMemberInfo[];
  enumMembers?: EnumMemberInfo[];
  variables?: VariableInfo[];

  // Dependencies
  dependencies: string[];
  imports: string[];
  importReferences: ImportReference[];
  identifierReferences: IdentifierReference[];

  // AST metadata
  astValid: boolean;
  astIssues: string[];
  complexity: number;             # Cyclomatic complexity
  linesOfCode: number;

  // Hierarchy
  parent?: string;
  depth: number;
  children: ScopeInfo[];
}
```

### ImportReference

```typescript
interface ImportReference {
  source: string;           // './utils' or 'lodash'
  imported: string;         // 'map' or 'default' or '*'
  alias?: string;           // 'import { map as m }'
  kind: 'default' | 'named' | 'namespace' | 'side-effect';
  isLocal: boolean;         // true for relative imports
}
```

### IdentifierReference

```typescript
interface IdentifierReference {
  identifier: string;       // 'AuthService'
  line: number;
  column?: number;
  context?: string;         // Line content for context
  qualifier?: string;       // 'this' in 'this.service'
  kind?: 'import' | 'local_scope' | 'builtin' | 'unknown';
  source?: string;          // Import source if kind='import'
  targetScope?: string;     // Scope ID if kind='local_scope'
}
```

---

## Build Commands

```bash
cd /home/luciedefraiteur/LR_CodeRag/packages/codeparsers

# Full build
npm run build

# Clean and rebuild
npm run clean && npm run build

# Run tests
npm test

# Lint
npm run lint
```

---

## WASM Loader

The WasmLoader handles tree-sitter WASM binaries:

```typescript
// Location: src/wasm/WasmLoader.ts

export class WasmLoader {
  static async loadParser(
    language: SupportedLanguage,  // 'typescript' | 'python' | 'html'
    config: WasmLoaderConfig
  ): Promise<LoadedParser>;
}
```

### Adding a New Language

1. Install tree-sitter grammar:
   ```bash
   npm install tree-sitter-<language>
   ```

2. Update `SupportedLanguage` type in `src/wasm/types.ts`:
   ```typescript
   export type SupportedLanguage = 'typescript' | 'python' | 'html' | 'newlang';
   ```

3. Add WASM path in `WasmLoader.ts`:
   ```typescript
   } else if (language === 'newlang') {
     wasmPath = require.resolve('tree-sitter-newlang/tree-sitter-newlang.wasm');
   }
   ```

4. Create parser class in `src/newlang/NewLangScopeExtractionParser.ts`

---

## TypeScript Parser Details

The TypeScript parser (`ScopeExtractionParser`) is the most complete implementation:

### Extracted Scope Types

- `class_declaration` / `abstract_class_declaration`
- `interface_declaration`
- `function_declaration`
- `method_definition`
- `enum_declaration`
- `type_alias_declaration`
- `namespace_declaration`
- `lexical_declaration` (const/let functions)
- `variable_declaration` (global variables)

### Special Handling

- **Const functions**: `export const fn = () => {}` → extracted as function scope
- **Arrow functions**: Parameters and return types extracted
- **Generics**: `<T extends Base>` → `genericParameters`
- **Decorators**: `@Entity({ name: 'users' })` → `decoratorDetails`
- **Heritage**: `extends Parent implements Interface` → `heritageClauses`
- **JSX Components**: `<MyComponent />` → identifier references

### Reference Resolution

The parser resolves identifier references:

1. **Import references**: Links identifiers to import statements
2. **Local scope references**: Links identifiers to local definitions
3. **Return type references**: Links return types to local types

---

## Python Parser Details

The Python parser is more basic:

### Extracted Scope Types

- `class_definition`
- `function_definition`
- `decorated_definition` (with decorators)

### Python-Specific Features

- `docstring`: Extracted from function/class bodies
- `decorators`: `@decorator` extracted
- `value`: For variable assignments

---

## Dependencies

```json
{
  "dependencies": {
    "tree-sitter": "^0.21.1",
    "tree-sitter-html": "^0.23.2",
    "tree-sitter-python": "^0.23.6",
    "tree-sitter-typescript": "^0.23.2",
    "tree-sitter-wasms": "^0.1.13",
    "web-tree-sitter": "^0.25.10"
  }
}
```

---

## Usage in RagForge

The codeparsers package is used by `@luciformresearch/ragforge-runtime`:

```typescript
// In CodeSourceAdapter
import { ScopeExtractionParser } from '@luciformresearch/codeparsers';

const parser = new ScopeExtractionParser('typescript');
await parser.initialize();

const analysis = await parser.parseFile(filePath, content);
// Convert to Neo4j nodes...
```

---

## Testing

```bash
cd /home/luciedefraiteur/LR_CodeRag/packages/codeparsers

# Run all tests
npm test

# Run specific test
npx vitest run tests/typescript.test.ts
```

### Test Files

```bash
tests/
├── typescript.test.ts    # TypeScript parser tests
├── python.test.ts        # Python parser tests
└── ...
```

---

## Related Documents

- [HTML-PARSER-DESIGN.md](./HTML-PARSER-DESIGN.md) - HTML hybrid parser design
- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - Full project overview
