"use client";

import { useState } from "react";
import type { ChatSession } from "@/lib/ragforge/agent/types";

interface SessionSidebarProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSessionSelect: (sessionId: string) => void;
  onSessionCreate: () => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionRename: (sessionId: string, newTitle: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  isLoading?: boolean;
}

export function SessionSidebar({
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionCreate,
  onSessionDelete,
  onSessionRename,
  isOpen,
  onToggle,
  isLoading = false,
}: SessionSidebarProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const handleRenameStart = (session: ChatSession) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleRenameSave = () => {
    if (editingSessionId && editingTitle.trim()) {
      onSessionRename(editingSessionId, editingTitle.trim());
    }
    setEditingSessionId(null);
    setEditingTitle("");
  };

  const handleRenameCancel = () => {
    setEditingSessionId(null);
    setEditingTitle("");
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (diffDays === 1) {
      return "Hier";
    } else if (diffDays < 7) {
      return `${diffDays}j`;
    } else {
      return date.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
      });
    }
  };

  return (
    <>
      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
        fixed left-0 top-0 h-full w-72 bg-slate-900 border-r border-slate-700 z-50
        transform transition-transform duration-300 ease-in-out flex flex-col
        ${isOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0 lg:static lg:z-auto
      `}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-700 shrink-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Conversations</h2>
            <button
              onClick={onToggle}
              className="lg:hidden text-slate-400 hover:text-white"
            >
              <svg
                className="w-6 h-6"
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
            </button>
          </div>

          {/* New conversation button */}
          <button
            onClick={onSessionCreate}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Nouvelle conversation
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoading ? (
            <div className="text-center text-slate-400 py-8">
              <svg
                className="w-8 h-8 mx-auto mb-3 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <p className="text-sm">Chargement...</p>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center text-slate-400 py-8">
              <svg
                className="w-12 h-12 mx-auto mb-4 opacity-50"
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
              <p>Aucune conversation</p>
              <p className="text-xs mt-1 text-slate-500">
                Cliquez sur le bouton ci-dessus
              </p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`
                  group relative p-3 rounded-lg cursor-pointer transition-all
                  ${
                    session.id === currentSessionId
                      ? "bg-blue-600/20 border border-blue-500/50 text-white"
                      : "bg-slate-800/50 hover:bg-slate-800 text-slate-200 border border-transparent"
                  }
                `}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  onSessionSelect(session.id);
                }}
              >
                {/* Main content */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {editingSessionId === session.id ? (
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={handleRenameSave}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSave();
                          if (e.key === "Escape") handleRenameCancel();
                        }}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <h3 className="text-sm font-medium truncate">
                        {session.title}
                      </h3>
                    )}

                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <span>{formatDate(session.updatedAt)}</span>
                      {session.messageCount > 0 && (
                        <>
                          <span>•</span>
                          <span>{session.messageCount} msg</span>
                        </>
                      )}
                    </div>

                    {session.lastMessage && (
                      <p className="text-xs text-slate-500 mt-1 truncate">
                        {session.lastMessage}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRenameStart(session);
                      }}
                      className="p-1.5 hover:bg-slate-600 rounded text-slate-400 hover:text-white"
                      title="Renommer"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          confirm(
                            "Supprimer cette conversation ?"
                          )
                        ) {
                          onSessionDelete(session.id);
                        }
                      }}
                      className="p-1.5 hover:bg-red-600 rounded text-slate-400 hover:text-white"
                      title="Supprimer"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Active indicator */}
                {session.id === currentSessionId && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-r"></div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer with stats */}
        <div className="p-4 border-t border-slate-700 shrink-0">
          <div className="text-xs text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>Total:</span>
              <span>{sessions.length} conversations</span>
            </div>
            {sessions.length > 0 && (
              <div className="flex justify-between">
                <span>Messages:</span>
                <span>
                  {sessions.reduce((sum, s) => sum + s.messageCount, 0)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
