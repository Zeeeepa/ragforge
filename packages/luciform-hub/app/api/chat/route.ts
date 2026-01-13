import { NextRequest } from "next/server";

const LUCIE_AGENT_URL =
  process.env.LUCIE_AGENT_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, visitorId } = body;

    if (!message) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!visitorId) {
      return new Response(
        JSON.stringify({ error: "Visitor ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Forward request to Python agent with streaming
    const response = await fetch(`${LUCIE_AGENT_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        visitor_id: visitorId,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Chat API] Agent error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: `Agent error: ${response.status}` }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream the response back to the client
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (error) {
          console.error("[Chat API] Stream error:", error);
          controller.enqueue(
            encoder.encode(`event: error\ndata: {"error": "Stream interrupted"}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[Chat API] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// Health check endpoint for the agent
export async function GET() {
  try {
    const response = await fetch(`${LUCIE_AGENT_URL}/health`);
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ status: "error", message: "Agent unreachable" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}
