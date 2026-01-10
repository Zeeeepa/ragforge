/**
 * Authentication Helper
 *
 * Provides unified auth checking with DEBUG_MODE support.
 * When DEBUG_MODE=true in .env, authentication is bypassed.
 */

import { auth } from "@/lib/auth";

/**
 * User info from session or debug mode
 */
export interface AuthUser {
  id: string;
  role?: string;
  username?: string;
  isDebugUser?: boolean;
}

/**
 * Auth result
 */
export interface AuthResult {
  authenticated: boolean;
  user: AuthUser | null;
  error?: string;
}

/**
 * Debug user used when DEBUG_MODE is enabled
 */
const DEBUG_USER: AuthUser = {
  id: "debug-user",
  role: "ADMIN",
  username: "debug",
  isDebugUser: true,
};

/**
 * Check if debug mode is enabled
 */
export function isDebugMode(): boolean {
  return process.env.DEBUG_MODE === "true";
}

/**
 * Get authenticated user or debug user if DEBUG_MODE is enabled
 *
 * @returns Auth result with user info or error
 */
export async function getAuthUser(): Promise<AuthResult> {
  // Check debug mode first
  if (isDebugMode()) {
    return {
      authenticated: true,
      user: DEBUG_USER,
    };
  }

  // Normal auth flow
  try {
    const session = await auth();
    if (!session?.user) {
      return {
        authenticated: false,
        user: null,
        error: "Non autorisé",
      };
    }

    const user = session.user as { id: string; role?: string; name?: string };
    return {
      authenticated: true,
      user: {
        id: user.id,
        role: user.role,
        username: user.name,
        isDebugUser: false,
      },
    };
  } catch (error) {
    return {
      authenticated: false,
      user: null,
      error: "Erreur d'authentification",
    };
  }
}

/**
 * Check if user has write permission
 */
export function hasWritePermission(user: AuthUser | null): boolean {
  if (!user) return false;
  // Debug users always have write permission
  if (user.isDebugUser) return true;
  // READ role cannot write
  return user.role !== "READ";
}

/**
 * Check if user has admin permission
 */
export function hasAdminPermission(user: AuthUser | null): boolean {
  if (!user) return false;
  // Debug users always have admin permission
  if (user.isDebugUser) return true;
  return user.role === "ADMIN";
}
