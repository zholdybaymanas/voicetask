import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

// Load .env manually
const envPath = path.join(__dirname, '.env')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key) process.env[key] = val
  }
  console.log('[server] .env loaded, ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY)
} else {
  console.warn('[server] .env file not found!')
}

// Register all api/*.js handlers
const apiDir = path.join(__dirname, 'api')
const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.js'))
for (const file of files) {
  const route = '/api/' + file.replace('.js', '')
  const mod = await import('./api/' + file)
  app.all(route, mod.default)
  console.log('[server] Registered:', route)
}

app.listen(3001, () => console.log('[server] API server running on http://localhost:3001'))
