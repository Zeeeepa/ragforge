# LucieCode Auth Integration avec RagForge Daemon

## Trouvailles Brain Search

### 1. Types d'Authentification (AuthType)

**Fichier:** `LucieCode/packages/core/src/core/contentGenerator.ts:49-55`

```typescript
enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  LEGACY_CLOUD_SHELL = 'cloud-shell',
  COMPUTE_ADC = 'compute-default-credentials',
}
```

### 2. Détection du Type d'Auth depuis l'Environnement

**Fichier:** `LucieCode/packages/cli/src/validateNonInterActiveAuth.ts:20-31`

```typescript
function getAuthTypeFromEnv(): AuthType | undefined {
  if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
    return AuthType.LOGIN_WITH_GOOGLE;
  }
  if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') {
    return AuthType.USE_VERTEX_AI;
  }
  if (process.env['GEMINI_API_KEY']) {
    return AuthType.USE_GEMINI;
  }
  return undefined;
}
```

### 3. Stockage OAuth Credentials

**Fichier:** `LucieCode/packages/core/src/code_assist/oauth-credential-storage.ts`

- `OAuthCredentialStorage.loadCredentials()` - charge depuis keychain ou fichier
- `OAuthCredentialStorage.saveCredentials()` - sauvegarde les tokens
- `migrateFromFileStorage()` - migre depuis `~/.luciecode/oauth_creds.json`

**Constantes importantes:**
- `GEMINI_DIR = '.luciecode'` (dans `packages/core/src/utils/paths.ts`)
- `OAUTH_FILE = 'oauth_creds.json'` (dans `packages/core/src/config/storage.ts`)

### 4. Token Storage Hierarchy

```
HybridTokenStorage
  ├── KeychainTokenStorage (préféré, utilise le keychain système)
  └── FileTokenStorage (fallback, fichier JSON encrypté)
```

**Fichiers:**
- `packages/core/src/mcp/token-storage/hybrid-token-storage.ts`
- `packages/core/src/mcp/token-storage/keychain-token-storage.ts`
- `packages/core/src/mcp/token-storage/file-token-storage.ts`

### 5. Interface OAuthCredentials

**Fichier:** `LucieCode/packages/core/src/mcp/token-storage/types.ts:21-28`

```typescript
interface OAuthCredentials {
  serverName: string;
  token: OAuthToken;
  clientId?: string;
  tokenUrl?: string;
  mcpServerUrl?: string;
  updatedAt: number;
}
```

### 6. Refresh Auth Flow

**Fichier:** `LucieCode/packages/core/src/config/config.ts:711-782`

`Config.refreshAuth(authMethod: AuthType)` - principale méthode pour rafraîchir l'auth

---

## Mapping AuthType → RagForge AuthConfig

| LucieCode AuthType | RagForge AuthConfig |
|-------------------|---------------------|
| `LOGIN_WITH_GOOGLE` (oauth-personal) | `{ type: 'oauth-file', path: '~/.luciecode/oauth_creds.json' }` |
| `USE_VERTEX_AI` | `{ type: 'vertex-adc' }` |
| `USE_GEMINI` (gemini-api-key) | `{ type: 'env' }` |
| `COMPUTE_ADC` | `{ type: 'vertex-adc' }` |

---

## Plan d'Intégration

1. **Dans `brain-manager-provider.ts`:**
   - Détecter le type d'auth actuel
   - Après `ensureDaemonRunning()`, appeler `/api/configure` avec l'AuthConfig approprié

2. **Le daemon RagForge:**
   - Reçoit AuthConfig via `/api/configure`
   - Lit les credentials depuis le fichier OAuth (pas les credentials en mémoire)
   - Utilise `authManager.getAccessToken()` pour les appels API

---

## Chaîne de Dépendances Auth

