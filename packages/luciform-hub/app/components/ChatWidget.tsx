"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  output?: string;
  isLoading?: boolean;
}

// Content block can be text or a tool call
interface ContentBlock {
  type: "text" | "tool";
  text?: string;
  toolCall?: ToolCall;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string; // For user messages and backward compat
  contentBlocks?: ContentBlock[]; // For assistant messages with inline tools
  timestamp: Date;
}

interface RateLimitInfo {
  attempt: number;
  maxAttempts: number;
  delaySeconds: number;
  remainingSeconds: number;
  willFallback?: boolean;
  fallbackModel?: string;
}

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

// Markdown renderer component with syntax highlighting
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match && !className;

          if (isInline) {
            return (
              <code className="bg-slate-700/50 px-1.5 py-0.5 rounded text-cyan-300 text-xs" {...props}>
                {children}
              </code>
            );
          }

          return (
            <SyntaxHighlighter
              style={oneDark}
              language={match?.[1] || "text"}
              PreTag="div"
              customStyle={{
                margin: "0.5rem 0",
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
              }}
            >
              {String(children).replace(/\n$/, "")}
            </SyntaxHighlighter>
          );
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
        },
        h1({ children }) {
          return <h1 className="text-lg font-bold mb-2 text-cyan-300">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="text-base font-bold mb-2 text-cyan-300">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold mb-1 text-cyan-300">{children}</h3>;
        },
        strong({ children }) {
          return <strong className="font-bold text-white">{children}</strong>;
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
              {children}
            </a>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// Tool call display component
function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  return (
    <details className="bg-slate-700/30 rounded-lg overflow-hidden my-2 border border-slate-600/30">
      <summary className="px-3 py-2 cursor-pointer text-xs flex items-center gap-2 hover:bg-slate-700/50">
        {toolCall.isLoading ? (
          <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <span className="text-cyan-400">🔧</span>
        )}
        <span className="font-mono text-cyan-300">{toolCall.name}</span>
        <span className="text-slate-400 truncate flex-1">
          {JSON.stringify(toolCall.args).slice(0, 50)}...
        </span>
      </summary>
      {toolCall.output && (
        <div className="px-3 py-2 bg-slate-900/50 border-t border-slate-600/30 max-h-96 overflow-y-auto">
          <MarkdownContent content={toolCall.output} />
        </div>
      )}
    </details>
  );
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [visitorId, setVisitorId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rateLimitTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize visitor ID on mount
  useEffect(() => {
    setVisitorId(getVisitorId());
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, rateLimit, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Countdown timer for rate limit
  useEffect(() => {
    if (rateLimit && rateLimit.remainingSeconds > 0) {
      rateLimitTimerRef.current = setInterval(() => {
        setRateLimit((prev) => {
          if (!prev || prev.remainingSeconds <= 1) {
            if (rateLimitTimerRef.current) {
              clearInterval(rateLimitTimerRef.current);
            }
            return null;
          }
          return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
        });
      }, 1000);

      return () => {
        if (rateLimitTimerRef.current) {
          clearInterval(rateLimitTimerRef.current);
        }
      };
    }
  }, [rateLimit?.delaySeconds]);

  // Handle rate limit event
  const handleRateLimit = (data: {
    attempt: number;
    maxAttempts: number;
    delaySeconds: number;
    willFallback?: boolean;
    fallbackModel?: string;
  }) => {
    if (rateLimitTimerRef.current) {
      clearInterval(rateLimitTimerRef.current);
    }
    setRateLimit({
      attempt: data.attempt,
      maxAttempts: data.maxAttempts,
      delaySeconds: data.delaySeconds,
      remainingSeconds: data.delaySeconds,
      willFallback: data.willFallback,
      fallbackModel: data.fallbackModel,
    });
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    // Create assistant message placeholder with empty content blocks
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      content: "",
      contentBlocks: [],
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          visitorId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEventType = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7);
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle token events (streaming content)
              if (currentEventType === "token" && data.content) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg && lastMsg.role === "assistant") {
                    const blocks = lastMsg.contentBlocks || [];
                    const lastBlock = blocks[blocks.length - 1];

                    // If last block is text, append to it; otherwise create new text block
                    if (lastBlock && lastBlock.type === "text") {
                      const updatedBlocks = [...blocks];
                      updatedBlocks[updatedBlocks.length - 1] = {
                        ...lastBlock,
                        text: (lastBlock.text || "") + data.content,
                      };
                      return [
                        ...newMessages.slice(0, -1),
                        { ...lastMsg, content: lastMsg.content + data.content, contentBlocks: updatedBlocks }
                      ];
                    } else {
                      // Create new text block
                      return [
                        ...newMessages.slice(0, -1),
                        {
                          ...lastMsg,
                          content: lastMsg.content + data.content,
                          contentBlocks: [...blocks, { type: "text", text: data.content }]
                        }
                      ];
                    }
                  }
                  return prev;
                });
              }

              // Handle tool_start events - insert tool block at current position
              if (currentEventType === "tool_start" && data.name) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg && lastMsg.role === "assistant") {
                    const blocks = lastMsg.contentBlocks || [];
                    const newToolBlock: ContentBlock = {
                      type: "tool",
                      toolCall: {
                        name: data.name,
                        args: data.args || {},
                        isLoading: true,
                      },
                    };
                    return [
                      ...newMessages.slice(0, -1),
                      { ...lastMsg, contentBlocks: [...blocks, newToolBlock] }
                    ];
                  }
                  return prev;
                });
              }

              // Handle tool_end events
              if (currentEventType === "tool_end" && data.name) {
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg && lastMsg.role === "assistant" && lastMsg.contentBlocks) {
                    // Find the matching tool block and update it
                    const updatedBlocks = lastMsg.contentBlocks.map((block) => {
                      if (
                        block.type === "tool" &&
                        block.toolCall?.name === data.name &&
                        block.toolCall?.isLoading
                      ) {
                        return {
                          ...block,
                          toolCall: {
                            ...block.toolCall,
                            output: data.output || "",
                            isLoading: false,
                          },
                        };
                      }
                      return block;
                    });
                    return [
                      ...newMessages.slice(0, -1),
                      { ...lastMsg, contentBlocks: updatedBlocks }
                    ];
                  }
                  return prev;
                });
              }

              // Handle rate_limit events
              if (currentEventType === "rate_limit") {
                handleRateLimit(data);
              }

              if (data.error) {
                setError(data.error);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      setRateLimit(null);
      if (rateLimitTimerRef.current) {
        clearInterval(rateLimitTimerRef.current);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Render message content (either blocks or plain text)
  const renderMessageContent = (msg: Message) => {
    if (msg.role === "user") {
      return <p className="whitespace-pre-wrap text-sm">{msg.content}</p>;
    }

    // For assistant messages, render content blocks in order
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      return (
        <div className="text-sm">
          {msg.contentBlocks.map((block, idx) => {
            if (block.type === "text" && block.text) {
              return <MarkdownContent key={idx} content={block.text} />;
            }
            if (block.type === "tool" && block.toolCall) {
              return <ToolCallBlock key={idx} toolCall={block.toolCall} />;
            }
            return null;
          })}
        </div>
      );
    }

    // Fallback to plain content
    if (msg.content) {
      return <MarkdownContent content={msg.content} />;
    }

    return null;
  };

  // Check if message is empty (for loading indicator)
  const isMessageEmpty = (msg: Message) => {
    if (msg.content) return false;
    if (msg.contentBlocks && msg.contentBlocks.length > 0) return false;
    return true;
  };

  return (
    <>
      {/* Chat Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-cyan-500 hover:bg-cyan-400 shadow-lg shadow-cyan-500/30 hover:shadow-cyan-400/40 transition-all duration-300 flex items-center justify-center group"
        aria-label={isOpen ? "Close chat" : "Chat with Lucie"}
      >
        {isOpen ? (
          <svg
            className="w-6 h-6 text-slate-900"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        ) : (
          <svg
            className="w-6 h-6 text-slate-900"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-48px)] h-[500px] max-h-[calc(100vh-120px)] bg-slate-900/95 backdrop-blur-lg rounded-2xl shadow-2xl shadow-black/50 border border-slate-700/50 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-700/50 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center text-white font-bold">
              L
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-white">Lucie Defraiteur</h3>
              <p className="text-xs text-slate-400">
                AI Developer &amp; Creator of RagForge
              </p>
            </div>
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-400 py-8">
                <p className="mb-2">Bonjour! Je suis Lucie.</p>
                <p className="text-sm">
                  Ask me anything about RagForge, CodeParsers, or my work in AI
                  development.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[90%] rounded-2xl px-4 py-2 ${
                    msg.role === "user"
                      ? "bg-cyan-500 text-slate-900"
                      : "bg-slate-800 text-white"
                  }`}
                >
                  {renderMessageContent(msg)}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && messages.length > 0 && isMessageEmpty(messages[messages.length - 1]) && !rateLimit && (
              <div className="flex justify-start">
                <div className="bg-slate-800 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" />
                      <div
                        className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <div
                        className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </div>
                    <span className="text-slate-400 text-xs">Lucie réfléchit...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Rate limit info box */}
            {rateLimit && (
              <div className={`${rateLimit.willFallback ? 'bg-purple-500/10 border-purple-500/30' : 'bg-amber-500/10 border-amber-500/30'} border rounded-lg p-3 flex items-start gap-3`}>
                <div className="flex-shrink-0 mt-0.5">
                  <svg className={`w-5 h-5 ${rateLimit.willFallback ? 'text-purple-400' : 'text-amber-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`${rateLimit.willFallback ? 'text-purple-300' : 'text-amber-300'} text-sm font-medium`}>
                    {rateLimit.willFallback ? 'Changement de modèle' : 'Limite API atteinte'}
                  </p>
                  <p className="text-slate-400 text-xs mt-1">
                    {rateLimit.willFallback ? (
                      <>Passage à <span className="text-purple-300 font-mono">{rateLimit.fallbackModel}</span> dans <span className="text-purple-300 font-mono">{rateLimit.remainingSeconds}s</span></>
                    ) : (
                      <>Nouvelle tentative dans <span className="text-amber-300 font-mono">{rateLimit.remainingSeconds}s</span>
                      <span className="text-slate-500 ml-2">
                        (essai {rateLimit.attempt}/{rateLimit.maxAttempts})
                      </span></>
                    )}
                  </p>
                  <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${rateLimit.willFallback ? 'bg-purple-400' : 'bg-amber-400'} transition-all duration-1000 ease-linear`}
                      style={{
                        width: `${((rateLimit.delaySeconds - rateLimit.remainingSeconds) / rateLimit.delaySeconds) * 100}%`
                      }}
                    />
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
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
