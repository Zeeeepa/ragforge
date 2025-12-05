# Media Tools - Images & 3D Assets

**Last Updated**: 2025-12-05
**Status**: Implementation Phase
**Author**: Lucie Defraiteur

---

## Overview

RagForge provides media manipulation tools for the code agent, enabling it to:
1. **Read and analyze images** (OCR, visual description)
2. **Render 3D assets** to images (multiple views)
3. **Generate 3D models** from images or text

These tools are designed to help the agent work on visual/3D projects like Three.js applications.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CODE AGENT                               │
│                     (Working on Three.js project)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Uses tools to:                                              │
│  - Analyze existing assets (read_image, describe_image)     │
│  - Preview 3D models (render_3d_asset)                       │
│  - Generate new 3D content (generate_3d_from_*)             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   RAGFORGE MEDIA TOOLS                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  IMAGE TOOLS (ragforge-core)                                │
│  ├── read_image      - OCR text extraction                  │
│  ├── describe_image  - Visual description (Gemini Vision)  │
│  └── list_images     - List image files                     │
│                                                              │
│  3D TOOLS (ragforge-core)                                   │
│  ├── render_3d_asset - Render model to images (Three.js)   │
│  ├── generate_3d_from_image - Image → 3D (Trellis)         │
│  └── generate_3d_from_text  - Text → 3D (MVDream)          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      PROVIDERS                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Vision/OCR:                                                │
│  ├── Gemini Vision (GEMINI_API_KEY)                         │
│  └── DeepSeek-OCR via Replicate (REPLICATE_API_TOKEN)      │
│                                                              │
│  3D Generation:                                             │
│  ├── firtoz/trellis (Image → 3D) - Replicate               │
│  └── adirik/mvdream (Text → 3D) - Replicate                │
│                                                              │
│  3D Rendering:                                              │
│  └── Three.js headless (node with WebGL/canvas)            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Image Tools

### read_image (OCR)

Extract text from images using AI vision models.

```typescript
// Tool definition
{
  name: 'read_image',
  inputSchema: {
    path: string,      // Image file path
    provider?: 'gemini' | 'replicate-deepseek' | 'auto'
  }
}

// Example usage by agent
const result = await tools.read_image({
  path: 'screenshots/error-dialog.png'
});
// Returns: { text: "Error: Connection refused...", provider: "gemini" }
```

**Providers:**
- `gemini` - Gemini Vision (primary, semantic understanding)
- `replicate-deepseek` - DeepSeek-OCR (alternative, 97% accuracy)

### describe_image

Get detailed visual description of an image.

```typescript
{
  name: 'describe_image',
  inputSchema: {
    path: string,      // Image file path
    prompt?: string    // Custom question about the image
  }
}

// Example
const result = await tools.describe_image({
  path: 'assets/character-model.png',
  prompt: 'What style is this character? Describe the colors and features.'
});
```

### list_images

List image files in a directory.

```typescript
{
  name: 'list_images',
  inputSchema: {
    path?: string,     // Directory (default: project root)
    recursive?: boolean,
    pattern?: string   // Glob pattern (e.g., "*.png")
  }
}
```

---

## 3D Tools

### render_3d_asset

Render a 3D model to images from multiple viewpoints using Three.js.

```typescript
{
  name: 'render_3d_asset',
  inputSchema: {
    model_path: string,  // Path to .glb, .gltf, .obj, .fbx
    output_dir: string,  // Where to save rendered images
    views?: string[],    // ['front', 'back', 'left', 'right', 'top', 'bottom', 'perspective']
    width?: number,      // Image width (default: 1024)
    height?: number,     // Image height (default: 1024)
    background?: string  // Background color (default: transparent)
  }
}

// Example
const result = await tools.render_3d_asset({
  model_path: 'assets/models/character.glb',
  output_dir: 'renders/',
  views: ['front', 'left', 'perspective'],
  width: 512,
  height: 512
});
// Returns: {
//   renders: [
//     { view: 'front', path: 'renders/character_front.png' },
//     { view: 'left', path: 'renders/character_left.png' },
//     { view: 'perspective', path: 'renders/character_perspective.png' }
//   ]
// }
```

**Supported formats:**
- `.glb` / `.gltf` (recommended)
- `.obj` + `.mtl`
- `.fbx`

**View presets:**
| View | Camera Position | Description |
|------|-----------------|-------------|
| front | (0, 0, z) | Front face |
| back | (0, 0, -z) | Back face |
| left | (-x, 0, 0) | Left side |
| right | (x, 0, 0) | Right side |
| top | (0, y, 0) | Top-down |
| bottom | (0, -y, 0) | Bottom-up |
| perspective | (x, y, z) | 3/4 view |
| custom | Configurable | User-defined |

### generate_3d_from_image

Generate a 3D model from a reference image using Trellis (Replicate).

