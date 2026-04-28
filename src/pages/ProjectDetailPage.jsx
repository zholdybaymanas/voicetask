import { useState, useEffect, useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { supabase, supabaseRest, supabasePatch } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { descriptionPreview } from '../lib/description'
import TaskDetailDrawer from '../components/TaskDetailDrawer'
import TaskCheck from '../components/TaskCheck'

const STATUS_OPTIONS = [
  { value: '',            label: 'Все' },
  { value: 'pending',     label: 'Входящие' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review',      label: 'На проверке' },
  { value: 'done',        label: 'Готово' },
]

const STATUS_LABEL = {
  pending: 'Входящие', in_progress: 'В работе', review: 'На проверке', done: 'Готово',
}
const PRIORITY_DOT = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-muted' }

function normStatus(s) {
  if (s === 'todo') return 'pending'
  if (s === 'cancelled') return 'done'
  return s ?? 'pending'
}

export default function ProjectDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [project, setProject] = useState(null)
  const [tasks, setTasks]     = useState([])
  const [team, setTeam]       = useState([])
  const [allProjects, setAllProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    if (!id) return
    loadAll()
    const silentReload = () => loadAll({ silent: true })
    const ch = supabase.channel(`project-${id}-rt`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${id}` }, silentReload)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [id])

  async function loadAll({ silent = false } = {}) {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [projectRes, tasksRes, profilesRes, projectsRes] = await Promise.all([
        supabaseRest('projects', { filters: [`id=eq.${id}`] }),
        supabaseRest('tasks', {
          select: '*',
          filters: [`project_id=eq.${id}`, 'order=sort_order.desc.nullslast,created_at.desc'],
        }),
        supabaseRest('profiles', { select: 'id,full_name,email' }),
        supabaseRest('projects', { select: 'id,name,color', filters: ['archived=eq.false'] }),
      ])
      if (projectRes.error) throw new Error(projectRes.error.message ?? 'Проект не найден')
      if (tasksRes.error)   throw new Error(tasksRes.error.message   ?? 'Ошибка загрузки задач')
      if (profilesRes.error) console.warn('profiles err:', profilesRes.error)
      if (projectsRes.error) console.warn('projects err:', projectsRes.error)
      const p = (projectRes.data ?? [])[0]
      if (!p) throw new Error('Проект не найден')
      setProject(p)
      setTasks(tasksRes.data ?? [])
      setTeam(profilesRes.data ?? [])
      setAllProjects(projectsRes.data ?? [])
    } catch (err) {
      console.error('[ProjectDetail] loadAll:', err)
      setError(err.message ?? 'Не удалось загрузить проект')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function quickToggleDone(task) {
    const nextStatus = task.status === 'done' ? 'pending' : 'done'
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: nextStatus } : t))
    const { error } = await supabasePatch('tasks', task.id, { status: nextStatus })
    if (error) {
      console.error('[ProjectDetail] quickToggleDone:', error)
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t))
    }
  }

  function applyTaskUpdate(updated) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated, profiles: t.profiles } : t))
  }

  function removeTaskFromList(tid) {
    setTasks(prev => prev.filter(t => t.id !== tid))
    setSelectedId(null)
  }

  const teamById = useMemo(() => Object.fromEntries(team.map(u => [u.id, u])), [team])

  const filtered = useMemo(() => {
    if (!filterStatus) return tasks
    return tasks.filter(t => normStatus(t.status) === filterStatus)
  }, [tasks, filterStatus])

  const counts = useMemo(() => {
    const c = { total: tasks.length, pending: 0, in_progress: 0, review: 0, done: 0 }
    for (const t of tasks) {
      const s = normStatus(t.status)
      if (c[s] != null) c[s] += 1
    }
    return c
  }, [tasks])

  const today = new Date().toISOString().split('T')[0]
  const selectedTask = tasks.find(t => t.id === selectedId) ?? null

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <p className="text-sm text-muted break-words max-w-md">{error}</p>
      <div className="flex gap-2">
        <button className="btn-secondary text-sm" onClick={() => loadAll()}>Повторить</button>
        <button className="btn-secondary text-sm" onClick={() => navigate('/projects')}>Назад к проектам</button>
      </div>
    </div>
  )

  const progress = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div>
        <Link to="/projects" className="text-xs text-muted hover:text-text inline-flex items-center gap-1 mb-3">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Все проекты
        </Link>
        <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
          <div className="h-1.5" style={{ backgroundColor: project?.color ?? '#2D5BE3' }} />
          <div className="p-4 sm:p-5">
            <h1 className="text-xl font-semibold text-text">{project?.name}</h1>
            {project?.description && (
              <p className="text-sm text-muted mt-1">{project.description}</p>
            )}

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
              <Stat label="Всего"        value={counts.total} />
              <Stat label="Входящие"     value={counts.pending} />
              <Stat label="В работе"     value={counts.in_progress} />
              <Stat label="На проверке"  value={counts.review} />
              <Stat label="Готово"       value={counts.done} />
            </div>

            {counts.total > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted mb-1.5">
                  <span>Прогресс</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-1.5 bg-hover rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${progress}%`, backgroundColor: project?.color ?? '#2D5BE3' }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Статус:</span>
        <div className="flex flex-wrap gap-1 bg-hover rounded-lg p-1">
          {STATUS_OPTIONS.map(o => (
            <button
              key={o.value || 'all'}
              type="button"
              onClick={() => setFilterStatus(o.value)}
              className={`text-xs font-medium py-1 px-2.5 rounded-md transition-colors ${
                filterStatus === o.value
                  ? 'bg-card text-text shadow-card'
                  : 'text-muted hover:text-text'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted ml-1">{filtered.length}</span>
      </div>

      {/* Task list */}
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <p className="text-sm text-muted">
              {filterStatus ? `Нет задач со статусом «${STATUS_LABEL[filterStatus]}»` : 'В этом проекте пока нет задач'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(task => {
              const status = normStatus(task.status)
              const isOverdue = task.due_date && task.due_date < today && status !== 'done'
              const isDone    = status === 'done'
              const assignee  = task.profiles ?? teamById[task.assignee_id]
              const previewText = descriptionPreview(task.description)
              return (
                <div
                  key={task.id}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    if (e.clientX - rect.left < 48) return
                    setSelectedId(task.id)
                  }}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-hover transition-colors cursor-pointer ${isDone ? 'opacity-50' : ''}`}
                >
                  <TaskCheck done={isDone} isOverdue={isOverdue} onToggle={() => quickToggleDone(task)} />
                  {task.priority && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-muted'}`} />
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
                    <span className="text-xs text-muted hidden sm:inline">{STATUS_LABEL[status]}</span>
                    {assignee && (
                      <div
                        className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0"
                        title={assignee.full_name || assignee.email}
                      >
                        {(assignee.full_name ?? assignee.email ?? '?')[0].toUpperCase()}
                      </div>
                    )}
                    {task.due_date && (
                      <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-muted'}`}>
                        {new Date(task.due_date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          projects={allProjects}
          team={team}
          onClose={() => setSelectedId(null)}
          onUpdated={applyTaskUpdate}
          onDeleted={removeTaskFromList}
        />
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-hover rounded-lg p-2.5">
      <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-text leading-none mt-1">{value}</p>
    </div>
  )
}
