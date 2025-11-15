# LangChain.js Tool Calling Analysis

## 🎯 Objectif

Analyser comment LangChain.js gère le tool calling natif pour chaque provider (Gemini, OpenAI, Anthropic) et extraire la logique pertinente pour RagForge, en bypassant leur système de message history et structured responses.

---

## 📁 Structure LangChain.js

### Core Files
- [`libs/langchain-core/src/language_models/base.ts`](../langchainjs/libs/langchain-core/src/language_models/base.ts) - BaseLanguageModel, ToolDefinition
- [`libs/langchain-core/src/language_models/chat_models.ts`](../langchainjs/libs/langchain-core/src/language_models/chat_models.ts) - BaseChatModel, bindTools()
- [`libs/langchain-core/src/messages/index.ts`](../langchainjs/libs/langchain-core/src/messages/index.ts) - AIMessage, ToolMessage, etc.
- [`libs/langchain-core/src/messages/tool.ts`](../langchainjs/libs/langchain-core/src/messages/tool.ts) - ToolCall, ToolCallChunk
- [`libs/langchain-core/src/tools/index.ts`](../langchainjs/libs/langchain-core/src/tools/index.ts) - StructuredToolInterface

### Google Gemini Provider
- [`libs/providers/langchain-google-genai/src/chat_models.ts`](../langchainjs/libs/providers/langchain-google-genai/src/chat_models.ts) - ChatGoogleGenerativeAI
- [`libs/providers/langchain-google-genai/src/utils/tools.ts`](../langchainjs/libs/providers/langchain-google-genai/src/utils/tools.ts) - convertToolsToGenAI()
- [`libs/providers/langchain-google-genai/src/utils/common.ts`](../langchainjs/libs/providers/langchain-google-genai/src/utils/common.ts) - Message conversion

### OpenAI Provider
- [`libs/providers/langchain-openai/src/chat_models.ts`](../langchainjs/libs/providers/langchain-openai/src/chat_models.ts) - ChatOpenAI
- [`libs/providers/langchain-openai/src/utils/tools.ts`](../langchainjs/libs/providers/langchain-openai/src/utils/tools.ts) - OpenAI tool conversion

### Anthropic Provider
- [`libs/providers/langchain-anthropic/src/chat_models.ts`](../langchainjs/libs/providers/langchain-anthropic/src/chat_models.ts) - ChatAnthropic
- [`libs/providers/langchain-anthropic/src/utils/tools.ts`](../langchainjs/libs/providers/langchain-anthropic/src/utils/tools.ts) - Anthropic tool conversion

---

## 🔑 Concepts Clés

### 1. **Base Interface: `BaseChatModel`**

Tous les providers implémentent `BaseChatModel` qui définit:

```typescript
abstract class BaseChatModel {
  // OPTIONAL: Provider overrides this if they support native tool calling
  bindTools?(
    tools: BindToolsInput[],
    kwargs?: Partial<CallOptions>
  ): Runnable<BaseLanguageModelInput, OutputMessageType, CallOptions>;

  // Required: Generate chat completion
  abstract _generate(
    messages: BaseMessage[],
    options: ParsedCallOptions,
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult>;
}
```

**Points importants:**
- `bindTools()` est **optionnel** - seulement si le provider supporte les tool calls natifs
- Retourne un `Runnable` (leur système de chaining)
- Pour nous: on n'a pas besoin de `Runnable`, juste de la logique de conversion

---

### 2. **Tool Definition Format**

LangChain supporte 3 formats de tools:

```typescript
type BindToolsInput =
  | StructuredToolInterface    // LangChain native tool
  | ToolDefinition            // OpenAI-style tool
  | Record<string, any>;      // Provider-specific (e.g., GoogleGenerativeAITool)
```

**OpenAI Tool Format (standard):**
```typescript
interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  };
}
```

**LangChain Tool Format:**
```typescript
interface StructuredToolInterface {
  name: string;
  description: string;
  schema: ZodSchema; // Zod schema for parameters
  call(input: any): Promise<any>;
}
```

