// Single Vercel function that routes by ?action= or body.action.
// Handles Google Calendar OAuth + event sync.
//
// Required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//               SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL
// Optional env: APP_URL (defaults to deployed Vercel URL)
//
// Actions:
//   GET  ?action=auth-url&user_id=...   → 302 redirect to Google
//   GET  ?action=callback&code=...&state=...  → exchanges code, redirects to /settings
//   GET  ?action=status                  → { connected, email? }
//   POST ?action=disconnect              → removes integration
//   POST ?action=sync-task  { task_id }  → creates/updates GCal event
import { createClient } from '@supabase/supabase-js'

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CAL_API   = 'https://www.googleapis.com/calendar/v3'
const SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email'

function appUrl(req) {
  // Trust APP_URL env first; otherwise reconstruct from request headers.
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '')
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host  = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

function redirectURI(req) {
  return `${appUrl(req)}/api/google-calendar?action=callback`
}

function admin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service role не настроен')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Decode Authorization: Bearer <jwt> → user via Supabase Auth
async function authedUser(req) {
  const auth = req.headers.authorization || ''
  const m = auth.match(/^Bearer (.+)$/)
  if (!m) return null
  const sb = admin()
  const { data, error } = await sb.auth.getUser(m[1])
  if (error || !data?.user) return null
  return data.user
}

// ─── Token refresh ───────────────────────────────────────────────────
async function getValidAccessToken(integration) {
  const buffer = 60 * 1000 // refresh 1 min before expiry
  const expires = integration.expires_at ? new Date(integration.expires_at).getTime() : 0
  if (Date.now() < expires - buffer) return integration.access_token

  // Refresh
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: integration.refresh_token,
      grant_type:    'refresh_token',
    }),
  })
  const tokens = await res.json()
  if (!res.ok || !tokens.access_token) {
    console.error('[gcal] refresh failed:', tokens)
    throw new Error(tokens.error_description || tokens.error || 'Не удалось обновить токен Google')
  }

  const newExpires = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  await admin()
    .from('user_integrations')
    .update({
      access_token: tokens.access_token,
      expires_at:   newExpires,
      updated_at:   new Date().toISOString(),
    })
    .eq('id', integration.id)

  return tokens.access_token
}

// ─── Action handlers ─────────────────────────────────────────────────

async function authUrlAction(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'GOOGLE_CLIENT_ID не настроен на сервере' })
  }
  // SECURITY: state must be derived from a verified JWT, not from
  // the query string. Otherwise attackers can spoof someone else's
  // user_id and end up storing their own Google tokens under that
  // victim's row (the victim's task events would sync to the
  // attacker's calendar).
  const user = await authedUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  redirectURI(req),
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state:         user.id,
  })
  return res.status(200).json({ url: `${GOOGLE_AUTH_URL}?${params}` })
}

