// Thin client wrapper around /api/google-calendar.
// All sync calls are best-effort — they never throw, only log warnings.
// Failures (no integration, network, expired tokens) shouldn't block
// the main task-creation flow.
import { supabase } from './supabase'

async function authHeader() {
  // Pull a fresh access token from the Supabase client. This auto-refreshes
  // if the JWT is close to expiry.
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function startGoogleCalendarConnect(userId) {
  if (!userId) return
  // Server returns a 302 to Google's OAuth screen — full-page navigation.
  window.location.href = `/api/google-calendar?action=auth-url&user_id=${userId}`
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
    if (!res.ok) console.warn('[gcal] sync-task failed:', data)
    return data
  } catch (err) {
    console.warn('[gcal] sync-task threw:', err)
  }
}