---

## 🔧 Provider-Specific Implementations

### Google Gemini (`langchain-google-genai`)

#### File: [`src/chat_models.ts`](../langchainjs/libs/providers/langchain-google-genai/src/chat_models.ts)

```typescript
override bindTools(
  tools: GoogleGenerativeAIToolType[],
  kwargs?: Partial<GoogleGenerativeAIChatCallOptions>
): Runnable<...> {
  return this.withConfig({
    tools: convertToolsToGenAI(tools)?.tools,
    ...kwargs,
  });
}

invocationParams(options?: ParsedCallOptions): Omit<GenerateContentRequest, "contents"> {
  const toolsAndConfig = options?.tools?.length
    ? convertToolsToGenAI(options.tools, {
        toolChoice: options.tool_choice,
        allowedFunctionNames: options.allowedFunctionNames,
      })
    : undefined;

  return {
    ...(toolsAndConfig?.tools ? { tools: toolsAndConfig.tools } : {}),
    ...(toolsAndConfig?.toolConfig ? { toolConfig: toolsAndConfig.toolConfig } : {}),
  };
}
```

**Ce qu'on en retient:**
1. `bindTools()` stocke les tools dans la config
2. `invocationParams()` convertit les tools au format Gemini avant chaque call
3. Support de `toolChoice` ("auto", "any", "none", ou nom de fonction spécifique)

#### File: [`src/utils/tools.ts`](../langchainjs/libs/providers/langchain-google-genai/src/utils/tools.ts)

```typescript
export function convertToolsToGenAI(
  tools: GoogleGenerativeAIToolType[],
  extra?: {
    toolChoice?: ToolChoice;
    allowedFunctionNames?: string[];
  }
): {
  tools: GenerativeAITool[];
  toolConfig?: ToolConfig;
} {
  const genAITools = processTools(tools);
  const toolConfig = createToolConfig(genAITools, extra);

  return { tools: genAITools, toolConfig };
}

function processTools(tools: GoogleGenerativeAIToolType[]): GenerativeAITool[] {
  let functionDeclarationTools: FunctionDeclaration[] = [];
  const genAITools: GenerativeAITool[] = [];

  tools.forEach((tool) => {
    if (isLangChainTool(tool)) {
      const [convertedTool] = convertToGenerativeAITools([tool as StructuredToolInterface]);
      if (convertedTool.functionDeclarations) {
        functionDeclarationTools.push(...convertedTool.functionDeclarations);
      }
    } else if (isOpenAITool(tool)) {
      const { functionDeclarations } = convertOpenAIToolToGenAI(tool);
      if (functionDeclarations) {
        functionDeclarationTools.push(...functionDeclarations);
      }
    } else {
      genAITools.push(tool as GenerativeAITool);
    }
  });

  return [
    ...genAITools,
    ...(functionDeclarationTools.length > 0
      ? [{ functionDeclarations: functionDeclarationTools }]
      : []),
  ];
}
```

**Gemini Tool Format:**
```typescript
interface GenerativeAITool {
  functionDeclarations: FunctionDeclaration[];
}

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: FunctionDeclarationSchema; // JSON Schema
}
```

**ToolConfig (Gemini-specific):**
```typescript
interface ToolConfig {
  functionCallingConfig: {
    mode: FunctionCallingMode; // "ANY", "AUTO", "NONE"
    allowedFunctionNames?: string[];
  };
}
```

#### File: [`src/utils/common.ts`](../langchainjs/libs/providers/langchain-google-genai/src/utils/common.ts)

**Parsing Tool Calls from Response:**

```typescript
export function mapGenerateContentResultToChatResult(
  response: EnhancedGenerateContentResponse,
  extra?: { usageMetadata: UsageMetadata | undefined }
): ChatResult {
  const functionCalls = response.functionCalls(); // Gemini SDK method

  const generation: ChatGeneration = {
    text,
    message: new AIMessage({
      content: content ?? "",
      tool_calls: functionCalls?.map((fc) => ({
        ...fc,
        type: "tool_call",
        id: "id" in fc && typeof fc.id === "string" ? fc.id : uuidv4(),
      })),
      // ...
    }),
    // ...
  };

  return {
    generations: [generation],
    // ...
  };
}
```

