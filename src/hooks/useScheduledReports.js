import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

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

function isEnabled(key) {
  // Toggles set in /settings. Stored as 'on' / 'off'. Missing = enabled.
  try {
    const v = localStorage.getItem(key)
    return v !== 'off'
  } catch { return true }
}

export function useScheduledReports(userId) {
  const navigate = useNavigate()

  useEffect(() => {
    if (!userId) return
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return

    let dailyTimer = null
    let weeklyTimer = null

    // Notifications navigate via React Router (no full page reload).
    // window.focus() still fires to surface a backgrounded tab.
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
          navigate(`/tasks?date=${today}`)
          notif.close()
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
          navigate('/reports?period=week')
          notif.close()
        }
        localStorage.setItem(WEEKLY_KEY, wk)
      } catch (err) {
        console.error('[reports] weekly notification:', err)
      }
    }

    function maybeShowDaily() {
      if (!isEnabled('voicetask:notif:daily')) return false
      const now = new Date()
      if (now.getHours() < DAILY_HOUR) return false
      const today = todayStr(now)
      if (localStorage.getItem(DAILY_KEY) === today) return false
      showDailyReport()
      return true
    }

    function maybeShowWeekly() {
      if (!isEnabled('voicetask:notif:weekly')) return false
      const now = new Date()
      if (now.getDay() !== WEEKLY_DOW) return false
      if (now.getHours() < WEEKLY_HOUR) return false
      const wk = weekKey(now)
      if (localStorage.getItem(WEEKLY_KEY) === wk) return false
      showWeeklyReport()
      return true
    }

    const start = () => {
      if (Notification.permission !== 'granted') return
      maybeShowDaily()
      maybeShowWeekly()

      const now = new Date()
      const today18 = new Date(now)
      today18.setHours(DAILY_HOUR, 0, 0, 0)
      if (now < today18) {
        dailyTimer = setTimeout(maybeShowDaily, today18 - now)
      }

      const nextFriday = new Date(now)
      const daysToFriday = (WEEKLY_DOW - now.getDay() + 7) % 7
      nextFriday.setDate(now.getDate() + (daysToFriday || (now.getHours() < WEEKLY_HOUR ? 0 : 7)))
      nextFriday.setHours(WEEKLY_HOUR, 0, 0, 0)
      if (nextFriday > now) {
        weeklyTimer = setTimeout(maybeShowWeekly, nextFriday - now)
      }
    }

    let permissionTimer = null
    if (Notification.permission === 'granted') {
      start()
    } else if (Notification.permission === 'default'
               && !localStorage.getItem(PERMISSION_ASKED_KEY)) {
      permissionTimer = setTimeout(() => {
        localStorage.setItem(PERMISSION_ASKED_KEY, '1')
        Notification.requestPermission().then(p => {
          if (p === 'granted') start()
        }).catch(() => {})
      }, 3000)
    }

    return () => {
      if (dailyTimer)      clearTimeout(dailyTimer)
      if (weeklyTimer)     clearTimeout(weeklyTimer)
      if (permissionTimer) clearTimeout(permissionTimer)
    }
  }, [userId, navigate])
}
