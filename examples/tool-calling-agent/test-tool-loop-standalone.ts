/**
 * Standalone Tool Loop Test
 *
 * Tests the iterative tool-calling loop WITHOUT conversational context.
 * Pure query → tools → results → loop cycle.
 *
 * This validates Phase 1 of the agentic architecture:
 * - Tool loop works independently
 * - Multi-step reasoning
 * - Context accumulation across iterations
 * - Error handling
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

import {
  AgentRuntime,
  GeminiAPIProvider,
  ToolRegistry,
  ChatSessionManager,
  type ToolAgentConfig,
  type Message,
} from '@luciformresearch/ragforge-runtime';
import { createRagClient } from './client.js';
import { generateDatabaseTools } from './database-tools-generator.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================
// Mock Session Manager (in-memory, no Neo4j)
// ============================================

class MockSessionManager implements ChatSessionManager {
  private messages: Map<string, Message[]> = new Map();

  async createSession(): Promise<any> {
    const sessionId = uuidv4();
    this.messages.set(sessionId, []);
    return { sessionId, title: 'Mock Session', createdAt: new Date(), lastActiveAt: new Date() };
  }

  async getSession(): Promise<any> {
    return null;
  }

  async addMessage(message: Message): Promise<void> {
    const sessionMessages = this.messages.get(message.sessionId) || [];
    sessionMessages.push(message);
    this.messages.set(message.sessionId, sessionMessages);
  }

  async getMessages(sessionId: string, limit: number = 50): Promise<Message[]> {
    const sessionMessages = this.messages.get(sessionId) || [];
    return sessionMessages.slice(-limit);
  }

  async listSessions(): Promise<any[]> {
    return [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.messages.delete(sessionId);
  }
}

// ============================================
// Standalone Tool Loop Runner
// ============================================

class StandaloneToolLoop {
  private runtime: AgentRuntime;
  private sessionManager: MockSessionManager;
  private sessionId: string;

  constructor(
    llmProvider: GeminiAPIProvider,
    toolRegistry: ToolRegistry,
    systemPrompt: string
  ) {
    this.sessionManager = new MockSessionManager();
    this.sessionId = uuidv4();

    const agentConfig: ToolAgentConfig = {
      id: 'standalone-agent',
      name: 'Standalone Tool Loop Agent',
      systemPrompt,
      model: 'gemini-2.0-flash',
      temperature: 0.1,
      maxTokens: 8000,
      tools: toolRegistry.list().map(t => t.name),
    };

    this.runtime = new AgentRuntime(
      agentConfig,
      llmProvider,
      toolRegistry,
      this.sessionManager
    );
  }

  /**
   * Execute a single query through the tool loop
   */
  async executeQuery(query: string, maxIterations: number = 10): Promise<{
    answer: string;
    iterations: number;
    toolCallCount: number;
    trace: string[];
  }> {
    console.log('\n' + '═'.repeat(80));
    console.log(`QUERY: ${query}`);
    console.log('═'.repeat(80));

    // Set max iterations
    this.runtime.setMaxIterations(maxIterations);

    // Create user message
    const userMessage: Message = {
      messageId: uuidv4(),
      sessionId: this.sessionId,
      content: query,
      role: 'user',
      sentBy: 'test-user',
      timestamp: new Date(),
    };

    // Execute through agent runtime
    const startTime = Date.now();
    const response = await this.runtime.processMessage(this.sessionId, userMessage);
    const duration = Date.now() - startTime;

    // Count tool calls
    const toolCallCount = response.toolCalls?.length || 0;

    console.log('\n' + '─'.repeat(80));
    console.log('FINAL ANSWER:');
    console.log('─'.repeat(80));
    console.log(response.content);
    console.log('\n' + '─'.repeat(80));
    console.log(`STATS: ${duration}ms | ${toolCallCount} tool calls`);
    console.log('─'.repeat(80) + '\n');

    return {
      answer: response.content,
      iterations: 0, // AgentRuntime doesn't expose this, but logs show it
      toolCallCount,
      trace: [], // Could enhance to collect this
    };
  }
}

