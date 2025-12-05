/**
 * Test All Media Tools (Image + 3D)
 *
 * Tests:
 * - Image: read_image (OCR), describe_image, list_images
 * - 3D: render_3d_asset, generate_3d_from_image, generate_3d_from_text
 *
 * Usage:
 *   npx tsx test-media-tools.ts [--skip-replicate] [--skip-3d-gen]
 *
 * Options:
 *   --skip-replicate: Skip Replicate API tests (OCR DeepSeek, 3D generation)
 *   --skip-3d-gen: Skip 3D generation tests (only test local rendering)
 */

import { generateImageTools, generate3DTools } from '@luciformresearch/ragforge-core';
import * as fs from 'fs/promises';
import * as path from 'path';
import 'dotenv/config';

const projectRoot = process.cwd();
const skipReplicate = process.argv.includes('--skip-replicate');
const skip3DGen = process.argv.includes('--skip-3d-gen');

async function main() {
  console.log('═'.repeat(70));
  console.log('  RAGFORGE MEDIA TOOLS TEST');
  console.log('═'.repeat(70));
  console.log(`\nProject root: ${projectRoot}`);
  console.log(`Skip Replicate: ${skipReplicate}`);
  console.log(`Skip 3D Generation: ${skip3DGen}`);

  // Check environment
  console.log('\n📋 Environment Check:');
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set' : '❌ Not set'}`);
  console.log(`  REPLICATE_API_TOKEN: ${process.env.REPLICATE_API_TOKEN ? '✅ Set' : '❌ Not set'}`);

  // Initialize tools
  const imageCtx = { projectRoot };
  const threeDCtx = { projectRoot };

  const imageTools = generateImageTools(imageCtx);
  const threeDTools = generate3DTools(threeDCtx);

  console.log(`\n🔧 Available tools:`);
  console.log('  Image tools:', imageTools.tools.map(t => t.name).join(', '));
  console.log('  3D tools:', threeDTools.tools.map(t => t.name).join(', '));

  // Create test directories
  const testDir = path.join(projectRoot, '.media-test');
  const rendersDir = path.join(testDir, 'renders');
  const modelsDir = path.join(testDir, 'models');
  await fs.mkdir(testDir, { recursive: true });
  await fs.mkdir(rendersDir, { recursive: true });
  await fs.mkdir(modelsDir, { recursive: true });

  console.log(`\n📂 Test directories created: ${testDir}`);

  const results: Array<{ test: string; status: 'pass' | 'fail' | 'skip'; time?: number; error?: string }> = [];

  // ========================================
  // IMAGE TOOLS TESTS
  // ========================================

  console.log('\n' + '─'.repeat(70));
  console.log('  IMAGE TOOLS');
  console.log('─'.repeat(70));

  // Test: list_images
  console.log('\n📁 TEST: list_images');
  try {
    const start = Date.now();
    const listResult = await imageTools.handlers.list_images({
      path: '.',
      recursive: true,
      pattern: '*.{png,jpg,jpeg,gif}',
    });
    const time = Date.now() - start;

    if (listResult.error) {
      console.log(`  ❌ Error: ${listResult.error}`);
      results.push({ test: 'list_images', status: 'fail', error: listResult.error });
    } else {
      console.log(`  ✅ Found ${listResult.images?.length || 0} images`);
      if (listResult.images?.length > 0) {
        console.log(`     First 5: ${listResult.images.slice(0, 5).join(', ')}`);
      }
      results.push({ test: 'list_images', status: 'pass', time });
    }
  } catch (err: any) {
    console.log(`  ❌ Exception: ${err.message}`);
    results.push({ test: 'list_images', status: 'fail', error: err.message });
  }

  // Find a test image
  let testImagePath: string | null = null;
  try {
    const listResult = await imageTools.handlers.list_images({
      path: '.',
      recursive: true,
      pattern: '*.{png,jpg,jpeg}',
    });
    if (listResult.images?.length > 0) {
      testImagePath = listResult.images[0];
      console.log(`\n🖼️  Using test image: ${testImagePath}`);
    }
  } catch { }

  // Test: read_image (Gemini OCR)
  if (testImagePath && process.env.GEMINI_API_KEY) {
    console.log('\n🔍 TEST: read_image (Gemini Vision OCR)');
    try {
      const start = Date.now();
      const ocrResult = await imageTools.handlers.read_image({
        path: testImagePath,
        provider: 'gemini',
      });
      const time = Date.now() - start;

      if (ocrResult.error) {
        console.log(`  ❌ Error: ${ocrResult.error}`);
        results.push({ test: 'read_image_gemini', status: 'fail', error: ocrResult.error });
      } else {
        const textPreview = ocrResult.text?.substring(0, 100) || '(no text)';
        console.log(`  ✅ OCR completed in ${time}ms`);
        console.log(`     Text preview: ${textPreview}...`);
        results.push({ test: 'read_image_gemini', status: 'pass', time });
      }
    } catch (err: any) {
      console.log(`  ❌ Exception: ${err.message}`);
      results.push({ test: 'read_image_gemini', status: 'fail', error: err.message });
    }
  } else {
    console.log('\n⏭️  Skipping read_image (Gemini) - no test image or API key');
    results.push({ test: 'read_image_gemini', status: 'skip' });
  }

  // Test: read_image (Replicate DeepSeek)
  if (testImagePath && process.env.REPLICATE_API_TOKEN && !skipReplicate) {
    console.log('\n🔍 TEST: read_image (DeepSeek OCR via Replicate)');
    try {
      const start = Date.now();
      const ocrResult = await imageTools.handlers.read_image({
        path: testImagePath,
        provider: 'replicate-deepseek',
      });
      const time = Date.now() - start;

      if (ocrResult.error) {
        console.log(`  ❌ Error: ${ocrResult.error}`);
        results.push({ test: 'read_image_replicate', status: 'fail', error: ocrResult.error });
      } else {
        const textPreview = ocrResult.text?.substring(0, 100) || '(no text)';
        console.log(`  ✅ OCR completed in ${time}ms`);
        console.log(`     Text preview: ${textPreview}...`);
        results.push({ test: 'read_image_replicate', status: 'pass', time });
      }
    } catch (err: any) {
      console.log(`  ❌ Exception: ${err.message}`);
      results.push({ test: 'read_image_replicate', status: 'fail', error: err.message });
    }
  } else {
    console.log('\n⏭️  Skipping read_image (Replicate) - skipped or no API key');
    results.push({ test: 'read_image_replicate', status: 'skip' });
  }

  // Test: describe_image
  if (testImagePath && process.env.GEMINI_API_KEY) {
    console.log('\n📝 TEST: describe_image');
    try {
      const start = Date.now();
      const descResult = await imageTools.handlers.describe_image({
        path: testImagePath,
        prompt: 'Describe this image briefly.',
      });
      const time = Date.now() - start;

      if (descResult.error) {
        console.log(`  ❌ Error: ${descResult.error}`);
        results.push({ test: 'describe_image', status: 'fail', error: descResult.error });
      } else {
        const descPreview = descResult.description?.substring(0, 150) || '(no description)';
        console.log(`  ✅ Description completed in ${time}ms`);
        console.log(`     Preview: ${descPreview}...`);
        results.push({ test: 'describe_image', status: 'pass', time });
      }
    } catch (err: any) {
      console.log(`  ❌ Exception: ${err.message}`);
      results.push({ test: 'describe_image', status: 'fail', error: err.message });
    }
  } else {
    console.log('\n⏭️  Skipping describe_image - no test image or API key');
    results.push({ test: 'describe_image', status: 'skip' });
  }

  // ========================================
  // 3D TOOLS TESTS
  // ========================================

  console.log('\n' + '─'.repeat(70));
  console.log('  3D TOOLS');
  console.log('─'.repeat(70));

  // Find a test 3D model
  let testModelPath: string | null = null;
  try {
    const files = await findFiles(projectRoot, ['.glb', '.gltf', '.obj']);
    if (files.length > 0) {
      testModelPath = files[0];
      console.log(`\n🎮 Using test model: ${testModelPath}`);
    } else {
      console.log('\n⚠️  No 3D models found in project');
    }
  } catch { }

  // Test: render_3d_asset
  if (testModelPath) {
    console.log('\n🖼️  TEST: render_3d_asset');
    try {
      const start = Date.now();
      const renderResult = await threeDTools.handlers.render_3d_asset({
        model_path: testModelPath,
        output_dir: rendersDir,
        views: ['front', 'left', 'perspective'],
        width: 512,
        height: 512,
        background: '#333333',
      });
      const time = Date.now() - start;

      if (renderResult.error) {
        console.log(`  ❌ Error: ${renderResult.error}`);
        if (renderResult.hint) console.log(`     Hint: ${renderResult.hint}`);
        results.push({ test: 'render_3d_asset', status: 'fail', error: renderResult.error });
      } else {
        console.log(`  ✅ Rendered ${renderResult.renders?.length || 0} views in ${time}ms`);
        for (const render of renderResult.renders || []) {
          console.log(`     - ${render.view}: ${render.path}`);
        }
        results.push({ test: 'render_3d_asset', status: 'pass', time });
      }
    } catch (err: any) {
      console.log(`  ❌ Exception: ${err.message}`);
      results.push({ test: 'render_3d_asset', status: 'fail', error: err.message });
    }
  } else {
    console.log('\n⏭️  Skipping render_3d_asset - no test model found');
    results.push({ test: 'render_3d_asset', status: 'skip' });
  }

  // Test: generate_3d_from_text
  if (process.env.REPLICATE_API_TOKEN && !skipReplicate && !skip3DGen) {
    console.log('\n✨ TEST: generate_3d_from_text (this may take 1-2 minutes)');
    try {
      const start = Date.now();
      const genResult = await threeDTools.handlers.generate_3d_from_text({
        prompt: 'A simple red cube, low poly style',
        output_path: path.join(modelsDir, 'generated-cube.glb'),
        style: 'lowpoly',
      });
      const time = Date.now() - start;

      if (genResult.error) {
        console.log(`  ❌ Error: ${genResult.error}`);
        results.push({ test: 'generate_3d_from_text', status: 'fail', error: genResult.error });
      } else {
        console.log(`  ✅ Generated model in ${Math.round(time / 1000)}s`);
        console.log(`     Path: ${genResult.model_path}`);
        results.push({ test: 'generate_3d_from_text', status: 'pass', time });
      }
    } catch (err: any) {
      console.log(`  ❌ Exception: ${err.message}`);
      results.push({ test: 'generate_3d_from_text', status: 'fail', error: err.message });
    }
  } else {
    console.log('\n⏭️  Skipping generate_3d_from_text - skipped or no API key');
    results.push({ test: 'generate_3d_from_text', status: 'skip' });
  }

  // Test: generate_3d_from_image
  if (testImagePath && process.env.REPLICATE_API_TOKEN && !skipReplicate && !skip3DGen) {
    console.log('\n✨ TEST: generate_3d_from_image (this may take 30-60 seconds)');
    try {
      const start = Date.now();
      const genResult = await threeDTools.handlers.generate_3d_from_image({
        image_path: testImagePath,
        output_path: path.join(modelsDir, 'generated-from-image.glb'),
      });
      const time = Date.now() - start;

      if (genResult.error) {
        console.log(`  ❌ Error: ${genResult.error}`);
        results.push({ test: 'generate_3d_from_image', status: 'fail', error: genResult.error });
      } else {
        console.log(`  ✅ Generated model in ${Math.round(time / 1000)}s`);
        console.log(`     Path: ${genResult.model_path}`);
        results.push({ test: 'generate_3d_from_image', status: 'pass', time });
      }
    } catch (err: any) {
      console.log(`  ❌ Exception: ${err.message}`);
      results.push({ test: 'generate_3d_from_image', status: 'fail', error: err.message });
    }
  } else {
    console.log('\n⏭️  Skipping generate_3d_from_image - skipped or missing requirements');
    results.push({ test: 'generate_3d_from_image', status: 'skip' });
  }

  // ========================================
  // SUMMARY
  // ========================================

  console.log('\n' + '═'.repeat(70));
  console.log('  SUMMARY');
  console.log('═'.repeat(70));

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log(`\n  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);

  console.log('\nDetails:');
  for (const r of results) {
    const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️';
    const timeStr = r.time ? ` (${r.time}ms)` : '';
    console.log(`  ${icon} ${r.test}${timeStr}`);
    if (r.error) console.log(`     Error: ${r.error}`);
  }

  console.log(`\n📂 Test outputs saved to: ${testDir}`);
  console.log('\n' + '═'.repeat(70));

  process.exit(failed > 0 ? 1 : 0);
}

// Helper: find files by extension
async function findFiles(dir: string, extensions: string[], depth = 3): Promise<string[]> {
  const found: string[] = [];

  async function scan(currentDir: string, currentDepth: number) {
    if (currentDepth > depth) return;

    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath, currentDepth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            found.push(fullPath);
          }
        }
      }
    } catch { }
  }

  await scan(dir, 0);
  return found;
}

main().catch(console.error);
