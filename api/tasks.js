// POST /api/tasks
// Body: { transcript: string, projects: [{id, name}], team: [{id, full_name, email}] }
// Returns: { title, assigned_to, project_id, deadline }
// AUTH: requires Authorization: Bearer <Supabase JWT>. Without it the
//       endpoint is rejected — prevents abuse of the Anthropic API budget.
import { createClient } from '@supabase/supabase-js'

async function requireAuth(req) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const h = req.headers.authorization || ''
  const m = h.match(/^Bearer (.+)$/)
  if (!m) return null
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await sb.auth.getUser(m[1])
  if (error || !data?.user) return null
  return data.user
}

export default async function handler(req, res) {
  console.log('[api/tasks] method:', req.method)

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const user = await requireAuth(req)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const { transcript, projects = [], team = [] } = req.body ?? {}

    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'Нет текста для обработки' })
    }
    if (transcript.length > 4000) {
      return res.status(400).json({ error: 'Слишком длинный текст' })
    }
    if (!Array.isArray(projects) || !Array.isArray(team)) {
      return res.status(400).json({ error: 'Некорректные данные' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY не настроен на сервере' })
    }

    const today = new Date().toISOString().split('T')[0]

    const teamNames = team.length
      ? team.map(m => `${m.full_name || m.email} (id: ${m.id})`).join('\n')
      : '(нет членов команды)'
    const projectNames = projects.length
      ? projects.map(p => `${p.name} (id: ${p.id})`).join('\n')
      : '(нет проектов)'

    const prompt = `Извлеки задачу из голосового текста.

Сегодняшняя дата: ${today}

Голосовой текст: ${transcript}

Члены команды:
${teamNames}

Проекты:
${projectNames}

Правила:
- title = суть задачи, без служебных слов
- assigned_to = id члена команды (нечёткое совпадение, учитывай падежи и транслит), иначе null
- project_id = id проекта (нечёткое совпадение), иначе null
- deadline = ISO дата YYYY-MM-DD если упомянута, иначе null
- Служебные слова которые не входят в title: «запиши задачу», «исполнитель», «является», «отправь», «назначь», «в проект», «для», «по проекту»

Примеры:
«встреча с контрагентами достык 300 исполнитель является тест в мангилик»
→ {"title": "Встреча с контрагентами Достык 300", "assigned_to": "<id Тест>", "project_id": "<id Мангилик>", "deadline": null}

«Манас сделает отчёт по себестоимости»
→ {"title": "Отчёт по себестоимости", "assigned_to": "<id Манас>", "project_id": null, "deadline": null}

Верни ТОЛЬКО JSON без пояснений, без markdown:
{"title":"...","assigned_to":"uuid или null","project_id":"uuid или null","deadline":"YYYY-MM-DD или null"}`

    console.log('[api/tasks] calling Claude API...')

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    console.log('[api/tasks] Claude status:', claudeRes.status)

    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}))
      console.error('[api/tasks] Claude error:', errData)
      return res.status(502).json({ error: errData?.error?.message ?? `Claude API error ${claudeRes.status}` })
    }

    const claudeData = await claudeRes.json()
    const raw = claudeData?.content?.[0]?.text ?? ''
    console.log('[api/tasks] Claude raw output:', raw)

    const jsonStr = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[api/tasks] JSON parse error:', parseErr.message)
      parsed = { title: transcript, assigned_to: null, project_id: null, deadline: null }
    }

    // Validate uuids — Claude может галлюцинировать. Принимаем только uuid из списков.
    const validUserIds    = new Set(team.map(u => u.id))
    const validProjectIds = new Set(projects.map(p => p.id))
    const result = {
      title:       String(parsed.title ?? transcript).slice(0, 255).trim() || transcript,
      assigned_to: validUserIds.has(parsed.assigned_to)    ? parsed.assigned_to : null,
      project_id:  validProjectIds.has(parsed.project_id)  ? parsed.project_id  : null,
      deadline:    /^\d{4}-\d{2}-\d{2}$/.test(parsed.deadline ?? '') ? parsed.deadline : null,
    }

    console.log('[api/tasks] result:', result)
    return res.status(200).json(result)

  } catch (error) {
    console.error('[api/tasks] unhandled error:', error)
    return res.status(500).json({ error: error.message ?? 'Внутренняя ошибка сервера' })
  }
}