// ============================================
// Test Suite
// ============================================

async function runTests() {
  console.log('\n🧪 STANDALONE TOOL LOOP TEST SUITE');
  console.log('Testing Phase 1: Pure tool-calling loop without conversation\n');

  // 1. Setup
  console.log('📋 Setting up...');
  const rag = createRagClient();

  const { tools, handlers } = await generateDatabaseTools('./ragforge.config.yaml', rag);

  const toolRegistry = new ToolRegistry();
  for (const tool of tools) {
    toolRegistry.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema.properties
        ? Object.entries(tool.inputSchema.properties).map(([name, schema]: [string, any]) => ({
            name,
            type: schema.type || 'string',
            description: schema.description || '',
            required: tool.inputSchema.required?.includes(name) || false,
            default: schema.default,
          }))
        : [],
      inputSchema: tool.inputSchema, // Include full schema for native tool calling
      execute: async (args: any) => {
        const handler = (handlers as any)[tool.name];
        if (!handler) throw new Error(`Handler not found for ${tool.name}`);
        return await handler(args);
      },
    });
  }

  const llmProvider = new GeminiAPIProvider({
    apiKey: process.env.GEMINI_API_KEY!,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  const systemPrompt = `You are a code analysis assistant with access to database query tools.
Your job is to answer questions about a codebase by using the available tools.

Guidelines:
- Use semantic_search to find relevant code based on natural language queries
- Use query_entities to filter entities by specific properties
- Use explore_relationships to navigate the code graph
- Use get_entity_by_id to fetch full details of specific entities
- Break complex questions into multiple tool calls
- Synthesize information from multiple queries
- Be concise but thorough in your final answer`;

  const loop = new StandaloneToolLoop(llmProvider, toolRegistry, systemPrompt);

  console.log(`✅ Loaded ${tools.length} database tools`);
  console.log('✅ Agent runtime initialized\n');

  // 2. Test Cases
  const testCases = [
    {
      name: 'Sequential Reasoning',
      query: 'Find functions related to authentication and tell me which files they are defined in',
      description: 'Should use semantic_search → get_entity_by_id or explore_relationships',
    },
    {
      name: 'Multi-step Analysis',
      query: 'What are the most complex classes in the codebase? (Based on lines of code)',
      description: 'Should use query_entities with filters and analyze results',
    },
    {
      name: 'Relationship Navigation',
      query: 'Find the ConversationAgent class and show me what files it uses',
      description: 'Should use query_entities → explore_relationships',
    },
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`TEST ${i + 1}/${testCases.length}: ${testCase.name}`);
    console.log(`Description: ${testCase.description}`);
    console.log('═'.repeat(80));

    try {
      const result = await loop.executeQuery(testCase.query, 10);

      // Basic validation
      if (result.answer.length > 10 && result.toolCallCount > 0) {
        console.log('✅ PASSED: Got answer with tool calls');
        passed++;
      } else {
        console.log('⚠️  WARNING: Answer seems too short or no tools used');
        failed++;
      }
    } catch (error: any) {
      console.error('❌ FAILED:', error.message);
      failed++;
    }
  }

  // 3. Summary
  console.log('\n' + '═'.repeat(80));
  console.log('TEST SUITE SUMMARY');
  console.log('═'.repeat(80));
  console.log(`✅ Passed: ${passed}/${testCases.length}`);
  console.log(`❌ Failed: ${failed}/${testCases.length}`);
  console.log('═'.repeat(80) + '\n');

  // Cleanup
  await rag.close();

  if (failed > 0) {
    process.exit(1);
  }
}

// ============================================
// Run Tests
// ============================================

runTests().catch((error) => {
  console.error('\n❌ Test suite failed with error:');
  console.error(error);
  process.exit(1);
});
