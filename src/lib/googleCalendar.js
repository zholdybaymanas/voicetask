// Thin client wrapper around /api/google-calendar.
// All sync calls are best-effort — they never throw, only log warnings.
// Failures (no integration, network, expired tokens) shouldn't block
// the main task-creation flow.
import { supabase } from './supabase'
import { emitToast } from '../contexts/ToastContext'

async function authHeader() {
  // Pull a fresh access token from the Supabase client. This auto-refreshes
  // if the JWT is close to expiry.
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function startGoogleCalendarConnect() {
  // Auth-url now requires a valid JWT and derives user_id from it
  // (so attackers can't spoof someone else's user_id via the query).
  // Fetch the URL with auth, then navigate.
  const headers = await authHeader()
  const res = await fetch('/api/google-calendar?action=auth-url', { headers })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  const { url } = await res.json()
  if (url) window.location.href = url
}

export async function getGoogleCalendarStatus() {
  try {
    const headers = await authHeader()
    const res = await fetch('/api/google-calendar?action=status', { headers })
    if (!res.ok) return { connected: false }
    return await res.json()
  } catch (err) {
    console.warn('[gcal] status:', err)
    return { connected: false }
  }
}

export async function disconnectGoogleCalendar() {
  const headers = { ...(await authHeader()), 'Content-Type': 'application/json' }
  const res = await fetch('/api/google-calendar?action=disconnect', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  return res.ok
}

// Best-effort: create or update a Google Calendar event for the task.
// Server will skip if user hasn't connected GCal or task has no due_date.
export async function syncTaskToGoogleCalendar(taskId) {
  if (!taskId) return
  try {
    const headers = { ...(await authHeader()), 'Content-Type': 'application/json' }
    const res = await fetch('/api/google-calendar?action=sync-task', {
      method: 'POST',
      headers,
      body: JSON.stringify({ task_id: taskId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.warn('[gcal] sync-task failed:', data)
      // Surface only when the integration is actively failing — skip the
      // common "not connected" / "no deadline" expected paths.
      if (res.status === 401 || res.status === 502) {
        emitToast(`Google Calendar: ${data.error ?? 'не удалось обновить событие'}`, 'error')
      }
    }
    return data
  } catch (err) {
    console.warn('[gcal] sync-task threw:', err)
  }
}
