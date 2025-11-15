# StructuredLLMExecutor with Tool Calling

## 🎯 Objectif

Ajouter le support de tool calling à `StructuredLLMExecutor` pour permettre:
1. **Mode global**: Tool calls pour tout le batch, puis batch processing
2. **Mode per-item**: Chaque item peut faire ses propres tool calls (mini-loop)

---

## 📋 API Design

### Mode Global (par défaut)

```typescript
const results = await executor.executeLLMBatchWithTools(
  items,
  {
    inputFields: ['code'],
    systemPrompt: 'Analyze code dependencies',
    userTask: 'Extract all dependencies',
    outputSchema: {
      dependencies: { type: 'array', ... },
      complexity: { type: 'string', ... }
    },
    tools: [
      {
        type: "function",
        function: {
          name: "search_npm_package",
          description: "Search npm registry for package info",
          parameters: { ... }
        }
      }
    ],
    toolMode: 'global', // DEFAULT
    llmProvider,
    batchSize: 10
  }
);
```

**Flow:**
```
1. LLM reçoit TOUS les items du batch
2. LLM décide quels tool calls faire globalement
3. Execute les tools
4. LLM batch process tous les items avec les tool results
5. Retourne réponses structurées pour chaque item
```

**Example concret:**
```
Items: [
  { code: "import lodash from 'lodash'" },
  { code: "import axios from 'axios'" },
  { code: "import react from 'react'" }
]

LLM voit les 3 items → "Je vais chercher lodash, axios, react"
Tool calls: [
  search_npm_package("lodash"),
  search_npm_package("axios"),
  search_npm_package("react")
]

Puis avec les résultats, batch process les 3 items:
[
  { dependencies: ["lodash@4.17.21"], complexity: "low" },
  { dependencies: ["axios@1.6.0"], complexity: "medium" },
  { dependencies: ["react@18.0.0"], complexity: "high" }
]
```

---

### Mode Per-Item (option)

```typescript
const results = await executor.executeLLMBatchWithTools(
  items,
  {
    inputFields: ['code'],
    systemPrompt: 'Analyze code',
    userTask: 'Extract dependencies',
    outputSchema: { ... },
    tools: [ ... ],
    toolMode: 'per-item', // Mini-loop par item
    maxIterationsPerItem: 3, // Safety limit
    llmProvider,
    batchSize: 10
  }
);
```

**Flow:**
```
Pour chaque item:
  1. LLM analyse l'item
  2. Si tool_calls → execute et ajoute au context
  3. Loop jusqu'à réponse structurée finale
  4. Continue avec item suivant
```

**Example concret:**
```
Item 1: { code: "import lodash from 'lodash'" }
  Iteration 1:
    LLM → tool_call: search_npm_package("lodash")
    Result: { version: "4.17.21", ... }
  Iteration 2:
    LLM → { dependencies: ["lodash@4.17.21"], complexity: "low" }
  ✅ Done

Item 2: { code: "import axios from 'axios'" }
  Iteration 1:
    LLM → tool_call: search_npm_package("axios")
    Result: { version: "1.6.0", ... }
  Iteration 2:
    LLM → { dependencies: ["axios@1.6.0"], complexity: "medium" }
  ✅ Done
```

---

## 🔧 Implementation

### 1. New Config Interface

```typescript
interface LLMBatchWithToolsConfig<Input, Output> {
  // Existing fields
  inputFields: (keyof Input)[];
  systemPrompt: string;
  userTask: string;
  outputSchema: OutputSchema;
  outputFormat?: 'xml' | 'json' | 'yaml';
  llmProvider: LLMProvider;
  batchSize?: number;

  // NEW: Tool calling support
  tools?: ToolDefinition[];
  toolMode?: 'global' | 'per-item'; // Default: 'global'
  maxIterationsPerItem?: number; // For per-item mode, default: 3
  toolChoice?: 'auto' | 'any' | 'none'; // Default: 'auto'

  // Optional: use native tool calling if available
  useNativeToolCalling?: boolean; // Default: true
}
```

