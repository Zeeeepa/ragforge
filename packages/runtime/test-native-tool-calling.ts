/**
 * Test Native Tool Calling with Gemini
 *
 * Simple test to verify that native tool calling works with Gemini.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { GeminiNativeToolProvider, type ToolDefinition } from './src/llm/native-tool-calling/index.js';

// Load environment variables from ragforge root .env
config({ path: resolve(process.cwd(), '../../.env') });

async function testNativeToolCalling() {
  // Check for API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY environment variable not set');
    process.exit(1);
  }

  console.log('🧪 Testing Native Tool Calling with Gemini\n');

  // Create provider
  const provider = new GeminiNativeToolProvider({
    apiKey,
    model: 'gemini-2.0-flash',
    temperature: 0.7,
  });

  console.log(`✅ Provider initialized: ${provider.getProviderName()}`);
  console.log(`✅ Native tool calling supported: ${provider.supportsNativeToolCalling()}\n`);

  // Define simple mock tools
  const tools: ToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the current weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The city and country, e.g., 'Paris, France'",
            },
            unit: {
              type: "string",
              description: "The temperature unit (celsius or fahrenheit)",
              default: "celsius",
            },
          },
          required: ["location"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_population",
        description: "Get the population of a city",
        parameters: {
          type: "object",
          properties: {
            city: {
              type: "string",
              description: "The city name",
            },
          },
          required: ["city"],
        },
      },
    },
  ];

  console.log(`📦 Defined ${tools.length} tools:\n`);
  tools.forEach(tool => {
    console.log(`   - ${tool.function.name}: ${tool.function.description}`);
  });
  console.log();

  // Test 1: Simple question that should trigger a tool call
  console.log('📝 Test 1: Question that should trigger tool call');
  console.log('   Query: "What\'s the weather like in Paris?"\n');

  try {
    const response1 = await provider.generateWithTools(
      [
        {
          role: "user",
          content: "What's the weather like in Paris?",
        },
      ],
      tools,
      {
        toolChoice: "auto",
      }
    );

    console.log('📤 Response:');
    console.log(`   Content: ${response1.content}`);
    console.log(`   Tool calls: ${response1.toolCalls ? response1.toolCalls.length : 0}`);

    if (response1.toolCalls) {
      response1.toolCalls.forEach(tc => {
        console.log(`\n   🔧 Tool Call:`);
        console.log(`      Name: ${tc.function.name}`);
        console.log(`      Arguments: ${tc.function.arguments}`);
      });
    }

    if (response1.usage) {
      console.log(`\n   📊 Usage:`);
      console.log(`      Input tokens: ${response1.usage.input_tokens}`);
      console.log(`      Output tokens: ${response1.usage.output_tokens}`);
      console.log(`      Total tokens: ${response1.usage.total_tokens}`);
    }

    console.log('\n✅ Test 1 passed!\n');
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
    throw error;
  }

  // Test 2: Direct answer (no tool call needed)
  console.log('📝 Test 2: Question that should NOT trigger tool call');
  console.log('   Query: "What is the capital of France?"\n');

  try {
    const response2 = await provider.generateWithTools(
      [
        {
          role: "user",
          content: "What is the capital of France?",
        },
      ],
      tools,
      {
        toolChoice: "auto",
      }
    );

    console.log('📤 Response:');
    console.log(`   Content: ${response2.content}`);
    console.log(`   Tool calls: ${response2.toolCalls ? response2.toolCalls.length : 0}`);

    if (response2.usage) {
      console.log(`\n   📊 Usage:`);
      console.log(`      Input tokens: ${response2.usage.input_tokens}`);
      console.log(`      Output tokens: ${response2.usage.output_tokens}`);
      console.log(`      Total tokens: ${response2.usage.total_tokens}`);
    }

    console.log('\n✅ Test 2 passed!\n');
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
    throw error;
  }

  // Test 3: Multiple tool calls
  console.log('📝 Test 3: Question that should trigger multiple tool calls');
  console.log('   Query: "What\'s the weather and population in Tokyo?"\n');

  try {
    const response3 = await provider.generateWithTools(
      [
        {
          role: "user",
          content: "What's the weather and population in Tokyo?",
        },
      ],
      tools,
      {
        toolChoice: "auto",
      }
    );

    console.log('📤 Response:');
    console.log(`   Content: ${response3.content}`);
    console.log(`   Tool calls: ${response3.toolCalls ? response3.toolCalls.length : 0}`);

    if (response3.toolCalls) {
      response3.toolCalls.forEach(tc => {
        console.log(`\n   🔧 Tool Call:`);
        console.log(`      Name: ${tc.function.name}`);
        console.log(`      Arguments: ${tc.function.arguments}`);
      });
    }

    if (response3.usage) {
      console.log(`\n   📊 Usage:`);
      console.log(`      Input tokens: ${response3.usage.input_tokens}`);
      console.log(`      Output tokens: ${response3.usage.output_tokens}`);
      console.log(`      Total tokens: ${response3.usage.total_tokens}`);
    }

    console.log('\n✅ Test 3 passed!\n');
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
    throw error;
  }

  console.log('🎉 All tests passed!\n');
}

// Run tests
testNativeToolCalling().catch(error => {
  console.error('💥 Test suite failed:', error);
  process.exit(1);
});
