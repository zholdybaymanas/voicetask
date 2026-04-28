import { useState, useEffect } from 'react'
import { supabase, supabaseRest, supabasePatch, getCurrentUser } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { descriptionPreview } from '../lib/description'
import TaskDetailDrawer from '../components/TaskDetailDrawer'
import TaskCheck from '../components/TaskCheck'

const STATUS_OPTIONS = [
  { value: '',            label: 'Все статусы' },
  { value: 'pending',     label: 'Новая' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review',      label: 'На проверке' },
  { value: 'done',        label: 'Выполнена' },
]
const STATUS_BADGE = {
  pending:     'bg-hover text-muted',
  in_progress: 'bg-primary/15 text-primary font-semibold',
  review:      'bg-violet-500/15 text-violet-500 font-semibold',
  done:        'bg-emerald-500/15 text-emerald-500',
}

// Treat legacy status values as their new equivalents.
function normStatus(s) {
  if (s === 'todo') return 'pending'
  if (s === 'cancelled') return 'done'
  return s ?? 'pending'
}
const PRIORITY_DOT  = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-muted' }
const PRIORITY_LABEL = { low: 'Низкий', medium: 'Средний', high: 'Высокий' }

const TAB_EMPTY = {
  inbox: { title: 'Нет входящих задач',   sub: 'Когда вам назначат задачу — она появится здесь.' },
  sent:  { title: 'Нет отправленных',      sub: 'Здесь появятся задачи, которые вы делегировали другим.' },
  all:   { title: 'Задач нет',             sub: 'Создайте первую задачу.' },
}

export default function TasksPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const [tab, setTab] = useState('all') // 'all' | 'inbox' | 'sent'
  const [tasks, setTasks]               = useState([])
  const [projects, setProjects]         = useState([])
  const [team, setTeam]                 = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [filterProject, setFilterProject]   = useState('')
  const [filterStatus,  setFilterStatus]    = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [addOpen, setAddOpen]           = useState(false)
  const [selectedId, setSelectedId]     = useState(null)

  // (Все three tabs are available to every authed user — RLS already
  // restricts the "Все" tab to tasks the current user has access to.)

  useEffect(() => {
    if (!user?.id) return
    loadAll()
    const silentReload = () => loadAll({ silent: true })
    window.addEventListener('voiceTaskCreated', silentReload)
    const ch = supabase.channel('tasks-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, silentReload)
      .subscribe()
    return () => {
      window.removeEventListener('voiceTaskCreated', silentReload)
      supabase.removeChannel(ch)
    }
  }, [user?.id, tab])

  async function loadAll({ silent = false } = {}) {
    if (!user?.id) return
    if (!silent) setLoading(true)
    setError(null)
    try {
      // Build per-tab filter
      const taskFilters = ['order=created_at.desc']
      if (tab === 'inbox') {
        taskFilters.push(`assignee_id=eq.${user.id}`)
      } else if (tab === 'sent') {
        taskFilters.push(`created_by=eq.${user.id}`)
        taskFilters.push(`assignee_id=neq.${user.id}`)
      }
      // 'all' — no extra filter; RLS allows admins to see everything

      const [tasksRes, projectsRes, profilesRes] = await Promise.all([
        supabaseRest('tasks', { select: '*,projects(name,color)', filters: taskFilters }),
        supabaseRest('projects', { select: 'id,name', filters: ['archived=eq.false'] }),
        supabaseRest('profiles', { select: 'id,full_name,email' }),
      ])
      if (tasksRes.error)    throw new Error(tasksRes.error.message    ?? JSON.stringify(tasksRes.error))
      if (projectsRes.error) throw new Error(projectsRes.error.message ?? JSON.stringify(projectsRes.error))
      if (profilesRes.error) throw new Error(profilesRes.error.message ?? JSON.stringify(profilesRes.error))
      setTasks(tasksRes.data ?? [])
      setProjects(projectsRes.data ?? [])
      setTeam(profilesRes.data ?? [])
    } catch (err) {
      console.error('[TasksPage] loadAll:', err)
      setError(err.message ?? 'Не удалось загрузить задачи')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function quickToggleDone(task) {
    const nextStatus = task.status === 'done' ? 'pending' : 'done'
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: nextStatus } : t))
    const { error } = await supabasePatch('tasks', task.id, { status: nextStatus })
    if (error) {
      console.error('[TasksPage] quickToggleDone:', error)
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: task.status } : t))
    }
  }

  async function updateStatus(id, status) {
    const prev = tasks.find(t => t.id === id)
    if (!prev) return
    // Optimistic — apply locally first, roll back on error.
    setTasks(curr => curr.map(t => t.id === id ? { ...t, status } : t))
    const { error } = await supabasePatch('tasks', id, { status })
    if (error) {
      console.error('[TasksPage] updateStatus:', error)
      setTasks(curr => curr.map(t => t.id === id ? { ...t, status: prev.status } : t))
    }
  }

  function applyTaskUpdate(updated) {
    setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated, projects: t.projects } : t))
  }

  function removeTaskFromList(id) {
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const today = new Date().toISOString().split('T')[0]

  const filtered = tasks.filter(t => {
    if (filterProject  && t.project_id  !== filterProject)  return false
    if (filterStatus   && t.status      !== filterStatus)   return false
    if (filterAssignee && t.assignee_id !== filterAssignee) return false
    return true
  })

  const assigneeById = Object.fromEntries(team.map(u => [u.id, u]))
  const selectedTask = tasks.find(t => t.id === selectedId) ?? null

  const tabs = [
    { id: 'all',   label: 'Все' },
    { id: 'inbox', label: 'Входящие' },
    { id: 'sent',  label: 'Отправленные' },
  ]

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex bg-hover rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`text-sm font-medium py-1.5 px-4 rounded-md transition-colors ${
              tab === t.id
                ? 'bg-card text-text shadow-card'
                : 'text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto text-sm" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="">Все проекты</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {tab !== 'inbox' && (
          <select className="input w-auto text-sm hidden sm:block" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
            <option value="">Все исполнители</option>
            {team.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
        )}
        {(filterProject || filterStatus || filterAssignee) && (
          <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => { setFilterProject(''); setFilterStatus(''); setFilterAssignee('') }}>
            Сбросить
          </button>
        )}
        <span className="text-xs text-muted ml-1">{filtered.length}</span>
        <div className="flex-1" />
        <button className="btn-primary text-sm flex items-center gap-1.5 shrink-0" onClick={() => setAddOpen(true)}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Задача
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[24px_1fr_160px_140px_110px_130px] gap-4 px-4 py-2.5 border-b border-border bg-hover">
          <span />
          {['Задача', 'Проект', tab === 'inbox' ? 'От кого' : 'Исполнитель', 'Дедлайн', 'Статус'].map(h => (
            <span key={h} className="text-[11px] font-semibold text-muted uppercase tracking-wide">{h}</span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-4">
            <p className="text-sm text-muted break-words">{error}</p>
            <button className="btn-secondary text-sm" onClick={() => loadAll()}>Повторить</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-text">{TAB_EMPTY[tab].title}</p>
            <p className="text-xs text-muted mt-1">{TAB_EMPTY[tab].sub}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(task => {
              const isOverdue = task.due_date && task.due_date < today && task.status !== 'done'
              const assignee  = task.profiles ?? assigneeById[task.assignee_id]
              const creator   = assigneeById[task.created_by]
              const isDone    = task.status === 'done'
              // In Inbox tab, show creator instead of assignee (assignee is always me).
              const personUser = tab === 'inbox' ? creator : assignee
              return (
                <div
                  key={task.id}
                  className={`px-4 py-3 hover:bg-hover transition-colors cursor-pointer ${isDone ? 'opacity-50' : ''}`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    if (e.clientX - rect.left < 48) return  // checkbox dead-zone
                    setSelectedId(task.id)
                  }}
                >
                  <div className="hidden md:grid grid-cols-[24px_1fr_160px_140px_110px_130px] gap-4 items-center">
                    <TaskCheck done={isDone} isOverdue={isOverdue} onToggle={() => quickToggleDone(task)} />
                    <TaskTitle task={task} isDone={isDone} />
                    <ProjectBadge project={task.projects} />
                    <PersonBadge user={personUser} />
                    <DueDate date={task.due_date} isOverdue={isOverdue} />
                    <StatusSelect value={task.status} onChange={s => updateStatus(task.id, s)} />
                  </div>

                  <div className="md:hidden space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5">
                        <TaskCheck done={isDone} isOverdue={isOverdue} onToggle={() => quickToggleDone(task)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <TaskTitle task={task} isDone={isDone} />
                      </div>
                      <StatusSelect value={task.status} onChange={s => updateStatus(task.id, s)} compact />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs pl-7">
                      {task.projects && <ProjectBadge project={task.projects} />}
                      {personUser && <PersonBadge user={personUser} prefix={tab === 'inbox' ? 'от' : '→'} />}
                      {task.due_date && <DueDate date={task.due_date} isOverdue={isOverdue} />}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {addOpen && (
        <AddTaskModal
          projects={projects}
          team={team}
          onClose={() => setAddOpen(false)}
          onCreated={loadAll}
        />
      )}

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

function TaskTitle({ task, isDone }) {
  const text = descriptionPreview(task.description)
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-muted'}`} title={PRIORITY_LABEL[task.priority]} />
      <div className="min-w-0">
        <p className={`text-sm truncate ${isDone ? 'text-muted line-through' : 'text-text font-medium'}`}>
          {task.title}
        </p>
        {text && (
          <p className="text-xs text-muted truncate mt-0.5">{text}</p>
        )}
      </div>
    </div>
  )
}

