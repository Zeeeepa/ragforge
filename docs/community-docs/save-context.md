# Plan : SSE pour ingestion GitHub

## Problème actuel

L'endpoint `/ingest/github` est synchrone et peut prendre 20+ minutes pour un gros repo :
- Timeout HTTP côté client
- Pas de feedback de progression
- Si curl est tué, l'ingestion peut rester bloquée

## Solution : Server-Sent Events (SSE)

### Endpoint modifié

```
POST /ingest/github
Content-Type: application/json
Accept: text/event-stream

→ Retourne un flux SSE avec progression en temps réel
```

### Format des événements SSE

```
event: progress
data: {"phase": "cloning", "message": "Cloning repository..."}

event: progress
data: {"phase": "parsing", "current": 150, "total": 500, "message": "Parsing files..."}

event: progress
data: {"phase": "nodes", "current": 5000, "total": 16000, "message": "Creating nodes..."}

event: progress
data: {"phase": "relationships", "current": 30000, "total": 55000, "message": "Creating relationships..."}

event: progress
data: {"phase": "embeddings", "current": 1000, "total": 9000, "message": "Generating embeddings..."}

event: complete
data: {"success": true, "nodes": 16497, "relationships": 55858, "embeddings": 9000, "duration": 1234567}

event: error
data: {"success": false, "error": "Failed to clone repository", "phase": "cloning"}
```

### Heartbeat (keep-alive)

Envoyer un commentaire SSE toutes les 30 secondes pour éviter les timeouts :
```
: heartbeat
```

## Implémentation

### 1. Modifier `/ingest/github` dans server.ts

```typescript
app.post("/ingest/github", async (request, reply) => {
  const { githubUrl, metadata, branch, maxFiles, generateEmbeddings } = request.body;

  // Setup SSE
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const sendEvent = (event: string, data: any) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sendProgress = (phase: string, current?: number, total?: number, message?: string) => {
    sendEvent("progress", { phase, current, total, message, timestamp: getLocalTimestamp() });
  };

  // Heartbeat interval
  const heartbeat = setInterval(() => {
    reply.raw.write(": heartbeat\n\n");
  }, 30000);

  try {
    // Phase 1: Clone
    sendProgress("cloning", 0, 1, `Cloning ${githubUrl}...`);
    const { tempDir, repoDir } = await cloneGitHubRepo(githubUrl, branch);
    sendProgress("cloning", 1, 1, "Clone complete");

    // Phase 2: Read files
    sendProgress("reading", 0, 0, "Scanning files...");
    const codeFiles = await getCodeFilesFromDir(repoDir, repoDir, CODE_EXTENSIONS);
    const filesToIngest = codeFiles.slice(0, maxFiles);
    // ... read files with progress ...

    // Phase 3: Ingest with progress callback
    sendProgress("ingesting", 0, 0, "Starting ingestion...");
    const result = await this.orchestrator.ingestVirtualWithProgress({
      virtualFiles,
      sourceIdentifier,
      metadata,
      onProgress: (phase, current, total) => sendProgress(phase, current, total),
    });

    // Phase 4: Embeddings with progress callback
    if (generateEmbeddings) {
      sendProgress("embeddings", 0, 0, "Starting embedding generation...");
      const embeddingsCount = await this.orchestrator.generateEmbeddingsWithProgress(
        metadata.documentId,
        (current, total) => sendProgress("embeddings", current, total)
      );
    }

    // Done
    sendEvent("complete", { success: true, ... });

  } catch (err) {
    sendEvent("error", { success: false, error: err.message });
  } finally {
    clearInterval(heartbeat);
    reply.raw.end();
    // Cleanup temp dir
  }
});
```

### 2. Ajouter callbacks de progression dans orchestrator-adapter.ts

Modifier `ingestVirtual` pour accepter un callback `onProgress`:

```typescript
interface ProgressCallback {
  (phase: string, current: number, total: number, message?: string): void;
}

interface CommunityVirtualIngestionOptions {
  // ... existing options ...
  onProgress?: ProgressCallback;
}

async ingestVirtual(options: CommunityVirtualIngestionOptions) {
  const { onProgress } = options;

  // Report progress during parsing
  onProgress?.("parsing", fileIndex, totalFiles);

  // Report progress during node creation
  onProgress?.("nodes", nodesCreated, totalNodes);

  // Report progress during relationship creation
  onProgress?.("relationships", relsCreated, totalRels);
}
```

### 3. Ajouter callbacks dans generateEmbeddingsForDocument

```typescript
async generateEmbeddingsForDocument(
  documentId: string,
  onProgress?: (current: number, total: number) => void
): Promise<number> {
  // Pass progress callback to EmbeddingService
  const result = await this.embeddingService.generateMultiEmbeddings({
    projectId: `doc-${documentId}`,
    onProgress, // EmbeddingService doit aussi supporter ce callback
  });
}
```

## Test avec curl

```bash
curl -N -X POST http://localhost:6970/ingest/github \
  -H "Content-Type: application/json" \
  -d '{
    "githubUrl": "https://github.com/google-gemini/gemini-cli",
    "metadata": { "documentId": "test", "documentTitle": "Test" },
    "branch": "main",
    "maxFiles": 100,
    "generateEmbeddings": true
  }'
```

Le flag `-N` désactive le buffering pour voir les événements en temps réel.

## Ordre d'implémentation

1. **server.ts** : Modifier endpoint pour SSE basique (sans callbacks encore)
2. **orchestrator-adapter.ts** : Ajouter `onProgress` à `ingestVirtual`
3. **core EmbeddingService** : Ajouter support `onProgress` (si pas déjà fait)
4. **Test complet** avec gemini-cli

## Notes

- Les timestamps dans les logs utilisent maintenant `getLocalTimestamp()` (heure locale)
- Le console.log est intercepté pour ajouter des timestamps automatiquement
- Penser à gérer la déconnexion client (request.raw.on('close'))
