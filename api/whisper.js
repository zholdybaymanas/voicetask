// POST /api/whisper
// Body: raw audio bytes (Content-Type carries the actual mime, e.g. audio/webm or audio/mp4).
// Returns: { transcript: string }
//
// Forwards the audio to OpenAI Whisper (whisper-1) using a server-side
// FormData wrapper, so the client never sees the API key. Requires a
// Supabase JWT — without it the endpoint is rejected to keep the OpenAI
// budget out of reach of unauthenticated callers.
import { createClient } from '@supabase/supabase-js'

// Disable Vercel's default JSON body parser so we can read the raw audio
// stream. Express (server.js) only parses application/json, so the stream
// stays intact there too.
export const config = { api: { bodyParser: false } }

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

async function readRawBody(req) {
  const chunks = []
  let total = 0
  const MAX = 25 * 1024 * 1024 // OpenAI Whisper hard limit
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX) throw new Error('Файл слишком большой (>25 МБ)')
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

function pickExtension(contentType) {
  const ct = (contentType || '').toLowerCase()
  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac')) return 'm4a'
  if (ct.includes('mpeg') || ct.includes('mp3'))                      return 'mp3'
  if (ct.includes('wav'))                                             return 'wav'
  if (ct.includes('ogg'))                                             return 'ogg'
  return 'webm'
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const sb   = getServiceClient()
    const user = await requireAuth(req, sb)
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY не настроен на сервере' })

    let buffer
    try {
      buffer = await readRawBody(req)
    } catch (err) {
      return res.status(413).json({ error: err.message })
    }
    if (!buffer.length) return res.status(400).json({ error: 'Пустой аудиофайл' })

    const contentType = req.headers['content-type'] || 'audio/webm'
    const ext         = pickExtension(contentType)

    const fd = new FormData()
    fd.append('file', new Blob([buffer], { type: contentType }), `audio.${ext}`)
    fd.append('model', 'whisper-1')
    // Russian + Kazakh both transcribe well under language=ru — Whisper
    // handles Kazakh words and Russian/Kazakh mixing in this mode.
    fd.append('language', 'ru')

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    fd,
    })

    if (!r.ok) {
      const err = await r.json().catch(() => ({}))
      console.error('[api/whisper] OpenAI error:', r.status, err)
      return res.status(502).json({ error: err?.error?.message ?? `Whisper API error ${r.status}` })
    }

    const data = await r.json()
    return res.status(200).json({ transcript: (data.text ?? '').trim() })

  } catch (error) {
    console.error('[api/whisper] unhandled error:', error)
    return res.status(500).json({ error: error.message ?? 'Внутренняя ошибка сервера' })
  }
}
