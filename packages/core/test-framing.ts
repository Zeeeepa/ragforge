import { generateRender3DAssetHandler } from './src/tools/threed-tools.js';

const handler = generateRender3DAssetHandler({ projectRoot: process.cwd() });

async function test() {
  console.log('Testing precise framing...');
  await handler({
    model_path: '/home/luciedefraiteur/LR_CodeRag/glTF-Sample-Models/2.0/Fox/glTF-Binary/Fox.glb',
    output_dir: 'test-result',
    views: ['perspective'],
    width: 512,
    height: 512,
    background: '#333333',
    precise_framing: true,
  });
  console.log('Done');
}

test().catch(console.error);
