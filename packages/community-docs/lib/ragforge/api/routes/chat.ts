/**
 * Chat Route Handler
 *
 * Implements the /chat endpoint using Vercel AI SDK with Claude.
 * Supports streaming responses and multi-step tool execution.
 */

import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { int as neo4jInt } from "neo4j-driver";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

import { createAgentTools, type ToolContext, type SavedAttachment } from "../../agent/tools";
import { buildSystemPrompt } from "../../agent/system-prompt";
import type { CommunityOrchestratorAdapter } from "../../orchestrator-adapter";
import type { Neo4jClient } from "../../neo4j-client";
import { createChatSessionLogger } from "../../chat-session-logger";
import { generateRender3DAssetHandler, type ThreeDToolsContext } from "@luciformresearch/ragforge";

// ============================================================================
// Attachment Handling
// ============================================================================

const ATTACHMENTS_DIR = path.join(os.homedir(), ".ragforge", "temp", "chat-attachments");

async function saveAttachment(
  attachment: { type: string; content: string; filename?: string; mimeType?: string },
  conversationId: string
): Promise<SavedAttachment | null> {
  if (attachment.type !== "file" || !attachment.content) {
    return null;
  }

  try {
    // Create directory
    const dir = path.join(ATTACHMENTS_DIR, conversationId);
    await fs.mkdir(dir, { recursive: true });

    // Generate filename
    const filename = attachment.filename || `attachment-${Date.now()}`;
    const filePath = path.join(dir, filename);

    // Decode base64 and save
    const buffer = Buffer.from(attachment.content, "base64");
    await fs.writeFile(filePath, buffer);

    // Determine file type
    const ext = path.extname(filename).toLowerCase();
    let fileType: SavedAttachment["fileType"] = "other";
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
      fileType = "image";
    } else if (ext === ".pdf") {
      fileType = "pdf";
    } else if ([".glb", ".gltf", ".obj", ".fbx"].includes(ext)) {
      fileType = "3d";
    } else if (ext === ".zip") {
      fileType = "zip";
    } else if ([".md", ".txt", ".json", ".yaml", ".yml", ".csv"].includes(ext)) {
      fileType = "document";
    }

    console.log(`[chat] Saved attachment: ${filePath} (${fileType})`);

    return {
      filename,
      filePath,
      mimeType: attachment.mimeType,
      fileType,
      size: buffer.length,
    };
  } catch (error: any) {
    console.error(`[chat] Failed to save attachment: ${error.message}`);
    return null;
  }
}

/**
 * Render a 3D model to images for multimodal viewing
 * Returns paths to rendered view images
 */
async function render3DToImages(
  modelPath: string,
  outputDir: string
): Promise<{ view: string; path: string }[]> {
  try {
    const ctx: ThreeDToolsContext = {
      projectRoot: outputDir,
    };
    const handler = generateRender3DAssetHandler(ctx);

    const result = await handler({
      model_path: modelPath,
      output_dir: outputDir,
      views: ["front", "perspective"], // Two views for good coverage
      width: 512,
      height: 512,
      background: "#f0f0f0",
    });

    if (result.error) {
      console.error(`[chat] 3D render error: ${result.error}`);
      return [];
    }

    return result.renders || [];
  } catch (error: any) {
    console.error(`[chat] Failed to render 3D model: ${error.message}`);
    return [];
  }
}

// ============================================================================
// Request/Response Schemas
// ============================================================================

