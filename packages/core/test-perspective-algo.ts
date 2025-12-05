/**
 * Test runner for perspective-algo.js
 * Run with: npx tsx test-perspective-algo.ts
 */

import { chromium } from 'playwright';
import * as fs from 'fs/promises';
import * as path from 'path';

const MODEL_PATH = '/home/luciedefraiteur/LR_CodeRag/glTF-Sample-Models/2.0/Fox/glTF-Binary/Fox.glb';
const OUTPUT_PATH = 'test-result/Fox_perspective.png';
const ALGO_FILE = path.join(process.cwd(), 'perspective-algo.js');

async function main() {
  const modelBuffer = await fs.readFile(MODEL_PATH);
  const algoCode = await fs.readFile(ALGO_FILE, 'utf-8');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'log') console.log('LOG:', msg.text());
    if (msg.type() === 'error') console.error('ERROR:', msg.text());
  });

  // Serve the model file
  await page.route('**/__model__.glb', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'model/gltf-binary',
      body: modelBuffer,
    });
  });

  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <script type="importmap">
  {
    "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
    }
  }
  </script>
  <script type="module">
${algoCode}

async function main() {
  try {
    const dataUrl = await renderPerspective(512, 512, 'http://localhost/__model__.glb');
    window.resultDataUrl = dataUrl;
    window.renderDone = true;
  } catch (err) {
    console.error('Error:', err);
    window.renderError = err.message;
    window.renderDone = true;
  }
}
main();
  </script>
</body>
</html>`;

  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.renderDone === true', { timeout: 60000 });

  const error = await page.evaluate('window.renderError');
  if (error) {
    console.error('Render error:', error);
    await browser.close();
    return;
  }

  const dataUrl = await page.evaluate('window.resultDataUrl') as string;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  await fs.mkdir('test-result', { recursive: true });
  await fs.writeFile(OUTPUT_PATH, Buffer.from(base64, 'base64'));
  console.log('Saved:', OUTPUT_PATH);

  await browser.close();
}

main().catch(console.error);
