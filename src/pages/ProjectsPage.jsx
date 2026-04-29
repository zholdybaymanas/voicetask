import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseRest, supabaseDelete, getCurrentUser } from '../lib/supabase'
import { taskVisibilityFilter } from '../lib/taskAccess'
import { useAuth } from '../hooks/useAuth'

const COLORS = ['#2D5BE3', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#64748B']

export default function ProjectsPage() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [projects, setProjects]     = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [doneCounts, setDoneCounts] = useState({})
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [modalOpen, setModalOpen]   = useState(false)
  const [form, setForm]             = useState({ name: '', description: '', color: COLORS[0] })
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting]     = useState(false)

  useEffect(() => { loadProjects() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id, profile?.role])

  async function loadProjects() {
    setLoading(true)
    setError(null)
    try {
      const [projectsRes, tasksRes] = await Promise.all([
        supabaseRest('projects', { filters: ['archived=eq.false', 'order=created_at.asc'] }),
        supabaseRest('tasks', { select: 'project_id,status', filters: taskVisibilityFilter(user, profile) }),
      ])
      if (projectsRes.error) throw new Error(projectsRes.error.message ?? JSON.stringify(projectsRes.error))
      if (tasksRes.error)    throw new Error(tasksRes.error.message    ?? JSON.stringify(tasksRes.error))
      setProjects(projectsRes.data ?? [])
      const counts = {}, done = {}
      for (const t of tasksRes.data ?? []) {
        if (!t.project_id) continue
        counts[t.project_id] = (counts[t.project_id] ?? 0) + 1
        if (t.status === 'done') done[t.project_id] = (done[t.project_id] ?? 0) + 1
      }
      setTaskCounts(counts)
      setDoneCounts(done)
    } catch (err) {
      console.error('[ProjectsPage] loadProjects:', err)
      setError(err.message ?? 'Не удалось загрузить проекты')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) return setFormError('Введите название проекта')

    const user = getCurrentUser()
    if (!user?.id) {
      setFormError('Сессия не найдена. Войдите заново.')
      return
    }

    setSaving(true)
    const body = {
      name:        form.name.trim(),
      description: form.description.trim() || null,
      color:       form.color,
      owner_id:    user.id,
    }

    const result = await supabaseRest('projects', { method: 'POST', body })
    setSaving(false)

    if (result.error) {
      console.error('[ProjectsPage] create error:', result.error, '| sent:', body)
      const msg = result.error.message ?? result.error.hint ?? JSON.stringify(result.error)
      return setFormError(`Ошибка: ${msg}`)
    }
    if (!result.data?.length) {
      console.warn('[ProjectsPage] create returned empty data — RLS may have silently rejected the insert')
    }

    setModalOpen(false)
    setForm({ name: '', description: '', color: COLORS[0] })
    loadProjects()
  }

  async function deleteProject(id) {
    setDeleting(true)
    const { error } = await supabaseDelete('projects', id)
    setDeleting(false)
    setConfirmDeleteId(null)
    if (error) {
      console.error('[ProjectsPage] delete error:', error)
      setError(error.message ?? 'Не удалось удалить проект')
      return
    }
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  const projectToDelete = projects.find(p => p.id === confirmDeleteId) ?? null

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <p className="text-sm text-muted">{error}</p>
      <button className="btn-secondary text-sm" onClick={loadProjects}>Повторить</button>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{projects.length} проектов</p>
        <button
          className="btn-primary flex items-center gap-1.5 text-sm shrink-0"
          onClick={() => { setModalOpen(true); setFormError('') }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="hidden sm:inline">Создать проект</span>
          <span className="sm:hidden">Создать</span>
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="bg-card rounded-xl border border-border shadow-card flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-text">Проектов пока нет</p>
          <p className="text-xs text-muted mt-1">Создайте первый проект</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {projects.map(p => {
            const total    = taskCounts[p.id] ?? 0
            const done     = doneCounts[p.id] ?? 0
            const progress = total > 0 ? Math.round((done / total) * 100) : 0
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/projects/${p.id}`)}
                className="bg-card rounded-xl border border-border shadow-card hover:shadow-card-hover transition-shadow overflow-hidden group cursor-pointer"
              >
                <div className="h-1.5" style={{ backgroundColor: p.color ?? '#2D5BE3' }} />

                <div className="p-4">
                  <div className="flex items-start justify-between mb-3 gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text truncate">{p.name}</p>
                      {p.description && (
                        <p className="text-xs text-muted mt-0.5 line-clamp-2">{p.description}</p>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(p.id) }}
                      title="Удалить проект"
                      className="md:opacity-0 md:group-hover:opacity-100 transition-opacity text-muted hover:text-red-500 p-1 rounded shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{total} задач</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-hover rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${progress}%`, backgroundColor: p.color ?? '#2D5BE3' }}
                      />
                    </div>
                    <p className="text-xs text-muted">{done} из {total} выполнено</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleting && setConfirmDeleteId(null)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 sm:p-6">
            <h2 className="text-base font-semibold text-text mb-2">Удалить проект?</h2>
            <p className="text-sm text-muted mb-5">
              Проект <span className="text-text font-medium">«{projectToDelete.name}»</span> будет удалён без возможности восстановления.
              Связанные задачи останутся, но потеряют ссылку на проект.
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-secondary"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
              >
                Отмена
              </button>
              <button
                onClick={() => deleteProject(projectToDelete.id)}
                disabled={deleting}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {deleting && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-text">Новый проект</h2>
              <button onClick={() => setModalOpen(false)} className="text-muted hover:text-text p-1 rounded-lg hover:bg-hover">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text mb-1">Название *</label>
                <input className="input" autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Название проекта" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-1">Описание</label>
                <textarea className="input resize-none" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Необязательно" />
              </div>
              <div>
                <label className="block text-xs font-medium text-text mb-2">Цвет</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c} type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`w-7 h-7 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-offset-card ring-text scale-110' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              {formError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 break-words">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Отмена</button>
                <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
                  {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
