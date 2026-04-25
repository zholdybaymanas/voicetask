import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase, supabaseRest, supabasePatch } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { descriptionPreview } from '../lib/description'
import TaskDetailDrawer from '../components/TaskDetailDrawer'
import TaskCheck from '../components/TaskCheck'

const PRIORITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-muted' }

function getGreeting(name) {
  const h = new Date().getHours()
  const word = h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'
  return name ? `${word}, ${name}` : word
}

function todayStr() { return new Date().toISOString().split('T')[0] }

export default function Dashboard() {
  const { profile }         = useAuth()
  const [tasks, setTasks]   = useState([])
  const [projects, setProjects] = useState([])
  const [team, setTeam]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    loadAll()
    window.addEventListener('voiceTaskCreated', loadAll)
    const ch = supabase.channel('dashboard-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, loadAll)
      .subscribe()
    return () => {
      window.removeEventListener('voiceTaskCreated', loadAll)
      supabase.removeChannel(ch)
    }
  }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [tasksRes, projectsRes, profilesRes] = await Promise.all([
        supabaseRest('tasks', {
          select: '*,projects(name,color)',
          filters: ['status=neq.cancelled', 'order=created_at.desc'],
        }),
        supabaseRest('projects', { select: 'id,name', filters: ['archived=eq.false'] }),
        supabaseRest('profiles', { select: 'id,full_name,email' }),
      ])
      if (tasksRes.error) throw new Error(tasksRes.error.message ?? JSON.stringify(tasksRes.error))
      if (projectsRes.error) throw new Error(projectsRes.error.message ?? JSON.stringify(projectsRes.error))
      if (profilesRes.error) throw new Error(profilesRes.error.message ?? JSON.stringify(profilesRes.error))
      setTasks(tasksRes.data ?? [])
      setProjects(projectsRes.data ?? [])
      setTeam(profilesRes.data ?? [])
    } catch (err) {
      console.error('[Dashboard] loadAll:', err)
      setError(err.message ?? 'Не удалось загрузить задачи')
    } finally {
      setLoading(false)
    }
  }

  async function quickToggleDone(task) {
    const nextStatus = task.status === 'done' ? 'todo' : 'done'
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: nextStatus } : t))
    const { error } = await supabasePatch('tasks', task.id, { status: nextStatus })
    if (error) {
      console.error('[Dashboard] quickToggleDone:', error)
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t))
    }
  }

  function applyTaskUpdate(updated) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated, projects: t.projects } : t))
  }

  function removeTaskFromList(id) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setSelectedId(null)
  }

  const today       = todayStr()
  const displayName = profile?.full_name || ''
  const todayTasks  = tasks.filter(t => t.due_date === today && t.status !== 'done')
  const recentTasks = tasks.slice(0, 7)
  const selectedTask = tasks.find(t => t.id === selectedId) ?? null

  const stats = [
    { label: 'Всего задач', value: tasks.length,                                                                       icon: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z' },
    { label: 'Сегодня',     value: tasks.filter(t => t.due_date === today).length,                                     icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5' },
    { label: 'В работе',    value: tasks.filter(t => t.status === 'in_progress').length,                               icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z' },
    { label: 'Просрочено',  value: tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done').length,  icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z' },
  ]

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <p className="text-sm text-muted">{error}</p>
      <button className="btn-secondary text-sm" onClick={loadAll}>Повторить</button>
    </div>
  )

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-semibold text-text">{getGreeting(displayName)}</h2>
        <p className="text-sm text-muted mt-0.5 capitalize">
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 sm:gap-3">
        {stats.map(s => (
          <div key={s.label} className="bg-card rounded-xl border border-border p-3 sm:p-4 flex items-center gap-3 shadow-card hover:shadow-card-hover transition-shadow">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <svg className="w-[18px] h-[18px] text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xl sm:text-2xl font-bold text-text leading-none">{s.value}</p>
              <p className="text-xs text-muted mt-0.5 truncate">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {todayTasks.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-text mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            Задачи на сегодня
            <span className="text-muted font-normal">({todayTasks.length})</span>
          </h3>
          <div className="bg-card rounded-xl border border-border shadow-card divide-y divide-border">
            {todayTasks.map(t => (
              <TaskRow
                key={t.id}
                task={t}
                today={today}
                onOpen={() => setSelectedId(t.id)}
                onToggle={() => quickToggleDone(t)}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text">Последние задачи</h3>
          <Link to="/tasks" className="text-xs text-primary hover:underline font-medium">Все →</Link>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-card divide-y divide-border">
          {recentTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="w-11 h-11 bg-primary/10 rounded-full flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round"
                    d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-text">Задач пока нет</p>
              <p className="text-xs text-muted mt-1">Создайте первую задачу голосом!</p>
            </div>
          ) : (
            recentTasks.map(t => (
              <TaskRow
                key={t.id}
                task={t}
                today={today}
                onOpen={() => setSelectedId(t.id)}
                onToggle={() => quickToggleDone(t)}
              />
            ))
          )}
        </div>
      </section>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          projects={projects}
          team={team}
          onClose={() => setSelectedId(null)}
          onUpdated={applyTaskUpdate}
          onDeleted={removeTaskFromList}
        />
      )}
    </div>
  )
}

function TaskRow({ task, today, onOpen, onToggle }) {
  const isOverdue = task.due_date && task.due_date < today && task.status !== 'done'
  const isDone    = task.status === 'done'
  const previewText = descriptionPreview(task.description)

  return (
    <div
      onClick={onOpen}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-hover transition-colors group cursor-pointer ${isDone ? 'opacity-50' : ''}`}
    >
      <TaskCheck done={isDone} isOverdue={isOverdue} onToggle={onToggle} />
      {task.priority && (
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-muted'}`} />
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isDone ? 'text-muted line-through' : 'text-text font-medium'}`}>
          {task.title}
        </p>
        {previewText && (
          <p className="text-xs text-muted truncate mt-0.5">{previewText}</p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        {task.projects && (
          <span className="hidden sm:flex items-center gap-1 text-xs text-muted bg-hover px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: task.projects.color ?? '#2D5BE3' }} />
            {task.projects.name}
          </span>
        )}
        {task.due_date && (
          <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-muted'}`}>
            {new Date(task.due_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
    </div>
  )
}
