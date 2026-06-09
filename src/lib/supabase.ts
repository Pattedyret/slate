import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// True only when both env values are present (set as GitHub Actions secrets for the deployed site,
// or in a local .env for dev). When false, the app renders a setup screen instead of crashing.
export const supabaseConfigured = Boolean(url && key)

// Fall back to harmless placeholders so importing this module never throws when unconfigured.
// The real client is used the moment valid env values exist.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 40 } },
  },
)
