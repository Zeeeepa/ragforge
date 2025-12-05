/**
 * Quick test of 3D rendering with Playwright
 */
import { generate3DTools } from './dist/esm/tools/threed-tools.js';

const testModel = '/home/luciedefraiteur/LR_CodeRag/glTF-Sample-Models/2.0/Fox/glTF-Binary/Fox.glb';
const outputDir = '/home/luciedefraiteur/LR_CodeRag/ragforge/packages/core/test-renders';

async function main() {
  console.log('Testing 3D render with Fox model (Playwright)...\n');

  const ctx = { projectRoot: process.cwd() };
  const { handlers } = generate3DTools(ctx);

  console.log('Rendering views: front, left, right, top, perspective\n');

  const start = Date.now();
  const result = await handlers.render_3d_asset({
    model_path: testModel,
    output_dir: outputDir,
    views: ['front', 'left', 'right', 'top', 'perspective'],
    width: 512,
    height: 512,
    background: '#2a2a2a',
  });
  const elapsed = Date.now() - start;

  console.log(`Completed in ${elapsed}ms`);
  console.log('Result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
