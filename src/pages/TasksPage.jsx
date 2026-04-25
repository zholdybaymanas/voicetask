import { useState, useEffect } from 'react'
import { supabase, supabaseRest, getCurrentUser } from '../lib/supabase'

const STATUS_OPTIONS = [
  { value: '',            label: 'Все статусы' },
  { value: 'todo',        label: 'К выполнению' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done',        label: 'Готово' },
  { value: 'cancelled',   label: 'Отменено' },
]
const STATUS_BADGE = {
  todo:        'bg-slate-100 text-slate-500',
  in_progress: 'bg-blue-50 text-primary font-semibold',
  done:        'bg-emerald-50 text-emerald-700',
  cancelled:   'bg-slate-100 text-slate-400',
}
const STATUS_LABEL = {
  todo: 'К выполнению', in_progress: 'В работе', done: 'Готово', cancelled: 'Отменено',
}
const PRIORITY_DOT  = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-slate-300' }
const PRIORITY_LABEL = { low: 'Низкий', medium: 'Средний', high: 'Высокий' }

export default function TasksPage() {
  const [tasks, setTasks]               = useState([])
  const [projects, setProjects]         = useState([])
  const [team, setTeam]                 = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [filterProject, setFilterProject]   = useState('')
  const [filterStatus,  setFilterStatus]    = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [addOpen, setAddOpen]           = useState(false)

  useEffect(() => {
    loadAll()
    window.addEventListener('voiceTaskCreated', loadAll)
    const ch = supabase.channel('tasks-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, loadAll)
      .subscribe()
    return () => { window.removeEventListener('voiceTaskCreated', loadAll); supabase.removeChannel(ch) }
  }, [])

  async function loadAll() {
    setLoading(true)
    setError(null)
    try {
      const [tasksRes, projectsRes, profilesRes] = await Promise.all([
        supabaseRest('tasks', { select: '*,projects(name,color)', filters: ['order=created_at.desc'] }),
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
      setLoading(false)
    }
  }

  async function updateStatus(id, status) {
    const result = await supabaseRest('tasks', { method: 'PATCH', filters: [`id=eq.${id}`], body: { status } })
    if (result.error) {
      console.error('[TasksPage] updateStatus error:', result.error)
      return
    }
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t))
  }

  const today = new Date().toISOString().split('T')[0]

  const filtered = tasks.filter(t => {
    if (filterProject  && t.project_id  !== filterProject)  return false
    if (filterStatus   && t.status      !== filterStatus)   return false
    if (filterAssignee && t.assignee_id !== filterAssignee) return false
    return true
  })

  const assigneeById = Object.fromEntries(team.map(u => [u.id, u]))

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto text-sm" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
          <option value="">Все проекты</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="input w-auto text-sm hidden sm:block" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="">Все исполнители</option>
          {team.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
        </select>
        {(filterProject || filterStatus || filterAssignee) && (
          <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => { setFilterProject(''); setFilterStatus(''); setFilterAssignee('') }}>
            Сбросить
          </button>
        )}
        <span className="text-xs text-slate-400 ml-1">{filtered.length}</span>
        <div className="flex-1" />
        <button className="btn-primary text-sm flex items-center gap-1.5 shrink-0" onClick={() => setAddOpen(true)}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Задача
        </button>
      </div>

      {/* List / Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Header row (desktop only) */}
        <div className="hidden md:grid grid-cols-[1fr_160px_140px_110px_130px] gap-4 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
          {['Задача', 'Проект', 'Исполнитель', 'Дедлайн', 'Статус'].map(h => (
            <span key={h} className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{h}</span>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-4">
            <p className="text-sm text-slate-500 break-words">{error}</p>
            <button className="btn-secondary text-sm" onClick={loadAll}>Повторить</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-slate-700">Задач не найдено</p>
            <p className="text-xs text-slate-400 mt-1">Попробуйте изменить фильтры</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filtered.map(task => {
              const isOverdue = task.due_date && task.due_date < today && task.status !== 'done' && task.status !== 'cancelled'
              const assignee  = task.profiles ?? assigneeById[task.assignee_id]
              const isDone    = task.status === 'done'
              return (
                <div key={task.id} className="px-4 py-3 hover:bg-slate-50/60 transition-colors">
                  {/* Desktop: grid row */}
                  <div className="hidden md:grid grid-cols-[1fr_160px_140px_110px_130px] gap-4 items-center">
                    <TaskTitle task={task} isDone={isDone} />
                    <ProjectBadge project={task.projects} />
                    <AssigneeBadge user={assignee} />
                    <DueDate date={task.due_date} isOverdue={isOverdue} />
                    <StatusSelect value={task.status} onChange={s => updateStatus(task.id, s)} />
                  </div>

                  {/* Mobile: stacked card */}
                  <div className="md:hidden space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <TaskTitle task={task} isDone={isDone} />
                      <StatusSelect value={task.status} onChange={s => updateStatus(task.id, s)} compact />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {task.projects && <ProjectBadge project={task.projects} />}
                      {assignee && <AssigneeBadge user={assignee} />}
                      {task.due_date && <DueDate date={task.due_date} isOverdue={isOverdue} />}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add task modal */}
      {addOpen && (
        <AddTaskModal
          projects={projects}
          team={team}
          onClose={() => setAddOpen(false)}
          onCreated={loadAll}
        />
      )}
    </div>
  )
}

function TaskTitle({ task, isDone }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority] ?? 'bg-slate-300'}`} title={PRIORITY_LABEL[task.priority]} />
      <div className="min-w-0">
        <p className={`text-sm truncate ${isDone ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'}`}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-slate-400 truncate mt-0.5">{task.description}</p>
        )}
      </div>
    </div>
  )
}

function ProjectBadge({ project }) {
  if (!project) return <span className="text-slate-300 text-sm">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full max-w-full">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: project.color ?? '#2D5BE3' }} />
      <span className="truncate">{project.name}</span>
    </span>
  )
}

function AssigneeBadge({ user }) {
  if (!user) return <span className="text-slate-300 text-sm">—</span>
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
        {(user.full_name ?? user.email ?? '?')[0].toUpperCase()}
      </div>
      <span className="text-xs text-slate-600 truncate">{user.full_name || user.email}</span>
    </div>
  )
}

