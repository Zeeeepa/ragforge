# LucieCode Multi-Provider Plan

## Vision

Transformer LucieCode (fork de Gemini CLI) en un client AI universel supportant
plusieurs providers (Google, OpenAI, Anthropic, etc.) tout en gardant la compatibilité
avec l'écosystème RagForge.

---

## Phase 1: Abstraction du Provider (Core)

### 1.1 Interface Provider Unifiée

```typescript
// packages/core/src/providers/types.ts

export interface AIProvider {
  readonly name: string;
  readonly displayName: string;

  // Capabilities
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsEmbeddings: boolean;

  // Models
  listModels(): Promise<ModelInfo[]>;
  getDefaultModel(): string;

  // Text generation
  generateText(params: GenerateParams): Promise<GenerateResult>;
  streamText(params: GenerateParams): AsyncIterable<StreamChunk>;

  // Embeddings (optional)
  embed?(text: string | string[]): Promise<EmbeddingResult>;

  // Vision (optional)
  analyzeImage?(image: ImageInput, prompt: string): Promise<string>;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
  inputPricing?: { per1kTokens: number };
  outputPricing?: { per1kTokens: number };
}

export interface GenerateParams {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}
```

### 1.2 Implémentations Provider

```
packages/core/src/providers/
├── types.ts              # Interfaces communes
├── registry.ts           # Registre des providers
├── google/
│   ├── index.ts          # Export
│   ├── google-provider.ts      # API Key auth
│   └── vertex-provider.ts      # Vertex AI auth
├── openai/
│   ├── index.ts
│   └── openai-provider.ts
├── anthropic/
│   ├── index.ts
│   └── anthropic-provider.ts
└── index.ts              # Export all
```

### 1.3 Registry Pattern

```typescript
// packages/core/src/providers/registry.ts

class ProviderRegistry {
  private providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): AIProvider | undefined {
    return this.providers.get(name);
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  // Auto-detect available providers based on env/config
  async detectAvailable(): Promise<AIProvider[]> {
    const available: AIProvider[] = [];

    if (process.env.GEMINI_API_KEY) {
      available.push(new GoogleProvider());
    }
    if (process.env.OPENAI_API_KEY) {
      available.push(new OpenAIProvider());
    }
    if (process.env.ANTHROPIC_API_KEY) {
      available.push(new AnthropicProvider());
    }
    // Check for gcloud ADC
    if (await this.hasGCloudADC()) {
      available.push(new VertexProvider());
    }

    return available;
  }
}

export const providerRegistry = new ProviderRegistry();
```

---

## Phase 2: Intégration Vercel AI SDK

### 2.1 Wrapper Vercel AI SDK

```typescript
// packages/core/src/providers/vercel-adapter.ts

import { generateText, streamText, embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';

export function createProvider(config: ProviderConfig): AIProvider {
  switch (config.type) {
    case 'google':
      return new VercelGoogleProvider(createGoogleGenerativeAI({
        apiKey: config.apiKey,
      }));

    case 'vertex':
      return new VercelVertexProvider(createVertex({
        project: config.project,
        location: config.location,
      }));

    case 'openai':
      return new VercelOpenAIProvider(createOpenAI({
        apiKey: config.apiKey,
      }));

    case 'anthropic':
      return new VercelAnthropicProvider(createAnthropic({
        apiKey: config.apiKey,
      }));
  }
}
```

### 2.2 Mapping des Modèles

```typescript
// packages/core/src/providers/model-mapping.ts

export const MODEL_ALIASES: Record<string, Record<string, string>> = {
  // Generic aliases -> provider-specific models
  'default': {
    'google': 'gemini-2.0-flash',
    'openai': 'gpt-4o',
    'anthropic': 'claude-sonnet-4-20250514',
  },
  'fast': {
    'google': 'gemini-2.0-flash',
    'openai': 'gpt-4o-mini',
    'anthropic': 'claude-haiku-3-5-20241022',
  },
  'smart': {
    'google': 'gemini-2.5-pro',
    'openai': 'gpt-4o',
    'anthropic': 'claude-sonnet-4-20250514',
  },
  'reasoning': {
    'google': 'gemini-2.5-pro',
    'openai': 'o1',
    'anthropic': 'claude-sonnet-4-20250514',
  },
};

export function resolveModel(alias: string, provider: string): string {
  return MODEL_ALIASES[alias]?.[provider] ?? alias;
}
```

