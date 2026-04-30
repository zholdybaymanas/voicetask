// POST /api/admin
// Body shapes by action:
//   { action: 'createUser',           email, password, full_name, role }
//   { action: 'banUser',              user_id }
//   { action: 'unbanUser',            user_id }
//   { action: 'deleteUser',           user_id }
//   { action: 'updateProjectMembers', project_id, user_ids: [...] }
// AUTH: must be called by an authenticated user with role='admin'
//       (verified via Supabase JWT in Authorization: Bearer header).
// Requires SUPABASE_SERVICE_ROLE_KEY (server-only) for the privileged ops.
//
// banUser/unbanUser/deleteUser refuse to act on the caller themselves —
// no admin can ban or delete their own account through this endpoint.
//
// Note: SMTP / email-invite is intentionally NOT used in v1.0 — the team
// is small (<20 users) and admins share credentials manually. The
// `email` column is still stored in profiles because v1.1 will add
// task-assignment notifications via SMTP (see TODO in handleCreateUser).
import { createClient } from '@supabase/supabase-js'

// Effectively-permanent ban duration for Supabase Auth.
// The API expects a Postgres interval string; "none" lifts an existing ban.
const PERMA_BAN_DURATION = '876000h' // ~100 years

function adminClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Verify the caller via JWT and that they have role='admin'.
// Returns null if unauthenticated or not an admin.
async function requireAdmin(req, sb) {
  const h = req.headers.authorization || ''
  const m = h.match(/^Bearer (.+)$/)
  if (!m) return null
  const { data: userData, error: userErr } = await sb.auth.getUser(m[1])
  if (userErr || !userData?.user) return null
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profile?.role !== 'admin') return null
  return userData.user
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sb = adminClient()
  if (!sb) {
    return res.status(500).json({
      error: 'SUPABASE_SERVICE_ROLE_KEY или SUPABASE_URL не настроены. Добавьте их в .env (локально) или в Environment Variables в Vercel.',
    })
  }

  const caller = await requireAdmin(req, sb)
  if (!caller) {
    return res.status(403).json({ error: 'Доступ только для администраторов' })
  }

  const body = req.body ?? {}
  const { action } = body

  switch (action) {
    case 'createUser':           return handleCreateUser(sb, body, res)
    case 'banUser':              return handleBanUser(sb, body, caller, res)
    case 'unbanUser':            return handleUnbanUser(sb, body, res)
    case 'deleteUser':           return handleDeleteUser(sb, body, caller, res)
    case 'updateProjectMembers': return handleUpdateProjectMembers(sb, body, res)
    default: return res.status(400).json({ error: `Неизвестный action: ${action}` })
  }
}

