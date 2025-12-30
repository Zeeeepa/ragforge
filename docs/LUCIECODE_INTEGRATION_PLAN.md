# LucieCode + RagForge Integration Plan

## Current State

### Gemini CLI (LucieCode) Auth - LEGACY
- `GEMINI_API_KEY` - Direct API key auth
- Google OAuth - Login with Google → `~/.gemini/oauth_creds.json`
- Vertex AI - Google Cloud auth
- Config stored in `~/.gemini/settings.json`
- Model selection via CLI arg, env var, or settings

### RagForge Auth
- `~/.ragforge/.env` stores API keys
- `GEMINI_API_KEY` - Required for embeddings, vision, web search
- `REPLICATE_API_TOKEN` - Optional for 3D generation
- Falls back to `process.env` if not in config

---

## Phase 0: Auth Architecture (Priority)

### Principle
**LucieCode owns auth, RagForge daemon receives provider config at init.**

- LucieCode stores all config in `~/.luciecode/`
- RagForge daemon stays generic (no hardcoded paths)
- At daemon startup, LucieCode passes the provider configuration
- Daemon uses whatever provider it's given

### LucieCode Config Structure

```
~/.luciecode/
├── oauth_creds.json      # Google OAuth tokens
├── google_accounts.json  # Google account info
├── settings.json         # LucieCode settings (model, preferences, etc.)
├── api_keys.json         # API keys (GEMINI, OPENAI, ANTHROPIC, REPLICATE)
├── installation_id       # Unique installation ID
└── state.json            # Session state
```

### RagForge Daemon Data (separate)

```
~/.ragforge/
└── brain/                # Neo4j data, indexes, embeddings
    ├── neo4j/
    └── cache/
```

### Provider Config Interface

```typescript
// packages/core/src/daemon/types.ts

export type AuthConfig =
  | { type: 'oauth-file'; path: string }        // ~/.luciecode/oauth_creds.json
  | { type: 'vertex-adc' }                      // Uses gcloud ADC automatically
  | { type: 'env' }                             // GEMINI_API_KEY env var
  ;

export interface DaemonConfig {
  auth: AuthConfig;

  // Model config
  embeddingModel?: string;      // Default: gemini-embedding-001
  embeddingDimensions?: number; // Default: 3072
}
```

**Note:** API keys via env vars (comme Gemini CLI actuel). Pas de fichier `api_keys.json` pour l'instant.

**Why file path for OAuth:**
- Daemon re-reads `oauth_creds.json` when needed → always fresh tokens
- LucieCode handles token refresh → writes to file
- No tokens in HTTP requests

### Implementation

