import { createClient } from '@supabase/supabase-js'

// Public Supabase instance (via Cloudflare tunnel)
export const supabase = createClient(
  'https://supabase.luciformresearch.com',
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
)

// API URL for chat endpoints
export const API_URL = 'https://lucie-agent.luciformresearch.com'
