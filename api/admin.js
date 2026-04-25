// POST /api/admin
// Body: { action: 'createUser', email, password, full_name, role }
// Requires SUPABASE_SERVICE_ROLE_KEY env variable
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY или SUPABASE_URL не настроены' })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { action, email, password, full_name, role = 'member' } = req.body ?? {}

  if (action === 'createUser') {
    if (!email?.trim())    return res.status(400).json({ error: 'Укажите email' })
    if (!password || password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' })

    const { data, error } = await admin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name?.trim() ?? '' },
    })
    if (error) return res.status(400).json({ error: error.message })

    // Update profile role
    if (data?.user?.id && role !== 'member') {
      await admin.from('profiles').update({ role, full_name: full_name?.trim() ?? null }).eq('id', data.user.id)
    }

    return res.status(200).json({ id: data.user.id, email: data.user.email })
  }

  return res.status(400).json({ error: `Неизвестный action: ${action}` })
}
