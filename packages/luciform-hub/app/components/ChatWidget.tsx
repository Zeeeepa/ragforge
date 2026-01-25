"use client";

import React, { useState, useRef, useEffect, useCallback, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { supabase, API_URL } from "../../lib/supabase";

interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
  result?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "status" | "tool_call" | "thinking";
  content: string;
  status: "pending" | "processing" | "streaming" | "completed" | "failed";
  tool_calls?: ToolCall[] | null;
  turn_index?: number;
  content_position?: number | null; // For interleaving status/tool_call within assistant content
  created_at: string;
}

// Typing animation speed (characters per second)
const TYPING_SPEED = 150;

// Get or create a unique visitor ID (stored in localStorage)
function getVisitorId(): string {
  if (typeof window === "undefined") return "";

  const storageKey = "lucie-visitor-id";
  let visitorId = localStorage.getItem(storageKey);

  if (!visitorId) {
    visitorId = `visitor-${crypto.randomUUID()}`;
    localStorage.setItem(storageKey, visitorId);
  }

  return visitorId;
}

// Get/set conversation ID from localStorage
function getStoredConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lucie-conversation-id");
}

function setStoredConversationId(id: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem("lucie-conversation-id", id);
  }
}

// Simple cyan cursor
const CyanCursor = () => (
  <span className="inline-block w-2 h-[1.1em] ml-0.5 align-middle bg-cyan-400" />
);

// Fast glitching word for streaming
const FastGlitchWord = ({ text }: { text: string }) => {
  const [display, setDisplay] = useState(text);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  useEffect(() => {
    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      if (frame > 3) {
        setDisplay(text);
        clearInterval(interval);
        return;
      }
      setDisplay(
        text
          .split("")
          .map((c, i) => (i >= text.length - 2 && Math.random() > 0.5 ? chars[Math.floor(Math.random() * chars.length)] : c))
          .join("")
      );
    }, 25);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <span className="text-cyan-400" style={{ textShadow: "0 0 8px rgba(34,211,238,0.6)" }}>
      {display}
    </span>
  );
};

