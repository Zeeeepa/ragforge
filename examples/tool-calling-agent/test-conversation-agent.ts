/**
 * Test Conversational Agent with Memory
 *
 * This test demonstrates:
 * - Creating a conversational agent with Neo4j storage
 * - Hierarchical summarization (L1, L2, L3)
 * - Dual context (recent + RAG)
 * - Tool calling with history
 * - Optional file export for debugging
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env with override to ensure local config takes precedence
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

import { ConversationAgent, GeminiAPIProvider } from '@luciformresearch/ragforge-runtime';
import { Neo4jClient } from '@luciformresearch/ragforge-runtime';

async function main() {
  console.log('🤖 Testing Conversational Agent with Memory\n');

  // 1. Initialize Neo4j client
  if (!process.env.NEO4J_URI) {
    throw new Error('NEO4J_URI not set in environment variables');
  }

  const neo4j = new Neo4jClient({
    uri: process.env.NEO4J_URI,
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password'
  });

  await neo4j.verifyConnectivity();
  console.log('✅ Connected to Neo4j\n');

  // 2. Initialize LLM provider
  const llmProvider = new GeminiAPIProvider({
    apiKey: process.env.GEMINI_API_KEY!,
    model: 'gemini-2.0-flash',
    rateLimitStrategy: {
      requestsPerMinute: 10,
      tokensPerMinute: 1_000_000
    }
  });

  console.log('✅ Initialized LLM provider\n');

  // 3. Create conversational agent
  const agent = new ConversationAgent({
    neo4j,
    llmProvider,
    config: {
      // Recent context (non-summarized)
      recentContextMaxChars: 3000,
      recentContextMaxTurns: 5,

      // RAG on summaries
      ragMaxSummaries: 3,
      ragMinScore: 0.7,
      ragLevelBoost: { 1: 1.0, 2: 1.1, 3: 1.2 },
      ragRecencyBoost: true,
      ragRecencyDecayDays: 7,

      // Hierarchical summarization
      enableSummarization: true,
      summarizeEveryNChars: 500,  // Small threshold for testing
      summaryLevels: 3,

      // Embeddings (disabled for now to simplify testing)
      embedMessages: false,

      // Export for debugging (REAL-TIME!)
      exportToFiles: true,
      exportPath: './conversation-exports',
      exportFormat: 'markdown',
      exportOnEveryMessage: true  // Export after each message for real-time debugging
    }
  });

  console.log('✅ Created ConversationAgent\n');

  // 4. Initialize schema
  console.log('🔧 Initializing Neo4j schema...');
  await agent.initialize();
  console.log();

  // 5. Create a new conversation
  console.log('💬 Creating new conversation...');
  const conversation = await agent.createConversation({
    title: 'Test Conversation - Hierarchical Summaries',
    tags: ['test', 'demo']
  });
  console.log();

  // 6. Send messages to trigger summarization
  console.log('📝 Sending messages...\n');

  const messages = [
    "Hello! Can you help me understand hierarchical summarization?",
    "What is the difference between L1, L2, and L3 summaries?",
    "How does the character-based triggering work?",
    "Can you explain the dual context system?",
    "What is the RAG scoring formula?",
    "How do tool calls get stored in the conversation history?"
  ];

  for (let i = 0; i < messages.length; i++) {
    console.log(`\n--- Turn ${i + 1} ---`);
    console.log(`User: ${messages[i]}`);

    const response = await conversation.sendMessage(messages[i]);

    console.log(`\nAssistant: ${response.content.substring(0, 200)}...`);
    console.log(`\nReasoning: ${response.reasoning?.substring(0, 150)}...`);
    console.log(`\nContext used:`);
    console.log(`  - Recent messages: ${response.context_used.recent.messages.length}`);
    console.log(`  - Recent chars: ${response.context_used.recent.total_chars}`);
    console.log(`  - RAG summaries: ${response.context_used.rag.summaries.length}`);
    console.log(`  - Total messages: ${response.context_used.message_count}`);
    console.log(`  - Total chars: ${response.context_used.total_chars}`);
  }

  // 7. Check summaries
  console.log('\n\n📊 Checking summaries created...\n');
  const { summaries } = await conversation.getSummaries();

  console.log(`Total summaries: ${summaries.length}\n`);

  for (const summary of summaries) {
    console.log(`L${summary.level} Summary (chars ${summary.char_range_start}-${summary.char_range_end}):`);
    console.log(`  Conversation: ${summary.content.conversation_summary.substring(0, 100)}...`);
    console.log(`  Actions: ${summary.content.actions_summary.substring(0, 100)}...`);
    console.log();
  }

  // 8. List conversations
  console.log('📋 Listing all conversations...\n');
  const allConversations = await agent.listConversations({
    limit: 10,
    status: 'active',
    orderBy: 'updated'
  });

  for (const conv of allConversations) {
    console.log(`  - ${conv.title} (${conv.message_count} messages, ${conv.total_chars} chars)`);
  }

  // 9. Check export location
  console.log('\n\n📄 Real-time export location:');
  console.log(`   ./conversation-exports/${conversation.getUuid()}.md`);
  console.log('   (File updated after each message for debugging)\n');

  // 10. Cleanup
  console.log('\n\n🧹 Cleaning up...');
  await neo4j.close();
  console.log('✅ Done!\n');
}

main().catch(console.error);
