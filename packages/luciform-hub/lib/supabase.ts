import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Production Supabase (via Cloudflare tunnel)
const SUPABASE_URL = 'https://supabase.luciformresearch.com'
const SUPABASE_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'

// API URL - use local backend for testing, prod for production
const isLocal = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

export const API_URL = isLocal
  ? 'http://localhost:8001'
  : 'https://lucie-agent.luciformresearch.com'

// Default client (anon key, for fallback)
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Visitor token cache
let visitorToken: string | null = null
let visitorTokenExpiry: number = 0

/**
 * Clear visitor token cache (call when token is invalid)
 */
export function clearVisitorTokenCache() {
  visitorToken = null
  visitorTokenExpiry = 0
  console.log('[Supabase] Cleared visitor token cache')
}

/**
 * Get visitor token for Realtime authentication.
 * Returns null if fetch fails (will use anon).
 */
export async function getVisitorToken(visitorId: string): Promise<string | null> {
  const now = Date.now() / 1000

  // Return cached token if still valid
  if (visitorToken && visitorTokenExpiry > now + 60) {
    return visitorToken
  }

  // Clear expired cache
  if (visitorToken && visitorTokenExpiry <= now + 60) {
    clearVisitorTokenCache()
  }

  try {
    const response = await fetch(`${API_URL}/api/public/visitor-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId }),
    })

    if (!response.ok) {
      console.warn('[Supabase] Failed to get visitor token')
      return null
    }

    const data = await response.json()
    visitorToken = data.access_token
    visitorTokenExpiry = now + data.expires_in
    console.log('[Supabase] Got visitor token')
    return visitorToken
  } catch (error) {
    console.warn('[Supabase] Error getting visitor token:', error)
    return null
  }
}

/**
 * @deprecated Use getVisitorToken + supabase.realtime.setAuth() instead
 */
export async function getAuthenticatedSupabase(visitorId: string): Promise<SupabaseClient> {
  const token = await getVisitorToken(visitorId)
  if (token) {
    // Set the token on the realtime connection
    supabase.realtime.setAuth(token)
    console.log('[Supabase] Set visitor auth on realtime')
  }
  return supabase
}