```
Config.refreshAuth(authType)
    ↓
createContentGeneratorConfig(config, authType)
    ↓
createContentGenerator(config)
    ↓
initOauthClient(authType, config)  [dans oauth2.ts]
    ↓
OAuthCredentialStorage.loadCredentials() / saveCredentials()
    ↓
HybridTokenStorage → KeychainTokenStorage ou FileTokenStorage
```

### Fichiers Clés

| Fichier | Rôle |
|---------|------|
| `core/contentGenerator.ts` | Définit `AuthType` enum et `createContentGeneratorConfig()` |
| `core/config/config.ts` | `Config.refreshAuth()` et stocke `contentGeneratorConfig.authType` |
| `code_assist/oauth2.ts` | `initOauthClient()`, `getOauthClient()`, gère OAuth flow |
| `code_assist/oauth-credential-storage.ts` | `OAuthCredentialStorage` - load/save credentials |
| `cli/validateNonInterActiveAuth.ts` | `getAuthTypeFromEnv()` - détecte auth depuis env vars |

### Accès au Type d'Auth

Le type d'auth actuel est accessible via:
- `config.contentGeneratorConfig.authType` (dans Config)
- `getAuthTypeFromEnv()` (pour détection depuis environnement)

---

## Stockage des Tokens - IMPORTANT

### Variables d'Environnement

| Variable | Effet |
|----------|-------|
| `GEMINI_FORCE_ENCRYPTED_FILE_STORAGE=true` | Force OAuthCredentialStorage (keychain/encrypted) |
| `GEMINI_FORCE_FILE_STORAGE=true` | Force FileTokenStorage (pas keychain) |

### Logique dans `fetchCachedCredentials()` (oauth2.ts:580-607)

```typescript
async function fetchCachedCredentials() {
  const useEncryptedStorage = getUseEncryptedStorageFlag();
  if (useEncryptedStorage) {
    return OAuthCredentialStorage.loadCredentials(); // Keychain!
  }

  // Sinon, lit directement depuis fichier
  const pathsToTry = [
    Storage.getOAuthCredsPath(), // ~/.luciecode/oauth_creds.json
    process.env['GOOGLE_APPLICATION_CREDENTIALS'],
  ];
  // ...
}
```

### Problème pour le Daemon

**Si keychain activé**: Le daemon ne peut PAS lire les tokens depuis le keychain système!

**Solutions possibles**:
1. **Forcer stockage fichier** quand daemon utilisé (via env var)
2. **Passer token via API** `/api/configure` (moins sécurisé)
3. **Exporter token vers fichier** avant appel daemon

---

## Questions Ouvertes

- [ ] Comment accéder à `Config` ou au type d'auth depuis `brain-manager-provider.ts`?
  - **Réponse partielle**: On peut utiliser `getAuthTypeFromEnv()` ou passer le type d'auth via les paramètres
- [ ] Le fichier OAuth est-il toujours à `~/.luciecode/oauth_creds.json` ou peut-il être dans le keychain?
  - **Réponse**: Dépend de `GEMINI_FORCE_ENCRYPTED_FILE_STORAGE`. Par défaut, essaie keychain, fallback sur fichier.
- [x] **PROBLÈME**: Daemon ne peut pas lire le keychain!
  - **Solution retenue**: Sync au démarrage avec export fichier si nécessaire

---

## Plan d'Implémentation Final

### Architecture de Synchronisation Auth

```
┌─────────────────┐                    ┌─────────────────┐
│   LucieCode     │                    │  RagForge       │
│                 │                    │  Daemon :6969   │
│  ┌───────────┐  │   GET /api/       │  ┌───────────┐  │
│  │ AuthType  │──┼──auth-status──────┼─▶│ AuthConfig│  │
│  └───────────┘  │                    │  └───────────┘  │
│        │        │                    │        ▲        │
│        ▼        │   POST /api/       │        │        │
│  ┌───────────┐  │   configure        │        │        │
│  │ Sync Auth │──┼───────────────────┼────────┘        │
│  └───────────┘  │                    │                 │
│        │        │                    │                 │
│        ▼        │                    │                 │
│  Export token   │                    │  Lit fichier    │
│  → fichier      │                    │  si oauth-file  │
└─────────────────┘                    └─────────────────┘
```