```typescript
{
  name: 'generate_3d_from_image',
  inputSchema: {
    image_path: string,    // Input image
    output_path: string,   // Where to save .glb
    format?: 'glb' | 'obj', // Output format (default: glb)
    quality?: 'fast' | 'balanced' | 'high'  // Generation quality
  }
}

// Example
const result = await tools.generate_3d_from_image({
  image_path: 'references/spaceship-concept.png',
  output_path: 'assets/models/spaceship.glb',
  quality: 'balanced'
});
// Returns: { model_path: 'assets/models/spaceship.glb', processing_time_ms: 45000 }
```

**Provider:** `firtoz/trellis` on Replicate
- High-quality image-to-3D
- Good topology for games/WebGL
- Supports PBR textures

### generate_3d_from_text

Generate a 3D model from text description using MVDream (Replicate).

```typescript
{
  name: 'generate_3d_from_text',
  inputSchema: {
    prompt: string,        // Text description
    output_path: string,   // Where to save .glb
    format?: 'glb' | 'obj',
    style?: 'realistic' | 'stylized' | 'lowpoly'
  }
}

// Example
const result = await tools.generate_3d_from_text({
  prompt: 'A medieval castle with towers and a drawbridge, fantasy style',
  output_path: 'assets/models/castle.glb',
  style: 'stylized'
});
```

**Provider:** `adirik/mvdream` on Replicate
- Multi-view diffusion for 3D
- Good for concept art → 3D
- Stylized outputs

---

## Use Case: Three.js Project Development

The agent can use these tools to help develop a Three.js project:

### Workflow Example

```
User: "Create a Three.js scene with a spaceship that the user can orbit around"

Agent:
1. generate_3d_from_text({ prompt: "sci-fi spaceship, sleek design" })
   → Creates assets/models/spaceship.glb

2. render_3d_asset({ model_path: "assets/models/spaceship.glb", views: ["perspective"] })
   → Creates preview image for confirmation

3. describe_image({ path: "renders/spaceship_perspective.png" })
   → "A sleek silver spaceship with angular wings..."

4. Writes Three.js code:
   - Scene setup
   - GLTFLoader for spaceship
   - OrbitControls
   - Lighting

5. User: "The spaceship looks too plain, add some glow effects"

6. Agent modifies code to add:
   - UnrealBloomPass
   - Emissive materials
```

### Project Structure

```
threejs-project/
├── src/
│   ├── main.ts           # Entry point
│   ├── scene.ts          # Scene setup
│   ├── loaders.ts        # Asset loaders
│   └── controls.ts       # Camera controls
├── assets/
│   ├── models/           # 3D models (.glb)
│   └── textures/         # Textures
├── renders/              # Preview renders (from render_3d_asset)
├── references/           # Reference images (for generate_3d_from_image)
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Environment Variables

```bash
# Required for image tools
GEMINI_API_KEY=your-gemini-key

# Required for Replicate-based tools (OCR, 3D generation)
REPLICATE_API_TOKEN=your-replicate-token
```

---

## Implementation Status

| Tool | Status | Provider |
|------|--------|----------|
| read_image | ✅ Done | Gemini / DeepSeek |
| describe_image | ✅ Done | Gemini |
| list_images | ✅ Done | Local |
| render_3d_asset | 🚧 Planned | Three.js headless |
| generate_3d_from_image | 🚧 Planned | Replicate/Trellis |
| generate_3d_from_text | 🚧 Planned | Replicate/MVDream |

---

## Dependencies

### For Image Tools
Already in ragforge-runtime:
- `@google/genai` - Gemini Vision

### For 3D Tools (to add)
```json
{
  "three": "^0.160.0",
  "@types/three": "^0.160.0",
  "canvas": "^2.11.2",
  "gl": "^6.0.2"
}
```

**Playwright** is used for headless rendering (WebGL2 support, batch-optimized via browser contexts).

---

## Future: Playwright for Web Rendering

Playwright can also be leveraged for other code agent capabilities:

- **Screenshot web pages** - Capture rendered HTML/CSS for visual debugging
- **Render React/Vue components** - Generate preview images of UI components
- **PDF generation** - Export pages as PDF
- **Visual regression testing** - Compare rendered outputs
- **Canvas/SVG export** - Capture `<canvas>` or SVG elements as images

This would enable the agent to "see" what the code it writes actually looks like.

```typescript
// Future tool idea: render_component
{
  name: 'render_component',
  inputSchema: {
    entry_point: string,    // Path to component file
    props?: object,         // Props to pass
    viewport?: { width, height },
    output_path: string
  }
}
```

---

## Related Documents

- [HTML-PARSER-DESIGN.md](./HTML-PARSER-DESIGN.md) - WebDocument parsing
- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - Full project context
- [AGENT-TESTING.md](./AGENT-TESTING.md) - Testing the code agent
