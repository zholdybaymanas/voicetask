// POST /api/transcribe
// Body: multipart/form-data with field "audio" (audio file)
// Returns: { text: string }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // TODO: интеграция с OpenAI Whisper или другим STT-провайдером
  return res.status(501).json({ error: 'Not implemented' })
}
