/**
 * Test StructuredLLMExecutor with Tool Calling
 *
 * Tests both global and per-item modes
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import {
  StructuredLLMExecutor,
  type ToolExecutor,
  type ToolCallRequest,
  type ToolExecutionResult,
  type ToolDefinition,
  GeminiAPIProvider,
  type LLMProvider,
} from './src/index.js';

// Load environment variables
config({ path: resolve(process.cwd(), '../../.env') });

// Mock tool executor
class MockToolExecutor implements ToolExecutor {
  async execute(toolCall: ToolCallRequest): Promise<any> {
    console.log(`      [MockTool] Executing ${toolCall.tool_name}(${JSON.stringify(toolCall.arguments)})`);

    // Mock npm package search
    if (toolCall.tool_name === 'search_npm_package') {
      const pkg = toolCall.arguments.packageName;
      const mockVersions: Record<string, string> = {
        'lodash': '4.17.21',
        'axios': '1.6.0',
        'react': '18.2.0',
      };
      return {
        name: pkg,
        version: mockVersions[pkg] || '1.0.0',
        description: `Mock description for ${pkg}`,
      };
    }

    return { mock: true };
  }

  async executeBatch(toolCalls: ToolCallRequest[]): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const toolCall of toolCalls) {
      try {
        const result = await this.execute(toolCall);
        results.push({
          tool_name: toolCall.tool_name,
          success: true,
          result,
        });
      } catch (error: any) {
        results.push({
          tool_name: toolCall.tool_name,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }
}

async function testGlobalMode() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: Global Tool Calling Mode');
  console.log('='.repeat(60));

  const executor = new StructuredLLMExecutor();

  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY environment variable not set');
    process.exit(1);
  }

  const llmProvider: LLMProvider = new GeminiAPIProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  const codeSnippets = [
    { code: "import lodash from 'lodash'" },
    { code: "import axios from 'axios'" },
    { code: "import react from 'react'" },
  ];

  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "search_npm_package",
        description: "Search npm registry for package latest version",
        parameters: {
          type: "object",
          properties: {
            packageName: {
              type: "string",
              description: "NPM package name",
            },
          },
          required: ["packageName"],
        },
      },
    },
  ];

  try {
    const results = await executor.executeLLMBatchWithTools(
      codeSnippets,
      {
        inputFields: ['code'],
        systemPrompt: 'You are a code analyzer',
        userTask: 'Extract the npm package name from each import statement',
        outputSchema: {
          package_name: {
            type: 'string',
            description: 'The npm package name',
            required: true,
          },
          version: {
            type: 'string',
            description: 'Package version (if available from tools)',
            required: false,
          },
        },
        tools,
        toolMode: 'global', // LLM sees all snippets, calls tool for all packages
        toolExecutor: new MockToolExecutor(),
        llmProvider,
        batchSize: 10,
      }
    );

    console.log('\n📤 Results:');
    if (Array.isArray(results)) {
      results.forEach((r, i) => {
        console.log(`\n   Item ${i + 1}:`);
        console.log(`      Code: ${r.code}`);
        console.log(`      Package: ${r.package_name}`);
        console.log(`      Version: ${r.version || 'N/A'}`);
      });
    }

    console.log('\n✅ Global mode test passed!');
  } catch (error) {
    console.error('\n❌ Global mode test failed:', error);
    throw error;
  }
}

async function testPerItemMode() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Per-Item Tool Calling Mode');
  console.log('='.repeat(60));

  const executor = new StructuredLLMExecutor();

  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY environment variable not set');
    process.exit(1);
  }

  const llmProvider: LLMProvider = new GeminiAPIProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  });

  const codeSnippets = [
    { code: "import lodash from 'lodash'" },
    { code: "import axios from 'axios'" },
  ];

  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "search_npm_package",
        description: "Search npm registry for package info",
        parameters: {
          type: "object",
          properties: {
            packageName: {
              type: "string",
              description: "NPM package name",
            },
          },
          required: ["packageName"],
        },
      },
    },
  ];

  try {
    const results = await executor.executeLLMBatchWithTools(
      codeSnippets,
      {
        inputFields: ['code'],
        systemPrompt: 'You are a code analyzer',
        userTask: 'Extract the package name and get its version',
        outputSchema: {
          package_name: {
            type: 'string',
            description: 'The npm package name',
            required: true,
          },
          version: {
            type: 'string',
            description: 'Package version from npm',
            required: false,
          },
        },
        tools,
        toolMode: 'per-item', // Each item gets its own loop
        maxIterationsPerItem: 3,
        toolExecutor: new MockToolExecutor(),
        llmProvider,
      }
    );

    console.log('\n📤 Results:');
    if (Array.isArray(results)) {
      results.forEach((r, i) => {
        console.log(`\n   Item ${i + 1}:`);
        console.log(`      Code: ${r.code}`);
        console.log(`      Package: ${r.package_name}`);
        console.log(`      Version: ${r.version || 'N/A'}`);
      });
    }

    console.log('\n✅ Per-item mode test passed!');
  } catch (error) {
    console.error('\n❌ Per-item mode test failed:', error);
    throw error;
  }
}

async function main() {
  console.log('🧪 Testing StructuredLLMExecutor with Tool Calling\n');

  try {
    await testGlobalMode();
    await testPerItemMode();

    console.log('\n' + '='.repeat(60));
    console.log('🎉 All tests passed!');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  }
}

main();