---

## Phase 3: Configuration Multi-Provider

### 3.1 Schema Settings

```typescript
// LucieCode settings.json schema

interface LucieCodeSettings {
  // Provider selection
  provider: 'google' | 'vertex' | 'openai' | 'anthropic' | 'auto';

  // Provider-specific config
  providers: {
    google?: {
      apiKey?: string;  // Or from env
      defaultModel?: string;
    };
    vertex?: {
      project: string;
      location: string;
      defaultModel?: string;
    };
    openai?: {
      apiKey?: string;
      organization?: string;
      defaultModel?: string;
    };
    anthropic?: {
      apiKey?: string;
      defaultModel?: string;
    };
  };

  // Model preferences (aliases)
  models: {
    default?: string;   // e.g., 'gemini-2.0-flash' or alias 'fast'
    coding?: string;    // Model for code tasks
    reasoning?: string; // Model for complex reasoning
  };

  // RagForge settings
  ragforge: {
    embeddingProvider?: 'google' | 'openai' | 'vertex';
    embeddingModel?: string;
    replicateApiToken?: string;
  };
}
```

### 3.2 CLI Commands

```bash
# Provider management
lucie provider list              # List available providers
lucie provider set openai        # Set default provider
lucie provider test              # Test current provider connection

# API key management
lucie auth google <key>          # Set Google API key
lucie auth openai <key>          # Set OpenAI API key
lucie auth anthropic <key>       # Set Anthropic API key
lucie auth vertex                # Configure Vertex AI (interactive)

# Model selection
lucie model list                 # List models for current provider
lucie model set <model>          # Set default model
lucie model alias fast gpt-4o-mini  # Create custom alias
```

### 3.3 Environment Variables

```bash
# Provider selection
LUCIE_PROVIDER=openai           # Override provider

# API Keys (existing + new)
GEMINI_API_KEY=xxx              # Google Generative AI
OPENAI_API_KEY=xxx              # OpenAI
ANTHROPIC_API_KEY=xxx           # Anthropic

# Vertex AI (uses gcloud ADC by default)
GOOGLE_CLOUD_PROJECT=xxx        # Vertex project
GOOGLE_CLOUD_LOCATION=us-central1

# Model override
LUCIE_MODEL=gpt-4o              # Override model for session
```

---

## Phase 4: Embeddings Multi-Provider

### 4.1 Embedding Provider Interface

```typescript
// packages/core/src/embeddings/types.ts

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;

  // For compatibility checking
  getModelId(): string;
}
```

### 4.2 Implémentations

```typescript
// packages/core/src/embeddings/providers/

// Google (Gemini API with API key)
export class GoogleEmbeddingProvider implements EmbeddingProvider {
  name = 'google';
  dimensions = 3072;  // gemini-embedding-001 native (best quality)

  constructor(private client: GoogleGenAI, private outputDimensions = 3072) {
    this.dimensions = outputDimensions;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.client.models.embedContent({
      model: 'gemini-embedding-001',
      contents: [{ parts: [{ text }] }],
      config: { outputDimensionality: this.outputDimensions },
    });
    return result.embeddings?.[0]?.values ?? [];
  }
}

// OpenAI (3072D = same dimension as Google, but NOT compatible - different vector space)
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = 'openai';
  dimensions = 3072;  // text-embedding-3-large (same dim, different model = must re-embed)

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-large'),
      value: text,
    });
    return embedding;
  }
}

// Vertex AI (same model, different auth)
export class VertexEmbeddingProvider implements EmbeddingProvider {
  name = 'vertex';
  dimensions = 3072;  // gemini-embedding-001 native (same as Google)

  constructor(private outputDimensions = 3072) {
    this.dimensions = outputDimensions;
  }

  async embed(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: vertex.textEmbeddingModel('gemini-embedding-001'),
      value: text,
    });
    return embedding;
  }
}
```

### 4.3 Gestion du Changement de Provider

**Rule: Changing embedding provider ALWAYS requires re-embedding.**

Even with same dimensions (3072), embeddings from different models live in different
vector spaces and cannot be mixed. The only exception is Google ↔ Vertex AI (same model).