1. **LucieCode passes config at daemon startup**
   ```typescript
   // LucieCode: brain-manager-provider.ts

   export async function ensureDaemon(): Promise<boolean> {
     const configDir = path.join(os.homedir(), '.luciecode');
     const oauthPath = path.join(configDir, 'oauth_creds.json');

     // Determine auth type
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

2. **Daemon reads credentials**
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

3. **Change config path in LucieCode**
   ```typescript
   // Find all occurrences of .gemini and replace with .luciecode
   // Before
   const CONFIG_DIR = path.join(os.homedir(), '.gemini');

   // After
   const CONFIG_DIR = path.join(os.homedir(), '.luciecode');
   ```

   No migration needed - LucieCode is a fork, new config directory for new product.

### Benefits
- **RagForge stays generic**: No dependency on LucieCode file structure
- **Single auth source**: LucieCode manages all credentials
- **Easy multi-provider**: Just change what LucieCode passes to daemon
- **OAuth works**: Tokens passed at runtime, no file sharing needed
- **Testable**: Daemon can be tested with mock providers

---

## Phase 1: API Key Synchronization

### Goal
When LucieCode starts the daemon, automatically share the Gemini API key with RagForge.

### Implementation

1. **In `brain-manager-provider.ts` (LucieCode)**
   ```typescript
   export async function ensureDaemon(): Promise<boolean> {
     // Get Gemini API key from LucieCode's environment/config
     const geminiKey = process.env.GEMINI_API_KEY;

     // Pass to daemon startup if available
     if (geminiKey) {
       await ensureDaemonRunning(false, { geminiApiKey: geminiKey });
     }
   }
   ```

2. **In daemon startup (RagForge)**
   - Accept API key from client
   - Write to `~/.ragforge/.env` if not already set
   - Use for current session

3. **Limitations**
   - Google OAuth auth cannot be shared (different auth model)
   - Only works with `GEMINI_API_KEY` auth type

### Alternative: Startup Sync
At LucieCode startup, sync keys from `~/.gemini/` to `~/.ragforge/`:
- Read LucieCode config for API key
- Write to `~/.ragforge/.env`
- Daemon reads from there

---

## Phase 2: Replicate Token Support

### Goal
Allow LucieCode users to configure Replicate API token for 3D generation.

### Implementation

1. **Add to LucieCode settings schema**
   ```typescript
   ragforge: {
     replicateApiToken: string,
     // Future: other RagForge-specific settings
   }
   ```

2. **Sync on startup**
   - Read from LucieCode settings
   - Write to `~/.ragforge/.env`

3. **UI/CLI command**
   - `lucie config replicate <token>`
   - Stores in settings.json

---

## Phase 3: Model Configuration

### Current
- RagForge uses fixed model for embeddings: `gemini-embedding-001`
- Vision uses `gemini-2.0-flash` or `gemini-2.5-flash`
- LLM calls use various models

### Options

**Option A: Use LucieCode's model for everything**
- Pass model name from LucieCode to daemon
- RagForge uses it for LLM calls
- Keep embeddings on fixed model (different capability)

**Option B: Separate config**
- Embeddings: fixed (text-embedding-004)
- Vision: configurable, default to LucieCode's model
- LLM calls: use LucieCode's model

**Recommendation: Option B**
- Embeddings must stay consistent (or we regenerate all)
- Vision/LLM can follow LucieCode's model choice

---

## Phase 4: Additional Tools

### Tools to Add

1. **edit_image** (requires Replicate)
   - Edit existing images with AI
   - Depends on `REPLICATE_API_TOKEN`

2. **generate_3d_from_image** (requires Replicate)
   - Create 3D model from reference image
   - Depends on `REPLICATE_API_TOKEN`

3. **generate_3d_from_text** (requires Replicate)
   - Create 3D model from text description
   - Depends on `REPLICATE_API_TOKEN`

4. **edit_file** (already in MCP)
   - Copy from MCP's file-tools.ts
   - Add validation before applying changes

### Tool Availability
- Tools requiring Replicate should check for token availability
- Return helpful error if token missing, with setup instructions

---

## Implementation Order

### Step 1: API Key Sync (Quick Win)
- Modify `ensureDaemon()` to pass API key to daemon
- Daemon writes to `~/.ragforge/.env` if needed
- Immediate benefit: no manual API key setup

### Step 2: Replicate Token Support
- Add settings schema entry
- Add CLI command for setup
- Sync to RagForge config

### Step 3: Add Replicate-based Tools
- edit_image
- generate_3d_from_image
- generate_3d_from_text
- Each checks for token, gives setup instructions if missing

### Step 4: Model Sync (Optional)
- Pass model preference to daemon
- Use for vision/LLM calls
- Keep embeddings stable

---

## Phase 5: Vercel AI SDK Integration (Recommended)

### Why Vercel AI SDK?
The Vercel AI SDK (`ai` package) provides a unified interface for multiple AI providers,
solving our OAuth and Vertex AI authentication challenges.

### Supported Providers
- OpenAI, Azure OpenAI, Anthropic, Amazon Bedrock
- **Google Generative AI** (API key)
- **Google Vertex AI** (ADC, service account, OAuth)
- Mistral AI, Groq, Together.ai, Cohere, Fireworks, DeepSeek, Replicate, etc.

### Key Benefits

1. **Unified Interface**
   - Same code works with any provider
   - Switch providers without code changes
   - `generateText()`, `streamText()`, `embed()` work identically

2. **Google Vertex AI Support** (`@ai-sdk/google-vertex`)
   - **ADC**: `gcloud auth application-default login`
   - **Service Account**: JSON key file or impersonation
   - **OAuth**: Short-lived tokens (1h default)
   - Supports embeddings via `.textEmbeddingModel()`

3. **Google Generative AI Support** (`@ai-sdk/google`)
   - API key authentication
   - Embeddings via `.textEmbedding()`
   - Same models as current implementation

### Implementation

```typescript
// Current RagForge (API key only)
import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI(apiKey);

