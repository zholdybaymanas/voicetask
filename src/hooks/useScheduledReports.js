import { useEffect } from 'react'
import { supabaseRest } from '../lib/supabase'

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

function isoFromDate(date) {
  return date.toISOString()
}

function startOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d = new Date()) {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
function mondayOfWeek(d = new Date()) {
  const x = new Date(d)
  const dow = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - dow)
  x.setHours(0, 0, 0, 0)
  return x
}

async function countTasks(userId, filters) {
  const baseFilter = `or=(assignee_id.eq.${userId},created_by.eq.${userId})`
  const res = await supabaseRest('tasks', {
    select: 'id',
    filters: [baseFilter, ...filters],
  })
  if (res.error) return 0
  return res.data?.length ?? 0
}

async function showDailyReport(userId) {
  const today = todayStr()
  const start = isoFromDate(startOfDay())
  const end   = isoFromDate(endOfDay())

  const created = await countTasks(userId, [`created_at=gte.${start}`, `created_at=lte.${end}`])
  const done    = await countTasks(userId, [`status=eq.done`, `updated_at=gte.${start}`, `updated_at=lte.${end}`])

  try {
    const notif = new Notification('Итоги дня · VoiceTask', {
      body: `Создано ${created}, выполнено ${done}`,
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

async function showWeeklyReport(userId) {
  const wk    = weekKey()
  const start = isoFromDate(mondayOfWeek())
  const end   = isoFromDate(endOfDay())

  const created    = await countTasks(userId, [`created_at=gte.${start}`, `created_at=lte.${end}`])
  const done       = await countTasks(userId, [`status=eq.done`, `updated_at=gte.${start}`, `updated_at=lte.${end}`])
  const inProgress = await countTasks(userId, [`status=eq.in_progress`])

  try {
    const notif = new Notification('Итоги недели · VoiceTask', {
      body: `Создано ${created}, выполнено ${done}, в работе ${inProgress}`,
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

function maybeShowDaily(userId) {
  const now = new Date()
  if (now.getHours() < DAILY_HOUR) return false
  const today = todayStr(now)
  if (localStorage.getItem(DAILY_KEY) === today) return false
  showDailyReport(userId)
  return true
}

function maybeShowWeekly(userId) {
  const now = new Date()
  if (now.getDay() !== WEEKLY_DOW) return false
  if (now.getHours() < WEEKLY_HOUR) return false
  const wk = weekKey(now)
  if (localStorage.getItem(WEEKLY_KEY) === wk) return false
  showWeeklyReport(userId)
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
      maybeShowDaily(userId)
      maybeShowWeekly(userId)

      // Schedule today's 18:00 if it hasn't passed yet
      const now = new Date()
      const today18 = new Date(now)
      today18.setHours(DAILY_HOUR, 0, 0, 0)
      if (now < today18) {
        dailyTimer = setTimeout(() => maybeShowDaily(userId), today18 - now)
      }

      // Schedule next Friday 17:00 if before that this week
      const nextFriday = new Date(now)
      const daysToFriday = (WEEKLY_DOW - now.getDay() + 7) % 7
      nextFriday.setDate(now.getDate() + (daysToFriday || (now.getHours() < WEEKLY_HOUR ? 0 : 7)))
      nextFriday.setHours(WEEKLY_HOUR, 0, 0, 0)
      if (nextFriday > now) {
        weeklyTimer = setTimeout(() => maybeShowWeekly(userId), nextFriday - now)
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
