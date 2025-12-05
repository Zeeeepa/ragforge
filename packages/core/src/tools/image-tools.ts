/**
 * Image Tools - Read images with OCR, describe images, list images
 *
 * Uses ragforge-runtime's OCR service for text extraction from images.
 * Supports Gemini Vision and DeepSeek-OCR (via Replicate).
 *
 * @since 2025-12-05
 */

import type { GeneratedToolDefinition } from './types/index.js';

// ============================================
// Tool Definitions
// ============================================

/**
 * Generate read_image tool (OCR - extract text from image)
 */
export function generateReadImageTool(): GeneratedToolDefinition {
  return {
    name: 'read_image',
    description: `Extract text from an image using OCR.

Uses AI vision models (Gemini Vision or DeepSeek-OCR) to extract all text content from an image.
Useful for reading screenshots, scanned documents, diagrams with text, code snippets in images, etc.

Parameters:
- path: Path to image file (absolute or relative to project root)
- provider: OCR provider to use ('gemini' or 'replicate-deepseek', default: auto)

Supported formats: PNG, JPG, JPEG, GIF, WebP, BMP

Example: read_image({ path: "docs/screenshot.png" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to image file (absolute or relative to project root)',
        },
        provider: {
          type: 'string',
          enum: ['gemini', 'replicate-deepseek', 'auto'],
          description: 'OCR provider to use (default: auto - uses first available)',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate describe_image tool (get visual description)
 */
export function generateDescribeImageTool(): GeneratedToolDefinition {
  return {
    name: 'describe_image',
    description: `Get a detailed description of an image's visual content.

Uses AI vision models to analyze and describe what's in the image.
Can answer specific questions about the image if a prompt is provided.

Parameters:
- path: Path to image file (absolute or relative to project root)
- prompt: Custom question or instruction (optional, default: general description)

Example:
  describe_image({ path: "ui-mockup.png" })
  describe_image({ path: "diagram.png", prompt: "What components are shown?" })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to image file (absolute or relative to project root)',
        },
        prompt: {
          type: 'string',
          description: 'Custom question or instruction about the image',
        },
      },
      required: ['path'],
    },
  };
}

/**
 * Generate list_images tool
 */
export function generateListImagesTool(): GeneratedToolDefinition {
  return {
    name: 'list_images',
    description: `List image files in a directory.

Finds all image files (PNG, JPG, JPEG, GIF, WebP, BMP, SVG) in the specified directory.
Can search recursively in subdirectories.

Parameters:
- path: Directory path to search (default: project root)
- recursive: Search subdirectories (default: false)
- pattern: Glob pattern to filter (e.g., "*.png", "screenshot-*")

Example: list_images({ path: "docs/images", recursive: true })`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to search (default: project root)',
        },
        recursive: {
          type: 'boolean',
          description: 'Search subdirectories (default: false)',
        },
        pattern: {
          type: 'string',
          description: 'Glob pattern to filter files',
        },
      },
      required: [],
    },
  };
}

// ============================================
// Handler Generators
// ============================================

export interface ImageToolsContext {
  /** Project root directory (for relative paths) */
  projectRoot: string;
  /** OCR Service instance (from ragforge-runtime) */
  ocrService?: any;
}

/**
 * Generate handler for read_image (OCR)
 */
export function generateReadImageHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: imagePath, provider = 'auto' } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(imagePath)
      ? imagePath
      : pathModule.join(ctx.projectRoot, imagePath);

    // Check file exists
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        return { error: `Path is a directory, not a file: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Image not found: ${absolutePath}` };
      }
      throw err;
    }

    // Check if it's an image
    const ext = pathModule.extname(absolutePath).toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (!imageExtensions.includes(ext)) {
      return { error: `Not a supported image format: ${ext}. Supported: ${imageExtensions.join(', ')}` };
    }

    // Use OCR service if available
    if (ctx.ocrService) {
      // Set provider if specified
      if (provider !== 'auto') {
        ctx.ocrService.setPrimaryProvider(provider);
      }

      const result = await ctx.ocrService.extractText(absolutePath);

      if (result.error) {
        return {
          path: imagePath,
          absolute_path: absolutePath,
          error: result.error,
          provider: result.provider,
        };
      }

      return {
        path: imagePath,
        absolute_path: absolutePath,
        text: result.text,
        provider: result.provider,
        processing_time_ms: result.processingTimeMs,
      };
    }

    // Fallback: try to import OCR service dynamically
    try {
      const { getOCRService } = await import('@luciformresearch/ragforge-runtime');
      const ocrService = getOCRService();

      if (!ocrService.isAvailable()) {
        return {
          error: 'No OCR provider available. Set GEMINI_API_KEY or REPLICATE_API_TOKEN environment variable.',
        };
      }

      if (provider !== 'auto') {
        ocrService.setPrimaryProvider(provider);
      }

      const result = await ocrService.extractText(absolutePath);

      if (result.error) {
        return {
          path: imagePath,
          absolute_path: absolutePath,
          error: result.error,
          provider: result.provider,
        };
      }

      return {
        path: imagePath,
        absolute_path: absolutePath,
        text: result.text,
        provider: result.provider,
        processing_time_ms: result.processingTimeMs,
      };
    } catch (importError: any) {
      return {
        error: `OCR service not available: ${importError.message}. Make sure @luciformresearch/ragforge-runtime is installed.`,
      };
    }
  };
}