### 2. Implementation dans StructuredLLMExecutor

```typescript
export class StructuredLLMExecutor {
  private nativeToolProvider?: GeminiNativeToolProvider;

  /**
   * Execute LLM batch with tool calling support
   */
  async executeLLMBatchWithTools<Input, Output>(
    items: Input[],
    config: LLMBatchWithToolsConfig<Input, Output>
  ): Promise<LLMBatchResult<Output>> {
    const toolMode = config.toolMode ?? 'global';

    if (toolMode === 'global') {
      return this.executeBatchWithGlobalTools(items, config);
    } else {
      return this.executeBatchWithPerItemTools(items, config);
    }
  }

  /**
   * Global tool calling mode
   */
  private async executeBatchWithGlobalTools<Input, Output>(
    items: Input[],
    config: LLMBatchWithToolsConfig<Input, Output>
  ): Promise<LLMBatchResult<Output>> {
    // 1. First pass: LLM sees all items and decides tool calls
    const toolCallsResponse = await this.requestGlobalToolCalls(items, config);

    // 2. Execute tools if requested
    let toolResults: any[] = [];
    if (toolCallsResponse.tool_calls && toolCallsResponse.tool_calls.length > 0) {
      toolResults = await this.executeTools(
        toolCallsResponse.tool_calls,
        config.tools!
      );
    }

    // 3. Second pass: Batch process all items with tool results
    return this.batchProcessWithToolResults(items, toolResults, config);
  }

  /**
   * Per-item tool calling mode
   */
  private async executeBatchWithPerItemTools<Input, Output>(
    items: Input[],
    config: LLMBatchWithToolsConfig<Input, Output>
  ): Promise<LLMBatchResult<Output>> {
    const results: Output[] = [];
    const maxIterations = config.maxIterationsPerItem ?? 3;

    // Process each item with its own mini-loop
    for (const item of items) {
      const result = await this.processItemWithTools(
        item,
        config,
        maxIterations
      );
      results.push(result);
    }

    return {
      items: results,
      successful: results.length,
      failed: 0,
      errors: [],
    };
  }

  /**
   * Process single item with tool loop
   */
  private async processItemWithTools<Input, Output>(
    item: Input,
    config: LLMBatchWithToolsConfig<Input, Output>,
    maxIterations: number
  ): Promise<Output> {
    let iteration = 0;
    let toolContext: any[] = [];

    while (iteration < maxIterations) {
      iteration++;

      // Call LLM with item + tool context
      const response = await this.callLLMWithToolContext(
        item,
        toolContext,
        config
      );

      // Check if we have final answer
      if (!response.tool_calls || response.tool_calls.length === 0) {
        // LLM returned structured output, we're done
        return response.output;
      }

      // Execute tools and add to context
      const toolResults = await this.executeTools(
        response.tool_calls,
        config.tools!
      );

      toolContext.push({
        iteration,
        tool_calls: response.tool_calls,
        results: toolResults,
      });
    }

    throw new Error(
      `Max iterations (${maxIterations}) reached for item without final output`
    );
  }

  /**
   * Request global tool calls for entire batch
   */
  private async requestGlobalToolCalls<Input>(
    items: Input[],
    config: LLMBatchWithToolsConfig<Input, any>
  ): Promise<{ tool_calls?: ToolCallRequest[] }> {
    // Use native tool calling if available
    if (config.useNativeToolCalling && this.nativeToolProvider) {
      return this.requestGlobalToolCallsNative(items, config);
    }

    // Fallback: XML-based tool calling
    return this.requestGlobalToolCallsXML(items, config);
  }

  /**
   * Request global tool calls using native API
   */
  private async requestGlobalToolCallsNative<Input>(
    items: Input[],
    config: LLMBatchWithToolsConfig<Input, any>
  ): Promise<{ tool_calls?: ToolCallRequest[] }> {
    const messages: NativeMessage[] = [
      {
        role: "user",
        content: this.buildGlobalToolCallPrompt(items, config),
      },
    ];

    const response = await this.nativeToolProvider!.generateWithTools(
      messages,
      config.tools!,
      {
        toolChoice: config.toolChoice ?? "auto",
      }
    );

    return {
      tool_calls: response.toolCalls?.map(tc => ({
        tool_name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
    };
  }

  /**
   * Request global tool calls using XML
   */
  private async requestGlobalToolCallsXML<Input>(
    items: Input[],
    config: LLMBatchWithToolsConfig<Input, any>
  ): Promise<{ tool_calls?: ToolCallRequest[] }> {
    // Build prompt with all items
    const prompt = this.buildGlobalToolCallPrompt(items, config);

    // Call with XML schema for tool calls
    const result = await this.executeLLMBatch<any, { tool_calls?: ToolCallRequest[] }>(
      [{ items }],
      {
        inputFields: ['items'],
        systemPrompt: this.buildSystemPromptWithTools(config.tools!),
        userTask: prompt,
        outputSchema: {
          tool_calls: {
            type: 'array',
            description: 'Tools to call before processing batch',
            required: false,
            items: {
              type: 'object',
              properties: {
                tool_name: { type: 'string', required: true },
                arguments: { type: 'object', required: true },
              },
            },
          },
        },
        outputFormat: 'xml',
        llmProvider: config.llmProvider,
        batchSize: 1,
      }
    );

    return Array.isArray(result) ? result[0] : result.items[0];
  }

  /**
   * Build prompt for global tool call request
   */
  private buildGlobalToolCallPrompt<Input>(
    items: Input[],
    config: LLMBatchWithToolsConfig<Input, any>
  ): string {
    const itemsStr = items
      .map((item, i) => {
        const fields = config.inputFields
          .map(field => `${String(field)}: ${item[field]}`)
          .join('\n  ');
        return `Item ${i + 1}:\n  ${fields}`;
      })
      .join('\n\n');

    return `${config.userTask}