**Tool Call Format (LangChain standard):**
```typescript
interface ToolCall {
  name: string;
  args: Record<string, any>;
  id: string; // Unique ID for matching with ToolMessage
  type: "tool_call";
}
```

**Sending Tool Results Back:**

```typescript
export function convertMessageContentToParts(
  message: BaseMessage,
  isMultimodalModel: boolean,
  previousMessages: BaseMessage[]
): Part[] {
  if (isToolMessage(message)) {
    const messageName = message.name ??
      inferToolNameFromPreviousMessages(message, previousMessages);

    if (message.status === "error") {
      return [{
        functionResponse: {
          name: messageName,
          response: { error: { details: message.content } },
        },
      }];
    }

    return [{
      functionResponse: {
        name: messageName,
        response: { result: message.content },
      },
    }];
  }

  // Handle AI messages with tool_calls
  if (isAIMessage(message) && message.tool_calls?.length) {
    const functionCalls = message.tool_calls.map((tc) => ({
      functionCall: {
        name: tc.name,
        args: tc.args,
      },
    }));
    return [...messageParts, ...functionCalls];
  }

  // ...
}
```

**Gemini Part Format (in messages):**
```typescript
type Part =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, any> } }
  | { functionResponse: { name: string; response: Record<string, any> } }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }
  // etc.
```

---

## 💡 Ce qu'on peut extraire pour RagForge

### 1. **Tool Conversion Logic**

Au lieu de refaire nous-mêmes la conversion de nos tools vers chaque format provider, on peut:

**Option A: Réutiliser leurs fonctions de conversion**
```typescript
// Pour Gemini - voir le code source ici:
// ../langchainjs/libs/providers/langchain-google-genai/src/utils/tools.ts
import { convertToolsToGenAI } from 'langchainjs/libs/providers/langchain-google-genai/src/utils/tools';

// Nos tools RagForge
const ragTools = [
  {
    type: "function",
    function: {
      name: "generated.scope.semanticSearchBySource",
      description: "Search scopes by source code",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          topK: { type: "number" }
        },
        required: ["query"]
      }
    }
  }
];

// Convert to Gemini format
const { tools, toolConfig } = convertToolsToGenAI(ragTools, {
  toolChoice: "auto"
});

// Use with @google/generative-ai SDK
const result = await model.generateContent({
  contents: [...],
  tools,
  toolConfig
});
```

**Option B: Copier uniquement les fonctions de conversion**

Créer `packages/runtime/src/llm/tool-converters/` avec:
- `gemini.ts` - Copier [`langchain-google-genai/src/utils/tools.ts`](../langchainjs/libs/providers/langchain-google-genai/src/utils/tools.ts)
- `openai.ts` - Copier [`langchain-openai/src/utils/tools.ts`](../langchainjs/libs/providers/langchain-openai/src/utils/tools.ts)
- `anthropic.ts` - Copier [`langchain-anthropic/src/utils/tools.ts`](../langchainjs/libs/providers/langchain-anthropic/src/utils/tools.ts)
- `index.ts` - Factory qui choisit le bon converter

### 2. **Tool Call Parsing**

Au lieu de parser nous-mêmes les réponses de chaque provider:

```typescript
// Dans notre LLMProvider adapter
class GeminiProvider implements LLMProvider {
  async generateWithTools(
    messages: Message[],
    tools: Tool[],
    options?: { toolChoice?: "auto" | "any" | "none" | string }
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    usage?: UsageMetadata;
  }> {
    // Convert tools to Gemini format
    const { tools: geminiTools, toolConfig } = convertToolsToGenAI(
      this.convertRagToolsToOpenAIFormat(tools),
      { toolChoice: options?.toolChoice }
    );

    // Call Gemini
    const response = await this.model.generateContent({
      contents: this.convertMessagesToGeminiFormat(messages),
      tools: geminiTools,
      toolConfig
    });

    // Parse tool calls using LangChain's logic
    const chatResult = mapGenerateContentResultToChatResult(response);

    return {
      content: chatResult.generations[0].text,
      toolCalls: chatResult.generations[0].message.tool_calls,
      usage: chatResult.generations[0].message.usage_metadata
    };
  }
}
```

