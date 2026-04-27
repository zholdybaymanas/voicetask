import { useState, useEffect, useRef } from 'react'
import { supabase, supabaseRest } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const TYPE_CONFIG = {
  new_task:     { label: 'Новая задача',     color: 'bg-primary/15 text-primary',         dot: 'bg-primary' },
  task_review:  { label: 'На проверке',      color: 'bg-violet-500/15 text-violet-500',   dot: 'bg-violet-500' },
  task_done:    { label: 'Задача выполнена', color: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500' },
  task_overdue: { label: 'Просрочено',       color: 'bg-red-500/15 text-red-500',         dot: 'bg-red-500' },
  mention:      { label: 'Упоминание',       color: 'bg-amber-500/15 text-amber-500',     dot: 'bg-amber-500' },
  reminder:     { label: 'Напоминание',      color: 'bg-violet-500/15 text-violet-500',   dot: 'bg-violet-500' },
  info:         { label: 'Информация',       color: 'bg-hover text-muted',                dot: 'bg-muted' },
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [markingAll, setMarkingAll] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => {
    if (!user) return
    loadNotifications()

    const channel = supabase.channel(`notifications-page-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setItems(prev => [payload.new, ...prev])
        showToast(payload.new)
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setItems(prev => prev.map(n => n.id === payload.new.id ? payload.new : n))
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setItems(prev => prev.filter(n => n.id !== payload.old.id))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      clearTimeout(toastTimer.current)
    }
  }, [user])

  function showToast(notification) {
    clearTimeout(toastTimer.current)
    setToast(notification)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  async function loadNotifications() {
    setLoading(true)
    setError(null)
    try {
      const result = await supabaseRest('notifications', {
        filters: [`user_id=eq.${user.id}`, 'order=created_at.desc', 'limit=100'],
      })
      if (result.error) throw new Error(result.error.message ?? JSON.stringify(result.error))
      setItems(result.data ?? [])
    } catch (err) {
      console.error('[NotificationsPage] load:', err)
      setError(err.message ?? 'Не удалось загрузить уведомления')
    } finally {
      setLoading(false)
    }
  }

  async function markRead(id) {
    const result = await supabaseRest('notifications', {
      method: 'PATCH', filters: [`id=eq.${id}`], body: { read: true },
    })
    if (result.error) {
      console.error('[NotificationsPage] markRead:', result.error)
      return
    }
    setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  async function markAllRead() {
    setMarkingAll(true)
    const result = await supabaseRest('notifications', {
      method: 'PATCH',
      filters: [`user_id=eq.${user.id}`, 'read=eq.false'],
      body: { read: true },
    })
    if (result.error) console.error('[NotificationsPage] markAllRead:', result.error)
    setItems(prev => prev.map(n => ({ ...n, read: true })))
    setMarkingAll(false)
  }

  const unreadCount = items.filter(n => !n.read).length

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {unreadCount > 0 ? `${unreadCount} непрочитанных` : 'Все прочитаны'}
        </p>
        {unreadCount > 0 && (
          <button
            className="btn-secondary text-xs flex items-center gap-1.5 shrink-0"
            onClick={markAllRead}
            disabled={markingAll}
          >
            {markingAll
              ? <div className="w-3 h-3 border-2 border-muted border-t-transparent rounded-full animate-spin" />
              : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
            }
            Прочитать все
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
          <p className="text-sm text-muted">{error}</p>
          <button className="btn-secondary text-sm" onClick={loadNotifications}>Повторить</button>
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 bg-hover rounded-full flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </div>
          <p className="text-sm font-medium text-text">Уведомлений нет</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {items.map(n => {
              const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.info
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-4 py-3.5 transition-colors cursor-pointer hover:bg-hover ${!n.read ? 'bg-primary/5' : ''}`}
                  onClick={() => !n.read && markRead(n.id)}
                >
                  <div className="mt-1.5 shrink-0">
                    <div className={`w-2 h-2 rounded-full ${n.read ? 'bg-muted' : cfg.dot}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm ${n.read ? 'text-muted' : 'text-text font-medium'}`}>
                        {n.title}
                      </p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${cfg.color}`}>
                        {cfg.label}
                      </span>
                    </div>
                    {n.body && (
                      <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.body}</p>
                    )}
                    <p className="text-xs text-muted mt-1">
                      {new Date(n.created_at).toLocaleString('ru-RU', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>

                  {n.link_url && (
                    <a
                      href={n.link_url}
                      className="text-primary hover:underline text-xs shrink-0 mt-0.5"
                      onClick={e => e.stopPropagation()}
                    >
                      Перейти →
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-20 right-4 sm:right-7 z-50 animate-in">
          <div
            onClick={() => { setToast(null); if (!toast.read) markRead(toast.id) }}
            className="bg-card border border-border shadow-card-hover rounded-xl px-4 py-3 max-w-sm cursor-pointer hover:shadow-glow transition-shadow"
          >
            <div className="flex items-start gap-3">
              <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${(TYPE_CONFIG[toast.type] ?? TYPE_CONFIG.info).dot}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text truncate">{toast.title}</p>
                {toast.body && <p className="text-xs text-muted mt-0.5 line-clamp-2">{toast.body}</p>}
              </div>
              <button
                onClick={e => { e.stopPropagation(); setToast(null) }}
                className="text-muted hover:text-text shrink-0"
                aria-label="Закрыть"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