function ProjectBadge({ project }) {
  if (!project) return <span className="text-muted text-sm">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text bg-hover px-2 py-0.5 rounded-full max-w-full">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: project.color ?? '#2D5BE3' }} />
      <span className="truncate">{project.name}</span>
    </span>
  )
}

function PersonBadge({ user, prefix }) {
  if (!user) return <span className="text-muted text-sm">—</span>
  return (
    <div className="flex items-center gap-1.5">
      {prefix && <span className="text-muted text-xs">{prefix}</span>}
      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
        {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
      </div>
      <span className="text-xs text-muted truncate">{user.full_name || user.email}</span>
    </div>
  )
}

function DueDate({ date, isOverdue }) {
  if (!date) return <span className="text-muted text-sm">—</span>
  return (
    <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-muted'}`}>
      {new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
    </span>
  )
}

function StatusSelect({ value, onChange, compact = false }) {
  const normalized = normStatus(value)
  return (
    <select
      value={normalized}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className={`text-xs rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer appearance-none text-center ${compact ? 'shrink-0' : 'w-full'} ${STATUS_BADGE[normalized]}`}
    >
      <option value="pending">Новая</option>
      <option value="in_progress">В работе</option>
      <option value="review">На проверке</option>
      <option value="done">Выполнена</option>
    </select>
  )
}

function AddTaskModal({ projects, team, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', project_id: '', assignee_id: '', due_date: '', priority: 'medium', status: 'pending' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) return setErr('Введите название задачи')
    setSaving(true)
    const user = getCurrentUser()
    // If no assignee picked, default to self (so the task lands somewhere visible).
    const finalAssignee = form.assignee_id || user?.id || null
    const result = await supabaseRest('tasks', {
      method: 'POST',
      body: {
        title:       form.title.trim(),
        description: form.description.trim() || null,
        project_id:  form.project_id  || null,
        assignee_id: finalAssignee,
        due_date:    form.due_date    || null,
        priority:    form.priority,
        status:      form.status,
        created_by:  user?.id,
        sort_order:  Date.now() / 1000,
      },
    })
    setSaving(false)
    if (result.error) {
      console.error('[TasksPage] create error:', result.error)
      return setErr(result.error.message ?? 'Ошибка создания задачи')
    }

    // Notify the assignee if it's not self.
    const created = Array.isArray(result.data) ? result.data[0] : result.data
    if (finalAssignee && finalAssignee !== user?.id && created?.id) {
      const notifRes = await supabaseRest('notifications', {
        method: 'POST',
        body: {
          user_id: finalAssignee,
          task_id: created.id,
          type:    'new_task',
          title:   `Вам назначена новая задача: ${form.title.trim()}`,
        },
      })
      if (notifRes.error) console.warn('[TasksPage] notification insert failed:', notifRes.error)
    }

    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-text">Новая задача</h2>
          <button onClick={onClose} className="text-muted hover:text-text p-1 rounded-lg hover:bg-hover">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-text mb-1">Название *</label>
            <input className="input" autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Название задачи" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text mb-1">Описание</label>
            <textarea className="input resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Необязательно" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text mb-1">Проект</label>
              <select className="input" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">— не выбран —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text mb-1">Исполнитель</label>
              <select className="input" value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
                <option value="">Я (по умолчанию)</option>
                {team.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-text mb-1">Дедлайн</label>
              <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text mb-1">Приоритет</label>
              <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text mb-1">Статус</label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="pending">Новая</option>
                <option value="in_progress">В работе</option>
                <option value="review">На проверке</option>
                <option value="done">Выполнена</option>
              </select>
            </div>
          </div>
          {err && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 break-words">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>Отмена</button>
            <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
              {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Создать
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