### 3. **Message Format Conversion**

On peut bypasser leur système de messages mais réutiliser les conversions:

```typescript
// Notre format de message (simple)
interface Message {
  role: 'user' | 'agent' | 'system';
  content: string;
  toolCalls?: ToolCall[];
}

// Converter vers Gemini
function convertToGeminiContent(messages: Message[]): Content[] {
  return messages.map(msg => {
    if (msg.role === 'user') {
      return {
        role: 'user',
        parts: [{ text: msg.content }]
      };
    }

    if (msg.role === 'agent') {
      const parts: Part[] = [];

      if (msg.content) {
        parts.push({ text: msg.content });
      }

      if (msg.toolCalls) {
        parts.push(...msg.toolCalls.map(tc => ({
          functionCall: {
            name: tc.name,
            args: tc.args
          }
        })));
      }

      return {
        role: 'model',
        parts
      };
    }

    // ...
  });
}
```

---

## 🎨 Architecture Proposée pour RagForge

### Structure des Fichiers

```
packages/runtime/src/llm/
├── provider-adapter.ts           # Existe déjà (utilise LlamaIndex)
├── native-tool-calling/
│   ├── index.ts
│   ├── types.ts                  # Tool, ToolCall, ToolChoice types
│   ├── converters/
│   │   ├── gemini.ts            # Tool conversion for Gemini
│   │   ├── openai.ts            # Tool conversion for OpenAI
│   │   ├── anthropic.ts         # Tool conversion for Anthropic
│   │   └── index.ts             # Factory
│   ├── parsers/
│   │   ├── gemini.ts            # Parse Gemini responses
│   │   ├── openai.ts            # Parse OpenAI responses
│   │   ├── anthropic.ts         # Parse Anthropic responses
│   │   └── index.ts             # Factory
│   └── providers/
│       ├── gemini.ts            # GeminiNativeToolProvider
│       ├── openai.ts            # OpenAINativeToolProvider
│       ├── anthropic.ts         # AnthropicNativeToolProvider
│       └── index.ts
```

### Types Génériques

```typescript
// packages/runtime/src/llm/native-tool-calling/types.ts

/**
 * OpenAI-style tool definition (industry standard)
 * Compatible avec OpenAI, Anthropic, et convertible vers Gemini
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema
  };
}

/**
 * Tool call returned by LLM
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Tool choice option
 */
export type ToolChoice =
  | "auto"      // LLM decides
  | "any"       // Must call at least one tool
  | "none"      // Don't call any tools
  | { type: "function"; function: { name: string } }; // Specific tool

/**
 * Usage metadata
 */
export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/**
 * LLM response with tool calls
 */
export interface LLMToolResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: UsageMetadata;
  finishReason?: string;
}
```

### Provider Interface

```typescript
// packages/runtime/src/llm/native-tool-calling/providers/base.ts

export interface NativeToolCallingProvider {
  /**
   * Generate with native tool calling support
   */
  generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      toolChoice?: ToolChoice;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<LLMToolResponse>;

  /**
   * Stream with native tool calling support
   */
  streamWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      toolChoice?: ToolChoice;
      temperature?: number;
      maxTokens?: number;
    }
  ): AsyncGenerator<LLMToolResponse>;
}
```

### Example d'Implémentation (Gemini)

