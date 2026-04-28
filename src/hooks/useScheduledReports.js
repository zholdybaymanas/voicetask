import { useEffect } from 'react'

const DAILY_KEY  = 'voicetask:lastDailyReport'   // value: YYYY-MM-DD
const WEEKLY_KEY = 'voicetask:lastWeeklyReport'  // value: YYYY-Wnn
const PERMISSION_ASKED_KEY = 'voicetask:notifAsked'

const DAILY_HOUR  = 18
const WEEKLY_HOUR = 17
const WEEKLY_DOW  = 5 // Friday (0=Sun, 5=Fri)

function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ISO week key like "2026-W17"
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

// Notification body is intentionally a teaser — actual numbers are
// shown on the destination page after click. This way an "empty"
// weekend / holiday looks normal instead of awkwardly saying 0/0.
function showDailyReport() {
  const today = todayStr()
  try {
    const notif = new Notification('VoiceTask', {
      body: 'Ваш отчёт за день готов',
      icon: '/icons/icon-192x192.svg',
      tag:  `daily-${today}`,
    })
    notif.onclick = () => {
      window.focus()
      window.location.href = `/tasks?date=${today}`
    }
    localStorage.setItem(DAILY_KEY, today)
  } catch (err) {
    console.error('[reports] daily notification:', err)
  }
}

function showWeeklyReport() {
  const wk = weekKey()
  try {
    const notif = new Notification('VoiceTask', {
      body: 'Ваш отчёт за неделю готов',
      icon: '/icons/icon-192x192.svg',
      tag:  `weekly-${wk}`,
    })
    notif.onclick = () => {
      window.focus()
      window.location.href = '/reports?period=week'
    }
    localStorage.setItem(WEEKLY_KEY, wk)
  } catch (err) {
    console.error('[reports] weekly notification:', err)
  }
}

function maybeShowDaily() {
  const now = new Date()
  if (now.getHours() < DAILY_HOUR) return false
  const today = todayStr(now)
  if (localStorage.getItem(DAILY_KEY) === today) return false
  showDailyReport()
  return true
}

function maybeShowWeekly() {
  const now = new Date()
  if (now.getDay() !== WEEKLY_DOW) return false
  if (now.getHours() < WEEKLY_HOUR) return false
  const wk = weekKey(now)
  if (localStorage.getItem(WEEKLY_KEY) === wk) return false
  showWeeklyReport()
  return true
}

export function useScheduledReports(userId) {
  useEffect(() => {
    if (!userId) return
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return

    let dailyTimer = null
    let weeklyTimer = null

    const start = () => {
      if (Notification.permission !== 'granted') return
      // Check immediately on app load
      maybeShowDaily()
      maybeShowWeekly()

      // Schedule today's 18:00 if it hasn't passed yet
      const now = new Date()
      const today18 = new Date(now)
      today18.setHours(DAILY_HOUR, 0, 0, 0)
      if (now < today18) {
        dailyTimer = setTimeout(() => maybeShowDaily(), today18 - now)
      }

      // Schedule next Friday 17:00 if before that this week
      const nextFriday = new Date(now)
      const daysToFriday = (WEEKLY_DOW - now.getDay() + 7) % 7
      nextFriday.setDate(now.getDate() + (daysToFriday || (now.getHours() < WEEKLY_HOUR ? 0 : 7)))
      nextFriday.setHours(WEEKLY_HOUR, 0, 0, 0)
      if (nextFriday > now) {
        weeklyTimer = setTimeout(() => maybeShowWeekly(), nextFriday - now)
      }
    }

    // Ask permission on first authed load (delay a bit so it doesn't surprise users)
    const askIfNeeded = () => {
      if (Notification.permission === 'granted') {
        start()
      } else if (Notification.permission === 'default'
                 && !localStorage.getItem(PERMISSION_ASKED_KEY)) {
        const t = setTimeout(() => {
          localStorage.setItem(PERMISSION_ASKED_KEY, '1')
          Notification.requestPermission().then(p => {
            if (p === 'granted') start()
          }).catch(() => {})
        }, 3000)
        return () => clearTimeout(t)
      }
    }

    const cleanup = askIfNeeded()

    return () => {
      cleanup?.()
      if (dailyTimer)  clearTimeout(dailyTimer)
      if (weeklyTimer) clearTimeout(weeklyTimer)
    }
  }, [userId])
}
