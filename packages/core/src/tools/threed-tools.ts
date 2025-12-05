/**
 * 3D Asset Tools
 *
 * - render_3d_asset: Render 3D models to images (Three.js headless)
 * - generate_3d_from_image: Generate 3D from image (Replicate/Trellis)
 * - generate_3d_from_text: Generate 3D from text (Replicate/MVDream)
 *
 * @since 2025-12-05
 */

import type { GeneratedToolDefinition } from './types/index.js';

// ============================================
// Tool Definitions
// ============================================

/**
 * Generate render_3d_asset tool
 */
export function generateRender3DAssetTool(): GeneratedToolDefinition {
  return {
    name: 'render_3d_asset',
    description: `Render a 3D model to images from multiple viewpoints.

Uses Three.js to render .glb/.gltf/.obj models to PNG images.
Useful for previewing 3D assets or generating reference images.

Parameters:
- model_path: Path to 3D model file (.glb, .gltf, .obj)
- output_dir: Directory to save rendered images
- views: Array of view angles (default: ['perspective'])
  Available: 'front', 'back', 'left', 'right', 'top', 'bottom', 'perspective'
- width: Image width in pixels (default: 1024)
- height: Image height in pixels (default: 1024)
- background: Background color hex (default: transparent)

Example: render_3d_asset({
  model_path: "assets/character.glb",
  output_dir: "renders/",
  views: ["front", "left", "perspective"]
})`,
    inputSchema: {
      type: 'object',
      properties: {
        model_path: {
          type: 'string',
          description: 'Path to 3D model file (.glb, .gltf, .obj, .fbx)',
        },
        output_dir: {
          type: 'string',
          description: 'Directory to save rendered images',
        },
        views: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'perspective'],
          },
          description: 'View angles to render (default: perspective)',
        },
        width: {
          type: 'number',
          description: 'Image width in pixels (default: 1024)',
        },
        height: {
          type: 'number',
          description: 'Image height in pixels (default: 1024)',
        },
        background: {
          type: 'string',
          description: 'Background color hex (e.g., "#ffffff") or "transparent"',
        },
      },
      required: ['model_path', 'output_dir'],
    },
  };
}

/**
 * Generate generate_3d_from_image tool
 */
export function generateGenerate3DFromImageTool(): GeneratedToolDefinition {
  return {
    name: 'generate_3d_from_image',
    description: `Generate a 3D model from a reference image.

Uses Trellis (via Replicate) to convert an image into a 3D model.
Good for creating game-ready 3D assets from concept art or photos.

Parameters:
- image_path: Path to input image
- output_path: Where to save the generated .glb model
- format: Output format ('glb' or 'obj', default: 'glb')

Note: Requires REPLICATE_API_TOKEN environment variable.
Processing time: ~30-60 seconds depending on complexity.

Example: generate_3d_from_image({
  image_path: "references/spaceship-concept.png",
  output_path: "assets/models/spaceship.glb"
})`,
    inputSchema: {
      type: 'object',
      properties: {
        image_path: {
          type: 'string',
          description: 'Path to input image',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the generated 3D model',
        },
        format: {
          type: 'string',
          enum: ['glb', 'obj'],
          description: 'Output format (default: glb)',
        },
      },
      required: ['image_path', 'output_path'],
    },
  };
}

/**
 * Generate generate_3d_from_text tool
 */
export function generateGenerate3DFromTextTool(): GeneratedToolDefinition {
  return {
    name: 'generate_3d_from_text',
    description: `Generate a 3D model from a text description.

Uses MVDream (via Replicate) to create 3D models from text prompts.
Good for generating assets when you don't have reference images.

Parameters:
- prompt: Text description of the 3D model to generate
- output_path: Where to save the generated .glb model
- format: Output format ('glb' or 'obj', default: 'glb')
- style: Visual style ('realistic', 'stylized', 'lowpoly')

Note: Requires REPLICATE_API_TOKEN environment variable.
Processing time: ~60-120 seconds.

Example: generate_3d_from_text({
  prompt: "A medieval castle with towers, fantasy style",
  output_path: "assets/models/castle.glb",
  style: "stylized"
})`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the 3D model',
        },
        output_path: {
          type: 'string',
          description: 'Where to save the generated 3D model',
        },
        format: {
          type: 'string',
          enum: ['glb', 'obj'],
          description: 'Output format (default: glb)',
        },
        style: {
          type: 'string',
          enum: ['realistic', 'stylized', 'lowpoly'],
          description: 'Visual style for generation',
        },
      },
      required: ['prompt', 'output_path'],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export interface ThreeDToolsContext {
  /** Project root directory */
  projectRoot: string;
}

