import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

if (import.meta.env.DEV) {
  if (!supabaseUrl)     console.error('[Supabase] ❌ VITE_SUPABASE_URL не задан в .env')
  if (!supabaseAnonKey) console.error('[Supabase] ❌ VITE_SUPABASE_ANON_KEY не задан в .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession:     true,
    autoRefreshToken:   true,
    detectSessionInUrl: true,
    storage:            window.localStorage,
  },
})

function getStoredSession() {
  try {
    const ref = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
    const raw = localStorage.getItem(`sb-${ref}-auth-token`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function getCurrentUser() {
  return getStoredSession()?.user ?? null
}

export async function supabaseRest(table, options = {}) {
  const { select = '*', filters = [], method = 'GET', body } = options

  const session = getStoredSession()
  const token = session?.access_token || supabaseAnonKey

  let url = `${supabaseUrl}/rest/v1/${table}`
  const params = []
  if (method === 'GET') params.push(`select=${encodeURIComponent(select)}`)
  filters.forEach(f => params.push(f))
  if (params.length) url += '?' + params.join('&')

  const headers = {
    'apikey':        supabaseAnonKey,
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
  }
  if (method === 'POST') headers['Prefer'] = 'return=representation'

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { data: Array.isArray(data) ? data : data ? [data] : [], error: res.ok ? null : data }
}