/**
 * Generate handler for describe_image
 */
export function generateDescribeImageHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: imagePath, prompt } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(imagePath)
      ? imagePath
      : pathModule.join(ctx.projectRoot, imagePath);

    // Check file exists
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        return { error: `Path is a directory, not a file: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Image not found: ${absolutePath}` };
      }
      throw err;
    }

    // Check if it's an image
    const ext = pathModule.extname(absolutePath).toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    if (!imageExtensions.includes(ext)) {
      return { error: `Not a supported image format: ${ext}. Supported: ${imageExtensions.join(', ')}` };
    }

    // Default prompt for description
    const descriptionPrompt = prompt ||
      'Describe this image in detail. What do you see? Include any text, UI elements, diagrams, or notable features.';

    // Try to use Gemini for description (best at visual understanding)
    try {
      const { getOCRService } = await import('@luciformresearch/ragforge-runtime');
      const ocrService = getOCRService({ primaryProvider: 'gemini' });

      if (!ocrService.isAvailable()) {
        return {
          error: 'No vision provider available. Set GEMINI_API_KEY environment variable.',
        };
      }

      const result = await ocrService.extractText(absolutePath, { prompt: descriptionPrompt });

      if (result.error) {
        return {
          path: imagePath,
          absolute_path: absolutePath,
          error: result.error,
        };
      }

      return {
        path: imagePath,
        absolute_path: absolutePath,
        description: result.text,
        provider: result.provider,
        processing_time_ms: result.processingTimeMs,
      };
    } catch (importError: any) {
      return {
        error: `Vision service not available: ${importError.message}`,
      };
    }
  };
}

/**
 * Generate handler for list_images
 */
export function generateListImagesHandler(ctx: ImageToolsContext): (args: any) => Promise<any> {
  return async (params: any) => {
    const { path: dirPath = '.', recursive = false, pattern } = params;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Resolve path
    const absolutePath = pathModule.isAbsolute(dirPath)
      ? dirPath
      : pathModule.join(ctx.projectRoot, dirPath);

    // Check directory exists
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isDirectory()) {
        return { error: `Path is not a directory: ${absolutePath}` };
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `Directory not found: ${absolutePath}` };
      }
      throw err;
    }

    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
    const images: Array<{ path: string; name: string; size: number }> = [];

    // Helper to check if file matches pattern
    const matchesPattern = (filename: string): boolean => {
      if (!pattern) return true;
      // Simple glob matching (supports * and ?)
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
        'i'
      );
      return regex.test(filename);
    };

    // Recursive directory reader
    const scanDir = async (dir: string, relativeTo: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = pathModule.join(dir, entry.name);
        const relativePath = pathModule.relative(relativeTo, fullPath);

        if (entry.isDirectory() && recursive) {
          await scanDir(fullPath, relativeTo);
        } else if (entry.isFile()) {
          const ext = pathModule.extname(entry.name).toLowerCase();
          if (imageExtensions.includes(ext) && matchesPattern(entry.name)) {
            const stat = await fs.stat(fullPath);
            images.push({
              path: relativePath,
              name: entry.name,
              size: stat.size,
            });
          }
        }
      }
    };

    await scanDir(absolutePath, absolutePath);

    // Sort by name
    images.sort((a, b) => a.name.localeCompare(b.name));

    return {
      directory: dirPath,
      absolute_path: absolutePath,
      recursive,
      pattern: pattern || '*',
      count: images.length,
      images,
    };
  };
}

// ============================================
// Export All Image Tools
// ============================================

export interface ImageToolsResult {
  tools: GeneratedToolDefinition[];
  handlers: Record<string, (args: any) => Promise<any>>;
}

/**
 * Generate all image tools with handlers
 */
export function generateImageTools(ctx: ImageToolsContext): ImageToolsResult {
  return {
    tools: [
      generateReadImageTool(),
      generateDescribeImageTool(),
      generateListImagesTool(),
    ],
    handlers: {
      read_image: generateReadImageHandler(ctx),
      describe_image: generateDescribeImageHandler(ctx),
      list_images: generateListImagesHandler(ctx),
    },
  };
}