Items to process:
${itemsStr}

Look at ALL items and decide if you need to call any tools to gather information before processing them.
If you need tools, return tool_calls.
If you have enough information, return an empty response (no tool calls needed).`;
  }

  /**
   * Build system prompt with tool descriptions
   */
  private buildSystemPromptWithTools(tools: ToolDefinition[]): string {
    const toolsDesc = tools
      .map(
        t => `- ${t.function.name}: ${t.function.description}
  Parameters: ${JSON.stringify(t.function.parameters, null, 2)}`
      )
      .join('\n\n');

    return `You are an AI assistant with access to tools.

Available tools:
${toolsDesc}

Use tools when you need additional information to complete the task.`;
  }

  /**
   * Execute tools
   */
  private async executeTools(
    toolCalls: ToolCallRequest[],
    toolDefinitions: ToolDefinition[]
  ): Promise<any[]> {
    // TODO: Need a ToolExecutor or registry
    // For now, this is a placeholder
    console.log(`Executing ${toolCalls.length} tools:`, toolCalls);
    return toolCalls.map(tc => ({
      tool_name: tc.tool_name,
      result: { mock: true, tool: tc.tool_name },
    }));
  }

  /**
   * Batch process items with tool results
   */
  private async batchProcessWithToolResults<Input, Output>(
    items: Input[],
    toolResults: any[],
    config: LLMBatchWithToolsConfig<Input, Output>
  ): Promise<LLMBatchResult<Output>> {
    // Build enhanced user task with tool results
    const enhancedTask = this.buildTaskWithToolResults(
      config.userTask,
      toolResults
    );

    // Standard batch processing
    return this.executeLLMBatch<Input, Output>(items, {
      ...config,
      userTask: enhancedTask,
      // Remove tools from this call, we already executed them
      tools: undefined,
    } as any);
  }

  /**
   * Build task with tool results context
   */
  private buildTaskWithToolResults(
    originalTask: string,
    toolResults: any[]
  ): string {
    if (toolResults.length === 0) {
      return originalTask;
    }

    const resultsStr = toolResults
      .map(
        (r, i) =>
          `Tool ${i + 1}: ${r.tool_name}
