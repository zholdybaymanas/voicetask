// POST /api/notify-email
// Body: { to, assigneeName, taskTitle, creatorName, projectName?, deadline? }
// Sends a task-assignment email via Resend.
// Required env: RESEND_API_KEY
// Optional env:
//   RESEND_FROM_EMAIL — verified sender (default: 'VoiceTask <onboarding@resend.dev>')
//   APP_URL           — link target in the email (default: 'https://voicetask-cfo.vercel.app')
import { Resend } from 'resend'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY не настроен на сервере' })
  }

  const { to, assigneeName, taskTitle, creatorName, projectName, deadline } = req.body ?? {}

  if (!to || !taskTitle) {
    return res.status(400).json({ error: 'Поля `to` и `taskTitle` обязательны' })
  }

  const resend  = new Resend(apiKey)
  const from    = process.env.RESEND_FROM_EMAIL || 'VoiceTask <onboarding@resend.dev>'
  const appUrl  = process.env.APP_URL || 'https://voicetask-cfo.vercel.app'

  const safeName    = assigneeName  || to
  const safeCreator = creatorName   || 'коллега'

  const html = `
    <div style="font-family: Inter, system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #2D5BE3; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px;">🎤 VoiceTask</h1>
      </div>
      <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
        <h2 style="color: #0f172a; margin: 0 0 12px;">Привет, ${escapeHtml(safeName)}!</h2>
        <p style="color: #64748b; margin: 0 0 16px;">Вам назначена новая задача от <b>${escapeHtml(safeCreator)}</b>:</p>

        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="color: #0f172a; margin: 0 0 12px;">${escapeHtml(taskTitle)}</h3>
          ${projectName ? `<p style="color: #64748b; margin: 4px 0;">📁 Проект: <b>${escapeHtml(projectName)}</b></p>` : ''}
          ${deadline    ? `<p style="color: #64748b; margin: 4px 0;">📅 Дедлайн: <b>${escapeHtml(deadline)}</b></p>` : ''}
        </div>

        <a href="${appUrl}"
           style="background: #2D5BE3; color: white; padding: 12px 24px;
                  border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 500;">
          Открыть задачу →
        </a>

        <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
          Это автоматическое уведомление от VoiceTask.
        </p>
      </div>
    </div>
  `

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject: `Вам назначена новая задача: ${taskTitle}`,
      html,
    })
    if (result.error) {
      console.error('[notify-email] Resend error:', result.error)
      return res.status(502).json({ error: result.error.message ?? 'Ошибка Resend' })
    }
    return res.status(200).json({ success: true, id: result.data?.id })
  } catch (err) {
    console.error('[notify-email] threw:', err)
    return res.status(500).json({ error: err.message ?? 'Ошибка отправки email' })
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
