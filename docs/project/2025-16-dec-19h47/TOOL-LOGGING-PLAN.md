# Plan: Tool Call Logging avec Wrapper Pattern

## Contexte

On veut logger systématiquement tous les appels d'outils (paramètres + résultats) vers des fichiers pour la traçabilité, similaire au logging LLM déjà implémenté.

Certains outils comme `brain_search` ont déjà leur propre logging personnalisé - il faut pouvoir les exclure.

## Architecture actuelle des outils

### Choke points identifiés

1. **MCP Server** (`packages/cli/src/mcp/server.ts:95`)
   - Handler `CallToolRequestSchema` - point d'entrée principal

2. **Daemon Proxy** (`callToolViaDaemon()`)
   - Pour brain/web/media operations

3. **Agent Runtime** (`executeTools()` dans `agent-runtime.ts:787`)
   - Quand les agents appellent des outils

4. **Structured Executor** (`executeBatch()` dans `structured-llm-executor.ts:3932`)
   - Exécution batch pour outputs structurés

### Point d'intégration choisi

`prepareToolsForMcp()` dans `packages/cli/src/commands/mcp-server.ts` - c'est là que tous les handlers sont agrégés avant d'être passés au serveur MCP.

## Design: Wrapper Pattern

### 1. Classe ToolLogger

```typescript
// packages/core/src/runtime/utils/tool-logger.ts

export class ToolLogger {
  private static _loggingEnabled: boolean = false;
  private static _logDir: string = '';

  // Outils avec logging personnalisé (à exclure)
  private static _customLoggers: Set<string> = new Set([
    'brain_search',  // log déjà ses résultats dans des fichiers
  ]);

  /**
   * Initialise le logging (appelé au démarrage si RAGFORGE_LOG_TOOL_CALLS=true)
   */
  static initialize(logDir: string): void {
    this._loggingEnabled = process.env.RAGFORGE_LOG_TOOL_CALLS === 'true';
    this._logDir = logDir;
  }

  /**
   * Enregistre un outil avec logging personnalisé
   */
  static registerCustomLogger(toolName: string): void {
    this._customLoggers.add(toolName);
  }

  /**
   * Vérifie si un outil a un logging personnalisé
   */
  static hasCustomLogger(toolName: string): boolean {
    return this._customLoggers.has(toolName);
  }

  /**
   * Log un appel d'outil
   */
  static async logToolCall(
    toolName: string,
    args: Record<string, any>,
    result: any,
    metadata: {
      duration: number;
      success: boolean;
      error?: string;
    }
  ): Promise<void> {
    if (!this._loggingEnabled) return;
    if (this._customLoggers.has(toolName)) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const callDir = path.join(this._logDir, 'tools', toolName, timestamp);

    await fs.mkdir(callDir, { recursive: true });

    // Sauvegarder les arguments
    await fs.writeFile(
      path.join(callDir, 'args.json'),
      JSON.stringify(args, null, 2)
    );

    // Sauvegarder le résultat
    await fs.writeFile(
      path.join(callDir, 'result.json'),
      JSON.stringify(result, null, 2)
    );

    // Sauvegarder les métadonnées
    await fs.writeFile(
      path.join(callDir, 'metadata.json'),
      JSON.stringify({
        toolName,
        timestamp: new Date().toISOString(),
        ...metadata,
      }, null, 2)
    );
  }
}
```

### 2. Fonction Wrapper

```typescript
// packages/cli/src/commands/mcp-server.ts (ou tool-logger.ts)

/**
 * Wrapper qui ajoute le logging automatique à un handler
 */
export function withToolLogging(
  toolName: string,
  handler: (args: any) => Promise<any>
): (args: any) => Promise<any> {
  // Si l'outil a son propre logging, pas de wrapper
  if (ToolLogger.hasCustomLogger(toolName)) {
    return handler;
  }

  return async (args: any) => {
    const startTime = Date.now();

    try {
      const result = await handler(args);

      await ToolLogger.logToolCall(toolName, args, result, {
        duration: Date.now() - startTime,
        success: true,
      });

      return result;
    } catch (error: any) {
      await ToolLogger.logToolCall(toolName, args, null, {
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
      });

      throw error;
    }
  };
}
```

### 3. Intégration dans prepareToolsForMcp

```typescript
// Dans prepareToolsForMcp() de mcp-server.ts

// Initialiser le logger
ToolLogger.initialize(path.join(os.homedir(), '.ragforge', 'logs'));

// Wrapper tous les handlers
for (const [name, handler] of Object.entries(allHandlers)) {
  allHandlers[name] = withToolLogging(name, handler);
}
```

## Structure des logs

```
~/.ragforge/logs/
├── tools/
│   ├── read_file/
│   │   ├── 2025-12-16T19-47-30-123Z/
│   │   │   ├── args.json
│   │   │   ├── result.json
│   │   │   └── metadata.json
│   │   └── 2025-12-16T19-48-15-456Z/
│   │       └── ...
│   ├── brain_search/
│   │   └── (vide - custom logger)
│   └── edit_file/
│       └── ...
└── llm/
    └── ... (logging LLM existant)
```

## Variables d'environnement

| Variable | Description | Default |
|----------|-------------|---------|
| `RAGFORGE_LOG_TOOL_CALLS` | Active le logging des outils | `false` |
| `RAGFORGE_LOG_LLM_CALLS` | Active le logging LLM (existant) | `false` |

## Fichiers à modifier

1. **Nouveau fichier**: `packages/core/src/runtime/utils/tool-logger.ts`
   - Classe `ToolLogger`
   - Fonction `withToolLogging`

2. **`packages/cli/src/commands/mcp-server.ts`**
   - Importer `ToolLogger` et `withToolLogging`
   - Initialiser le logger dans `prepareToolsForMcp`
   - Wrapper tous les handlers avant de les retourner

3. **`packages/core/src/index.ts`**
   - Exporter `ToolLogger` si nécessaire pour les custom loggers

## Outils avec custom logging (à exclure)

- `brain_search` - log déjà dans `~/.ragforge/logs/search/`

## Avantages de cette approche

1. **Un seul point d'intégration** - Dans `prepareToolsForMcp`
2. **Automatique** - Tous les nouveaux outils sont loggés par défaut
3. **Opt-out facile** - `ToolLogger.registerCustomLogger()`
4. **Cohérent** - Même structure que le logging LLM
5. **Non-intrusif** - Les handlers existants ne changent pas

## Limitations

- Ne capture que les appels via MCP (pas les appels internes entre outils)
- Pour les appels Agent Runtime, il faudrait ajouter le wrapper dans `executeTools()` aussi

## Étapes d'implémentation

1. [ ] Créer `packages/core/src/runtime/utils/tool-logger.ts`
2. [ ] Implémenter `ToolLogger` class
3. [ ] Implémenter `withToolLogging` wrapper
4. [ ] Modifier `prepareToolsForMcp` pour wrapper les handlers
5. [ ] Tester avec `RAGFORGE_LOG_TOOL_CALLS=true`
6. [ ] Optionnel: Ajouter wrapper dans `AgentRuntime.executeTools()`
