"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  ChatSession,
  ChatMessage,
  SessionMemory,
} from "@/lib/ragforge/agent/types";

const API_BASE = "http://127.0.0.1:6970";

/**
 * Hook pour gérer les sessions de chat via l'API Neo4j
 */
export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Load all sessions
  const loadSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch(`${API_BASE}/chat/conversations`);
      const data = await res.json();

      if (data.success) {
        const loadedSessions: ChatSession[] = (data.conversations || []).map(
          (c: any) => ({
            id: c.id,
            title: c.title || "Sans titre",
            createdAt: c.createdAt || new Date().toISOString(),
            updatedAt: c.updatedAt || new Date().toISOString(),
            messageCount: c.messageCount || 0,
            lastMessage: c.lastMessage,
            isActive: false,
          })
        );

        setSessions(loadedSessions);

        // Auto-select most recent session
        if (loadedSessions.length > 0 && !currentSessionId) {
          const sorted = [...loadedSessions].sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          setCurrentSessionId(sorted[0].id);
        }

        console.log(`[useSessions] ${loadedSessions.length} sessions loaded`);
      }
    } catch (err: any) {
      console.error("[useSessions] Error loading sessions:", err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [currentSessionId]);

  // Create new session
  const createSession = useCallback(async (title?: string): Promise<ChatSession | null> => {
    try {
      // The chat endpoint will create a session automatically when conversationId is not provided
      // But we can also create one explicitly by sending a message
      const newSession: ChatSession = {
        id: `conv-${Date.now()}`,
        title: title || "Nouvelle conversation",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
        isActive: true,
      };

      // We'll create it in Neo4j when the first message is sent
      // For now, just add to local state
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);

      console.log(`[useSessions] Session created: ${newSession.id}`);
      return newSession;
    } catch (err: any) {
      console.error("[useSessions] Error creating session:", err);
      setError(err.message);
      return null;
    }
  }, []);

  // Switch to session
  const switchToSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    console.log(`[useSessions] Switched to session: ${sessionId}`);
  }, []);

  // Delete session
  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`${API_BASE}/chat/conversations/${sessionId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));

        // If deleted current session, switch to another
        if (currentSessionId === sessionId) {
          const remaining = sessions.filter((s) => s.id !== sessionId);
          if (remaining.length > 0) {
            setCurrentSessionId(remaining[0].id);
          } else {
            setCurrentSessionId(null);
          }
        }

        console.log(`[useSessions] Session deleted: ${sessionId}`);
      }
    } catch (err: any) {
      console.error("[useSessions] Error deleting session:", err);
      setError(err.message);
    }
  }, [currentSessionId, sessions]);

  // Rename session
  const renameSession = useCallback((sessionId: string, newTitle: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? { ...s, title: newTitle, updatedAt: new Date().toISOString() }
          : s
      )
    );
    console.log(`[useSessions] Session renamed: ${sessionId} -> "${newTitle}"`);
    // Note: This is local only for now. To persist, we'd need an update endpoint
  }, []);

  // Load messages for a session
  const loadSessionMessages = useCallback(async (
    sessionId: string
  ): Promise<ChatMessage[]> => {
    try {
      const res = await fetch(`${API_BASE}/chat/conversations/${sessionId}`);
      const data = await res.json();

      if (data.success) {
        return (data.messages || []).map((m: any) => ({
          id: m.id,
          sessionId: m.conversationId,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp || new Date().toISOString(),
        }));
      }
      return [];
    } catch (err: any) {
      console.error("[useSessions] Error loading messages:", err);
      return [];
    }
  }, []);

  // Update session stats after message
  const updateSessionStats = useCallback((
    sessionId: string,
    messageCount: number,
    lastMessage?: string
  ) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messageCount,
              lastMessage,
              updatedAt: new Date().toISOString(),
            }
          : s
      )
    );
  }, []);

  // Get current session
  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  return {
    // State
    sessions,
    currentSession,
    currentSessionId,
    isLoading,
    error,

    // Actions
    loadSessions,
    createSession,
    switchToSession,
    deleteSession,
    renameSession,
    loadSessionMessages,
    updateSessionStats,

    // Utils
    hasSessions: sessions.length > 0,
  };
}
