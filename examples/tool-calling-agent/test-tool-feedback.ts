/**
 * Test Tool Feedback System
 *
 * Tests the agent's ability to provide structured feedback about:
 * - Tools used
 * - Limitations encountered
 * - Suggestions for improvements
 * - Answer quality assessment
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
// Test Feedback System
// ============================================

async function testFeedbackSystem() {
  console.log('\n🧪 TOOL FEEDBACK SYSTEM TEST');
  console.log('Testing agent\'s ability to provide structured feedback\n');

  // 1. Setup
  console.log('📋 Setting up with DEBUG MODE enabled...');
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
      inputSchema: tool.inputSchema,
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
Your job is to answer questions about a codebase by using the available tools.`;

  // Agent config WITH DEBUG MODE
  const agentConfig: ToolAgentConfig = {
    id: 'feedback-test-agent',
    name: 'Feedback Test Agent',
    systemPrompt,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
    maxTokens: 8000,
    tools: toolRegistry.list().map(t => t.name),

    // Enable debug mode with full feedback
    debug: {
      enabled: true,
      tool_feedback: {
        enabled: true,
        include_reasoning: true,
        include_limitations: true,
        include_suggestions: true,
        include_alternatives: true,
      },
      verbose_logging: true,
    }
  };

  const sessionManager = new MockSessionManager();
  const sessionId = uuidv4();

  const runtime = new AgentRuntime(
    agentConfig,
    llmProvider,
    toolRegistry,
    sessionManager
  );

  console.log(`✅ Loaded ${tools.length} database tools`);
  console.log('✅ Debug mode enabled with full feedback');
  console.log(`📋 Available tools: ${toolRegistry.list().map(t => t.name).join(', ')}\n`);

  // 2. Test query that should trigger feedback
  const testQuery = "What are the most complex classes in the codebase? (Based on lines of code)";

  console.log('═'.repeat(80));
  console.log('TEST QUERY (expected to have limitations)');
  console.log('═'.repeat(80));
  console.log(`Query: "${testQuery}"`);
  console.log('\nExpected behavior:');
  console.log('- Agent provides best answer with available tools');
  console.log('- Agent identifies limitation: cannot sort/filter by line_count');
  console.log('- Agent suggests: number_range_search tool');
  console.log('═'.repeat(80) + '\n');

  const userMessage: Message = {
    messageId: uuidv4(),
    sessionId,
    content: testQuery,
    role: 'user',
    sentBy: 'test-user',
    timestamp: new Date(),
  };

  const startTime = Date.now();
  const response = await runtime.processMessage(sessionId, userMessage);
  const duration = Date.now() - startTime;

  // 3. Display results
  console.log('\n' + '─'.repeat(80));
  console.log('AGENT RESPONSE');
  console.log('─'.repeat(80));
  console.log(response.content);
  console.log('─'.repeat(80));

  // 4. Display feedback (if present)
  const feedback = response.tool_feedback;

  if (feedback) {
    console.log('\n' + '═'.repeat(80));
    console.log('🐛 TOOL FEEDBACK (DEBUG MODE)');
    console.log('═'.repeat(80));

    console.log('\n📊 Tools Used:');
    if (feedback.tools_used && feedback.tools_used.length > 0) {
      feedback.tools_used.forEach((tool: any, i: number) => {
        console.log(`  ${i + 1}. ${tool.name}`);
        console.log(`     Purpose: ${tool.purpose}`);
        console.log(`     Success: ${tool.success ? '✅' : '❌'}`);
        if (tool.result_quality) {
          console.log(`     Quality: ${tool.result_quality}`);
        }
      });
    } else {
      console.log('  (none)');
    }

    if (feedback.limitations && feedback.limitations.length > 0) {
      console.log('\n⚠️  Limitations:');
      feedback.limitations.forEach((limit: any, i: number) => {
        console.log(`  ${i + 1}. [${limit.impact?.toUpperCase()}] ${limit.description}`);
        if (limit.missing_capability) {
          console.log(`     Missing: ${limit.missing_capability}`);
        }
      });
    }

    if (feedback.suggestions && feedback.suggestions.length > 0) {
      console.log('\n💡 Suggestions:');
      feedback.suggestions.forEach((suggestion: any, i: number) => {
        console.log(`  ${i + 1}. [${suggestion.priority?.toUpperCase()}] ${suggestion.description}`);
        if (suggestion.tool_spec) {
          console.log(`     Tool: ${suggestion.tool_spec.name}`);
          console.log(`     Purpose: ${suggestion.tool_spec.purpose}`);
          if (suggestion.tool_spec.parameters) {
            console.log(`     Parameters: ${suggestion.tool_spec.parameters.join(', ')}`);
          }
        }
        if (suggestion.config_change) {
          console.log(`     Config change needed for: ${suggestion.config_change.entity}`);
          console.log(`     Change: ${suggestion.config_change.change}`);
        }
      });
    }

    if (feedback.alternatives && feedback.alternatives.length > 0) {
      console.log('\n🔀 Alternative Approaches:');
      feedback.alternatives.forEach((alt: any, i: number) => {
        console.log(`  ${i + 1}. ${alt.approach}`);
        if (alt.pros) console.log(`     Pros: ${alt.pros.join(', ')}`);
        if (alt.cons) console.log(`     Cons: ${alt.cons.join(', ')}`);
      });
    }

    if (feedback.answer_quality) {
      console.log('\n📈 Answer Quality Assessment:');
      console.log(`  Completeness: ${feedback.answer_quality.completeness}%`);
      console.log(`  Confidence: ${feedback.answer_quality.confidence}%`);
      if (feedback.answer_quality.notes) {
        console.log(`  Notes: ${feedback.answer_quality.notes}`);
      }
    }

    console.log('\n' + '═'.repeat(80));
  } else {
    console.log('\n⚠️  WARNING: No tool_feedback received (debug mode may not be working)');
  }

  console.log(`\n⏱️  Duration: ${duration}ms`);
  console.log(`🔧 Tool calls: ${response.toolCalls?.length || 0}\n`);

  // 5. Validation
  console.log('═'.repeat(80));
  console.log('VALIDATION');
  console.log('═'.repeat(80));

  const validations = [
    {
      name: 'Feedback structure exists',
      check: () => feedback !== undefined && feedback !== null,
      critical: true
    },
    {
      name: 'Tools used reported',
      check: () => feedback?.tools_used !== undefined,
      critical: true
    },
    {
      name: 'Limitations identified',
      check: () => feedback?.limitations && feedback.limitations.length > 0,
      critical: false
    },
    {
      name: 'Suggestions provided',
      check: () => feedback?.suggestions && feedback.suggestions.length > 0,
      critical: false
    },
    {
      name: 'number_range_search suggested',
      check: () => feedback?.suggestions?.some((s: any) =>
        s.description?.toLowerCase().includes('number') ||
        s.tool_spec?.name?.includes('number')
      ),
      critical: false
    },
    {
      name: 'Answer quality assessed',
      check: () => feedback?.answer_quality !== undefined &&
                   typeof feedback.answer_quality.completeness === 'number' &&
                   typeof feedback.answer_quality.confidence === 'number',
      critical: true
    },
  ];

  let passed = 0;
  let failed = 0;
  let criticalFailed = false;

  validations.forEach(v => {
    const result = v.check();
    if (result) {
      console.log(`✅ ${v.name}`);
      passed++;
    } else {
      console.log(`${v.critical ? '❌' : '⚠️ '} ${v.name}`);
      failed++;
      if (v.critical) criticalFailed = true;
    }
  });

  console.log('═'.repeat(80));
  console.log(`Results: ${passed}/${validations.length} passed`);

  if (criticalFailed) {
    console.log('\n❌ CRITICAL FAILURES - Feedback system not working correctly\n');
  } else if (failed > 0) {
    console.log('\n⚠️  Some optional checks failed - Feedback could be improved\n');
  } else {
    console.log('\n✅ ALL CHECKS PASSED - Feedback system working!\n');
  }

  // Cleanup
  await rag.close();

  process.exit(criticalFailed ? 1 : 0);
}

// Run test
testFeedbackSystem().catch((error) => {
  console.error('\n❌ Test failed with error:');
  console.error(error);
  process.exit(1);
});
