import { Neo4jClient } from '@luciformresearch/ragforge-runtime/client/neo4j-client';
import { GeminiAPIProvider } from '@luciformresearch/ragforge-runtime/reranking/gemini-api-provider';
import { StructuredLLMExecutor } from '@luciformresearch/ragforge-runtime/llm/structured-llm-executor';
import { DocumentIngestionPipeline, GraphExtractionSchema } from '@luciformresearch/ragforge-core/ingestion/document-ingestion-pipeline';
import path from 'node:path';
import 'dotenv/config'; // Loads .env file at the start

async function main() {
  // --- 1. Configure Neo4j Client ---
  const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
  const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password'; // Use a strong default or ensure env var is set
  const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'neo4j';

  const neo4jClient = new Neo4jClient({
    uri: NEO4J_URI,
    username: NEO4J_USERNAME,
    password: NEO4J_PASSWORD,
    database: NEO4J_DATABASE,
  });

  try {
    await neo4jClient.verifyConnectivity();
    console.log('✅ Connected to Neo4j');

    // --- 2. Configure LLM Providers ---
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in environment variables. Please set it in your .env file.');
    }

    const llmProvider = new GeminiAPIProvider({
      apiKey: GEMINI_API_KEY,
      model: 'gemini-1.5-flash', // Or configurable via env var
    });
    
    // StructuredLLMExecutor uses an ILLMProvider internally
    const structuredLlmExecutor = new StructuredLLMExecutor(llmProvider);
    console.log('✅ LLM Providers initialized');


    // --- 3. Define Graph Extraction Schema ---
    // This schema defines what entities and relationships the LLM should look for.
    // This would typically come from a configuration file (e.g., ragforge.config.yaml).
    const graphSchema: GraphExtractionSchema = {
      entities: [
        { label: 'Company', properties: [{ name: 'name', type: 'STRING' }] },
        { label: 'RiskFactor', properties: [{ name: 'name', type: 'STRING' }] },
        { label: 'Product', properties: [{ name: 'name', type: 'STRING' }] },
        { label: 'Person', properties: [{ name: 'name', type: 'STRING' }] },
      ],
      relations: [
        { label: 'FACES_RISK', source: 'Company', target: 'RiskFactor' },
        { label: 'MENTIONS', source: 'Company', target: 'Product' },
        { label: 'PARTNERS_WITH', source: 'Company', target: 'Company' },
        { label: 'HAS_CONTACT', source: 'Company', target: 'Person' },
      ],
    };
    console.log('✅ Graph Extraction Schema defined');


    // --- 4. Instantiate and Run Document Ingestion Pipeline ---
    const pipeline = new DocumentIngestionPipeline(
      neo4jClient,
      structuredLlmExecutor,
      graphSchema
    );
    console.log('✅ Document Ingestion Pipeline initialized');

    // --- 5. Specify document(s) to ingest ---
    // Placeholder path to a document. Ensure this document exists for testing.
    // For example, create a dummy.pdf or dummy.md in the root of the project.
    const documentPath = path.resolve(process.cwd(), 'docs/neo4j_docs/Developper-Guide-GraphRag.md');
    // const documentPath = path.resolve(process.cwd(), 'dummy.pdf'); // Example for a PDF

    console.log(`🚀 Starting ingestion for document: ${documentPath}`);
    await pipeline.run(documentPath);
    console.log('🎉 Document ingestion completed successfully!');

  } catch (error) {
    console.error('❌ An error occurred during ingestion:', error);
    process.exit(1);
  } finally {
    await neo4jClient.close();
    console.log('🔌 Neo4j connection closed.');
  }
}

main();
