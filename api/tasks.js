// POST /api/tasks
// Body: { transcript: string, projects: [{id, name}], team: [{id, full_name, email}] }
// Returns: { title, description, project_id, assignee_id, due_date, priority }
export default async function handler(req, res) {
  console.log('[api/tasks] method:', req.method, '| body:', JSON.stringify(req.body))

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { transcript, projects = [], team = [] } = req.body ?? {}

    console.log('[api/tasks] transcript:', transcript)
    console.log('[api/tasks] projects count:', projects.length, '| team count:', team.length)

    if (!transcript?.trim()) {
      return res.status(400).json({ error: 'Нет текста для обработки' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    console.log('[api/tasks] ANTHROPIC_API_KEY present:', !!apiKey)

    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY не настроен на сервере' })
    }

    const today = new Date().toISOString().split('T')[0]

    const projectsCtxLine = projects.length
      ? `Проекты: ${projects.map(p => `"${p.name}"=${p.id}`).join(', ')}`
      : ''
    const teamCtxLine = team.length
      ? `Команда: ${team.map(u => `"${u.full_name || u.email}"=${u.id}`).join(', ')}`
      : ''

    const prompt = `Ты парсер задач. Сегодня ${today}.
${projectsCtxLine}
${teamCtxLine}

Извлеки задачу из текста и верни ТОЛЬКО валидный JSON без markdown, без \`\`\`, без пояснений.

Текст: "${transcript}"

Правила:
- title: конкретно и коротко
- Если упоминается имя из команды — подставь его id в assignee_id, иначе null
- Если упоминается проект — подставь его id в project_id, иначе null
- Срок ("завтра", "через неделю", "в пятницу") → вычисли дату YYYY-MM-DD от ${today}
- priority: "high" если срочно/важно, "low" если не срочно, иначе "medium"

Верни JSON точно в таком формате (ТОЛЬКО JSON, ничего больше):
{"title":"название","description":"","project_id":null,"assignee_id":null,"due_date":null,"priority":"medium"}`

    console.log('[api/tasks] calling Claude API...')

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    console.log('[api/tasks] Claude response status:', claudeRes.status)

    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}))
      console.error('[api/tasks] Claude error:', errData)
      return res.status(502).json({ error: errData?.error?.message ?? `Claude API error ${claudeRes.status}` })
    }

    const claudeData = await claudeRes.json()
    const raw = claudeData?.content?.[0]?.text ?? ''
    console.log('[api/tasks] Claude raw output:', raw)

    // Strip possible markdown code fences
    const jsonStr = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim()

    let parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (parseErr) {
      console.error('[api/tasks] JSON parse error:', parseErr.message, '| raw:', raw)
      parsed = { title: transcript, description: '', project_id: null, assignee_id: null, due_date: null, priority: 'medium' }
    }

    const result = {
      title:       String(parsed.title ?? transcript).slice(0, 255),
      description: String(parsed.description ?? ''),
      project_id:  parsed.project_id  ?? null,
      assignee_id: parsed.assignee_id ?? null,
      due_date:    parsed.due_date    ?? null,
      priority:    ['low', 'medium', 'high'].includes(parsed.priority) ? parsed.priority : 'medium',
    }

    console.log('[api/tasks] returning result:', result)
    return res.status(200).json(result)

  } catch (error) {
    console.error('[api/tasks] unhandled error:', error)
    return res.status(500).json({ error: error.message ?? 'Внутренняя ошибка сервера' })
  }
}