function DueDate({ date, isOverdue }) {
  if (!date) return <span className="text-slate-300 text-sm">—</span>
  return (
    <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-500'}`}>
      {new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
    </span>
  )
}

function StatusSelect({ value, onChange, compact = false }) {
  return (
    <select
      value={value ?? 'todo'}
      onChange={e => onChange(e.target.value)}
      className={`text-xs rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer appearance-none text-center ${compact ? 'shrink-0' : 'w-full'} ${STATUS_BADGE[value ?? 'todo']}`}
    >
      <option value="todo">К выполнению</option>
      <option value="in_progress">В работе</option>
      <option value="done">Готово</option>
      <option value="cancelled">Отменено</option>
    </select>
  )
}

function AddTaskModal({ projects, team, onClose, onCreated }) {
  const [form, setForm] = useState({ title: '', description: '', project_id: '', assignee_id: '', due_date: '', priority: 'medium', status: 'todo' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!form.title.trim()) return setErr('Введите название задачи')
    setSaving(true)
    const user = getCurrentUser()
    const result = await supabaseRest('tasks', {
      method: 'POST',
      body: {
        title:       form.title.trim(),
        description: form.description.trim() || null,
        project_id:  form.project_id  || null,
        assignee_id: form.assignee_id || null,
        due_date:    form.due_date    || null,
        priority:    form.priority,
        status:      form.status,
        created_by:  user?.id,
      },
    })
    setSaving(false)
    if (result.error) {
      console.error('[TasksPage] create error:', result.error)
      return setErr(result.error.message ?? 'Ошибка создания задачи')
    }
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Новая задача</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Название *</label>
            <input className="input" autoFocus value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Название задачи" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Описание</label>
            <textarea className="input resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Необязательно" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Проект</label>
              <select className="input" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                <option value="">— не выбран —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Исполнитель</label>
              <select className="input" value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))}>
                <option value="">— не назначен —</option>
                {team.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Дедлайн</label>
              <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Приоритет</label>
              <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Низкий</option>
                <option value="medium">Средний</option>
                <option value="high">Высокий</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Статус</label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="todo">К выполнению</option>
                <option value="in_progress">В работе</option>
                <option value="done">Готово</option>
              </select>
            </div>
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 break-words">{err}</p>}
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