Result: ${JSON.stringify(r.result, null, 2)}`
      )
      .join('\n\n');

    return `${originalTask}

Tool Results Available:
${resultsStr}

Use these tool results to enhance your analysis of each item.`;
  }
}
```

---

## 📊 Comparison des Modes

| Aspect | Global Mode | Per-Item Mode |
|--------|-------------|---------------|
| **Tool calls** | Une fois pour tout le batch | Loop par item |
| **Performance** | ⚡ Plus rapide (moins d'appels LLM) | 🐢 Plus lent (plus d'appels) |
| **Use case** | Context partagé entre items | Items indépendants |
| **Coût** | 💰 Moins cher | 💰💰 Plus cher |
| **Flexibilité** | Tools partagés | Tools spécifiques par item |

---

## 🎨 Examples d'Usage

### Example 1: Global Mode - Dependency Analysis

```typescript
const codeSnippets = [
  { code: "import lodash from 'lodash'" },
  { code: "import axios from 'axios'" },
  { code: "import react from 'react'" },
];

const results = await executor.executeLLMBatchWithTools(
  codeSnippets,
  {
    inputFields: ['code'],
    systemPrompt: 'You are a code analyzer',
    userTask: 'Extract dependencies and their versions',
    outputSchema: {
      dependencies: {
        type: 'array',
        description: 'List of dependencies with versions',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
          },
        },
      },
      complexity: {
        type: 'string',
        description: 'Complexity level: low, medium, high',
      },
    },
    tools: [
      {
        type: "function",
        function: {
          name: "search_npm_registry",
          description: "Search npm registry for package latest version",
          parameters: {
            type: "object",
            properties: {
              packageName: {
                type: "string",
                description: "NPM package name",
              },
            },
            required: ["packageName"],
          },
        },
      },
    ],
    toolMode: 'global', // LLM voit tous les snippets, appelle search_npm_registry 3x
    llmProvider,
    batchSize: 10,
  }
);

// Results:
// [
//   { dependencies: [{ name: "lodash", version: "4.17.21" }], complexity: "low" },
//   { dependencies: [{ name: "axios", version: "1.6.0" }], complexity: "medium" },
//   { dependencies: [{ name: "react", version: "18.0.0" }], complexity: "high" }
// ]
```

### Example 2: Per-Item Mode - Complex Analysis

```typescript
const functions = [
  { code: "function processUser(user) { /* complex logic */ }" },
  { code: "async function fetchData(url) { /* async logic */ }" },
];

const results = await executor.executeLLMBatchWithTools(
  functions,
  {
    inputFields: ['code'],
    systemPrompt: 'Analyze function complexity',
    userTask: 'Determine complexity and suggest optimizations',
    outputSchema: {
      complexity_score: { type: 'number' },
      optimizations: { type: 'array' },
      similar_patterns: { type: 'array' },
    },
    tools: [
      {
        type: "function",
        function: {
          name: "search_similar_code",
          description: "Search for similar code patterns in codebase",
          parameters: {
            type: "object",
            properties: {
              pattern: { type: "string" },
            },
            required: ["pattern"],
          },
        },
      },
    ],
    toolMode: 'per-item', // Chaque fonction peut faire ses propres recherches
    maxIterationsPerItem: 3,
    llmProvider,
  }
);
```

---

## 🚀 Next Steps

1. ✅ Design API
2. ⏳ Implement global mode
3. ⏳ Implement per-item mode
4. ⏳ Add tool executor/registry
5. ⏳ Tests
6. ⏳ Documentation

---

**Status:** Design complete, ready for implementation
