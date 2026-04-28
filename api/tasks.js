// POST /api/tasks
// Body: { transcript: string, projects: [{id, name}], team: [{id, full_name, email}] }
// Returns: { title, assigned_to, project_id, deadline, confidence }
export default async function handler(req, res) {
  console.log('[api/tasks] method:', req.method)

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const { transcript, projects = [], team = [] } = req.body ?? {}

    if (!transcript?.trim()) {
      return res.status(400).json({ error: 'Нет текста для обработки' })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY не настроен на сервере' })
    }

    const today = new Date().toISOString().split('T')[0]

    const teamLines = team.length
      ? team.map(u => `- ${u.full_name || u.email} = ${u.id}`).join('\n')
      : '(никого нет)'
    const projectLines = projects.length
      ? projects.map(p => `- ${p.name} = ${p.id}`).join('\n')
      : '(нет проектов)'

    const prompt = `Ты ИИ-парсер голосовых команд русскоязычного таск-менеджера.

Сегодняшняя дата: ${today}

КОМАНДА (имя = uuid):
${teamLines}

ПРОЕКТЫ (название = uuid):
${projectLines}

ГОЛОСОВОЙ ТЕКСТ:
"${transcript}"

Извлеки структурированную задачу. Понимай естественную русскую речь.

ИСПОЛНИТЕЛЬ (assigned_to) — кто должен выполнить:
- "Манас сделает презентацию" → uuid Манаса
- "Отправь Манасу задачу" → uuid Манаса
- "Назначить Манаса на отчёт" → uuid Манаса
- "Манасу подготовить документы" → uuid Манаса
- Учитывай все склонения (Манас/Манасу/Манасом/Манаса/Манасе)
- Учитывай транслит (manas → Манас, oraz → Ораз)
- Если имени нет в списке КОМАНДА — null
- Если упоминания исполнителя нет вовсе — null (не подставляй сам, не угадывай)

ПРОЕКТ (project_id) — к какому проекту относится:
- "Для проекта Мангилик X" / "В Мангилик X" / "Мангилик: X" / "По Мангилику" → uuid Мангилика
- "Задача по Навой" → uuid Навоя
- Учитывай склонения и транслит
- Если названия нет в списке ПРОЕКТЫ или не упомянуто — null

ДЕДЛАЙН (deadline) — формат YYYY-MM-DD, считай от ${today}:
- "сегодня" → ${today}
- "завтра" → +1 день
- "послезавтра" → +2 дня
- "через неделю" → +7 дней
- "в пятницу", "к понедельнику" → ближайший указанный день недели
- "к 25 апреля" → 2026-04-25 (текущий год если не указан)
- Нет упоминания даты → null

TITLE — суть задачи, кратко, без воды:
- "Манас сделает презентацию для встречи завтра" → "Подготовить презентацию для встречи"
- НЕ включай имя исполнителя, название проекта, слова про дедлайн в title
- Желательно в форме глагола в инфинитиве или существительного

CONFIDENCE (0.0–1.0) — твоя уверенность в распознавании:
- 1.0: всё ясно — название точное, исполнитель из списка, проект (если упомянут)
- 0.8–0.9: понятно название и хотя бы одно из {исполнитель, проект}
- 0.6–0.7: ясно только название, остальное не упоминалось — это нормально
- 0.4–0.5: упомянутое имя/проект НЕ из списка, либо текст размыт
- < 0.4: совсем непонятно

Верни ТОЛЬКО валидный JSON, без markdown, без пояснений, без \`\`\`:
{"title":"...","assigned_to":null,"project_id":null,"deadline":null,"confidence":0.85}`

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
      parsed = { title: transcript, assigned_to: null, project_id: null, deadline: null, confidence: 0.3 }
    }

    // Validate uuids — Claude может галлюцинировать. Принимаем только uuid из списков.
    const validUserIds    = new Set(team.map(u => u.id))
    const validProjectIds = new Set(projects.map(p => p.id))
    const result = {
      title:       String(parsed.title ?? transcript).slice(0, 255).trim() || transcript,
      assigned_to: validUserIds.has(parsed.assigned_to)    ? parsed.assigned_to : null,
      project_id:  validProjectIds.has(parsed.project_id)  ? parsed.project_id  : null,
      deadline:    /^\d{4}-\d{2}-\d{2}$/.test(parsed.deadline ?? '') ? parsed.deadline : null,
      confidence:  Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    }

    console.log('[api/tasks] result:', result)
    return res.status(200).json(result)

  } catch (error) {
    console.error('[api/tasks] unhandled error:', error)
    return res.status(500).json({ error: error.message ?? 'Внутренняя ошибка сервера' })
  }
}
