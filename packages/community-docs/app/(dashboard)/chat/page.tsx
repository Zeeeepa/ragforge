"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { SessionSidebar } from "@/components/chat/SessionSidebar";
import { useSessions } from "@/hooks/useSessions";
import type { ChatMessage } from "@/lib/ragforge/agent/types";

const API_BASE = "http://127.0.0.1:6970";

// ============================================================================
// Types
// ============================================================================

interface ToolCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "completed";
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  timestamp?: string;
}

// ============================================================================
// Chat Page Component
// ============================================================================

export default function ChatPage() {
  const {
    sessions,
    currentSession,
    currentSessionId,
    isLoading: sessionsLoading,
    createSession,
    switchToSession,
    deleteSession,
    renameSession,
    loadSessionMessages,
    updateSessionStats,
  } = useSessions();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load messages when session changes
  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const loadMessages = async (sessionId: string) => {
    const loadedMessages = await loadSessionMessages(sessionId);
    setMessages(
      loadedMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }))
    );
  };

  const handleNewChat = async () => {
    const session = await createSession();
    if (session) {
      setMessages([]);
      inputRef.current?.focus();
    }
  };

  const handleSessionSelect = async (sessionId: string) => {
    await switchToSession(sessionId);
    // Close sidebar on mobile
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
    inputRef.current?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Create placeholder for assistant message
    const assistantId = `msg-${Date.now() + 1}`;
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: currentSessionId,
          message: userMessage.content,
          options: { stream: true, maxSteps: 10 },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No reader");

      let buffer = "";
      let newSessionId = currentSessionId;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              const result = handleSSEEvent(event, assistantId);
              if (result?.sessionId) {
                newSessionId = result.sessionId;
              }
            } catch {}
          }
        }
      }

      // Update session stats
      if (newSessionId) {
        updateSessionStats(
          newSessionId,
          messages.length + 2,
          userMessage.content.substring(0, 50)
        );
      }
    } catch (err: any) {
      console.error("Chat error:", err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `Erreur: ${err.message}` }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSSEEvent = useCallback(
    (event: any, assistantId: string): { sessionId?: string } | void => {
      switch (event.type) {
        case "start":
          if (event.conversationId && !currentSessionId) {
            // New session created by the API
            return { sessionId: event.conversationId };
          }
          break;

        case "text-delta":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + event.content }
                : m
            )
          );
          break;

        case "tool-call":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls || []),
                      {
                        id: event.id,
                        name: event.name,
                        args: event.args,
                        status: "pending" as const,
                      },
                    ],
                  }
                : m
            )
          );
          break;

        case "tool-result":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    toolCalls: m.toolCalls?.map((tc) =>
                      tc.id === event.id
                        ? { ...tc, result: event.result, status: "completed" as const }
                        : tc
                    ),
                  }
                : m
            )
          );
          break;

        case "error":
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `Erreur: ${event.error}` }
                : m
            )
          );
          break;
      }
    },
    [currentSessionId]
  );

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-slate-950">
      {/* Session Sidebar */}
      <SessionSidebar
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={handleSessionSelect}
        onSessionCreate={handleNewChat}
        onSessionDelete={deleteSession}
        onSessionRename={renameSession}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        isLoading={sessionsLoading}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-slate-800 bg-slate-900/50 backdrop-blur flex items-center px-4 gap-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors lg:hidden"
          >
            <svg
              className="w-5 h-5 text-slate-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
            </div>
            <div>
              <h1 className="font-semibold text-white">
                {currentSession?.title || "Nouveau chat"}
              </h1>
              <p className="text-xs text-slate-500">
                Agent RagForge - Claude Sonnet
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isLoading ? "bg-yellow-500 animate-pulse" : "bg-green-500"
              }`}
            />
            <span className="text-xs text-slate-500">
              {isLoading ? "Thinking..." : "Ready"}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-4 space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-16">
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-600/20 flex items-center justify-center">
                  <svg
                    className="w-8 h-8 text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-white mb-2">
                  RagForge Chat Agent
                </h2>
                <p className="text-slate-400 max-w-md mx-auto">
                  Posez des questions, ingérez des documents, ou recherchez dans
                  la base de connaissances.
                </p>
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto">
                  <button
                    onClick={() => setInput("Liste les documents disponibles")}
                    className="p-3 text-left bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700 transition-colors"
                  >
                    <span className="text-sm text-slate-300">
                      Lister les documents
                    </span>
                  </button>
                  <button
                    onClick={() => setInput("Recherche des informations sur ")}
                    className="p-3 text-left bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700 transition-colors"
                  >
                    <span className="text-sm text-slate-300">
                      Rechercher
                    </span>
                  </button>
                  <button
                    onClick={() => setInput("Ingère cette URL: ")}
                    className="p-3 text-left bg-slate-800/50 hover:bg-slate-800 rounded-lg border border-slate-700 transition-colors"
                  >
                    <span className="text-sm text-slate-300">
                      Ingérer une URL
                    </span>
                  </button>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-4 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 mt-1">
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                  </div>
                )}

                <div
                  className={`max-w-[80%] ${
                    message.role === "user" ? "order-first" : ""
                  }`}
                >
                  {/* Tool calls */}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mb-3 space-y-2">
                      {message.toolCalls.map((tc) => (
                        <div
                          key={tc.id}
                          className="bg-slate-800/80 border border-slate-700 rounded-lg p-3 text-sm"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                tc.status === "pending"
                                  ? "bg-yellow-500 animate-pulse"
                                  : "bg-green-500"
                              }`}
                            />
                            <span className="font-mono text-blue-400 text-xs">
                              {tc.name}
                            </span>
                          </div>
                          {tc.result != null && (
                            <div className="text-slate-400 text-xs font-mono truncate mt-1">
                              {typeof tc.result === "string"
                                ? tc.result.substring(0, 150)
                                : JSON.stringify(tc.result).substring(0, 150)}
                              {(typeof tc.result === "string"
                                ? tc.result.length
                                : JSON.stringify(tc.result).length) > 150
                                ? "..."
                                : null}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Message bubble */}
                  <div
                    className={`rounded-2xl px-4 py-3 ${
                      message.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-slate-800 text-slate-100 border border-slate-700"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">
                      {message.content ||
                        (isLoading && message.role === "assistant" ? (
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                            <span
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.1s" }}
                            />
                            <span
                              className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                              style={{ animationDelay: "0.2s" }}
                            />
                          </span>
                        ) : null)}
                    </div>
                    {message.timestamp && (
                      <div
                        className={`text-xs mt-2 ${
                          message.role === "user"
                            ? "text-blue-200"
                            : "text-slate-500"
                        }`}
                      >
                        {formatTime(message.timestamp)}
                      </div>
                    )}
                  </div>
                </div>

                {message.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0 mt-1">
                    <svg
                      className="w-4 h-4 text-slate-300"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-slate-800 bg-slate-900/50 backdrop-blur p-4 shrink-0">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="flex gap-3">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Posez votre question..."
                disabled={isLoading}
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 transition-all"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors flex items-center gap-2"
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
                <span className="hidden sm:inline">Envoyer</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
