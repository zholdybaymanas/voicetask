// POST /api/tasks
// Body: { transcript: string, projects: [{id, name}], team: [{id, full_name, email}] }
// Returns: { title, assigned_to, project_id, deadline }
// AUTH: requires Authorization: Bearer <Supabase JWT>. Without it the
//       endpoint is rejected — prevents abuse of the Anthropic API budget.
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function requireAuth(req, sb) {
  if (!sb) return null
  const h = req.headers.authorization || ''
  const m = h.match(/^Bearer (.+)$/)
  if (!m) return null
  const { data, error } = await sb.auth.getUser(m[1])
  if (error || !data?.user) return null
  return data.user
}

// Load voice_keywords for a given list of canonical IDs and return:
//   { 'assignee:<uuid>': ['keyword1', 'keyword2'], ... }
// Falls back gracefully — if the table doesn't exist or the query fails,
// returns an empty map (the prompt then just uses canonical names).
async function loadKeywords(sb, ids) {
  if (!sb || !ids.length) return new Map()
  try {
    const { data, error } = await sb
      .from('voice_keywords')
      .select('type, canonical_id, keyword')
      .in('canonical_id', ids)
    if (error) {
      console.warn('[api/tasks] keyword query failed:', error.message)
      return new Map()
    }
    const byKey = new Map()
    for (const row of (data ?? [])) {
      const k = `${row.type}:${row.canonical_id}`
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(row.keyword)
    }
    return byKey
  } catch (err) {
    console.warn('[api/tasks] keyword load threw:', err)
    return new Map()
  }
}

export default async function handler(req, res) {
  console.log('[api/tasks] method:', req.method)

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const sb   = getServiceClient()
    const user = await requireAuth(req, sb)
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

    // Load known voice variants for each team member / project from
    // voice_keywords. The trigger generates lowercase canonical name +
    // each word (so "Манас Жолдыбай" → ["манас жолдыбай","манас","жолдыбай"]).
    const allIds = [...team.map(m => m.id), ...projects.map(p => p.id)]
    const keywordMap = await loadKeywords(sb, allIds)

    function variantsFor(type, id, fallback) {
      const stored = keywordMap.get(`${type}:${id}`) ?? []
      const set = new Set(stored.map(k => k.toLowerCase()))
      // Always include the canonical name so the prompt is useful even
      // without keywords backfilled yet.
      if (fallback) set.add(fallback.toLowerCase())
      return [...set]
    }

    const assigneeKeywords = team.length
      ? team.map(m => {
          const variants = variantsFor('assignee', m.id, m.full_name || m.email)
          return `${variants.join(' / ')} → ${m.id}`
        }).join('\n')
      : '(нет членов команды)'

    const projectKeywords = projects.length
      ? projects.map(p => {
          const variants = variantsFor('project', p.id, p.name)
          return `${variants.join(' / ')} → ${p.id}`
        }).join('\n')
      : '(нет проектов)'

    const prompt = `Извлеки задачу из голосового текста.

Сегодняшняя дата: ${today}

Голосовой текст: ${transcript}

Словарь исполнителей (keyword → id):
${assigneeKeywords}

Словарь проектов (keyword → id):
${projectKeywords}

Фразы для определения исполнителя:
«исполнитель X», «для X», «назначь X», «X сделает», «отправь X», «X будет делать», «поручи X», «X займётся»

Фразы для определения проекта:
«в проект X», «в X», «для проекта X», «запиши в X», «проект X»

Сопоставляй нечётко — учитывай падежи русского и казахского, транслит, опечатки распознавания.

Правила:
- title = суть задачи, без служебных слов
- assigned_to = id из словаря исполнителей, иначе null
- project_id = id из словаря проектов, иначе null
- deadline = YYYY-MM-DD если дата упомянута (от ${today}), иначе null
- В title НЕ включай: «запиши задачу», «исполнитель», «является», «отправь», «назначь», «в проект», «для», «по проекту», имя исполнителя, название проекта, упоминание даты

Примеры:
«встреча с контрагентами достык 300 исполнитель является тест в мангилик»
→ {"title":"Встреча с контрагентами Достык 300","assigned_to":"<id Тест>","project_id":"<id Мангилик>","deadline":null}

«Манас сделает отчёт по себестоимости»
→ {"title":"Отчёт по себестоимости","assigned_to":"<id Манас>","project_id":null,"deadline":null}

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