// Markdown renderer component with syntax highlighting (memoized to prevent re-renders)
const MarkdownContent = React.memo(function MarkdownContent({
  content,
  showCursor = false,
}: {
  content: string;
  showCursor?: boolean;
}) {
  const CURSOR_MARKER = "█";

  // Process text to replace cursor marker with cursor + glitch last word
  const processChildren = (children: React.ReactNode): React.ReactNode => {
    return React.Children.map(children, (child) => {
      if (typeof child === "string" && showCursor && child.includes(CURSOR_MARKER)) {
        const parts = child.split(CURSOR_MARKER);
        const textBeforeCursor = parts[0];

        // Extract last word to glitch it
        const lastSpaceIndex = textBeforeCursor.lastIndexOf(" ");
        const beforeLastWord = lastSpaceIndex >= 0 ? textBeforeCursor.slice(0, lastSpaceIndex + 1) : "";
        const lastWord = lastSpaceIndex >= 0 ? textBeforeCursor.slice(lastSpaceIndex + 1) : textBeforeCursor;

        return (
          <>
            {beforeLastWord}
            {lastWord && <FastGlitchWord text={lastWord} />}
            <CyanCursor />
            {parts.slice(1).join(CURSOR_MARKER)}
          </>
        );
      }
      return child;
    });
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match && !className;

          if (isInline) {
            return (
              <code className="bg-slate-700/50 px-1.5 py-0.5 rounded text-cyan-300 text-xs break-all" {...props}>
                {processChildren(children)}
              </code>
            );
          }

          return (
            <div className="overflow-x-auto max-w-full">
              <SyntaxHighlighter
                style={oneDark}
                language={match?.[1] || "text"}
                PreTag="div"
                customStyle={{
                  margin: "0.5rem 0",
                  borderRadius: "0.5rem",
                  fontSize: "0.75rem",
                }}
                wrapLongLines={true}
              >
                {String(children).replace(/\n$/, "").replace(CURSOR_MARKER, "")}
              </SyntaxHighlighter>
            </div>
          );
        },
        pre({ children }) {
          return <pre className="overflow-x-auto max-w-full">{children}</pre>;
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0 break-words">{processChildren(children)}</p>;
        },
        li({ children }) {
          return <li>{processChildren(children)}</li>;
        },
        ul({ children }) {
          return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
        },
        h1({ children }) {
          return <h1 className="text-lg font-bold mb-2 text-cyan-300">{processChildren(children)}</h1>;
        },
        h2({ children }) {
          return <h2 className="text-base font-bold mb-2 text-cyan-300">{processChildren(children)}</h2>;
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold mb-1 text-cyan-300">{processChildren(children)}</h3>;
        },
        strong({ children }) {
          return <strong className="font-bold text-white">{processChildren(children)}</strong>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline break-all">
              {processChildren(children)}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

// Streaming text component with letter-by-letter animation
const StreamingText = React.memo(function StreamingText({
  content,
  isStreaming,
  onUpdate,
}: {
  content: string;
  isStreaming: boolean;
  onUpdate?: () => void;
}) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const baseOffsetRef = useRef(0);
  const contentLengthRef = useRef(content.length);
  contentLengthRef.current = content.length;

  // Reset on new message
  useEffect(() => {
    if (content.length === 0) {
      setDisplayedLength(0);
      startTimeRef.current = Date.now();
      baseOffsetRef.current = 0;
    }
  }, [content.length]);

  // Show all when not streaming
  useEffect(() => {
    if (!isStreaming) {
      setDisplayedLength(content.length);
    }
  }, [isStreaming, content.length]);

  // Time-based animation
  useEffect(() => {
    if (!isStreaming) return;

    // Reset timing when streaming starts
    startTimeRef.current = Date.now();
    baseOffsetRef.current = displayedLength;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const expectedChars = Math.floor((elapsed / 1000) * TYPING_SPEED);
      const targetLength = Math.min(baseOffsetRef.current + expectedChars, contentLengthRef.current);

      setDisplayedLength((prev) => (targetLength > prev ? targetLength : prev));
    }, 16); // ~60fps

    return () => clearInterval(interval);
  }, [isStreaming]);

  // Scroll on each update
  useEffect(() => {
    if (isStreaming && onUpdate) {
      onUpdate();
    }
  }, [displayedLength, isStreaming, onUpdate]);

  const displayedContent = content.slice(0, displayedLength);
  const isTyping = isStreaming && displayedLength < content.length;

  // Use a special marker that we'll style as a glitchy cursor
  const CURSOR_MARKER = "█";
  const contentWithCursor = isTyping ? displayedContent + CURSOR_MARKER : displayedContent;

  return <MarkdownContent content={contentWithCursor} showCursor={isTyping} />;
});

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [visitorId, setVisitorId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastScrollRef = useRef(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  const [showThinking, setShowThinking] = useState(false);
  const thinkingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cancel any ongoing polling
  const cancelPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => cancelPolling();
  }, [cancelPolling]);

  // Debounced "thinking" indicator - shows after 1s of no updates while loading
  useEffect(() => {
    // Clear any existing timeout
    if (thinkingTimeoutRef.current) {
      clearTimeout(thinkingTimeoutRef.current);
      thinkingTimeoutRef.current = null;
    }

    // If not loading, hide thinking immediately
    if (!isLoading) {
      setShowThinking(false);
      return;
    }

    // If loading, show thinking after 1 second of no message updates
    thinkingTimeoutRef.current = setTimeout(() => {
      setShowThinking(true);
    }, 1000);

    return () => {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
      }
    };
  }, [isLoading]);

  // On any message change, reset the thinking timer
  useEffect(() => {
    lastUpdateRef.current = Date.now();
    setShowThinking(false);

    // If still loading, restart the 1s timer
    if (isLoading) {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
      }
      thinkingTimeoutRef.current = setTimeout(() => {
        setShowThinking(true);
      }, 1000);
    }
  }, [messages]);

  // Initialize visitor ID and conversation on mount
  useEffect(() => {
    setVisitorId(getVisitorId());
    const storedConvId = getStoredConversationId();
    if (storedConvId) {
      setConversationId(storedConvId);
    }
  }, []);

  // Load existing messages when conversation ID is set
  useEffect(() => {
    if (conversationId && isOpen) {
      loadMessages(conversationId);
    }
  }, [conversationId, isOpen]);

  // Subscribe to Supabase Realtime when conversation exists
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`conversation:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;

          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMessage.id)) {
              return prev;
            }
            // Remove any temporary optimistic message if this is the real user message
            const filtered = newMessage.role === "user"
              ? prev.filter((m) => !m.id.startsWith("temp-"))
              : prev;
            return sortMessages([...filtered, newMessage]);
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updatedMessage = payload.new as Message;
          setMessages((prev) =>
            sortMessages(prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m)))
          );

          // Clear loading when message is completed
          if (updatedMessage.status === "completed" || updatedMessage.status === "failed") {
            setIsLoading(false);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log(`[Realtime] Subscribed to conversation:${conversationId}`);
        } else if (status === "CHANNEL_ERROR") {
          console.error(`[Realtime] Channel error:`, err);
        } else if (status === "TIMED_OUT") {
          console.warn(`[Realtime] Subscription timed out, will retry...`);
        } else if (status === "CLOSED") {
          console.log(`[Realtime] Channel closed`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  const scrollToBottom = useCallback(() => {
    const now = Date.now();
    // Throttle to max once per 50ms
    if (now - lastScrollRef.current < 50) return;
    lastScrollRef.current = now;

    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle Escape key to close/minimize
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isExpanded) {
          setIsExpanded(false);
        } else if (isOpen) {
          setIsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isExpanded]);

  // Re-scroll after expand/collapse transition completes
  useEffect(() => {
    // Wait for CSS transition to finish (300ms) then scroll
    const timeoutId = setTimeout(() => {
      scrollToBottom();
    }, 350);
    return () => clearTimeout(timeoutId);
  }, [isExpanded, scrollToBottom]);

  // Sort messages by turn_index, then created_at
  function sortMessages(msgs: Message[]): Message[] {
    return [...msgs].sort((a, b) => {
      // First sort by turn_index if available
      const turnA = a.turn_index ?? 0;
      const turnB = b.turn_index ?? 0;
      if (turnA !== turnB) return turnA - turnB;

      // Then by created_at
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      if (timeA !== timeB) return timeA - timeB;

      // Same timestamp: user messages come before assistant
      if (a.role === "user" && b.role === "assistant") return -1;
      if (a.role === "assistant" && b.role === "user") return 1;

      // Final tiebreaker: ID for deterministic order
      return a.id.localeCompare(b.id);
    });
  }

  // Types for interleaved rendering
  type RenderItem =
    | { type: "user"; message: Message }
    | { type: "status"; message: Message }
    | { type: "tool_call"; message: Message }
    | { type: "assistant_chunk"; content: string; isLast: boolean; fullMessage: Message };

  /**
   * Build render items for a turn, interleaving status/tool_call messages
   * within the assistant content based on content_position.
   */
  function buildTurnRenderItems(turnMessages: Message[]): RenderItem[] {
    const items: RenderItem[] = [];

    // Separate by role
    const userMsg = turnMessages.find((m) => m.role === "user");
    const assistantMsg = turnMessages.find((m) => m.role === "assistant");
    const statusMsgs = turnMessages.filter((m) => m.role === "status");
    const toolCallMsgs = turnMessages.filter((m) => m.role === "tool_call");

    // Add user message first
    if (userMsg) {
      items.push({ type: "user", message: userMsg });
    }

    // If no assistant message, just add status/tool_calls in order
    if (!assistantMsg) {
      // Sort by content_position or created_at
      const interleaved = [...statusMsgs, ...toolCallMsgs].sort((a, b) => {
        const posA = a.content_position ?? -1;
        const posB = b.content_position ?? -1;
        if (posA !== posB) return posA - posB;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      for (const msg of interleaved) {
        items.push({ type: msg.role as "status" | "tool_call", message: msg });
      }
      return items;
    }

    // Build interleaved content with status/tool_call messages
    const assistantContent = assistantMsg.content || "";

    // Collect all interleave points (status + tool_call with content_position)
    const interleavePoints: { position: number; message: Message }[] = [];
    for (const msg of [...statusMsgs, ...toolCallMsgs]) {
      const pos = msg.content_position;
      if (pos !== null && pos !== undefined && pos >= 0) {
        interleavePoints.push({ position: pos, message: msg });
      } else {
        // No position = show at the beginning (before any content)
        interleavePoints.push({ position: 0, message: msg });
      }
    }

    // Sort by position
    interleavePoints.sort((a, b) => a.position - b.position);

    // Build chunks interleaved with status/tool_call
    let lastPos = 0;
    for (const point of interleavePoints) {
      // Add content chunk before this interleave point (if any new content)
      if (point.position > lastPos) {
        const chunk = assistantContent.slice(lastPos, point.position);
        if (chunk) {
          items.push({
            type: "assistant_chunk",
            content: chunk,
            isLast: false,
            fullMessage: assistantMsg,
          });
        }
      }
      // Add the status/tool_call
      items.push({
        type: point.message.role as "status" | "tool_call",
        message: point.message,
      });
      lastPos = Math.max(lastPos, point.position);
    }

    // Add remaining content after last interleave point
    if (lastPos < assistantContent.length) {
      items.push({
        type: "assistant_chunk",
        content: assistantContent.slice(lastPos),
        isLast: true,
        fullMessage: assistantMsg,
      });
    } else if (interleavePoints.length === 0 && assistantContent) {
      // No interleave points, just show full content
      items.push({
        type: "assistant_chunk",
        content: assistantContent,
        isLast: true,
        fullMessage: assistantMsg,
      });
    }

    return items;
  }

  /**
   * Group messages by turn_index and build render items for each turn.
   */
  function buildAllRenderItems(msgs: Message[]): RenderItem[] {
    // Filter out tool_call and thinking messages (internal use only)
    const visibleMsgs = msgs.filter((m) => !["thinking"].includes(m.role));

    // Group by turn_index
    const turnGroups = new Map<number, Message[]>();
    for (const msg of visibleMsgs) {
      const turn = msg.turn_index ?? 0;
      if (!turnGroups.has(turn)) {
        turnGroups.set(turn, []);
      }
      turnGroups.get(turn)!.push(msg);
    }

    // Sort turns and build render items
    const sortedTurns = Array.from(turnGroups.keys()).sort((a, b) => a - b);
    const allItems: RenderItem[] = [];
    for (const turn of sortedTurns) {
      const turnItems = buildTurnRenderItems(turnGroups.get(turn)!);
      allItems.push(...turnItems);
    }

    return allItems;
  }

  // Load existing messages for a conversation
  async function loadMessages(convId: string) {
    try {
      const response = await fetch(
        `${API_URL}/api/public/conversations/${convId}/messages`,
        {
          headers: { "X-Visitor-ID": visitorId },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setMessages(sortMessages(data));
      } else if (response.status === 404) {
        // Conversation not found, clear it
        setConversationId(null);
        localStorage.removeItem("lucie-conversation-id");
      }
    } catch (err) {
      console.error("Failed to load messages:", err);
    }
  }

  // Poll for message completion (fallback when Realtime subscription isn't ready)
  const pollForCompletion = useCallback((convId: string, messageId: string) => {
    // Cancel any previous polling
    cancelPolling();

    const maxAttempts = 60; // 60 seconds max
    let attempts = 0;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      attempts++;

      try {
        const response = await fetch(
          `${API_URL}/api/public/conversations/${convId}/messages`,
          { headers: { "X-Visitor-ID": visitorId } }
        );
        if (response.ok && !cancelled) {
          const data = await response.json();
          const assistantMessage = data.find(
            (m: Message) => m.id === messageId || (m.role === "assistant" && m.status === "completed")
          );

          if (assistantMessage && ["completed", "failed"].includes(assistantMessage.status)) {
            // Message is done, update state
            setMessages(sortMessages(data));
            setIsLoading(false);
            pollingRef.current = null;
            return; // Stop polling
          }
        }
      } catch (err) {
        console.error("Poll error:", err);
      }

      // Continue polling if not complete and under max attempts
      if (!cancelled && attempts < maxAttempts) {
        pollingRef.current = setTimeout(poll, 1000);
      } else if (!cancelled) {
        setIsLoading(false);
        setError("Response timeout. Please try again.");
        pollingRef.current = null;
      }
    };

    // Start polling after a short delay (give Realtime a chance first)
    pollingRef.current = setTimeout(poll, 2000);

    // Return cleanup function
    return () => {
      cancelled = true;
      cancelPolling();
    };
  }, [visitorId, cancelPolling]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const messageContent = input.trim();
    setInput("");
    setIsLoading(true);
    setError(null);

    // Optimistically add user message (will be replaced by real one via Realtime)
    const maxTurnIndex = messages.reduce((max, m) => Math.max(max, m.turn_index ?? 0), 0);
    const optimisticUserMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: messageContent,
      status: "completed",
      turn_index: maxTurnIndex + 1,
      content_position: 0,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMessage]);

    try {
      const response = await fetch(`${API_URL}/api/public/agents/lucie/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Visitor-ID": visitorId,
        },
        body: JSON.stringify({
          message: messageContent,
          visitor_id: visitorId,
          conversation_id: conversationId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
          const detail = errorData.detail || {};
          if (detail.limit_type === "global") {
            throw new Error("Le service est temporairement indisponible. Réessayez demain.");
          }
          const limitType = detail.limit_type === "hour" ? "horaire" : "journalière";
          const message = detail.message || "Limite de messages atteinte";
          throw new Error(`${message}. Limite ${limitType} atteinte — réessayez plus tard.`);
        }
        throw new Error(errorData.detail || `Error: ${response.status}`);
      }

      const data = await response.json();

      // Store conversation ID for future messages
      if (data.conversation_id && data.conversation_id !== conversationId) {
        setConversationId(data.conversation_id);
        setStoredConversationId(data.conversation_id);

        // For first message: poll for completion since Realtime subscription
        // won't be ready yet (race condition)
        pollForCompletion(data.conversation_id, data.message_id);
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send message";

      // Keep user message and add error response (don't remove optimistic message)
      const errorResponse: Message = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: errorMessage,
        status: "failed",
        turn_index: optimisticUserMessage.turn_index,
        content_position: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorResponse]);
      setError(null); // Don't show banner, error is in the chat
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    localStorage.removeItem("lucie-conversation-id");
  };


  // Panel size classes
  const panelClasses = isExpanded
    ? "fixed inset-4 z-50 h-[calc(100vh-32px)]"
    : "fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-48px)] h-[550px] max-h-[calc(100vh-120px)]";

  return (
    <>
      {/* Chat Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-500 hover:bg-cyan-400 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-400/40 transition-all duration-300 flex items-center justify-center group"
        aria-label={isOpen ? "Close chat" : "Chat with Lucie"}
      >
        {isOpen ? (
          <svg className="w-6 h-6 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-slate-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className={`${panelClasses} bg-slate-900/95 backdrop-blur-lg rounded-2xl shadow-2xl shadow-black/50 border border-slate-700/50 flex flex-col overflow-hidden transition-all duration-300`}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white font-bold">
              L
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">Lucie Defraiteur</h3>
              <p className="text-xs text-slate-400">AI Developer & Creator of RagForge</p>
            </div>

            {/* New conversation button */}
            {messages.length > 0 && (
              <button
                onClick={startNewConversation}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
                title="New conversation"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}

            {/* Expand/collapse button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
              title={isExpanded ? "Minimize" : "Expand"}
            >
              {isExpanded ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0v5m0-5h5M15 15l5 5m0 0v-5m0 5h-5" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
                </svg>
              )}
            </button>

            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>

          {/* Demo mode banner */}
          <div className="px-3 py-1 bg-amber-500/5 border-b border-amber-500/10 flex items-center gap-1.5 text-[10px] text-amber-300/60">
            <span>⚡</span>
            <span>Demo mode — Gemini Flash for cost efficiency. Production uses Gemini Pro.</span>
          </div>

          {/* Messages */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-400 py-8">
                <p className="mb-2">Bonjour! Je suis Lucie.</p>
                <p className="text-sm">
                  Ask me anything about RagForge, CodeParsers, or my work in AI development.
                </p>
              </div>
            )}

            {buildAllRenderItems(messages).map((item, index) => {
              // User messages
              if (item.type === "user") {
                return (
                  <div key={item.message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl px-4 py-2 bg-cyan-500 text-slate-900">
                      <p className="whitespace-pre-wrap text-sm">{item.message.content}</p>
                    </div>
                  </div>
                );
              }

              // Status messages - compact notification style
              if (item.type === "status") {
                return (
                  <div key={item.message.id} className="flex justify-start">
                    <div className="flex items-center gap-2 text-xs text-slate-400 italic px-2 py-1">
                      <span>{item.message.content}</span>
                    </div>
                  </div>
                );
              }

              // Tool call messages - collapsible debug info
              if (item.type === "tool_call") {
                const toolData = (() => {
                  try {
                    return JSON.parse(item.message.content);
                  } catch {
                    return { name: "unknown", args: {}, status: "unknown" };
                  }
                })();
                return (
                  <div key={item.message.id} className="flex justify-start">
                    <div className="flex items-center gap-2 text-xs text-slate-500 px-2 py-1 font-mono">
                      <span className="text-purple-400">⚡</span>
                      <span>{toolData.name}</span>
                      {toolData.status === "pending" && (
                        <span className="text-yellow-400 animate-pulse">⏳</span>
                      )}
                      {toolData.status === "completed" && (
                        <span className="text-green-400">✓</span>
                      )}
                    </div>
                  </div>
                );
              }

              // Assistant content chunks
              if (item.type === "assistant_chunk") {
                const msg = item.fullMessage;
                const isStreaming = msg.status === "streaming" && item.isLast;
                const isFailed = msg.status === "failed";

                if (!item.content && item.isLast) {
                  // Empty content on last chunk = show thinking only if debounced
                  if (!showThinking) return null;
                  return (
                    <div key={`${msg.id}-chunk-${index}`} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl px-4 py-2 bg-slate-800 text-white">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" />
                            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0.1s" }} />
                            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0.2s" }} />
                          </div>
                          <span className="text-slate-400 text-xs">Lucie réfléchit...</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Failed/error message styling
                if (isFailed) {
                  return (
                    <div key={`${msg.id}-chunk-${index}`} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl px-4 py-2 bg-red-900/30 border border-red-500/50 text-red-200">
                        <div className="flex items-start gap-2 text-sm">
                          <span className="text-red-400 mt-0.5">⚠️</span>
                          <div>
                            <p className="font-medium text-red-300 mb-1">Oops, une erreur s'est produite</p>
                            <p className="text-red-200/80">{item.content}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={`${msg.id}-chunk-${index}`} className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl px-4 py-2 bg-slate-800 text-white">
                      <div className="text-sm">
                        <StreamingText
                          content={item.content}
                          isStreaming={isStreaming}
                          onUpdate={scrollToBottom}
                        />
                      </div>
                    </div>
                  </div>
                );
              }

              return null;
            })}

            {/* Show loading indicator after 1s of no updates while loading */}
            {showThinking && (
              <div className="flex justify-start">
                <div className="bg-slate-800 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" />
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0.1s" }} />
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: "0.2s" }} />
                    </div>
                    <span className="text-slate-400 text-xs">Lucie réfléchit...</span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-red-300 text-sm">
                {error}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-4 border-t border-slate-700/50">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-slate-800 text-white rounded-xl px-4 py-2 resize-none outline-none focus:ring-2 focus:ring-cyan-500/50 placeholder:text-slate-500 text-sm"
                rows={1}
                disabled={isLoading}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-900 disabled:text-slate-500 rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