### Flow au Démarrage de LucieCode

```typescript
async function syncDaemonAuth(config: Config): Promise<void> {
  // 1. Vérifier si daemon tourne
  const daemonRunning = await isDaemonRunning();
  if (!daemonRunning) return;

  // 2. Récupérer auth status du daemon
  const daemonAuth = await fetch('http://127.0.0.1:6969/api/auth-status').then(r => r.json());

  // 3. Déterminer le type d'auth LucieCode actuel
  const lucieAuthType = config.contentGeneratorConfig?.authType;

  // 4. Comparer et synchroniser si nécessaire
  const authConfig = await buildAuthConfig(lucieAuthType, daemonAuth);

  if (authConfig && needsSync(daemonAuth, authConfig)) {
    await fetch('http://127.0.0.1:6969/api/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authConfig),
    });
  }
}
```

### Mapping AuthType → AuthConfig avec Export

| LucieCode AuthType | Action | AuthConfig pour Daemon |
|-------------------|--------|------------------------|
| `oauth-personal` | Export token → `~/.luciecode/daemon-oauth.json` | `{ type: 'oauth-file', path: '~/.luciecode/daemon-oauth.json' }` |
| `gemini-api-key` | Rien (env var) | `{ type: 'env' }` |
| `vertex-ai` | Rien (ADC) | `{ type: 'vertex-adc' }` |
| `compute-default-credentials` | Rien (ADC) | `{ type: 'vertex-adc' }` |

### Export Token OAuth

```typescript
async function exportOAuthTokenForDaemon(): Promise<string> {
  const tokenPath = path.join(os.homedir(), '.luciecode', 'daemon-oauth.json');

  // Récupérer token depuis keychain ou storage
  const credentials = await OAuthCredentialStorage.loadCredentials();

  if (credentials) {
    // Écrire dans fichier dédié au daemon
    await fs.writeFile(tokenPath, JSON.stringify({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expiry_date: credentials.expiry_date,
      token_type: credentials.token_type,
    }), { mode: 0o600 });
  }

  return tokenPath;
}
```

### Refresh Token Flow

Quand LucieCode refresh le token OAuth:
1. `client.on('tokens')` est appelé
2. Token sauvé dans keychain/storage
3. **NOUVEAU**: Aussi exporter vers `daemon-oauth.json`
4. Le daemon re-lit le fichier au prochain appel API

### Fichiers Modifiés ✓

| Fichier | Modification | Status |
|---------|--------------|--------|
| `LucieCode/packages/core/src/tools/ragforge/brain-manager-provider.ts` | `syncDaemonAuth()` dans `ensureDaemon()` | ✓ |
| `LucieCode/packages/core/src/code_assist/oauth2.ts` | Export vers `daemon-oauth.json` dans `client.on('tokens')` | ✓ |
| `RagForge/packages/cli/src/commands/auth-config.ts` | Types AuthConfig + AuthManager | ✓ |
| `RagForge/packages/cli/src/commands/daemon.ts` | Endpoints `/api/configure`, `/api/auth-status` + sync vers Brain | ✓ |

---

## Synchronisation Brain ↔ AuthManager

Le daemon synchronise l'auth vers le Brain dans deux cas:

1. **Au démarrage du Brain** (`initializeBrain()`):
   - Si authManager est déjà configuré, le token/key est copié dans `brain.getConfig().apiKeys.gemini`

2. **Lors de `/api/configure`**:
   - Après configuration de authManager, le token/key est synchronisé vers le Brain si initialisé

Cela garantit que les providers Gemini (embeddings, reranking, LLM) utilisent bien le bon auth.