```typescript
// packages/runtime/src/llm/native-tool-calling/providers/gemini.ts

import { GoogleGenerativeAI } from '@google/generative-ai';
import { convertToolsToGenAI } from '../converters/gemini.js';
import { parseGeminiResponse } from '../parsers/gemini.js';
import type { NativeToolCallingProvider, ToolDefinition, LLMToolResponse, ToolChoice } from '../types.js';

export class GeminiNativeToolProvider implements NativeToolCallingProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(config: { apiKey: string; model: string }) {
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model;
  }

  async generateWithTools(
    messages: Message[],
    tools: ToolDefinition[],
    options?: {
      toolChoice?: ToolChoice;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<LLMToolResponse> {
    const model = this.client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.maxTokens,
      },
    });

    // Convert tools to Gemini format (extracted from LangChain)
    const { tools: geminiTools, toolConfig } = convertToolsToGenAI(tools, {
      toolChoice: options?.toolChoice,
    });

    // Convert messages to Gemini format
    const contents = this.convertMessagesToGeminiFormat(messages);

    // Call Gemini
    const response = await model.generateContent({
      contents,
      tools: geminiTools,
      toolConfig,
    });

    // Parse response (extracted from LangChain)
    return parseGeminiResponse(response);
  }

  private convertMessagesToGeminiFormat(messages: Message[]) {
    // Simple conversion - bypass LangChain message system
    return messages.map(msg => {
      if (msg.role === 'user') {
        return {
          role: 'user' as const,
          parts: [{ text: msg.content }],
        };
      }

      if (msg.role === 'agent') {
        const parts: any[] = [];

        if (msg.content) {
          parts.push({ text: msg.content });
        }

        if (msg.toolCalls) {
          parts.push(...msg.toolCalls.map(tc => ({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          })));
        }

        return {
          role: 'model' as const,
          parts,
        };
      }

      // system messages -> merge with next user message
      return {
        role: 'user' as const,
        parts: [{ text: msg.content }],
      };
    });
  }
}
```

### Integration avec AgentRuntime

```typescript
// packages/runtime/src/agents/agent-runtime.ts

import { NativeToolCallingProviderFactory } from '../llm/native-tool-calling/providers/index.js';

export class AgentRuntime {
  private nativeToolProvider?: NativeToolCallingProvider;

  constructor(
    private config: AgentConfig,
    private llmProvider: LLMProvider,
    private tools: ToolRegistry,
    private sessionManager: ChatSessionManager
  ) {
    // Check if provider supports native tool calling
    if (this.supportsNativeToolCalling()) {
      this.nativeToolProvider = NativeToolCallingProviderFactory.create(
        llmProvider.getProviderName(),
        llmProvider.getConfig()
      );
    }
  }

  private async callLLMWithTools(
    context: ConversationContext
  ): Promise<LLMResponse> {
    // Get tools
    const toolDefinitions = this.getToolDefinitions();

    // Use native tool calling if available
    if (this.nativeToolProvider) {
      const response = await this.nativeToolProvider.generateWithTools(
        this.buildMessagesFromContext(context),
        toolDefinitions,
        {
          toolChoice: "auto",
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
        }
      );

      // Convert to our LLMResponse format
      return {
        reasoning: response.content,
        tool_calls: response.toolCalls?.map(tc => ({
          tool_name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })),
        answer: response.toolCalls ? undefined : response.content,
      };
    }

    // Fallback to StructuredLLMExecutor (XML-based)
    return this.callLLMWithStructuredExecutor(context);
  }

  private getToolDefinitions(): ToolDefinition[] {
    return this.config.tools.map(toolName => {
      const tool = this.tools.get(toolName);
      if (!tool) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      // Convert to OpenAI-style tool definition
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties: Object.fromEntries(
              tool.parameters.map(p => [
                p.name,
                {
                  type: p.type,
                  description: p.description,
                  ...(p.default !== undefined ? { default: p.default } : {}),
                },
              ])
            ),
            required: tool.parameters.filter(p => p.required).map(p => p.name),
          },
        },
      };
    });
  }
}
```

---

## ✅ Avantages de cette Approche