const AttachmentSchema = z.object({
  type: z.enum(["file", "url"]),
  content: z.string(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const ChatRequestSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().min(1),
  attachments: z.array(AttachmentSchema).optional(),
  options: z
    .object({
      stream: z.boolean().optional().default(true),
      maxSteps: z.number().optional().default(10),
    })
    .optional(),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ============================================================================
// Simple Conversation Storage (via Neo4j)
// ============================================================================

interface SimpleMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

async function createConversation(neo4j: Neo4jClient, title: string): Promise<string> {
  const id = `conv-${Date.now()}`;
  await neo4j.run(`
    CREATE (c:ChatConversation {
      id: $id,
      title: $title,
      createdAt: datetime(),
      updatedAt: datetime(),
      messageCount: 0
    })
  `, { id, title });
  return id;
}

async function addMessage(
  neo4j: Neo4jClient,
  conversationId: string,
  role: "user" | "assistant",
  content: string
): Promise<SimpleMessage> {
  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await neo4j.run(`
    MATCH (c:ChatConversation {id: $conversationId})
    CREATE (m:ChatMessage {
      id: $msgId,
      conversationId: $conversationId,
      role: $role,
      content: $content,
      timestamp: datetime()
    })
    CREATE (c)-[:HAS_MESSAGE]->(m)
    SET c.updatedAt = datetime(), c.messageCount = c.messageCount + 1
  `, { conversationId, msgId, role, content });

  return {
    id: msgId,
    conversationId,
    role,
    content,
    timestamp: new Date(),
  };
}

async function getMessages(
  neo4j: Neo4jClient,
  conversationId: string,
  limit: number = 50
): Promise<SimpleMessage[]> {
  const result = await neo4j.run(`
    MATCH (c:ChatConversation {id: $conversationId})-[:HAS_MESSAGE]->(m:ChatMessage)
    RETURN m.id AS id, m.conversationId AS conversationId, m.role AS role,
           m.content AS content, m.timestamp AS timestamp
    ORDER BY m.timestamp ASC
    LIMIT $limit
  `, { conversationId, limit: neo4jInt(Math.floor(limit)) });

  return result.records.map((r: any) => ({
    id: r.get("id"),
    conversationId: r.get("conversationId"),
    role: r.get("role"),
    content: r.get("content"),
    timestamp: new Date(r.get("timestamp")),
  }));
}

async function listConversations(
  neo4j: Neo4jClient,
  limit: number = 20
): Promise<any[]> {
  const result = await neo4j.run(`
    MATCH (c:ChatConversation)
    RETURN c.id AS id, c.title AS title, c.messageCount AS messageCount,
           c.createdAt AS createdAt, c.updatedAt AS updatedAt
    ORDER BY c.updatedAt DESC
    LIMIT $limit
  `, { limit: neo4jInt(Math.floor(limit)) });

  return result.records.map((r: any) => ({
    id: r.get("id"),
    title: r.get("title"),
    messageCount: r.get("messageCount")?.toNumber?.() ?? r.get("messageCount") ?? 0,
    createdAt: r.get("createdAt"),
    updatedAt: r.get("updatedAt"),
  }));
}

async function deleteConversation(neo4j: Neo4jClient, conversationId: string): Promise<void> {
  await neo4j.run(`
    MATCH (c:ChatConversation {id: $conversationId})
    OPTIONAL MATCH (c)-[:HAS_MESSAGE]->(m:ChatMessage)
    DETACH DELETE c, m
  `, { conversationId });
}

// ============================================================================
// Route Registration
// ============================================================================

export interface ChatRouteOptions {
  orchestrator: CommunityOrchestratorAdapter;
  neo4j: Neo4jClient;
}

export function registerChatRoutes(
  server: FastifyInstance,
  options: ChatRouteOptions
) {
  const { orchestrator, neo4j } = options;

  /**
   * POST /chat - Main chat endpoint with streaming
   */
  server.post<{
    Body: ChatRequest;
  }>("/chat", async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply) => {
    try {
      // Validate request
      const validationResult = ChatRequestSchema.safeParse(request.body);
      if (!validationResult.success) {
        reply.status(400);
        return {
          success: false,
          error: "Invalid request",
          details: validationResult.error.errors,
        };
      }

      const { message, attachments, options: chatOptions } = validationResult.data;
      let { conversationId } = validationResult.data;
      const stream = chatOptions?.stream ?? true;
      const maxSteps = chatOptions?.maxSteps ?? 10;

      // Create or get conversation
      if (!conversationId) {
        conversationId = await createConversation(
          neo4j,
          message.substring(0, 50) + "..."
        );
        console.log(`[chat] Created new conversation: ${conversationId}`);
      }

      // Store user message
      await addMessage(neo4j, conversationId, "user", message);

      // Get recent messages for context
      const recentMessages = await getMessages(neo4j, conversationId, 10);
      let contextString = "";
      if (recentMessages.length > 1) {
        contextString = "### Recent Conversation\n";
        for (const msg of recentMessages.slice(-10)) {
          contextString += `**${msg.role}**: ${msg.content.substring(0, 500)}\n`;
        }
      }

      // Build system prompt with context
      const systemPrompt = buildSystemPrompt({
        conversationContext: contextString || undefined,
      });

      // Save attachments and build tool context
      const savedAttachments: SavedAttachment[] = [];
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          const saved = await saveAttachment(att, conversationId!);
          if (saved) {
            savedAttachments.push(saved);
          }
        }
      }

      // Create tool context with attachments
      const toolContext: ToolContext = {
        orchestrator,
        neo4j,
        userId: "chat-user",
        categorySlug: "chat",
        attachments: savedAttachments,
      };

      // Create tools
      const tools = createAgentTools(toolContext);

      // Build messages array for the LLM - supports multimodal content
      type MessageContent = string | Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }>;
      let userContent: MessageContent = message;

      // Check for visual attachments (images, PDFs, 3D) to include directly in the message
      const visualAttachments = savedAttachments.filter(
        (a) => a.fileType === "image" || a.fileType === "pdf"
      );
      const threeDAttachments = savedAttachments.filter(
        (a) => a.fileType === "3d"
      );
      const otherAttachments = savedAttachments.filter(
        (a) => a.fileType !== "image" && a.fileType !== "pdf" && a.fileType !== "3d"
      );

      // Render 3D models to images for visualization
      const rendered3DImages: Array<{ filename: string; view: string; imagePath: string }> = [];
      for (const att of threeDAttachments) {
        console.log(`[chat] Rendering 3D model for visualization: ${att.filename}`);
        const renderDir = path.join(ATTACHMENTS_DIR, conversationId!, "3d-renders");
        const renders = await render3DToImages(att.filePath, renderDir);
        for (const r of renders) {
          rendered3DImages.push({
            filename: att.filename,
            view: r.view,
            imagePath: r.path,
          });
        }
      }

      // Build multimodal content if we have any visual content
      const hasVisualContent = visualAttachments.length > 0 || rendered3DImages.length > 0;

      if (hasVisualContent) {
        // Build multimodal message with images
        const contentParts: Array<{ type: "text"; text: string } | { type: "image"; image: string; mimeType?: string }> = [];

        // Add text message first
        contentParts.push({ type: "text", text: message });

        // Add each visual attachment as an image
        for (const att of visualAttachments) {
          try {
            const fileBuffer = await fs.readFile(att.filePath);
            const base64 = fileBuffer.toString("base64");
            const mimeType = att.mimeType || (att.fileType === "pdf" ? "application/pdf" : "image/png");

            contentParts.push({
              type: "image",
              image: base64,
              mimeType,
            });

            console.log(`[chat] Added visual attachment to message: ${att.filename}`);
          } catch (err: any) {
            console.error(`[chat] Failed to read attachment ${att.filename}: ${err.message}`);
          }
        }

        // Add rendered 3D views
        for (const render of rendered3DImages) {
          try {
            const fileBuffer = await fs.readFile(render.imagePath);
            const base64 = fileBuffer.toString("base64");

            // Add label for this view
            contentParts.push({
              type: "text",
              text: `[3D Model: ${render.filename} - ${render.view} view]`,
            });
            contentParts.push({
              type: "image",
              image: base64,
              mimeType: "image/png",
            });

            console.log(`[chat] Added 3D render to message: ${render.filename} (${render.view})`);
          } catch (err: any) {
            console.error(`[chat] Failed to read 3D render ${render.imagePath}: ${err.message}`);
          }
        }

        // Add info about other attachments if any
        if (otherAttachments.length > 0) {
          const otherInfo = otherAttachments
            .map((a) => `[Attached file available: ${a.filename} (${a.fileType}) - use list_attachments to process]`)
            .join("\n");
          contentParts.push({ type: "text", text: otherInfo });
        }

        userContent = contentParts;
      } else if (otherAttachments.length > 0) {
        // Only non-visual attachments
        const attachmentInfo = otherAttachments
          .map((a) => `[Attached file: ${a.filename} (${a.fileType}, ${(a.size / 1024).toFixed(1)} KB) - use list_attachments/ingest_attachment to process]`)
          .join("\n");
        userContent = `${message}\n\n${attachmentInfo}`;
      }

      console.log(
        `[chat] Processing message in conversation ${conversationId}, stream=${stream}, maxSteps=${maxSteps}`
      );

      // Initialize session logger
      const sessionLogger = createChatSessionLogger(conversationId!);
      sessionLogger.setModel("claude-sonnet-4-20250514");
      sessionLogger.setSystemPrompt(systemPrompt);
      // Convert userContent to string for logging (handles multimodal content)
      const userMessageForLog = typeof userContent === "string"
        ? userContent
        : userContent.map(part => part.type === "text" ? part.text : `[${part.type}: ${part.mimeType || "image"}]`).join("\n");
      sessionLogger.setUserMessage(userMessageForLog);
      if (contextString) {
        sessionLogger.setConversationContext(contextString);
      }

      // Check for Anthropic API key
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        reply.status(500);
        return {
          success: false,
          error: "ANTHROPIC_API_KEY not configured",
        };
      }

      if (stream) {
        // Streaming response
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        // Send conversation ID first
        reply.raw.write(
          `data: ${JSON.stringify({ type: "start", conversationId })}\n\n`
        );

        try {
          const result = streamText({
            model: anthropic("claude-sonnet-4-20250514"),
            system: systemPrompt,
            messages: [{ role: "user", content: userContent }],
            tools,
            stopWhen: stepCountIs(maxSteps),
            onStepFinish: async (step) => {
              // Log tool calls
              if (step.toolCalls && step.toolCalls.length > 0) {
                for (const tc of step.toolCalls) {
                  const args = "input" in tc ? tc.input as Record<string, unknown> : undefined;
                  // Log to session logger
                  sessionLogger.startToolCall(tc.toolCallId, tc.toolName, args);
                  // Send SSE event
                  reply.raw.write(
                    `data: ${JSON.stringify({
                      type: "tool-call",
                      id: tc.toolCallId,
                      name: tc.toolName,
                      args,
                    })}\n\n`
                  );
                }
              }

              // Log tool results
              if (step.toolResults && step.toolResults.length > 0) {
                for (const tr of step.toolResults) {
                  const output = "output" in tr ? tr.output : undefined;
                  // Log to session logger
                  sessionLogger.completeToolCall(tr.toolCallId, output);
                  // Send SSE event
                  reply.raw.write(
                    `data: ${JSON.stringify({
                      type: "tool-result",
                      id: tr.toolCallId,
                      name: tr.toolName,
                      result: typeof output === "string" ? output : output,
                    })}\n\n`
                  );
                }
              }
            },
          });

          // Stream text deltas
          for await (const delta of result.textStream) {
            reply.raw.write(
              `data: ${JSON.stringify({ type: "text-delta", content: delta })}\n\n`
            );
          }

          // Get final result
          const fullText = await result.text;
          const usage = await result.usage;
          const finishReason = await result.finishReason;
          const steps = await result.steps;

          // Log to session logger
          sessionLogger.setAssistantResponse(fullText);
          sessionLogger.setFinishReason(finishReason || "unknown");
          sessionLogger.setTotalSteps(steps?.length || 0);
          if (usage) {
            sessionLogger.setUsage({
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            });
          }

          // Store assistant message
          await addMessage(neo4j, conversationId!, "assistant", fullText);

          // Save session log
          await sessionLogger.save();

          // Send finish event
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "finish",
              finishReason,
              usage: {
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
              },
            })}\n\n`
          );

          reply.raw.end();
        } catch (streamError: any) {
          console.error(`[chat] Stream error: ${streamError.message}`);
          sessionLogger.setError(streamError);
          await sessionLogger.save();
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "error",
              error: streamError.message,
            })}\n\n`
          );
          reply.raw.end();
        }
      } else {
        // Non-streaming response
        try {
          const result = streamText({
            model: anthropic("claude-sonnet-4-20250514"),
            system: systemPrompt,
            messages: [{ role: "user", content: userContent }],
            tools,
            stopWhen: stepCountIs(maxSteps),
            onStepFinish: async (step) => {
              // Log tool calls to session logger
              if (step.toolCalls && step.toolCalls.length > 0) {
                for (const tc of step.toolCalls) {
                  const args = "input" in tc ? tc.input as Record<string, unknown> : undefined;
                  sessionLogger.startToolCall(tc.toolCallId, tc.toolName, args);
                }
              }
              if (step.toolResults && step.toolResults.length > 0) {
                for (const tr of step.toolResults) {
                  const output = "output" in tr ? tr.output : undefined;
                  sessionLogger.completeToolCall(tr.toolCallId, output);
                }
              }
            },
          });

          const fullText = await result.text;
          const usage = await result.usage;
          const finishReason = await result.finishReason;
          const steps = await result.steps;

          // Log to session logger
          sessionLogger.setAssistantResponse(fullText);
          sessionLogger.setFinishReason(finishReason || "unknown");
          sessionLogger.setTotalSteps(steps?.length || 0);
          if (usage) {
            sessionLogger.setUsage({
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            });
          }

          // Store assistant message
          await addMessage(neo4j, conversationId!, "assistant", fullText);

          // Save session log
          await sessionLogger.save();

          return {
            success: true,
            conversationId,
            message: fullText,
            usage: {
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
            },
          };
        } catch (llmError: any) {
          console.error(`[chat] LLM error: ${llmError.message}`);
          sessionLogger.setError(llmError);
          await sessionLogger.save();
          reply.status(500);
          return {
            success: false,
            error: llmError.message,
          };
        }
      }
    } catch (error: any) {
      console.error(`[chat] Error: ${error.message}`);
      reply.status(500);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * GET /chat/conversations - List conversations
   */
  server.get<{
    Querystring: { limit?: number };
  }>("/chat/conversations", async (request, reply) => {
    try {
      const { limit = 20 } = request.query;
      const conversations = await listConversations(neo4j, limit);

      return {
        success: true,
        conversations,
        total: conversations.length,
      };
    } catch (error: any) {
      console.error(`[chat/conversations] Error: ${error.message}`);
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  /**
   * GET /chat/conversations/:id - Get conversation with messages
   */
  server.get<{
    Params: { id: string };
    Querystring: { limit?: number };
  }>("/chat/conversations/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const { limit = 50 } = request.query;

      const messages = await getMessages(neo4j, id, limit);

      return {
        success: true,
        conversationId: id,
        messages,
        total: messages.length,
      };
    } catch (error: any) {
      console.error(`[chat/conversations/:id] Error: ${error.message}`);
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  /**
   * DELETE /chat/conversations/:id - Delete conversation
   */
  server.delete<{
    Params: { id: string };
  }>("/chat/conversations/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      await deleteConversation(neo4j, id);

      return {
        success: true,
        deleted: id,
      };
    } catch (error: any) {
      console.error(`[chat/conversations/:id DELETE] Error: ${error.message}`);
      reply.status(500);
      return { success: false, error: error.message };
    }
  });

  console.log("[ChatRoute] Chat routes registered: /chat, /chat/conversations");
}
