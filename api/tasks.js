// POST /api/tasks
// Body: { transcript: string }
// Returns: { title, assigned_to, project_id, deadline }
//
// Loads the projects + team list and voice_keywords *server-side* using
// the service-role key, so an empty/late frontend cache can never starve
// the parser of context.
//
// AUTH: requires Authorization: Bearer <Supabase JWT>. Without it the
//       endpoint is rejected — prevents abuse of the Anthropic API budget.
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const usingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!usingServiceRole) {
    // Anon key is subject to RLS — projects/team may come back filtered or empty.
    console.warn('[api/tasks] SUPABASE_SERVICE_ROLE_KEY not set — falling back to anon key (RLS applies)')
  }
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

// Maps Kazakh-only Cyrillic letters to their closest Russian equivalents.
// Speech recognition (especially ru-RU) often emits the Russian form even
// when the user said the Kazakh one — and vice-versa for kk-KZ. By
// normalising both the transcript and the keyword variants on the server
// side, "Мәнгілік" and "Мангилик" collapse to the same string and Haiku
// has a much easier time matching.
const KZ_TO_RU = { ә: 'а', ғ: 'г', қ: 'к', ң: 'н', ө: 'о', ұ: 'у', ү: 'у', һ: 'х', і: 'и' }
function normalizeText(text) {
  if (!text) return ''
  return text.toLowerCase().replace(/[әғқңөұүһі]/g, ch => KZ_TO_RU[ch] ?? ch)
}

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

    const { transcript } = req.body ?? {}
    console.log('[api/tasks] Transcript (raw):', transcript)

    if (typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'Нет текста для обработки' })
    }
    if (transcript.length > 4000) {
      return res.status(400).json({ error: 'Слишком длинный текст' })
    }

    // Normalise once so Kazakh-only letters collapse to their Russian
    // equivalents before Haiku ever sees them.
    const transcriptNorm = normalizeText(transcript)
    if (transcriptNorm !== transcript.toLowerCase()) {
      console.log('[api/tasks] Transcript (kz→ru normalised):', transcriptNorm)
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY не настроен на сервере' })
    }

    // Load context server-side — never trust the client to populate this,
    // since a fresh page load may send empty arrays before its caches fill.
    const [projectsRes, teamRes] = await Promise.all([
      sb.from('projects').select('id, name').eq('archived', false),
      sb.from('profiles').select('id, full_name, email'),
    ])
    if (projectsRes.error) console.error('[api/tasks] projects load error:', projectsRes.error)
    if (teamRes.error)     console.error('[api/tasks] team load error:',     teamRes.error)
    const projects = projectsRes.data ?? []
    const team     = teamRes.data     ?? []
    console.log('[api/tasks] Projects list:', projects.map(p => p.name))
    console.log('[api/tasks] Team list:',     team.map(t => t.full_name || t.email))

    const today = new Date().toISOString().split('T')[0]

    const allIds = [...team.map(m => m.id), ...projects.map(p => p.id)]
    const keywordMap = await loadKeywords(sb, allIds)

    function variantsFor(type, id, fallback) {
      const stored = keywordMap.get(`${type}:${id}`) ?? []
      const set = new Set()
      for (const k of stored) {
        const lower = k.toLowerCase()
        set.add(lower)
        set.add(normalizeText(lower)) // adds the kz→ru form alongside
      }
      if (fallback) {
        const lower = fallback.toLowerCase()
        set.add(lower)
        set.add(normalizeText(lower))
      }
      return [...set]
    }

    const assigneeList = team.length
      ? team.map(m => {
          const variants = variantsFor('assignee', m.id, m.full_name || m.email)
          return `"${m.full_name || m.email}" (варианты: ${variants.join(', ')}) → id: ${m.id}`
        }).join('\n')
      : '(нет членов команды)'

    const projectList = projects.length
      ? projects.map(p => {
          const variants = variantsFor('project', p.id, p.name)
          return `"${p.name}" (варианты: ${variants.join(', ')}) → id: ${p.id}`
        }).join('\n')
      : '(нет проектов)'

    const prompt = `Извлеки задачу из голосового текста.

Сегодняшняя дата: ${today}

Голосовой текст: ${transcriptNorm}

Текст может содержать казахские буквы или их русские эквиваленты. Сопоставляй нечётко: мәнгілік = мангилик, ә=а, ғ=г, қ=к, ң=н, ө=о, ұ/ү=у, һ=х, і=и.

Список исполнителей (сопоставляй нечётко, учитывай падежи русского/казахского, транслит, предлоги «исполнитель», «для», «назначь», «отправь», «поручи»):
${assigneeList}

Список проектов (сопоставляй нечётко, учитывай падежи, предлоги «в», «для», «в проект», «по проекту», «запиши в»):
${projectList}

Правила:
- title = суть задачи, без служебных слов
- assigned_to = id из списка исполнителей, иначе null
- project_id = id из списка проектов, иначе null
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
    console.log('[api/tasks] Haiku response:', raw)

    const jsonStr = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[api/tasks] JSON parse error:', parseErr.message)
      parsed = { title: transcript, assigned_to: null, project_id: null, deadline: null }
    }
    console.log('[api/tasks] Parsed result:', parsed)

    // Validate uuids — Claude может галлюцинировать. Принимаем только uuid из списков.
    const validUserIds    = new Set(team.map(u => u.id))
    const validProjectIds = new Set(projects.map(p => p.id))
    const result = {
      title:       String(parsed.title ?? transcript).slice(0, 255).trim() || transcript,
      assigned_to: validUserIds.has(parsed.assigned_to)    ? parsed.assigned_to : null,
      project_id:  validProjectIds.has(parsed.project_id)  ? parsed.project_id  : null,
      deadline:    /^\d{4}-\d{2}-\d{2}$/.test(parsed.deadline ?? '') ? parsed.deadline : null,
    }

    if (parsed.assigned_to && !result.assigned_to) {
      console.warn('[api/tasks] Haiku returned unknown assignee uuid:', parsed.assigned_to)
    }
    if (parsed.project_id && !result.project_id) {
      console.warn('[api/tasks] Haiku returned unknown project uuid:', parsed.project_id)
    }

    console.log('[api/tasks] Final result:', result)
    return res.status(200).json(result)

  } catch (error) {
    console.error('[api/tasks] unhandled error:', error)
    return res.status(500).json({ error: error.message ?? 'Внутренняя ошибка сервера' })
  }
}
