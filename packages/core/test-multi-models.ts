import { generateRender3DAssetHandler } from './src/tools/threed-tools.js';

const handler = generateRender3DAssetHandler({ projectRoot: process.cwd() });
const basePath = '/home/luciedefraiteur/LR_CodeRag/glTF-Sample-Models/2.0';

const models = [
  'Avocado/glTF-Binary/Avocado.glb',
  'Duck/glTF-Binary/Duck.glb', 
  'BoomBox/glTF-Binary/BoomBox.glb',
  'AntiqueCamera/glTF-Binary/AntiqueCamera.glb',
];

async function test() {
  for (const model of models) {
    const name = model.split('/')[0];
    console.log(`Rendering ${name}...`);
    try {
      await handler({
        model_path: `${basePath}/${model}`,
        output_dir: `test-multi/${name}`,
        views: ['perspective'],
        width: 512,
        height: 512,
        background: '#333333',
        precise_framing: true,
      });
      console.log(`  Done: test-multi/${name}/`);
    } catch (e) {
      console.error(`  Failed: ${e.message}`);
    }
  }
}

test().catch(console.error);
