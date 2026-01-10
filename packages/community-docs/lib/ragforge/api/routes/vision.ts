/**
 * Vision API Routes
 *
 * Endpoints for AI-powered visual analysis:
 * - /vision/analyze - Analyze an image or PDF (Tesseract-first for PDFs, fallback to Gemini/Claude)
 * - /vision/render-3d - Render a 3D model to images
 * - /vision/describe-3d - Render + describe a 3D model
 *
 * Uses core handlers directly - no reimplementation!
 *
 * @since 2026-01-07
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  generateAnalyzeVisualHandler,
  generateRender3DAssetHandler,
  generateAnalyze3DModelHandler,
  extractImagesFromDocx,
  extractImagesFromPdf,
  parsePdfWithVision,
  getOCRService,
  type ImageToolsContext,
  type ThreeDToolsContext,
  type EmbeddedImage,
} from "@luciformresearch/ragforge";

// ============================================================================
// Constants
// ============================================================================

const VISION_TEMP_DIR = path.join(os.homedir(), ".ragforge", "temp", "vision");

// ============================================================================
// Schemas
// ============================================================================

const AnalyzeSchema = z.object({
  filePath: z.string().describe("Path to image or PDF/DOCX file"),
  prompt: z.string().optional().describe("Custom prompt for analysis"),
  page: z.number().optional().default(1).describe("Page number for PDFs"),
  provider: z.enum(["gemini", "claude", "replicate-deepseek"]).optional().default("claude").describe("Vision provider (default: claude)"),
  /** Image extraction mode for PDFs/DOCX:
   * - "none": No image extraction, text only
   * - "separate": Images analyzed separately, returned in embeddedImages array
   * - "interleaved": Images analyzed and inserted in text flow with [Figure N: description] markers
   */
  imageMode: z.enum(["none", "separate", "interleaved"]).optional().default("none").describe("Image extraction mode"),
  maxPages: z.number().optional().describe("Max pages to process (for interleaved mode)"),
  /** Output format for interleaved mode */
  outputFormat: z.enum(["text", "markdown"]).optional().default("markdown").describe("Output format"),
  /** Section title generation mode:
   * - "none": No section titles
   * - "auto": Auto-generate as "Section 1", "Section 2", etc.
   * - "detect": Detect real titles using heuristic patterns (I. INTRO, A. Background, etc.)
   */
  sectionTitles: z.enum(["none", "auto", "detect"]).optional().default("detect").describe("Section title generation"),
});

const Render3DSchema = z.object({
  filePath: z.string(),
  views: z.array(z.enum(["front", "back", "left", "right", "top", "bottom", "perspective"]))
    .optional()
    .default(["front", "right", "perspective"]),
  width: z.number().optional().default(512),
  height: z.number().optional().default(512),
  background: z.string().optional().default("#f0f0f0"),
});

const Describe3DSchema = z.object({
  filePath: z.string(),
  views: z.array(z.enum(["front", "back", "left", "right", "top", "bottom", "perspective"]))
    .optional()
    .default(["front", "right", "perspective"]),
});

