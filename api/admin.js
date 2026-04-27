// POST /api/admin
// Body: { action: 'createUser', email, password, full_name, role }
// Requires SUPABASE_SERVICE_ROLE_KEY (server-only).
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL

  if (!serviceKey || !supabaseUrl) {
    return res.status(500).json({
      error: 'SUPABASE_SERVICE_ROLE_KEY или SUPABASE_URL не настроены. Добавьте их в .env (локально) или в Environment Variables в Vercel.',
    })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { action, email, password, full_name, role = 'member' } = req.body ?? {}

  if (action !== 'createUser') {
    return res.status(400).json({ error: `Неизвестный action: ${action}` })
  }

  if (!email?.trim())                   return res.status(400).json({ error: 'Укажите email' })
  if (!password || password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' })

  // Step 1 — create the auth user
  const { data: createData, error: createErr } = await admin.auth.admin.createUser({
    email:         email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name?.trim() || '' },
  })

  if (createErr) {
    console.error('[admin] auth.createUser:', createErr)
    return res.status(400).json({ error: createErr.message })
  }

  const userId    = createData.user.id
  const userEmail = createData.user.email
  const trimmedFullName = full_name?.trim() || null

  // Step 2 — upsert the profiles row.
  // Using upsert handles both cases: a DB trigger created the row OR no trigger exists.
  const { data: profileData, error: profileErr } = await admin
    .from('profiles')
    .upsert(
      { id: userId, email: userEmail, full_name: trimmedFullName, role },
      { onConflict: 'id' },
    )
    .select()
    .single()

  if (profileErr) {
    // Auth user exists at this point — surface the warning but don't 500.
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