```typescript
// packages/core/src/embeddings/migration.ts

export async function checkEmbeddingCompatibility(
  brain: BrainManager,
  newProvider: EmbeddingProvider
): Promise<{ compatible: boolean; reason?: string }> {
  const currentConfig = await brain.getEmbeddingConfig();

  if (!currentConfig) {
    return { compatible: true };  // Fresh brain
  }

  // Same provider + model = compatible
  if (currentConfig.provider === newProvider.name &&
      currentConfig.model === newProvider.getModelId()) {
    return { compatible: true };
  }

  // Special case: Google <-> Vertex with same model = compatible
  const bothGemini =
    ['google', 'vertex'].includes(currentConfig.provider) &&
    ['google', 'vertex'].includes(newProvider.name) &&
    currentConfig.model === newProvider.getModelId();

  if (bothGemini) {
    return { compatible: true };
  }

  // Different model = must re-embed (even if same dimensions!)
  return {
    compatible: false,
    reason: `Switching from ${currentConfig.provider}/${currentConfig.model} ` +
            `to ${newProvider.name}/${newProvider.getModelId()} requires re-embedding. ` +
            `Run 'lucie brain regenerate' to rebuild all embeddings.`
  };
}
```

---

## Phase 5: UI/UX Updates

### 5.1 Status Bar

```
LucieCode v0.4.0 | openai:gpt-4o | brain:active | embed:google
                   ^^^^^^^^^^^^^^   ^^^^^^^^^^^   ^^^^^^^^^^^^^
                   Provider:Model   RagForge      Embedding provider
```

### 5.2 Welcome Message

```
Welcome to LucieCode!

Provider: OpenAI (gpt-4o)
Brain: Active (1,234 files indexed)
Embeddings: Google (text-embedding-004)

Type /help for commands or start chatting.
```

### 5.3 Provider Switch Flow

```
> /provider anthropic

Switching to Anthropic...
✓ API key found
✓ Connected to claude-sonnet-4-20250514
✓ Tools compatible

Note: RagForge brain will continue using Google embeddings.
To change embedding provider, run: /embed provider openai

Now using: anthropic:claude-sonnet-4-20250514
```

---

## Phase 6: LucieCode → RagForge Provider Delegation

### Principle
**LucieCode owns all auth. RagForge daemon receives provider config at startup.**

- Config lives in `~/.luciecode/` (not `~/.ragforge/`)
- RagForge only stores brain data in `~/.ragforge/brain/`
- At daemon init, LucieCode passes the full provider config
- Daemon is stateless regarding auth

### 6.1 Config Structure

```
~/.luciecode/                    # LucieCode owns this
├── oauth_creds.json             # Google OAuth tokens
├── api_keys.json                # { gemini, openai, anthropic, replicate }
├── settings.json                # User preferences
└── ...

~/.ragforge/                     # RagForge daemon data only
└── brain/
    ├── neo4j/
    └── cache/
```

### 6.2 Auth Config Types

```typescript
// Auth config (same as current Gemini CLI)
export type AuthConfig =
  | { type: 'oauth-file'; path: string }        // ~/.luciecode/oauth_creds.json
  | { type: 'vertex-adc' }                      // Uses gcloud ADC
  | { type: 'env' }                             // GEMINI_API_KEY env var
  ;

export interface DaemonConfig {
  auth: AuthConfig;

  // Model config
  embeddingModel?: string;      // Default: gemini-embedding-001
  embeddingDimensions?: number; // Default: 3072
}
```

**Note:** API keys via env vars (like current Gemini CLI). No `api_keys.json` file.

**Why file path for OAuth:**
- Daemon re-reads `oauth_creds.json` → always fresh tokens
- LucieCode handles refresh → writes to file
- No tokens in HTTP requests

### 6.3 Daemon Startup Flow