/**
 * Camera configurations for standard views
 * - ortho views: use OrthographicCamera with exact bounding box fit
 * - perspective: use PerspectiveCamera with Thales-based distance calculation
 */
interface ViewConfig {
  type: 'ortho' | 'perspective';
  direction: [number, number, number]; // View direction (camera looks at -direction)
  up: [number, number, number];
}

const VIEW_CONFIGS: Record<string, ViewConfig> = {
  front: { type: 'ortho', direction: [0, 0, 1], up: [0, 1, 0] },
  back: { type: 'ortho', direction: [0, 0, -1], up: [0, 1, 0] },
  left: { type: 'ortho', direction: [-1, 0, 0], up: [0, 1, 0] },
  right: { type: 'ortho', direction: [1, 0, 0], up: [0, 1, 0] },
  top: { type: 'ortho', direction: [0, 1, 0], up: [0, 0, -1] },
  bottom: { type: 'ortho', direction: [0, -1, 0], up: [0, 0, 1] },
  perspective: { type: 'perspective', direction: [1, 0.6, 1], up: [0, 1, 0] }, // ~45° around Y, ~30° elevation
};

/**
 * Generate handler for render_3d_asset
 */
export function generateRender3DAssetHandler(ctx: ThreeDToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const {
      model_path,
      output_dir,
      views = ['perspective'],
      width = 1024,
      height = 1024,
      background = 'transparent',
    } = params;

    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve paths
    const absoluteModelPath = pathModule.isAbsolute(model_path)
      ? model_path
      : pathModule.join(ctx.projectRoot, model_path);

    const absoluteOutputDir = pathModule.isAbsolute(output_dir)
      ? output_dir
      : pathModule.join(ctx.projectRoot, output_dir);

    // Check model exists
    try {
      await fs.stat(absoluteModelPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Model not found: ${absoluteModelPath}` };
      }
      throw err;
    }

    // Check format
    const ext = pathModule.extname(absoluteModelPath).toLowerCase();
    const supportedFormats = ['.glb', '.gltf', '.obj'];
    if (!supportedFormats.includes(ext)) {
      return { error: `Unsupported format: ${ext}. Supported: ${supportedFormats.join(', ')}` };
    }

    // Create output directory
    await fs.mkdir(absoluteOutputDir, { recursive: true });

    // Try to render using Three.js
    try {
      const renders = await renderModelWithThreeJS(
        absoluteModelPath,
        absoluteOutputDir,
        views,
        width,
        height,
        background
      );

      return {
        model_path,
        output_dir,
        views_rendered: views,
        renders,
      };
    } catch (err: any) {
      return {
        error: `Rendering failed: ${err.message}`,
        hint: 'Make sure three, canvas, and gl packages are installed for headless rendering.',
      };
    }
  };
}

/**
 * Render model using Playwright + Three.js
 *
 * Uses a headless browser for full WebGL2 support.
 * For orthographic views (front, back, etc.): OrthographicCamera with exact bounding box fit
 * For perspective view: PerspectiveCamera with Thales-based optimal distance calculation
 */
async function renderModelWithThreeJS(
  modelPath: string,
  outputDir: string,
  views: string[],
  width: number,
  height: number,
  background: string
): Promise<Array<{ view: string; path: string }>> {
  const fs = await import('fs/promises');
  const pathModule = await import('path');
  const { chromium } = await import('playwright');

  const renders: Array<{ view: string; path: string }> = [];
  const modelName = pathModule.basename(modelPath, pathModule.extname(modelPath));

  // Read model file as base64
  const modelBuffer = await fs.readFile(modelPath);
  const modelBase64 = modelBuffer.toString('base64');
  const modelDataUrl = `data:application/octet-stream;base64,${modelBase64}`;

  // Build the HTML page with Three.js
  const html = buildThreeJSPage(width, height, background, modelDataUrl, views);

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    // Load the page
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Wait for Three.js to load and render
    await page.waitForFunction('window.rendersReady === true', { timeout: 30000 });

    // Get the render results from the page
    const renderResults = await page.evaluate('window.renderResults') as Array<{ view: string; dataUrl: string }>;

    // Save each rendered view
    for (const result of renderResults) {
      const outputPath = pathModule.join(outputDir, `${modelName}_${result.view}.png`);

      // Convert base64 data URL to buffer and save
      const base64Data = result.dataUrl.replace(/^data:image\/png;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      await fs.writeFile(outputPath, imageBuffer);

      renders.push({
        view: result.view,
        path: pathModule.relative(pathModule.dirname(outputDir), outputPath),
      });
    }
  } finally {
    await browser.close();
  }

  return renders;
}

/**
 * Build HTML page with embedded Three.js for rendering
 */
function buildThreeJSPage(
  width: number,
  height: number,
  background: string,
  modelDataUrl: string,
  views: string[]
): string {
  const viewConfigsJson = JSON.stringify(VIEW_CONFIGS);
  const viewsJson = JSON.stringify(views);
  const bgColor = background === 'transparent' ? 'null' : `"${background}"`;

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
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
    import * as THREE from 'three';
    import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

    const VIEW_CONFIGS = ${viewConfigsJson};
    const views = ${viewsJson};
    const width = ${width};
    const height = ${height};
    const bgColor = ${bgColor};
    const modelDataUrl = "${modelDataUrl}";

    window.renderResults = [];
    window.rendersReady = false;

    async function main() {
      // Create renderer
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: bgColor === null,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(width, height);
      document.body.appendChild(renderer.domElement);

      if (bgColor !== null) {
        renderer.setClearColor(new THREE.Color(bgColor), 1);
      }

      // Create scene
      const scene = new THREE.Scene();

      // Add lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 10, 7.5);
      scene.add(directionalLight);

      const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
      backLight.position.set(-5, -5, -5);
      scene.add(backLight);

      // Load model from data URL
      const loader = new GLTFLoader();
      const response = await fetch(modelDataUrl);
      const arrayBuffer = await response.arrayBuffer();

      const gltf = await new Promise((resolve, reject) => {
        loader.parse(arrayBuffer, '', resolve, reject);
      });

      scene.add(gltf.scene);

      // Calculate world bounding box
      const worldBox = new THREE.Box3().setFromObject(gltf.scene);
      const worldCenter = worldBox.getCenter(new THREE.Vector3());
      const worldSize = worldBox.getSize(new THREE.Vector3());

      // Center the model at origin
      gltf.scene.position.sub(worldCenter);

      // Get the 8 corners of the bounding box (now centered at origin)
      const halfSize = worldSize.clone().multiplyScalar(0.5);
      const boxCorners = [
        new THREE.Vector3(-halfSize.x, -halfSize.y, -halfSize.z),
        new THREE.Vector3(-halfSize.x, -halfSize.y, halfSize.z),
        new THREE.Vector3(-halfSize.x, halfSize.y, -halfSize.z),
        new THREE.Vector3(-halfSize.x, halfSize.y, halfSize.z),
        new THREE.Vector3(halfSize.x, -halfSize.y, -halfSize.z),
        new THREE.Vector3(halfSize.x, -halfSize.y, halfSize.z),
        new THREE.Vector3(halfSize.x, halfSize.y, -halfSize.z),
        new THREE.Vector3(halfSize.x, halfSize.y, halfSize.z),
      ];

      const aspect = width / height;

      // Render each view
      for (const view of views) {
        const viewConfig = VIEW_CONFIGS[view] || VIEW_CONFIGS.perspective;
        let camera;

        if (viewConfig.type === 'ortho') {
          // === ORTHOGRAPHIC VIEW ===
          const viewDir = new THREE.Vector3(...viewConfig.direction).normalize();
          const upDir = new THREE.Vector3(...viewConfig.up);

          const rightDir = new THREE.Vector3().crossVectors(viewDir, upDir).normalize();
          const adjustedUp = new THREE.Vector3().crossVectors(rightDir, viewDir).normalize();

          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          let minZ = Infinity, maxZ = -Infinity;

          for (const corner of boxCorners) {
            const camX = corner.dot(rightDir);
            const camY = corner.dot(adjustedUp);
            const camZ = corner.dot(viewDir);
            minX = Math.min(minX, camX); maxX = Math.max(maxX, camX);
            minY = Math.min(minY, camY); maxY = Math.max(maxY, camY);
            minZ = Math.min(minZ, camZ); maxZ = Math.max(maxZ, camZ);
          }

          const bboxWidth = maxX - minX;
          const bboxHeight = maxY - minY;
          const bboxCenterX = (minX + maxX) / 2;
          const bboxCenterY = (minY + maxY) / 2;

          let frustumHalfWidth, frustumHalfHeight;
          if (bboxWidth / bboxHeight > aspect) {
            frustumHalfWidth = bboxWidth / 2;
            frustumHalfHeight = frustumHalfWidth / aspect;
          } else {
            frustumHalfHeight = bboxHeight / 2;
            frustumHalfWidth = frustumHalfHeight * aspect;
          }

          const margin = 1.05;
          frustumHalfWidth *= margin;
          frustumHalfHeight *= margin;

          camera = new THREE.OrthographicCamera(
            -frustumHalfWidth, frustumHalfWidth,
            frustumHalfHeight, -frustumHalfHeight,
            0.1, maxZ - minZ + 100
          );

          const cameraDistance = -minZ + 10;
          camera.position.copy(viewDir.clone().multiplyScalar(cameraDistance));
          camera.position.add(rightDir.clone().multiplyScalar(bboxCenterX));
          camera.position.add(adjustedUp.clone().multiplyScalar(bboxCenterY));
          camera.up.copy(adjustedUp);
          camera.lookAt(camera.position.clone().sub(viewDir));

        } else {
          // === PERSPECTIVE VIEW ===
          const fov = 45;
          const fovRad = (fov * Math.PI) / 180;

          const viewDir = new THREE.Vector3(...viewConfig.direction).normalize();
          const upDir = new THREE.Vector3(...viewConfig.up);
          const rightDir = new THREE.Vector3().crossVectors(viewDir, upDir).normalize();
          const adjustedUp = new THREE.Vector3().crossVectors(rightDir, viewDir).normalize();

          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          let maxDepth = -Infinity;

          for (const corner of boxCorners) {
            const camX = corner.dot(rightDir);
            const camY = corner.dot(adjustedUp);
            const camZ = corner.dot(viewDir);
            minX = Math.min(minX, camX); maxX = Math.max(maxX, camX);
            minY = Math.min(minY, camY); maxY = Math.max(maxY, camY);
            maxDepth = Math.max(maxDepth, camZ);
          }

          const bboxWidthCam = maxX - minX;
          const bboxHeightCam = maxY - minY;
          const bboxCenterX = (minX + maxX) / 2;
          const bboxCenterY = (minY + maxY) / 2;

          const distanceForHeight = (bboxHeightCam / 2) / Math.tan(fovRad / 2);
          const distanceForWidth = (bboxWidthCam / 2) / Math.tan((fovRad * aspect) / 2);
          let optimalDistance = Math.max(distanceForHeight, distanceForWidth);
          optimalDistance = optimalDistance * 1.1 + maxDepth;

          camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, optimalDistance * 10);
          camera.position.copy(viewDir.clone().multiplyScalar(optimalDistance));
          camera.position.add(rightDir.clone().multiplyScalar(bboxCenterX));
          camera.position.add(adjustedUp.clone().multiplyScalar(bboxCenterY));
          camera.up.copy(adjustedUp);
          camera.lookAt(0, 0, 0);
        }

        camera.updateProjectionMatrix();
        renderer.render(scene, camera);

        // Capture as data URL
        const dataUrl = renderer.domElement.toDataURL('image/png');
        window.renderResults.push({ view, dataUrl });
      }

      window.rendersReady = true;
    }

    main().catch(err => {
      console.error('Render error:', err);
      window.rendersReady = true;
    });
  </script>
</body>
</html>`;
}

/**
 * Generate handler for generate_3d_from_image
 */
export function generateGenerate3DFromImageHandler(ctx: ThreeDToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { image_path, output_path, format = 'glb' } = params;

    const fs = await import('fs/promises');
    const pathModule = await import('path');

    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken) {
      return { error: 'REPLICATE_API_TOKEN environment variable is not set' };
    }

    // Resolve paths
    const absoluteImagePath = pathModule.isAbsolute(image_path)
      ? image_path
      : pathModule.join(ctx.projectRoot, image_path);

    const absoluteOutputPath = pathModule.isAbsolute(output_path)
      ? output_path
      : pathModule.join(ctx.projectRoot, output_path);

    // Check image exists
    try {
      await fs.stat(absoluteImagePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Image not found: ${absoluteImagePath}` };
      }
      throw err;
    }

    // Read and encode image
    const imageBuffer = await fs.readFile(absoluteImagePath);
    const base64Image = imageBuffer.toString('base64');
    const ext = pathModule.extname(absoluteImagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    const dataUri = `data:${mimeType};base64,${base64Image}`;

    const startTime = Date.now();

    try {
      // Call Replicate API (Trellis model)
      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // firtoz/trellis for image-to-3D
          version: 'firtoz/trellis',
          input: {
            image: dataUri,
            output_format: format,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { error: `Replicate API error: ${response.status} ${errorText}` };
      }

      const prediction = await response.json() as any;

      // Poll for result
      const result = await pollReplicateResult(prediction.id, apiToken, 300000); // 5 min timeout

      if (result.error) {
        return { error: result.error };
      }

      // Download the model
      const modelUrl = result.output;
      if (!modelUrl) {
        return { error: 'No model URL in response' };
      }

      const modelResponse = await fetch(modelUrl);
      const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());

      // Create output directory and save
      await fs.mkdir(pathModule.dirname(absoluteOutputPath), { recursive: true });
      await fs.writeFile(absoluteOutputPath, modelBuffer);

      return {
        model_path: output_path,
        absolute_path: absoluteOutputPath,
        format,
        processing_time_ms: Date.now() - startTime,
      };
    } catch (err: any) {
      return { error: `Generation failed: ${err.message}` };
    }
  };
}

/**
 * Generate handler for generate_3d_from_text
 */
export function generateGenerate3DFromTextHandler(ctx: ThreeDToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { prompt, output_path, format = 'glb', style = 'stylized' } = params;

    const fs = await import('fs/promises');
    const pathModule = await import('path');

    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken) {
      return { error: 'REPLICATE_API_TOKEN environment variable is not set' };
    }

    const absoluteOutputPath = pathModule.isAbsolute(output_path)
      ? output_path
      : pathModule.join(ctx.projectRoot, output_path);

    const startTime = Date.now();

    try {
      // Enhance prompt based on style
      let enhancedPrompt = prompt;
      if (style === 'realistic') {
        enhancedPrompt = `${prompt}, photorealistic, highly detailed, 4k`;
      } else if (style === 'lowpoly') {
        enhancedPrompt = `${prompt}, low poly style, geometric, simple shapes`;
      } else if (style === 'stylized') {
        enhancedPrompt = `${prompt}, stylized, game asset style`;
      }

      // Call Replicate API (MVDream model)
      const response = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // adirik/mvdream for text-to-3D
          version: 'adirik/mvdream',
          input: {
            prompt: enhancedPrompt,
            output_format: format,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { error: `Replicate API error: ${response.status} ${errorText}` };
      }

      const prediction = await response.json() as any;

      // Poll for result (text-to-3D takes longer)
      const result = await pollReplicateResult(prediction.id, apiToken, 600000); // 10 min timeout

      if (result.error) {
        return { error: result.error };
      }

      // Download the model
      const modelUrl = result.output;
      if (!modelUrl) {
        return { error: 'No model URL in response' };
      }

      const modelResponse = await fetch(modelUrl);
      const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());

      // Create output directory and save
      await fs.mkdir(pathModule.dirname(absoluteOutputPath), { recursive: true });
      await fs.writeFile(absoluteOutputPath, modelBuffer);

      return {
        prompt,
        style,
        model_path: output_path,
        absolute_path: absoluteOutputPath,
        format,
        processing_time_ms: Date.now() - startTime,
      };
    } catch (err: any) {
      return { error: `Generation failed: ${err.message}` };
    }
  };
}

/**
 * Poll Replicate for prediction result
 */
async function pollReplicateResult(
  predictionId: string,
  apiToken: string,
  timeout: number
): Promise<{ output?: string; error?: string }> {
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds

  while (Date.now() - startTime < timeout) {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });

    if (!response.ok) {
      return { error: `Replicate API error: ${response.status}` };
    }

    const prediction = await response.json() as any;

    if (prediction.status === 'succeeded') {
      // Output might be a string URL or an array
      const output = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
      return { output };
    }

    if (prediction.status === 'failed') {
      return { error: prediction.error || 'Prediction failed' };
    }

    if (prediction.status === 'canceled') {
      return { error: 'Prediction was canceled' };
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { error: `Prediction timeout after ${timeout / 1000}s` };
}

// ============================================
// Export All 3D Tools
// ============================================

export interface ThreeDToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all 3D tools with handlers
 */
export function generate3DTools(ctx: ThreeDToolsContext): ThreeDToolsResult {
  return {
    tools: [
      generateRender3DAssetTool(),
      generateGenerate3DFromImageTool(),
      generateGenerate3DFromTextTool(),
    ],
    handlers: {
      render_3d_asset: generateRender3DAssetHandler(ctx),
      generate_3d_from_image: generateGenerate3DFromImageHandler(ctx),
      generate_3d_from_text: generateGenerate3DFromTextHandler(ctx),
    },
  };
}
