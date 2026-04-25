import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase, supabaseRest } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const PRIORITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-slate-300' }

function getGreeting(name) {
  const h = new Date().getHours()
  const word = h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  return name ? `${word}, ${name}` : word
}

function todayStr() { return new Date().toISOString().split('T')[0] }

export default function Dashboard() {
  const { profile }         = useAuth()
  const [tasks, setTasks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    loadTasks()
    window.addEventListener('voiceTaskCreated', loadTasks)
    return () => window.removeEventListener('voiceTaskCreated', loadTasks)
  }, [])

  async function loadTasks() {
    setLoading(true)
    setError(null)
    try {
      const result = await supabaseRest('tasks', {
        select: '*,projects(name,color)',
        filters: ['status=neq.cancelled', 'order=created_at.desc'],
      })
      if (result.error) throw new Error(JSON.stringify(result.error))
      setTasks(result.data ?? [])
    } catch (err) {
      console.error('ERROR:', err.message)
      setError(err.message ?? 'Не удалось загрузить задачи')
    } finally {
      setLoading(false)
    }
  }

  const today       = todayStr()
  const displayName = profile?.full_name || ''
  const todayTasks  = tasks.filter(t => t.due_date === today && t.status !== 'done')
  const recentTasks = tasks.slice(0, 7)

  const stats = [
    { label: 'Всего задач', value: tasks.length,                                                                       color: 'text-primary',    bg: 'bg-[#EEF2FF]', icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z' },
    { label: 'Сегодня',     value: tasks.filter(t => t.due_date === today).length,                                     color: 'text-violet-600', bg: 'bg-violet-50', icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5' },
    { label: 'В работе',    value: tasks.filter(t => t.status === 'in_progress').length,                               color: 'text-amber-600',  bg: 'bg-amber-50',  icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
    { label: 'Просрочено',  value: tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length,  color: 'text-red-600',    bg: 'bg-red-50',    icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z' },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <p className="text-sm text-slate-500">{error}</p>
      <button className="btn-secondary text-sm" onClick={loadTasks}>Повторить</button>
    </div>
  )

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{getGreeting(displayName)}</h2>
        <p className="text-sm text-slate-500 mt-0.5 capitalize">
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-100 p-3 sm:p-4 flex items-center gap-3 shadow-sm hover:shadow-card-hover transition-shadow">
            <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
              <svg className={`w-[18px] h-[18px] ${s.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-slate-900 leading-none">{s.value}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Today's tasks */}
      {todayTasks.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            Задачи на сегодня
            <span className="text-slate-400 font-normal">({todayTasks.length})</span>
          </h3>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-50">
            {todayTasks.map(t => <TaskRow key={t.id} task={t} today={today} />)}
          </div>
        </section>
      )}

      {/* Recent tasks */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700">Последние задачи</h3>
          <Link to="/tasks" className="text-xs text-primary hover:underline font-medium">Все →</Link>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm divide-y divide-slate-50">
          {recentTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-11 h-11 bg-[#EEF2FF] rounded-full flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700">Задач пока нет</p>
              <p className="text-xs text-slate-400 mt-1">Создайте первую задачу голосом!</p>
            </div>
          ) : (
            recentTasks.map(t => <TaskRow key={t.id} task={t} today={today} />)
          )}
        </div>
      </section>
    </div>
  )
}

function TaskRow({ task, today }) {
  const isOverdue = task.due_date && task.due_date < today && task.status !== 'done'
  const isDone    = task.status === 'done'

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors group">
      <div className="shrink-0">
        {isDone ? (
          <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
          </svg>
        ) : (
          <div className={`w-4 h-4 rounded-full border-2 ${isOverdue ? 'border-red-400' : 'border-slate-300'} group-hover:border-primary transition-colors`} />
        )}
      </div>
      {task.priority && (
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-slate-300'}`} />
      )}
      <p className={`flex-1 text-sm min-w-0 truncate ${isDone ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'}`}>
        {task.title}
      </p>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        {task.projects && (
          <span className="hidden sm:flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: task.projects.color ?? '#2D5BE3' }} />
            {task.projects.name}
          </span>
        )}
        {task.due_date && (
          <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
            {new Date(task.due_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  )
}