// ============================================================================
// Helper Functions
// ============================================================================

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerVisionRoutes(server: FastifyInstance) {
  // Create contexts for core handlers
  const threeDCtx: ThreeDToolsContext = { projectRoot: VISION_TEMP_DIR };

  // Get handlers from core (3D handlers don't need provider selection)
  const render3DHandler = generateRender3DAssetHandler(threeDCtx);
  const analyze3DHandler = generateAnalyze3DModelHandler(threeDCtx);

  /**
   * POST /vision/analyze
   *
   * Analyze an image or PDF using core's analyze_visual handler.
   * - For PDFs: tries text extraction first (free), then Tesseract, then Vision provider
   * - For images: uses chosen provider directly (default: claude)
   *
   * Image modes for PDFs/DOCX:
   * - "none": Text only, no image extraction
   * - "separate": Images analyzed separately, returned in embeddedImages array
   * - "interleaved": Images analyzed and inserted in text flow with [Figure N: ...] markers
   */
  server.post<{
    Body: z.infer<typeof AnalyzeSchema>;
  }>("/vision/analyze", async (request: FastifyRequest<{ Body: z.infer<typeof AnalyzeSchema> }>, reply: FastifyReply) => {
    try {
      const validation = AnalyzeSchema.safeParse(request.body);
      if (!validation.success) {
        reply.status(400);
        return { success: false, error: "Invalid request", details: validation.error.errors };
      }

      const { filePath, prompt, page, provider, imageMode, maxPages, outputFormat, sectionTitles } = validation.data;
      const ext = path.extname(filePath).toLowerCase();

      // ========================================================================
      // INTERLEAVED MODE: Use parsePdfWithVision for combined text + images
      // ========================================================================
      if (imageMode === "interleaved" && ext === ".pdf") {
        console.log(`[vision/analyze] Using interleaved mode for PDF with ${provider}, format=${outputFormat}, sections=${sectionTitles}...`);

        const ocrService = getOCRService({ primaryProvider: provider });

        // Vision analyzer callback for parsePdfWithVision
        const visionAnalyzer = async (imageBuffer: Buffer, imagePrompt?: string): Promise<string> => {
          const tempPath = path.join(VISION_TEMP_DIR, `page-${Date.now()}.png`);
          await ensureDir(VISION_TEMP_DIR);
          await fs.writeFile(tempPath, imageBuffer);

          try {
            const result = await ocrService.extractText(tempPath, {
              prompt: imagePrompt || prompt || "Describe this image in detail. What does it show?",
            });
            return result.text || "[No description available]";
          } finally {
            await fs.unlink(tempPath).catch(() => {});
          }
        };

        const result = await parsePdfWithVision(filePath, {
          visionAnalyzer,
          maxPages,
          imagePrompt: prompt,
          includePageSeparators: true,
          figureLabel: "Figure",
          outputFormat: outputFormat as 'text' | 'markdown',
          sectionTitles: sectionTitles as 'none' | 'auto',
          originalFileName: path.basename(filePath),
        });

        return {
          success: true,
          filePath,
          response: result.content,
          provider,
          mode: "interleaved",
          outputFormat,
          pagesProcessed: result.pagesProcessed,
          sectionsExtracted: result.sectionsExtracted,
          imagesAnalyzed: result.imagesAnalyzed,
          processingTimeMs: result.processingTimeMs,
          sections: result.sections,
          figures: result.figures,
        };
      }

      // ========================================================================
      // STANDARD MODE: Use analyze_visual handler for single page/image
      // ========================================================================
      const imageCtx: ImageToolsContext = {
        projectRoot: VISION_TEMP_DIR,
        visionProvider: provider,
      };
      const analyzeVisualHandler = generateAnalyzeVisualHandler(imageCtx);

      const result = await analyzeVisualHandler({
        path: filePath,
        prompt: prompt || "Describe this image in detail. Include what you see, any text present, colors, composition, and notable features.",
        page,
      });

      if (result.error) {
        reply.status(500);
        return { success: false, error: result.error };
      }

      // ========================================================================
      // SEPARATE MODE: Extract and analyze images separately
      // ========================================================================
      let embeddedImageDescriptions: Array<{ name: string; description: string; page?: number }> | undefined;

      if (imageMode === "separate") {
        let embeddedImages: EmbeddedImage[] = [];

        if (ext === '.pdf') {
          embeddedImages = await extractImagesFromPdf(filePath);
        } else if (ext === '.docx') {
          embeddedImages = extractImagesFromDocx(filePath);
        }

        if (embeddedImages.length > 0) {
          console.log(`[vision/analyze] Found ${embeddedImages.length} embedded images, analyzing with ${provider}...`);

          const ocrService = getOCRService({ primaryProvider: provider });
          embeddedImageDescriptions = [];

          for (const img of embeddedImages) {
            try {
              const tempPath = path.join(VISION_TEMP_DIR, `embedded-${Date.now()}-${img.name}`);
              await ensureDir(VISION_TEMP_DIR);
              await fs.writeFile(tempPath, img.data);

              const imgResult = await ocrService.extractText(tempPath, {
                prompt: "Describe this image in detail. What does it show?",
              });

              await fs.unlink(tempPath).catch(() => {});

              if (imgResult.text) {
                embeddedImageDescriptions.push({
                  name: img.name,
                  description: imgResult.text,
                  page: img.page,
                });
              }
            } catch (imgErr: any) {
              console.warn(`[vision/analyze] Failed to analyze embedded image ${img.name}: ${imgErr.message}`);
            }
          }
        }
      }

      return {
        success: true,
        filePath,
        response: result.response,
        provider: result.provider,
        mode: imageMode,
        confidence: result.confidence,
        processingTimeMs: result.processing_time_ms,
        embeddedImages: embeddedImageDescriptions,
      };
    } catch (error: any) {
      console.error(`[vision/analyze] Error: ${error.message}`);
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  /**
   * POST /vision/render-3d
   *
   * Render a 3D model to images from multiple viewpoints.
   */
  server.post<{
    Body: z.infer<typeof Render3DSchema>;
  }>("/vision/render-3d", async (request: FastifyRequest<{ Body: z.infer<typeof Render3DSchema> }>, reply: FastifyReply) => {
    try {
      const validation = Render3DSchema.safeParse(request.body);
      if (!validation.success) {
        reply.status(400);
        return { success: false, error: "Invalid request", details: validation.error.errors };
      }

      const { filePath, views, width, height, background } = validation.data;

      // Create unique output directory
      const outputDir = path.join(VISION_TEMP_DIR, "3d-renders", `render-${Date.now()}`);
      await ensureDir(outputDir);

      // Call core handler
      const result = await render3DHandler({
        model_path: filePath,
        output_dir: outputDir,
        views,
        width,
        height,
        background,
      });

      if (result.error) {
        reply.status(500);
        return { success: false, error: result.error, hint: result.hint };
      }

      return {
        success: true,
        filePath,
        outputDir,
        renders: result.renders || [],
        viewsRendered: views,
      };
    } catch (error: any) {
      console.error(`[vision/render-3d] Error: ${error.message}`);
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  /**
   * POST /vision/describe-3d
   *
   * Render a 3D model and generate AI descriptions for each view.
   * Uses core's analyze_3d_model handler.
   */
  server.post<{
    Body: z.infer<typeof Describe3DSchema>;
  }>("/vision/describe-3d", async (request: FastifyRequest<{ Body: z.infer<typeof Describe3DSchema> }>, reply: FastifyReply) => {
    try {
      const validation = Describe3DSchema.safeParse(request.body);
      if (!validation.success) {
        reply.status(400);
        return { success: false, error: "Invalid request", details: validation.error.errors };
      }

      const { filePath, views } = validation.data;

      // Create unique output directory
      const outputDir = path.join(VISION_TEMP_DIR, "3d-renders", `describe-${Date.now()}`);
      await ensureDir(outputDir);

      // Call core handler
      const result = await analyze3DHandler({
        model_path: filePath,
        output_dir: outputDir,
        views,
      });

      if (result.error) {
        reply.status(500);
        return { success: false, error: result.error, hint: result.hint };
      }

      return {
        success: true,
        filePath,
        outputDir,
        viewsRendered: result.renders?.length || 0,
        viewDescriptions: result.view_descriptions || [],
        globalDescription: result.global_description,
      };
    } catch (error: any) {
      console.error(`[vision/describe-3d] Error: ${error.message}`);
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  console.log("[VisionRoutes] Vision routes registered: /vision/analyze, /vision/render-3d, /vision/describe-3d");
}
