import path from 'path';
import process from 'process';
import { ConfigLoader, SchemaIntrospector } from '@luciformresearch/ragforge-core';
import {
  Neo4jClient,
  runEmbeddingPipelines,
  GeminiEmbeddingProvider, // Legacy - kept for backward compat
  EmbeddingProvider
} from '@luciformresearch/ragforge-runtime';
import { ensureEnvLoaded, getEnv } from '../utils/env.js';
import { ensureGeminiKey, validateGeminiSchema } from '../utils/gemini.js';
import { toRuntimeEmbeddingsConfig } from '../utils/embedding-transform.js';

interface EmbeddingOptions {
  configPath: string;
  uri: string;
  username: string;
  password: string;
  database?: string;
  rootDir: string;
  geminiKey: string;
}

export async function parseEmbeddingsOptions(args: string[]): Promise<EmbeddingOptions> {
  const rootDir = ensureEnvLoaded(import.meta.url);

  let configPath: string | undefined;
  let uri: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let database: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--config':
        configPath = args[++i];
        break;
      case '--uri':
        uri = args[++i];
        break;
      case '--username':
        username = args[++i];
        break;
      case '--password':
        password = args[++i];
        break;
      case '--database':
        database = args[++i];
        break;
      case '-h':
      case '--help':
        printEmbeddingsHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option for embeddings command: ${arg}`);
    }
  }

  const envUri = getEnv(['NEO4J_URI', 'NEO4J_BOLT_URI']);
  const envUser = getEnv(['NEO4J_USERNAME', 'NEO4J_USER']);
  const envPass = getEnv(['NEO4J_PASSWORD', 'NEO4J_PASS']);
  const envDatabase = getEnv(['NEO4J_DATABASE']);
  const geminiKey = ensureGeminiKey(getEnv(['GEMINI_API_KEY'], true)); // Only from local .env

  const finalUri = uri || envUri;
  const finalUsername = username || envUser;
  const finalPassword = password || envPass;

  if (!finalUri) {
    throw new Error('Missing Neo4j URI. Provide --uri or set NEO4J_URI.');
  }
  if (!finalUsername) {
    throw new Error('Missing Neo4j username. Provide --username or set NEO4J_USERNAME.');
  }
  if (!finalPassword) {
    throw new Error('Missing Neo4j password. Provide --password or set NEO4J_PASSWORD.');
  }

  return {
    configPath: path.resolve(configPath || 'ragforge.config.yaml'),
    uri: finalUri,
    username: finalUsername,
    password: finalPassword,
    database: database || envDatabase,
    rootDir,
    geminiKey
  };
}

export function printEmbeddingsHelp(): void {
  console.log(`Usage:
  ragforge embeddings:index [options]
  ragforge embeddings:generate [options]

Options:
  --config <file>    Path to ragforge.config.yaml (default: ./ragforge.config.yaml)
  --uri <bolt-uri>   Neo4j Bolt URI
  --username <user>  Neo4j username
  --password <pass>  Neo4j password
  --database <name>  Neo4j database (optional)
`);
}

/**
 * Create embedding provider from config (multi-provider support)
 */
function createEmbeddingProvider(config: any, embeddingsConfig: any): EmbeddingProvider {
  // Check if user configured a specific embedding provider in config
  if (config.embedding) {
    const providerConfig = config.embedding;
    const provider = providerConfig.provider || 'gemini';

    console.log(`📦 Using embedding provider: ${provider} (from config)`);

    // Get API key from config or environment
    let apiKey = providerConfig.api_key;
    if (!apiKey) {
      // Try environment variables based on provider
      switch (provider.toLowerCase()) {
        case 'gemini':
        case 'google':
          apiKey = getEnv(['GEMINI_API_KEY', 'GOOGLE_API_KEY'], false);
          break;
        case 'openai':
          apiKey = getEnv(['OPENAI_API_KEY'], false);
          break;
        case 'anthropic':
          apiKey = getEnv(['ANTHROPIC_API_KEY'], false);
          break;
        case 'cohere':
          apiKey = getEnv(['COHERE_API_KEY'], false);
          break;
        // Ollama doesn't need an API key
        case 'ollama':
          break;
        default:
          console.warn(`⚠️  Unknown provider "${provider}", trying to proceed without API key`);
      }
    }

    return new EmbeddingProvider({
      provider,
      model: providerConfig.model || embeddingsConfig.defaults?.model,
      apiKey,
      dimensions: providerConfig.dimensions || embeddingsConfig.defaults?.dimension,
      batchSize: providerConfig.batchSize,
      options: providerConfig.options,
    });
  }

  // Legacy: Fall back to embeddings.provider (old config format)
  if (embeddingsConfig.provider && embeddingsConfig.provider !== 'gemini') {
    console.log(`📦 Using embedding provider: ${embeddingsConfig.provider} (from embeddings.provider)`);

    return new EmbeddingProvider({
      provider: embeddingsConfig.provider,
      model: embeddingsConfig.defaults?.model,
      apiKey: getEnv(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY'], false),
      dimensions: embeddingsConfig.defaults?.dimension,
    });
  }

  // Default: Gemini (backward compatible)
  console.log(`📦 Using embedding provider: gemini (default)`);
  const geminiKey = ensureGeminiKey(getEnv(['GEMINI_API_KEY'], true));

  return new EmbeddingProvider({
    provider: 'gemini',
    model: embeddingsConfig.defaults?.model,
    apiKey: geminiKey,
    dimensions: embeddingsConfig.defaults?.dimension,
  });
}

export async function runEmbeddingsIndex(options: EmbeddingOptions): Promise<void> {
  const config = await ConfigLoader.load(options.configPath);
  const embeddingsConfig = toRuntimeEmbeddingsConfig(config.embeddings);
  if (!embeddingsConfig) {
    throw new Error('Embeddings section is missing in configuration.');
  }

  const client = new Neo4jClient({
    uri: options.uri,
    username: options.username,
    password: options.password,
    database: options.database
  });

  try {
    for (const entity of embeddingsConfig.entities) {
      for (const pipeline of entity.pipelines) {
        const dimension = pipeline.dimension ?? embeddingsConfig.defaults?.dimension ?? 768;
        const similarity = pipeline.similarity ?? embeddingsConfig.defaults?.similarity ?? 'cosine';

        console.log(`Creating vector index ${pipeline.name} for ${entity.entity}.${pipeline.targetProperty}`);
        await client.run(`DROP INDEX ${pipeline.name} IF EXISTS`);
        await client.run(
          `CREATE VECTOR INDEX ${pipeline.name} IF NOT EXISTS
           FOR (n:\`${entity.entity}\`)
           ON n.\`${pipeline.targetProperty}\`
           OPTIONS {
             indexConfig: {
               \`vector.dimensions\`: $dimension,
               \`vector.similarity_function\`: $similarity
             }
           }`,
          { dimension, similarity }
        );
      }
    }

    console.log('✅ Vector indexes created successfully');
  } finally {
    await client.close();
  }
}

export async function runEmbeddingsGenerate(options: EmbeddingOptions): Promise<void> {
  const config = await ConfigLoader.load(options.configPath);
  const embeddingsConfig = toRuntimeEmbeddingsConfig(config.embeddings);
  if (!embeddingsConfig) {
    throw new Error('Embeddings section is missing in configuration.');
  }

  // Optional: validate schema compatibility
  const introspector = new SchemaIntrospector(options.uri, options.username, options.password);
  try {
    const schema = await introspector.introspect(options.database);
    validateGeminiSchema(schema);
  } finally {
    await introspector.close();
  }

  const client = new Neo4jClient({
    uri: options.uri,
    username: options.username,
    password: options.password,
    database: options.database
  });

  // Create embedding provider based on config (multi-provider support!)
  const provider = createEmbeddingProvider(config, embeddingsConfig);

  try {
    for (const entity of embeddingsConfig.entities) {
      console.log(`🔄 Generating embeddings for ${entity.entity}`);
      await runEmbeddingPipelines({
        neo4j: client,
        entity,
        provider,
        defaults: embeddingsConfig.defaults
      });
    }

    console.log('✅ Embeddings generated successfully');
  } finally {
    await client.close();
  }
}
