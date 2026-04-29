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

function getAccessToken() {
  return getStoredSession()?.access_token || supabaseAnonKey
}

// Authorization header for hitting our own /api/* endpoints. Pulls a
// fresh JWT via the Supabase client so the token is auto-refreshed.
export async function getAuthHeader() {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) return { Authorization: `Bearer ${token}` }
  } catch {}
  // Fallback to stored session token (still valid most of the time)
  const stored = getStoredSession()?.access_token
  return stored ? { Authorization: `Bearer ${stored}` } : {}
}

// ─── JWT-expired retry layer ─────────────────────────────────────────────
// PostgREST returns 401 with body { code: 'PGRST301', message: 'JWT expired' }
// when the access token has expired but the refresh token is still valid.
// We catch that, refresh the session via Supabase Auth, and retry once.
function isJwtExpired(status, body) {
  if (status !== 401 && status !== 403) return false
  if (!body) return false
  const code = body.code ?? ''
  const msg  = body.message ?? body.error_description ?? body.error ?? ''
  return code === 'PGRST301' || /jwt|expired|invalid token/i.test(String(msg))
}

let refreshInFlight = null
async function refreshAccessToken() {
  // De-duplicate concurrent refresh calls (multiple requests may 401 together).
  if (!refreshInFlight) {
    refreshInFlight = supabase.auth.refreshSession().finally(() => {
      refreshInFlight = null
    })
  }
  const { data, error } = await refreshInFlight
  if (error || !data?.session?.access_token) return null
  return data.session.access_token
}

async function authedFetch(url, init) {
  const send = (token) => fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'apikey':        supabaseAnonKey,
      'Authorization': `Bearer ${token || supabaseAnonKey}`,
    },
  })

  let res = await send(getAccessToken())

  if (res.status === 401 || res.status === 403) {
    // Clone & probe the body for a JWT-expired marker without consuming it.
    const probe = await res.clone().text()
    let parsed = null
    try { parsed = probe ? JSON.parse(probe) : null } catch {}
    if (isJwtExpired(res.status, parsed)) {
      const fresh = await refreshAccessToken()
      if (fresh) {
        console.info('[supabase] JWT expired — session refreshed, retrying request')
        res = await send(fresh)
      } else {
        console.warn('[supabase] JWT expired and refresh failed — user must re-login')
      }
    }
  }

  return res
}

export async function supabaseRest(table, options = {}) {
  const { select = '*', filters = [], method = 'GET', body } = options

  let url = `${supabaseUrl}/rest/v1/${table}`
  const params = []
  if (method === 'GET') params.push(`select=${encodeURIComponent(select)}`)
  filters.forEach(f => params.push(f))
  if (params.length) url += '?' + params.join('&')

  const headers = { 'Content-Type': 'application/json' }
  if (method === 'POST') headers['Prefer'] = 'return=representation'

  const res = await authedFetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { data: Array.isArray(data) ? data : data ? [data] : [], error: res.ok ? null : data }
}

export async function supabasePatch(table, id, body) {
  const url = `${supabaseUrl}/rest/v1/${table}?id=eq.${id}`
  const res = await authedFetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  return { data, error: res.ok ? null : (data ?? { message: `Ошибка ${res.status}` }) }
}

export async function supabaseDelete(table, id) {
  const url = `${supabaseUrl}/rest/v1/${table}?id=eq.${id}`
  const res = await authedFetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })
  if (res.ok) return { error: null }
  let err = null
  try { err = await res.json() } catch {}
  return { error: err ?? { message: `Ошибка ${res.status}` } }
}