async function callbackAction(req, res) {
  const { code, state, error: oauthError } = req.query
  const back = `${appUrl(req)}/settings`

  if (oauthError) {
    res.statusCode = 302
    res.setHeader('Location', `${back}?gcal=error&reason=${encodeURIComponent(oauthError)}`)
    return res.end()
  }
  if (!code || !state) {
    res.statusCode = 302
    res.setHeader('Location', `${back}?gcal=error&reason=missing_code`)
    return res.end()
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectURI(req),
      grant_type:    'authorization_code',
    }),
  })
  const tokens = await tokenRes.json()
  if (!tokenRes.ok || !tokens.access_token) {
    console.error('[gcal] token exchange failed:', tokens)
    res.statusCode = 302
    res.setHeader('Location', `${back}?gcal=error&reason=token_exchange`)
    return res.end()
  }

  // Get user email for display
  let email = null
  try {
    const meRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (meRes.ok) {
      const me = await meRes.json()
      email = me.email
    }
  } catch (err) {
    console.warn('[gcal] userinfo fetch failed:', err)
  }

  // Save to DB
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  const { error } = await admin()
    .from('user_integrations')
    .upsert({
      user_id:       state,
      provider:      'google_calendar',
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at:    expiresAt,
      metadata:      email ? { email } : {},
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,provider' })

  if (error) {
    console.error('[gcal] save tokens failed:', error)
    res.statusCode = 302
    res.setHeader('Location', `${back}?gcal=error&reason=db_save`)
    return res.end()
  }

  res.statusCode = 302
  res.setHeader('Location', `${back}?gcal=connected`)
  res.end()
}

async function statusAction(req, res) {
  const user = await authedUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { data, error } = await admin()
    .from('user_integrations')
    .select('id, expires_at, metadata')
    .eq('user_id', user.id)
    .eq('provider', 'google_calendar')
    .maybeSingle()

  if (error) {
    console.error('[gcal] status query:', error)
    return res.status(500).json({ error: 'Ошибка БД' })
  }

  return res.status(200).json({
    connected: !!data,
    email:     data?.metadata?.email ?? null,
  })
}

async function disconnectAction(req, res) {
  const user = await authedUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const sb = admin()
  // Best-effort revoke at Google before dropping DB row
  const { data: integration } = await sb
    .from('user_integrations')
    .select('access_token')
    .eq('user_id', user.id)
    .eq('provider', 'google_calendar')
    .maybeSingle()
  if (integration?.access_token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${integration.access_token}`, { method: 'POST' })
    } catch (err) {
      console.warn('[gcal] revoke failed (continuing):', err)
    }
  }

  const { error } = await sb
    .from('user_integrations')
    .delete()
    .eq('user_id', user.id)
    .eq('provider', 'google_calendar')

  if (error) {
    console.error('[gcal] disconnect:', error)
    return res.status(500).json({ error: 'Не удалось отключить' })
  }
  return res.status(200).json({ ok: true })
}

// Build a Google Calendar event payload from a task row.
function eventPayloadFromTask(task, projectName, assigneeName) {
  // task.due_date is YYYY-MM-DD (date only). Use all-day event format.
  const dateStr  = task.due_date
  const isoStart = dateStr
  const next = new Date(dateStr + 'T00:00:00')
  next.setDate(next.getDate() + 1)
  const isoEnd = next.toISOString().split('T')[0]

  const isDone = task.status === 'done'
  const summary = isDone ? `[✓] ${task.title}` : task.title

  const descriptionParts = []
  if (assigneeName) descriptionParts.push(`Исполнитель: ${assigneeName}`)
  if (projectName)  descriptionParts.push(`Проект: ${projectName}`)
  descriptionParts.push('— синхронизировано из VoiceTask')

  return {
    summary,
    description: descriptionParts.join('\n'),
    start: { date: isoStart },
    end:   { date: isoEnd },
  }
}

async function syncTaskAction(req, res) {
  const user = await authedUser(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  const { task_id } = req.body ?? {}
  if (!task_id) return res.status(400).json({ error: 'task_id обязателен' })

  const sb = admin()

  // Fetch user's Google integration
  const { data: integration, error: intErr } = await sb
    .from('user_integrations')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'google_calendar')
    .maybeSingle()
  if (intErr || !integration) {
    return res.status(200).json({ skipped: true, reason: 'not_connected' })
  }

  // Fetch task with project + assignee
  const { data: task, error: taskErr } = await sb
    .from('tasks')
    .select('*, projects(name)')
    .eq('id', task_id)
    .single()
  if (taskErr || !task) {
    return res.status(404).json({ error: 'Задача не найдена' })
  }

  // Only sync tasks where user is creator or assignee (matches RLS spirit)
  if (task.created_by !== user.id && task.assignee_id !== user.id) {
    return res.status(403).json({ error: 'Нет доступа к задаче' })
  }

  // No deadline → if event exists, delete it; otherwise skip
  if (!task.due_date) {
    if (task.gcal_event_id) {
      try {
        const accessToken = await getValidAccessToken(integration)
        await fetch(`${GOOGLE_CAL_API}/calendars/primary/events/${task.gcal_event_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      } catch (err) {
        console.warn('[gcal] delete after due_date removal:', err)
      }
      await sb.from('tasks').update({ gcal_event_id: null }).eq('id', task.id)
    }
    return res.status(200).json({ skipped: true, reason: 'no_deadline' })
  }

  // Resolve assignee name (best effort)
  let assigneeName = null
  if (task.assignee_id) {
    const { data: a } = await sb.from('profiles').select('full_name, email').eq('id', task.assignee_id).maybeSingle()
    assigneeName = a?.full_name || a?.email
  }
  const projectName = task.projects?.name ?? null

  let accessToken
  try {
    accessToken = await getValidAccessToken(integration)
  } catch (err) {
    return res.status(401).json({ error: err.message })
  }

  const payload = eventPayloadFromTask(task, projectName, assigneeName)
  let url, method
  if (task.gcal_event_id) {
    url    = `${GOOGLE_CAL_API}/calendars/primary/events/${task.gcal_event_id}`
    method = 'PATCH'
  } else {
    url    = `${GOOGLE_CAL_API}/calendars/primary/events`
    method = 'POST'
  }

  const gRes = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  const gData = await gRes.json()
  if (!gRes.ok) {
    console.error('[gcal] event sync failed:', gData)
    return res.status(502).json({ error: gData?.error?.message ?? 'Ошибка Google Calendar' })
  }

  if (!task.gcal_event_id && gData.id) {
    await sb.from('tasks').update({ gcal_event_id: gData.id }).eq('id', task.id)
  }

  return res.status(200).json({ ok: true, event_id: gData.id })
}

// ─── Router ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const action = (req.query.action || req.body?.action || '').toString()

  try {
    if (req.method === 'GET'  && action === 'auth-url')   return await authUrlAction(req, res)
    if (req.method === 'GET'  && action === 'callback')   return await callbackAction(req, res)
    if (req.method === 'GET'  && action === 'status')     return await statusAction(req, res)
    if (req.method === 'POST' && action === 'disconnect') return await disconnectAction(req, res)
    if (req.method === 'POST' && action === 'sync-task')  return await syncTaskAction(req, res)
    return res.status(400).json({ error: `Неизвестное действие: ${action}` })
  } catch (err) {
    console.error('[gcal] unhandled:', err)
    return res.status(500).json({ error: err.message ?? 'Внутренняя ошибка сервера' })
  }
}
