/**
 * Test Image Tools
 *
 * Usage:
 *   npx tsx test-image-tools.ts [image-path]
 *
 * Example:
 *   npx tsx test-image-tools.ts ../test_images/screenshot.png
 */

import { generateImageTools } from '@luciformresearch/ragforge-core';
import * as path from 'path';
import 'dotenv/config';

const projectRoot = process.cwd();

async function main() {
  console.log('🖼️  Testing Image Tools\n');
  console.log(`Project root: ${projectRoot}`);

  // Check available providers
  console.log('\n📋 Checking OCR providers:');
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log(`  REPLICATE_API_TOKEN: ${process.env.REPLICATE_API_TOKEN ? '✅ Set' : '❌ Not set'}`);

  // Create context and handlers
  const ctx = { projectRoot };
  const { tools, handlers } = generateImageTools(ctx);

  console.log(`\n🔧 Generated ${tools.length} image tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description.split('\n')[0]}`);
  }

  // Get image path from args or use default
  const imagePath = process.argv[2] || '../../test_images/unnamed.jpg';
  const absolutePath = path.isAbsolute(imagePath)
    ? imagePath
    : path.join(projectRoot, imagePath);

  console.log(`\n🎯 Testing with image: ${imagePath}`);
  console.log(`   Absolute path: ${absolutePath}`);

  // Test 1: List images
  console.log('\n' + '='.repeat(60));
  console.log('📁 TEST 1: list_images');
  console.log('='.repeat(60));

  const listResult = await handlers.list_images({
    path: path.dirname(imagePath),
    recursive: true,
  });
  console.log(JSON.stringify(listResult, null, 2));

  // Test 2: Read image (OCR) with Gemini
  if (process.env.GEMINI_API_KEY) {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 TEST 2: read_image (Gemini Vision OCR)');
    console.log('='.repeat(60));

    const startGemini = Date.now();
    const ocrGeminiResult = await handlers.read_image({
      path: imagePath,
      provider: 'gemini',
    });
    console.log(`Processing time: ${Date.now() - startGemini}ms`);
    console.log(JSON.stringify(ocrGeminiResult, null, 2));
  } else {
    console.log('\n⏭️  Skipping Gemini OCR test (GEMINI_API_KEY not set)');
  }

  // Test 3: Read image (OCR) with Replicate/DeepSeek
  if (process.env.REPLICATE_API_TOKEN) {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 TEST 3: read_image (DeepSeek-OCR via Replicate)');
    console.log('='.repeat(60));

    const startReplicate = Date.now();
    const ocrReplicateResult = await handlers.read_image({
      path: imagePath,
      provider: 'replicate-deepseek',
    });
    console.log(`Processing time: ${Date.now() - startReplicate}ms`);
    console.log(JSON.stringify(ocrReplicateResult, null, 2));
  } else {
    console.log('\n⏭️  Skipping Replicate OCR test (REPLICATE_API_TOKEN not set)');
  }

  // Test 4: Describe image
  if (process.env.GEMINI_API_KEY) {
    console.log('\n' + '='.repeat(60));
    console.log('📝 TEST 4: describe_image');
    console.log('='.repeat(60));

    const startDescribe = Date.now();
    const describeResult = await handlers.describe_image({
      path: imagePath,
      prompt: 'Describe this image in detail. What elements, text, and visual features do you see?',
    });
    console.log(`Processing time: ${Date.now() - startDescribe}ms`);
    console.log(JSON.stringify(describeResult, null, 2));
  } else {
    console.log('\n⏭️  Skipping describe_image test (GEMINI_API_KEY not set)');
  }

  console.log('\n✅ Image tools test complete!');
}

main().catch(console.error);