// ─── createUser ─────────────────────────────────────────────────────────
async function handleCreateUser(sb, { email, password, full_name, role = 'member' }, res) {
  if (!email?.trim())                   return res.status(400).json({ error: 'Укажите email' })
  if (!password || password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' })
  if (!['member', 'manager', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Недопустимая роль' })
  }

  const { data: createData, error: createErr } = await sb.auth.admin.createUser({
    email:         email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name?.trim() || '' },
  })
  if (createErr) {
    console.error('[admin] auth.createUser:', createErr)
    return res.status(400).json({ error: createErr.message })
  }

  const userId = createData.user.id
  const userEmail = createData.user.email
  const trimmedFullName = full_name?.trim() || null

  const { data: profileData, error: profileErr } = await sb
    .from('profiles')
    .upsert({ id: userId, email: userEmail, full_name: trimmedFullName, role }, { onConflict: 'id' })
    .select()
    .single()

  if (profileErr) {
    console.error('[admin] profile upsert error:', profileErr)
    return res.status(200).json({
      id: userId, email: userEmail, full_name: trimmedFullName, role,
      warning: `Пользователь создан, но профиль не сохранён: ${profileErr.message}`,
    })
  }

  // TODO v1.1: sendTaskNotification(userEmail, ...) — once SMTP is wired
  // up we'll send a "Welcome / your account is ready" email here, plus
  // notifications when a task is assigned to this user. The `email`
  // column on profiles exists specifically to support this.

  return res.status(200).json({
    id:        userId,
    email:     userEmail,
    full_name: profileData?.full_name ?? trimmedFullName,
    role:      profileData?.role ?? role,
  })
}

// ─── banUser / unbanUser ────────────────────────────────────────────────
async function handleBanUser(sb, { user_id }, caller, res) {
  if (!user_id) return res.status(400).json({ error: 'Не указан user_id' })
  if (user_id === caller.id) return res.status(400).json({ error: 'Нельзя заблокировать себя' })

  const { error } = await sb.auth.admin.updateUserById(user_id, { ban_duration: PERMA_BAN_DURATION })
  if (error) {
    console.error('[admin] banUser auth:', error)
    return res.status(400).json({ error: error.message })
  }
  // Mirror the ban into profiles so the UI can render a badge without an
  // extra round-trip to Auth.
  const bannedUntil = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
  const { error: profErr } = await sb.from('profiles').update({ banned_until: bannedUntil }).eq('id', user_id)
  if (profErr) console.warn('[admin] banUser profile sync:', profErr)
  return res.status(200).json({ id: user_id, banned_until: bannedUntil })
}

async function handleUnbanUser(sb, { user_id }, res) {
  if (!user_id) return res.status(400).json({ error: 'Не указан user_id' })
  const { error } = await sb.auth.admin.updateUserById(user_id, { ban_duration: 'none' })
  if (error) {
    console.error('[admin] unbanUser auth:', error)
    return res.status(400).json({ error: error.message })
  }
  const { error: profErr } = await sb.from('profiles').update({ banned_until: null }).eq('id', user_id)
  if (profErr) console.warn('[admin] unbanUser profile sync:', profErr)
  return res.status(200).json({ id: user_id, banned_until: null })
}

// ─── deleteUser ─────────────────────────────────────────────────────────
async function handleDeleteUser(sb, { user_id }, caller, res) {
  if (!user_id) return res.status(400).json({ error: 'Не указан user_id' })
  if (user_id === caller.id) return res.status(400).json({ error: 'Нельзя удалить себя' })

  const { error } = await sb.auth.admin.deleteUser(user_id)
  if (error) {
    console.error('[admin] deleteUser auth:', error)
    return res.status(400).json({ error: error.message })
  }
  // If profiles.id has ON DELETE CASCADE on the FK to auth.users, this is
  // a no-op; otherwise it cleans up the orphaned profile row.
  const { error: profErr } = await sb.from('profiles').delete().eq('id', user_id)
  if (profErr && profErr.code !== 'PGRST116') console.warn('[admin] deleteUser profile cleanup:', profErr)
  return res.status(200).json({ id: user_id, deleted: true })
}

// ─── updateProjectMembers ───────────────────────────────────────────────
// Replaces a project's membership set in one shot. Easier than diffing
// on the client — we delete everything and re-insert. Both ops bypass
// RLS via the service-role client.
async function handleUpdateProjectMembers(sb, { project_id, user_ids }, res) {
  if (!project_id) return res.status(400).json({ error: 'Не указан project_id' })
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids должен быть массивом' })

  const { error: delErr } = await sb.from('project_members').delete().eq('project_id', project_id)
  if (delErr) {
    console.error('[admin] updateProjectMembers delete:', delErr)
    return res.status(400).json({ error: delErr.message })
  }

  if (user_ids.length === 0) {
    return res.status(200).json({ project_id, user_ids: [] })
  }

  const rows = user_ids.map(user_id => ({ project_id, user_id }))
  const { error: insErr } = await sb.from('project_members').insert(rows)
  if (insErr) {
    console.error('[admin] updateProjectMembers insert:', insErr)
    return res.status(400).json({ error: insErr.message })
  }
  return res.status(200).json({ project_id, user_ids })
}