```typescript
// LucieCode: brain-manager-provider.ts

export async function ensureDaemon(): Promise<boolean> {
  const configDir = path.join(os.homedir(), '.luciecode');
  const oauthPath = path.join(configDir, 'oauth_creds.json');

  // Determine auth type (same priority as Gemini CLI)
  let auth: AuthConfig;
  if (fs.existsSync(oauthPath)) {
    auth = { type: 'oauth-file', path: oauthPath };
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    auth = { type: 'vertex-adc' };
  } else {
    auth = { type: 'env' };  // GEMINI_API_KEY
  }

  await ensureDaemonRunning();
  await configureDaemon({
    auth,
    embeddingModel: 'gemini-embedding-001',
    embeddingDimensions: 3072,
  });

  return true;
}
```

### 6.4 Daemon Credential Loading

```typescript
// RagForge daemon

let authConfig: AuthConfig;

app.post('/api/configure', async (req, res) => {
  authConfig = req.body.auth;
  res.json({ success: true });
});

async function getCredentials(): Promise<Credentials> {
  switch (authConfig.type) {
    case 'oauth-file':
      // Re-read file → always fresh tokens
      const oauth = JSON.parse(fs.readFileSync(authConfig.path, 'utf-8'));
      return { type: 'oauth', accessToken: oauth.access_token };

    case 'vertex-adc':
      return { type: 'adc' };  // Google SDK handles ADC

    case 'env':
      return { type: 'api-key', apiKey: process.env.GEMINI_API_KEY! };
  }
}
```

### 6.5 OAuth Token Refresh

```typescript
// LucieCode handles refresh, daemon just re-reads file

// In LucieCode: intercept 401 errors from daemon
async function callDaemonWithRetry(tool: string, params: any): Promise<any> {
  try {
    return await callDaemon(tool, params);
  } catch (error) {
    if (error.status === 401 && config.auth.type === 'oauth-file') {
      // Refresh token
      await refreshOAuthToken();
      // Retry - daemon will read fresh token from file
      return await callDaemon(tool, params);
    }
    throw error;
  }
}

async function refreshOAuthToken(): Promise<void> {
  const oauthPath = path.join(os.homedir(), '.luciecode', 'oauth_creds.json');
  const oauth = JSON.parse(fs.readFileSync(oauthPath, 'utf-8'));

  const newTokens = await googleRefreshToken(oauth.refresh_token);

  // Write back to file - daemon will read fresh tokens
  fs.writeFileSync(oauthPath, JSON.stringify({
    ...oauth,
    access_token: newTokens.access_token,
    expires_at: newTokens.expires_at,
  }));
}
```

### Benefits
- **Clean separation**: LucieCode = auth, RagForge = brain
- **Daemon is stateless**: No file paths hardcoded
- **Easy testing**: Mock providers for tests
- **Multi-client ready**: Other clients could use RagForge daemon too

---

## Implementation Order

### Sprint 1: Foundation (1-2 weeks effort)
- [ ] Create provider interface and types
- [ ] Implement Google provider (existing code refactor)
- [ ] Add Vercel AI SDK dependencies
- [ ] Create provider registry

### Sprint 2: OpenAI + Anthropic (1 week effort)
- [ ] Implement OpenAI provider
- [ ] Implement Anthropic provider
- [ ] Add provider CLI commands
- [ ] Update settings schema

### Sprint 3: Embeddings (1 week effort)
- [ ] Create embedding provider interface
- [ ] Implement Google/OpenAI/Vertex embedding providers
- [ ] Add embedding migration logic
- [ ] Update RagForge to use abstraction

### Sprint 4: Polish (1 week effort)
- [ ] Status bar updates
- [ ] Provider switching UX
- [ ] Documentation
- [ ] Tests

---

## Dependencies to Add

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/google": "^1.0.0",
    "@ai-sdk/google-vertex": "^1.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0"
  }
}
```

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tool compatibility varies by provider | High | Test tools with each provider, document limitations |
| Embedding dimension mismatch | High | Warn user, provide migration command |
| API cost differences | Medium | Show pricing info in model selection |
| Rate limiting differences | Medium | Implement provider-specific rate limiting |
| Breaking changes in Vercel AI SDK | Low | Pin versions, monitor releases |

---

## Success Metrics

1. **Provider coverage**: Support 4+ providers (Google, Vertex, OpenAI, Anthropic)
2. **Zero regression**: All existing features work with Google provider
3. **Easy switching**: Change provider in < 30 seconds
4. **Embedding flexibility**: Support 3+ embedding providers
5. **Documentation**: Complete guide for each provider setup