// With Vercel AI SDK (multi-auth)
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { embed, generateText } from 'ai';

// API key auth
const google = createGoogleGenerativeAI({ apiKey });

// Vertex AI with ADC (reads from gcloud auth)
const vertex = createVertex({ project: 'my-project', location: 'us-central1' });

// Unified API
const embedding = await embed({
  model: google.textEmbeddingModel('gemini-embedding-001'),
  value: 'Hello world',
});

const result = await generateText({
  model: vertex('gemini-2.0-flash'),
  prompt: 'Describe this image',
});
```

### Migration Path

1. **Add dependencies**
   ```bash
   npm install ai @ai-sdk/google @ai-sdk/google-vertex
   ```

2. **Create provider abstraction** in RagForge
   - Detect auth type from environment/config
   - API key → `@ai-sdk/google`
   - ADC/Vertex → `@ai-sdk/google-vertex`
   - Return unified provider instance

3. **Replace direct Google SDK calls**
   - Embeddings: `genAI.getGenerativeModel()` → `embed()`
   - Vision: `model.generateContent()` → `generateText()`
   - Streaming: `generateContentStream()` → `streamText()`

4. **Benefits**
   - OAuth users can use `gcloud auth application-default login`
   - Vertex AI users get native support
   - API key users continue working as before
   - Future: easy to add OpenAI, Anthropic, etc.

---

## TODO - À traiter

### 1. Fichiers trop lourds pour le parsing code (embeddings)
Quand un fichier est trop gros pour le parsing AST (ex: `bundle.js` si quelqu'un enlève l'exclude):
- **Option A**: Force ignore (skip silently)
- **Option B**: Traiter comme texte brut → chunker sans structure

**Test avec gemini.js (22MB, 485K lignes):**
```
Parsed in 7.2s
Scopes: 38,602 (31,713 functions, 96 classes, 6,793 chunks)
Max scope: 2.1 MB / 6,233 lignes ← PROBLÈME!
```

Le parser trouve des patterns mais certains scopes sont énormes (modules bundlés).

**Solution:** Reprendre la logique du TypeScript parser dans GenericCodeParser:
1. Quand un scope est très gros → extraire des sous-scopes (comme une classe)
2. Texte entre scopes / au niveau fichier → créer des scopes `file_scope_001`, etc.
3. Le TS parser fait déjà ça → copier cette logique dans GenericCodeParser

### 2. Fichiers trop lourds dans read_file
Ne pas laisser LucieCode passer un fichier entier de 50k lignes au LLM.
Truncate + message:
```
[Output truncated - file has 50,000 lines]
Use offset and limit parameters to read specific sections.
Example: read_file path="..." offset=1000 limit=500
```

---

## Questions to Resolve

1. **Embedding model change**: If user changes model
   - Need to regenerate all embeddings
   - Show warning, provide command to regenerate

2. **Multi-user scenarios**: Shared machine
   - Each user has own `~/.ragforge/`
   - Should work fine

3. **Vercel AI SDK adoption**: Full or partial?
   - Option A: Replace all Google SDK usage (recommended)
   - Option B: Only for auth, keep existing code for API calls

## Resolved Questions

1. ~~**Google OAuth users**: How to handle?~~
   → **Solved by Phase 0**: Share `oauth_creds.json` between LucieCode and RagForge

2. ~~**Vertex AI users**: Same question~~
   → **Solved by Phase 0 + Phase 5**: Unified config + Vercel AI SDK supports ADC