### 1. **Réutilisation du Code Testé**
- Les conversions de LangChain sont **battle-tested** en production
- Gestion des edge cases (formats d'images, streaming, errors, etc.)
- Mises à jour quand les providers changent leurs APIs

### 2. **Bypass du Système LangChain**
- On ne dépend PAS de leur `Runnable`, `ChatMessage`, etc.
- On garde notre système simple de `Message`, `ToolCall`
- On extrait **uniquement** les conversions de format

### 3. **Support Multi-Provider Unifié**
- Une interface commune `NativeToolCallingProvider`
- Factory qui instancie le bon provider
- Fallback automatique vers StructuredLLMExecutor si pas de support natif

### 4. **Meilleure Performance**
- Tool calling natif = **plus rapide** et **plus fiable** que XML parsing
- Moins de tokens utilisés (pas besoin de schemas XML verbeux)
- Streaming support out-of-the-box

### 5. **Maintenance Simplifiée**
- On peut mettre à jour les conversions depuis LangChain si besoin
- Ou les copier une fois et les maintenir nous-mêmes
- Clear separation of concerns

---

## 🚀 Plan d'Implémentation

### Phase 1: Extraction (1-2 jours)
1. Copier les fichiers de conversion de LangChain:
   - [`langchain-google-genai/src/utils/tools.ts`](../langchainjs/libs/providers/langchain-google-genai/src/utils/tools.ts) → `converters/gemini.ts`
   - [`langchain-google-genai/src/utils/common.ts`](../langchainjs/libs/providers/langchain-google-genai/src/utils/common.ts) → `parsers/gemini.ts`
   - (Optionnel: OpenAI, Anthropic)

2. Retirer les dépendances LangChain:
   - Remplacer `StructuredToolInterface` par notre `ToolDefinition`
   - Remplacer `AIMessage`, `ToolMessage` par nos types simples
   - Garder uniquement la logique de conversion

3. Créer les types génériques (`types.ts`)

### Phase 2: Provider Implementation (2-3 jours)
1. Implémenter `GeminiNativeToolProvider`
2. Tester avec des tool calls simples
3. Tester avec des tool calls multiples
4. Tester le streaming

### Phase 3: Integration (1-2 jours)
1. Modifier `AgentRuntime` pour détecter le support natif
2. Fallback vers `StructuredLLMExecutor` si pas de support
3. Tests end-to-end

### Phase 4: Additional Providers (optionnel)
1. Implémenter `OpenAINativeToolProvider`
2. Implémenter `AnthropicNativeToolProvider`
3. Documentation

---

## 📊 Comparaison: Native vs StructuredLLMExecutor

| Aspect | Native Tool Calling | StructuredLLMExecutor (XML) |
|--------|-------------------|----------------------------|
| **Support** | Gemini, OpenAI, Anthropic, Claude | Tous les providers |
| **Performance** | ⚡ Très rapide | 🐢 Plus lent (parsing XML) |
| **Fiabilité** | ✅ Très fiable | ⚠️ Peut échouer si XML mal formé |
| **Token usage** | 📉 Moins de tokens | 📈 Plus de tokens (schemas XML) |
| **Streaming** | ✅ Built-in | ⏳ TODO |
| **Maintenance** | 🔧 Dépend des providers | ✅ Sous notre contrôle |
| **Complexité** | 🔀 Conversions par provider | ✅ Uniforme |

**Recommandation:**
- **Utiliser native tool calling quand disponible** (Gemini, OpenAI, Anthropic)
- **Fallback vers StructuredLLMExecutor** pour les autres (Ollama local, etc.)
- **AgentRuntime détecte automatiquement** et choisit la meilleure option

---

## 🎯 Conclusion

En extrayant la logique de tool calling de LangChain.js, on peut:

1. ✅ **Bénéficier du tool calling natif** pour meilleure performance
2. ✅ **Bypasser leur système de messages** et garder le nôtre simple
3. ✅ **Réutiliser du code battle-tested** sans dépendre de LangChain
4. ✅ **Fallback automatique** vers StructuredLLMExecutor
5. ✅ **Support multi-provider unifié** avec une interface commune

**Next Step:** Décider si on extrait le code ou si on import directement leurs packages de conversion.
