/**
 * Meta-LLM Tool Test
 *
 * Demonstrates the power of batch_analyze - an agent using executeLLMBatch
 * as a tool to analyze results from other tools.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import {
  StructuredLLMExecutor,
  GeminiAPIProvider,
  GeminiNativeToolProvider,
  type ToolExecutor,
  type ToolCallRequest,
  type ToolExecutionResult,
  type ToolDefinition,
  type LLMProvider,
  type NativeToolCallingProvider,
} from '@luciformresearch/ragforge-runtime';
import { createRagClient } from './client.js';

// Load environment
config({ path: resolve(process.cwd(), '.env') });

// Create RAG client
const rag = createRagClient();

/**
 * Extended Tool Executor with meta-LLM capability
 */
class MetaLLMToolExecutor implements ToolExecutor {
  private llmProvider: LLMProvider;
  private executor: StructuredLLMExecutor;

  constructor(llmProvider: LLMProvider) {
    this.llmProvider = llmProvider;
    this.executor = new StructuredLLMExecutor();
  }

  async execute(toolCall: ToolCallRequest): Promise<any> {
    console.log(`\n   🔧 ${toolCall.tool_name}(${JSON.stringify(toolCall.arguments).substring(0, 100)}...)`);

    switch (toolCall.tool_name) {
      case 'search_complex_scopes':
        return await this.searchComplexScopes();

      case 'batch_analyze':
        return await this.batchAnalyze(
          toolCall.arguments.items,
          toolCall.arguments.task,
          toolCall.arguments.outputSchema
        );

      default:
        throw new Error(`Unknown tool: ${toolCall.tool_name}`);
    }
  }

  async executeBatch(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];
    for (const toolCall of toolCalls) {
      try {
        const result = await this.execute(toolCall);
        results.push({ tool_name: toolCall.tool_name, success: true, result });
      } catch (error: any) {
        console.error(`   ❌ ${toolCall.tool_name} failed:`, error.message);
        results.push({ tool_name: toolCall.tool_name, success: false, error: error.message });
      }
    }
    return results;
  }

  /**
   * Find scopes with high complexity
   */
  private async searchComplexScopes(): Promise<any> {
    // Get all class scopes (usually more complex)
    const results = await rag.scope()
      .where({ type: 'class' })
      .limit(10)
      .execute();

    return results.map((r: any) => ({
      name: r.entity.name,
      type: r.entity.type,
      file: r.entity.file,
      line_start: r.entity.line_start,
      line_end: r.entity.line_end,
      lines_of_code: (r.entity.line_end || 0) - (r.entity.line_start || 0),
    }));
  }

  /**
   * Meta-LLM: Batch analyze with structured output
   */
  private async batchAnalyze(
    items: any[],
    task: string,
    outputSchema: Record<string, any> | string
  ): Promise<any> {
    if (!items || items.length === 0) {
      return [];
    }

    console.log(`   🧠 Meta-LLM: Analyzing ${items.length} items`);
    console.log(`   📝 Task: "${task}"`);

    const inputFields = Object.keys(items[0]);

    // Parse outputSchema if it's a string
    const schema = typeof outputSchema === 'string'
      ? JSON.parse(outputSchema)
      : outputSchema;

    const results = await this.executor.executeLLMBatch(items, {
      inputFields,
      userTask: task,
      outputSchema: schema,
      llmProvider: this.llmProvider,
      batchSize: 3,
    });

    return Array.isArray(results) ? results : results.items;
  }
}

const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_complex_scopes',
      description: 'Find scopes (classes, functions) that are potentially complex. Returns top 10 results.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'batch_analyze',
      description: 'META-TOOL: Use LLM to analyze/transform a batch of items with structured output. This is your power tool - it lets you apply structured LLM reasoning to any list of items.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Items to analyze (from previous tool results)',
            items: {
              type: 'object',
              description: 'Item to analyze',
            },
          },
          task: {
            type: 'string',
            description: 'What to analyze. Be specific. Examples: "suggest refactoring to reduce complexity", "identify potential bugs", "rate code quality 1-10"',
          },
          outputSchema: {
            type: 'string',
            description: 'JSON schema as string defining output structure. Example: \'{"suggestion": {"type":"string"}, "priority": {"type":"string", "enum":["low","medium","high"]}}\'',
          },
        },
        required: ['items', 'task', 'outputSchema'],
      },
    },
  },
];

async function testMetaLLM() {
  console.log('\n' + '='.repeat(80));
  console.log('META-LLM TOOL TEST: Agent uses executeLLMBatch as a tool');
  console.log('='.repeat(80));

  const executor = new StructuredLLMExecutor();

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const llmProvider: LLMProvider = new GeminiAPIProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  const nativeToolProvider: NativeToolCallingProvider = new GeminiNativeToolProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  const question = {
    question: 'Find complex classes and suggest refactoring strategies for each',
  };

  try {
    console.log('\n📋 Question:', question.question);
    console.log('\n🤖 Agent will:');
    console.log('   1. Call search_complex_scopes() to find candidates');
    console.log('   2. Call batch_analyze() to generate refactoring suggestions');
    console.log('   3. Return structured recommendations\n');

    const results = await executor.executeLLMBatchWithTools(
      [question],
      {
        inputFields: ['question'],
        systemPrompt: `You are a refactoring expert with access to powerful tools.

IMPORTANT: When you have a list of code items from search results, you MUST use batch_analyze to get structured insights.
batch_analyze is a meta-tool that processes each item with structured LLM analysis.

Example workflow:
1. search_complex_scopes() → get list of classes
2. batch_analyze(items=<classes>, task="suggest refactoring", outputSchema=...) → get structured suggestions
3. Synthesize and return top recommendations`,
        userTask: 'Answer the question by: 1) Search for complex scopes 2) Use batch_analyze to get refactoring suggestions for each 3) Return synthesis',
        outputSchema: {
          summary: {
            type: 'string',
            description: 'Summary of findings',
            required: true,
          },
          top_recommendation: {
            type: 'string',
            description: 'The single most impactful refactoring to do first',
            required: true,
          },
        },
        tools: TOOLS,
        toolMode: 'per-item', // Per-item mode allows multiple iterations
        maxIterationsPerItem: 3,
        toolExecutor: new MetaLLMToolExecutor(llmProvider),
        llmProvider,
        batchSize: 1,
      }
    );

    console.log('\n' + '='.repeat(80));
    console.log('📤 RESULTS');
    console.log('='.repeat(80));

    if (Array.isArray(results)) {
      const result = results[0];
      console.log('\n📊 Summary:');
      console.log(result.summary);
      console.log('\n🎯 Top Recommendation:');
      console.log(result.top_recommendation);
    }

    console.log('\n✅ Meta-LLM test passed!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await rag.close();
  }
}

testMetaLLM();
