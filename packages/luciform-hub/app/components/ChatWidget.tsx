"use client";

import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { supabase, API_URL, getVisitorToken } from "../../lib/supabase";

// Lucie agent UUID (from migrations/005_seed_lucie_agent.sql)
const LUCIE_AGENT_ID = "00000000-0000-0000-0000-000000000010";

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

// Get/set conversation IDs from localStorage (separate for visitor and user)
function getStoredVisitorConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lucie-visitor-conversation-id");
}

function getStoredUserConversationId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("lucie-user-conversation-id");
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

// User session type
interface UserSession {
  email: string;
  name?: string;
  avatar?: string;
}

export function ChatWidget() {
  // Start closed, then open on desktop after mount (avoids SSR hydration mismatch)
  const [isOpen, setIsOpen] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  // Open chat on desktop after mount
  useEffect(() => {
    if (!hasInitialized) {
      setHasInitialized(true);
      if (window.innerWidth >= 768) {
        setIsOpen(true);
      }
    }
  }, [hasInitialized]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [visitorId, setVisitorId] = useState<string>("");
  const [visitorConversationId, setVisitorConversationId] = useState<string | null>(null);
  const [userConversationId, setUserConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserSession | null>(null);

  // Active conversation based on auth state
  const conversationId = user ? userConversationId : visitorConversationId;
  const setConversationId = user ? setUserConversationId : setVisitorConversationId;
  const [authLoading, setAuthLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastScrollRef = useRef(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const responseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingMessageRef = useRef<{ messageId: string; conversationId: string; sentAt: number } | null>(null);

  // Compute showThinking directly from state - no useEffect needed
  const showThinking = useMemo(() => {
    if (!isLoading) {
      // console.log("[Thinking] isLoading=false, hiding");
      return false;
    }

    // Find the current turn (max turn_index)
    const currentTurn = Math.max(...messages.map((m) => m.turn_index ?? 0), 0);

    // Check if we have an assistant message with content for the CURRENT turn
    const assistantMsgsThisTurn = messages.filter(
      (m) => m.role === "assistant" && m.turn_index === currentTurn
    );
    const hasAssistantContentThisTurn = assistantMsgsThisTurn.some(
      (m) => m.content && m.content.length > 0
    );

    // console.log("[Thinking]", {
    //   isLoading,
    //   currentTurn,
    //   assistantMsgsThisTurn: assistantMsgsThisTurn.map(m => ({ id: m.id, content: m.content?.slice(0, 50), status: m.status })),
    //   hasAssistantContentThisTurn,
    //   result: !hasAssistantContentThisTurn,
    // });

    // Show thinking if loading and no assistant content yet
    return !hasAssistantContentThisTurn;
  }, [isLoading, messages]);

  // Check for existing Supabase session on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          // Invalid refresh token - sign out to clear it
          console.warn("[Auth] Session error, signing out:", error.message);
          await supabase.auth.signOut();
          return;
        }
        if (session?.user) {
          setUser({
            email: session.user.email || "",
            name: session.user.user_metadata?.full_name || session.user.email?.split("@")[0],
            avatar: session.user.user_metadata?.avatar_url,
          });
        }
      } catch (err) {
        console.warn("[Auth] Failed to get session, clearing auth state:", err);
        await supabase.auth.signOut();
      }
    };
    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser({
          email: session.user.email || "",
          name: session.user.user_metadata?.full_name || session.user.email?.split("@")[0],
          avatar: session.user.user_metadata?.avatar_url,
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Track if we've already handled this user's login
  const handledUserRef = useRef<string | null>(null);

  // When user logs in, load their most recent conversation or claim current one
  useEffect(() => {
    const handleUserLogin = async () => {
      if (!user) {
        handledUserRef.current = null; // Reset when logged out
        return;
      }

      // Prevent running multiple times for same user
      if (handledUserRef.current === user.email) {
        return;
      }
      handledUserRef.current = user.email;

      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          console.warn("[Auth] Session error in handleUserLogin:", sessionError.message);
          await supabase.auth.signOut();
          return;
        }
        if (!session?.user?.id) return;

        // First, try to load user's most recent Lucie conversation
        const { data: existingConvs, error: convError } = await supabase
          .from("conversations")
          .select("id")
          .eq("user_id", session.user.id)
          .eq("agent_id", LUCIE_AGENT_ID)
          .order("updated_at", { ascending: false })
          .limit(1);

        console.log("[Auth] Query result:", { existingConvs, convError });

        if (convError) {
          console.error("[Auth] Error fetching user conversations:", convError);
        }

        const existingConv = existingConvs?.[0];
        if (existingConv) {
          // User has existing conversations - load the most recent one
          console.log("[Auth] Loading user's existing conversation:", existingConv.id);
          setUserConversationId(existingConv.id);
          localStorage.setItem("lucie-user-conversation-id", existingConv.id);
          return;
        }

        // No existing conversation - try to claim the current public one
        if (conversationId) {
          const { error } = await supabase
            .from("conversations")
            .update({ user_id: session.user.id })
            .eq("id", conversationId)
            .eq("user_id", "00000000-0000-0000-0000-000000000001");

          if (error) {
            console.log("[Auth] Conversation already claimed or not public:", error.message);
          } else {
            console.log("[Auth] Conversation claimed by user:", session.user.email);
          }
        }
      } catch (err) {
        console.error("[Auth] Error handling user login:", err);
      }
    };

    handleUserLogin();
  }, [user]); // Only trigger on user change, not conversationId

  // Google OAuth login
  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    try {
      // Use dedicated callback page for OAuth redirect
      const redirectUrl = window.location.origin + "/auth/callback";
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
        },
      });
    } catch (err) {
      console.error("Login error:", err);
    } finally {
      setAuthLoading(false);
    }
  };

  // Logout - switch to visitor mode (visitor conversation already loaded)
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    // Clear messages - visitor conversation will auto-load via computed conversationId
    setMessages([]);
  };

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

  // Load visitor's most recent conversation
  const loadVisitorConversation = useCallback(async (vid: string) => {
    try {
      const response = await fetch(
        `${API_URL}/api/public/visitor-conversations?visitor_id=${encodeURIComponent(vid)}&limit=1`,
        { headers: { "X-Visitor-ID": vid } }
      );
      if (response.ok) {
        const convs = await response.json();
        if (convs.length > 0) {
          setVisitorConversationId(convs[0].id);
          localStorage.setItem("lucie-visitor-conversation-id", convs[0].id);
          console.log("[Init] Loaded visitor conversation:", convs[0].id);
        }
      }
    } catch (err) {
      console.warn("[Init] Could not load visitor conversations:", err);
    }
  }, []);

  // Initialize visitor ID and conversation on mount
  useEffect(() => {
    const vid = getVisitorId();
    setVisitorId(vid);

    // Load visitor conversation from localStorage or fetch
    const storedVisitorConvId = getStoredVisitorConversationId();
    if (storedVisitorConvId) {
      setVisitorConversationId(storedVisitorConvId);
    } else if (vid) {
      loadVisitorConversation(vid);
    }

    // Load user conversation from localStorage (will be updated when user logs in)
    const storedUserConvId = getStoredUserConversationId();
    if (storedUserConvId) {
      setUserConversationId(storedUserConvId);
    }
  }, [loadVisitorConversation]);

  // Load existing messages when conversation ID is set
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (conversationId) {
      loadMessages(conversationId);
    }
  }, [conversationId]);

  // Subscribe to Supabase Realtime when conversation exists
  // We use a single supabase client and set auth token for visitors
  useEffect(() => {
    if (!conversationId || !visitorId) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let mounted = true;

    const setupSubscription = async () => {
      // For visitors, set the visitor token on realtime
      // For logged-in users, the supabase client already has the session
      if (!user) {
        const token = await getVisitorToken(visitorId);
        if (token) {
          supabase.realtime.setAuth(token);
          console.log("[Realtime] Set visitor auth token");
        } else {
          console.warn("[Realtime] No visitor token, using anon");
        }
      } else {
        console.log("[Realtime] Using user session");
      }

      // Don't setup if unmounted during async
      if (!mounted) return;

      channel = supabase
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

            // Clear loading when ASSISTANT message is completed WITH CONTENT
            if (
              updatedMessage.role === "assistant" &&
              (updatedMessage.status === "completed" || updatedMessage.status === "failed") &&
              updatedMessage.content &&
              updatedMessage.content.length > 0
            ) {
              // console.log("[setIsLoading] false from Realtime UPDATE (assistant with content)");
              clearResponseTimeout();
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
    };

    setupSubscription();

    return () => {
      mounted = false;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  // Only re-subscribe when conversation changes, NOT on auth state changes
  // The client handles auth internally
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, visitorId]);

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
      const headers: Record<string, string> = {
        "X-Visitor-ID": visitorId,
      };

      // Add auth token for logged-in users
      if (user) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            headers["Authorization"] = `Bearer ${session.access_token}`;
          }
        } catch {
          // Ignore auth errors
        }
      }

      const response = await fetch(
        `${API_URL}/api/public/conversations/${convId}/messages`,
        { headers }
      );
      if (response.ok) {
        const data = await response.json();
        setMessages(sortMessages(data));
      } else if (response.status === 404) {
        // Conversation not found, clear the active one
        if (user) {
          setUserConversationId(null);
          localStorage.removeItem("lucie-user-conversation-id");
        } else {
          setVisitorConversationId(null);
          localStorage.removeItem("lucie-visitor-conversation-id");
        }
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
          // Only look for assistant messages with completed status (messageId is the user message ID)
          const assistantMessage = data.find(
            (m: Message) => m.role === "assistant" && ["completed", "failed"].includes(m.status)
          );

          // Debug logs (uncomment for debugging)
          // console.log("[pollForCompletion] All messages received:", data.map((m: Message) => ({
          //   id: m.id,
          //   role: m.role,
          //   status: m.status,
          //   content: m.content?.slice(0, 100),
          //   contentLength: m.content?.length,
          // })));
          // if (assistantMessage) {
          //   console.log("[pollForCompletion] Found completed assistant message:", {
          //     id: assistantMessage.id,
          //     status: assistantMessage.status,
          //     content: assistantMessage.content?.slice(0, 100),
          //     contentLength: assistantMessage.content?.length,
          //   });
          // }

          // Check if assistant message has actual content
          if (
            assistantMessage &&
            assistantMessage.content &&
            assistantMessage.content.length > 0
          ) {
            // Message is done WITH CONTENT, update state
            setMessages(sortMessages(data));
            // console.log("[setIsLoading] false from pollForCompletion (assistant with content found)");
            clearResponseTimeout();
            setIsLoading(false);
            pollingRef.current = null;
            return; // Stop polling
          }
          // Update messages even if not complete (to show tool calls, etc)
          setMessages(sortMessages(data));
        }
      } catch (err) {
        console.error("Poll error:", err);
      }

      // Continue polling if not complete and under max attempts
      if (!cancelled && attempts < maxAttempts) {
        pollingRef.current = setTimeout(poll, 1000);
      } else if (!cancelled) {
        // console.log("[setIsLoading] false from pollForCompletion (timeout)");
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

  // Report streaming issues to server for debugging
  const reportStreamingIssue = useCallback(async (reason: string) => {
    const pending = pendingMessageRef.current;
    if (!pending) return;

    try {
      await fetch(`${API_URL}/api/public/report-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          visitor_id: visitorId,
          user_email: user?.email || null,
          conversation_id: pending.conversationId,
          message_id: pending.messageId,
          waited_seconds: Math.round((Date.now() - pending.sentAt) / 1000),
        }),
      });
      console.log("[Report] Streaming issue reported:", reason);
    } catch (e) {
      console.warn("[Report] Failed to report issue:", e);
    }
  }, [visitorId, user?.email]);

  // Clear response timeout when response arrives
  const clearResponseTimeout = useCallback(() => {
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
    pendingMessageRef.current = null;
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const messageContent = input.trim();
    setInput("");
    // Refocus input after sending
    setTimeout(() => inputRef.current?.focus(), 0);
    // console.log("[setIsLoading] true from sendMessage");
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
      // Build headers - include auth token if authenticated
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Visitor-ID": visitorId,
      };

      // Add Supabase auth token if user is logged in
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (!sessionError && session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        } else if (sessionError) {
          console.warn("[Auth] Session error, continuing as visitor:", sessionError.message);
          supabase.auth.signOut(); // Clear invalid token
        }
      } catch {
        // Ignore auth errors - continue as visitor
      }
      if (user?.email) {
        headers["X-User-Email"] = user.email;
      }

      const response = await fetch(`${API_URL}/api/public/agents/lucie/chat`, {
        method: "POST",
        headers,
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
        if (user) {
          setUserConversationId(data.conversation_id);
          localStorage.setItem("lucie-user-conversation-id", data.conversation_id);
        } else {
          setVisitorConversationId(data.conversation_id);
          localStorage.setItem("lucie-visitor-conversation-id", data.conversation_id);
        }

        // For first message: poll for completion since Realtime subscription
        // won't be ready yet (race condition)
        pollForCompletion(data.conversation_id, data.message_id);
      }

      // Set up response timeout (60 seconds)
      pendingMessageRef.current = {
        messageId: data.message_id,
        conversationId: data.conversation_id,
        sentAt: Date.now(),
      };
      responseTimeoutRef.current = setTimeout(() => {
        reportStreamingIssue("timeout_60s");
        // Show error to user
        setMessages((prev) => [
          ...prev,
          {
            id: `timeout-${Date.now()}`,
            role: "assistant",
            content: "La réponse met plus de temps que prévu. L'équipe a été notifiée.",
            status: "failed",
            turn_index: optimisticUserMessage.turn_index,
            content_position: null,
            created_at: new Date().toISOString(),
          },
        ]);
        setIsLoading(false);
      }, 60000);

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
      // console.log("[setIsLoading] false from sendMessage (error)");
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
    if (user) {
      setUserConversationId(null);
      localStorage.removeItem("lucie-user-conversation-id");
    } else {
      setVisitorConversationId(null);
      localStorage.removeItem("lucie-visitor-conversation-id");
    }
    setMessages([]);
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

      {/* Chat Panel - always mounted, hidden with CSS to avoid re-render flash */}
      <div className={`${panelClasses} bg-slate-900/95 backdrop-blur-lg rounded-2xl shadow-2xl shadow-black/50 border border-slate-700/50 flex flex-col overflow-hidden transition-all duration-300 ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white font-bold">
              L
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">Lucie Defraiteur</h3>
              <p className="text-xs text-slate-400">AI Developer & Creator of RagForge</p>
            </div>

            {/* Auth button */}
            {user ? (
              <button
                onClick={handleLogout}
                className="p-1 hover:bg-slate-700/50 rounded-full transition-colors"
                title={`Connecté: ${user.email} (cliquer pour déconnecter)`}
              >
                {user.avatar ? (
                  <img
                    src={`${API_URL}/api/proxy/image?url=${encodeURIComponent(user.avatar)}`}
                    alt=""
                    className="w-6 h-6 rounded-full ring-2 ring-green-500"
                  />
                ) : (
                  <span className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-[10px] text-white font-bold">
                    {user.email?.[0]?.toUpperCase() || "?"}
                  </span>
                )}
              </button>
            ) : (
              <button
                onClick={handleGoogleLogin}
                disabled={authLoading}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50"
                title="Se connecter avec Google"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </button>
            )}

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
                type="button"
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
    </>
  );
}
