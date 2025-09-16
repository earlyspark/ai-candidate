import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required')
}

// Require service role key on the server; use anon key in the browser
const isServer = typeof window === 'undefined'
if (isServer && !serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required on the server')
}
if (!isServer && !anonKey) {
  throw new Error('SUPABASE_ANON_KEY is required in the browser')
}

export const supabase = createClient(supabaseUrl, isServer ? (serviceRoleKey as string) : (anonKey as string), {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
})

// Helpful debug (non-sensitive) to verify which client is used at runtime
if (process.env.NODE_ENV !== 'production') {
  if (isServer) {
    console.log('[supabase] Using service role client (server runtime)')
  } else {
    console.log('[supabase] Using anon client (browser runtime)')
  }
}

// Database types
export interface KnowledgeChunk {
  id: number
  content: string
  embedding: number[] | null
  category: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface KnowledgeVersion {
  id: number
  category: string
  content: string
  version: number
  active: boolean
  created_at: string
}

export interface Conversation {
  id: number
  session_id: string
  ip_address: string | null
  messages: { role: string; content: string; timestamp: string }[]
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}
