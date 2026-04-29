// POST /api/admin
// Body: { action: 'createUser', email, password, full_name, role }
// AUTH: must be called by an authenticated user with role='admin'
//       (verified via Supabase JWT in Authorization: Bearer header).
// Requires SUPABASE_SERVICE_ROLE_KEY (server-only) for the privileged ops.
import { createClient } from '@supabase/supabase-js'

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

  const { action, email, password, full_name, role = 'member' } = req.body ?? {}

  if (action !== 'createUser') {
    return res.status(400).json({ error: `Неизвестный action: ${action}` })
  }

  if (!email?.trim())                   return res.status(400).json({ error: 'Укажите email' })
  if (!password || password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' })
  if (!['member', 'manager', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Недопустимая роль' })
  }

  // Step 1 — create the auth user
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

  // Step 2 — upsert the profiles row (handles both: trigger created the row OR no trigger)
  const { data: profileData, error: profileErr } = await sb
    .from('profiles')
    .upsert(
      { id: userId, email: userEmail, full_name: trimmedFullName, role },
      { onConflict: 'id' },
    )
    .select()
    .single()

  if (profileErr) {
    console.error('[admin] profile upsert error:', profileErr)
    return res.status(200).json({
      id:        userId,
      email:     userEmail,
      full_name: trimmedFullName,
      role,
      warning:   `Пользователь создан, но профиль не сохранён: ${profileErr.message}`,
    })
  }

  return res.status(200).json({
    id:        userId,
    email:     userEmail,
    full_name: profileData?.full_name ?? trimmedFullName,
    role:      profileData?.role ?? role,
  })
}
