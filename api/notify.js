// POST /api/notify
// Body: { user_id, title, body, url? }
// Sends a push notification to all subscriptions for the given user
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // TODO: интеграция с Web Push
  return res.status(501).json({ error: 'Not implemented' })
}
